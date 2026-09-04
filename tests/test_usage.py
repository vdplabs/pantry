from __future__ import annotations

import json

from fastapi.testclient import TestClient

from pantry.runtime import EchoRuntime
from pantry.schemas import ChatMessage, PackageManifest
from pantry.server import create_app
from pantry.store import PackageStore


def test_echo_runtime_usage_tracking():
    rt = EchoRuntime()
    man = PackageManifest(
        id="test.pack",
        family="test",
        template_family="chatml",
    )
    messages = [ChatMessage(role="user", content="Hello world, testing token usage.")]
    usage = {}
    res = __import__("asyncio").run(
        rt.complete(man, messages, max_tokens=64, temperature=0.0, usage=usage)
    )
    assert len(res) > 0
    assert usage["prompt_tokens"] > 0
    assert usage["completion_tokens"] > 0
    assert usage["total_tokens"] == usage["prompt_tokens"] + usage["completion_tokens"]


def test_chat_completions_exact_usage(tmp_path):
    store = PackageStore(tmp_path / "home")
    store.ensure()
    man = PackageManifest(
        id="vdplabs.demo-chat.compact.v1",
        family="demo",
        role="chat",
        quality_tier="compact",
        modalities=["text"],
        runtime={"primary": "echo"},
        aliases=["chat-compact"],
    )
    store.write_manifest(man)

    app = create_app(store)
    client = TestClient(app)

    # Non-streaming
    resp = client.post(
        "/v1/chat/completions",
        json={
            "model": "chat-compact",
            "messages": [{"role": "user", "content": "Explain unified memory."}],
            "max_tokens": 50,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "usage" in data
    assert data["usage"]["prompt_tokens"] > 0
    assert data["usage"]["completion_tokens"] > 0
    assert data["usage"]["total_tokens"] == (
        data["usage"]["prompt_tokens"] + data["usage"]["completion_tokens"]
    )

    # Streaming
    s_resp = client.post(
        "/v1/chat/completions",
        json={
            "model": "chat-compact",
            "messages": [{"role": "user", "content": "Explain unified memory."}],
            "stream": True,
        },
    )
    assert s_resp.status_code == 200
    events = []
    for line in s_resp.iter_lines():
        if line.startswith("data: ") and not line.endswith("[DONE]"):
            events.append(json.loads(line[6:]))
    assert len(events) > 0
    final = events[-1]
    assert "usage" in final
    assert final["usage"]["prompt_tokens"] > 0
    assert final["usage"]["total_tokens"] > 0
