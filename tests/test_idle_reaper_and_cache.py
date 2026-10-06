from __future__ import annotations

import time
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from pantry.cli import app as cli_app
from pantry.config import bundled_catalog_dir
from pantry.runtime import RuntimeHub
from pantry.server import Service, create_app
from pantry.store import PackageStore


def test_idle_reaper_evicts_expired_unpinned_models(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    store = PackageStore(tmp_path / "pantry-home")
    store.ensure()

    # Configure short idle timeout of 2 seconds
    monkeypatch.setenv("PANTRY_IDLE_TIMEOUT", "2")
    svc = Service(store)

    # Mark model as loaded
    model_id = "test-model-1"
    store.mark_loaded(model_id)
    svc.touch_model(model_id)

    assert model_id in store.read_state()["loaded"]

    # Initially not expired
    evicted = svc.reap_idle_models()
    assert evicted == []
    assert model_id in store.read_state()["loaded"]

    # Advance time artificially
    svc._model_last_used[model_id] = time.time() - 5.0

    # Reaper should evict
    evicted = svc.reap_idle_models()
    assert model_id in evicted
    assert model_id not in store.read_state()["loaded"]


def test_idle_reaper_preserves_pinned_models(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    store = PackageStore(tmp_path / "pantry-home")
    store.ensure()

    monkeypatch.setenv("PANTRY_IDLE_TIMEOUT", "1")
    svc = Service(store)

    model_id = "pinned-model"
    store.mark_loaded(model_id, pin=True)
    svc.touch_model(model_id)

    # Artificially age model
    svc._model_last_used[model_id] = time.time() - 10.0

    evicted = svc.reap_idle_models()
    assert evicted == []
    assert model_id in store.read_state()["loaded"]
    assert model_id in store.read_state()["pinned"]


def test_runtime_hub_unload_clears_all_modalities(tmp_path: Path):
    store = PackageStore(tmp_path / "pantry-home")
    store.ensure()
    hub = RuntimeHub(store)

    # Attach mock runtimes for each modality
    mock_mflux = MagicMock()
    mock_vision = MagicMock()
    mock_audio = MagicMock()
    mock_rerank = MagicMock()
    mock_embed = MagicMock()

    hub._mflux_image = mock_mflux
    hub._mlx_vision = mock_vision
    hub._whisper_audio = mock_audio
    hub._rerank_runtime = mock_rerank
    hub._embed_runtime = mock_embed

    # Unload specific package
    hub.unload("target-pkg")

    mock_mflux.unload.assert_called_once_with("target-pkg")
    mock_vision.unload.assert_called_once_with("target-pkg")
    mock_audio.unload.assert_called_once_with("target-pkg")
    mock_rerank.unload.assert_called_once_with("target-pkg")
    mock_embed.unload.assert_called_once_with("target-pkg")


def test_cli_cache_clean_and_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    pantry_home = tmp_path / "pantry-home"
    store = PackageStore(pantry_home)
    store.ensure()

    # Fake HF hub cache
    hf_cache = tmp_path / "hf_hub"
    hf_cache.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("HF_HUB_CACHE", str(hf_cache))
    monkeypatch.delenv("PANTRY_DATA", raising=False)
    monkeypatch.delenv("PANTRY_BLOBS", raising=False)

    # Create dummy incomplete and lock files
    incomplete_file = hf_cache / "model.safetensors.incomplete"
    incomplete_file.write_bytes(b"x" * 1024)
    lock_file = hf_cache / "download.lock"
    lock_file.write_bytes(b"lock")

    # Create dummy orphaned CAS chunk
    cas_chunks = store.cas_dir / "chunks"
    cas_chunks.mkdir(parents=True, exist_ok=True)
    orphan_chunk = cas_chunks / "orphan123456"
    orphan_chunk.write_bytes(b"chunk-data")

    runner = CliRunner()

    # Test status
    res_status = runner.invoke(cli_app, ["cache", "status", "--home", str(pantry_home)])
    assert res_status.exit_code == 0
    assert "Pantry Cache Storage Status" in res_status.stdout
    assert "Incomplete/lock files" in res_status.stdout

    # Test dry run clean
    res_dry = runner.invoke(cli_app, ["cache", "clean", "--dry-run", "--home", str(pantry_home)])
    assert res_dry.exit_code == 0
    assert "DRY RUN" in res_dry.stdout
    assert incomplete_file.is_file()
    assert orphan_chunk.is_file()

    # Test clean executed
    res_clean = runner.invoke(cli_app, ["cache", "clean", "--home", str(pantry_home)])
    assert res_clean.exit_code == 0
    assert "EXECUTED" in res_clean.stdout
    assert not incomplete_file.exists()
    assert not lock_file.exists()
    assert not orphan_chunk.exists()


def test_pull_status_and_streaming_sse(tmp_path: Path):
    store = PackageStore(tmp_path / "pantry-home")
    store.ensure()
    store.seed_from_catalog(bundled_catalog_dir())

    app = create_app(store)
    client = TestClient(app)

    # 1. Check pull status
    r_stat = client.get("/v1/pull/vdplabs.demo-chat.compact.v1")
    assert r_stat.status_code == 200
    assert r_stat.json()["package_id"] == "vdplabs.demo-chat.compact.v1"

    # 2. Test streaming SSE pull on demo package
    r_stream = client.post("/v1/pull", json={"package_id": "vdplabs.demo-chat.compact.v1", "stream": True})
    assert r_stream.status_code == 200
    assert "text/event-stream" in r_stream.headers["content-type"]
    text = r_stream.text
    assert "data:" in text
    assert '"ready"' in text


def test_pull_rejects_insufficient_disk_space(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from collections import namedtuple

    from pantry.pull import PullError, pull_package
    from pantry.schemas import PackageManifest, QualityTier, RuntimeInfo

    store = PackageStore(tmp_path / "home", data_root=tmp_path / "data")
    store.ensure()

    # Create dummy manifest with ram_gb_min = 24.0 GB (~20.4 GB disk estimation)
    man = PackageManifest(
        id="test.large-model.v1",
        family="test",
        quality_tier=QualityTier.standard,
        modalities=["text"],
        runtime=RuntimeInfo(primary="mlx", hf_repo="test/large-model"),
        ram_gb_min=24.0,
    )
    store.write_manifest(man)

    # Mock disk_usage to return only 2 GB free (less than 20GB + 5GB safety headroom)
    Usage = namedtuple("Usage", ["total", "used", "free"])
    monkeypatch.setattr("shutil.disk_usage", lambda _: Usage(100 * 1024**3, 98 * 1024**3, 2 * 1024**3))

    with pytest.raises(PullError) as exc_info:
        pull_package(store, "test.large-model.v1")

    assert "Insufficient disk space" in str(exc_info.value)
    assert "safety margin" in str(exc_info.value)


def test_reaper_evicts_early_under_critical_pressure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    store = PackageStore(tmp_path / "pantry-home")
    store.ensure()

    # Normal TTL is 300s
    monkeypatch.setenv("PANTRY_IDLE_TIMEOUT", "300")
    svc = Service(store)

    model_id = "test-heavy-model"
    store.mark_loaded(model_id)
    svc.touch_model(model_id)

    # Age model by only 35 seconds (less than 300s TTL)
    svc._model_last_used[model_id] = time.time() - 35.0

    # Normal reap should NOT evict
    evicted = svc.reap_idle_models()
    assert evicted == []

    # Mock memory snapshot to report critical pressure
    monkeypatch.setattr("pantry.memory.snapshot", lambda max_age=5.0: {"pressure": "critical"})

    # Reaper under critical pressure should aggressively evict (threshold 30s)
    evicted_crit = svc.reap_idle_models()
    assert model_id in evicted_crit
    assert model_id not in store.read_state()["loaded"]


