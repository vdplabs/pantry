from __future__ import annotations

import ctypes
import json
import os
import shutil
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from pantry.cas import CasManager
from pantry.chunker import ChunkSpec, ModelChunker

COPYFILE_CLONE = 1 << 24


def try_clonefile(src: Path, dst: Path) -> bool:
    """Attempt zero-copy APFS block clone on macOS."""
    if not src.is_file():
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        try:
            dst.unlink()
        except OSError:
            return False

    try:
        libc = ctypes.CDLL(None)
        if hasattr(libc, "copyfile"):
            ret = libc.copyfile(
                str(src).encode("utf-8"),
                str(dst).encode("utf-8"),
                None,
                COPYFILE_CLONE,
            )
            if ret == 0:
                return True
        elif hasattr(libc, "clonefile"):
            ret = libc.clonefile(
                str(src).encode("utf-8"),
                str(dst).encode("utf-8"),
                0,
            )
            if ret == 0:
                return True
    except Exception:
        pass

    # Fallback to hardlink if on same filesystem
    try:
        os.link(src, dst)
        return True
    except OSError:
        pass

    # Fallback to copy
    try:
        shutil.copyfile(src, dst)
        return True
    except Exception:
        return False


@dataclass
class RecipeChunk:
    name: str
    offset: int
    length: int
    sha256: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "offset": self.offset,
            "length": self.length,
            "sha256": self.sha256,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> RecipeChunk:
        return cls(
            name=d["name"],
            offset=d["offset"],
            length=d["length"],
            sha256=d["sha256"],
        )


@dataclass
class RecipeFile:
    path: str
    total_bytes: int
    chunks: list[RecipeChunk] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "total_bytes": self.total_bytes,
            "chunks": [c.to_dict() for c in self.chunks],
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> RecipeFile:
        return cls(
            path=d["path"],
            total_bytes=d["total_bytes"],
            chunks=[RecipeChunk.from_dict(c) for c in d.get("chunks", [])],
        )


@dataclass
class PackageRecipe:
    version: int
    package_id: str
    total_uncompressed_bytes: int
    unique_cas_bytes: int
    shared_cas_bytes: int
    dedup_ratio: float
    files: list[RecipeFile] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "package_id": self.package_id,
            "total_uncompressed_bytes": self.total_uncompressed_bytes,
            "unique_cas_bytes": self.unique_cas_bytes,
            "shared_cas_bytes": self.shared_cas_bytes,
            "dedup_ratio": self.dedup_ratio,
            "files": [f.to_dict() for f in self.files],
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent) + "\n"

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> PackageRecipe:
        return cls(
            version=d.get("version", 1),
            package_id=d["package_id"],
            total_uncompressed_bytes=d.get("total_uncompressed_bytes", 0),
            unique_cas_bytes=d.get("unique_cas_bytes", 0),
            shared_cas_bytes=d.get("shared_cas_bytes", 0),
            dedup_ratio=d.get("dedup_ratio", 1.0),
            files=[RecipeFile.from_dict(f) for f in d.get("files", [])],
        )

    @classmethod
    def from_json(cls, text: str) -> PackageRecipe:
        return cls.from_dict(json.loads(text))

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.to_json(), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> PackageRecipe:
        return cls.from_json(path.read_text(encoding="utf-8"))


class RecipeAssembler:
    """Creates recipes from source files and reconstitutes files from recipes using APFS extent cloning."""

    @classmethod
    def build_recipe(
        cls,
        package_id: str,
        source_dir: Path,
        cas: CasManager,
        *,
        store_chunks: bool = True,
    ) -> PackageRecipe:
        """Scan source_dir, chunk files, insert novel chunks into CAS, and generate PackageRecipe."""
        source_dir = source_dir.resolve()
        recipe_files: list[RecipeFile] = []
        total_uncompressed_bytes = 0
        unique_cas_bytes = 0
        shared_cas_bytes = 0

        # Collect files in stable sorted relative order
        all_files: list[Path] = []
        for root, _dirs, files in os.walk(source_dir):
            for f in files:
                all_files.append(Path(root) / f)
        all_files.sort()

        cas_refs: list[tuple[str, str, int, int]] = []
        seen_hashes_in_pkg: set[str] = set()

        for fpath in all_files:
            rel_path = str(fpath.relative_to(source_dir))
            f_size = fpath.stat().st_size
            total_uncompressed_bytes += f_size

            specs = ModelChunker.chunk_file(fpath)
            r_chunks: list[RecipeChunk] = []

            with fpath.open("rb") as src_io:
                for sp in specs:
                    r_chunks.append(
                        RecipeChunk(
                            name=sp.name,
                            offset=sp.offset,
                            length=sp.length,
                            sha256=sp.sha256,
                        )
                    )
                    cas_refs.append((sp.sha256, rel_path, sp.offset, sp.length))

                    already_in_cas = cas.has_chunk(sp.sha256)
                    already_in_pkg = sp.sha256 in seen_hashes_in_pkg
                    seen_hashes_in_pkg.add(sp.sha256)

                    if already_in_cas or already_in_pkg:
                        shared_cas_bytes += sp.length
                    else:
                        unique_cas_bytes += sp.length

                    if store_chunks and not already_in_cas:
                        src_io.seek(sp.offset)
                        data = src_io.read(sp.length)
                        cas.put_chunk(data, expected_sha256=sp.sha256)

            recipe_files.append(RecipeFile(path=rel_path, total_bytes=f_size, chunks=r_chunks))

        physical = unique_cas_bytes
        ratio = (total_uncompressed_bytes / physical) if physical > 0 else 1.0

        recipe = PackageRecipe(
            version=1,
            package_id=package_id,
            total_uncompressed_bytes=total_uncompressed_bytes,
            unique_cas_bytes=unique_cas_bytes,
            shared_cas_bytes=shared_cas_bytes,
            dedup_ratio=round(ratio, 2),
            files=recipe_files,
        )

        # Record in index
        cas.index.record_package_refs(
            package_id=package_id,
            apparent_size=total_uncompressed_bytes,
            physical_size=unique_cas_bytes,
            refs=cas_refs,
        )

        return recipe

    @classmethod
    def materialize_recipe(
        cls,
        recipe: PackageRecipe,
        dest_dir: Path,
        cas: CasManager,
    ) -> None:
        """Reconstitute files described by recipe in dest_dir using APFS extent cloning."""
        dest_dir = dest_dir.resolve()
        dest_dir.mkdir(parents=True, exist_ok=True)

        buf_size = 1024 * 1024  # 1 MB window

        for r_file in recipe.files:
            target_path = dest_dir / r_file.path
            target_path.parent.mkdir(parents=True, exist_ok=True)

            # Fast path: Single whole-file chunk -> APFS extent clone
            if len(r_file.chunks) == 1 and r_file.chunks[0].offset == 0 and r_file.chunks[0].length == r_file.total_bytes:
                ch = r_file.chunks[0]
                ch_path = cas.chunk_path(ch.sha256)
                if ch_path.is_file():
                    cloned = try_clonefile(ch_path, target_path)
                    if cloned:
                        continue

            # Multi-chunk assembly: stream chunks into target at correct offsets
            with target_path.open("wb") as out_f:
                # Preallocate file to required size
                if r_file.total_bytes > 0:
                    out_f.truncate(r_file.total_bytes)

                for ch in r_file.chunks:
                    ch_path = cas.chunk_path(ch.sha256)
                    if not ch_path.is_file():
                        raise FileNotFoundError(f"missing CAS chunk {ch.sha256} for {r_file.path}")

                    out_f.seek(ch.offset)
                    with ch_path.open("rb") as in_f:
                        remaining = ch.length
                        while remaining > 0:
                            chunk_data = in_f.read(min(remaining, buf_size))
                            if not chunk_data:
                                break
                            out_f.write(chunk_data)
                            remaining -= len(chunk_data)
