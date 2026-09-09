from __future__ import annotations

"""Tests for Patent FIG. 2 operational flow:
Capability resolution against dynamic hardware telemetry ceiling,
automated fallback resolution (Step 216), task-intent alignment,
usable context window, and Apple Silicon roofline TPS estimation.
"""

from unittest.mock import patch
import pytest

from pantry.hardware import (
    estimate_generation_tps,
    estimate_speculative_speedup,
    get_apple_silicon_device_info,
    get_memory_bandwidth_gbps,
)
from pantry.memory import calculate_usable_context, estimate_kv_cache_bytes
from pantry.resolve import ResolveError, resolve
from pantry.schemas import CapabilityRequest, QualityTier


def test_apple_silicon_roofline_tps():
    """Verify Apple Silicon bandwidth lookup and roofline throughput estimation."""
    info = get_apple_silicon_device_info()
    assert "device_name" in info
    assert info["bandwidth_gbps"] > 0

    # Test M1 Pro bandwidth (200 GB/s)
    bw_pro = get_memory_bandwidth_gbps("Apple M1 Pro")
    assert bw_pro == 200.0

    # 1.5B 4-bit model (~870 MB)
    model_bytes = int(870 * 1024 * 1024)
    tps = estimate_generation_tps(model_bytes, chip_name="Apple M1 Pro")
    # TPS = (200 / 0.85) * 0.55 ≈ 129 tok/s
    assert 100.0 <= tps <= 160.0

    # Test speculative speedup model
    target_bytes = int(870 * 1024 * 1024)  # 1.5B
    draft_bytes = int(290 * 1024 * 1024)   # 0.5B
    speedup_info = estimate_speculative_speedup(target_bytes, draft_bytes, chip_name="Apple M1 Pro")
    assert speedup_info["speedup"] > 1.0
    assert speedup_info["draft_tps"] > speedup_info["target_tps"]


def test_kv_cache_and_usable_context():
    """Verify context-aware memory calculation (Patent Step 218)."""
    # 1024 tokens for 1.5B model
    kv_bytes = estimate_kv_cache_bytes(1024, params_b=1.5)
    assert kv_bytes > 0

    # When available headroom is 4 GB and model weights are 1 GB
    available = 4 * 1024 * 1024 * 1024
    weights = 1 * 1024 * 1024 * 1024
    ctx = calculate_usable_context(available, weights, params_b=1.5, max_context=32768)
    assert ctx > 4096

    # When headroom is tight (only 150 KB leftover)
    tight_available = weights + (150 * 1024)
    tight_ctx = calculate_usable_context(tight_available, weights, params_b=1.5, max_context=32768)
    assert tight_ctx <= 1024


def test_patent_fig2_task_intent_coding(catalog_packages):
    """Verify task-intent alignment resolves specialized coding models without tag pinning."""
    req = CapabilityRequest(modality="chat", task_intent="coding")
    res = resolve(req, catalog_packages)
    # Should resolve to Qwen Coder rather than generic 0.5B or standard chat
    assert "coder" in res.package_id
    assert res.plan.get("quant_scheme") is not None
    assert res.plan.get("context_window", 0) > 0


def test_patent_fig2_task_intent_alias(catalog_packages):
    """Verify task alias 'task' in dict payload maps to task_intent."""
    req = CapabilityRequest.model_validate({"modality": "chat", "task": "coding"})
    assert req.task_intent == "coding"
    res = resolve(req, catalog_packages)
    assert "coder" in res.package_id


def test_patent_fig2_fallback_disabled_speculative(catalog_packages):
    """Patent Step 216: If composite footprint exceeds RAM budget, disable speculative decoding to run target standalone."""
    # vdplabs.qwen25-1.5b.standard.v1 has ram_gb_min=2, draft qwen25-0.5b has ram_gb_min=1 (composite=3 GB)
    req = CapabilityRequest(
        modality="chat",
        prefer_speculative=True,
        quality_tier=QualityTier.standard,
        family_prefer="qwen",
        ram_gb_max=2.5,  # 2.5 GB < 3 GB (composite), but >= 2 GB (target standalone)
        allow_fallback=True,
    )
    res = resolve(req, catalog_packages)
    assert res.package_id == "vdplabs.qwen25-1.5b.standard.v1"
    # Speculative decoding must be automatically disabled via Step 216 fallback
    assert res.plan["speculative"] is False
    assert res.plan.get("draft_package_id") is None
    assert "disabled_speculative" in res.plan.get("fallback_applied", [])


def test_patent_fig2_fallback_disabled_speculative_strict_fails(catalog_packages):
    """When allow_fallback=False and composite RAM exceeds budget, resolve fails closed."""
    req = CapabilityRequest(
        modality="chat",
        prefer_speculative=True,
        quality_tier=QualityTier.standard,
        family_prefer="qwen",
        ram_gb_max=2.5,
        allow_fallback=False,
    )
    with pytest.raises(ResolveError, match="speculative pair requires"):
        resolve(req, catalog_packages)


def test_patent_fig2_fallback_tier_downgrade(catalog_packages):
    """Patent Step 216: When standard tier exceeds RAM budget, downgrade to compact tier."""
    req = CapabilityRequest(
        modality="chat",
        quality_tier=QualityTier.standard,
        family_prefer="qwen",
        ram_gb_max=1.5,  # Standard needs min 2 GB; compact needs 1 GB
        allow_fallback=True,
    )
    res = resolve(req, catalog_packages)
    # Downgraded from standard to compact
    assert res.package_id == "vdplabs.qwen25-0.5b.compact.v1"
    assert "downgraded_tier_for_ram" in res.plan.get("fallback_applied", [])


def test_patent_fig2_execution_plan_output(catalog_packages):
    """Patent Step 218: Verify resolved execution plan outputs all required specifications."""
    req = CapabilityRequest(modality="chat", prefer_speculative=True)
    res = resolve(req, catalog_packages)
    plan = res.plan

    # Required Step 218 fields
    assert "runtime" in plan
    assert "quant_scheme" in plan
    assert "context_window" in plan
    assert "speculative" in plan
    assert "footprint_bytes" in plan
    assert "dynamic_ceiling_bytes" in plan
    assert plan["context_window"] > 0
    assert plan["estimated_tps"] is not None
    assert plan["estimated_tps"] > 0


def test_resolve_http_endpoint_with_task(client):
    """Verify HTTP /v1/resolve endpoint accepts task parameter and returns Step 218 ExecutionPlan."""
    r = client.post(
        "/v1/resolve",
        json={"modality": "chat", "task": "coding"},
    )
    assert r.status_code == 200
    body = r.json()
    assert "coder" in body["package_id"]
    assert "plan" in body
    assert body["plan"]["quant_scheme"] is not None
    assert body["plan"]["context_window"] > 0
    assert body["plan"]["estimated_tps"] is not None
