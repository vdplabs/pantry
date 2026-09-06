from __future__ import annotations

import asyncio
import base64
import json
import time
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse

from pantry import __version__
from pantry.memory import apply_protection_limits, clear_metal_cache
from pantry.memory import snapshot as memory_snapshot
from pantry.models_api import list_model_entries
from pantry.pull import PullError, pull_package
from pantry.resolve import ResolveError, find_by_model_string, resolve
from pantry.runtime import RuntimeHub
from pantry.scheduler import Scheduler
from pantry.schemas import (
    AudioGenerateRequest,
    CapabilityRequest,
    ChatMessage,
    CompleteRequest,
    EmbeddingRequest,
    ImageGenerateRequest,
    LoadBody,
    PackageManifest,
    PullBody,
    StoragePruneRequest,
    StoragePruneResponse,
    StorageStatsResponse,
    UnloadBody,
)
from pantry.store import PackageStore
from pantry.template import apply_chat_template


def _estimate_usage(pkg: PackageManifest, messages: list, completion: str) -> dict[str, int]:
    """Rough token counts fallback when runtime cannot report exact counts."""
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
    return "music" in mods or (pkg.role or "").lower() in {"music", "audio_gen"}


def _is_stt_package(pkg: PackageManifest) -> bool:
    mods = {m.lower() for m in pkg.modalities}
    return bool(mods & {"stt", "transcribe", "transcription", "speech_to_text", "audio_transcription"}) or (pkg.role or "").lower() in {"transcribe", "stt"}


def _is_embed_package(pkg: PackageManifest) -> bool:
    mods = {m.lower() for m in pkg.modalities}
    return "embed" in mods or (pkg.role or "").lower() in {"embed", "embedding"}


def _parse_tool_calls(text: str) -> list[dict[str, Any]] | None:
    import re

    tool_calls: list[dict[str, Any]] = []
    matches = re.findall(r"<tool_call>\s*(.*?)\s*</tool_call>", text, re.DOTALL)
    for m in matches:
        try:
            parsed = json.loads(m)
            if isinstance(parsed, dict) and "name" in parsed:
                args = parsed.get("arguments", {})
                args_str = json.dumps(args) if isinstance(args, dict) else str(args)
                tool_calls.append(
                    {
                        "id": f"call_{uuid.uuid4().hex[:8]}",
                        "type": "function",
                        "function": {
                            "name": str(parsed["name"]),
                            "arguments": args_str,
                        },
                    }
                )
        except Exception:  # noqa: BLE001, S112
            continue
    return tool_calls if tool_calls else None


class Service:
    def __init__(self, store: PackageStore, worker_isolation: bool = False) -> None:
        self.store = store
        self.scheduler = Scheduler()
        self.runtimes = RuntimeHub(store, worker_isolation=worker_isolation)

    def packages(self) -> list[PackageManifest]:
        return self.store.list_manifests()

    def _ready(self, p: PackageManifest) -> bool:
        return self.store.weights_ready(p)

    def resolve_req(self, req: CapabilityRequest) -> dict[str, Any]:
        try:
            result = resolve(req, self.packages(), is_ready=self._ready, store=self.store)
        except ResolveError as e:
            raise HTTPException(status_code=404, detail=e.message) from e
        return result.model_dump()

    def resolve_model(self, model: str) -> PackageManifest:
        pkg = find_by_model_string(model, self.packages(), is_ready=self._ready)
        if pkg is None:
            raise HTTPException(status_code=404, detail=f"unknown model: {model}")
        return pkg


def create_app(store: PackageStore, worker_isolation: bool = False) -> FastAPI:
    svc = Service(store, worker_isolation=worker_isolation)
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
            "responses": "/v1/responses",
            "embeddings": "/v1/embeddings",
            "images": "/v1/images/generations",
            "audio": "/v1/audio/generations",
            "memory": "/v1/memory",
            "resolve": "/v1/resolve",
            "shm": "/v1/shm",
            "storage": "/v1/storage",
        }

    @app.get("/v1/health")
    def health() -> dict[str, Any]:
        state = store.read_state()
        mem = memory_snapshot(apply_limits=False)
        cas_stats = store.cas.get_stats()
        return {
            "ok": True,
            "name": "pantry",
            "version": __version__,
            "packages": len(store.list_manifests()),
            "loaded": state.get("loaded", []),
            "home": str(store.root),
            "data": str(store.data_root),
            "socket": str(store.socket_path) if store.socket_path.exists() else None,
            "shm": {
                "dir": str(store.shm_dir),
                "active_buffers": len(list(store.shm_dir.glob("*.bin"))),
            },
            "cas": {
                "dir": str(store.cas_dir),
                "total_chunks": cas_stats.get("total_chunks", 0),
                "dedup_ratio": cas_stats.get("dedup_ratio", 1.0),
                "dedup_saved_bytes": cas_stats.get("dedup_saved_bytes", 0),
            },
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

    @app.get("/v1/storage", response_model=StorageStatsResponse)
    def storage_stats() -> dict[str, Any]:
        return store.cas.get_stats()

    @app.post("/v1/storage/prune", response_model=StoragePruneResponse)
    def storage_prune(req: StoragePruneRequest = StoragePruneRequest()) -> dict[str, Any]:
        pruned_count, reclaimed_bytes = store.cas.prune(dry_run=req.dry_run)
        return {
            "ok": True,
            "dry_run": req.dry_run,
            "chunks_pruned": pruned_count,
            "bytes_reclaimed": reclaimed_bytes,
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

        usage_info: dict[str, int] = {}

        async def _complete() -> str:
            return await runtime.complete(
                pkg,
                req.messages,
                max_tokens=req.effective_max_tokens(),
                temperature=req.temperature,
                prefer_speculative=want_spec,
                usage=usage_info,
                tools=req.tools,
            )

        if not req.stream:
            text = await svc.scheduler.run(req.priority, _complete, modality="text")
            tool_calls = _parse_tool_calls(text) if req.tools else None
            message_obj: dict[str, Any] = {
                "role": "assistant",
                "content": None if tool_calls else text,
            }
            if tool_calls:
                message_obj["tool_calls"] = tool_calls
            finish_reason = "tool_calls" if tool_calls else "stop"

            usage = usage_info if usage_info else _estimate_usage(pkg, req.messages, text)
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
                        "message": message_obj,
                        "finish_reason": finish_reason,
                    }
                ],
                "usage": usage,
            }

        async def event_stream() -> AsyncIterator[bytes]:
            cid = f"chatcmpl-{uuid.uuid4().hex[:12]}"
            created = int(time.time())
            assembled: list[str] = []
            stream_usage: dict[str, int] = {}

            async def _locked_stream() -> AsyncIterator[str]:
                async with svc.scheduler.hold(req.priority, modality="text"):
                    async for chunk in runtime.stream(
                        pkg,
                        req.messages,
                        max_tokens=req.effective_max_tokens(),
                        temperature=req.temperature,
                        prefer_speculative=want_spec,
                        usage=stream_usage,
                        tools=req.tools,
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

            full_text = "".join(assembled)
            tool_calls = _parse_tool_calls(full_text) if req.tools else None
            finish_reason = "tool_calls" if tool_calls else "stop"

            usage = stream_usage if stream_usage else _estimate_usage(pkg, req.messages, full_text)
            done = {
                "id": cid,
                "object": "chat.completion.chunk",
                "created": created,
                "model": req.model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": finish_reason}],
                "usage": usage,
            }
            yield f"data: {json.dumps(done)}\n\n".encode()
            yield b"data: [DONE]\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    @app.post("/v1/responses")
    async def responses(request: Request) -> Any:
        try:
            body = await request.json()
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"invalid JSON: {e}") from e

        model = body.get("model")
        if not model:
            raise HTTPException(status_code=400, detail="model is required")

        messages: list[ChatMessage] = []
        instructions = body.get("instructions")
        if instructions:
            messages.append(ChatMessage(role="system", content=str(instructions)))

        raw_input = body.get("input")
        if raw_input is None:
            raw_input = body.get("messages")

        if isinstance(raw_input, str):
            messages.append(ChatMessage(role="user", content=raw_input))
        elif isinstance(raw_input, list):
            for item in raw_input:
                if isinstance(item, str):
                    messages.append(ChatMessage(role="user", content=item))
                elif isinstance(item, dict):
                    role = item.get("role") or ("user" if item.get("type") == "message" else "user")
                    content = item.get("content", "")
                    if isinstance(content, list):
                        parts: list[str] = []
                        for part in content:
                            if isinstance(part, str):
                                parts.append(part)
                            elif isinstance(part, dict) and "text" in part:
                                parts.append(str(part.get("text") or ""))
                        content = "".join(parts)
                    messages.append(ChatMessage(role=str(role), content=content))
        elif raw_input is not None:
            messages.append(ChatMessage(role="user", content=str(raw_input)))

        if not messages:
            raise HTTPException(status_code=400, detail="input or messages required")

        max_tokens = body.get("max_output_tokens") or body.get("max_tokens")
        complete_req = CompleteRequest(
            model=model,
            messages=messages,
            stream=bool(body.get("stream", False)),
            temperature=body.get("temperature"),
            max_tokens=max_tokens,
            priority=body.get("priority", "interactive"),
            tools=body.get("tools"),
            tool_choice=body.get("tool_choice"),
        )

        pkg = svc.resolve_model(complete_req.model)
        if not _is_text_package(pkg):
            raise HTTPException(
                status_code=400,
                detail=f"package {pkg.id} is not a chat/text model (modalities={pkg.modalities})",
            )
        if not store.weights_ready(pkg):
            raise HTTPException(
                status_code=409,
                detail=f"weights not pulled for {pkg.id}; run: pantry pull {pkg.id}",
            )
        runtime = svc.runtimes.for_manifest(pkg)
        want_spec = bool(complete_req.prefer_speculative) or complete_req.model.strip() in {
            "chat-fast",
            "chat-speculative",
        }
        from pantry.runtime import resolve_draft_path

        draft_path, draft_id = resolve_draft_path(
            store, pkg, prefer_speculative=want_spec
        )
        speculative = draft_path is not None
        usage_info: dict[str, int] = {}
        resp_id = f"resp_{uuid.uuid4().hex[:16]}"
        msg_id = f"msg_{uuid.uuid4().hex[:12]}"
        created = int(time.time())

        if not complete_req.stream:
            async def _complete() -> str:
                return await runtime.complete(
                    pkg,
                    complete_req.messages,
                    max_tokens=complete_req.effective_max_tokens(),
                    temperature=complete_req.temperature,
                    prefer_speculative=want_spec,
                    usage=usage_info,
                    tools=complete_req.tools,
                )

            text = await svc.scheduler.run(complete_req.priority, _complete, modality="text")
            usage = usage_info if usage_info else _estimate_usage(pkg, complete_req.messages, text)
            return {
                "id": resp_id,
                "object": "response",
                "created_at": created,
                "status": "completed",
                "model": complete_req.model,
                "speculative": speculative,
                "draft_package_id": draft_id,
                "output": [
                    {
                        "id": msg_id,
                        "type": "message",
                        "role": "assistant",
                        "content": [
                            {
                                "type": "output_text",
                                "text": text,
                            }
                        ],
                    }
                ],
                "usage": usage,
            }

        async def responses_event_stream() -> AsyncIterator[bytes]:
            assembled: list[str] = []
            stream_usage: dict[str, int] = {}

            async def _locked_stream() -> AsyncIterator[str]:
                async with svc.scheduler.hold(complete_req.priority, modality="text"):
                    async for chunk in runtime.stream(
                        pkg,
                        complete_req.messages,
                        max_tokens=complete_req.effective_max_tokens(),
                        temperature=complete_req.temperature,
                        prefer_speculative=want_spec,
                        usage=stream_usage,
                        tools=complete_req.tools,
                    ):
                        yield chunk

            seq = 0
            async for piece in _locked_stream():
                if not piece:
                    continue
                assembled.append(piece)
                seq += 1
                payload = {
                    "type": "response.output_text.delta",
                    "delta": piece,
                    "sequence_number": seq,
                    "item_id": msg_id,
                    "output_index": 0,
                    "content_index": 0,
                    "choices": [{"index": 0, "delta": {"content": piece}}],
                }
                yield f"event: response.output_text.delta\ndata: {json.dumps(payload)}\n\n".encode()

            full_text = "".join(assembled)
            usage = stream_usage if stream_usage else _estimate_usage(pkg, complete_req.messages, full_text)

            done_payload = {
                "type": "response.output_text.done",
                "text": full_text,
                "item_id": msg_id,
                "output_index": 0,
                "content_index": 0,
            }
            yield f"event: response.output_text.done\ndata: {json.dumps(done_payload)}\n\n".encode()

            completed_payload = {
                "type": "response.completed",
                "response": {
                    "id": resp_id,
                    "object": "response",
                    "created_at": created,
                    "status": "completed",
                    "model": complete_req.model,
                    "output": [
                        {
                            "id": msg_id,
                            "type": "message",
                            "role": "assistant",
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": full_text,
                                }
                            ],
                        }
                    ],
                    "usage": usage,
                },
            }
            yield f"event: response.completed\ndata: {json.dumps(completed_payload)}\n\n".encode()
            yield b"data: [DONE]\n\n"

        return StreamingResponse(responses_event_stream(), media_type="text/event-stream")

    @app.post("/v1/embeddings")
    async def embeddings(req: EmbeddingRequest) -> dict[str, Any]:
        pkg = svc.resolve_model(req.model)
        if not _is_embed_package(pkg):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"package {pkg.id} is not an embed model "
                    f"(modalities={pkg.modalities}); use /v1/chat/completions for chat"
                ),
            )
        if not store.weights_ready(pkg):
            raise HTTPException(
                status_code=409,
                detail=f"weights not pulled for {pkg.id}; run: pantry pull {pkg.id}",
            )
        from pantry.embed_runtime import embed_runtime_for

        runtime = embed_runtime_for(pkg, store)
        inputs = [req.input] if isinstance(req.input, str) else list(req.input)

        def _run_embed() -> tuple[list[list[float]], dict[str, int]]:
            return runtime.embed(pkg, inputs)

        embeddings_data, usage = await svc.scheduler.run(
            req.priority, lambda: asyncio.to_thread(_run_embed), modality="embed"
        )

        data_items = [
            {
                "object": "embedding",
                "index": i,
                "embedding": vec,
            }
            for i, vec in enumerate(embeddings_data)
        ]
        return {
            "object": "list",
            "data": data_items,
            "model": req.model,
            "usage": usage,
        }

    @app.post("/v1/images/generations")
    async def images_generations(
        req: ImageGenerateRequest, request: Request
    ) -> Any:
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
        runtime = svc.runtimes.image_runtime(pkg)

        want_stream = req.stream or request.headers.get("accept", "").lower() == "text/event-stream"
        want_shm = (req.response_format or "").lower() == "shm" or request.headers.get("x-pantry-transport", "").lower() == "shm"

        if want_stream:
            async def _stream_generator() -> AsyncIterator[str]:
                queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()
                loop = asyncio.get_running_loop()

                def _on_step(step: int, total: int, preview_bytes: bytes | None, width: int, height: int) -> None:
                    step_payload: dict[str, Any] = {
                        "type": "step",
                        "step": step,
                        "total": total,
                        "width": width,
                        "height": height,
                    }
                    if preview_bytes:
                        if want_shm:
                            desc = store.shm.allocate(
                                preview_bytes,
                                format="png",
                                prefix="step",
                                metadata={"step": step, "total": total, "width": width, "height": height},
                            )
                            step_payload["shm"] = desc.to_dict()
                        else:
                            step_payload["b64_json"] = base64.b64encode(preview_bytes).decode("ascii")
                    loop.call_soon_threadsafe(queue.put_nowait, ("step", step_payload))

                def _worker_fn() -> list[dict]:
                    return runtime.generate(
                        pkg,
                        prompt=req.prompt,
                        size=req.size,
                        n=req.n,
                        response_format=req.response_format,
                        seed=req.seed,
                        num_inference_steps=req.steps,
                        guidance=req.guidance,
                        negative_prompt=req.negative_prompt,
                        step_callback=_on_step,
                    )

                async def _worker_task() -> None:
                    try:
                        async def _sched_call() -> list[dict]:
                            return await asyncio.to_thread(_worker_fn)
                        gen_data = await svc.scheduler.run(req.priority, _sched_call, modality="image")
                        if want_shm:
                            for item in gen_data:
                                img_path = Path(item["path"]) if "path" in item else None
                                if img_path and img_path.is_file():
                                    raw_bytes = img_path.read_bytes()
                                    desc = store.shm.allocate(
                                        raw_bytes,
                                        format="png",
                                        prefix="img",
                                        metadata={
                                            "width": item.get("width"),
                                            "height": item.get("height"),
                                        },
                                    )
                                    item["shm"] = desc.to_dict()
                                    if (req.response_format or "").lower() == "shm":
                                        item.pop("b64_json", None)
                        await queue.put(("done", gen_data))
                    except Exception as exc:
                        await queue.put(("error", str(exc)))

                task = asyncio.create_task(_worker_task())
                while True:
                    kind, payload = await queue.get()
                    if kind == "step":
                        yield f"event: step\ndata: {json.dumps(payload)}\n\n"
                    elif kind == "done":
                        done_payload = {
                            "type": "done",
                            "created": int(time.time()),
                            "model": req.model,
                            "package_id": pkg.id,
                            "data": payload,
                        }
                        yield f"event: done\ndata: {json.dumps(done_payload)}\n\n"
                        break
                    elif kind == "error":
                        err_payload = {"type": "error", "error": payload}
                        yield f"event: error\ndata: {json.dumps(err_payload)}\n\n"
                        break
                await task

            return StreamingResponse(_stream_generator(), media_type="text/event-stream")

        async def _gen() -> list[dict]:
            return await asyncio.to_thread(
                runtime.generate,
                pkg,
                prompt=req.prompt,
                size=req.size,
                n=req.n,
                response_format=req.response_format,
                seed=req.seed,
                num_inference_steps=req.steps,
                guidance=req.guidance,
                negative_prompt=req.negative_prompt,
            )

        try:
            data = await svc.scheduler.run(req.priority, _gen, modality="image")
        except RuntimeError as e:
            # Preflight / Metal hints — surface as 503 so Sink shows the message
            # instead of a bare ASGI 500.
            raise HTTPException(status_code=503, detail=str(e)) from e

        if want_shm:
            for item in data:
                img_path = Path(item["path"]) if "path" in item else None
                if img_path and img_path.is_file():
                    raw_bytes = img_path.read_bytes()
                    desc = store.shm.allocate(
                        raw_bytes,
                        format="png",
                        prefix="img",
                        metadata={
                            "width": item.get("width"),
                            "height": item.get("height"),
                        },
                    )
                    item["shm"] = desc.to_dict()
                    if (req.response_format or "").lower() == "shm":
                        item.pop("b64_json", None)

        return {
            "created": int(time.time()),
            "model": req.model,
            "package_id": pkg.id,
            "data": data,
        }

    @app.post("/v1/audio/generations")
    async def audio_generations(
        req: AudioGenerateRequest, request: Request
    ) -> dict[str, Any]:
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

        data = await svc.scheduler.run(req.priority, _gen, modality="audio")

        want_shm = (req.response_format or "").lower() == "shm" or request.headers.get("x-pantry-transport", "").lower() == "shm"
        if want_shm:
            for item in data:
                aud_path = Path(item["path"]) if "path" in item else None
                if aud_path and aud_path.is_file():
                    raw_bytes = aud_path.read_bytes()
                    desc = store.shm.allocate(
                        raw_bytes,
                        format="wav",
                        prefix="aud",
                        metadata={
                            "sample_rate": item.get("sample_rate"),
                            "duration_seconds": item.get("duration_seconds"),
                        },
                    )
                    item["shm"] = desc.to_dict()
                    if (req.response_format or "").lower() == "shm":
                        item.pop("b64_json", None)

        return {
            "created": int(time.time()),
            "model": req.model,
            "package_id": pkg.id,
            "data": data,
        }

    @app.get("/v1/shm/{key}")
    async def get_shm(key: str) -> Response:
        store.shm.cleanup()
        path = store.shm.resolve(key)
        if path is None:
            raise HTTPException(status_code=404, detail=f"shared memory buffer not found: {key}")
        data = path.read_bytes()
        return Response(
            content=data,
            media_type="application/octet-stream",
            headers={
                "X-Pantry-SHM-Key": key,
                "X-Pantry-SHM-Path": str(path),
                "Content-Length": str(len(data)),
            },
        )

    @app.delete("/v1/shm/{key}")
    async def delete_shm(key: str) -> dict[str, Any]:
        released = store.shm.release(key)
        if not released:
            raise HTTPException(status_code=404, detail=f"shared memory buffer not found: {key}")
        return {"ok": True, "key": key}

    @app.post("/v1/audio/transcriptions")
    async def audio_transcriptions(
        file: UploadFile = File(...),
        model: str = Form(...),
        language: str | None = Form(None),
        prompt: str | None = Form(None),
        response_format: str = Form("json"),
        temperature: float | None = Form(None),
        timestamp_granularities: list[str] | None = Form(None),
    ) -> Any:
        pkg = svc.resolve_model(model)
        if not _is_stt_package(pkg):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"package {pkg.id} is not a speech-to-text model "
                    f"(modalities={pkg.modalities})"
                ),
            )
        if not store.weights_ready(pkg):
            raise HTTPException(
                status_code=409,
                detail=f"weights not pulled for {pkg.id}; run: pantry pull {pkg.id}",
            )

        from pantry.audio_runtime import (
            audio_transcription_runtime_for,
            format_srt,
            format_vtt,
        )

        runtime = audio_transcription_runtime_for(pkg, store)

        import shutil
        import tempfile

        suffix = Path(file.filename or "audio.wav").suffix or ".wav"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = Path(tmp.name)
            try:
                shutil.copyfileobj(file.file, tmp)
            finally:
                file.file.close()

        word_timestamps = bool(timestamp_granularities and "word" in timestamp_granularities)

        async def _transcribe() -> dict[str, Any]:
            try:
                return await asyncio.to_thread(
                    runtime.transcribe,
                    pkg,
                    audio_path=tmp_path,
                    language=language,
                    prompt=prompt,
                    temperature=temperature,
                    word_timestamps=word_timestamps,
                    original_filename=file.filename,
                )
            finally:
                tmp_path.unlink(missing_ok=True)

        result = await svc.scheduler.run("interactive", _transcribe, modality="stt")

        fmt = (response_format or "json").lower().strip()
        if fmt == "text":
            return PlainTextResponse(result.get("text", ""))
        if fmt == "vtt":
            return PlainTextResponse(
                format_vtt(result.get("segments", [])),
                media_type="text/vtt",
            )
        if fmt == "srt":
            return PlainTextResponse(
                format_srt(result.get("segments", [])),
                media_type="text/plain",
            )
        if fmt == "verbose_json":
            return result
        return {"text": result.get("text", "")}

    @app.exception_handler(HTTPException)
    async def http_exc_handler(_req: Any, exc: HTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": {"message": exc.detail}})

    return app
