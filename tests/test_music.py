from __future__ import annotations

import base64
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest

from pantry.music_runtime import MLXMusicRuntime, music_runtime_for
from pantry.resolve import ResolveError, resolve
from pantry.schemas import CapabilityRequest, PackageManifest
from pantry.store import PackageStore


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
    assert body["package_id"] in {
        "vdplabs.musicgen-small.standard.v1",
        "vdplabs.magnet-small.standard.v1",
    }
    assert body["plan"]["runtime"] in {"musicgen", "magnet"}


def test_resolve_music_demo(client):
    r = client.post(
        "/v1/resolve",
        json={"modality": "music", "family_prefer": "demo-music"},
    )
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


def test_mlx_music_runtime_generate(tmp_path: Path):
    store = PackageStore(tmp_path / "pantry-home")
    store.ensure()
    manifest = PackageManifest(
        id="vdplabs.musicgen-small.standard.v1",
        family="musicgen",
        role="music",
        quality_tier="standard",
        modalities=["music"],
        runtime={"primary": "musicgen", "hf_repo": "jasonvassallo/mlx-musicgen-small"},
    )

    rt = MLXMusicRuntime(store)

    # Mock pipe to test generate pipeline without re-running heavy model compilation
    mock_pipe = MagicMock()
    mock_pipe.sample_rate = 32000
    mock_pipe.generate.return_value = np.zeros(32000, dtype=np.float32)
    rt._pipeline = mock_pipe
    rt._loaded_package_id = manifest.id

    res = rt.generate(manifest, prompt="ambient electronic", duration_seconds=1.0)
    assert len(res) == 1
    assert res[0]["format"] == "wav"
    assert res[0]["sample_rate"] == 32000
    assert res[0]["duration_seconds"] == 1.0
    wav_path = Path(res[0]["path"])
    assert wav_path.is_file()
    assert wav_path.stat().st_size > 0
    raw = wav_path.read_bytes()
    assert raw[:4] == b"RIFF"
    assert raw[8:12] == b"WAVE"

    # Verify runtime factory
    resolved_rt = music_runtime_for(manifest, store)
    assert isinstance(resolved_rt, MLXMusicRuntime)
