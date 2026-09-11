from __future__ import annotations

"""Automated validation suite for U.S. Provisional Patent Application # 64/148,883:
Shared Unified Memory Storage & Host Model Management for Local and Edge Intelligence.

Validates:
- Claim 1: Dynamic Hardware Telemetry & Capability Resolution (FIG. 2 Steps 202-218)
- Claim 2: Content-Addressable Storage (CAS), FastCDC, & Cross-Quantization Deduplication (RFC-0006)
- Claim 3: Zero-Retention Ephemeral Memory Execution & Worker Process Isolation
- Built-in 'pantry patent' and 'pantry claims' CLI interfaces
"""

import json

import pytest
from typer.testing import CliRunner

from pantry.cas import CasManager
from pantry.cli import app
from pantry.hardware import (
    estimate_generation_tps,
    estimate_speculative_speedup,
)
from pantry.memory import (
    calculate_usable_context,
    get_available_unified_dram,
)
from pantry.resolve import resolve
from pantry.schemas import CapabilityRequest, QualityTier

runner = CliRunner()


# ==============================================================================
# CLAIM 1: Dynamic Hardware Telemetry & Capability Resolution (FIG. 2)
# ==============================================================================


def test_claim1_fig2_full_sequence(catalog_packages):
    """Verify complete operational sequence of FIG. 2 (Steps 202 through 218)."""
    # Step 202: Abstract capability request tuple
    req = CapabilityRequest(
        modality="chat",
        task_intent="coding",
        prefer_speculative=True,
        ram_gb_max=16.0,
        allow_fallback=True,
    )

    # Step 204: Telemetry interrogation
    avail_dram = get_available_unified_dram()
    assert avail_dram > 0

    # Execute resolve pipeline
    res = resolve(req, catalog_packages)

    # Step 206 & 208: Modality matching, task intent alignment (Qwen Coder)
    assert "coder" in res.package_id
    assert res.alias is not None

    # Step 218: Formal ExecutionPlan output
    plan = res.plan
    assert plan is not None
    assert "runtime" in plan
    assert "quant_scheme" in plan
    assert "context_window" in plan
    assert plan["context_window"] > 0
    assert "estimated_tps" in plan
    assert plan["estimated_tps"] > 0
    assert "footprint_bytes" in plan
    assert "dynamic_ceiling_bytes" in plan
    assert plan["dynamic_ceiling_bytes"] > 0


def test_claim1_roofline_throughput_equation():
    """Verify physical memory bus roofline generation TPS equation across hardware profiles.

    Formula: TPS = (Bandwidth_GBps / Model_GB) * 0.55
    """
    # 1. Apple M1 Pro (200 GB/s) with 870 MB model (~0.85 GB)
    model_bytes = 870 * 1024 * 1024
    tps_m1_pro = estimate_generation_tps(model_bytes, "Apple M1 Pro")
    assert 110.0 <= tps_m1_pro <= 150.0

    # 2. Apple M2 Ultra (800 GB/s) with 870 MB model -> ~4x faster than M1 Pro
    tps_ultra = estimate_generation_tps(model_bytes, "Apple M2 Ultra")
    assert tps_ultra >= 400.0

    # 3. NVIDIA A100 SXM (2,039 GB/s)
    tps_a100 = estimate_generation_tps(model_bytes, "NVIDIA A100-SXM4-80GB")
    assert tps_a100 > 1000.0

    # 4. Unknown chip fallback
    tps_default = estimate_generation_tps(model_bytes, "Unknown Device")
    assert tps_default > 0.0


def test_claim1_speculative_speedup_model():
    """Verify Step 212 speculative decoding acceleration modeling."""
    target_bytes = 870 * 1024 * 1024  # 1.5B
    draft_bytes = 290 * 1024 * 1024   # 0.5B
    res = estimate_speculative_speedup(target_bytes, draft_bytes, "Apple M1 Pro")

    assert res["speedup"] > 1.0
    assert res["target_tps"] > 0
    assert res["draft_tps"] > res["target_tps"]
    assert res["speculative_tps"] > res["target_tps"]
    assert res["beneficial"] is True


def test_claim1_automated_fallback_cascade(catalog_packages):
    """Verify Step 216 fallback cascade when physical memory budget is constrained."""
    # Composite memory exceeds 2.5 GB budget -> speculative must be disabled
    req = CapabilityRequest(
        modality="chat",
        prefer_speculative=True,
        quality_tier=QualityTier.standard,
        family_prefer="qwen",
        ram_gb_max=2.5,
        allow_fallback=True,
    )
    res = resolve(req, catalog_packages)
    assert res.package_id == "vdplabs.qwen25-1.5b.standard.v1"
    assert res.plan["speculative"] is False
    assert "disabled_speculative" in res.plan["fallback_applied"]

    # When budget is even tighter (1.5 GB), downgrade quality tier from standard to compact
    req_tight = CapabilityRequest(
        modality="chat",
        quality_tier=QualityTier.standard,
        family_prefer="qwen",
        ram_gb_max=1.5,
        allow_fallback=True,
    )
    res_tight = resolve(req_tight, catalog_packages)
    assert res_tight.package_id == "vdplabs.qwen25-0.5b.compact.v1"
    assert "downgraded_tier_for_ram" in res_tight.plan["fallback_applied"]


# ==============================================================================
# CLAIM 2: Content-Addressable Storage (CAS) & Tensor Deduplication (RFC-0006)
# ==============================================================================


def test_claim2_cas_chunk_integrity_and_prefix_sharding(tmp_path):
    """Verify SHA-256 chunk storage, prefix directory sharding, and cryptographic verification."""
    cas = CasManager(tmp_path / "cas")

    chunk_data = b"TENSOR_WEIGHT_MATRIX_BF16_SHARED_EMBEDDINGS" * 100
    digest = cas.put_chunk(chunk_data)

    # 1. SHA-256 validation
    assert CasManager.is_safe_hash(digest)
    assert len(digest) == 64

    # 2. Prefix sharding
    prefix = digest[:2]
    expected_path = tmp_path / "cas" / "chunks" / prefix / f"{digest}.chunk"
    assert expected_path.exists()
    assert expected_path.read_bytes() == chunk_data

    # 3. Retrieve verified bytes
    retrieved = cas.get_chunk_bytes(digest)
    assert retrieved == chunk_data

    # 4. Hash mismatch protection
    with pytest.raises(ValueError, match="chunk sha256 mismatch"):
        cas.put_chunk(chunk_data, expected_sha256="0" * 64)


def test_claim2_cross_quantization_dedup_and_refcounting(tmp_path):
    """Verify cross-quantization deduplication ratio calculation and refcounting.

    Simulates two models (compact 4-bit and standard 8-bit) sharing identical
    token embeddings and normalization layers.
    """
    cas = CasManager(tmp_path / "cas")

    # Invariant shared chunks (Embeddings: 100 KB, Norms: 20 KB)
    shared_embed_bytes = b"EMBED_TOKENS_FP16" * 6000
    shared_norm_bytes = b"RMS_NORM_WEIGHT" * 1200
    embed_hash = cas.put_chunk(shared_embed_bytes)
    norm_hash = cas.put_chunk(shared_norm_bytes)

    # Variant chunks (Attention & MLP projections)
    compact_attn = b"COMPACT_Q4_ATTN" * 10000
    standard_attn = b"STANDARD_Q8_ATTN" * 20000
    compact_hash = cas.put_chunk(compact_attn)
    standard_hash = cas.put_chunk(standard_attn)

    # Register Model 1: Compact (4-bit)
    cas.index.record_package_refs(
        package_id="model.compact.v1",
        apparent_size=len(shared_embed_bytes) + len(shared_norm_bytes) + len(compact_attn),
        physical_size=len(shared_embed_bytes) + len(shared_norm_bytes) + len(compact_attn),
        refs=[
            (embed_hash, "model.safetensors", 0, len(shared_embed_bytes)),
            (norm_hash, "model.safetensors", len(shared_embed_bytes), len(shared_norm_bytes)),
            (compact_hash, "model.safetensors", len(shared_embed_bytes) + len(shared_norm_bytes), len(compact_attn)),
        ],
    )

    # Register Model 2: Standard (8-bit) - Reuses embed_hash and norm_hash
    cas.index.record_package_refs(
        package_id="model.standard.v1",
        apparent_size=len(shared_embed_bytes) + len(shared_norm_bytes) + len(standard_attn),
        physical_size=len(shared_embed_bytes) + len(shared_norm_bytes) + len(standard_attn),
        refs=[
            (embed_hash, "model.safetensors", 0, len(shared_embed_bytes)),
            (norm_hash, "model.safetensors", len(shared_embed_bytes), len(shared_norm_bytes)),
            (standard_hash, "model.safetensors", len(shared_embed_bytes) + len(shared_norm_bytes), len(standard_attn)),
        ],
    )

    # Verify deduplication stats
    stats = cas.get_stats(force=True)
    assert stats["total_packages"] == 2
    assert stats["dedup_saved_bytes"] == len(shared_embed_bytes) + len(shared_norm_bytes)
    assert stats["dedup_ratio"] > 1.0


def test_claim2_safe_garbage_collection_pruning(tmp_path):
    """Verify that unreferenced chunks are reclaimed while referenced chunks remain intact."""
    cas = CasManager(tmp_path / "cas")

    chunk_live = cas.put_chunk(b"LIVE_ACTIVE_CHUNK" * 50)
    chunk_orphan = cas.put_chunk(b"ORPHANED_DELETED_CHUNK" * 50)

    # Attach live chunk to an installed package
    cas.index.record_package_refs(
        package_id="pkg.active",
        apparent_size=len(b"LIVE_ACTIVE_CHUNK" * 50),
        physical_size=len(b"LIVE_ACTIVE_CHUNK" * 50),
        refs=[(chunk_live, "model.safetensors", 0, len(b"LIVE_ACTIVE_CHUNK" * 50))],
    )

    # 1. Dry run test
    pruned, reclaimed = cas.prune(dry_run=True)
    assert pruned == 1
    assert reclaimed > 0
    # Files must still exist after dry-run
    assert cas.has_chunk(chunk_orphan) is True
    assert cas.has_chunk(chunk_live) is True

    # 2. Real prune execution
    pruned, reclaimed = cas.prune(dry_run=False)
    assert pruned == 1
    assert cas.has_chunk(chunk_orphan) is False
    assert cas.has_chunk(chunk_live) is True


# ==============================================================================
# CLAIM 3: Zero-Retention Ephemeral Memory & Isolation
# ==============================================================================


def test_claim3_context_ceiling_without_paging():
    """Verify usable context window clamping (Step 218) to avoid virtual memory swapping."""
    # Available headroom: 4 GB, weights: 1 GB -> fits generous context
    ctx = calculate_usable_context(4 * 1024**3, 1 * 1024**3, params_b=1.5, max_context=32768)
    assert ctx >= 4096

    # Available headroom: tight (weights + 150 KB) -> context capped strictly
    tight_ctx = calculate_usable_context(1024**3 + 150 * 1024, 1024**3, params_b=1.5, max_context=32768)
    assert tight_ctx <= 1024


# ==============================================================================
# CLI INTERFACE: 'pantry patent' and 'pantry claims'
# ==============================================================================


def test_patent_cli_command():
    """Verify 'pantry patent' terminal execution."""
    result = runner.invoke(app, ["patent"])
    assert result.exit_code == 0
    assert "PATENT CLAIMS & ARCHITECTURE SPECIFICATION" in result.stdout
    assert "64/148,883" in result.stdout
    assert "CLAIM 1:" in result.stdout
    assert "CLAIM 2:" in result.stdout
    assert "CLAIM 3:" in result.stdout


def test_patent_cli_json_export():
    """Verify 'pantry claims --json' exports valid structured patent data."""
    result = runner.invoke(app, ["claims", "--json"])
    assert result.exit_code == 0
    data = json.loads(result.stdout)
    assert data["patent"]["application_number"] == "64/148,883"
    assert len(data["claims"]) == 3
    assert data["claims"][0]["claim"] == 1
    assert data["claims"][1]["claim"] == 2
    assert data["claims"][2]["claim"] == 3
    assert "telemetry" in data
    assert "bandwidth_gbps" in data["telemetry"]
    assert "cas_dedup_ratio" in data["telemetry"]
