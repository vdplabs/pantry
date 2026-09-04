from __future__ import annotations

import os
from pathlib import Path


def default_home() -> Path:
    """Metadata / state root (manifests, state.json)."""
    override = os.environ.get("PANTRY_HOME", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return (Path.home() / "Library" / "Application Support" / "VDPPantry").resolve()


def default_data(home: Path | None = None) -> Path:
    """Heavy content root (CAS blobs + pulled weight trees).

    Defaults to the same path as ``PANTRY_HOME`` so a single-volume layout
    keeps working. Set ``PANTRY_DATA`` (or alias ``PANTRY_BLOBS``) to put
    multi‑GB weights on an external APFS volume while keeping small metadata
    on the internal SSD.
    """
    override = (
        os.environ.get("PANTRY_DATA", "").strip()
        or os.environ.get("PANTRY_BLOBS", "").strip()
    )
    if override:
        return Path(override).expanduser().resolve()
    return (home or default_home()).resolve()


def bundled_catalog_dir() -> Path:
    """Locate sample package manifests (dev tree or wheel force-include)."""
    here = Path(__file__).resolve().parent
    candidates = [
        here.parent.parent / "catalog",  # pantry/src/pantry → pantry/catalog
        here / "catalog",  # site-packages/pantry/catalog (wheel)
        Path.cwd() / "catalog",
    ]
    for path in candidates:
        if path.is_dir():
            return path
    return candidates[0]
