from __future__ import annotations

import os
from pathlib import Path

from pantry.schemas import PackageManifest
from pantry.store import PackageStore


class PullError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def pull_package(store: PackageStore, package_id: str) -> dict:
    """Install catalog manifest (if needed) and fetch HF weights when declared."""
    man = store.load_manifest(package_id)
    if man is None:
        man = store.install_from_bundled_catalog(package_id)
    if man is None:
        raise PullError(f"package not found: {package_id}")

    store.write_manifest(man)
    primary = (man.runtime.primary or "echo").lower()
    if primary == "echo" or not man.runtime.hf_repo:
        return {
            "package_id": man.id,
            "status": "ready",
            "runtime": primary,
            "weights_path": None,
            "hf_repo": man.runtime.hf_repo,
            "bytes_on_disk": 0,
        }

    if store.weights_ready(man):
        ready_path = store.resolve_weights_path(man) or store.weights_dir(man.id)
        return {
            "package_id": man.id,
            "status": "ready",
            "runtime": primary,
            "weights_path": str(ready_path),
            "hf_repo": man.runtime.hf_repo,
            "bytes_on_disk": _dir_size(ready_path),
        }

    dest = store.weights_dir(man.id)
    dest.mkdir(parents=True, exist_ok=True)

    try:
        from huggingface_hub import snapshot_download
    except ImportError as e:
        raise PullError(
            "huggingface_hub is required for pull. Reinstall pantry (pip install -e .)."
        ) from e

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    try:
        snapshot_download(
            repo_id=man.runtime.hf_repo,
            revision=man.runtime.hf_revision,
            local_dir=str(dest),
            token=token,
        )
    except Exception as e:
        raise PullError(f"download failed for {man.runtime.hf_repo}: {e}") from e

    if not store.weights_ready(man):
        raise PullError(f"weights missing after download: {dest}")

    return {
        "package_id": man.id,
        "status": "ready",
        "runtime": primary,
        "weights_path": str(dest),
        "hf_repo": man.runtime.hf_repo,
        "bytes_on_disk": _dir_size(dest),
    }


def _dir_size(path: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += (Path(root) / name).stat().st_size
            except OSError:
                continue
    return total


def ensure_manifest(store: PackageStore, package_id: str) -> PackageManifest | None:
    man = store.load_manifest(package_id)
    if man is not None:
        return man
    return store.install_from_bundled_catalog(package_id)
