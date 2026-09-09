from __future__ import annotations

"""Unified-memory watchdog — Metal/MLX heap visibility + soft protection limits."""

import os
import time
from typing import Any

# Soft defaults: keep MLX free-cache from eating most of the recommended working set.
_DEFAULT_CACHE_RATIO = 0.45
_DEFAULT_MEMORY_RATIO = 0.85


def _fmt_bytes(n: int | None) -> str | None:
    if n is None:
        return None
    value = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(value) < 1024.0 or unit == "TB":
            if unit == "B":
                return f"{int(value)} {unit}"
            return f"{value:.2f} {unit}"
        value /= 1024.0
    return f"{n} B"


def _pressure(active: int | None, budget: int | None) -> str:
    if active is None or not budget:
        return "unknown"
    ratio = active / budget
    if ratio >= 0.85:
        return "critical"
    if ratio >= 0.55:
        return "elevated"
    return "ok"


def _load_mlx() -> Any | None:
    try:
        import mlx.core as mx  # type: ignore

        return mx
    except Exception:  # noqa: BLE001 — mlx optional
        return None


def device_budget(mx: Any) -> dict[str, Any]:
    info: dict[str, Any] = {}
    try:
        raw = mx.device_info()
        if isinstance(raw, dict):
            info = dict(raw)
    except Exception:  # noqa: BLE001
        try:
            raw = mx.metal.device_info()
            if isinstance(raw, dict):
                info = dict(raw)
        except Exception:  # noqa: BLE001, S110
            pass
    memory_size = int(info.get("memory_size") or info.get("total_memory") or 0) or None
    recommended = int(info.get("max_recommended_working_set_size") or 0) or None
    return {
        "device_name": info.get("device_name"),
        "architecture": info.get("architecture"),
        "memory_size_bytes": memory_size,
        "recommended_working_set_bytes": recommended,
        "max_buffer_length_bytes": int(info.get("max_buffer_length") or 0) or None,
    }


_last_snapshot: tuple[float, dict[str, Any]] | None = None


def snapshot(*, apply_limits: bool = False, max_age: float = 2.0) -> dict[str, Any]:
    """Return Metal/MLX heap stats for status / health surfaces."""
    global _last_snapshot
    now = time.time()
    if not apply_limits and _last_snapshot is not None:
        cached_at, cached_snap = _last_snapshot
        if now - cached_at < max_age:
            return dict(cached_snap)

    mx = _load_mlx()
    if mx is None:
        return {
            "ok": False,
            "available": False,
            "backend": None,
            "pressure": "unknown",
            "message": "mlx not installed — Metal heap metrics unavailable",
            "sampled_at": now,
        }

    metal_ok = False
    try:
        metal_ok = bool(mx.metal.is_available())
    except Exception:  # noqa: BLE001
        metal_ok = True  # assume Apple Silicon path if import worked

    active = peak = cache = None
    try:
        active = int(mx.get_active_memory())
        peak = int(mx.get_peak_memory())
        cache = int(mx.get_cache_memory())
    except Exception:  # noqa: BLE001, S110
        pass

    try:
        import sys

        if "torch" in sys.modules:
            import torch  # type: ignore

            if hasattr(torch, "backends") and hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                if hasattr(torch, "mps") and hasattr(torch.mps, "current_allocated_memory"):
                    mps_alloc = int(torch.mps.current_allocated_memory())
                    if mps_alloc > 0:
                        active = (active or 0) + mps_alloc
                        peak = max((peak or 0), active)
    except Exception:
        pass

    budget = device_budget(mx)
    recommended = budget.get("recommended_working_set_bytes")
    limits: dict[str, Any] = {"applied": False}
    if apply_limits:
        limits = apply_protection_limits(mx, recommended_working_set=recommended)

    pressure = _pressure(active, recommended)
    return {
        "ok": True,
        "available": True,
        "backend": "mlx-metal" if metal_ok else "mlx",
        "metal_available": metal_ok,
        "pressure": pressure,
        "active_bytes": active,
        "peak_bytes": peak,
        "cache_bytes": cache,
        "active_human": _fmt_bytes(active),
        "peak_human": _fmt_bytes(peak),
        "cache_human": _fmt_bytes(cache),
        "device": {
            **budget,
            "memory_size_human": _fmt_bytes(budget.get("memory_size_bytes")),
            "recommended_working_set_human": _fmt_bytes(recommended),
        },
        "limits": limits,
        "sampled_at": now,
        "message": _message(pressure, active, recommended),
    }
    if not apply_limits:
        _last_snapshot = (now, res)
    return res


def _message(pressure: str, active: int | None, recommended: int | None) -> str:
    if pressure == "critical":
        return (
            "Metal heap near recommended working set — unload models or lower "
            "PANTRY_METAL_CACHE_LIMIT_RATIO"
        )
    if pressure == "elevated":
        return "Metal heap elevated — pantry is reclaiming free cache under its limit"
    if active is None:
        return "Metal metrics unavailable"
    return (
        f"Metal heap {_fmt_bytes(active)} active"
        + (f" / {_fmt_bytes(recommended)} recommended" if recommended else "")
    )


def _env_int(name: str) -> int | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def apply_protection_limits(
    mx: Any | None = None,
    *,
    recommended_working_set: int | None = None,
) -> dict[str, Any]:
    """Cap MLX free-cache (and optionally graph memory) so unified RAM stays usable."""
    mx = mx or _load_mlx()
    if mx is None:
        return {"applied": False, "reason": "mlx unavailable"}

    if recommended_working_set is None:
        recommended_working_set = device_budget(mx).get("recommended_working_set_bytes")

    cache_limit = _env_int("PANTRY_METAL_CACHE_LIMIT_BYTES")
    if cache_limit is None and recommended_working_set:
        ratio = _env_float("PANTRY_METAL_CACHE_LIMIT_RATIO", _DEFAULT_CACHE_RATIO)
        cache_limit = int(recommended_working_set * max(0.05, min(ratio, 0.95)))

    memory_limit = _env_int("PANTRY_METAL_MEMORY_LIMIT_BYTES")
    if memory_limit is None and recommended_working_set:
        ratio = _env_float("PANTRY_METAL_MEMORY_LIMIT_RATIO", _DEFAULT_MEMORY_RATIO)
        memory_limit = int(recommended_working_set * max(0.1, min(ratio, 0.98)))

    out: dict[str, Any] = {"applied": True}
    if cache_limit is not None:
        try:
            previous = int(mx.set_cache_limit(cache_limit))
            out["cache_limit_bytes"] = cache_limit
            out["cache_limit_human"] = _fmt_bytes(cache_limit)
            out["previous_cache_limit_bytes"] = previous
        except Exception as e:  # noqa: BLE001
            out["cache_limit_error"] = str(e)

    if memory_limit is not None:
        try:
            previous = int(mx.set_memory_limit(memory_limit))
            out["memory_limit_bytes"] = memory_limit
            out["memory_limit_human"] = _fmt_bytes(memory_limit)
            out["previous_memory_limit_bytes"] = previous
        except Exception as e:  # noqa: BLE001
            out["memory_limit_error"] = str(e)

    return out


def clear_metal_cache() -> dict[str, Any]:
    """Best-effort reclaim of unused Metal/MLX cache pages."""
    mx = _load_mlx()
    before = snapshot(apply_limits=False)
    if mx is None:
        return {"ok": False, "cleared": False, "before": before, "after": before}
    try:
        mx.clear_cache()
    except Exception:  # noqa: BLE001
        try:
            mx.metal.clear_cache()
        except Exception as e:  # noqa: BLE001
            return {
                "ok": False,
                "cleared": False,
                "error": str(e),
                "before": before,
                "after": snapshot(apply_limits=False),
            }
    after = snapshot(apply_limits=False)
    try:
        import sys

        if "torch" in sys.modules:
            import torch  # type: ignore

            if hasattr(torch, "backends") and hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                if hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
                    torch.mps.empty_cache()
                    after = snapshot(apply_limits=False)
    except Exception:
        pass
    return {"ok": True, "cleared": True, "before": before, "after": after}


def get_available_unified_dram() -> int:
    """Determine currently available physical unified memory shared across CPU and GPU (Patent Claim 1 & Step 204)."""
    mx = _load_mlx()
    if mx is not None:
        budget = device_budget(mx)
        mem_size = budget.get("memory_size_bytes")
        active = 0
        try:
            active = int(mx.get_active_memory())
        except Exception:
            pass
        if mem_size and mem_size > 0:
            return max(1024 * 1024 * 512, mem_size - active)

    # Fallback to macOS sysctl hw.memsize
    try:
        import platform
        import subprocess

        if platform.system() == "Darwin":
            out = subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True, timeout=1).strip()
            total = int(out)
            return max(1024 * 1024 * 512, total)
    except Exception:
        pass

    return 16 * 1024 * 1024 * 1024  # 16 GB safe default


def estimate_kv_cache_bytes(
    context_tokens: int,
    params_b: float,
    bits_per_elem: int = 16,
) -> int:
    """Estimate KV cache memory footprint in bytes as a function of context length and model scale."""
    if context_tokens <= 0 or params_b <= 0:
        return 0
    bytes_per_token = max(32, int((params_b or 1.0) * 80)) * (bits_per_elem // 8)
    return int(context_tokens * bytes_per_token)


def calculate_usable_context(
    available_bytes: int,
    weights_bytes: int,
    params_b: float,
    max_context: int = 32768,
) -> int:
    """Calculate safe context window that fits in available unified memory without paging (Patent FIG. 2, Step 218)."""
    leftover = max(0, available_bytes - weights_bytes)
    if leftover <= 0:
        return min(512, max_context)
    bytes_per_token = max(32, int((params_b or 1.0) * 80)) * 2
    tokens = leftover // bytes_per_token
    return int(max(512, min(max_context, tokens)))

