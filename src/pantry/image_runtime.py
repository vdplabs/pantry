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
    raw = (size or "1024x1024").lower().strip()
    if "x" not in raw:
        return 1024, 1024
    try:
        w_s, h_s = raw.split("x", 1)
        w, h = int(w_s), int(h_s)
    except ValueError:
        return 1024, 1024
    w = max(64, min(w, 2048))
    h = max(64, min(h, 2048))
    # Align to multiple of 16 (required for latents and VAE patchification)
    w = (w // 16) * 16
    h = (h // 16) * 16
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


def _mflux_model_intact(model: Any) -> bool:
    """False when mflux MemorySaver (or similar) has nulled generation modules."""
    return (
        getattr(model, "text_encoder", None) is not None
        and getattr(model, "transformer", None) is not None
        and getattr(model, "vae", None) is not None
    )


def _enable_mflux_low_ram(model: Any, *, cache_limit_bytes: int = 10**9) -> None:
    """Apply low-RAM *non-destructive* knobs: VAE tiling + tight MLX cache cap.

    Do **not** register mflux ``MemorySaver``. That callback sets ``text_encoder`` /
    ``transformer`` to ``None`` after the first encode/denoise pass. That is fine for a
    one-shot CLI process, but breaks pantry serve (and our Metal cold-start retry) because
    the next ``generate_image`` hits ``TypeError: 'NoneType' object is not callable``.
    """
    try:
        import mlx.core as mx
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


def _is_metal_timeout(exc: BaseException) -> bool:
    text = str(exc)
    return (
        "GPU Timeout" in text
        or "kIOGPUCommandBuffer" in text
        or "Command buffer execution failed" in text
    )


def _metal_timeout_hint(exc: BaseException) -> str | None:
    if not _is_metal_timeout(exc):
        return None
    swap = _swap_used_gb()
    swap_note = f" Current swap used ≈ {swap:.1f} GB." if swap is not None else ""
    return (
        "Metal GPU timed out (command-buffer watchdog). On Apple Silicon this is often a "
        "cold-start Metal shader compile on the first denoise step (retry usually works), "
        "or unified-memory / swap pressure."
        + swap_note
        + " Unload chat models (`pantry unload`), keep swap near 0, use the pre-quantized "
        "4-bit Z-Image pack, and retry at 512x512 or smaller."
    )


def _clear_mlx_after_timeout() -> None:
    try:
        import gc

        import mlx.core as mx

        mx.clear_cache()
        gc.collect()
    except Exception:  # noqa: BLE001
        pass


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
        seed: int | None = None,
        num_inference_steps: int | None = None,
        guidance: float | None = None,
        negative_prompt: str | None = None,
        **kwargs: Any,
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
                "width": width,
                "height": height,
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

    def _preflight(self, manifest: PackageManifest, *, model_warm: bool = False) -> None:
        host = _host_ram_gb()
        if host is not None and host + 0.25 < float(manifest.ram_gb_min or 0):
            raise RuntimeError(
                f"package {manifest.id} declares ram_gb_min={manifest.ram_gb_min} GB but "
                f"this Mac reports ~{host:.1f} GB unified memory. Pick a smaller pack "
                f"(or a pre-quantized 4-bit image pack) — forcing the load will thrash "
                f"swap and trip Metal's GPU timeout watchdog."
            )

        # After a successful Z-Image run, macOS often leaves several GB of swap allocated
        # even though the next request would reuse warm weights. Hard-refusing at 2 GB
        # blocks that second Sink generate. Skip when the model is already resident;
        # only refuse cold loads under extreme swap pressure.
        if model_warm:
            return

        swap = _swap_used_gb()
        if swap is not None and swap >= 8.0:
            raise RuntimeError(
                f"refusing cold image load: this Mac already has ~{swap:.1f} GB of swap in use. "
                "Z-Image / FLUX cold-starts are unreliable under that pressure — Metal will "
                "often GPU-timeout while compiling shaders. Free memory first: "
                "`pantry unload`, quit heavy apps, wait for `sysctl vm.swapusage` to drop, "
                "or reboot. Once an image pack is warm (menu bar → Loaded), retries are allowed "
                "even with residual swap."
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
        guidance: float | None = None,
        negative_prompt: str | None = None,
    ) -> list[dict]:
        import time

        self._ensure_cache_env()
        model_key = manifest.id
        cached = self._models.get(model_key)
        model_warm = cached is not None and _mflux_model_intact(cached)
        self._preflight(manifest, model_warm=model_warm)

        width, height = _parse_size(size)
        host = _host_ram_gb()
        # On ≤16–18 GB machines, keep working set within ~1 MP (1024x1024)
        # while STRICTLY preserving the user's requested aspect ratio.
        max_pixels = 1024 * 1024
        total_pixels = width * height
        if host is not None and host <= 18 and total_pixels > max_pixels:
            import math
            scale = math.sqrt(max_pixels / float(total_pixels))
            width = max(64, (int(width * scale) // 16) * 16)
            height = max(64, (int(height * scale) // 16) * 16)

        n = max(1, min(int(n), 4))
        artifacts = self.store.artifacts_dir / manifest.id
        artifacts.mkdir(parents=True, exist_ok=True)
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

                def _load_zimage() -> Any:
                    kwargs: dict[str, Any] = {
                        "model_config": ModelConfig.z_image_turbo(),
                        "quantize": quantize,
                    }
                    if source:
                        kwargs["model_path"] = source
                    return ZImage(**kwargs)

                cached = self._models.get(model_key)
                if cached is not None and not _mflux_model_intact(cached):
                    del self._models[model_key]
                    cached = None
                if cached is None:
                    self._models[model_key] = _load_zimage()

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
                reload_fn = None
                if is_zimage:

                    def reload_fn() -> Any:
                        fresh = _load_zimage()
                        self._models[model_key] = fresh
                        _enable_mflux_low_ram(fresh)
                        return fresh

                img = self._generate_image_with_cold_start_retry(
                    model,
                    seed=current_seed,
                    prompt=prompt,
                    steps=steps,
                    height=height,
                    width=width,
                    guidance=guidance,
                    negative_prompt=negative_prompt,
                    reload_model=reload_fn,
                )
                # Cold-start retry may have replaced a gutted cached model.
                model = self._models.get(model_key, model)
                path = artifacts / f"mflux-{width}x{height}-{int(time.time())}-{i}.png"
                img.save(str(path))
                png_bytes = path.read_bytes()

                item: dict = {
                    "revised_prompt": prompt.strip(),
                    "path": str(path),
                    "width": width,
                    "height": height,
                }
                fmt = (response_format or "b64_json").lower()
                if fmt == "b64_json":
                    item["b64_json"] = base64.b64encode(png_bytes).decode("ascii")
                else:
                    item["url"] = path.as_uri()
                out.append(item)
            # Advertise residency to menu bar / `pantry status` / unload.
            self.store.mark_loaded(manifest.id, pin=False)
            return out
        except Exception as exc:
            hint = _metal_timeout_hint(exc)
            if hint:
                raise RuntimeError(hint) from exc
            raise

    def unload(self, package_id: str | None = None) -> None:
        """Drop cached mflux models so Metal RAM can be reclaimed."""
        if package_id is None:
            self._models.clear()
        else:
            self._models.pop(package_id, None)
        _clear_mlx_after_timeout()

    def has_warm(self, package_id: str) -> bool:
        cached = self._models.get(package_id)
        return cached is not None and _mflux_model_intact(cached)

    def _generate_image_with_cold_start_retry(
        self,
        model: Any,
        *,
        seed: int,
        prompt: str,
        steps: int,
        height: int,
        width: int,
        guidance: float | None = None,
        negative_prompt: str | None = None,
        max_attempts: int = 2,
        reload_model: Any | None = None,
    ) -> Any:
        """Run mflux generate_image, retrying once after a Metal cold-start timeout.

        On 16 GB Apple Silicon the first denoise step often compiles Metal pipelines in one
        long command buffer and trips the GPU watchdog (~5–10s). A second attempt in the
        same process (or next CLI invoke) usually succeeds because the shader cache is warm.

        If a prior MemorySaver (or similar) gutted the model, reload before retrying so we
        do not raise ``TypeError: 'NoneType' object is not callable`` on ``text_encoder``.
        """
        import sys
        import time

        last_exc: BaseException | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                if attempt > 1:
                    _clear_mlx_after_timeout()
                    time.sleep(0.75)
                    print(
                        "Metal cold-start timeout — retrying once with warm shader cache…",
                        file=sys.stderr,
                    )
                    if reload_model is not None and not _mflux_model_intact(model):
                        model = reload_model()
                        print(
                            "Reloaded image model after MemorySaver-style teardown…",
                            file=sys.stderr,
                        )
                elif reload_model is not None and not _mflux_model_intact(model):
                    model = reload_model()
                gen_kwargs: dict[str, Any] = {
                    "seed": seed,
                    "prompt": prompt,
                    "num_inference_steps": steps,
                    "height": height,
                    "width": width,
                }
                if guidance is not None:
                    gen_kwargs["guidance"] = guidance
                if negative_prompt is not None and negative_prompt.strip():
                    gen_kwargs["negative_prompt"] = negative_prompt.strip()
                return model.generate_image(**gen_kwargs)
            except Exception as exc:
                last_exc = exc
                if attempt < max_attempts and _is_metal_timeout(exc):
                    continue
                raise
        assert last_exc is not None
        raise last_exc


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
