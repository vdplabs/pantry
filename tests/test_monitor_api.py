from __future__ import annotations

from starlette.testclient import TestClient

from pantry.server import create_app
from pantry.store import PackageStore
from pantry.telemetry import TokenMetricsTracker


def test_dashboard_endpoint(tmp_path):
    store = PackageStore(tmp_path)
    app = create_app(store)
    client = TestClient(app)

    # 1. GET /dashboard returns HTML5
    resp = client.get("/dashboard")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "Pantry · System Monitor" in resp.text
    assert "CPU Activity" in resp.text
    assert "AI Models in Memory" in resp.text

    # 2. GET / with text/html Accept header returns dashboard HTML
    resp_root_html = client.get("/", headers={"Accept": "text/html,application/xhtml+xml"})
    assert resp_root_html.status_code == 200
    assert "text/html" in resp_root_html.headers["content-type"]
    assert "Pantry · System Monitor" in resp_root_html.text

    # 3. GET / with json Accept header returns JSON dictionary
    resp_root_json = client.get("/", headers={"Accept": "application/json"})
    assert resp_root_json.status_code == 200
    data = resp_root_json.json()
    assert data["name"] == "pantry"
    assert data["dashboard"] == "/dashboard"
    assert data["monitor"] == "/v1/monitor/stats"


def test_monitor_stats_api(tmp_path):
    store = PackageStore(tmp_path)
    app = create_app(store)
    client = TestClient(app)

    resp = client.get("/v1/monitor/stats")
    assert resp.status_code == 200
    data = resp.json()

    assert data.get("ok") is True
    assert "device" in data
    assert "name" in data["device"]
    assert "architecture" in data["device"]

    assert "cpu" in data
    assert "overall_percent" in data["cpu"]
    assert "per_core_percent" in data["cpu"]

    assert "memory" in data
    assert "total_bytes" in data["memory"]
    assert "used_bytes" in data["memory"]

    assert "gpu" in data
    assert "utilization_percent" in data["gpu"]

    assert "network" in data
    assert "download_human_sec" in data["network"]

    assert "disk" in data
    assert "cas_chunks" in data["disk"]

    assert "ai_models" in data
    assert "resident_models" in data["ai_models"]

    assert "inference" in data
    assert "session" in data["inference"]
    assert "cumulative" in data["inference"]


def test_token_metrics_tracker_and_reset(tmp_path):
    tracker = TokenMetricsTracker.get()
    tracker.reset_session()

    tracker.record_completion(
        prompt_tokens=150,
        completion_tokens=50,
        prefill_ms=500.0,
        decode_duration_s=2.5,
        context_limit=4096,
        model_params_b=3.0,
    )

    stats = tracker.stats()
    assert stats["session"]["prompt_tokens"] == 150
    assert stats["session"]["completion_tokens"] == 50
    assert stats["session"]["total_tokens"] == 200
    assert stats["session"]["requests"] == 1
    assert stats["decode_tps"] == 20.0  # 50 / 2.5
    assert stats["prefill_tps"] == 300.0  # 150 / 0.5

    store = PackageStore(tmp_path)
    app = create_app(store)
    client = TestClient(app)

    # POST /v1/monitor/reset
    res = client.post("/v1/monitor/reset")
    assert res.status_code == 200
    assert res.json().get("ok") is True

    reset_stats = tracker.stats()
    assert reset_stats["session"]["total_tokens"] == 0
    # Cumulative should persist across session resets
    assert reset_stats["cumulative"]["total_tokens"] == 200
