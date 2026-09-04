from __future__ import annotations

"""Image generation helpers (echo scaffold; real Diffusers/Z-Image later)."""

import base64
import struct
import zlib
from pathlib import Path

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


def image_runtime_for(manifest: PackageManifest, store: PackageStore) -> EchoImageRuntime:
    primary = (manifest.runtime.primary or "").lower()
    if primary in {"echo_image", "echo-image", "echo"}:
        return EchoImageRuntime(store)
    raise RuntimeError(
        f"image runtime {manifest.runtime.primary!r} is not implemented yet "
        f"(package {manifest.id})"
    )
