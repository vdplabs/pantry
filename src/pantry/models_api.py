import time

from pantry.schemas import PackageManifest
from pantry.store import PackageStore

_MODELS_CACHE: dict[tuple, tuple[float, list[dict]]] = {}


def preferred_model_id(manifest: PackageManifest) -> str:
    """User-facing model id for OpenAI /v1/models (first alias, else package id)."""
    for alias in manifest.aliases:
        trimmed = alias.strip()
        if trimmed:
            return trimmed
    return manifest.id


def list_model_entries(
    store: PackageStore,
    *,
    include_demos: bool = False,
    include_unready: bool = True,
    include_package_ids: bool = False,
    max_age: float = 3.0,
) -> list[dict]:
    """Build OpenAI-style model rows — one primary id per package by default."""
    cache_key = (str(store.root), include_demos, include_unready, include_package_ids)
    now = time.time()
    if max_age > 0 and cache_key in _MODELS_CACHE:
        cached_at, cached_data = _MODELS_CACHE[cache_key]
        if now - cached_at < max_age:
            return [dict(x) for x in cached_data]

    data: list[dict] = []
    for p in store.list_manifests():
        primary_runtime = (p.runtime.primary or "").lower()
        is_echo = "echo" in primary_runtime or "demo" in p.family.lower()
        if not include_demos and (not p.listable or (is_echo and "video" not in p.modalities)):
            continue
        ready = store.weights_ready(p)
        if not include_unready and not ready:
            continue

        primary = preferred_model_id(p)
        row = {
            "id": primary,
            "object": "model",
            "owned_by": "pantry",
            "package_id": p.id,
            "aliases": p.aliases,
            "role": p.role,
            "modalities": p.modalities,
            "quality_tier": p.quality_tier.value,
            "family": p.family,
            "template_family": p.template_family,
            "runtime": p.runtime.primary,
            "weights_ready": ready,
        }
        data.append(row)
        if include_package_ids and p.id != primary:
            data.append(
                {
                    "id": p.id,
                    "object": "model",
                    "owned_by": "pantry",
                    "package_id": p.id,
                    "root": primary,
                    "role": p.role,
                    "modalities": p.modalities,
                    "weights_ready": ready,
                }
            )
    _MODELS_CACHE[cache_key] = (now, data)
    return data
