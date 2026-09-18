from __future__ import annotations

from fastapi.testclient import TestClient

from pantry.schemas import ChatMessage, PackageManifest
from pantry.server import _parse_tool_calls, create_app
from pantry.store import PackageStore
from pantry.template import apply_chat_template


def test_tools_prompt_formatting():
    man = PackageManifest(
        id="test.tools",
        family="qwen2.5",
        template_family="chatml",
    )
    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get current weather in location",
                "parameters": {
                    "type": "object",
                    "properties": {"location": {"type": "string"}},
                    "required": ["location"],
                },
            },
        }
    ]
    msgs = [ChatMessage(role="user", content="What's the weather in Cupertino?")]
    prompt = apply_chat_template(man, msgs, tools=tools)
    assert "# Tools" in prompt
    assert "<tools>" in prompt
    assert "get_weather" in prompt
    assert "<tool_call>" in prompt


def test_parse_tool_calls():
    sample_out = (
        "I will look up the weather.\n"
        "<tool_call>\n"
        '{"name": "get_weather", "arguments": {"location": "San Francisco"}}\n'
        "</tool_call>"
    )
    calls = _parse_tool_calls(sample_out)
    assert calls is not None
    assert len(calls) == 1
    assert calls[0]["type"] == "function"
    assert calls[0]["function"]["name"] == "get_weather"
    assert '"San Francisco"' in calls[0]["function"]["arguments"]

    # No tool calls
    assert _parse_tool_calls("Just a regular response.") is None


def test_parse_tool_calls_multiple_formats():
    tools = [
        {"type": "function", "function": {"name": "get_weather", "parameters": {"type": "object", "properties": {"loc": {"type": "string"}}}}},
        {"type": "function", "function": {"name": "calculator", "parameters": {"type": "object", "properties": {"expr": {"type": "string"}}}}},
    ]

    # 1. Unclosed XML tag
    unclosed = 'I will calculate that: <tool_call>{"name": "calculator", "arguments": {"expr": "5*5"}}'
    calls = _parse_tool_calls(unclosed, tools=tools)
    assert calls is not None
    assert len(calls) == 1
    assert calls[0]["function"]["name"] == "calculator"

    # 2. Named function tag <function=get_weather>{"loc": "Paris"}</function>
    named_tag = 'Let me check: <function=get_weather>{"loc": "Paris"}</function>'
    calls = _parse_tool_calls(named_tag, tools=tools)
    assert calls is not None
    assert calls[0]["function"]["name"] == "get_weather"

    # 3. Mistral / Hermes format [TOOL_CALLS] [...]
    mistral_raw = '[TOOL_CALLS] [{"name": "calculator", "arguments": {"expr": "10+10"}}]'
    calls = _parse_tool_calls(mistral_raw, tools=tools)
    assert calls is not None
    assert calls[0]["function"]["name"] == "calculator"

    # 4. Markdown code fence
    markdown_fence = '```json\n{"name": "get_weather", "arguments": {"loc": "Tokyo"}}\n```'
    calls = _parse_tool_calls(markdown_fence, tools=tools)
    assert calls is not None
    assert calls[0]["function"]["name"] == "get_weather"

    # 5. Multiple tool calls in single turn
    multi = (
        '<tool_call>{"name": "get_weather", "arguments": {"loc": "London"}}</tool_call>\n'
        '<tool_call>{"name": "calculator", "arguments": {"expr": "42"}}</tool_call>'
    )
    calls = _parse_tool_calls(multi, tools=tools)
    assert calls is not None
    assert len(calls) == 2
    assert calls[0]["function"]["name"] == "get_weather"
    assert calls[1]["function"]["name"] == "calculator"


def test_multi_turn_tool_template_formatting():
    man = PackageManifest(
        id="test.multi.tools",
        family="qwen2.5",
        template_family="chatml",
    )
    msgs = [
        ChatMessage(role="user", content="What's 2+2?"),
        ChatMessage(
            role="assistant",
            content="",
            tool_calls=[
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "calculator", "arguments": '{"expr": "2+2"}'},
                }
            ],
        ),
        ChatMessage(role="tool", tool_call_id="call_1", content='{"result": 4}'),
    ]
    prompt = apply_chat_template(man, msgs)
    assert "<tool_call>" in prompt
    assert "calculator" in prompt
    assert "<tool_response>" in prompt
    assert '{"result": 4}' in prompt


class StreamingToolMockRuntime:
    async def complete(self, manifest, messages, **kwargs):
        return '<tool_call>{"name": "get_weather", "arguments": {"loc": "Honolulu"}}</tool_call>'

    async def stream(self, manifest, messages, **kwargs):
        chunks = ["<tool_call>", '{"name": "get_weather", ', '"arguments": {"loc": "Honolulu"}}', "</tool_call>"]
        for c in chunks:
            yield c


def test_streaming_chat_completions_with_tool_calls(tmp_path):
    import json

    store = PackageStore(tmp_path / "home")
    store.ensure()
    man = PackageManifest(
        id="vdplabs.demo-stream-tool.compact.v1",
        family="demo",
        role="chat",
        modalities=["text"],
        runtime={"primary": "echo"},
        aliases=["stream-tool-model"],
    )
    store.write_manifest(man)

    app = create_app(store)
    app.state.svc.runtimes.echo = StreamingToolMockRuntime()

    client = TestClient(app)
    tools = [
        {
            "type": "function",
            "function": {"name": "get_weather", "description": "weather info"},
        }
    ]
    resp = client.post(
        "/v1/chat/completions",
        json={
            "model": "stream-tool-model",
            "messages": [{"role": "user", "content": "How is Hawaii?"}],
            "tools": tools,
            "stream": True,
        },
    )
    assert resp.status_code == 200
    lines = [line for line in resp.text.split("\n") if line.startswith("data: ")]
    assert len(lines) >= 2

    # Parse SSE events
    events = []
    for line in lines:
        raw = line[len("data: ") :].strip()
        if raw == "[DONE]":
            break
        events.append(json.loads(raw))

    # Verify tool_calls delta chunk
    tool_delta_events = [e for e in events if e["choices"][0]["delta"].get("tool_calls")]
    assert len(tool_delta_events) >= 1
    tcs = tool_delta_events[0]["choices"][0]["delta"]["tool_calls"]
    assert tcs[0]["function"]["name"] == "get_weather"

    # Verify finish chunk has finish_reason = "tool_calls"
    finish_events = [e for e in events if e["choices"][0].get("finish_reason") == "tool_calls"]
    assert len(finish_events) == 1


def test_end_to_end_echo_tool_calling_and_second_turn(tmp_path):
    store = PackageStore(tmp_path / "home")
    store.ensure()
    man = PackageManifest(
        id="vdplabs.demo-tool-echo.compact.v1",
        family="demo",
        role="chat",
        modalities=["text"],
        runtime={"primary": "echo"},
        aliases=["chat-tool-echo"],
    )
    store.write_manifest(man)

    app = create_app(store)
    client = TestClient(app)

    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get current weather in location",
                "parameters": {
                    "type": "object",
                    "properties": {"location": {"type": "string"}},
                    "required": ["location"],
                },
            },
        }
    ]

    # Turn 1: Initial query triggering tool call
    resp1 = client.post(
        "/v1/chat/completions",
        json={
            "model": "chat-tool-echo",
            "messages": [{"role": "user", "content": "What is the weather in Seattle?"}],
            "tools": tools,
        },
    )
    assert resp1.status_code == 200
    data1 = resp1.json()
    choice1 = data1["choices"][0]
    assert choice1["finish_reason"] == "tool_calls"
    assert choice1["message"]["tool_calls"] is not None
    assert choice1["message"]["tool_calls"][0]["function"]["name"] == "get_weather"

    call_id = choice1["message"]["tool_calls"][0]["id"]

    # Turn 2: Providing tool result back to model
    resp2 = client.post(
        "/v1/chat/completions",
        json={
            "model": "chat-tool-echo",
            "messages": [
                {"role": "user", "content": "What is the weather in Seattle?"},
                choice1["message"],
                {"role": "tool", "tool_call_id": call_id, "content": '{"temp": "62F", "sky": "sunny"}'},
            ],
            "tools": tools,
        },
    )
    assert resp2.status_code == 200
    data2 = resp2.json()
    choice2 = data2["choices"][0]
    assert choice2["finish_reason"] == "stop"
    assert "62F" in choice2["message"]["content"] or "sunny" in choice2["message"]["content"]


def test_tool_choice_controls(tmp_path):
    store = PackageStore(tmp_path / "home")
    store.ensure()
    man = PackageManifest(
        id="vdplabs.demo-tool-ctrl.compact.v1",
        family="demo",
        role="chat",
        modalities=["text"],
        runtime={"primary": "echo"},
        aliases=["tool-ctrl-model"],
    )
    store.write_manifest(man)

    app = create_app(store)
    client = TestClient(app)

    tools = [
        {
            "type": "function",
            "function": {
                "name": "lookup_user",
                "parameters": {"type": "object", "properties": {"uid": {"type": "string"}}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "send_email",
                "parameters": {"type": "object", "properties": {"to": {"type": "string"}}},
            },
        },
    ]

    # 1. tool_choice="none" suppresses tool calls
    resp_none = client.post(
        "/v1/chat/completions",
        json={
            "model": "tool-ctrl-model",
            "messages": [{"role": "user", "content": "Lookup user 123"}],
            "tools": tools,
            "tool_choice": "none",
        },
    )
    assert resp_none.status_code == 200
    assert resp_none.json()["choices"][0]["finish_reason"] == "stop"
    assert resp_none.json()["choices"][0]["message"].get("tool_calls") is None

    # 2. specific forced tool_choice
    resp_forced = client.post(
        "/v1/chat/completions",
        json={
            "model": "tool-ctrl-model",
            "messages": [{"role": "user", "content": "Help me"}],
            "tools": tools,
            "tool_choice": {"type": "function", "function": {"name": "send_email"}},
        },
    )
    assert resp_forced.status_code == 200
    choice = resp_forced.json()["choices"][0]
    assert choice["finish_reason"] == "tool_calls"
    assert choice["message"]["tool_calls"][0]["function"]["name"] == "send_email"


