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
    """Install catalog manifest (if needed) and fetch HF weights when declared.

    Weights land in the **shared Hugging Face hub cache** (one copy on disk).
    Pantry does not duplicate multi‑GB trees into ``packages/<id>/weights/`` when
    the HF cache already has (or will have) the snapshot.
    """
    man = store.load_manifest(package_id)
    if man is None:
        man = store.install_from_bundled_catalog(package_id)
    if man is None:
        raise PullError(f"package not found: {package_id}")

    store.write_manifest(man)
    primary = (man.runtime.primary or "echo").lower()
    if primary == "echo" or primary.startswith("echo_") or not man.runtime.hf_repo:
        return {
            "package_id": man.id,
            "status": "ready",
            "runtime": primary,
            "weights_path": None,
            "hf_repo": man.runtime.hf_repo,
            "bytes_on_disk": 0,
        }

    if store.weights_ready(man):
        ready_path = store.resolve_weights_path(man)
        assert ready_path is not None
        return {
            "package_id": man.id,
            "status": "ready",
            "runtime": primary,
            "weights_path": str(ready_path),
            "hf_repo": man.runtime.hf_repo,
            "bytes_on_disk": _dir_size(ready_path),
        }

    try:
        from huggingface_hub import snapshot_download
    except ImportError as e:
        raise PullError(
            "huggingface_hub is required for pull. Reinstall pantry (pip install -e .)."
        ) from e

    # Point HF at the shared library when PANTRY_DATA is an external SSD layout
    # (…/huggingface/pantry) so snapshot_download does not fill the internal disk.
    _ensure_shared_hf_env(store)

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    try:
        # No local_dir → single copy in the HF hub cache (one copy on disk).
        snapshot_path = Path(
            snapshot_download(
                repo_id=man.runtime.hf_repo,
                revision=man.runtime.hf_revision,
                token=token,
            )
        )
    except Exception as e:
        raise PullError(f"download failed for {man.runtime.hf_repo}: {e}") from e

    if not store._is_dir_weights_complete(snapshot_path, man):
        raise PullError(f"weights missing after download: {snapshot_path}")

    return {
        "package_id": man.id,
        "status": "ready",
        "runtime": primary,
        "weights_path": str(snapshot_path),
        "hf_repo": man.runtime.hf_repo,
        "bytes_on_disk": _dir_size(snapshot_path),
    }


def _ensure_shared_hf_env(store: PackageStore) -> None:
    """Align HF_* with PANTRY_DATA external layouts before snapshot_download."""
    if os.environ.get("HF_HUB_CACHE") or os.environ.get("HF_HOME"):
        return
    if store.data_root == store.root:
        return
    # …/huggingface/pantry → HF_HOME=…/huggingface, hub=…/huggingface/hub
    if store.data_root.name == "pantry":
        parent = store.data_root.parent
        os.environ["HF_HOME"] = str(parent)
        os.environ["HF_HUB_CACHE"] = str(parent / "hub")
        return
    os.environ["HF_HOME"] = str(store.data_root / "huggingface")
    os.environ["HF_HUB_CACHE"] = str(store.data_root / "huggingface" / "hub")


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
