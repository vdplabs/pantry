from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

from pantry.schemas import PackageManifest


class PackageStore:
    """Package library: small metadata under ``root``, heavy bytes under ``data_root``.

    When ``data_root`` is omitted it equals ``root`` (single-directory layout).
    Split roots let Macs keep manifests/state on the internal SSD while blobs
    and HF/MLX weight trees live on an external volume (``PANTRY_DATA``).
    """

    def __init__(self, root: Path, data_root: Path | None = None) -> None:
        self.root = root
        self.data_root = (data_root or root).resolve()
        self.blobs = self.data_root / "blobs"
        self.packages = self.root / "packages"
        self.state_path = self.root / "state.json"
        self.blobs.mkdir(parents=True, exist_ok=True)
        self.packages.mkdir(parents=True, exist_ok=True)

    def ensure(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.data_root.mkdir(parents=True, exist_ok=True)
        self.blobs.mkdir(parents=True, exist_ok=True)
        self.packages.mkdir(parents=True, exist_ok=True)
        if not self.state_path.exists():
            self._write_state({"loaded": [], "pinned": []})

    @property
    def artifacts_dir(self) -> Path:
        return self.data_root / "artifacts"

    def _write_state(self, state: dict) -> None:
        self.state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")

    def read_state(self) -> dict:
        if not self.state_path.exists():
            return {"loaded": [], "pinned": []}
        return json.loads(self.state_path.read_text(encoding="utf-8"))

    def put_blob(self, data: bytes) -> str:
        digest = hashlib.sha256(data).hexdigest()
        dest = self.blobs / digest
        if not dest.exists():
            dest.write_bytes(data)
        return digest

    def has_blob(self, sha256: str) -> bool:
        return (self.blobs / sha256).is_file()

    def package_dir(self, package_id: str) -> Path:
        safe = package_id.replace("/", "__")
        return self.packages / safe

    def write_manifest(self, manifest: PackageManifest) -> Path:
        d = self.package_dir(manifest.id)
        d.mkdir(parents=True, exist_ok=True)
        path = d / "manifest.json"
        path.write_text(manifest.model_dump_json(indent=2) + "\n", encoding="utf-8")
        return path

    def load_manifest(self, package_id: str) -> PackageManifest | None:
        path = self.package_dir(package_id) / "manifest.json"
        if not path.is_file():
            return None
        return PackageManifest.model_validate_json(path.read_text(encoding="utf-8"))

    def list_manifests(self) -> list[PackageManifest]:
        out: list[PackageManifest] = []
        if not self.packages.exists():
            return out
        for child in sorted(self.packages.iterdir()):
            man = child / "manifest.json"
            if man.is_file():
                out.append(PackageManifest.model_validate_json(man.read_text(encoding="utf-8")))
        return out

    def install_manifest_file(self, src: Path) -> PackageManifest:
        data = src.read_text(encoding="utf-8")
        manifest = PackageManifest.model_validate_json(data)
        self.write_manifest(manifest)
        # Copy any sibling files listed as blobs into CAS when present next to manifest.
        src_dir = src.parent
        for blob in manifest.blobs:
            candidate = src_dir / blob.path
            if candidate.is_file():
                digest = self.put_blob(candidate.read_bytes())
                if blob.sha256 and blob.sha256 != digest:
                    raise ValueError(
                        f"blob hash mismatch for {blob.path}: manifest={blob.sha256} got={digest}"
                    )
        return manifest

    def seed_from_catalog(self, catalog_dir: Path) -> list[str]:
        installed: list[str] = []
        if not catalog_dir.is_dir():
            return installed
        for man in sorted(catalog_dir.glob("*/manifest.json")):
            m = self.install_manifest_file(man)
            installed.append(m.id)
        return installed

    def mark_loaded(self, package_id: str, *, pin: bool = False) -> None:
        state = self.read_state()
        loaded = list(dict.fromkeys([*state.get("loaded", []), package_id]))
        pinned = list(state.get("pinned", []))
        if pin and package_id not in pinned:
            pinned.append(package_id)
        self._write_state({"loaded": loaded, "pinned": pinned})

    def mark_unloaded(self, package_id: str) -> None:
        state = self.read_state()
        loaded = [p for p in state.get("loaded", []) if p != package_id]
        pinned = [p for p in state.get("pinned", []) if p != package_id]
        self._write_state({"loaded": loaded, "pinned": pinned})

    def weights_dir(self, package_id: str) -> Path:
        safe = package_id.replace("/", "__")
        return self.data_root / "packages" / safe / "weights"

    def find_hf_snapshot(self, repo_id: str, revision: str | None = None) -> Path | None:
        """Locate a snapshot for repo_id in the shared Hugging Face cache.

        Search order (unique roots, first hit wins):
        1. ``HF_HUB_CACHE`` (when set — exclusive of the default ``~/.cache`` path)
        2. ``HF_HOME/hub`` (when set)
        3. ``~/.cache/huggingface/hub`` (only when neither HF env override is set)
        4. ``PANTRY_DATA/huggingface/hub`` when data root differs from metadata home
        """
        import os

        cache_roots: list[Path] = []
        seen: set[Path] = set()

        def _add(path: Path) -> None:
            resolved = path.expanduser()
            key = resolved.resolve() if resolved.exists() else resolved
            if key in seen:
                return
            seen.add(key)
            cache_roots.append(resolved)

        hub_cache = os.environ.get("HF_HUB_CACHE")
        hf_home = os.environ.get("HF_HOME")
        if hub_cache:
            _add(Path(hub_cache))
        if hf_home:
            _add(Path(hf_home) / "hub")
        # Honor HF override isolation: do not fall through to the user default
        # cache when tests / operators pin HF_HUB_CACHE or HF_HOME.
        if not hub_cache and not hf_home:
            _add(Path.home() / ".cache" / "huggingface" / "hub")
        if self.data_root != self.root:
            _add(self.data_root / "huggingface" / "hub")

        folder_name = f"models--{repo_id.replace('/', '--')}"
        for root in cache_roots:
            snapshots_dir = root / folder_name / "snapshots"
            if not snapshots_dir.is_dir():
                continue

            if revision:
                cand = snapshots_dir / revision
                if cand.is_dir():
                    return cand

            # Find the most recently modified snapshot
            snaps = [s for s in snapshots_dir.iterdir() if s.is_dir()]
            if snaps:
                snaps.sort(key=lambda p: p.stat().st_mtime, reverse=True)
                return snaps[0]

        return None

    def _is_dir_weights_complete(self, path: Path, manifest: PackageManifest) -> bool:
        if not path.is_dir():
            return False
        primary = (manifest.runtime.primary or "echo").lower()
        if primary == "echo" or primary.startswith("echo_"):
            return True
        has_config = (
            (path / "config.json").is_file()
            or (path / "model_index.json").is_file()
            or (path / "transformer" / "config.json").is_file()
            or (path / "unet" / "config.json").is_file()
        )
        has_weights = (
            any(path.glob("*.safetensors"))
            or any(path.glob("*.npz"))
            or any(path.glob("*.bin"))
            or (path / "transformer").is_dir()
            or (path / "unet").is_dir()
        )
        return has_config and has_weights

    def resolve_weights_path(self, manifest: PackageManifest) -> Path | None:
        primary = (manifest.runtime.primary or "echo").lower()
        if primary == "echo" or primary.startswith("echo_"):
            return None

        # 1. Check local package store
        local = self.weights_dir(manifest.id)
        if self._is_dir_weights_complete(local, manifest):
            return local

        # 2. Check shared Hugging Face cache
        if manifest.runtime.hf_repo:
            snap = self.find_hf_snapshot(manifest.runtime.hf_repo, manifest.runtime.hf_revision)
            if snap and self._is_dir_weights_complete(snap, manifest):
                return snap

        return None

    def weights_ready(self, manifest: PackageManifest) -> bool:
        primary = (manifest.runtime.primary or "echo").lower()
        if primary == "echo" or primary.startswith("echo_"):
            return True
        return self.resolve_weights_path(manifest) is not None

    def install_from_bundled_catalog(self, package_id: str) -> PackageManifest | None:
        from pantry.config import bundled_catalog_dir

        for mpath in bundled_catalog_dir().glob("*/manifest.json"):
            candidate = PackageManifest.model_validate_json(mpath.read_text(encoding="utf-8"))
            if candidate.id == package_id:
                return self.install_manifest_file(mpath)
        return None

    def copy_tree(self, dest: Path) -> None:
        """Test helper."""
        if self.root.exists():
            shutil.copytree(self.root, dest, dirs_exist_ok=True)
