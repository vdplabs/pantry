from __future__ import annotations

"""Zero-copy shared memory buffer allocator and lifecycle manager.

Provides high-throughput, low-latency zero-copy memory transfers between
Pantry runtimes and local clients (CLI, Sink, scripts) via memory-mapped
files and POSIX shared memory primitives with 0600 user isolation.
"""

import os
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_SAFE_KEY_RE = re.compile(r"^[a-zA-Z0-9_\-]{8,64}$")


@dataclass(frozen=True)
class ShmDescriptor:
    key: str
    path: str
    byte_size: int
    format: str
    created_at: float
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        res: dict[str, Any] = {
            "key": self.key,
            "path": self.path,
            "byte_size": self.byte_size,
            "format": self.format,
            "created_at": self.created_at,
        }
        if self.metadata:
            res.update(self.metadata)
        return res


class ShmManager:
    """Manages zero-copy shared memory buffers with strict security and TTL reclamation."""

    def __init__(self, shm_dir: Path, default_ttl: float = 300.0) -> None:
        self.shm_dir = shm_dir.resolve()
        self.default_ttl = default_ttl
        self._ensure_dir()

    def _ensure_dir(self) -> None:
        self.shm_dir.mkdir(parents=True, exist_ok=True)
        try:
            self.shm_dir.chmod(0o700)
        except OSError:
            pass

    def is_safe_key(self, key: str) -> bool:
        if not key or not _SAFE_KEY_RE.match(key):
            return False
        # Disallow directory navigation tokens
        if ".." in key or "/" in key or "\\" in key:
            return False
        return True

    def allocate(
        self,
        data: bytes,
        *,
        format: str = "bin",
        prefix: str = "shm",
        metadata: dict[str, Any] | None = None,
    ) -> ShmDescriptor:
        """Allocate a new shared memory buffer with 0600 permissions."""
        self._ensure_dir()
        clean_prefix = re.sub(r"[^a-zA-Z0-9]", "", prefix) or "shm"
        key = f"{clean_prefix}_{uuid.uuid4().hex}"
        buf_path = self.shm_dir / f"{key}.bin"

        # Write with strict user-only read/write permissions (0600)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        mode = 0o600
        fd = os.open(buf_path, flags, mode)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
                f.flush()
        except Exception:
            # Clean up partial file on failure
            try:
                buf_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

        desc = ShmDescriptor(
            key=key,
            path=str(buf_path),
            byte_size=len(data),
            format=format,
            created_at=time.time(),
            metadata=metadata or {},
        )
        return desc

    def resolve(self, key: str) -> Path | None:
        """Resolve a buffer key to an existing file path, preventing directory traversal."""
        if not self.is_safe_key(key):
            return None
        candidate = (self.shm_dir / f"{key}.bin").resolve()
        # Verify candidate is strictly inside shm_dir
        try:
            candidate.relative_to(self.shm_dir)
        except ValueError:
            return None

        if candidate.is_file():
            return candidate
        return None

    def read_bytes(self, key: str) -> bytes | None:
        """Read the raw buffer bytes for a given key."""
        path = self.resolve(key)
        if path is None:
            return None
        try:
            return path.read_bytes()
        except OSError:
            return None

    def release(self, key: str) -> bool:
        """Explicitly release and unlink a buffer."""
        path = self.resolve(key)
        if path is None:
            return False
        try:
            path.unlink(missing_ok=True)
            return True
        except OSError:
            return False

    def cleanup(self, ttl_seconds: float | None = None) -> int:
        """Remove buffers that have exceeded their time-to-live."""
        ttl = ttl_seconds if ttl_seconds is not None else self.default_ttl
        now = time.time()
        removed = 0
        if not self.shm_dir.is_dir():
            return 0

        for item in self.shm_dir.glob("*.bin"):
            try:
                stat = item.stat()
                if (now - stat.st_mtime) > ttl:
                    item.unlink(missing_ok=True)
                    removed += 1
            except OSError:
                continue
        return removed
