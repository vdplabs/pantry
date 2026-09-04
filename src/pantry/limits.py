from __future__ import annotations

from pantry.schemas import PackageManifest

# Soft caps so runaway clients (e.g. 16k default max_tokens) do not thrash small models.
DEFAULT_MAX_TOKENS = 256
HARD_MAX_TOKENS = 4096
# DeepSeek-R1 1.5B distill especially: long CoT budgets just amplify think-loops.
REASONING_COMPACT_MAX_TOKENS = 1024
REASONING_MAX_TOKENS = 2048


def hard_max_tokens_for(manifest: PackageManifest | None) -> int:
    if manifest is None:
        return HARD_MAX_TOKENS
    role = (manifest.role or "").lower()
    family = (manifest.family or "").lower()
    tier = (manifest.quality_tier or "").lower()
    params = float(manifest.params_b or 0)
    is_reasoning = (
        role == "reasoning"
        or "deepseek-r1" in family
        or "r1" in family
        or any("reason" in a.lower() for a in (manifest.aliases or []))
    )
    if not is_reasoning:
        return HARD_MAX_TOKENS
    if tier == "compact" or params <= 2.0:
        return REASONING_COMPACT_MAX_TOKENS
    return REASONING_MAX_TOKENS


def clamp_max_tokens(
    value: int | None,
    *,
    default: int = DEFAULT_MAX_TOKENS,
    manifest: PackageManifest | None = None,
) -> int:
    hard = hard_max_tokens_for(manifest)
    if value is None or value <= 0:
        return min(default, hard)
    return min(int(value), hard)
