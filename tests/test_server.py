from __future__ import annotations


def test_health(client):
    r = client.get("/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["name"] == "pantry"
    assert body["packages"] >= 7


def test_models_lists_public_packages(client):
    r = client.get("/v1/models")
    assert r.status_code == 200
    rows = {m["id"]: m for m in r.json()["data"]}
    assert "chat-compact" in rows
    assert "image-compact" in rows
    assert "modalities" in rows["chat-compact"]
    assert "text" in rows["chat-compact"]["modalities"]
    assert "demo-standard" not in rows
    assert "vdplabs.demo-chat.standard.v1" not in rows


def test_models_demos_opt_in(client):
    r = client.get("/v1/models", params={"demos": "true"})
    assert r.status_code == 200
    ids = {m["id"] for m in r.json()["data"]}
    assert "demo-standard" in ids or "vdplabs.demo-chat.standard.v1" in ids


def test_resolve_http(client):
    r = client.post(
        "/v1/resolve",
        json={"modality": "chat", "quality_tier": "compact", "ram_gb_max": 8},
    )
    assert r.status_code == 200
    body = r.json()
    # Prefer real MLX pack even before pull (plan.weights_ready false).
    assert body["package_id"] == "vdplabs.qwen25-0.5b.compact.v1"
    assert body["plan"]["weights_ready"] is False


def test_resolve_template_mismatch(client):
    r = client.post(
        "/v1/resolve",
        json={"modality": "chat", "template_family": "does-not-exist"},
    )
    assert r.status_code == 404


def test_chat_completions_echo(client):
    r = client.post(
        "/v1/chat/completions",
        json={
            "model": "demo-standard",
            "messages": [{"role": "user", "content": "hello pantry"}],
            "stream": False,
        },
    )
    assert r.status_code == 200
    body = r.json()
    content = body["choices"][0]["message"]["content"]
    assert "hello pantry" in content
    assert "vdplabs.demo-chat.standard.v1" in content
    assert body["package_id"].endswith("standard.v1")
    assert body["usage"]["total_tokens"] > 0


def test_chat_completions_openai_content_shapes(client):
    r = client.post(
        "/v1/chat/completions",
        json={
            "model": "demo-standard",
            "messages": [
                {"role": "assistant", "content": None},
                {
                    "role": "user",
                    "content": [{"type": "text", "text": "parts ok"}],
                },
            ],
            "max_completion_tokens": 64,
            "stream": False,
        },
    )
    assert r.status_code == 200
    assert "parts ok" in r.json()["choices"][0]["message"]["content"]


def test_cors_preflight(client):
    r = client.options(
        "/v1/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r.status_code in {200, 204}
    assert r.headers.get("access-control-allow-origin") == "*"


def test_chat_completions_needs_pull(client):
    r = client.post(
        "/v1/chat/completions",
        json={
            "model": "chat-compact",
            "messages": [{"role": "user", "content": "hi"}],
            "stream": False,
        },
    )
    assert r.status_code == 409


def test_chat_completions_stream(client):
    with client.stream(
        "POST",
        "/v1/chat/completions",
        json={
            "model": "demo-compact",
            "messages": [{"role": "user", "content": "stream me"}],
            "stream": True,
        },
    ) as r:
        assert r.status_code == 200
        text = "".join(r.iter_text())
    assert "data:" in text
    assert "[DONE]" in text


def test_unload_accepts_json_body(client):
    r = client.post("/v1/unload", json={"package_id": None})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True
    r2 = client.post("/v1/unload", json={})
    assert r2.status_code == 200, r2.text


def test_load_http(client):
    r = client.post(
        "/v1/load",
        json={"package_id": "vdplabs.demo-chat.compact.v1", "pin": False},
    )
    assert r.status_code == 200, r.text
    assert "vdplabs.demo-chat.compact.v1" in r.json()["loaded"]
