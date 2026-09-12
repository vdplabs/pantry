from __future__ import annotations

"""Native Vision-Language (VLM) Modality Runtimes (Echo scaffold + MLX-VLM)."""

import asyncio
import base64
import io
import json
import logging
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from pantry.grammar import StrictToolCallGuard, generate_schema_mock
from pantry.runtime import Runtime, clamp_max_tokens, strip_stop_tokens
from pantry.schemas import ChatMessage, PackageManifest
from pantry.store import PackageStore

logger = logging.getLogger("pantry.vision")


def parse_image_input(img_ref: str) -> dict[str, Any]:
    """Decodes data URIs, local files, URLs, or base64 strings into image metadata and bytes."""
    data_bytes: bytes = b""
    fmt = "png"

    if img_ref.startswith("data:image/"):
        header, b64_data = img_ref.split(",", 1)
        mime = header.split(";")[0].replace("data:", "")
        fmt = mime.split("/")[-1].lower()
        data_bytes = base64.b64decode(b64_data)
    elif img_ref.startswith("file://"):
        file_path = Path(img_ref[len("file://") :]).expanduser().resolve()
        if file_path.is_file():
            data_bytes = file_path.read_bytes()
            fmt = file_path.suffix.lstrip(".").lower() or "png"
    elif img_ref.startswith("/") or Path(img_ref).is_file():
        file_path = Path(img_ref).expanduser().resolve()
        if file_path.is_file():
            data_bytes = file_path.read_bytes()
            fmt = file_path.suffix.lstrip(".").lower() or "png"
    elif img_ref.startswith("http://") or img_ref.startswith("https://"):
        try:
            import httpx

            resp = httpx.get(img_ref, timeout=10.0)
            if resp.status_code == 200:
                data_bytes = resp.content
                ctype = resp.headers.get("content-type", "")
                if "image/" in ctype:
                    fmt = ctype.split("/")[-1].split(";")[0].lower()
        except Exception as e:
            logger.warning("Failed to fetch image URL %s: %s", img_ref, e)
    else:
        # Attempt raw base64 decode
        try:
            data_bytes = base64.b64decode(img_ref)
        except Exception:
            data_bytes = b""

    width, height = 512, 512
    if data_bytes:
        try:
            from PIL import Image

            with Image.open(io.BytesIO(data_bytes)) as im:
                width, height = im.size
                if im.format:
                    fmt = im.format.lower()
        except Exception:
            pass

    return {
        "bytes": data_bytes,
        "format": fmt,
        "width": width,
        "height": height,
        "size_bytes": len(data_bytes),
    }


class VisionRuntime(Runtime):
    """Base class for vision-language multimodal models."""
    pass


class EchoVisionRuntime(VisionRuntime):
    """Deterministic multimodal VLM scaffold for offline tests and smoke validation."""

    def __init__(self, store: PackageStore | None = None) -> None:
        self.store = store

    async def complete(
        self,
        manifest: PackageManifest,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
        prefer_speculative: bool = False,
        draft_model: str | None = None,
        num_draft_tokens: int | None = None,
        prefer_prefix_cache: bool = True,
        prefill_step_size: int = 2048,
        usage: dict[str, Any] | None = None,
        tools: list[dict] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        response_format: dict[str, Any] | str | None = None,
        adapters: list[str] | None = None,
    ) -> str:
        # Collect all image references from all messages
        all_images: list[dict[str, Any]] = []
        last_user_prompt = ""

        for m in messages:
            if m.role == "user":
                last_user_prompt = m.text()
            imgs = m.images()
            for img in imgs:
                all_images.append(parse_image_input(img))

        if response_format and isinstance(response_format, dict):
            rf_type = response_format.get("type")
            if rf_type == "json_schema":
                schema = response_format.get("json_schema", {}).get("schema")
                mock = generate_schema_mock(schema)
                cleaned = json.dumps(mock, indent=2)
            else:
                cleaned = json.dumps({
                    "model": manifest.id,
                    "images_parsed": len(all_images),
                    "analysis": "Visual features detected successfully.",
                    "prompt": last_user_prompt,
                }, indent=2)
        elif all_images:
            img_descriptions = []
            for i, info in enumerate(all_images, 1):
                img_descriptions.append(
                    f"Image {i}: format={info['format']}, dimensions={info['width']}x{info['height']}, "
                    f"size={info['size_bytes']} bytes"
                )
            desc_block = "\n".join(img_descriptions)
            cleaned = (
                f"[pantry vision · {manifest.id} · multimodal]\n"
                f"Parsed {len(all_images)} image(s):\n{desc_block}\n"
                f"Visual Analysis: The image contains clear visual elements corresponding to '{last_user_prompt or 'scene'}'. "
                f"No visual artifacts or occlusions detected."
            )
        else:
            cleaned = (
                f"[pantry vision · {manifest.id}]\n"
                f"You said: {last_user_prompt or '(empty)'}\n"
                f"No image input detected in messages."
            )

        max_toks = clamp_max_tokens(max_tokens, manifest=manifest)
        cleaned = cleaned[: max_toks * 4]

        if usage is not None:
            p_toks = max(1, len(last_user_prompt.split()) + len(all_images) * 64)
            c_toks = max(1, len(cleaned.split()))
            usage["prompt_tokens"] = p_toks
            usage["completion_tokens"] = c_toks
            usage["total_tokens"] = p_toks + c_toks
            usage["prompt_tokens_details"] = {"cached_tokens": 0}

        return cleaned

    async def stream(
        self,
        manifest: PackageManifest,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
        prefer_speculative: bool = False,
        draft_model: str | None = None,
        num_draft_tokens: int | None = None,
        prefer_prefix_cache: bool = True,
        prefill_step_size: int = 2048,
        usage: dict[str, Any] | None = None,
        tools: list[dict] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        response_format: dict[str, Any] | str | None = None,
        adapters: list[str] | None = None,
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
            adapters=adapters,
        )
        step = max(8, len(text) // 8 or 1)
        for i in range(0, len(text), step):
            yield text[i : i + step]


class MLXVisionRuntime(VisionRuntime):
    """MLX-VLM runtime for Apple Silicon (Qwen2-VL, Llama-3.2-Vision, Pixtral)."""

    def __init__(self, store: PackageStore | None = None) -> None:
        self.store = store
        self._models: dict[str, tuple[object, object]] = {}

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
            raise RuntimeError(f"package {manifest.id} has no weights path for MLX-VLM")
        return ref

    async def complete(
        self,
        manifest: PackageManifest,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
        prefer_speculative: bool = False,
        draft_model: str | None = None,
        num_draft_tokens: int | None = None,
        prefer_prefix_cache: bool = True,
        prefill_step_size: int = 2048,
        usage: dict[str, Any] | None = None,
        tools: list[dict] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        response_format: dict[str, Any] | str | None = None,
        adapters: list[str] | None = None,
    ) -> str:
        try:
            from mlx_vlm import generate, load  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                "MLX vision runtime requested but mlx-vlm is not installed. "
                "pip install 'pantry[mlx-vlm]' then retry."
            ) from exc

        model_path = self._resolve_weights_path(manifest)
        if model_path not in self._models:
            loaded = await asyncio.to_thread(load, model_path)
            self._models[model_path] = loaded  # type: ignore[assignment]
        model, processor = self._models[model_path]

        from PIL import Image

        pil_images = []
        user_prompt = ""
        for m in messages:
            if m.role == "user":
                user_prompt = m.text()
            for img_ref in m.images():
                info = parse_image_input(img_ref)
                if info["bytes"]:
                    try:
                        im = Image.open(io.BytesIO(info["bytes"]))
                        pil_images.append(im)
                    except Exception:
                        pass

        max_toks = clamp_max_tokens(max_tokens, manifest=manifest)
        temp = 0.0 if temperature is None else float(temperature)

        def _run_gen() -> str:
            return generate(
                model,
                processor,
                image=pil_images[0] if pil_images else None,
                prompt=user_prompt,
                max_tokens=max_toks,
                temp=temp,
            )

        res = await asyncio.to_thread(_run_gen)
        cleaned = strip_stop_tokens(res, manifest)
        if response_format:
            cleaned = StrictToolCallGuard.enforce_response_format(cleaned, response_format)

        if usage is not None:
            usage["prompt_tokens"] = max(1, len(user_prompt.split()) + len(pil_images) * 64)
            usage["completion_tokens"] = max(1, len(cleaned.split()))
            usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
        return cleaned

    async def stream(
        self,
        manifest: PackageManifest,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None = None,
        temperature: float | None = None,
        prefer_speculative: bool = False,
        draft_model: str | None = None,
        num_draft_tokens: int | None = None,
        prefer_prefix_cache: bool = True,
        prefill_step_size: int = 2048,
        usage: dict[str, Any] | None = None,
        tools: list[dict] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        response_format: dict[str, Any] | str | None = None,
        adapters: list[str] | None = None,
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
            adapters=adapters,
        )
        step = max(8, len(text) // 8 or 1)
        for i in range(0, len(text), step):
            yield text[i : i + step]


def vision_runtime_for(manifest: PackageManifest, store: PackageStore | None = None) -> VisionRuntime:
    primary = (manifest.runtime.primary or "echo_vlm").lower()
    if primary in {"echo", "echo_vlm", "echo-vlm"}:
        return EchoVisionRuntime(store)
    if primary in {"mlx_vlm", "mlx-vlm"}:
        return MLXVisionRuntime(store)
    return EchoVisionRuntime(store)
