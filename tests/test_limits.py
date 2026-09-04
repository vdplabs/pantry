from __future__ import annotations

import pytest

from pantry.limits import HARD_MAX_TOKENS, clamp_max_tokens


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
