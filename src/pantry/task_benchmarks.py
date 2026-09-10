from __future__ import annotations

"""Curated task-alignment matrix and multi-dimensional scoring for capability routing.

Implements intent-over-tags resolution:
Enables client applications to submit abstract intents (e.g. coding, reasoning, chat)
and resolves optimal model packages based on task alignment, quality, speed, and memory fit.
"""

from enum import Enum
from typing import Any

from pantry.schemas import PackageManifest


class TaskIntent(str, Enum):
    general = "general"
    coding = "coding"
    reasoning = "reasoning"
    chat = "chat"
    embed = "embed"


# Curated relative task-strength scores (0-100) per family
_FAMILY_TASK_BENCHMARKS: list[dict[str, Any]] = [
    {
        "patterns": ["qwen2.5-coder", "coder"],
        "scores": {"coding": 95.0, "reasoning": 78.0, "chat": 72.0, "general": 80.0},
    },
    {
        "patterns": ["deepseek-r1", "r1", "reasoning"],
        "scores": {"reasoning": 95.0, "coding": 82.0, "chat": 70.0, "general": 80.0},
    },
    {
        "patterns": ["llama3.2", "llama"],
        "scores": {"chat": 88.0, "general": 82.0, "coding": 68.0, "reasoning": 72.0},
    },
    {
        "patterns": ["qwen2.5", "qwen"],
        "scores": {"chat": 85.0, "general": 82.0, "coding": 68.0, "reasoning": 72.0},
    },
]

# Scoring weights per task intent: (quality, speed, fit, context)
_SCORING_WEIGHTS: dict[str, tuple[float, float, float, float]] = {
    "general": (0.45, 0.30, 0.15, 0.10),
    "coding": (0.50, 0.20, 0.15, 0.15),
    "reasoning": (0.55, 0.15, 0.15, 0.15),
    "chat": (0.40, 0.35, 0.15, 0.10),
    "embed": (0.30, 0.40, 0.20, 0.10),
}


def normalize_task_intent(raw: str | None) -> str:
    if not raw:
        return "general"
    norm = raw.strip().lower()
    if norm in {"code", "coding", "coder", "programming"}:
        return "coding"
    if norm in {"math", "reasoning", "thought", "analysis"}:
        return "reasoning"
    if norm in {"chat", "conversation", "dialogue"}:
        return "chat"
    if norm in {"embed", "embeddings", "vector"}:
        return "embed"
    return norm


def get_task_alignment_score(family: str, role: str, task: str) -> float:
    """Return task alignment score (0-100) based on family and role."""
    norm_task = normalize_task_intent(task)
    target = f"{family.lower()} {role.lower()}"

    for entry in _FAMILY_TASK_BENCHMARKS:
        for pat in entry["patterns"]:
            if pat in target:
                scores: dict[str, float] = entry["scores"]
                if norm_task in scores:
                    return scores[norm_task]
                return scores.get("general", 75.0)

    # Fallback heuristic
    if norm_task == "coding" and "coder" in target:
        return 90.0
    if norm_task == "reasoning" and ("r1" in target or "reason" in target):
        return 92.0
    return 70.0


def compute_composite_score(
    quality: float,
    speed: float,
    fit: float,
    context: float,
    task: str = "general",
) -> float:
    """Calculate multi-dimensional score (0-100) weighted by task intent."""
    norm_task = normalize_task_intent(task)
    wq, ws, wf, wc = _SCORING_WEIGHTS.get(norm_task, _SCORING_WEIGHTS["general"])
    score = (wq * quality) + (ws * speed) + (wf * fit) + (wc * context)
    return round(score, 2)


def score_package(
    pkg: PackageManifest,
    task: str,
    *,
    estimated_tps: float = 0.0,
    available_bytes: int = 0,
    requested_context: int = 4096,
) -> float:
    """Evaluate a package manifest across quality, speed, fit, and context dimensions."""
    # 1. Quality (0-100): Combines task alignment score, eval score, and model scale
    alignment = get_task_alignment_score(pkg.family, pkg.role, task)
    eval_score = (pkg.eval.score * 100.0) if pkg.eval and pkg.eval.score is not None else 70.0
    # Parameter scale factor: larger models get slight quality advantage if they fit
    param_scale = min(15.0, (pkg.params_b or 0.5) * 5.0)
    quality = min(100.0, (0.60 * alignment) + (0.30 * eval_score) + (0.10 * param_scale))

    # 2. Speed (0-100): Normalized tokens/sec with diminishing returns above interactive thresholds
    speed = min(100.0, max(20.0, 30.0 + (estimated_tps * 0.7))) if estimated_tps > 0 else 50.0

    # 3. Fit (0-100): Memory utilization sweet spot (50-80% of available memory is optimal)
    fit = 70.0
    pkg_bytes = getattr(pkg, "ram_gb_comfortable", 2.0) * 1024 * 1024 * 1024
    if available_bytes > 0:
        utilization = pkg_bytes / available_bytes
        if 0.40 <= utilization <= 0.85:
            fit = 95.0
        elif utilization < 0.40:
            fit = 80.0
        elif utilization <= 1.0:
            fit = 65.0
        else:
            fit = 20.0

    # 4. Context (0-100): Context window relative to target
    ctx_max = pkg.context_max or 4096
    context = min(100.0, (ctx_max / max(1, requested_context)) * 75.0)

    return compute_composite_score(quality, speed, fit, context, task)
