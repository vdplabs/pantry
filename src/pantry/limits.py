from __future__ import annotations

# Soft caps so runaway clients (e.g. 16k default max_tokens) do not thrash small models.
DEFAULT_MAX_TOKENS = 256
HARD_MAX_TOKENS = 4096


def clamp_max_tokens(value: int | None, *, default: int = DEFAULT_MAX_TOKENS) -> int:
    if value is None or value <= 0:
        return default
    return min(int(value), HARD_MAX_TOKENS)
