from __future__ import annotations

import asyncio
import gc
import threading
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from pantry.limits import clamp_max_tokens
from pantry.schemas import ChatMessage, PackageManifest
from pantry.store import PackageStore
from pantry.template import apply_chat_template, strip_stop_tokens


class Runtime(ABC):
    @abstractmethod
    async def complete(
        self,
        manifest: PackageManifest,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None,
        temperature: float | None,
        prefer_speculative: bool = False,
        usage: dict[str, int] | None = None,
        tools: list[dict] | None = None,
    ) -> str:
        raise NotImplementedError

    async def stream(
        self,
        manifest: PackageManifest,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None,
        temperature: float | None,
        prefer_speculative: bool = False,
        usage: dict[str, int] | None = None,
        tools: list[dict] | None = None,
    ) -> AsyncIterator[str]:
        text = await self.complete(
            manifest,
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
            prefer_speculative=prefer_speculative,
            usage=usage,
            tools=tools,
        )
        step = max(8, len(text) // 8 or 1)
        for i in range(0, len(text), step):
            yield text[i : i + step]
            await asyncio.sleep(0)


class EchoRuntime(Runtime):
    """Deterministic demo backend — proves template ownership + HTTP without MLX."""

    async def complete(
        self,
        manifest: PackageManifest,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None,
        temperature: float | None,
        prefer_speculative: bool = False,
        usage: dict[str, int] | None = None,
        tools: list[dict] | None = None,
    ) -> str:
        prompt = apply_chat_template(manifest, messages, tools=tools)
        last_user = ""
        for m in reversed(messages):
            if m.role == "user":
                last_user = m.text().strip()
                break
        draft = ""
        if prefer_speculative and manifest.runtime.draft_package_id:
            draft = f"\n[speculative draft={manifest.runtime.draft_package_id}]"
        body = (
            f"[pantry echo · {manifest.id} · template={manifest.template_family}]\n"
            f"You said: {last_user or '(empty)'}\n"
            f"Prompt chars: {len(prompt)}{draft}"
        )
        max_toks = clamp_max_tokens(max_tokens)
        body = body[: max_toks * 4]
        cleaned = strip_stop_tokens(body, manifest)
        if usage is not None:
            p_toks = max(1, len(prompt.split()))
            c_toks = max(1, len(cleaned.split()))
            usage["prompt_tokens"] = p_toks
            usage["completion_tokens"] = c_toks
            usage["total_tokens"] = p_toks + c_toks
        return cleaned


def resolve_draft_path(
    store: PackageStore | None,
    manifest: PackageManifest,
    *,
    prefer_speculative: bool,
) -> tuple[str | None, str | None]:
    """Return (draft_weights_path, draft_package_id) when speculative can run."""
    if not prefer_speculative:
        return None, None
    draft_id = manifest.runtime.draft_package_id
    if not draft_id or store is None:
        return None, None
    draft_man = store.load_manifest(draft_id)
    if draft_man is None or not store.weights_ready(draft_man):
        return None, None
    return str(store.weights_dir(draft_id)), draft_id


class MLXRuntime(Runtime):
    """Optional mlx-lm backend. Import is deferred so pantry works without [mlx]."""

    def __init__(self, store: PackageStore | None = None) -> None:
        self.store = store
        self._models: dict[str, tuple[object, object]] = {}

    def unload(self, package_id: str | None = None) -> None:
        if package_id is None:
            self._models.clear()
        elif self.store is not None:
            path = str(self.store.weights_dir(package_id))
            self._models.pop(path, None)
        gc.collect()
        try:
            import mlx.core as mx  # type: ignore

            mx.clear_cache()
        except Exception:  # noqa: BLE001, S110 — best-effort reclaim
            pass

    async def complete(
        self,
        manifest: PackageManifest,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None,
        temperature: float | None,
        prefer_speculative: bool = False,
        usage: dict[str, int] | None = None,
        tools: list[dict] | None = None,
    ) -> str:
        parts: list[str] = []
        async for chunk in self.stream(
            manifest,
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
            prefer_speculative=prefer_speculative,
            usage=usage,
            tools=tools,
        ):
            parts.append(chunk)
        return strip_stop_tokens("".join(parts), manifest)

    async def stream(
        self,
        manifest: PackageManifest,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None,
        temperature: float | None,
        prefer_speculative: bool = False,
        usage: dict[str, int] | None = None,
        tools: list[dict] | None = None,
    ) -> AsyncIterator[str]:
        try:
            from mlx_lm import load, stream_generate  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "MLX runtime requested but mlx-lm is not installed. "
                "pip install 'pantry[mlx]' then retry."
            ) from e

        model_path = self._resolve_weights_path(manifest)
        if model_path not in self._models:
            loaded = await asyncio.to_thread(load, model_path)
            self._models[model_path] = loaded  # type: ignore[assignment]
        model, tokenizer = self._models[model_path]

        draft_path, _draft_id = resolve_draft_path(
            self.store, manifest, prefer_speculative=prefer_speculative
        )
        draft_model = None
        if draft_path is not None:
            if draft_path not in self._models:
                loaded_draft = await asyncio.to_thread(load, draft_path)
                self._models[draft_path] = loaded_draft  # type: ignore[assignment]
            draft_model, _draft_tok = self._models[draft_path]

        prompt = apply_chat_template(manifest, messages, tools=tools)
        max_toks = clamp_max_tokens(max_tokens)
        temp = 0.0 if temperature is None else float(temperature)

        prompt_tokens_count = 0
        try:
            prompt_tokens_count = len(tokenizer.encode(prompt))
        except Exception:  # noqa: BLE001
            prompt_tokens_count = max(1, len(prompt) // 4)

        if usage is not None:
            usage["prompt_tokens"] = prompt_tokens_count
            usage["completion_tokens"] = 0
            usage["total_tokens"] = prompt_tokens_count

        queue: asyncio.Queue[str | None] = asyncio.Queue()
        loop = asyncio.get_running_loop()
        errors: list[BaseException] = []
        cancel = threading.Event()
        gen_tokens_count = [0]

        def _produce() -> None:
            try:
                from mlx_lm.sample_utils import (  # type: ignore
                    make_logits_processors,
                    make_sampler,
                )

                sampler = make_sampler(temp=temp)
                # Small instruct models often skip EOS under long prompts; a light
                # repetition penalty + stream stopper below cuts restated answers.
                processors = make_logits_processors(
                    repetition_penalty=1.15,
                    repetition_context_size=64,
                    frequency_penalty=0.2,
                )
                kwargs: dict = {
                    "max_tokens": max_toks,
                    "sampler": sampler,
                    "logits_processors": processors,
                }
                if draft_model is not None:
                    kwargs["draft_model"] = draft_model
                gen = stream_generate(model, tokenizer, prompt=prompt, **kwargs)
                for item in gen:
                    if cancel.is_set():
                        break
                    gt = getattr(item, "generation_tokens", None)
                    if gt is not None:
                        gen_tokens_count[0] = int(gt)
                    else:
                        gen_tokens_count[0] += 1
                    text = getattr(item, "text", None) or ""
                    if text:
                        loop.call_soon_threadsafe(queue.put_nowait, text)
            except BaseException as exc:  # noqa: BLE001 — surface to async consumer
                errors.append(exc)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        from pantry.stop import StreamStopper

        stopper = StreamStopper(manifest)
        producer = asyncio.create_task(asyncio.to_thread(_produce))
        try:
            while True:
                chunk = await queue.get()
                if chunk is None:
                    break
                piece = stopper.push(chunk)
                if piece:
                    yield piece
                if stopper.halted:
                    cancel.set()
                    break
            if errors:
                raise RuntimeError(f"mlx generation failed: {errors[0]}") from errors[0]
        finally:
            cancel.set()
            await producer
            if usage is not None:
                usage["prompt_tokens"] = prompt_tokens_count
                usage["completion_tokens"] = gen_tokens_count[0]
                usage["total_tokens"] = prompt_tokens_count + gen_tokens_count[0]

    def _resolve_weights_path(self, manifest: PackageManifest) -> str:
        if self.store is not None:
            path = self.store.weights_dir(manifest.id)
            if self.store.weights_ready(manifest):
                return str(path)
            raise RuntimeError(
                f"package {manifest.id} weights not pulled — run: pantry pull {manifest.id}"
            )
        ref = manifest.runtime.mlc_artifact or manifest.runtime.hf_repo or ""
        if not ref:
            raise RuntimeError(f"package {manifest.id} has no weights path for MLX")
        return ref


class RuntimeHub:
    """Process-wide runtime instances keyed by engine."""

    def __init__(self, store: PackageStore, worker_isolation: bool = False) -> None:
        self.store = store
        self.worker_isolation = worker_isolation
        self.echo = EchoRuntime()
        if worker_isolation:
            from pantry.worker import IsolatedMLXRuntime

            self.mlx: Runtime = IsolatedMLXRuntime(store)
        else:
            self.mlx = MLXRuntime(store)

    def for_manifest(self, manifest: PackageManifest) -> Runtime:
        primary = (manifest.runtime.primary or "echo").lower()
        if primary in {"mlx", "mlx_lm", "mlx-lm"}:
            return self.mlx
        return self.echo

    def unload(self, package_id: str | None = None) -> None:
        if hasattr(self.mlx, "unload"):
            self.mlx.unload(package_id)


def runtime_for(manifest: PackageManifest, store: PackageStore | None = None) -> Runtime:
    hub = RuntimeHub(store) if store is not None else None
    if hub is not None:
        return hub.for_manifest(manifest)
    primary = (manifest.runtime.primary or "echo").lower()
    if primary in {"mlx", "mlx_lm", "mlx-lm"}:
        return MLXRuntime(store)
    return EchoRuntime()
