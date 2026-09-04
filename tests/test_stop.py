from __future__ import annotations

import pytest

from pantry.stop import StreamStopper, looks_like_repetition_loop, strip_at_stop


@pytest.mark.parametrize(
    "text,expected",
    [
        ("hello world", "hello world"),
        ("hello<|im_end|>world", "hello"),
        ("a<|im_start|>assistant", "a"),
        ("done</s>more", "done"),
    ],
)
def test_strip_at_stop(text, expected):
    assert strip_at_stop(text) == expected


def test_stream_stopper_halts_on_stop_string():
    s = StreamStopper()
    assert s.push("Hello ") == "Hello "
    assert s.push("there<|im_end|> and more") == "there"
    assert s.halted
    assert s.push("ignored") == ""


def test_looks_like_repetition_loop_line_spam():
    block = "- Canada\n- Mexico\n- Florida\n"
    text = block + block + block
    assert looks_like_repetition_loop(text)


def test_looks_like_repetition_loop_short_ok():
    assert not looks_like_repetition_loop("Canada and Mexico border the US.")


def test_stream_stopper_halts_on_loop():
    s = StreamStopper()
    block = (
        "United States borders the following countries:\n"
        "- Canada\n- Mexico\n- Florida\n- Puerto Rico\n"
    )
    assert s.push(block) == block
    # Restating the same block tips the line-cycle detector.
    assert s.push(block) == ""
    assert s.halted
