from __future__ import annotations

import io
import json
from fastapi.testclient import TestClient


def test_models_list_and_single_retrieve(client: TestClient) -> None:
    # 1. GET /v1/models
    res = client.get("/v1/models?demos=true")
    assert res.status_code == 200
    data = res.json()
    assert data["object"] == "list"
    assert len(data["data"]) > 0
    first_id = data["data"][0]["id"]

    # 2. GET /v1/models/{model}
    res_single = client.get(f"/v1/models/{first_id}")
    assert res_single.status_code == 200
    m = res_single.json()
    assert m["object"] == "model"
    assert m["id"] == first_id
    assert m["owned_by"] == "pantry"
    assert "context_max" in m
    assert "quality_tier" in m

    # 3. GET /v1/models/{alias}
    res_alias = client.get("/v1/models/demo-standard")
    assert res_alias.status_code == 200
    assert res_alias.json()["object"] == "model"


def test_text_completions_basic_and_stops(client: TestClient) -> None:
    # POST /v1/completions with plain text
    res = client.post(
        "/v1/completions",
        json={
            "model": "demo-standard",
            "prompt": "def fibonacci(n):",
            "max_tokens": 64,
            "temperature": 0.2,
            "stop": ["\n\n", "def "],
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["object"] == "text_completion"
    assert data["system_fingerprint"] == "fp_pantry_mlx"
    assert len(data["choices"]) == 1
    assert "text" in data["choices"][0]
    assert data["choices"][0]["finish_reason"] == "stop"
    assert "usage" in data
    assert data["usage"]["prompt_tokens"] > 0


def test_text_completions_fim_streaming(client: TestClient) -> None:
    # POST /v1/completions with Fill-In-The-Middle (suffix)
    res = client.post(
        "/v1/completions",
        json={
            "model": "demo-standard",
            "prompt": "def add(a, b):\n    ",
            "suffix": "\n    return result",
            "max_tokens": 32,
            "stream": True,
        },
    )
    assert res.status_code == 200
    assert "text/event-stream" in res.headers["content-type"]

    chunks = []
    for line in res.iter_lines():
        if line.startswith("data: ") and line != "data: [DONE]":
            payload = json.loads(line[6:])
            chunks.append(payload)

    assert len(chunks) > 0
    assert chunks[0]["object"] == "text_completion"
    assert "system_fingerprint" in chunks[0]


def test_chat_completions_developer_role_and_extra_fields(client: TestClient) -> None:
    # OpenAI modern format with role: "developer", extra OpenAI client params ignored
    res = client.post(
        "/v1/chat/completions",
        json={
            "model": "demo-standard",
            "messages": [
                {"role": "developer", "content": "You are an expert software engineer."},
                {"role": "user", "content": "Write a binary search algorithm in Python."},
            ],
            "max_tokens": 100,
            "temperature": 0.7,
            "top_p": 0.95,
            "presence_penalty": 0.0,
            "frequency_penalty": 0.0,
            "user": "user_client_123",
            "seed": 42,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["object"] == "chat.completion"
    assert data["system_fingerprint"] == "fp_pantry_mlx"
    assert data["choices"][0]["message"]["role"] == "assistant"
    assert len(data["choices"][0]["message"]["content"]) > 0


def test_embeddings_single_and_batch(client: TestClient) -> None:
    # 1. Single string input
    res1 = client.post(
        "/v1/embeddings",
        json={"model": "embed-compact", "input": "Hello world"},
    )
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["object"] == "list"
    assert len(data1["data"]) == 1
    assert len(data1["data"][0]["embedding"]) > 0

    # 2. Batch array input
    res2 = client.post(
        "/v1/embeddings",
        json={"model": "embed-compact", "input": ["Document 1", "Document 2", "Document 3"]},
    )
    assert res2.status_code == 200
    data2 = res2.json()
    assert len(data2["data"]) == 3
    assert data2["data"][0]["index"] == 0
    assert data2["data"][1]["index"] == 1
    assert data2["data"][2]["index"] == 2


def test_audio_transcriptions_and_translations(client: TestClient) -> None:
    wav_header = b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x00"

    # 1. Transcriptions
    res_tr = client.post(
        "/v1/audio/transcriptions",
        data={"model": "transcribe-compact", "response_format": "verbose_json"},
        files={"file": ("sample.wav", io.BytesIO(wav_header), "audio/wav")},
    )
    assert res_tr.status_code == 200
    data_tr = res_tr.json()
    assert data_tr["task"] == "transcribe"
    assert "text" in data_tr

    # 2. Translations
    res_tl = client.post(
        "/v1/audio/translations",
        data={"model": "transcribe-compact", "response_format": "json"},
        files={"file": ("foreign.wav", io.BytesIO(wav_header), "audio/wav")},
    )
    assert res_tl.status_code == 200
    data_tl = res_tl.json()
    assert "text" in data_tl
    assert "English" in data_tl["text"]
