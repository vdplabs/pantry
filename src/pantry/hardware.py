from __future__ import annotations

"""Hardware detection and memory-bandwidth roofline modeling for Apple Silicon.

Leverages Apple Silicon architectural properties:
- Unified memory architecture (DRAM shared between CPU, GPU, Neural Engine).
- Memory-bandwidth bound LLM token generation (roofline model).
- Metal recommendedMaxWorkingSetSize ceiling for safe execution without paging.
"""

import platform
import subprocess
from typing import Any

# Memory bandwidth (GB/s) by chip family (sourced from Apple Silicon specifications)
_APPLE_SILICON_BANDWIDTH_GBPS: dict[str, float] = {
    # M1 Series
    "m1": 68.25,
    "m1 pro": 200.0,
    "m1 max": 400.0,
    "m1 ultra": 800.0,
    # M2 Series
    "m2": 100.0,
    "m2 pro": 200.0,
    "m2 max": 400.0,
    "m2 ultra": 800.0,
    # M3 Series
    "m3": 100.0,
    "m3 pro": 150.0,
    "m3 max": 350.0,
    "m3 ultra": 800.0,
    # M4 Series
    "m4": 120.0,
    "m4 pro": 273.0,
    "m4 max": 410.0,
    "m4 ultra": 820.0,
}

_DEFAULT_BANDWIDTH_GBPS = 100.0
_DEFAULT_MLX_EFFICIENCY = 0.55


def _detect_device_name_sysctl() -> str:
    if platform.system() != "Darwin":
        return platform.processor() or "Generic CPU"
    try:
        out = subprocess.check_output(
            ["sysctl", "-n", "machdep.cpu.brand_string"],
            text=True,
            timeout=1,
        ).strip()
        if out:
            return out
    except Exception:
        pass
    try:
        out = subprocess.check_output(
            ["sysctl", "-n", "hw.model"],
            text=True,
            timeout=1,
        ).strip()
        if out:
            return out
    except Exception:
        pass
    return "Apple Silicon"


def get_apple_silicon_device_info() -> dict[str, Any]:
    """Query Apple Silicon device properties from MLX or system fallbacks."""
    device_name = _detect_device_name_sysctl()
    memory_size_bytes = 0
    recommended_working_set_bytes = 0

    try:
        import mlx.core as mx  # type: ignore

        # Prefer mx.device_info() over deprecated mx.metal.device_info()
        raw = None
        if hasattr(mx, "device_info"):
            try:
                raw = mx.device_info()
            except Exception:
                pass
        if not raw and hasattr(mx, "metal") and hasattr(mx.metal, "device_info"):
            try:
                raw = mx.metal.device_info()
            except Exception:
                pass

        if isinstance(raw, dict):
            if raw.get("device_name"):
                device_name = str(raw["device_name"])
            memory_size_bytes = int(raw.get("memory_size") or raw.get("total_memory") or 0)
            recommended_working_set_bytes = int(
                raw.get("max_recommended_working_set_size") or 0
            )
    except Exception:
        pass

    if memory_size_bytes == 0 and platform.system() == "Darwin":
        try:
            mem_str = subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True, timeout=1).strip()
            memory_size_bytes = int(mem_str)
            recommended_working_set_bytes = int(memory_size_bytes * 0.75)
        except Exception:
            pass

    bandwidth = get_memory_bandwidth_gbps(device_name)
    is_apple_silicon = "apple" in device_name.lower() or platform.processor() == "arm"

    return {
        "device_name": device_name,
        "is_apple_silicon": is_apple_silicon,
        "memory_size_bytes": memory_size_bytes,
        "recommended_working_set_bytes": recommended_working_set_bytes,
        "bandwidth_gbps": bandwidth,
    }


def get_memory_bandwidth_gbps(chip_name: str | None = None) -> float:
    """Resolve Apple Silicon memory bandwidth (GB/s) from chip marketing name."""
    name = (chip_name or _detect_device_name_sysctl()).lower()
    # Match longest substring first (e.g. 'm1 max' before 'm1')
    for key in sorted(_APPLE_SILICON_BANDWIDTH_GBPS.keys(), key=len, reverse=True):
        if key in name:
            return _APPLE_SILICON_BANDWIDTH_GBPS[key]
    return _DEFAULT_BANDWIDTH_GBPS


def estimate_generation_tps(
    model_bytes: int,
    chip_name: str | None = None,
    efficiency: float = _DEFAULT_MLX_EFFICIENCY,
) -> float:
    """Roofline throughput estimation for autoregressive token generation.

    Formula: TPS = (bandwidth_GB_s / model_size_GB) * efficiency
    Valid on unified memory architectures where inference is memory-bandwidth bound.
    """
    if model_bytes <= 0:
        return 0.0
    bandwidth_gbps = get_memory_bandwidth_gbps(chip_name)
    model_gb = model_bytes / (1024.0 * 1024.0 * 1024.0)
    if model_gb <= 0:
        return 0.0
    tps = (bandwidth_gbps / model_gb) * efficiency
    return round(tps, 1)


def estimate_speculative_speedup(
    target_bytes: int,
    draft_bytes: int,
    chip_name: str | None = None,
    gamma: int = 4,
    acceptance_rate: float = 0.70,
) -> dict[str, Any]:
    """Estimate whether speculative decoding provides net acceleration.

    Args:
        target_bytes: Size of primary target model weights.
        draft_bytes: Size of low-parameter draft model weights.
        chip_name: Apple Silicon chip identifier.
        gamma: Number of candidate tokens generated per draft step.
        acceptance_rate: Average fraction of accepted draft tokens.

    Returns:
        Dict with target_tps, draft_tps, effective_speculative_tps, and speedup ratio.
    """
    target_tps = estimate_generation_tps(target_bytes, chip_name)
    draft_tps = estimate_generation_tps(draft_bytes, chip_name)

    if target_tps <= 0.0 or draft_tps <= 0.0:
        return {
            "target_tps": target_tps,
            "draft_tps": draft_tps,
            "speculative_tps": target_tps,
            "speedup": 1.0,
            "beneficial": False,
        }

    t_target = 1.0 / target_tps
    t_draft = 1.0 / draft_tps

    # Expected accepted tokens per speculation cycle = alpha * gamma + 1
    expected_accepted = (acceptance_rate * gamma) + 1.0
    # Time per cycle = (gamma * t_draft) + t_target (single parallel verification forward pass)
    cycle_time = (gamma * t_draft) + t_target
    speculative_tps = expected_accepted / cycle_time if cycle_time > 0 else target_tps
    speedup = speculative_tps / target_tps if target_tps > 0 else 1.0

    return {
        "target_tps": target_tps,
        "draft_tps": draft_tps,
        "speculative_tps": round(speculative_tps, 1),
        "speedup": round(speedup, 2),
        "beneficial": speedup > 1.05,
    }
