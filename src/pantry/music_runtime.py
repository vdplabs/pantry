from __future__ import annotations

"""Music generation helpers (echo scaffold; real MAGNeT later)."""

import base64
import math
import struct
import zlib

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
    """Deterministic short WAV so clients can wire music before MAGNeT weights."""

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
        return [item]


def music_runtime_for(manifest: PackageManifest, store: PackageStore) -> EchoMusicRuntime:
    primary = (manifest.runtime.primary or "").lower()
    if primary in {"echo_music", "echo-music", "echo"}:
        return EchoMusicRuntime(store)
    raise RuntimeError(
        f"music runtime {manifest.runtime.primary!r} is not implemented yet "
        f"(package {manifest.id})"
    )
