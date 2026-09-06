from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pantry.cas import CasManager
from pantry.chunker import FastCDCChunker, ModelChunker, SafetensorsChunker
from pantry.recipe import PackageRecipe, RecipeAssembler, try_clonefile
from pantry.schemas import CapabilityRequest, PackageManifest, QualityTier, RuntimeInfo
from pantry.server import create_app
from pantry.store import PackageStore


def create_mock_safetensors(
    path: Path,
    tensors: dict[str, bytes],
) -> None:
    """Helper to synthesize a valid .safetensors binary file."""
    header_dict = {}
    current_offset = 0
    tensors_sorted = sorted(tensors.items())
    for name, data in tensors_sorted:
        length = len(data)
        header_dict[name] = {
            "dtype": "F16",
            "shape": [length // 2],
            "data_offsets": [current_offset, current_offset + length],
        }
        current_offset += length

    header_json = json.dumps(header_dict).encode("utf-8")
    # 8-byte uint64 little endian length of JSON
    header_len = struct.pack("<Q", len(header_json))

    with path.open("wb") as f:
        f.write(header_len)
        f.write(header_json)
        for _, data in tensors_sorted:
            f.write(data)


def test_cas_manager_atomic_and_permissions(tmp_path: Path):
    cas_dir = tmp_path / "cas"
    cas = CasManager(cas_dir)

    data = b"hello zero-copy world 12345" * 100
    digest = hashlib.sha256(data).hexdigest()

    # Put chunk
    returned_hash = cas.put_chunk(data)
    assert returned_hash == digest
    assert cas.has_chunk(digest)

    chunk_file = cas.chunk_path(digest)
    assert chunk_file.is_file()
    assert (chunk_file.stat().st_mode & 0o777) == 0o600

    # Read back
    read_data = cas.get_chunk_bytes(digest)
    assert read_data == data


def test_cas_manager_rejects_path_traversal_and_bad_hashes(tmp_path: Path):
    cas = CasManager(tmp_path / "cas")

    with pytest.raises(ValueError, match="invalid chunk sha256"):
        cas.chunk_path("../../etc/passwd")

    with pytest.raises(ValueError, match="invalid chunk sha256"):
        cas.chunk_path("nonhex_hash_string")

    assert not cas.has_chunk("../secret")
    assert cas.get_chunk_bytes("../secret") is None


def test_cas_manager_rejects_hash_mismatch(tmp_path: Path):
    cas = CasManager(tmp_path / "cas")
    data = b"legitimate bytes"
    fake_hash = "0" * 64

    with pytest.raises(ValueError, match="chunk sha256 mismatch"):
        cas.put_chunk(data, expected_sha256=fake_hash)


def test_safetensors_tensor_boundary_chunking(tmp_path: Path):
    sf_path = tmp_path / "model.safetensors"
    # Large 2.5 MB embedding tensor + 500 KB norm + 3 MB projection
    embed_bytes = b"E" * (2500 * 1024)
    norm_bytes = b"N" * (500 * 1024)
    proj_bytes = b"P" * (3000 * 1024)

    create_mock_safetensors(
        sf_path,
        {
            "model.embed_tokens.weight": embed_bytes,
            "model.layers.0.input_layernorm.weight": norm_bytes,
            "model.layers.0.mlp.gate_proj.weight": proj_bytes,
        },
    )

    assert SafetensorsChunker.can_chunk(sf_path)
    chunks = SafetensorsChunker.chunk(sf_path)

    # Chunks should include:
    # 1. __header__
    # 2. model.embed_tokens.weight (>= 2MB)
    # 3. coalesced norm (< 2MB)
    # 4. model.layers.0.mlp.gate_proj.weight (>= 2MB)
    chunk_names = [c.name for c in chunks]
    assert "__header__" in chunk_names
    assert "model.embed_tokens.weight" in chunk_names
    assert "model.layers.0.mlp.gate_proj.weight" in chunk_names

    # Check offsets and total length
    total_len = sum(c.length for c in chunks)
    assert total_len == sf_path.stat().st_size


def test_fastcdc_chunking_and_cutpoint_stability(tmp_path: Path):
    import random

    p = tmp_path / "data.bin"
    # 5 MB of random data
    rng = random.Random(42)
    data = rng.randbytes(5 * 1024 * 1024)
    p.write_bytes(data)

    chunker = FastCDCChunker(min_size=512 * 1024, avg_size=1024 * 1024, max_size=2048 * 1024)
    chunks1 = chunker.chunk(p)
    assert len(chunks1) >= 2
    assert sum(c.length for c in chunks1) == len(data)

    # Prepend 64 bytes (boundary shift simulation)
    p_shifted = tmp_path / "data_shifted.bin"
    p_shifted.write_bytes(b"X" * 64 + data)

    chunks2 = chunker.chunk(p_shifted)
    # At least some subsequent chunk hashes should match downstream!
    hashes1 = {c.sha256 for c in chunks1}
    hashes2 = {c.sha256 for c in chunks2}
    common = hashes1.intersection(hashes2)
    assert len(common) > 0, "FastCDC should preserve downstream chunks across boundary shifts"


def test_cross_quantization_dedup_and_reconstitution(tmp_path: Path):
    """Simulate pulling 4-bit and 8-bit variants that share identical embedding weights."""
    store = PackageStore(tmp_path / "home", data_root=tmp_path / "data")
    store.ensure()

    # Shared embedding: 2.5 MB
    shared_embeddings = b"S" * (2500 * 1024)
    # Distinct quantization weights: 1.5 MB each
    q4_weights = b"4" * (1500 * 1024)
    q8_weights = b"8" * (1500 * 1024)

    pkg4_dir = tmp_path / "q4_source"
    pkg4_dir.mkdir(parents=True)
    create_mock_safetensors(
        pkg4_dir / "model.safetensors",
        {
            "model.embed_tokens.weight": shared_embeddings,
            "model.layers.0.weight": q4_weights,
        },
    )
    (pkg4_dir / "tokenizer.json").write_text('{"vocab": "test"}')

    pkg8_dir = tmp_path / "q8_source"
    pkg8_dir.mkdir(parents=True)
    create_mock_safetensors(
        pkg8_dir / "model.safetensors",
        {
            "model.embed_tokens.weight": shared_embeddings,
            "model.layers.0.weight": q8_weights,
        },
    )
    (pkg8_dir / "tokenizer.json").write_text('{"vocab": "test"}')

    # Ingest package 4-bit
    recipe4 = store.ingest_package_into_cas("model.q4", pkg4_dir)
    assert recipe4.package_id == "model.q4"
    assert recipe4.unique_cas_bytes > 0

    stats_after_q4 = store.cas.get_stats()
    assert stats_after_q4["total_packages"] == 1

    # Ingest package 8-bit
    recipe8 = store.ingest_package_into_cas("model.q8", pkg8_dir)
    assert recipe8.package_id == "model.q8"
    # Shared bytes must be >= length of shared embeddings
    assert recipe8.shared_cas_bytes >= len(shared_embeddings)

    stats_after_q8 = store.cas.get_stats()
    assert stats_after_q8["total_packages"] == 2
    assert stats_after_q8["dedup_saved_bytes"] >= len(shared_embeddings)
    assert stats_after_q8["dedup_ratio"] > 1.0

    # Test Materialization / Reconstitution:
    mat4_dir = tmp_path / "reconstituted_q4"
    store.materialize_package("model.q4", dest_dir=mat4_dir)
    assert (mat4_dir / "model.safetensors").read_bytes() == (pkg4_dir / "model.safetensors").read_bytes()
    assert (mat4_dir / "tokenizer.json").read_bytes() == (pkg4_dir / "tokenizer.json").read_bytes()

    mat8_dir = tmp_path / "reconstituted_q8"
    store.materialize_package("model.q8", dest_dir=mat8_dir)
    assert (mat8_dir / "model.safetensors").read_bytes() == (pkg8_dir / "model.safetensors").read_bytes()
    assert (mat8_dir / "tokenizer.json").read_bytes() == (pkg8_dir / "tokenizer.json").read_bytes()


def test_cas_prune_and_lifecycle(tmp_path: Path):
    store = PackageStore(tmp_path / "home", data_root=tmp_path / "data")
    store.ensure()

    src_dir = tmp_path / "src"
    src_dir.mkdir(parents=True)
    (src_dir / "blob.bin").write_bytes(b"temp data" * 1000)

    store.ingest_package_into_cas("temp.pkg", src_dir)
    stats1 = store.cas.get_stats()
    assert stats1["total_packages"] == 1
    assert stats1["total_chunks"] >= 1

    # Dry-run prune should reclaim 0 chunks while package is referenced
    reclaimed_chunks, reclaimed_bytes = store.cas.prune(dry_run=True)
    assert reclaimed_chunks == 0

    # Remove package reference
    store.cas.index.remove_package("temp.pkg")
    stats2 = store.cas.get_stats()
    assert stats2["total_packages"] == 0

    # Dry-run should now identify unreferenced chunks
    reclaimed_dry, bytes_dry = store.cas.prune(dry_run=True)
    assert reclaimed_dry >= 1
    assert bytes_dry > 0

    # Actual prune
    reclaimed_actual, bytes_actual = store.cas.prune(dry_run=False)
    assert reclaimed_actual == reclaimed_dry
    assert bytes_actual == bytes_dry

    stats3 = store.cas.get_stats()
    assert stats3["total_chunks"] == 0
    assert stats3["physical_size_bytes"] == 0


def test_storage_server_endpoints(tmp_path: Path):
    store = PackageStore(tmp_path / "home", data_root=tmp_path / "data")
    store.ensure()

    # Ingest a small mock package
    pkg_dir = tmp_path / "pkg"
    pkg_dir.mkdir(parents=True)
    (pkg_dir / "weights.bin").write_bytes(b"data" * 10000)
    store.ingest_package_into_cas("test.storage.pkg", pkg_dir)

    app = create_app(store)
    client = TestClient(app)

    # GET /v1/storage
    resp = client.get("/v1/storage")
    assert resp.status_code == 200
    data = resp.json()
    assert data["cas_enabled"] is True
    assert data["total_packages"] == 1
    assert data["total_chunks"] >= 1

    # POST /v1/storage/prune (dry-run)
    resp_prune_dry = client.post("/v1/storage/prune", json={"dry_run": True})
    assert resp_prune_dry.status_code == 200
    assert resp_prune_dry.json()["ok"] is True
    assert resp_prune_dry.json()["chunks_pruned"] == 0  # Still referenced

    # Health endpoint diagnostics
    health = client.get("/v1/health").json()
    assert "cas" in health
    assert health["cas"]["total_chunks"] >= 1


def test_resolve_computes_incremental_pull_size(tmp_path: Path):
    store = PackageStore(tmp_path / "home", data_root=tmp_path / "data")
    store.ensure()

    # Register manifest with real mlx runtime requiring download
    man = PackageManifest(
        id="vdplabs.test-chat.compact.v1",
        family="test-chat",
        role="chat",
        quality_tier=QualityTier.compact,
        params_b=1.0,
        bits_approx=4.0,
        ram_gb_min=2.0,
        runtime=RuntimeInfo(primary="mlx", hf_repo="mlx-community/test-model"),
    )
    store.write_manifest(man)

    app = create_app(store)
    client = TestClient(app)

    req = CapabilityRequest(modality="chat", quality_tier=QualityTier.compact)
    res = client.post("/v1/resolve", json=req.model_dump())
    assert res.status_code == 200
    resolved = res.json()
    assert resolved["package_id"] == man.id
    assert resolved["weights_ready"] is False
    assert resolved["apparent_size_bytes"] > 0
    assert resolved["download_size_bytes"] > 0
    assert resolved["download_size_bytes"] == resolved["apparent_size_bytes"]
