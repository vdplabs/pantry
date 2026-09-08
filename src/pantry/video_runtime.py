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


class EchoVideoRuntime:
    """Deterministic fast H.264/MP4 generation so clients can wire video before model weights."""

    def __init__(self, store: PackageStore) -> None:
        self.store = store

    def generate(
        self,
        manifest: PackageManifest,
        *,
        prompt: str,
        width: int = 512,
        height: int = 512,
        frames: int = 24,
        fps: int = 24,
        seed: int | None = None,
        response_format: str = "b64_json",
    ) -> list[dict]:
        import cv2

        w = max(128, min(int(width), 1920))
        h = max(128, min(int(height), 1920))
        n_frames = max(8, min(int(frames), 128))
        rate = max(8, min(int(fps), 60))

        # Consistent hue base derived from prompt
        digest = zlib.adler32((prompt or "pantry").encode("utf-8")) & 0xFFFFFFFF
        hue_base = (digest % 180)

        artifacts = self.store.artifacts_dir / manifest.id
        artifacts.mkdir(parents=True, exist_ok=True)
        ts = int(time.time() * 1000)
        path = artifacts / f"gen-{ts}-{w}x{h}-{n_frames}f.mp4"

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

            # Prompt overlay
            cv2.putText(
                bgr,
                "Pantry Video · Echo",
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
        }

        fmt = (response_format or "b64_json").lower()
        if fmt == "b64_json":
            item["b64_json"] = base64.b64encode(raw_bytes).decode("ascii")
        else:
            item["url"] = path.as_uri()

        return [item]


_shared_echo_video_runtime: EchoVideoRuntime | None = None


def video_runtime_for(manifest: PackageManifest, store: PackageStore) -> Any:
    global _shared_echo_video_runtime
    if _shared_echo_video_runtime is None or _shared_echo_video_runtime.store != store:
        _shared_echo_video_runtime = EchoVideoRuntime(store)
    return _shared_echo_video_runtime
