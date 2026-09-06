from __future__ import annotations

import hashlib
import json
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Iterator

# FastCDC Gear Table (256 deterministic 64-bit integers for rolling hash)
GEAR_TABLE: list[int] = [
    struct.unpack("<Q", hashlib.sha256(f"pantry_fastcdc_gear_{i}".encode("utf-8")).digest()[:8])[0]
    for i in range(256)
]


@dataclass(frozen=True)
class ChunkSpec:
    name: str
    offset: int
    length: int
    sha256: str


def compute_chunk_sha256(f: BinaryIO, offset: int, length: int) -> str:
    """Compute SHA-256 for a byte slice in a seekable binary file."""
    f.seek(offset)
    hasher = hashlib.sha256()
    remaining = length
    chunk_size = 1024 * 1024  # 1 MB buffer
    while remaining > 0:
        to_read = min(remaining, chunk_size)
        data = f.read(to_read)
        if not data:
            break
        hasher.update(data)
        remaining -= len(data)
    return hasher.hexdigest()


class SafetensorsChunker:
    """Inspects Safetensors header and divides tensors into boundary chunks."""

    COARSE_TENSOR_MIN_BYTES = 2 * 1024 * 1024  # 2 MB
    MAX_COALESCED_BYTES = 4 * 1024 * 1024       # 4 MB

    @classmethod
    def can_chunk(cls, path: Path) -> bool:
        if not path.is_file() or path.stat().st_size < 16:
            return False
        if not path.name.endswith(".safetensors"):
            return False
        try:
            with path.open("rb") as f:
                header_len_bytes = f.read(8)
                if len(header_len_bytes) < 8:
                    return False
                header_len = struct.unpack("<Q", header_len_bytes)[0]
                return 0 < header_len < (100 * 1024 * 1024)
        except Exception:
            return False

    @classmethod
    def chunk(cls, path: Path) -> list[ChunkSpec]:
        file_size = path.stat().st_size
        with path.open("rb") as f:
            header_len_bytes = f.read(8)
            header_len = struct.unpack("<Q", header_len_bytes)[0]
            header_json_bytes = f.read(header_len)
            header_data = json.loads(header_json_bytes.decode("utf-8"))

            data_start = 8 + header_len
            chunks: list[ChunkSpec] = []

            # Chunk 0: The header itself
            header_sha = compute_chunk_sha256(f, 0, data_start)
            chunks.append(
                ChunkSpec(
                    name="__header__",
                    offset=0,
                    length=data_start,
                    sha256=header_sha,
                )
            )

            # Sort tensors by start offset
            tensors: list[tuple[str, int, int]] = []
            for t_name, t_info in header_data.items():
                if t_name == "__metadata__" or not isinstance(t_info, dict):
                    continue
                offsets = t_info.get("data_offsets")
                if offsets and len(offsets) == 2:
                    t_start = data_start + offsets[0]
                    t_end = data_start + offsets[1]
                    t_len = t_end - t_start
                    tensors.append((t_name, t_start, t_len))

            tensors.sort(key=lambda x: x[1])

            # Group into coarse tensors (>= 2MB) or coalesced clusters (< 2MB)
            idx = 0
            while idx < len(tensors):
                name, offset, length = tensors[idx]
                if length >= cls.COARSE_TENSOR_MIN_BYTES:
                    c_sha = compute_chunk_sha256(f, offset, length)
                    chunks.append(
                        ChunkSpec(
                            name=name,
                            offset=offset,
                            length=length,
                            sha256=c_sha,
                        )
                    )
                    idx += 1
                else:
                    # Coalesce adjacent small tensors up to MAX_COALESCED_BYTES
                    c_start = offset
                    c_len = length
                    first_name = name
                    last_name = name
                    idx += 1
                    while idx < len(tensors):
                        next_name, next_offset, next_len = tensors[idx]
                        if next_len >= cls.COARSE_TENSOR_MIN_BYTES:
                            break
                        if (c_len + next_len) > cls.MAX_COALESCED_BYTES:
                            break
                        c_len += next_len
                        last_name = next_name
                        idx += 1

                    cluster_name = f"{first_name}..{last_name}" if first_name != last_name else first_name
                    c_sha = compute_chunk_sha256(f, c_start, c_len)
                    chunks.append(
                        ChunkSpec(
                            name=cluster_name,
                            offset=c_start,
                            length=c_len,
                            sha256=c_sha,
                        )
                    )

            # Handle trailing bytes if any
            total_chunked = chunks[-1].offset + chunks[-1].length if chunks else 0
            if total_chunked < file_size:
                tail_len = file_size - total_chunked
                tail_sha = compute_chunk_sha256(f, total_chunked, tail_len)
                chunks.append(
                    ChunkSpec(
                        name="__tail__",
                        offset=total_chunked,
                        length=tail_len,
                        sha256=tail_sha,
                    )
                )

            return chunks


class FastCDCChunker:
    """Content-Defined Chunking using FastCDC rolling gear hash."""

    def __init__(
        self,
        min_size: int = 1024 * 1024,      # 1 MB
        avg_size: int = 4 * 1024 * 1024,  # 4 MB
        max_size: int = 8 * 1024 * 1024,  # 8 MB
    ) -> None:
        self.min_size = min_size
        self.avg_size = avg_size
        self.max_size = max_size
        # Mask calculation for target average cut interval within search window
        target_search = max(1024, avg_size - min_size)
        bits = max(1, target_search.bit_length() - 1)
        self.mask = (1 << bits) - 1

    def chunk(self, path: Path) -> list[ChunkSpec]:
        file_size = path.stat().st_size
        if file_size == 0:
            return []

        # If file is smaller than min_size, treat entire file as single chunk
        if file_size <= self.min_size:
            with path.open("rb") as f:
                sha = compute_chunk_sha256(f, 0, file_size)
            return [
                ChunkSpec(
                    name=path.name,
                    offset=0,
                    length=file_size,
                    sha256=sha,
                )
            ]

        chunks: list[ChunkSpec] = []
        offset = 0
        buf_size = 2 * 1024 * 1024  # 2 MB read buffer
        gear = GEAR_TABLE

        with path.open("rb") as f:
            while offset < file_size:
                remaining = file_size - offset
                if remaining <= self.min_size:
                    sha = compute_chunk_sha256(f, offset, remaining)
                    chunks.append(
                        ChunkSpec(
                            name=f"chunk_{len(chunks)}",
                            offset=offset,
                            length=remaining,
                            sha256=sha,
                        )
                    )
                    break

                target_max = min(remaining, self.max_size)
                # FastCDC cut point search
                f.seek(offset + self.min_size)
                search_len = target_max - self.min_size
                fingerprint = 0
                cut_offset = target_max  # Default to max_size if no cut point found

                bytes_scanned = 0
                found_cut = False
                while bytes_scanned < search_len and not found_cut:
                    chunk_to_read = min(search_len - bytes_scanned, buf_size)
                    buf = f.read(chunk_to_read)
                    if not buf:
                        break
                    for b in buf:
                        fingerprint = ((fingerprint << 1) + gear[b]) & 0xFFFFFFFFFFFFFFFF
                        bytes_scanned += 1
                        if (fingerprint & self.mask) == 0:
                            cut_offset = self.min_size + bytes_scanned
                            found_cut = True
                            break

                chunk_len = cut_offset
                sha = compute_chunk_sha256(f, offset, chunk_len)
                chunks.append(
                    ChunkSpec(
                        name=f"chunk_{len(chunks)}",
                        offset=offset,
                        length=chunk_len,
                        sha256=sha,
                    )
                )
                offset += chunk_len

        return chunks


class ModelChunker:
    """Unified chunker facade choosing Safetensors or FastCDC."""

    @classmethod
    def chunk_file(cls, path: Path) -> list[ChunkSpec]:
        if SafetensorsChunker.can_chunk(path):
            return SafetensorsChunker.chunk(path)

        file_size = path.stat().st_size
        if file_size < 2 * 1024 * 1024:
            # Small files (config.json, tokenizer.json, vocabs): smaller CDC window
            chunker = FastCDCChunker(
                min_size=256 * 1024,
                avg_size=1024 * 1024,
                max_size=2 * 1024 * 1024,
            )
        else:
            chunker = FastCDCChunker(
                min_size=1024 * 1024,
                avg_size=4 * 1024 * 1024,
                max_size=8 * 1024 * 1024,
            )
        return chunker.chunk(path)
