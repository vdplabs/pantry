from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SAFE_HASH_REGEX = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class ChunkInfo:
    sha256: str
    byte_size: int
    created_at: float
    refcount: int


class CasIndex:
    """Thread-safe SQLite index for CAS chunks, package references, and refcounts."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS chunks (
                    sha256 TEXT PRIMARY KEY,
                    byte_size INTEGER NOT NULL,
                    created_at REAL NOT NULL,
                    refcount INTEGER NOT NULL DEFAULT 0
                );
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS packages (
                    package_id TEXT PRIMARY KEY,
                    apparent_size INTEGER NOT NULL DEFAULT 0,
                    physical_size INTEGER NOT NULL DEFAULT 0,
                    recipe_path TEXT,
                    created_at REAL NOT NULL
                );
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS package_chunk_refs (
                    package_id TEXT NOT NULL,
                    sha256 TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    offset INTEGER NOT NULL,
                    length INTEGER NOT NULL,
                    PRIMARY KEY (package_id, sha256, file_path, offset),
                    FOREIGN KEY (sha256) REFERENCES chunks(sha256) ON DELETE CASCADE
                );
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_refs_package ON package_chunk_refs(package_id);
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_refs_chunk ON package_chunk_refs(sha256);
                """
            )

    def add_or_update_chunk(self, sha256: str, byte_size: int) -> None:
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO chunks (sha256, byte_size, created_at, refcount)
                VALUES (?, ?, ?, 0)
                ON CONFLICT(sha256) DO UPDATE SET
                    byte_size = excluded.byte_size;
                """,
                (sha256, byte_size, now),
            )

    def has_chunk(self, sha256: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute("SELECT 1 FROM chunks WHERE sha256 = ? LIMIT 1;", (sha256,))
            return cur.fetchone() is not None

    def get_chunk(self, sha256: str) -> ChunkInfo | None:
        with self._connect() as conn:
            cur = conn.execute(
                "SELECT sha256, byte_size, created_at, refcount FROM chunks WHERE sha256 = ?;",
                (sha256,),
            )
            row = cur.fetchone()
            if row is None:
                return None
            return ChunkInfo(
                sha256=row["sha256"],
                byte_size=row["byte_size"],
                created_at=row["created_at"],
                refcount=row["refcount"],
            )

    def record_package_refs(
        self,
        package_id: str,
        apparent_size: int,
        physical_size: int,
        refs: list[tuple[str, str, int, int]],  # (sha256, file_path, offset, length)
        recipe_path: str | None = None,
    ) -> None:
        now = time.time()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE;")
            # Remove existing refs for this package if re-registering
            cur = conn.execute(
                "SELECT sha256 FROM package_chunk_refs WHERE package_id = ?;", (package_id,)
            )
            old_chunks = [r[0] for r in cur.fetchall()]
            for ch in old_chunks:
                conn.execute(
                    "UPDATE chunks SET refcount = MAX(0, refcount - 1) WHERE sha256 = ?;",
                    (ch,),
                )
            conn.execute(
                "DELETE FROM package_chunk_refs WHERE package_id = ?;", (package_id,)
            )

            # Record package
            conn.execute(
                """
                INSERT INTO packages (package_id, apparent_size, physical_size, recipe_path, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(package_id) DO UPDATE SET
                    apparent_size = excluded.apparent_size,
                    physical_size = excluded.physical_size,
                    recipe_path = excluded.recipe_path;
                """,
                (package_id, apparent_size, physical_size, recipe_path, now),
            )

            # Add refs and bump refcount
            for sha256, file_path, offset, length in refs:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO package_chunk_refs
                    (package_id, sha256, file_path, offset, length)
                    VALUES (?, ?, ?, ?, ?);
                    """,
                    (package_id, sha256, file_path, offset, length),
                )
                conn.execute(
                    "UPDATE chunks SET refcount = refcount + 1 WHERE sha256 = ?;",
                    (sha256,),
                )
            conn.commit()

    def remove_package(self, package_id: str) -> None:
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE;")
            cur = conn.execute(
                "SELECT sha256 FROM package_chunk_refs WHERE package_id = ?;", (package_id,)
            )
            chunks = [r[0] for r in cur.fetchall()]
            for ch in chunks:
                conn.execute(
                    "UPDATE chunks SET refcount = MAX(0, refcount - 1) WHERE sha256 = ?;",
                    (ch,),
                )
            conn.execute(
                "DELETE FROM package_chunk_refs WHERE package_id = ?;", (package_id,)
            )
            conn.execute("DELETE FROM packages WHERE package_id = ?;", (package_id,))
            conn.commit()

    def get_unreferenced_chunks(self) -> list[ChunkInfo]:
        with self._connect() as conn:
            cur = conn.execute(
                "SELECT sha256, byte_size, created_at, refcount FROM chunks WHERE refcount <= 0;"
            )
            return [
                ChunkInfo(
                    sha256=r["sha256"],
                    byte_size=r["byte_size"],
                    created_at=r["created_at"],
                    refcount=r["refcount"],
                )
                for r in cur.fetchall()
            ]

    def remove_chunk(self, sha256: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM chunks WHERE sha256 = ?;", (sha256,))

    def get_stats(self) -> dict[str, Any]:
        with self._connect() as conn:
            cur = conn.execute(
                "SELECT COUNT(*) as count, COALESCE(SUM(byte_size), 0) as total_bytes FROM chunks;"
            )
            chunk_row = cur.fetchone()
            total_chunks = chunk_row["count"] if chunk_row else 0
            physical_bytes = chunk_row["total_bytes"] if chunk_row else 0

            cur = conn.execute(
                "SELECT COUNT(*) as count, COALESCE(SUM(apparent_size), 0) as apparent_bytes FROM packages;"
            )
            pkg_row = cur.fetchone()
            total_packages = pkg_row["count"] if pkg_row else 0
            apparent_bytes = pkg_row["apparent_bytes"] if pkg_row else 0

            # If no packages are tracked yet or apparent_bytes is less than physical, fallback
            apparent_bytes = max(apparent_bytes, physical_bytes)
            dedup_saved = max(0, apparent_bytes - physical_bytes)
            ratio = (apparent_bytes / physical_bytes) if physical_bytes > 0 else 1.0

            return {
                "total_packages": total_packages,
                "apparent_size_bytes": apparent_bytes,
                "physical_size_bytes": physical_bytes,
                "dedup_saved_bytes": dedup_saved,
                "dedup_ratio": round(ratio, 2),
                "total_chunks": total_chunks,
            }


class CasManager:
    """Manages content-addressed chunks under $PANTRY_DATA/cas/."""

    def __init__(self, cas_dir: Path) -> None:
        self.cas_dir = cas_dir.resolve()
        self.chunks_dir = self.cas_dir / "chunks"
        self.staging_dir = self.cas_dir / "staging"
        self.db_path = self.cas_dir / "index.db"
        self._ensure_dirs()
        self.index = CasIndex(self.db_path)

    def _ensure_dirs(self) -> None:
        self.cas_dir.mkdir(parents=True, exist_ok=True)
        self.chunks_dir.mkdir(parents=True, exist_ok=True)
        self.staging_dir.mkdir(parents=True, exist_ok=True)
        try:
            self.cas_dir.chmod(0o700)
            self.chunks_dir.chmod(0o700)
            self.staging_dir.chmod(0o700)
        except OSError:
            pass

    @staticmethod
    def is_safe_hash(sha256: str) -> bool:
        return bool(SAFE_HASH_REGEX.match((sha256 or "").lower()))

    def chunk_path(self, sha256: str) -> Path:
        clean = sha256.lower().strip()
        if not self.is_safe_hash(clean):
            raise ValueError(f"invalid chunk sha256 hash: {sha256}")
        prefix = clean[:2]
        return self.chunks_dir / prefix / f"{clean}.chunk"

    def has_chunk(self, sha256: str) -> bool:
        clean = sha256.lower().strip()
        if not self.is_safe_hash(clean):
            return False
        p = self.chunk_path(clean)
        return p.is_file() and p.stat().st_size > 0

    def put_chunk(self, data: bytes, expected_sha256: str | None = None) -> str:
        """Write a chunk atomically with SHA-256 verification."""
        digest = hashlib.sha256(data).hexdigest()
        if expected_sha256:
            clean_expected = expected_sha256.lower().strip()
            if clean_expected != digest:
                raise ValueError(
                    f"chunk sha256 mismatch: expected {clean_expected}, computed {digest}"
                )

        target = self.chunk_path(digest)
        if target.is_file() and target.stat().st_size == len(data):
            self.index.add_or_update_chunk(digest, len(data))
            return digest

        # Write to staging first
        stage_file = self.staging_dir / f"stage_{uuid.uuid4().hex}.tmp"
        try:
            stage_file.write_bytes(data)
            try:
                stage_file.chmod(0o600)
            except OSError:
                pass
            target.parent.mkdir(parents=True, exist_ok=True)
            stage_file.replace(target)
        finally:
            if stage_file.exists():
                try:
                    stage_file.unlink()
                except OSError:
                    pass

        self.index.add_or_update_chunk(digest, len(data))
        return digest

    def put_chunk_stream(
        self,
        stream_fn,
        byte_size: int,
        expected_sha256: str | None = None,
    ) -> str:
        """Stream chunks from a callable or file descriptor into staging and promote."""
        stage_file = self.staging_dir / f"stage_{uuid.uuid4().hex}.tmp"
        hasher = hashlib.sha256()
        bytes_written = 0
        try:
            with stage_file.open("wb") as out_f:
                stream_fn(out_f, hasher)
            digest = hasher.hexdigest()
            if expected_sha256:
                clean_expected = expected_sha256.lower().strip()
                if clean_expected != digest:
                    raise ValueError(
                        f"chunk sha256 mismatch: expected {clean_expected}, computed {digest}"
                    )
            target = self.chunk_path(digest)
            try:
                stage_file.chmod(0o600)
            except OSError:
                pass
            target.parent.mkdir(parents=True, exist_ok=True)
            stage_file.replace(target)
            self.index.add_or_update_chunk(digest, target.stat().st_size)
            return digest
        finally:
            if stage_file.exists():
                try:
                    stage_file.unlink()
                except OSError:
                    pass

    def get_chunk_bytes(self, sha256: str) -> bytes | None:
        clean = sha256.lower().strip()
        if not self.is_safe_hash(clean):
            return None
        target = self.chunk_path(clean)
        if not target.is_file():
            return None
        return target.read_bytes()

    def prune(self, dry_run: bool = False) -> tuple[int, int]:
        """Reclaim unreferenced chunks (refcount <= 0).

        Returns: (chunks_reclaimed, bytes_reclaimed).
        """
        unref = self.index.get_unreferenced_chunks()
        pruned_count = 0
        reclaimed_bytes = 0

        for chunk in unref:
            pruned_count += 1
            reclaimed_bytes += chunk.byte_size
            if not dry_run:
                target = self.chunk_path(chunk.sha256)
                if target.exists():
                    try:
                        target.unlink()
                    except OSError:
                        pass
                self.index.remove_chunk(chunk.sha256)

        return pruned_count, reclaimed_bytes

    def get_stats(self) -> dict[str, Any]:
        stats = self.index.get_stats()
        stats["cas_enabled"] = True
        stats["data_root"] = str(self.cas_dir.parent)
        return stats
