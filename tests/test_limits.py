from __future__ import annotations

import pytest

from pantry.limits import (
    HARD_MAX_TOKENS,
    REASONING_COMPACT_MAX_TOKENS,
    clamp_max_tokens,
    hard_max_tokens_for,
)
from pantry.schemas import PackageManifest


@pytest.mark.parametrize(
    "value,expected",
    [
        (None, 256),
        (0, 256),
        (-1, 256),
        (64, 64),
        (HARD_MAX_TOKENS + 100, HARD_MAX_TOKENS),
    ],
)
def test_clamp_max_tokens(value, expected):
    assert clamp_max_tokens(value) == expected


def test_clamp_caps_reasoning_compact():
    man = PackageManifest(
        id="vdplabs.deepseek-r1-distill-qwen-1.5b.compact.v1",
        family="deepseek-r1",
        role="reasoning",
        quality_tier="compact",
        params_b=1.5,
        modalities=["text"],
        runtime={"primary": "mlx"},
        aliases=["reasoning-compact"],
    )
    assert hard_max_tokens_for(man) == REASONING_COMPACT_MAX_TOKENS
    assert clamp_max_tokens(4096, manifest=man) == REASONING_COMPACT_MAX_TOKENS
    assert clamp_max_tokens(None, manifest=man) == 256  # default still under hard cap
