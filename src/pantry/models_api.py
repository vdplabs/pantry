from __future__ import annotations

from pantry.schemas import PackageManifest
from pantry.store import PackageStore


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
) -> list[dict]:
    """Build OpenAI-style model rows — one primary id per package by default."""
    data: list[dict] = []
    for p in store.list_manifests():
        primary_runtime = (p.runtime.primary or "").lower()
        is_chat_echo = primary_runtime == "echo"
        if not include_demos and (not p.listable or is_chat_echo):
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
    return data
