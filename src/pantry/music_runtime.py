from __future__ import annotations

"""Music generation helpers (MLX MusicGen / MAGNeT and Echo scaffold)."""

import base64
import math
import struct
import time
import zlib
from pathlib import Path
from typing import Any

from pantry.schemas import PackageManifest
from pantry.store import PackageStore


def _freq_from_prompt(prompt: str) -> float:
    digest = zlib.adler32(prompt.encode("utf-8")) & 0xFFFFFFFF
    # Musical-ish range ~220–880 Hz
    return 220.0 + (digest % 661)


def _pcm16_sine(*, seconds: float, sample_rate: int, freq_hz: float) -> bytes:
    n = max(1, int(seconds * sample_rate))
    frames = bytearray()
    for i in range(n):
        t = i / sample_rate
        # Soft envelope so the clip doesn't click.
        env = min(1.0, i / (0.02 * sample_rate), (n - i) / (0.02 * sample_rate))
        sample = int(16000 * env * math.sin(2.0 * math.pi * freq_hz * t))
        frames.extend(struct.pack("<h", max(-32767, min(32767, sample))))
    return bytes(frames)


def _wav_bytes(pcm: bytes, *, sample_rate: int, channels: int = 1) -> bytes:
    byte_rate = sample_rate * channels * 2
    block_align = channels * 2
    data_size = len(pcm)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,
        1,  # PCM
        channels,
        sample_rate,
        byte_rate,
        block_align,
        16,
        b"data",
        data_size,
    )
    return header + pcm


class EchoMusicRuntime:
    """Deterministic short WAV so clients can wire music before model weights."""

    def __init__(self, store: PackageStore) -> None:
        self.store = store

    def generate(
        self,
        manifest: PackageManifest,
        *,
        prompt: str,
        duration_seconds: float = 2.0,
        response_format: str = "b64_json",
    ) -> list[dict]:
        seconds = max(0.25, min(float(duration_seconds), 8.0))
        sample_rate = 16_000
        freq = _freq_from_prompt(prompt.strip() or "pantry")
        pcm = _pcm16_sine(seconds=seconds, sample_rate=sample_rate, freq_hz=freq)
        wav = _wav_bytes(pcm, sample_rate=sample_rate)

        artifacts = self.store.artifacts_dir / manifest.id
        artifacts.mkdir(parents=True, exist_ok=True)
        path = artifacts / f"echo-{int(seconds * 1000)}ms.wav"
        path.write_bytes(wav)

        item: dict = {
            "revised_prompt": (
                f"[pantry echo_music · {manifest.id} · {freq:.1f}Hz] "
                f"{prompt.strip()[:200]}"
            ),
            "path": str(path),
            "format": "wav",
            "sample_rate": sample_rate,
            "duration_seconds": seconds,
        }
        fmt = (response_format or "b64_json").lower()
        if fmt == "b64_json":
            item["b64_json"] = base64.b64encode(wav).decode("ascii")
        else:
            item["url"] = path.as_uri()

        # Advertise residency to menu bar / `pantry status` / unload.
        self.store.mark_loaded(manifest.id, pin=False)
        return [item]


class MLXMusicRuntime:
    """Native Apple Silicon MLX music generation runtime (MusicGen / MAGNeT)."""

    def __init__(self, store: PackageStore) -> None:
        self.store = store
        self._pipeline: Any = None
        self._loaded_package_id: str | None = None

    def unload(self, package_id: str | None = None) -> None:
        if package_id is None or self._loaded_package_id == package_id:
            self._pipeline = None
            self._loaded_package_id = None
            try:
                import mlx.core as mx

                mx.clear_cache()
            except Exception:
                pass
        if package_id:
            self.store.mark_unloaded(package_id)

    def _load_pipeline(self, manifest: PackageManifest) -> Any:
        if self._pipeline is not None and self._loaded_package_id == manifest.id:
            return self._pipeline

        try:
            from mlx_audiogen.models.musicgen import MusicGenPipeline
        except ImportError as exc:
            raise RuntimeError(
                "mlx-audiogen is required for real MLX music generation on Apple Silicon. "
                "Install with: pip install mlx-audiogen"
            ) from exc

        # Determine weights location
        weights_dir: str = "musicgen-small"
        resolved = self.store.resolve_weights_path(manifest)
        if resolved and resolved.is_dir() and (resolved / "decoder.safetensors").is_file():
            weights_dir = str(resolved)
        elif manifest.runtime.hf_repo and "musicgen" in manifest.runtime.hf_repo.lower():
            weights_dir = manifest.runtime.hf_repo

        pipe = MusicGenPipeline.from_pretrained(weights_dir=weights_dir)
        self._pipeline = pipe
        self._loaded_package_id = manifest.id
        return pipe

    def generate(
        self,
        manifest: PackageManifest,
        *,
        prompt: str,
        duration_seconds: float = 5.0,
        response_format: str = "b64_json",
    ) -> list[dict]:
        pipe = self._load_pipeline(manifest)
        seconds = max(0.5, min(float(duration_seconds), 30.0))

        # Generate audio using MLX
        audio_samples = pipe.generate(prompt=prompt, seconds=seconds)
        sample_rate = int(getattr(pipe, "sample_rate", 32000))

        # Convert float audio samples (-1.0 to 1.0) to 16-bit PCM WAV
        import numpy as np

        audio_clamped = np.clip(audio_samples, -1.0, 1.0)
        pcm16 = (audio_clamped * 32767).astype(np.int16).tobytes()
        wav = _wav_bytes(pcm16, sample_rate=sample_rate)

        artifacts = self.store.artifacts_dir / manifest.id
        artifacts.mkdir(parents=True, exist_ok=True)
        ts = int(time.time() * 1000)
        path = artifacts / f"gen-{ts}-{int(seconds * 1000)}ms.wav"
        path.write_bytes(wav)

        item: dict = {
            "revised_prompt": f"[pantry mlx_music · {manifest.id}] {prompt.strip()[:200]}",
            "path": str(path),
            "format": "wav",
            "sample_rate": sample_rate,
            "duration_seconds": seconds,
        }
        fmt = (response_format or "b64_json").lower()
        if fmt == "b64_json":
            item["b64_json"] = base64.b64encode(wav).decode("ascii")
        else:
            item["url"] = path.as_uri()

        # Advertise residency to menu bar / `pantry status` / unload.
        self.store.mark_loaded(manifest.id, pin=False)
        return [item]


_shared_mlx_music_runtime: MLXMusicRuntime | None = None


def music_runtime_for(manifest: PackageManifest, store: PackageStore) -> Any:
    primary = (manifest.runtime.primary or "").lower()
    if primary in {"echo_music", "echo-music", "echo"}:
        return EchoMusicRuntime(store)

    global _shared_mlx_music_runtime
    if _shared_mlx_music_runtime is None or _shared_mlx_music_runtime.store != store:
        _shared_mlx_music_runtime = MLXMusicRuntime(store)
    return _shared_mlx_music_runtime
