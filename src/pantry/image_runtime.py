from __future__ import annotations

"""Image generation helpers (echo scaffold; real Diffusers/Z-Image later)."""

import base64
import os
from pathlib import Path
import struct
import zlib
from typing import Any

from pantry.schemas import PackageManifest
from pantry.store import PackageStore


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    length = struct.pack(">I", len(data))
    crc = struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return length + tag + data + crc


def _solid_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """Minimal RGB PNG (no deps) for echo_image smoke tests."""
    r, g, b = rgb
    raw = b"".join(b"\x00" + bytes([r, g, b]) * width for _ in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", zlib.compress(raw, 9))
        + _png_chunk(b"IEND", b"")
    )


def _parse_size(size: str | None) -> tuple[int, int]:
    raw = (size or "256x256").lower().strip()
    if "x" not in raw:
        return 256, 256
    try:
        w_s, h_s = raw.split("x", 1)
        w, h = int(w_s), int(h_s)
    except ValueError:
        return 256, 256
    w = max(16, min(w, 1024))
    h = max(16, min(h, 1024))
    return w, h


def _color_from_prompt(prompt: str) -> tuple[int, int, int]:
    digest = zlib.adler32(prompt.encode("utf-8")) & 0xFFFFFFFF
    return ((digest >> 16) & 0xFF, (digest >> 8) & 0xFF, digest & 0xFF)


class EchoImageRuntime:
    """Deterministic placeholder PNG so clients can wire image_gen without weights."""

    def __init__(self, store: PackageStore) -> None:
        self.store = store

    def generate(
        self,
        manifest: PackageManifest,
        *,
        prompt: str,
        size: str | None = None,
        n: int = 1,
        response_format: str = "b64_json",
    ) -> list[dict]:
        width, height = _parse_size(size)
        n = max(1, min(int(n), 4))
        color = _color_from_prompt(prompt.strip() or "pantry")
        artifacts = self.store.artifacts_dir / manifest.id
        artifacts.mkdir(parents=True, exist_ok=True)

        out: list[dict] = []
        for i in range(n):
            png = _solid_png(width, height, color)
            path = artifacts / f"echo-{width}x{height}-{i}.png"
            path.write_bytes(png)
            item: dict = {
                "revised_prompt": (
                    f"[pantry echo_image · {manifest.id}] {prompt.strip()[:200]}"
                ),
                "path": str(path),
            }
            fmt = (response_format or "b64_json").lower()
            if fmt == "b64_json":
                item["b64_json"] = base64.b64encode(png).decode("ascii")
            else:
                item["url"] = path.as_uri()
            out.append(item)
        return out


class MFluxImageRuntime:
    """Real Apple Silicon image generation backend using mflux (FLUX.1-schnell/dev)."""

    def __init__(self, store: PackageStore) -> None:
        self.store = store
        self._models: dict[str, Any] = {}

    def _ensure_cache_env(self) -> None:
        if "HF_HOME" not in os.environ and "HF_HUB_CACHE" not in os.environ:
            if self.store and self.store.data_root != self.store.root:
                os.environ["HF_HOME"] = str(self.store.data_root / "huggingface")
                os.environ["HF_HUB_CACHE"] = str(self.store.data_root / "huggingface" / "hub")

    def generate(
        self,
        manifest: PackageManifest,
        *,
        prompt: str,
        size: str | None = None,
        n: int = 1,
        response_format: str = "b64_json",
        seed: int | None = None,
        num_inference_steps: int | None = None,
    ) -> list[dict]:
        import time

        self._ensure_cache_env()

        width, height = _parse_size(size)
        n = max(1, min(int(n), 4))
        artifacts = self.store.artifacts_dir / manifest.id
        artifacts.mkdir(parents=True, exist_ok=True)
        model_key = manifest.id

        is_zimage = manifest.family.lower() in ("z-image", "zimage") or "z-image" in manifest.id.lower()
        if is_zimage:
            try:
                from mflux.models.z_image.variants.z_image import ZImage
                from mflux.models.common.config.model_config import ModelConfig
            except ImportError as exc:
                raise RuntimeError(
                    f"mflux ZImage is required for z-image ({exc}). Install it with: pip install mflux"
                ) from exc

            if model_key not in self._models:
                quantize = int(manifest.bits_approx) if manifest.bits_approx in (4, 8) else 4
                self._models[model_key] = ZImage(model_config=ModelConfig.z_image_turbo(), quantize=quantize)

            model = self._models[model_key]
            steps = num_inference_steps or 4
        else:
            try:
                from mflux.models.flux.variants.txt2img.flux import Flux1
            except ImportError:
                try:
                    from mflux import Flux1
                except ImportError as exc:
                    raise RuntimeError(
                        f"mflux is required for real image generation ({exc}). "
                        "Install it with: pip install mflux"
                    ) from exc

            if model_key not in self._models:
                quantize = int(manifest.bits_approx) if manifest.bits_approx in (4, 8) else 8
                alias = "dev" if "dev" in manifest.id.lower() else "schnell"
                if hasattr(Flux1, "from_name"):
                    self._models[model_key] = Flux1.from_name(model_name=alias, quantize=quantize)
                elif hasattr(Flux1, "from_alias"):
                    self._models[model_key] = Flux1.from_alias(alias=alias, quantize=quantize)
                else:
                    from mflux.models.common.config.model_config import ModelConfig

                    cfg = ModelConfig.dev() if alias == "dev" else ModelConfig.schnell()
                    self._models[model_key] = Flux1(model_config=cfg, quantize=quantize)

            model = self._models[model_key]
            steps = num_inference_steps or (2 if "schnell" in manifest.id.lower() else 4)

        out: list[dict] = []
        for i in range(n):
            current_seed = (seed + i) if seed is not None else int(time.time() * 1000) % (2**31 - 1) + i
            img = model.generate_image(
                seed=current_seed,
                prompt=prompt,
                num_inference_steps=steps,
                height=height,
                width=width,
            )
            path = artifacts / f"mflux-{width}x{height}-{int(time.time())}-{i}.png"
            img.save(str(path))
            png_bytes = path.read_bytes()

            item: dict = {
                "revised_prompt": prompt.strip(),
                "path": str(path),
            }
            fmt = (response_format or "b64_json").lower()
            if fmt == "b64_json":
                item["b64_json"] = base64.b64encode(png_bytes).decode("ascii")
            else:
                item["url"] = path.as_uri()
            out.append(item)
        return out


def image_runtime_for(
    manifest: PackageManifest, store: PackageStore
) -> EchoImageRuntime | MFluxImageRuntime:
    primary = (manifest.runtime.primary or "").lower()
    if primary in {"echo_image", "echo-image", "echo"}:
        return EchoImageRuntime(store)
    if primary in {"mflux", "flux", "flux1"}:
        return MFluxImageRuntime(store)
    raise RuntimeError(
        f"image runtime {manifest.runtime.primary!r} is not implemented yet "
        f"(package {manifest.id})"
    )

