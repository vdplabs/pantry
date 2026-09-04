from __future__ import annotations

from pantry.runtime import RuntimeHub
from pantry.store import PackageStore
from pantry.worker import IsolatedMLXRuntime


def test_isolated_mlx_runtime_lifecycle(tmp_path):
    store = PackageStore(tmp_path / "home")
    store.ensure()
    rt = IsolatedMLXRuntime(store)

    assert rt._process is None
    # Unload when process not started should be a safe no-op
    rt.unload()
    assert rt._process is None


def test_runtime_hub_worker_isolation_flag(tmp_path):
    store = PackageStore(tmp_path / "home")
    store.ensure()
    hub_direct = RuntimeHub(store, worker_isolation=False)
    assert not hub_direct.worker_isolation

    hub_isolated = RuntimeHub(store, worker_isolation=True)
    assert hub_isolated.worker_isolation
    assert isinstance(hub_isolated.mlx, IsolatedMLXRuntime)
