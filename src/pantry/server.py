from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from pantry import __version__
from pantry.memory import apply_protection_limits, clear_metal_cache, snapshot as memory_snapshot
from pantry.models_api import list_model_entries
from pantry.pull import PullError, pull_package
from pantry.resolve import ResolveError, find_by_model_string, resolve
from pantry.runtime import RuntimeHub
from pantry.scheduler import Scheduler
from pantry.schemas import (
    AudioGenerateRequest,
    CapabilityRequest,
    CompleteRequest,
    ImageGenerateRequest,
    LoadBody,
    PackageManifest,
    PullBody,
    UnloadBody,
)
from pantry.store import PackageStore
from pantry.template import apply_chat_template


def _estimate_usage(pkg: PackageManifest, messages: list, completion: str) -> dict[str, int]:
    """Rough token counts until mlx-lm usage is plumbed end-to-end."""
    prompt = apply_chat_template(pkg, messages)
    prompt_tokens = max(1, len(prompt) // 4)
    completion_tokens = max(0, len(completion) // 4)
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
    }


def _is_text_package(pkg: PackageManifest) -> bool:
    mods = {m.lower() for m in pkg.modalities}
    return "text" in mods or (pkg.role or "").lower() in {"chat", "text"}


def _is_image_package(pkg: PackageManifest) -> bool:
    mods = {m.lower() for m in pkg.modalities}
    return "image_gen" in mods or (pkg.role or "").lower() in {"image_gen", "image"}


def _is_music_package(pkg: PackageManifest) -> bool:
    mods = {m.lower() for m in pkg.modalities}
    return "music" in mods or (pkg.role or "").lower() in {"music", "audio_gen", "audio"}


class Service:
    def __init__(self, store: PackageStore) -> None:
        self.store = store
        self.scheduler = Scheduler()
        self.runtimes = RuntimeHub(store)

    def packages(self) -> list[PackageManifest]:
        return self.store.list_manifests()

    def _ready(self, p: PackageManifest) -> bool:
        return self.store.weights_ready(p)

    def resolve_req(self, req: CapabilityRequest) -> dict[str, Any]:
        try:
            result = resolve(req, self.packages(), is_ready=self._ready)
        except ResolveError as e:
            raise HTTPException(status_code=404, detail=e.message) from e
        return result.model_dump()

    def resolve_model(self, model: str) -> PackageManifest:
        pkg = find_by_model_string(model, self.packages(), is_ready=self._ready)
        if pkg is None:
            raise HTTPException(status_code=404, detail=f"unknown model: {model}")
        return pkg


def create_app(store: PackageStore) -> FastAPI:
    svc = Service(store)
    app = FastAPI(title="pantry", version=__version__)
    app.state.svc = svc
    # Soft Metal cache/memory caps so serve starts protecting unified RAM immediately.
    app.state.memory_limits = apply_protection_limits()
    # Local browser UIs (Open WebUI, etc.) hit loopback from another origin.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/")
    def root() -> dict[str, Any]:
        return {
            "name": "pantry",
            "version": __version__,
            "health": "/v1/health",
            "models": "/v1/models",
            "chat": "/v1/chat/completions",
            "images": "/v1/images/generations",
            "audio": "/v1/audio/generations",
            "memory": "/v1/memory",
            "resolve": "/v1/resolve",
        }

    @app.get("/v1/health")
    def health() -> dict[str, Any]:
        state = store.read_state()
        mem = memory_snapshot(apply_limits=False)
        return {
            "ok": True,
            "name": "pantry",
            "version": __version__,
            "packages": len(store.list_manifests()),
            "loaded": state.get("loaded", []),
            "home": str(store.root),
            "data": str(store.data_root),
            "memory": {
                "pressure": mem.get("pressure"),
                "active_bytes": mem.get("active_bytes"),
                "active_human": mem.get("active_human"),
                "peak_bytes": mem.get("peak_bytes"),
                "peak_human": mem.get("peak_human"),
                "cache_bytes": mem.get("cache_bytes"),
                "cache_human": mem.get("cache_human"),
                "metal_available": mem.get("metal_available"),
                "message": mem.get("message"),
                "limits": getattr(app.state, "memory_limits", {}) or mem.get("limits"),
            },
        }

    @app.get("/v1/memory")
    def memory() -> dict[str, Any]:
        snap = memory_snapshot(apply_limits=False)
        snap["limits_at_start"] = getattr(app.state, "memory_limits", {})
        return snap

    @app.post("/v1/memory/clear")
    def memory_clear() -> dict[str, Any]:
        return clear_metal_cache()

    @app.get("/v1/models")
    def models(
        demos: bool = False,
        ready_only: bool = False,
        all_ids: bool = False,
    ) -> dict[str, Any]:
        return {
            "object": "list",
            "data": list_model_entries(
                store,
                include_demos=demos,
                include_unready=not ready_only,
                include_package_ids=all_ids,
            ),
        }

    @app.post("/v1/resolve")
    def resolve_http(req: CapabilityRequest) -> dict[str, Any]:
        return svc.resolve_req(req)

    @app.post("/v1/pull")
    def pull(req: PullBody) -> dict[str, Any]:
        try:
            return pull_package(store, req.package_id)
        except PullError as e:
            raise HTTPException(status_code=400, detail=e.message) from e

    @app.post("/v1/load")
    def load(req: LoadBody) -> dict[str, Any]:
        if store.load_manifest(req.package_id) is None:
            raise HTTPException(status_code=404, detail=f"unknown package: {req.package_id}")
        store.mark_loaded(req.package_id, pin=req.pin)
        return {
            "ok": True,
            "loaded": store.read_state().get("loaded", []),
            "note": "weights warm on first chat completion",
        }

    @app.post("/v1/unload")
    def unload(req: UnloadBody = UnloadBody()) -> dict[str, Any]:
        if req.package_id:
            store.mark_unloaded(req.package_id)
        else:
            state = store.read_state()
            for pid in list(state.get("loaded", [])):
                store.mark_unloaded(pid)
        svc.runtimes.unload(req.package_id)
        return {
            "ok": True,
            "unloaded": req.package_id or "all",
            "loaded": store.read_state().get("loaded", []),
        }

    @app.post("/v1/chat/completions")
    async def chat_completions(req: CompleteRequest) -> Any:
        pkg = svc.resolve_model(req.model)
        if not _is_text_package(pkg):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"package {pkg.id} is not a chat/text model "
                    f"(modalities={pkg.modalities}); use /v1/images/generations for image_gen"
                ),
            )
        if not store.weights_ready(pkg):
            raise HTTPException(
                status_code=409,
                detail=f"weights not pulled for {pkg.id}; run: pantry pull {pkg.id}",
            )
        runtime = svc.runtimes.for_manifest(pkg)
        want_spec = bool(req.prefer_speculative) or req.model.strip() in {
            "chat-fast",
            "chat-speculative",
        }
        from pantry.runtime import resolve_draft_path

        draft_path, draft_id = resolve_draft_path(
            store, pkg, prefer_speculative=want_spec
        )
        speculative = draft_path is not None

        async def _complete() -> str:
            return await runtime.complete(
                pkg,
                req.messages,
                max_tokens=req.effective_max_tokens(),
                temperature=req.temperature,
                prefer_speculative=want_spec,
            )

        if not req.stream:
            text = await svc.scheduler.run(req.priority, _complete)
            return {
                "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": req.model,
                "package_id": pkg.id,
                "speculative": speculative,
                "draft_package_id": draft_id,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": text},
                        "finish_reason": "stop",
                    }
                ],
                "usage": _estimate_usage(pkg, req.messages, text),
            }

        async def event_stream() -> AsyncIterator[bytes]:
            cid = f"chatcmpl-{uuid.uuid4().hex[:12]}"
            created = int(time.time())
            assembled: list[str] = []

            async def _locked_stream() -> AsyncIterator[str]:
                async with svc.scheduler.hold(req.priority):
                    async for chunk in runtime.stream(
                        pkg,
                        req.messages,
                        max_tokens=req.effective_max_tokens(),
                        temperature=req.temperature,
                        prefer_speculative=want_spec,
                    ):
                        yield chunk

            async for piece in _locked_stream():
                if not piece:
                    continue
                assembled.append(piece)
                payload = {
                    "id": cid,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": req.model,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"content": piece},
                            "finish_reason": None,
                        }
                    ],
                }
                yield f"data: {json.dumps(payload)}\n\n".encode()
            usage = _estimate_usage(pkg, req.messages, "".join(assembled))
            done = {
                "id": cid,
                "object": "chat.completion.chunk",
                "created": created,
                "model": req.model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                "usage": usage,
            }
            yield f"data: {json.dumps(done)}\n\n".encode()
            yield b"data: [DONE]\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    @app.post("/v1/images/generations")
    async def images_generations(req: ImageGenerateRequest) -> dict[str, Any]:
        pkg = svc.resolve_model(req.model)
        if not _is_image_package(pkg):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"package {pkg.id} is not an image_gen model "
                    f"(modalities={pkg.modalities})"
                ),
            )
        if not store.weights_ready(pkg):
            raise HTTPException(
                status_code=409,
                detail=f"weights not pulled for {pkg.id}; run: pantry pull {pkg.id}",
            )
        from pantry.image_runtime import image_runtime_for

        runtime = image_runtime_for(pkg, store)

        async def _gen() -> list[dict]:
            return await asyncio.to_thread(
                runtime.generate,
                pkg,
                prompt=req.prompt,
                size=req.size,
                n=req.n,
                response_format=req.response_format,
            )

        data = await svc.scheduler.run(req.priority, _gen)
        return {
            "created": int(time.time()),
            "model": req.model,
            "package_id": pkg.id,
            "data": data,
        }

    @app.post("/v1/audio/generations")
    async def audio_generations(req: AudioGenerateRequest) -> dict[str, Any]:
        pkg = svc.resolve_model(req.model)
        if not _is_music_package(pkg):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"package {pkg.id} is not a music model "
                    f"(modalities={pkg.modalities})"
                ),
            )
        if not store.weights_ready(pkg):
            raise HTTPException(
                status_code=409,
                detail=f"weights not pulled for {pkg.id}; run: pantry pull {pkg.id}",
            )
        from pantry.music_runtime import music_runtime_for

        runtime = music_runtime_for(pkg, store)

        async def _gen() -> list[dict]:
            return await asyncio.to_thread(
                runtime.generate,
                pkg,
                prompt=req.prompt,
                duration_seconds=req.duration_seconds,
                response_format=req.response_format,
            )

        data = await svc.scheduler.run(req.priority, _gen)
        return {
            "created": int(time.time()),
            "model": req.model,
            "package_id": pkg.id,
            "data": data,
        }

    @app.exception_handler(HTTPException)
    async def http_exc_handler(_req: Any, exc: HTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": {"message": exc.detail}})

    return app
