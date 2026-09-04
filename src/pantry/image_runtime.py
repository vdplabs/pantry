from __future__ import annotations

"""Image generation helpers (echo scaffold; real Diffusers/Z-Image later)."""

import base64
import os
import re
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


def _host_ram_gb() -> float | None:
    try:
        pages = os.sysconf("SC_PHYS_PAGES")
        page_size = os.sysconf("SC_PAGE_SIZE")
        if pages > 0 and page_size > 0:
            return (pages * page_size) / (1024.0**3)
    except (AttributeError, OSError, ValueError):
        return None
    return None


def _swap_used_gb() -> float | None:
    """Best-effort macOS swap-used reading (None on non-Darwin / parse failure)."""
    import platform
    import re
    import subprocess

    if platform.system() != "Darwin":
        return None
    try:
        out = subprocess.check_output(["sysctl", "-n", "vm.swapusage"], text=True, timeout=2)
    except (OSError, subprocess.SubprocessError):
        return None
    match = re.search(r"used\s*=\s*([\d.]+)\s*([MG])", out)
    if not match:
        return None
    value = float(match.group(1))
    unit = match.group(2)
    return value / 1024.0 if unit == "M" else value


def _enable_mflux_low_ram(model: Any, *, cache_limit_bytes: int = 10**9) -> None:
    """Mirror mflux ``--low-ram``: VAE tiling + MemorySaver + tight MLX cache cap."""
    try:
        import mlx.core as mx
        from mflux.callbacks.instances.memory_saver import MemorySaver
        from mflux.models.common.vae.tiling_config import TilingConfig
    except ImportError:
        return

    try:
        from pantry.memory import apply_protection_limits

        apply_protection_limits(mx)
    except Exception:  # noqa: BLE001 — optional soft caps
        pass

    if getattr(model, "tiling_config", None) is None:
        model.tiling_config = TilingConfig()
    mx.set_cache_limit(cache_limit_bytes)
    mx.clear_cache()
    try:
        mx.reset_peak_memory()
    except Exception:  # noqa: BLE001
        pass

    callbacks = getattr(model, "callbacks", None)
    if callbacks is None:
        return
    # Avoid double-registering across repeated generate() calls.
    already = any(isinstance(cb, MemorySaver) for cb in getattr(callbacks, "before_loop", []) or [])
    if already:
        return
    saver = MemorySaver(
        model=model,
        keep_transformer=False,
        cache_limit_bytes=cache_limit_bytes,
        num_seeds=1,
    )
    callbacks.register(saver)


def _looks_prequantized(manifest: PackageManifest, source: str | None) -> bool:
    method = (manifest.quant_method or "").lower()
    blob = f"{method} {source or ''} {manifest.runtime.hf_repo or ''}".lower()
    if re.search(r"(^|[^0-9])(3|4|5|6|8)\s*-?\s*bit", blob):
        return True
    if any(tok in blob for tok in ("mflux-4bit", "mflux-8bit", "4bit", "8bit", "-q4", "-q8")):
        return True
    return False


def mflux_source_and_quantize(
    manifest: PackageManifest,
    store: PackageStore | None,
) -> tuple[str | None, int | None]:
    """Pick (model_path_or_repo, on_the_fly_quantize).

    Pre-quantized mflux mirrors must load with ``quantize=None``. Passing ``-q 4``
    against a full-precision / bf16 tree spikes unified memory and trips the Metal
    GPU watchdog on 16 GB Macs.
    """
    source: str | None = None
    if store is not None:
        resolved = store.resolve_weights_path(manifest)
        if resolved is not None:
            source = str(resolved)
    if source is None and manifest.runtime.hf_repo:
        source = manifest.runtime.hf_repo

    if _looks_prequantized(manifest, source):
        return source, None

    bits = manifest.bits_approx
    if bits in (3, 4, 5, 6, 8):
        return source, int(bits)
    # Unknown full-precision sources: prefer 4-bit on Apple Silicon, but callers
    # should prefer shipping a pre-quantized hf_repo instead.
    return source, 4


def _metal_timeout_hint(exc: BaseException) -> str | None:
    text = str(exc)
    if "GPU Timeout" in text or "kIOGPUCommandBuffer" in text or "Command buffer execution failed" in text:
        swap = _swap_used_gb()
        swap_note = f" Current swap used ≈ {swap:.1f} GB." if swap is not None else ""
        return (
            "Metal GPU timed out (command-buffer watchdog). On Apple Silicon this usually "
            "means unified memory pressure / swap while loading or stepping a large image "
            "model."
            + swap_note
            + " Unload chat models (`pantry unload`), free RAM until `sysctl vm.swapusage` "
            "shows used near 0, use the pre-quantized 4-bit Z-Image pack, and retry at "
            "512x512 or smaller. A reboot clears stuck swap fastest on 16 GB Macs."
        )
    return None


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
    """Real Apple Silicon image generation backend using mflux (FLUX / Z-Image)."""

    def __init__(self, store: PackageStore) -> None:
        self.store = store
        self._models: dict[str, Any] = {}

    def _ensure_cache_env(self) -> None:
        if os.environ.get("HF_HOME") or os.environ.get("HF_HUB_CACHE"):
            return
        if not self.store or self.store.data_root == self.store.root:
            return
        # …/huggingface/pantry → share the sibling hub, not pantry/huggingface/hub
        if self.store.data_root.name == "pantry":
            parent = self.store.data_root.parent
            os.environ["HF_HOME"] = str(parent)
            os.environ["HF_HUB_CACHE"] = str(parent / "hub")
            return
        os.environ["HF_HOME"] = str(self.store.data_root / "huggingface")
        os.environ["HF_HUB_CACHE"] = str(self.store.data_root / "huggingface" / "hub")

    def _preflight(self, manifest: PackageManifest) -> None:
        host = _host_ram_gb()
        if host is not None and host + 0.25 < float(manifest.ram_gb_min or 0):
            raise RuntimeError(
                f"package {manifest.id} declares ram_gb_min={manifest.ram_gb_min} GB but "
                f"this Mac reports ~{host:.1f} GB unified memory. Pick a smaller pack "
                f"(or a pre-quantized 4-bit image pack) — forcing the load will thrash "
                f"swap and trip Metal's GPU timeout watchdog."
            )

        # Metal's command-buffer watchdog (~25s) fires when the kernel stalls in swap.
        # With multi-GB image models this is effectively guaranteed above a few GB used.
        swap = _swap_used_gb()
        if swap is not None and swap >= 2.0:
            raise RuntimeError(
                f"refusing image generation: this Mac already has ~{swap:.1f} GB of swap in use. "
                "Z-Image / FLUX cannot run reliably under that pressure — Metal will GPU-timeout "
                "on the first denoise step. Free memory first: unload pantry chat models "
                "(`pantry unload`), quit heavy apps (Sink local chat, browsers with many tabs), "
                "wait for swap to drop (check `sysctl vm.swapusage`), then retry. "
                "A reboot clears stuck swap fastest on 16 GB machines."
            )

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
        self._preflight(manifest)

        width, height = _parse_size(size)
        host = _host_ram_gb()
        # On ≤16–18 GB machines, keep the working set small even when the user asks larger.
        if host is not None and host <= 18 and (width > 512 or height > 512):
            width, height = min(width, 512), min(height, 512)

        n = max(1, min(int(n), 4))
        artifacts = self.store.artifacts_dir / manifest.id
        artifacts.mkdir(parents=True, exist_ok=True)
        model_key = manifest.id
        source, quantize = mflux_source_and_quantize(manifest, self.store)

        is_zimage = (
            manifest.family.lower() in ("z-image", "zimage")
            or "z-image" in manifest.id.lower()
        )
        try:
            if is_zimage:
                try:
                    from mflux.models.common.config.model_config import ModelConfig
                    from mflux.models.z_image.variants.z_image import ZImage
                except ImportError as exc:
                    raise RuntimeError(
                        f"mflux ZImage is required for z-image ({exc}). "
                        "Install it with: pip install mflux"
                    ) from exc

                if model_key not in self._models:
                    kwargs: dict[str, Any] = {
                        "model_config": ModelConfig.z_image_turbo(),
                        "quantize": quantize,
                    }
                    if source:
                        kwargs["model_path"] = source
                    self._models[model_key] = ZImage(**kwargs)

                model = self._models[model_key]
                _enable_mflux_low_ram(model)
                # 4 steps is the mflux default and cheaper on 16 GB; 8 needs more headroom.
                steps = num_inference_steps or (4 if (host is None or host <= 24) else 8)
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
                    q = 8 if quantize is None else quantize
                    alias = "dev" if "dev" in manifest.id.lower() else "schnell"
                    if hasattr(Flux1, "from_name"):
                        self._models[model_key] = Flux1.from_name(
                            model_name=alias, quantize=q
                        )
                    elif hasattr(Flux1, "from_alias"):
                        self._models[model_key] = Flux1.from_alias(
                            alias=alias, quantize=q
                        )
                    else:
                        from mflux.models.common.config.model_config import ModelConfig

                        cfg = ModelConfig.dev() if alias == "dev" else ModelConfig.schnell()
                        self._models[model_key] = Flux1(model_config=cfg, quantize=q)

                model = self._models[model_key]
                _enable_mflux_low_ram(model)
                steps = num_inference_steps or (2 if "schnell" in manifest.id.lower() else 4)

            out: list[dict] = []
            for i in range(n):
                current_seed = (
                    (seed + i)
                    if seed is not None
                    else int(time.time() * 1000) % (2**31 - 1) + i
                )
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
        except Exception as exc:
            hint = _metal_timeout_hint(exc)
            if hint:
                raise RuntimeError(hint) from exc
            raise


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
