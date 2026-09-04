from __future__ import annotations

from pantry.catalog_sync import update_catalog_from_index
from pantry.store import PackageStore


def test_update_catalog_from_index(tmp_path):
    store = PackageStore(tmp_path / "home")
    store.ensure()

    sample_index = [
        {
            "id": "remote.pack1.v1",
            "family": "remote",
            "role": "chat",
            "quality_tier": "compact",
            "modalities": ["text"],
            "runtime": {"primary": "echo"},
        },
        {
            "id": "remote.pack2.v1",
            "family": "remote",
            "role": "chat",
            "quality_tier": "standard",
            "modalities": ["text"],
            "runtime": {"primary": "echo"},
        },
    ]

    res = update_catalog_from_index(store, sample_index)
    assert len(res["installed"]) == 2
    assert "remote.pack1.v1" in res["installed"]
    assert "remote.pack2.v1" in res["installed"]
    assert store.load_manifest("remote.pack1.v1") is not None

    # Re-running updates rather than duplicate installs
    res2 = update_catalog_from_index(store, sample_index)
    assert len(res2["installed"]) == 0
    assert len(res2["updated"]) == 2
