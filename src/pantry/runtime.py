from __future__ import annotations

import asyncio
import gc
import logging
import threading
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from typing import Any

logger = logging.getLogger("pantry.runtime")

from pantry.limits import clamp_max_tokens
from pantry.schemas import ChatMessage, PackageManifest, QualityTier
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
        draft_model: str | None = None,
        num_draft_tokens: int | None = None,
        prefer_prefix_cache: bool = True,
        prefill_step_size: int = 2048,
        usage: dict[str, Any] | None = None,
        tools: list[dict] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        response_format: dict[str, Any] | str | None = None,
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
        draft_model: str | None = None,
        num_draft_tokens: int | None = None,
        prefer_prefix_cache: bool = True,
        prefill_step_size: int = 2048,
        usage: dict[str, Any] | None = None,
        tools: list[dict] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        response_format: dict[str, Any] | str | None = None,
    ) -> AsyncIterator[str]:
        text = await self.complete(
            manifest,
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
            prefer_speculative=prefer_speculative,
            draft_model=draft_model,
            num_draft_tokens=num_draft_tokens,
            prefer_prefix_cache=prefer_prefix_cache,
            prefill_step_size=prefill_step_size,
            usage=usage,
            tools=tools,
            tool_choice=tool_choice,
            response_format=response_format,
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
        draft_model: str | None = None,
        num_draft_tokens: int | None = None,
        prefer_prefix_cache: bool = True,
        prefill_step_size: int = 2048,
        usage: dict[str, Any] | None = None,
        tools: list[dict] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        response_format: dict[str, Any] | str | None = None,
    ) -> str:
        prompt = apply_chat_template(manifest, messages, tools=tools)
        last_user = ""
        for m in reversed(messages):
            if m.role == "user":
                last_user = m.text().strip()
                break
        draft = ""
        draft_id = None
        if prefer_speculative or draft_model:
            draft_id = draft_model or manifest.runtime.draft_package_id
            if not draft_id and (manifest.family or "") == "demo":
                draft_id = "vdplabs.demo-chat.compact.v1"
            if draft_id:
                draft = f"\n[speculative draft={draft_id}]"

        cached_tokens = 0
        if prefer_prefix_cache:
            from pantry.prefix_cache import PrefixCacheManager

            cache_mgr = PrefixCacheManager.get()
            words = prompt.split()
            pseudo_tokens = [abs(hash(w)) % 100000 + 1 for w in words]
            if pseudo_tokens:
                _, _, cached_tokens = cache_mgr.lookup(manifest.id, pseudo_tokens)
                cache_mgr.insert(manifest.id, pseudo_tokens, "echo_cached_state", nbytes=len(pseudo_tokens) * 64)

        if response_format and isinstance(response_format, dict):
            import json
            from pantry.grammar import generate_schema_mock

            rf_type = response_format.get("type")
            if rf_type == "json_schema":
                schema = response_format.get("json_schema", {}).get("schema")
                mock = generate_schema_mock(schema)
                cleaned = json.dumps(mock, indent=2)
            else:
                cleaned = json.dumps({"status": "ok", "message": f"Echo JSON from {manifest.id}", "input": last_user})
        elif tools and (tool_choice or any("tool" in m.text().lower() or "weather" in m.text().lower() for m in messages if m.role == "user")):
            import json
            from pantry.grammar import generate_schema_mock

            selected_tool = tools[0]
            if isinstance(tool_choice, dict):
                t_name = tool_choice.get("function", {}).get("name")
                for t in tools:
                    fn = t.get("function", t) if isinstance(t, dict) else {}
                    if fn.get("name") == t_name:
                        selected_tool = t
                        break
            fn_info = selected_tool.get("function", selected_tool)
            fn_name = fn_info.get("name", "tool_call")
            params = fn_info.get("parameters", {})
            args_mock = generate_schema_mock(params)
            cleaned = f"<tool_call>{json.dumps({'name': fn_name, 'arguments': args_mock})}</tool_call>"
        else:
            cache_note = f"\n[prefix cache: {cached_tokens} tokens reused]" if cached_tokens > 0 else ""
            img_count = sum(len(m.images()) for m in messages)
            vision_note = f"\n[vision: {img_count} image(s) processed]" if img_count > 0 else ""
            body = (
                f"[pantry echo · {manifest.id} · template={manifest.template_family}]\n"
                f"You said: {last_user or '(empty)'}\n"
                f"Prompt chars: {len(prompt)}{draft}{cache_note}{vision_note}"
            )
            max_toks = clamp_max_tokens(max_tokens, manifest=manifest)
            body = body[: max_toks * 4]
            cleaned = strip_stop_tokens(body, manifest)
        if usage is not None:
            p_toks = max(1, len(prompt.split()))
            c_toks = max(1, len(cleaned.split()))
            usage["prompt_tokens"] = p_toks
            usage["completion_tokens"] = c_toks
            usage["total_tokens"] = p_toks + c_toks
            usage["prompt_tokens_details"] = {"cached_tokens": cached_tokens}
            if draft_id:
                k = int(num_draft_tokens or 2)
                acc = int(c_toks * 0.75)
                usage["speculative"] = {
                    "enabled": True,
                    "draft_model": draft_id,
                    "draft_package_id": draft_id,
                    "num_draft_tokens": k,
                    "draft_tokens": c_toks * k,
                    "accepted_tokens": acc,
                    "acceptance_rate": 0.75,
                    "speedup_factor": 1.45,
                }
        return cleaned


def resolve_draft_path(
    store: PackageStore | None,
    manifest: PackageManifest,
    *,
    prefer_speculative: bool,
    draft_model: str | None = None,
) -> tuple[str | None, str | None]:
    """Return (draft_weights_path, draft_package_id) when speculative can run."""
    if not prefer_speculative and not draft_model:
        return None, None
    if store is None:
        return None, None

    draft_man: PackageManifest | None = None

    # 1. Explicit draft model requested
    if draft_model:
        from pantry.resolve import find_by_model_string

        draft_man = store.load_manifest(draft_model)
        if draft_man is None:
            draft_man = find_by_model_string(
                draft_model, store.list_manifests(), is_ready=store.weights_ready
            )

    # 2. Manifest curated draft_package_id
    if draft_man is None and manifest.runtime.draft_package_id:
        draft_man = store.load_manifest(manifest.runtime.draft_package_id)

    # 3. Dynamic discovery if prefer_speculative is set and weights are ready
    if draft_man is None and prefer_speculative:
        fam = (manifest.family or "").lower()
        candidates = [
            p
            for p in store.list_manifests()
            if p.id != manifest.id
            and "text" in p.modalities
            and (p.family or "").lower() == fam
            and (p.ram_gb_min or 0) < (manifest.ram_gb_min or 0)
            and store.weights_ready(p)
        ]
        if candidates:
            candidates.sort(
                key=lambda p: (
                    0 if p.quality_tier == QualityTier.compact else 1,
                    p.ram_gb_min,
                )
            )
            draft_man = candidates[0]

    if draft_man is None or not store.weights_ready(draft_man):
        return None, None

    resolved = store.resolve_weights_path(draft_man)
    if resolved is not None:
        return str(resolved), draft_man.id
    return str(store.weights_dir(draft_man.id)), draft_man.id


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
            man = self.store.load_manifest(package_id)
            if man:
                resolved = self.store.resolve_weights_path(man)
                if resolved:
                    self._models.pop(str(resolved), None)
            self.store.mark_unloaded(package_id)
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
        draft_model: str | None = None,
        num_draft_tokens: int | None = None,
        prefer_prefix_cache: bool = True,
        prefill_step_size: int = 2048,
        usage: dict[str, Any] | None = None,
        tools: list[dict] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        response_format: dict[str, Any] | str | None = None,
    ) -> str:
        parts: list[str] = []
        async for chunk in self.stream(
            manifest,
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
            prefer_speculative=prefer_speculative,
            draft_model=draft_model,
            num_draft_tokens=num_draft_tokens,
            prefer_prefix_cache=prefer_prefix_cache,
            prefill_step_size=prefill_step_size,
            usage=usage,
            tools=tools,
            tool_choice=tool_choice,
            response_format=response_format,
        ):
            parts.append(chunk)
        raw = strip_stop_tokens("".join(parts), manifest)
        if response_format:
            from pantry.grammar import StrictToolCallGuard

            return StrictToolCallGuard.enforce_response_format(raw, response_format)
        return raw

    async def stream(
        self,
        manifest: PackageManifest,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None,
        temperature: float | None,
        prefer_speculative: bool = False,
        draft_model: str | None = None,
        num_draft_tokens: int | None = None,
        prefer_prefix_cache: bool = True,
        prefill_step_size: int = 2048,
        usage: dict[str, Any] | None = None,
        tools: list[dict] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        response_format: dict[str, Any] | str | None = None,
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
        if self.store is not None:
            self.store.mark_loaded(manifest.id, pin=False)
        model, tokenizer = self._models[model_path]

        draft_path, draft_id = resolve_draft_path(
            self.store,
            manifest,
            prefer_speculative=prefer_speculative,
            draft_model=draft_model,
        )
        draft_model_obj = None
        if draft_path is not None:
            if draft_path not in self._models:
                loaded_draft = await asyncio.to_thread(load, draft_path)
                self._models[draft_path] = loaded_draft  # type: ignore[assignment]
            draft_model_obj, _draft_tok = self._models[draft_path]

        prompt = apply_chat_template(manifest, messages, tools=tools)
        max_toks = clamp_max_tokens(max_tokens, manifest=manifest)
        temp = 0.0 if temperature is None else float(temperature)

        prompt_tokens: list[int] = []
        try:
            prompt_tokens = list(tokenizer.encode(prompt))
        except Exception:  # noqa: BLE001
            prompt_tokens = [abs(hash(w)) % 100000 + 1 for w in prompt.split()]
        prompt_tokens_count = len(prompt_tokens)

        from pantry.prefix_cache import PrefixCacheManager

        cache_mgr = PrefixCacheManager.get()
        cached_tokens_count = 0
        cached_kv_state = None
        gen_prompt: Any = prompt_tokens if prompt_tokens else prompt

        if prefer_prefix_cache and prompt_tokens:
            cached_kv_state, remaining_tokens, cached_tokens_count = cache_mgr.lookup(
                model_path, prompt_tokens
            )
            if cached_kv_state is not None:
                gen_prompt = remaining_tokens

        if usage is not None:
            usage["prompt_tokens"] = prompt_tokens_count
            usage["completion_tokens"] = 0
            usage["total_tokens"] = prompt_tokens_count
            usage["prompt_tokens_details"] = {"cached_tokens": cached_tokens_count}

        queue: asyncio.Queue[str | None] = asyncio.Queue()
        loop = asyncio.get_running_loop()
        errors: list[BaseException] = []
        cancel = threading.Event()
        gen_tokens_count = [0]
        accepted_tokens_count = [0]
        generated_token_ids: list[int] = []
        active_cache = cached_kv_state

        def _produce() -> None:
            nonlocal active_cache
            try:
                from mlx_lm.models.cache import make_prompt_cache
                from mlx_lm.sample_utils import (  # type: ignore
                    make_logits_processors,
                    make_sampler,
                )

                if active_cache is None:
                    active_cache = make_prompt_cache(model)
                    if draft_model_obj is not None:
                        active_cache += make_prompt_cache(draft_model_obj)

                sampler = make_sampler(temp=temp)
                # Small instruct / R1-distill models often skip EOS and restate CoT;
                # stronger penalty on reasoning packs + StreamStopper cuts the rest.
                role = (manifest.role or "").lower()
                family = (manifest.family or "").lower()
                is_reasoning = role == "reasoning" or "deepseek-r1" in family or "r1" in family
                processors = make_logits_processors(
                    repetition_penalty=1.25 if is_reasoning else 1.15,
                    repetition_context_size=128 if is_reasoning else 64,
                    frequency_penalty=0.35 if is_reasoning else 0.2,
                )
                if response_format:
                    try:
                        from pantry.grammar import JsonLogitsProcessor

                        processors.append(JsonLogitsProcessor(tokenizer))
                    except Exception as e:
                        logger.warning("Could not attach JsonLogitsProcessor: %s", e)
                kwargs: dict = {
                    "max_tokens": max_toks,
                    "sampler": sampler,
                    "logits_processors": processors,
                    "prompt_cache": active_cache,
                    "prefill_step_size": prefill_step_size,
                }
                if draft_model_obj is not None:
                    kwargs["draft_model"] = draft_model_obj
                    if num_draft_tokens is not None:
                        kwargs["num_draft_tokens"] = int(num_draft_tokens)
                gen = stream_generate(model, tokenizer, prompt=gen_prompt, **kwargs)
                for item in gen:
                    if cancel.is_set():
                        break
                    gt = getattr(item, "generation_tokens", None)
                    if gt is not None:
                        gen_tokens_count[0] = int(gt)
                    else:
                        gen_tokens_count[0] += 1
                    if getattr(item, "from_draft", False):
                        accepted_tokens_count[0] += 1
                    tok = getattr(item, "token", None)
                    if tok is not None:
                        generated_token_ids.append(int(tok))
                    text = getattr(item, "text", None) or ""
                    if text:
                        loop.call_soon_threadsafe(queue.put_nowait, text)
            except BaseException as exc:  # noqa: BLE001 — surface to async consumer
                errors.append(exc)
            finally:
                if (
                    prefer_prefix_cache
                    and active_cache is not None
                    and not cancel.is_set()
                    and prompt_tokens
                ):
                    try:
                        full_tokens = prompt_tokens + generated_token_ids
                        cache_mgr.insert(model_path, full_tokens, active_cache)
                    except Exception as e:
                        logger.warning("Failed to index prefix cache: %s", e)
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
                total_gen = gen_tokens_count[0]
                usage["prompt_tokens"] = prompt_tokens_count
                usage["completion_tokens"] = total_gen
                usage["total_tokens"] = prompt_tokens_count + total_gen
                if draft_model_obj is not None and draft_id is not None:
                    acc = accepted_tokens_count[0]
                    k = int(num_draft_tokens or 2)
                    verify_steps = max(1, total_gen - acc)
                    drafted = verify_steps * k
                    acc_rate = round(acc / max(1, drafted), 3)
                    speedup = round(
                        (acc + verify_steps) / max(1, verify_steps * (1 + k * 0.2)),
                        2,
                    )
                    usage["speculative"] = {
                        "enabled": True,
                        "draft_model": draft_id,
                        "draft_package_id": draft_id,
                        "num_draft_tokens": k,
                        "draft_tokens": drafted,
                        "accepted_tokens": acc,
                        "acceptance_rate": min(1.0, acc_rate),
                        "speedup_factor": max(1.0, speedup),
                    }

    def _resolve_weights_path(self, manifest: PackageManifest) -> str:
        if self.store is not None:
            resolved = self.store.resolve_weights_path(manifest)
            if resolved is not None:
                return str(resolved)
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


class CUDARuntime(Runtime):
    """PyTorch / Hugging Face Transformers backend for NVIDIA CUDA and Linux systems."""

    def __init__(self, store: PackageStore | None = None) -> None:
        self.store = store
        self._models: dict[str, tuple[object, object]] = {}

    def unload(self, package_id: str | None = None) -> None:
        if package_id is None:
            self._models.clear()
        elif self.store is not None:
            path = str(self.store.weights_dir(package_id))
            self._models.pop(path, None)
            man = self.store.load_manifest(package_id)
            if man:
                resolved = self.store.resolve_weights_path(man)
                if resolved:
                    self._models.pop(str(resolved), None)
            self.store.mark_unloaded(package_id)
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def _resolve_model_path(self, manifest: PackageManifest) -> str:
        if self.store is not None:
            resolved = self.store.resolve_weights_path(manifest)
            if resolved is not None:
                return str(resolved)
            path = self.store.weights_dir(manifest.id)
            if path.is_dir() and any(path.iterdir()):
                return str(path)
        ref = manifest.runtime.hf_repo or manifest.runtime.mlc_artifact or ""
        if ref:
            return ref
        raise RuntimeError(f"package {manifest.id} has no weights path for CUDA/PyTorch")

    def _get_model(self, manifest: PackageManifest) -> tuple[object, object]:
        path_str = self._resolve_model_path(manifest)
        if path_str in self._models:
            return self._models[path_str]

        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore

        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.bfloat16 if (torch.cuda.is_available() and torch.cuda.is_bf16_supported()) else torch.float16

        tokenizer = AutoTokenizer.from_pretrained(path_str, trust_remote_code=True)
        model = AutoModelForCausalLM.from_pretrained(
            path_str,
            torch_dtype=dtype,
            device_map="auto" if device == "cuda" else None,
            trust_remote_code=True,
        )
        if device == "cpu":
            model = model.to("cpu")

        self._models[path_str] = (model, tokenizer)
        if self.store is not None:
            self.store.mark_loaded(manifest.id)
        return model, tokenizer

    async def complete(
        self,
        manifest: PackageManifest,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None,
        temperature: float | None,
        prefer_speculative: bool = False,
        draft_model: str | None = None,
        num_draft_tokens: int | None = None,
        prefer_prefix_cache: bool = True,
        prefill_step_size: int = 2048,
        usage: dict[str, Any] | None = None,
        tools: list[dict] | None = None,
        **kwargs: Any,
    ) -> str:
        parts: list[str] = []
        async for chunk in self.stream(
            manifest,
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
            prefer_speculative=prefer_speculative,
            draft_model=draft_model,
            num_draft_tokens=num_draft_tokens,
            prefer_prefix_cache=prefer_prefix_cache,
            prefill_step_size=prefill_step_size,
            usage=usage,
            tools=tools,
            **kwargs,
        ):
            parts.append(chunk)
        raw = strip_stop_tokens("".join(parts), manifest)
        response_format = kwargs.get("response_format")
        if response_format:
            from pantry.grammar import StrictToolCallGuard

            return StrictToolCallGuard.enforce_response_format(raw, response_format)
        return raw

    async def stream(
        self,
        manifest: PackageManifest,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None,
        temperature: float | None,
        prefer_speculative: bool = False,
        draft_model: str | None = None,
        num_draft_tokens: int | None = None,
        prefer_prefix_cache: bool = True,
        prefill_step_size: int = 2048,
        usage: dict[str, Any] | None = None,
        tools: list[dict] | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[str]:
        try:
            from transformers import TextIteratorStreamer  # type: ignore
        except ImportError as e:
            raise RuntimeError(f"PyTorch/Transformers not available for CUDA runtime: {e}") from e

        model, tokenizer = await asyncio.to_thread(self._get_model, manifest)
        prompt = apply_chat_template(manifest, messages, tools=tools)
        max_toks = clamp_max_tokens(max_tokens, manifest.limits.max_tokens_soft)

        inputs = tokenizer(prompt, return_tensors="pt")
        device = next(model.parameters()).device
        inputs = {k: v.to(device) for k, v in inputs.items()}
        prompt_len = inputs["input_ids"].shape[1]

        streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
        gen_kwargs = {
            **inputs,
            "streamer": streamer,
            "max_new_tokens": max_toks,
            "do_sample": (temperature or 0.7) > 0.0,
            "temperature": max(0.01, float(temperature or 0.7)),
        }

        thread = threading.Thread(target=model.generate, kwargs=gen_kwargs)
        thread.start()

        generated_chunks = []
        loop = asyncio.get_running_loop()

        def _next_chunk():
            try:
                return next(streamer)
            except StopIteration:
                return None

        while True:
            chunk = await loop.run_in_executor(None, _next_chunk)
            if chunk is None:
                break
            generated_chunks.append(chunk)
            yield chunk

        thread.join()
        if usage is not None:
            full_out = "".join(generated_chunks)
            out_toks = len(tokenizer.encode(full_out))
            usage["prompt_tokens"] = prompt_len
            usage["completion_tokens"] = out_toks
            usage["total_tokens"] = prompt_len + out_toks


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
        self.cuda = CUDARuntime(store)
        self._mflux_image: object | None = None

    def for_manifest(self, manifest: PackageManifest) -> Runtime:
        primary = (manifest.runtime.primary or "echo").lower()
        if primary in {"mlx", "mlx_lm", "mlx-lm"}:
            try:
                import mlx.core  # type: ignore

                return self.mlx
            except Exception:
                try:
                    import torch

                    if torch.cuda.is_available():
                        return self.cuda
                except Exception:
                    pass
                return self.echo
        if primary in {"echo_vlm", "echo-vlm", "vlm-echo", "vision_echo"}:
            from pantry.vision import EchoVisionRuntime

            return EchoVisionRuntime(self.store)
        if primary in {"mlx_vlm", "mlx-vlm"}:
            from pantry.vision import vision_runtime_for

            return vision_runtime_for(manifest, self.store)
        if primary in {"cuda", "vllm", "transformers", "pytorch"}:
            return self.cuda
        return self.echo

    def image_runtime(self, manifest: PackageManifest) -> object:
        """Shared mflux/echo image runtime so models stay warm across HTTP requests."""
        from pantry.image_runtime import image_runtime_for

        primary = (manifest.runtime.primary or "").lower()
        if primary in {"mflux", "flux", "flux1"}:
            if self._mflux_image is None:
                self._mflux_image = image_runtime_for(manifest, self.store)
            return self._mflux_image
        return image_runtime_for(manifest, self.store)

    def unload(self, package_id: str | None = None) -> None:
        if hasattr(self.mlx, "unload"):
            self.mlx.unload(package_id)
        if hasattr(self.cuda, "unload"):
            self.cuda.unload(package_id)
        if self._mflux_image is not None and hasattr(self._mflux_image, "unload"):
            self._mflux_image.unload(package_id)
            # Drop the hub handle when nothing remains cached (full unload or last pack).
            models = getattr(self._mflux_image, "_models", None)
            if package_id is None or not models:
                self._mflux_image = None
        try:
            from pantry.video_runtime import _shared_ltx_video_runtime

            if _shared_ltx_video_runtime is not None and hasattr(_shared_ltx_video_runtime, "unload"):
                _shared_ltx_video_runtime.unload(package_id)
        except Exception:
            pass
        try:
            from pantry.music_runtime import _shared_mlx_music_runtime

            if _shared_mlx_music_runtime is not None and hasattr(_shared_mlx_music_runtime, "unload"):
                _shared_mlx_music_runtime.unload(package_id)
        except Exception:
            pass


def runtime_for(manifest: PackageManifest, store: PackageStore | None = None) -> Runtime:
    hub = RuntimeHub(store) if store is not None else None
    if hub is not None:
        return hub.for_manifest(manifest)
    primary = (manifest.runtime.primary or "echo").lower()
    if primary in {"echo_vlm", "echo-vlm", "vlm-echo", "vision_echo"}:
        from pantry.vision import EchoVisionRuntime

        return EchoVisionRuntime(store)
    if primary in {"mlx_vlm", "mlx-vlm"}:
        from pantry.vision import vision_runtime_for

        return vision_runtime_for(manifest, store)
    if primary in {"mlx", "mlx_lm", "mlx-lm"}:
        try:
            import mlx.core  # type: ignore

            return MLXRuntime(store)
        except Exception:
            try:
                import torch

                if torch.cuda.is_available():
                    return CUDARuntime(store)
            except Exception:
                pass
            return EchoRuntime()
    if primary in {"cuda", "vllm", "transformers", "pytorch"}:
        return CUDARuntime(store)
    return EchoRuntime()
