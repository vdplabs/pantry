from __future__ import annotations

import os
from pathlib import Path

from pantry.schemas import PackageManifest
from pantry.store import PackageStore


class PullError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


from collections.abc import Callable
from typing import Any


def pull_package(
    store: PackageStore,
    package_id: str,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Install catalog manifest (if needed) and fetch HF weights when declared.

    Weights land in the **shared Hugging Face hub cache** (one copy on disk).
    Pantry does not duplicate multi‑GB trees into ``packages/<id>/weights/`` when
    the HF cache already has (or will have) the snapshot.
    """
    if progress_callback:
        progress_callback({"status": "resolving", "package_id": package_id, "message": f"Resolving manifest for {package_id}…"})

    man = store.load_manifest(package_id)
    if man is None:
        man = store.install_from_bundled_catalog(package_id)
    if man is None:
        from pantry.hub import is_hf_repo_id, register_hf_repo

        if is_hf_repo_id(package_id):
            man = register_hf_repo(store, package_id)        
    if man is None:
        raise PullError(f"package not found: {package_id}; expected a Pantry package/alias or Hugging Face owner/repository id")

    store.write_manifest(man)
    primary = (man.runtime.primary or "echo").lower()
    if primary == "echo" or primary.startswith("echo_") or not man.runtime.hf_repo:
        res = {
            "package_id": man.id,
            "status": "ready",
            "runtime": primary,
            "weights_path": None,
            "hf_repo": man.runtime.hf_repo,
            "bytes_on_disk": 0,
        }
        if progress_callback:
            progress_callback(res)
        return res

    if store.weights_ready(man):
        ready_path = store.resolve_weights_path(man)
        assert ready_path is not None
        res = {
            "package_id": man.id,
            "status": "ready",
            "runtime": primary,
            "weights_path": str(ready_path),
            "hf_repo": man.runtime.hf_repo,
            "bytes_on_disk": _dir_size(ready_path),
        }
        if progress_callback:
            progress_callback(res)
        return res

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
    target_cache_dir = store.primary_hf_cache_dir()
    target_cache_dir.mkdir(parents=True, exist_ok=True)

    # Pre-flight disk space check: ensure drive has sufficient headroom
    try:
        import shutil

        usage = shutil.disk_usage(target_cache_dir)
        est_bytes = getattr(man, "approx_bytes", 0) or 0
        if not est_bytes:
            ram_min = getattr(man, "ram_gb_min", 0.0) or 0.0
            est_bytes = int(ram_min * (1024**3) * 0.85)
        safety_headroom = 5 * (1024**3)  # 5 GB safety headroom to prevent OS freezes
        if est_bytes > 0 and usage.free < (est_bytes + safety_headroom):
            req_gb = (est_bytes + safety_headroom) / (1024**3)
            free_gb = usage.free / (1024**3)
            raise PullError(
                f"Insufficient disk space on {target_cache_dir}: "
                f"{free_gb:.1f} GB available, but package '{man.id}' requires ~{est_bytes / (1024**3):.1f} GB "
                f"(+ 5.0 GB safety margin = {req_gb:.1f} GB required). "
                f"Free up storage or attach an external drive."
            )
    except OSError:
        pass

    try:
        download_kwargs: dict[str, Any] = {
            "repo_id": man.runtime.hf_repo,
            "revision": man.runtime.hf_revision,
            "token": token,
            "cache_dir": str(target_cache_dir),
        }

        # Collect ignore patterns from manifest and defaults
        ignore_patterns: list[str] = []
        if getattr(man.runtime, "ignore_patterns", None):
            ignore_patterns.extend(man.runtime.ignore_patterns)
        if man.runtime.hf_repo == "Lightricks/LTX-Video":
            for pat in ["*13b*", "*13B*", "*upscaler*", "*.gif", "*.mp4"]:
                if pat not in ignore_patterns:
                    ignore_patterns.append(pat)
        if ignore_patterns:
            download_kwargs["ignore_patterns"] = ignore_patterns

        if getattr(man.runtime, "allow_patterns", None):
            download_kwargs["allow_patterns"] = man.runtime.allow_patterns

        if progress_callback:
            progress_callback({
                "status": "downloading",
                "package_id": man.id,
                "hf_repo": man.runtime.hf_repo,
                "message": f"Downloading weights for {man.runtime.hf_repo}…",
            })

        snapshot_path = Path(snapshot_download(**download_kwargs))
    except Exception as e:
        _cleanup_repo_incomplete(target_cache_dir, man.runtime.hf_repo)
        raise PullError(f"download failed for {man.runtime.hf_repo}: {e}") from e

    if not store._is_dir_weights_complete(snapshot_path, man):
        raise PullError(f"weights missing after download: {snapshot_path}")

    if progress_callback:
        progress_callback({
            "status": "indexing",
            "package_id": man.id,
            "message": "Indexing content-addressed metadata…",
        })

    recipe = None
    try:
        # Index recipe metadata without duplicating multi-GB weights into CAS chunks
        recipe = store.ingest_package_into_cas(man.id, snapshot_path, store_chunks=False)
    except Exception:  # noqa: BLE001, S110
        pass

    apparent = recipe.total_uncompressed_bytes if recipe else _dir_size(snapshot_path)
    unique = recipe.unique_cas_bytes if recipe else _dir_size(snapshot_path)
    shared = recipe.shared_cas_bytes if recipe else 0
    ratio = recipe.dedup_ratio if recipe else 1.0

    result = {
        "package_id": man.id,
        "status": "ready",
        "runtime": primary,
        "weights_path": str(snapshot_path),
        "hf_repo": man.runtime.hf_repo,
        "bytes_on_disk": _dir_size(snapshot_path),
        "recipe_present": recipe is not None,
        "apparent_size_bytes": apparent,
        "unique_cas_bytes": unique,
        "shared_cas_bytes": shared,
        "dedup_ratio": ratio,
    }
    if progress_callback:
        progress_callback(result)
    return result


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


def _cleanup_repo_incomplete(cache_dir: Path, repo_id: str | None) -> None:
    """Purge orphaned .incomplete and .lock files if a download fails or is aborted."""
    if not repo_id or not cache_dir.is_dir():
        return
    folder_name = f"models--{repo_id.replace('/', '--')}"
    repo_path = cache_dir / folder_name
    if not repo_path.is_dir():
        return
    try:
        for p in repo_path.rglob("*"):
            if p.is_file() and (
                p.name.endswith(".incomplete") or p.name.endswith(".lock") or p.name.endswith(".tmp")
            ):
                p.unlink(missing_ok=True)
    except Exception:  # noqa: BLE001, S110
        pass
