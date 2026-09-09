from __future__ import annotations

"""Video generation helpers (OpenCV Echo scaffold and MLX LTX-Video)."""

import base64
import time
import zlib
from pathlib import Path
from typing import Any

import numpy as np

from pantry.schemas import PackageManifest
from pantry.store import PackageStore


def _decode_source_image(raw_img: Any, w: int, h: int) -> Any:
    if not raw_img:
        return None
    import cv2

    try:
        if isinstance(raw_img, str) and raw_img.startswith("data:image"):
            raw_img = raw_img.split(",", 1)[1]
        if isinstance(raw_img, str) and len(raw_img) > 100:
            img_bytes = base64.b64decode(raw_img)
            nparr = np.frombuffer(img_bytes, np.uint8)
            decoded = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        elif isinstance(raw_img, str) and Path(raw_img).is_file():
            decoded = cv2.imread(str(raw_img))
        else:
            decoded = None
        if decoded is not None:
            return cv2.resize(decoded, (w, h))
    except Exception:
        pass
    return None


class EchoVideoRuntime:
    """Deterministic fast H.264/MP4 generation so clients can wire video before model weights."""

    def __init__(self, store: PackageStore) -> None:
        self.store = store

    def generate(
        self,
        manifest: PackageManifest,
        *,
        prompt: str,
        negative_prompt: str = "",
        width: int = 512,
        height: int = 512,
        frames: int = 24,
        fps: int = 24,
        steps: int | None = None,
        guidance: float | None = None,
        seed: int | None = None,
        response_format: str = "b64_json",
        **kwargs: Any,
    ) -> list[dict]:
        import cv2

        w = max(128, min(int(width), 1920))
        h = max(128, min(int(height), 1920))
        n_frames = max(8, min(int(frames), 480))
        rate = max(1, min(int(fps), 60))

        image = kwargs.get("image")
        include_audio = bool(kwargs.get("include_audio", False))
        source_bgr = _decode_source_image(image, w, h)
        image_strength = float(kwargs.get("image_strength", 1.0))

        # Consistent hue base derived from prompt
        digest = zlib.adler32((prompt or "pantry").encode("utf-8")) & 0xFFFFFFFF
        hue_base = (digest % 180)

        artifacts = self.store.artifacts_dir / manifest.id
        artifacts.mkdir(parents=True, exist_ok=True)
        ts = int(time.time() * 1000)
        path = artifacts / f"gen-{ts}-{w}x{h}-{n_frames}f.mp4"
        print(f"[pantry.video] Generating echo video frames ({w}x{h}, {n_frames} frames @ {rate}fps)...", flush=True)

        # Try native Apple H.264 fourcc first (avc1), falling back to mp4v
        fourcc = cv2.VideoWriter_fourcc(*"avc1")
        writer = cv2.VideoWriter(str(path), fourcc, float(rate), (w, h))
        if not writer.isOpened():
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(str(path), fourcc, float(rate), (w, h))

        if not writer.isOpened():
            raise RuntimeError("Failed to open OpenCV VideoWriter for MP4 output")

        y_grad = np.linspace(80, 220, h, dtype=np.uint8)[:, None]

        for i in range(n_frames):
            t = i / max(1, n_frames - 1)
            # Dynamic HSV gradient
            hsv = np.zeros((h, w, 3), dtype=np.uint8)
            hsv[:, :, 0] = int(hue_base + t * 40) % 180
            hsv[:, :, 1] = 160
            hsv[:, :, 2] = y_grad
            bgr = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)

            # Draw moving glowing orb
            cx = int(w * (0.35 + 0.3 * np.sin(t * np.pi * 2)))
            cy = int(h * (0.45 + 0.15 * np.cos(t * np.pi * 2)))
            radius = max(12, min(w, h) // 10)
            cv2.circle(bgr, (cx, cy), radius + 6, (220, 240, 255), 2, cv2.LINE_AA)
            cv2.circle(bgr, (cx, cy), radius, (255, 255, 255), -1, cv2.LINE_AA)

            if source_bgr is not None:
                scale = 1.0 + 0.08 * t
                M = cv2.getRotationMatrix2D((w / 2, h / 2), 0, scale)
                zoomed = cv2.warpAffine(source_bgr, M, (w, h))
                blend = max(0.0, min(1.0, (1.0 - t * 0.45) * image_strength))
                bgr = cv2.addWeighted(zoomed, blend, bgr, 1.0 - blend, 0)

            # Prompt overlay
            badge = "Pantry Video · Echo I2V" if source_bgr is not None else "Pantry Video · Echo"
            cv2.putText(
                bgr,
                badge,
                (24, h - 42),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )
            cv2.putText(
                bgr,
                prompt[:50],
                (24, h - 18),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                (220, 220, 220),
                1,
                cv2.LINE_AA,
            )
            writer.write(bgr)

        writer.release()
        print(f"[pantry.video] Echo video generated: {path} ({path.stat().st_size / 1024:.1f} KB)", flush=True)

        raw_bytes = path.read_bytes()
        duration_seconds = round(n_frames / rate, 2)

        item: dict[str, Any] = {
            "revised_prompt": f"[pantry echo_video · {manifest.id}] {prompt.strip()[:200]}",
            "path": str(path),
            "format": "mp4",
            "width": w,
            "height": h,
            "frames": n_frames,
            "fps": rate,
            "duration_seconds": duration_seconds,
            "has_source_image": bool(image),
            "has_audio": bool(include_audio),
        }

        fmt = (response_format or "b64_json").lower()
        if fmt == "b64_json":
            item["b64_json"] = base64.b64encode(raw_bytes).decode("ascii")
        else:
            item["url"] = path.as_uri()

        # Advertise residency to menu bar / `pantry status` / unload.
        self.store.mark_loaded(manifest.id, pin=False)
        return [item]


_shared_echo_video_runtime: EchoVideoRuntime | None = None
_shared_ltx_video_runtime: LTXVideoRuntime | None = None


def _is_mock_weights(path: Path | None) -> bool:
    if path is None or not path.is_dir():
        return True
    safetensors = list(path.glob("**/*.safetensors"))
    if not safetensors:
        return True
    total_size = sum(f.stat().st_size for f in safetensors)
    return total_size < 50 * 1024 * 1024


def _write_frames_mp4(frames: list[Any] | np.ndarray, path: Path, fps: int, w: int, h: int) -> None:
    import cv2

    fourcc = cv2.VideoWriter_fourcc(*"avc1")
    writer = cv2.VideoWriter(str(path), fourcc, float(fps), (w, h))
    if not writer.isOpened():
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(path), fourcc, float(fps), (w, h))
    if not writer.isOpened():
        raise RuntimeError("Failed to open OpenCV VideoWriter for MP4 output")

    for frame in frames:
        if hasattr(frame, "convert"):  # PIL.Image
            arr = np.array(frame.convert("RGB"))
            bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        elif isinstance(frame, np.ndarray):
            if frame.dtype != np.uint8:
                arr = (np.clip(frame, 0.0, 1.0) * 255.0).astype(np.uint8)
            else:
                arr = frame
            bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR) if arr.shape[-1] == 3 else arr
        else:
            raise ValueError(f"Unsupported frame type: {type(frame)}")
        writer.write(bgr)
    writer.release()


class LTXVideoRuntime:
    """Standard video runtime for LTX-Video (2B) on Apple Silicon."""

    def __init__(self, store: PackageStore) -> None:
        self.store = store
        self._pipe: Any = None
        self._loaded_path: str | None = None

    def unload(self, package_id: str | None = None) -> None:
        """Drop cached diffusion pipeline so Metal / MPS RAM can be reclaimed."""
        import gc

        self._pipe = None
        self._loaded_path = None
        gc.collect()
        try:
            import torch

            if hasattr(torch, "backends") and hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                if hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
                    torch.mps.empty_cache()
        except Exception:
            pass
        if package_id:
            self.store.mark_unloaded(package_id)

    def _generate_mock(
        self,
        manifest: PackageManifest,
        prompt: str,
        w: int,
        h: int,
        n_frames: int,
        rate: int,
        seed: int | None,
        path: Path,
        image: str | None = None,
        image_strength: float = 1.0,
    ) -> None:
        import cv2

        source_bgr = _decode_source_image(image, w, h)

        digest = zlib.adler32((prompt or "pantry").encode("utf-8")) & 0xFFFFFFFF
        if seed is not None:
            digest = (digest ^ int(seed)) & 0xFFFFFFFF

        rng = np.random.default_rng(digest)
        hue_base = (digest % 180)

        fourcc = cv2.VideoWriter_fourcc(*"avc1")
        writer = cv2.VideoWriter(str(path), fourcc, float(rate), (w, h))
        if not writer.isOpened():
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(str(path), fourcc, float(rate), (w, h))

        if not writer.isOpened():
            raise RuntimeError("Failed to open OpenCV VideoWriter for MP4 output")

        num_particles = 120
        particles_x = rng.uniform(0, w, num_particles)
        particles_y = rng.uniform(0, h, num_particles)
        particles_speed = rng.uniform(1.5, 4.0, num_particles)
        particles_size = rng.integers(3, 9, num_particles)

        y_grad = np.linspace(30, 200, h, dtype=np.uint8)[:, None]

        for i in range(n_frames):
            t = i / max(1, n_frames - 1)
            hsv = np.zeros((h, w, 3), dtype=np.uint8)
            hsv[:, :, 0] = int(hue_base + t * 60) % 180
            hsv[:, :, 1] = int(140 + 40 * np.sin(t * np.pi))
            hsv[:, :, 2] = y_grad
            bgr = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)

            for p_idx in range(num_particles):
                particles_x[p_idx] = (particles_x[p_idx] + particles_speed[p_idx] * np.cos(t * np.pi * 2 + p_idx)) % w
                particles_y[p_idx] = (particles_y[p_idx] + particles_speed[p_idx] * np.sin(t * np.pi * 2 + p_idx * 0.5)) % h
                px = int(particles_x[p_idx])
                py = int(particles_y[p_idx])
                sz = int(particles_size[p_idx])
                cv2.circle(bgr, (px, py), sz, (240, 245, 255), -1, cv2.LINE_AA)

            cx = int(w * (0.5 + 0.25 * np.sin(t * np.pi * 2)))
            cy = int(h * (0.5 + 0.15 * np.cos(t * np.pi * 2)))
            radius = max(16, min(w, h) // 8)
            cv2.circle(bgr, (cx, cy), radius + 8, (180, 220, 255), 2, cv2.LINE_AA)
            cv2.circle(bgr, (cx, cy), radius, (255, 255, 255), -1, cv2.LINE_AA)

            if source_bgr is not None:
                scale = 1.0 + 0.06 * t
                M = cv2.getRotationMatrix2D((w / 2, h / 2), 0, scale)
                zoomed = cv2.warpAffine(source_bgr, M, (w, h))
                blend = max(0.0, min(1.0, (1.0 - t * 0.4) * image_strength))
                bgr = cv2.addWeighted(zoomed, blend, bgr, 1.0 - blend, 0)

            badge = "Pantry Video · LTX-Video I2V" if source_bgr is not None else "Pantry Video · LTX-Video (2B Mock)"
            cv2.putText(
                bgr,
                badge,
                (24, h - 42),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )
            cv2.putText(
                bgr,
                prompt[:60],
                (24, h - 18),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                (220, 220, 220),
                1,
                cv2.LINE_AA,
            )
            writer.write(bgr)

        writer.release()

    def _generate_neural(
        self,
        *,
        weights_path: Path,
        prompt: str,
        negative_prompt: str,
        w: int,
        h: int,
        n_frames: int,
        rate: int,
        steps: int | None,
        guidance: float | None,
        seed: int | None,
        path: Path,
        image: str | None = None,
        image_strength: float = 1.0,
    ) -> None:
        import torch
        from diffusers import LTXPipeline, LTXImageToVideoPipeline
        from PIL import Image
        import cv2

        num_steps = int(steps) if steps and steps > 0 else 25
        cfg_guidance = float(guidance) if guidance and guidance > 0 else 3.0
        neg = negative_prompt or "worst quality, inconsistent motion, blurry, jittery, distorted"

        source_bgr = _decode_source_image(image, w, h)
        pil_image = None
        if source_bgr is not None:
            pil_image = Image.fromarray(cv2.cvtColor(source_bgr, cv2.COLOR_BGR2RGB))

        device = "mps" if torch.backends.mps.is_available() else "cpu"
        target_pipeline = LTXImageToVideoPipeline if pil_image is not None else LTXPipeline

        if self._pipe is None or self._loaded_path != str(weights_path) or not isinstance(self._pipe, target_pipeline):
            print(f"[pantry.video] Initializing {target_pipeline.__name__} from {weights_path}...", flush=True)
            if (weights_path / "model_index.json").is_file():
                pipe = target_pipeline.from_pretrained(
                    str(weights_path),
                    torch_dtype=torch.bfloat16,
                )
            else:
                safetensors = sorted(
                    [f for f in weights_path.glob("*.safetensors") if f.stat().st_size > 100 * 1024 * 1024],
                    key=lambda f: f.stat().st_size,
                )
                preferred = None
                for cand_name in ("ltx-video-2b-v0.9.5.safetensors", "ltx-video-2b-v0.9.1.safetensors", "ltx-video-2b-v0.9.safetensors"):
                    c_path = weights_path / cand_name
                    if c_path.is_file():
                        preferred = c_path
                        break
                st_target = preferred or (safetensors[0] if safetensors else None)
                if st_target and hasattr(target_pipeline, "from_single_file"):
                    print(f"[pantry.video] Loading single checkpoint: {st_target.name}...", flush=True)
                    text_encoder = None
                    try:
                        from transformers import T5EncoderModel
                        snap = self.store.find_hf_snapshot("Lightricks/LTX-Video")
                        te_src = str(snap / "text_encoder") if (snap and (snap / "text_encoder").is_dir()) else "Lightricks/LTX-Video"
                        text_encoder = T5EncoderModel.from_pretrained(
                            te_src,
                            subfolder="text_encoder" if te_src == "Lightricks/LTX-Video" else None,
                            torch_dtype=torch.bfloat16,
                        )
                    except Exception as te_err:
                        print(f"[pantry.video] Note: text_encoder auto-load: {te_err}", flush=True)

                    single_file_kwargs: dict[str, Any] = {"torch_dtype": torch.bfloat16}
                    if text_encoder is not None:
                        single_file_kwargs["text_encoder"] = text_encoder
                    pipe = target_pipeline.from_single_file(
                        str(st_target),
                        **single_file_kwargs,
                    )
                else:
                    pipe = target_pipeline.from_pretrained(
                        str(weights_path),
                        torch_dtype=torch.bfloat16,
                    )
            try:
                pipe.enable_model_cpu_offload(device=device)
            except Exception:
                pipe.to(device)
            self._pipe = pipe
            self._loaded_path = str(weights_path)
            print(f"[pantry.video] Model successfully loaded on device: {device}", flush=True)

        generator = torch.Generator(device="cpu")
        if seed is not None:
            generator.manual_seed(int(seed))

        call_kwargs: dict[str, Any] = {
            "prompt": prompt,
            "negative_prompt": neg,
            "width": w,
            "height": h,
            "num_frames": n_frames,
            "frame_rate": rate,
            "num_inference_steps": num_steps,
            "guidance_scale": cfg_guidance,
            "generator": generator,
            "output_type": "np",
        }
        if pil_image is not None:
            call_kwargs["image"] = pil_image

        print(f"[pantry.video] Running diffusion pipeline ({num_steps} steps, cfg={cfg_guidance}, {w}x{h}, {n_frames} frames @ {rate}fps)...", flush=True)
        t_gen0 = time.time()
        output = self._pipe(**call_kwargs)
        t_gen_elapsed = round(time.time() - t_gen0, 2)
        print(f"[pantry.video] Diffusion inference completed in {t_gen_elapsed}s", flush=True)

        frames = output.frames[0]
        print(f"[pantry.video] Encoding {len(frames)} frames to MP4: {path}...", flush=True)
        _write_frames_mp4(frames, path, fps=rate, w=w, h=h)
        print(f"[pantry.video] Video successfully saved ({path.stat().st_size / 1024 / 1024:.2f} MB)", flush=True)

    def generate(
        self,
        manifest: PackageManifest,
        *,
        prompt: str,
        negative_prompt: str = "",
        width: int = 768,
        height: int = 512,
        frames: int = 24,
        fps: int = 24,
        steps: int | None = None,
        guidance: float | None = None,
        seed: int | None = None,
        response_format: str = "b64_json",
        image: str | None = None,
        image_strength: float = 1.0,
        include_audio: bool = False,
        **kwargs: Any,
    ) -> list[dict]:
        w = max(128, min(int(width), 1920))
        h = max(128, min(int(height), 1920))
        # Ensure dimensions are divisible by 32
        w = (w // 32) * 32
        h = (h // 32) * 32

        # LTX-Video temporal frame count: 8k + 1 (supports up to 481 frames / 20s+ cinema)
        raw_frames = max(9, min(int(frames), 481))
        k = max(1, round((raw_frames - 1) / 8))
        n_frames = k * 8 + 1
        rate = max(1, min(int(fps), 60))

        artifacts = self.store.artifacts_dir / manifest.id
        artifacts.mkdir(parents=True, exist_ok=True)
        ts = int(time.time() * 1000)
        prefix = "ltx-i2v" if image else "ltx"
        path = artifacts / f"{prefix}-{ts}-{w}x{h}-{n_frames}f.mp4"

        weights_path = self.store.resolve_weights_path(manifest)

        if _is_mock_weights(weights_path):
            print(f"[pantry.video] Note: weights not found or mock weights in {weights_path}; generating synthetic demo frames...", flush=True)
            self._generate_mock(
                manifest=manifest,
                prompt=prompt,
                w=w,
                h=h,
                n_frames=n_frames,
                rate=rate,
                seed=seed,
                path=path,
                image=image,
                image_strength=image_strength,
            )
        else:
            print(f"[pantry.video] Synthesizing video using weights from: {weights_path}...", flush=True)
            self._generate_neural(
                weights_path=weights_path,  # type: ignore[arg-type]
                prompt=prompt,
                negative_prompt=negative_prompt,
                w=w,
                h=h,
                n_frames=n_frames,
                rate=rate,
                steps=steps,
                guidance=guidance,
                seed=seed,
                path=path,
                image=image,
                image_strength=image_strength,
            )

        raw_bytes = path.read_bytes()
        duration_seconds = round(n_frames / rate, 2)

        item: dict[str, Any] = {
            "revised_prompt": f"[pantry ltx_video · {manifest.id}] {prompt.strip()[:200]}",
            "path": str(path),
            "format": "mp4",
            "width": w,
            "height": h,
            "frames": n_frames,
            "fps": rate,
            "duration_seconds": duration_seconds,
            "has_source_image": bool(image),
            "has_audio": bool(include_audio),
        }

        fmt = (response_format or "b64_json").lower()
        if fmt == "b64_json":
            item["b64_json"] = base64.b64encode(raw_bytes).decode("ascii")
        else:
            item["url"] = path.as_uri()

        # Advertise residency to menu bar / `pantry status` / unload.
        self.store.mark_loaded(manifest.id, pin=False)
        return [item]


def video_runtime_for(manifest: PackageManifest, store: PackageStore) -> Any:
    global _shared_echo_video_runtime, _shared_ltx_video_runtime
    primary = (manifest.runtime.primary or "echo").lower()
    if primary in {"ltx", "ltx_video", "ltx-video", "mlx_video", "ltx_video_q4", "ltx_video_av", "ltx-video-q4", "ltx-video-av"} or manifest.family == "ltx-video":
        if _shared_ltx_video_runtime is None or _shared_ltx_video_runtime.store != store:
            _shared_ltx_video_runtime = LTXVideoRuntime(store)
        return _shared_ltx_video_runtime

    if _shared_echo_video_runtime is None or _shared_echo_video_runtime.store != store:
        _shared_echo_video_runtime = EchoVideoRuntime(store)
    return _shared_echo_video_runtime
