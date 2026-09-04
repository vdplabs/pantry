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


class ToolMockRuntime:
    async def complete(self, manifest, messages, **kwargs):
        tools = kwargs.get("tools")
        if tools:
            return '<tool_call>{"name": "calculator", "arguments": {"expr": "2+2"}}</tool_call>'
        return "Regular text answer"

    async def stream(self, manifest, messages, **kwargs):
        yield await self.complete(manifest, messages, **kwargs)


def test_chat_completions_with_tool_calls(tmp_path, monkeypatch):
    store = PackageStore(tmp_path / "home")
    store.ensure()
    man = PackageManifest(
        id="vdplabs.demo-tool.compact.v1",
        family="demo",
        role="chat",
        modalities=["text"],
        runtime={"primary": "echo"},
        aliases=["tool-model"],
    )
    store.write_manifest(man)

    app = create_app(store)
    # Monkeypatch runtime to emit tool call
    app.state.svc.runtimes.echo = ToolMockRuntime()

    client = TestClient(app)
    tools = [
        {
            "type": "function",
            "function": {"name": "calculator", "description": "compute math"},
        }
    ]
    resp = client.post(
        "/v1/chat/completions",
        json={
            "model": "tool-model",
            "messages": [{"role": "user", "content": "Compute 2+2"}],
            "tools": tools,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    choice = data["choices"][0]
    assert choice["finish_reason"] == "tool_calls"
    assert choice["message"]["tool_calls"] is not None
    assert choice["message"]["tool_calls"][0]["function"]["name"] == "calculator"
