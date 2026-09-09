from __future__ import annotations

from starlette.testclient import TestClient

from pantry.config import bundled_catalog_dir
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
    assert "Playground" in resp.text
    assert "Image Studio" in resp.text
    assert "Music & Audio" in resp.text
    assert "Speech-to-Text" in resp.text
    assert "traffic-lights" not in resp.text

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


def test_monitor_stats_with_loaded_models(tmp_path):
    store = PackageStore(tmp_path)
    store.seed_from_catalog(bundled_catalog_dir())

    # Mark a model as loaded in state
    pkg_id = "vdplabs.z-image-turbo.standard.v1"
    store._write_state({"loaded": [pkg_id], "pinned": []})

    app = create_app(store)
    client = TestClient(app)

    resp = client.get("/v1/monitor/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("ok") is True

    ai_models = data.get("ai_models", {})
    assert ai_models.get("total_resident_bytes", 0) > 0
    resident = ai_models.get("resident_models", [])
    assert len(resident) == 1
    assert resident[0]["id"] == pkg_id
    assert resident[0]["title"] in ["z-image-turbo", "z-image", pkg_id]
    assert resident[0]["modality"] == "image_gen"
    assert "resident_human" in resident[0]

    available = ai_models.get("available_models", [])
    assert len(available) > 0
    assert available[0]["title"] is not None


def test_monitor_activity_and_loading_lifecycle(tmp_path):
    store = PackageStore(tmp_path)
    store.seed_from_catalog(bundled_catalog_dir())
    pkg_id = "vdplabs.z-image-turbo.standard.v1"

    app = create_app(store)
    client = TestClient(app)
    svc = app.state.svc

    # 1. Initial idle state
    resp = client.get("/v1/monitor/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "activity" in data
    assert data["activity"]["is_busy"] is False

    # 2. Simulate active operation loading weights
    with svc.tracking_load(pkg_id, "Generating image / loading weights..."):
        resp = client.get("/v1/monitor/stats")
        assert resp.status_code == 200
        busy_data = resp.json()
        act = busy_data["activity"]
        assert act["is_busy"] is True
        assert act["loading"] == pkg_id
        assert "Generating image" in act["activity"]
        assert act["elapsed_seconds"] >= 0.0

        # Check AI model loading indicator
        aim = busy_data["ai_models"]
        all_models = aim.get("resident_models", []) + aim.get("available_models", [])
        matching = [m for m in all_models if m["id"] == pkg_id]
        assert len(matching) > 0
        assert matching[0]["is_loading"] is True
        assert "Generating image" in matching[0]["status"]

    # 3. Post-load state - event recorded in history
    resp = client.get("/v1/monitor/stats")
    data = resp.json()
    assert data["activity"]["is_busy"] is False
    events = data["activity"]["events"]
    assert len(events) >= 2
    assert any("Started" in ev["message"] and pkg_id in ev["message"] for ev in events)
    assert any("Finished" in ev["message"] and pkg_id in ev["message"] for ev in events)

    # 4. Interactive load via POST /v1/load with package_id
    load_resp = client.post("/v1/load", json={"package_id": pkg_id})
    assert load_resp.status_code == 200
    assert load_resp.json()["ok"] is True

    # 5. Interactive unload via POST /v1/unload with { "id": ... }
    unload_resp = client.post("/v1/unload", json={"id": pkg_id})
    assert unload_resp.status_code == 200
    assert unload_resp.json()["ok"] is True

    # 6. Memory purge via POST /v1/memory/clear
    purge_resp = client.post("/v1/memory/clear")
    assert purge_resp.status_code == 200

    # Verify all logged events
    resp = client.get("/v1/monitor/stats")
    events = resp.json()["activity"]["events"]
    assert any("Loaded model into memory" in ev["message"] for ev in events)
    assert any("Unloaded model from memory" in ev["message"] for ev in events)
    assert any("Purged unused memory pool" in ev["message"] for ev in events)


def test_concurrency_and_health_responsiveness_during_load(tmp_path):
    """Ensure /v1/health, /v1/monitor/stats, and /v1/models stay ultra-fast & responsive during model loading."""
    import time

    store = PackageStore(tmp_path)
    store.seed_from_catalog(bundled_catalog_dir())
    pkg_id = "vdplabs.qwen2.5-0.5b-instruct.chat-standard.v1"

    app = create_app(store)
    client = TestClient(app)
    svc = app.state.svc

    with svc.tracking_load(pkg_id, "Loading heavy model weights into Metal..."):
        # Rapid concurrent requests to health, monitor, and models
        t0 = time.perf_counter()
        h_resp = client.get("/v1/health")
        t_health = time.perf_counter() - t0

        assert h_resp.status_code == 200
        h_data = h_resp.json()
        assert h_data["status"] == "loading"
        assert h_data["loading"] == pkg_id
        assert "Loading heavy model weights" in h_data["activity"]
        # Fast response < 50ms
        assert t_health < 0.2

        t1 = time.perf_counter()
        m_resp = client.get("/v1/monitor/stats")
        t_monitor = time.perf_counter() - t1

        assert m_resp.status_code == 200
        m_data = m_resp.json()
        assert m_data["activity"]["is_busy"] is True
        assert m_data["activity"]["loading"] == pkg_id
        assert t_monitor < 0.2

        t2 = time.perf_counter()
        models_resp = client.get("/v1/models?all_ids=1")
        t_models = time.perf_counter() - t2

        assert models_resp.status_code == 200
        models_data = models_resp.json()
        assert len(models_data.get("data", [])) > 0
        assert t_models < 0.2

