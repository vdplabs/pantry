from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient
from typer.testing import CliRunner

from pantry.cli import app as cli_app
from pantry.rerank import EchoRerankRuntime, rerank_runtime_for
from pantry.schemas import PackageManifest


def test_echo_rerank_runtime() -> None:
    manifest = PackageManifest.model_validate(
        {
            "id": "vdplabs.demo-rerank.compact.v1",
            "family": "demo-rerank",
            "role": "rerank",
            "quality_tier": "compact",
            "modalities": ["rerank"],
            "runtime": {"primary": "echo_rerank"},
        }
    )
    runtime = rerank_runtime_for(manifest)
    assert isinstance(runtime, EchoRerankRuntime)

    query = "deep learning neural networks"
    docs = [
        "Strawberries and apples are delicious fruits.",
        "Deep learning leverages multi-layer neural networks for representation learning.",
        "A bicycle has two wheels and pedals.",
    ]

    scored, usage = runtime.rank(manifest, query, docs)
    assert len(scored) == 3
    # Top document should be index 1 (neural networks)
    top_idx, top_score = scored[0]
    assert top_idx == 1
    assert top_score > 0.4

    # Lowest document should be fruits or bicycle
    low_idx, low_score = scored[-1]
    assert low_idx in (0, 2)
    assert low_score < top_score
    assert usage["total_tokens"] > 0


def test_api_rerank_endpoint(client: TestClient) -> None:
    query = "quantum computing qubits"
    docs = [
        "Quantum computers use quantum bits or qubits to perform superposition computations.",
        "Making sourdough bread requires flour, water, and wild yeast culture.",
        "Superconducting qubits are cooled to near absolute zero.",
    ]

    # 1. Standard rerank with strings and return_documents=True
    res1 = client.post(
        "/v1/rerank",
        json={
            "model": "rerank-standard",
            "query": query,
            "documents": docs,
            "top_n": 2,
            "return_documents": True,
        },
    )
    assert res1.status_code == 200
    d1 = res1.json()
    assert "id" in d1
    assert len(d1["results"]) == 2
    assert d1["results"][0]["index"] in (0, 2)
    assert d1["results"][0]["document"] is not None
    assert "text" in d1["results"][0]["document"]
    assert d1["meta"]["billed_units"]["search_units"] >= 1
    assert d1["meta"]["tokens"]["input_tokens"] > 0

    # 2. Rerank with dictionary documents and return_documents=False
    dict_docs = [{"text": d, "metadata": {"id": i}} for i, d in enumerate(docs)]
    res2 = client.post(
        "/v1/rerank",
        json={
            "model": "rerank-standard",
            "query": query,
            "documents": dict_docs,
            "return_documents": False,
        },
    )
    assert res2.status_code == 200
    d2 = res2.json()
    assert len(d2["results"]) == 3
    assert d2["results"][0]["document"] is None

    # 3. Incompatible non-demo chat model returns 400
    res3 = client.post(
        "/v1/rerank",
        json={
            "model": "chat-compact",
            "query": query,
            "documents": docs,
        },
    )
    assert res3.status_code in (400, 409)


def test_cli_rank_command(tmp_path: Path) -> None:
    runner = CliRunner()

    # 1. Passing documents as args
    res1 = runner.invoke(
        cli_app,
        [
            "rank",
            "apple pie dessert",
            "Apple pie is a sweet baked dessert with pastry crust and sliced apples.",
            "Linux kernel memory management subsystem.",
            "--json",
        ],
    )
    assert res1.exit_code == 0
    data1 = json.loads(res1.output)
    assert data1["results"][0]["index"] == 0
    assert data1["results"][0]["relevance_score"] > 0.4

    # 2. Reading documents from file
    doc_file = tmp_path / "docs.txt"
    doc_file.write_text(
        "Modern airplanes have turbojet engines.\n"
        "Delicious Italian pizza with mozzarella cheese.\n",
        encoding="utf-8",
    )
    res2 = runner.invoke(
        cli_app,
        [
            "rank",
            "aviation propulsion",
            "-f",
            str(doc_file),
            "--top-n",
            "1",
        ],
    )
    assert res2.exit_code == 0
    assert "airplanes" in res2.output
