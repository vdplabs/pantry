from __future__ import annotations

import base64

import pytest

from pantry.resolve import ResolveError, resolve
from pantry.schemas import CapabilityRequest


def test_models_includes_music_compact(client):
    r = client.get("/v1/models", params={"demos": "true"})
    assert r.status_code == 200
    rows = {m["id"]: m for m in r.json()["data"]}
    assert "music-compact" in rows
    assert "music" in rows["music-compact"]["modalities"]


def test_resolve_music_http(client):
    r = client.post("/v1/resolve", json={"modality": "music"})
    assert r.status_code == 200
    body = r.json()
    assert body["package_id"] == "vdplabs.demo-music.compact.v1"
    assert body["alias"] == "music-compact"


def test_resolve_music_ignores_chat(catalog_packages):
    chat_only = [p for p in catalog_packages if "text" in [m.lower() for m in p.modalities]]
    with pytest.raises(ResolveError, match="modality"):
        resolve(CapabilityRequest(modality="music"), chat_only)


def test_audio_generations_echo(client):
    r = client.post(
        "/v1/audio/generations",
        json={
            "model": "music-compact",
            "prompt": "lofi chill beat",
            "duration_seconds": 0.5,
            "response_format": "b64_json",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["package_id"] == "vdplabs.demo-music.compact.v1"
    assert len(body["data"]) == 1
    raw = base64.b64decode(body["data"][0]["b64_json"])
    assert raw[:4] == b"RIFF"
    assert raw[8:12] == b"WAVE"
    assert body["data"][0]["format"] == "wav"


def test_audio_rejects_chat_model(client):
    r = client.post(
        "/v1/audio/generations",
        json={"model": "demo-standard", "prompt": "nope"},
    )
    assert r.status_code == 400


def test_chat_rejects_music_model(client):
    r = client.post(
        "/v1/chat/completions",
        json={
            "model": "music-compact",
            "messages": [{"role": "user", "content": "hi"}],
            "stream": False,
        },
    )
    assert r.status_code == 400
