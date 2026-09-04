from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pantry.config import bundled_catalog_dir
from pantry.schemas import PackageManifest
from pantry.server import create_app
from pantry.store import PackageStore


@pytest.fixture
def catalog_dir() -> Path:
    d = bundled_catalog_dir()
    assert d.is_dir(), f"missing catalog at {d}"
    return d


@pytest.fixture
def catalog_packages(catalog_dir) -> list[PackageManifest]:
    pkgs = []
    for man in sorted(catalog_dir.glob("*/manifest.json")):
        pkgs.append(PackageManifest.model_validate_json(man.read_text(encoding="utf-8")))
    return pkgs


@pytest.fixture
def client(tmp_path, catalog_dir):
    store = PackageStore(tmp_path / "pantry-home")
    store.ensure()
    store.seed_from_catalog(catalog_dir)
    app = create_app(store)
    return TestClient(app)
