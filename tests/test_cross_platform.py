from __future__ import annotations

import platform
from unittest.mock import patch

from pantry.hardware import (
    _NVIDIA_BANDWIDTH_GBPS,
    estimate_generation_tps,
    get_hardware_device_info,
    get_memory_bandwidth_gbps,
)
from pantry.memory import clear_cache, get_available_unified_dram, snapshot
from pantry.runtime import CUDARuntime, EchoRuntime, MLXRuntime, RuntimeHub
from pantry.schemas import PackageManifest, RuntimeInfo
from pantry.store import PackageStore


def test_nvidia_bandwidth_lookup():
    assert get_memory_bandwidth_gbps("NVIDIA H100 SXM5 80GB HBM3") == 3350.0
    assert get_memory_bandwidth_gbps("NVIDIA A100-SXM4-80GB") == 2039.0
    assert get_memory_bandwidth_gbps("NVIDIA GeForce RTX 4090") == 1008.0
    assert get_memory_bandwidth_gbps("NVIDIA GH200 480GB") == 4000.0
    assert get_memory_bandwidth_gbps("NVIDIA B200") == 8000.0


def test_nvidia_roofline_tps():
    # 7B model at 4-bit (~3.5 GB) on H100 (3350 GB/s)
    # Bandwidth / model_size * efficiency = (3350 / 3.5) * 0.55 ~= 526 tps
    tps = estimate_generation_tps(int(3.5 * 1024 * 1024 * 1024), chip_name="NVIDIA H100 SXM5")
    assert tps > 400.0

    # 70B model at 4-bit (~35 GB) on H100
    tps_70b = estimate_generation_tps(int(35.0 * 1024 * 1024 * 1024), chip_name="NVIDIA H100 SXM5")
    assert 40.0 < tps_70b < 80.0


def test_hardware_device_info_structure():
    info = get_hardware_device_info()
    assert "device_name" in info
    assert "device_type" in info
    assert "is_apple_silicon" in info
    assert "is_nvidia" in info
    assert "memory_size_bytes" in info
    assert "bandwidth_gbps" in info
    assert info["bandwidth_gbps"] > 0


def test_cross_platform_memory_snapshot():
    snap = snapshot(apply_limits=False)
    assert snap.get("ok") is True
    assert snap.get("available") is True
    assert snap.get("backend") in {"mlx-metal", "mlx", "cuda", "cpu"}
    assert snap.get("active_bytes") is not None
    assert snap.get("pressure") in {"ok", "elevated", "critical", "unknown"}


def test_cross_platform_clear_cache():
    res = clear_cache()
    assert res.get("ok") is True
    assert "before" in res
    assert "after" in res


def test_get_available_unified_dram():
    dram = get_available_unified_dram()
    assert dram > 1024 * 1024 * 512  # At least 512 MB


def test_runtime_hub_cuda_and_fallback(tmp_path):
    store = PackageStore(tmp_path)
    hub = RuntimeHub(store)

    assert isinstance(hub.cuda, CUDARuntime)
    assert isinstance(hub.echo, EchoRuntime)

    # Test explicit cuda runtime manifest
    cuda_manifest = PackageManifest(
        id="test-cuda",
        title="Test CUDA",
        family="test",
        runtime=RuntimeInfo(primary="cuda", hf_repo="test/repo"),
    )
    assert isinstance(hub.for_manifest(cuda_manifest), CUDARuntime)

    # Test echo fallback
    echo_manifest = PackageManifest(
        id="test-echo",
        title="Test Echo",
        family="test",
        runtime=RuntimeInfo(primary="echo"),
    )
    assert isinstance(hub.for_manifest(echo_manifest), EchoRuntime)
