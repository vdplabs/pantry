import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from pantry.server import create_app
from pantry.store import PackageStore
from pantry.telemetry import (
    RequestLogTracker,
    TelemetryPersistenceManager,
    TokenMetricsTracker,
)


@pytest.fixture(autouse=True)
def reset_telemetry_state():
    """Ensure clean singletons before and after each test."""
    TokenMetricsTracker.get().reset_session()
    TokenMetricsTracker.get().reset_cumulative()
    RequestLogTracker.get().clear()
    TelemetryPersistenceManager.reset_instance()
    yield
    TokenMetricsTracker.get().reset_session()
    TokenMetricsTracker.get().reset_cumulative()
    RequestLogTracker.get().clear()
    TelemetryPersistenceManager.reset_instance()


def test_telemetry_persistence_manager_save_and_load(tmp_path: Path):
    mgr = TelemetryPersistenceManager.get(tmp_path)
    tracker = TokenMetricsTracker.get()
    req_tracker = RequestLogTracker.get()

    # Record some token metrics and requests
    tracker.record_completion(
        model="qwen-2.5-coder",
        prompt_tokens=150,
        completion_tokens=50,
        prefill_ms=45.0,
        decode_duration_s=1.0,
    )
    tracker.record_image_generation(model="flux-schnell", count=2, duration_ms=800.0)
    tracker.record_prefix_cache(cached_tokens=80, hit=True, saved_ms=30.0)

    req_tracker.record_request(
        model="qwen-2.5-coder",
        tokens_in=150,
        tokens_out=50,
        duration_ms=1045,
        status=200,
    )

    activity_events = [
        {"time": "12:00:00", "timestamp": 1000.0, "message": "Test event 1"},
        {"time": "12:01:00", "timestamp": 1060.0, "message": "Test event 2"},
    ]

    # Force save
    saved = mgr.save(activity_events=activity_events, force=True)
    assert saved is True
    assert mgr.state_file.exists()

    # Verify JSON content structure
    with open(mgr.state_file, "r") as f:
        data = json.load(f)
    assert data["version"] == 1
    assert data["token_metrics"]["cumulative_prompt_tokens"] == 150
    assert data["token_metrics"]["cumulative_completion_tokens"] == 50
    assert data["token_metrics"]["cumulative_images_generated"] == 2
    assert data["token_metrics"]["prefix_cache_hits"] == 1
    assert len(data["requests"]) == 1
    assert data["requests"][0]["model"] == "qwen-2.5-coder"
    assert len(data["activity_events"]) == 2

    # Simulate daemon restart: reset session and in-memory trackers
    tracker.reset_session()
    tracker.reset_cumulative()
    req_tracker.clear()
    assert tracker.cumulative_total_tokens == 0
    assert len(req_tracker.get_requests()) == 0

    # Load from persistence
    loaded_events = mgr.load()
    assert len(loaded_events) == 2
    assert loaded_events[0]["message"] == "Test event 1"

    # Verify cumulative token metrics and requests were restored
    assert tracker.session_total_tokens == 0  # session starts fresh at 0
    assert tracker.cumulative_prompt_tokens == 150
    assert tracker.cumulative_completion_tokens == 50
    assert tracker.cumulative_total_tokens == 200
    assert tracker.cumulative_images_generated == 2
    assert tracker.prefix_cache_hits == 1

    restored_requests = req_tracker.get_requests()
    assert len(restored_requests) == 1
    assert restored_requests[0]["model"] == "qwen-2.5-coder"

    # Per-model stats
    stats = tracker.stats()
    assert "qwen-2.5-coder" in stats["models"]
    assert stats["models"]["qwen-2.5-coder"]["cumulative_total_tokens"] == 200


def test_server_activity_log_persistence_across_restart(tmp_path: Path):
    store = PackageStore(root=tmp_path)
    app1 = create_app(store)
    client1 = TestClient(app1)

    # Initial state
    resp1 = client1.get("/v1/monitor/stats")
    assert resp1.status_code == 200
    data1 = resp1.json()
    assert "activity" in data1
    events1 = data1["activity"]["events"]
    assert len(events1) >= 1
    assert "Daemon started" in events1[0]["message"]

    # Record completion via tracker and force save
    TokenMetricsTracker.get().record_completion(
        model="llama-3.2-1b",
        prompt_tokens=100,
        completion_tokens=25,
    )
    TelemetryPersistenceManager.get(tmp_path).save(force=True)

    # Simulate second daemon startup on the same store root
    # Reset in-memory singletons first
    TokenMetricsTracker.get().reset_session()
    TokenMetricsTracker.get().reset_cumulative()
    TelemetryPersistenceManager.reset_instance()

    app2 = create_app(store)
    client2 = TestClient(app2)

    resp2 = client2.get("/v1/monitor/stats")
    assert resp2.status_code == 200
    data2 = resp2.json()

    # Verify cumulative tokens persisted
    assert data2["inference"]["cumulative"]["prompt_tokens"] == 100
    assert data2["inference"]["cumulative"]["completion_tokens"] == 25
    assert data2["inference"]["session"]["prompt_tokens"] == 0  # fresh session

    # Verify activity events persisted across restarts
    events2 = data2["activity"]["events"]
    daemon_start_events = [e for e in events2 if "Daemon started" in e["message"]]
    assert len(daemon_start_events) >= 2


def test_monitor_reset_session_vs_all(tmp_path: Path):
    store = PackageStore(root=tmp_path)
    app = create_app(store)
    client = TestClient(app)

    # Add metrics
    TokenMetricsTracker.get().record_completion(
        model="llama-3.2-1b",
        prompt_tokens=200,
        completion_tokens=50,
    )
    TelemetryPersistenceManager.get(tmp_path).save(force=True)

    # Reset session only
    resp = client.post("/v1/monitor/reset")
    assert resp.status_code == 200

    stats = client.get("/v1/monitor/stats").json()
    assert stats["inference"]["session"]["total_tokens"] == 0
    assert stats["inference"]["cumulative"]["total_tokens"] == 250

    # Reset all (cumulative + requests + persisted disk file)
    resp_all = client.post("/v1/monitor/reset?all=true")
    assert resp_all.status_code == 200

    stats_after = client.get("/v1/monitor/stats").json()
    assert stats_after["inference"]["session"]["total_tokens"] == 0
    assert stats_after["inference"]["cumulative"]["total_tokens"] == 0
    assert not (tmp_path / "telemetry_state.json").exists()
