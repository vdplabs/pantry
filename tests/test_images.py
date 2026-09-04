from __future__ import annotations

import base64


def test_models_includes_image_compact(client):
    r = client.get("/v1/models")
    assert r.status_code == 200
    rows = {m["id"]: m for m in r.json()["data"]}
    assert "image-compact" in rows
    assert "image_gen" in rows["image-compact"]["modalities"]
    assert rows["image-compact"]["role"] == "image_gen"


def test_resolve_image_gen_http(client):
    r = client.post("/v1/resolve", json={"modality": "image_gen"})
    assert r.status_code == 200
    body = r.json()
    assert body["package_id"] == "vdplabs.demo-image.compact.v1"
    assert body["alias"] == "image-compact"


def test_images_generations_echo(client):
    r = client.post(
        "/v1/images/generations",
        json={
            "model": "image-compact",
            "prompt": "a red cube on a table",
            "size": "32x32",
            "n": 1,
            "response_format": "b64_json",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["package_id"] == "vdplabs.demo-image.compact.v1"
    assert len(body["data"]) == 1
    b64 = body["data"][0]["b64_json"]
    raw = base64.b64decode(b64)
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"
    assert "path" in body["data"][0]


def test_images_rejects_chat_model(client):
    r = client.post(
        "/v1/images/generations",
        json={"model": "demo-standard", "prompt": "nope"},
    )
    assert r.status_code == 400


def test_chat_rejects_image_model(client):
    r = client.post(
        "/v1/chat/completions",
        json={
            "model": "image-compact",
            "messages": [{"role": "user", "content": "hi"}],
            "stream": False,
        },
    )
    assert r.status_code == 400
