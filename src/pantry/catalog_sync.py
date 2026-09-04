from __future__ import annotations

"""Remote catalog updating and synchronization."""

import os
from typing import Any

import httpx

from pantry.schemas import PackageManifest
from pantry.store import PackageStore

DEFAULT_CATALOG_INDEX_URL = (
    "https://raw.githubusercontent.com/vdplabs/pantry/main/catalog/index.json"
)


class CatalogSyncError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def get_catalog_url(override: str | None = None) -> str:
    return (
        override
        or os.environ.get("PANTRY_CATALOG_URL")
        or DEFAULT_CATALOG_INDEX_URL
    )


def fetch_catalog_index(url: str | None = None, timeout: float = 10.0) -> list[dict[str, Any]]:
    target = get_catalog_url(url)
    try:
        r = httpx.get(target, timeout=timeout)
        r.raise_for_status()
        data = r.json()
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "packages" in data:
            return data["packages"]
        raise CatalogSyncError(f"Unexpected catalog format from {target}")
    except Exception as e:
        raise CatalogSyncError(f"Failed to fetch catalog from {target}: {e}") from e


def update_catalog_from_index(
    store: PackageStore,
    packages_data: list[dict[str, Any]],
) -> dict[str, Any]:
    existing_ids = {p.id for p in store.list_manifests()}
    installed: list[str] = []
    updated: list[str] = []

    for item in packages_data:
        try:
            manifest = PackageManifest.model_validate(item)
            is_new = manifest.id not in existing_ids
            store.write_manifest(manifest)
            if is_new:
                installed.append(manifest.id)
            else:
                updated.append(manifest.id)
        except Exception:  # noqa: BLE001, S112
            continue

    return {
        "installed": installed,
        "updated": updated,
        "total_catalog": len(store.list_manifests()),
    }


def sync_remote_catalog(
    store: PackageStore,
    url: str | None = None,
    timeout: float = 10.0,
) -> dict[str, Any]:
    packages_data = fetch_catalog_index(url, timeout=timeout)
    return update_catalog_from_index(store, packages_data)
