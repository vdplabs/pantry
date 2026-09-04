from __future__ import annotations

from unittest.mock import MagicMock, patch

from pantry.memory import (
    _fmt_bytes,
    _pressure,
    apply_protection_limits,
    clear_metal_cache,
    snapshot,
)


def test_fmt_bytes():
    assert _fmt_bytes(512) == "512 B"
    assert _fmt_bytes(2048).endswith("KB")
    assert _fmt_bytes(None) is None


def test_pressure_levels():
    assert _pressure(100, 1000) == "ok"
    assert _pressure(600, 1000) == "elevated"
    assert _pressure(900, 1000) == "critical"
    assert _pressure(None, 1000) == "unknown"


def test_snapshot_without_mlx():
    with patch("pantry.memory._load_mlx", return_value=None):
        snap = snapshot()
    assert snap["available"] is False
    assert snap["pressure"] == "unknown"


def test_snapshot_with_mock_mlx():
    mx = MagicMock()
    mx.metal.is_available.return_value = True
    mx.get_active_memory.return_value = 1_000_000
    mx.get_peak_memory.return_value = 2_000_000
    mx.get_cache_memory.return_value = 100_000
    mx.device_info.return_value = {
        "device_name": "Apple M-Test",
        "memory_size": 16_000_000_000,
        "max_recommended_working_set_size": 12_000_000_000,
    }
    mx.set_cache_limit.return_value = 0
    mx.set_memory_limit.return_value = 0

    with patch("pantry.memory._load_mlx", return_value=mx):
        snap = snapshot(apply_limits=True)

    assert snap["available"] is True
    assert snap["active_bytes"] == 1_000_000
    assert snap["pressure"] == "ok"
    assert snap["limits"]["applied"] is True
    assert "cache_limit_bytes" in snap["limits"]


def test_health_includes_memory(client):
    r = client.get("/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert "memory" in body
    assert "pressure" in body["memory"]


def test_memory_endpoint(client):
    r = client.get("/v1/memory")
    assert r.status_code == 200
    body = r.json()
    assert "pressure" in body
    assert "limits_at_start" in body


def test_memory_clear_endpoint(client):
    r = client.post("/v1/memory/clear")
    assert r.status_code == 200
    body = r.json()
    assert "cleared" in body
    assert "before" in body


def test_apply_limits_without_mlx():
    with patch("pantry.memory._load_mlx", return_value=None):
        out = apply_protection_limits()
    assert out["applied"] is False


def test_clear_without_mlx():
    with patch("pantry.memory._load_mlx", return_value=None):
        out = clear_metal_cache()
    assert out["cleared"] is False
