from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from pantry.grammar import (
    StrictToolCallGuard,
    extract_json_block,
    generate_schema_mock,
    repair_truncated_json,
    validate_json_schema,
)
from pantry.server import create_app
from pantry.store import PackageStore


def test_repair_truncated_json() -> None:
    # 1. Blank string
    assert repair_truncated_json("") == "{}"

    # 2. Unclosed string
    repaired = repair_truncated_json('{"key": "value')
    data = json.loads(repaired)
    assert data["key"] == "value"

    # 3. Trailing comma and unclosed object
    repaired = repair_truncated_json('{"a": 1, "b": 2,')
    data = json.loads(repaired)
    assert data == {"a": 1, "b": 2}

    # 4. Nested structures
    repaired = repair_truncated_json('{"users": [{"id": 1, "name": "alice"')
    data = json.loads(repaired)
    assert data["users"][0]["id"] == 1
    assert data["users"][0]["name"] == "alice"

    # 5. Escaped quotes inside strings
    repaired = repair_truncated_json(r'{"quote": "He said \"hello\"')
    data = json.loads(repaired)
    assert data["quote"] == 'He said "hello"'


def test_extract_json_block() -> None:
    # Markdown fence
    text_fence = "Here is the result:\n```json\n{\"status\": \"ok\"}\n```\nHope that helps!"
    assert extract_json_block(text_fence) == '{"status": "ok"}'

    # Embedded in prose without fence
    text_prose = "I generated this response: {\"summary\": \"test\"} please check."
    assert extract_json_block(text_prose) == '{"summary": "test"}'

    # Array
    text_arr = "Results are: [1, 2, 3] end."
    assert extract_json_block(text_arr) == "[1, 2, 3]"


def test_schema_mock_and_validation() -> None:
    schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "age": {"type": "integer"},
            "is_active": {"type": "boolean"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "priority": {"type": "string", "enum": ["low", "high"]},
        },
        "required": ["name", "age", "priority"],
    }
    mock = generate_schema_mock(schema)
    valid, err = validate_json_schema(mock, schema)
    assert valid is True
    assert err is None
    assert isinstance(mock["name"], str)
    assert isinstance(mock["age"], int)
    assert mock["priority"] == "low"


def test_strict_tool_call_guard_parsing() -> None:
    tools = [
        {
            "type": "function",
            "function": {
                "name": "lookup_stock",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "ticker": {"type": "string"},
                        "days": {"type": "integer"},
                    },
                    "required": ["ticker"],
                },
            },
        }
    ]

    # Clean call
    raw = '<tool_call>{"name": "lookup_stock", "arguments": {"ticker": "AAPL", "days": 5}}</tool_call>'
    calls = StrictToolCallGuard.parse_and_validate(raw, tools=tools)
    assert calls is not None
    assert len(calls) == 1
    assert calls[0]["function"]["name"] == "lookup_stock"
    parsed_args = json.loads(calls[0]["function"]["arguments"])
    assert parsed_args["ticker"] == "AAPL"
    assert parsed_args["days"] == 5

    # Truncated call repaired
    raw_trunc = '<tool_call>{"name": "lookup_stock", "arguments": {"ticker": "GOOG"'
    calls_repaired = StrictToolCallGuard.parse_and_validate(raw_trunc, tools=tools)
    assert calls_repaired is not None
    assert len(calls_repaired) == 1
    repaired_args = json.loads(calls_repaired[0]["function"]["arguments"])
    assert repaired_args["ticker"] == "GOOG"

    # Forced tool_choice when no tags generated
    calls_forced = StrictToolCallGuard.parse_and_validate(
        "I will fetch that for you.",
        tools=tools,
        tool_choice={"type": "function", "function": {"name": "lookup_stock"}},
    )
    assert calls_forced is not None
    assert len(calls_forced) == 1
    assert calls_forced[0]["function"]["name"] == "lookup_stock"
    forced_args = json.loads(calls_forced[0]["function"]["arguments"])
    assert "ticker" in forced_args


def test_enforce_response_format() -> None:
    schema = {
        "type": "object",
        "properties": {
            "status": {"type": "string"},
            "code": {"type": "integer"},
        },
        "required": ["status", "code"],
    }
    rf = {
        "type": "json_schema",
        "json_schema": {"schema": schema},
    }
    # Model returns broken json
    raw = '{"status": "completed"'
    enforced = StrictToolCallGuard.enforce_response_format(raw, rf)
    parsed = json.loads(enforced)
    assert parsed["status"] == "completed"
    assert "code" in parsed


def test_api_grammar_validate(client: TestClient) -> None:
    schema = {
        "type": "object",
        "properties": {"city": {"type": "string"}, "temp": {"type": "number"}},
        "required": ["city"],
    }

    # 1. Valid JSON
    res1 = client.post(
        "/v1/grammar/validate",
        json={"content": '{"city": "Tokyo", "temp": 18.5}', "schema": schema},
    )
    assert res1.status_code == 200
    d1 = res1.json()
    assert d1["valid"] is True
    assert d1["repaired"] is False
    assert d1["parsed"]["city"] == "Tokyo"

    # 2. Truncated JSON with repair
    res2 = client.post(
        "/v1/grammar/validate",
        json={"content": '```json\n{"city": "Paris", "temp": 22', "schema": schema, "repair": True},
    )
    assert res2.status_code == 200
    d2 = res2.json()
    assert d2["valid"] is True
    assert d2["repaired"] is True
    assert d2["parsed"]["city"] == "Paris"

    # 3. Schema validation error
    res3 = client.post(
        "/v1/grammar/validate",
        json={"content": '{"temp": 22}', "schema": schema, "repair": False},
    )
    assert res3.status_code == 200
    d3 = res3.json()
    assert d3["valid"] is False
    assert "Schema validation error" in d3["error"]


def test_api_chat_completions_structured(client: TestClient) -> None:

    # 1. response_format json_object
    res1 = client.post(
        "/v1/chat/completions",
        json={
            "model": "demo-standard",
            "messages": [{"role": "user", "content": "Return a JSON object with your status"}],
            "response_format": {"type": "json_object"},
        },
    )
    assert res1.status_code == 200
    d1 = res1.json()
    content = d1["choices"][0]["message"]["content"]
    parsed1 = json.loads(content)
    assert "status" in parsed1

    # 2. response_format json_schema
    res2 = client.post(
        "/v1/chat/completions",
        json={
            "model": "demo-standard",
            "messages": [{"role": "user", "content": "Provide user details"}],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "schema": {
                        "type": "object",
                        "properties": {
                            "username": {"type": "string"},
                            "user_id": {"type": "integer"},
                        },
                        "required": ["username", "user_id"],
                    }
                },
            },
        },
    )
    assert res2.status_code == 200
    d2 = res2.json()
    parsed2 = json.loads(d2["choices"][0]["message"]["content"])
    assert "username" in parsed2
    assert "user_id" in parsed2

    # 3. Tool calling
    res3 = client.post(
        "/v1/chat/completions",
        json={
            "model": "demo-standard",
            "messages": [{"role": "user", "content": "What is the weather in Boston?"}],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "description": "Fetch weather",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "location": {"type": "string"},
                            },
                            "required": ["location"],
                        },
                    },
                }
            ],
            "tool_choice": {"type": "function", "function": {"name": "get_weather"}},
        },
    )
    assert res3.status_code == 200
    d3 = res3.json()
    tool_calls = d3["choices"][0]["message"]["tool_calls"]
    assert tool_calls is not None
    assert len(tool_calls) == 1
    assert tool_calls[0]["function"]["name"] == "get_weather"
    args = json.loads(tool_calls[0]["function"]["arguments"])
    assert "location" in args
