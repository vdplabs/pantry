from __future__ import annotations

import math

from fastapi.testclient import TestClient

from pantry.embed_runtime import EchoEmbedRuntime
from pantry.resolve import resolve
from pantry.schemas import CapabilityRequest, PackageManifest
from pantry.server import create_app
from pantry.store import PackageStore


def test_echo_embed_runtime():
    rt = EchoEmbedRuntime(dim=128)
    man = PackageManifest(id="test.embed", family="test", role="embed", modalities=["embed"])
    embeddings, usage = rt.embed(man, ["Hello world", "Another sentence"])
    assert len(embeddings) == 2
    assert len(embeddings[0]) == 128
    assert len(embeddings[1]) == 128

    # Check unit norm
    norm0 = math.sqrt(sum(x * x for x in embeddings[0]))
    assert abs(norm0 - 1.0) < 1e-3

    # Check determinism
    embed2, _ = rt.embed(man, ["Hello world"])
    assert embeddings[0] == embed2[0]

    # Usage
    assert usage["prompt_tokens"] > 0
    assert usage["total_tokens"] == usage["prompt_tokens"]


def test_embeddings_endpoint_and_resolve(tmp_path):
    store = PackageStore(tmp_path / "home")
    store.ensure()
    embed_man = PackageManifest(
        id="vdplabs.demo-embed.compact.v1",
        family="demo-embed",
        role="embed",
        quality_tier="compact",
        modalities=["embed"],
        runtime={"primary": "echo_embed"},
        aliases=["embed-compact"],
    )
    chat_man = PackageManifest(
        id="vdplabs.demo-chat.compact.v1",
        family="demo-chat",
        role="chat",
        modalities=["text"],
        runtime={"primary": "echo"},
        aliases=["chat-compact"],
    )
    store.write_manifest(embed_man)
    store.write_manifest(chat_man)

    # Capability resolve
    req = CapabilityRequest(modality="embed", quality_tier="compact")
    res = resolve(req, store.list_manifests(), is_ready=store.weights_ready)
    assert res.package_id == "vdplabs.demo-embed.compact.v1"
    assert res.alias == "embed-compact"

    app = create_app(store)
    client = TestClient(app)

    # Single string input
    r1 = client.post(
        "/v1/embeddings",
        json={"model": "embed-compact", "input": "Apple Silicon unified memory"},
    )
    assert r1.status_code == 200
    data1 = r1.json()
    assert data1["object"] == "list"
    assert len(data1["data"]) == 1
    assert data1["data"][0]["object"] == "embedding"
    assert len(data1["data"][0]["embedding"]) == 384
    assert data1["usage"]["prompt_tokens"] > 0

    # List of strings input
    r2 = client.post(
        "/v1/embeddings",
        json={"model": "embed-compact", "input": ["Document 1", "Document 2"]},
    )
    assert r2.status_code == 200
    data2 = r2.json()
    assert len(data2["data"]) == 2
    assert data2["data"][0]["index"] == 0
    assert data2["data"][1]["index"] == 1

    # Rejected if wrong modality
    r_bad = client.post(
        "/v1/embeddings",
        json={"model": "chat-compact", "input": "Hello"},
    )
    assert r_bad.status_code == 400
    assert "not an embed model" in r_bad.json()["error"]["message"]
