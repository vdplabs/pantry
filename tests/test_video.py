from __future__ import annotations

import base64
from pathlib import Path

import pytest

from pantry.resolve import ResolveError, resolve
from pantry.schemas import CapabilityRequest, PackageManifest
from pantry.store import PackageStore
from pantry.video_runtime import EchoVideoRuntime, video_runtime_for


def test_models_includes_video_compact(client):
    r = client.get("/v1/models", params={"demos": "true"})
    assert r.status_code == 200
    rows = {m["id"]: m for m in r.json()["data"]}
    assert "video-compact" in rows or "echo-video" in rows
    alias = "video-compact" if "video-compact" in rows else "echo-video"
    assert "video" in rows[alias]["modalities"]


def test_resolve_video_demo(client):
    r = client.post(
        "/v1/resolve",
        json={"modality": "video", "family_prefer": "demo-video"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["package_id"] == "vdplabs.demo-video.compact.v1"


def test_video_generations_echo(client):
    r = client.post(
        "/v1/video/generations",
        json={
            "model": "video-compact",
            "prompt": "drone cinematic over misty mountains",
            "width": 256,
            "height": 256,
            "frames": 16,
            "fps": 24,
            "response_format": "b64_json",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["package_id"] == "vdplabs.demo-video.compact.v1"
    assert len(body["data"]) == 1
    item = body["data"][0]
    assert item["format"] == "mp4"
    assert item["width"] == 256
    assert item["height"] == 256
    assert item["frames"] == 16
    assert item["fps"] == 24
    assert item["duration_seconds"] > 0
    raw = base64.b64decode(item["b64_json"])
    assert len(raw) > 1000
    # Check MP4 ftyp or moov box signature
    assert b"ftyp" in raw[:32] or b"moov" in raw or b"mdat" in raw


def test_video_generations_shm(client):
    r = client.post(
        "/v1/video/generations",
        json={
            "model": "video-compact",
            "prompt": "futuristic neon city flight",
            "width": 256,
            "height": 256,
            "frames": 16,
            "fps": 24,
            "response_format": "shm",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    item = body["data"][0]
    assert "shm" in item
    shm_key = item["shm"]["key"]
    assert shm_key.startswith("vid_")

    # Fetch via /v1/shm/{key}
    r2 = client.get(f"/v1/shm/{shm_key}")
    assert r2.status_code == 200
    assert len(r2.content) > 1000
    assert r2.headers.get("X-Pantry-SHM-Key") == shm_key


def test_video_rejects_chat_model(client):
    r = client.post(
        "/v1/video/generations",
        json={"model": "demo-standard", "prompt": "nope"},
    )
    assert r.status_code == 400


def test_chat_rejects_video_model(client):
    r = client.post(
        "/v1/chat/completions",
        json={
            "model": "video-compact",
            "messages": [{"role": "user", "content": "hi"}],
        },
    )
    assert r.status_code == 400


def test_models_includes_video_standard(client):
    r = client.get("/v1/models")
    assert r.status_code == 200
    rows = {m["id"]: m for m in r.json()["data"]}
    assert "video-standard" in rows or "ltx-video" in rows
    m_id = "video-standard" if "video-standard" in rows else "ltx-video"
    assert "video" in rows[m_id]["modalities"]
    assert rows[m_id]["package_id"] == "vdplabs.ltx-video.standard.v1"


def test_resolve_video_standard(client):
    r = client.post(
        "/v1/resolve",
        json={"modality": "video", "quality": "standard"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["package_id"] == "vdplabs.ltx-video.standard.v1"


def test_video_generations_ltx_standard_409_when_unpulled(client):
    # Without mock weights, video-standard weights_ready is False -> 409
    r = client.post(
        "/v1/video/generations",
        json={
            "model": "video-standard",
            "prompt": "sunset over cybernetic metropolis",
        },
    )
    assert r.status_code == 409
    assert "weights not pulled" in r.text


def test_video_generations_ltx_standard_when_ready(client, tmp_path):
    # Provide mock weights in client's store
    p_weights = tmp_path / "pantry-home" / "packages" / "vdplabs.ltx-video.standard.v1" / "weights" / "transformer"
    p_weights.mkdir(parents=True, exist_ok=True)
    (p_weights / "config.json").write_text("{}", encoding="utf-8")
    (p_weights / "model.safetensors").write_bytes(b"dummy")

    r = client.post(
        "/v1/video/generations",
        json={
            "model": "video-standard",
            "prompt": "nebula explosion hyper-lapse",
            "width": 256,
            "height": 256,
            "frames": 16,
            "fps": 24,
            "response_format": "shm",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["package_id"] == "vdplabs.ltx-video.standard.v1"
    assert len(body["data"]) == 1
    item = body["data"][0]
    assert item["format"] == "mp4"
    assert "shm" in item
    shm_key = item["shm"]["key"]
    assert shm_key.startswith("vid_")


def test_video_generations_5s_with_low_fps(client, tmp_path):
    # Tests that 25 frames at 5 fps yields a 5.0 second video clip
    p_weights = tmp_path / "pantry-home" / "packages" / "vdplabs.ltx-video.standard.v1" / "weights" / "transformer"
    p_weights.mkdir(parents=True, exist_ok=True)
    (p_weights / "config.json").write_text("{}", encoding="utf-8")
    (p_weights / "model.safetensors").write_bytes(b"dummy")

    r = client.post(
        "/v1/video/generations",
        json={
            "model": "video-standard",
            "prompt": "ocean waves slow motion",
            "width": 256,
            "height": 256,
            "frames": 25,
            "fps": 5,
            "response_format": "b64_json",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["data"]) == 1
    item = body["data"][0]
    assert item["format"] == "mp4"
    assert item["frames"] == 25
    assert item["fps"] == 5
    assert abs(item["duration_seconds"] - 5.0) < 0.1


def test_models_includes_video_q4_compact(client):
    r = client.get("/v1/models")
    assert r.status_code == 200
    rows = {m["id"]: m for m in r.json()["data"]}
    assert "video-compact" in rows or "ltx-video-q4" in rows
    alias = "ltx-video-q4" if "ltx-video-q4" in rows else "video-compact"
    assert "video" in rows[alias]["modalities"]
    assert rows[alias]["package_id"] == "vdplabs.ltx-video-q4.compact.v1"


def test_resolve_video_compact_q4(client):
    # Requesting compact video with ram budget of 12 GB resolves to quantized LTX-Video pack
    r = client.post(
        "/v1/resolve",
        json={"modality": "video", "quality": "compact", "ram_gb_max": 12.0},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["package_id"] == "vdplabs.ltx-video-q4.compact.v1"


def test_video_generations_i2v_echo(client):
    import io
    from PIL import Image

    img = Image.new("RGB", (32, 32), color=(255, 120, 40))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64_img = base64.b64encode(buf.getvalue()).decode("ascii")

    r = client.post(
        "/v1/video/generations",
        json={
            "model": "demo-video",
            "prompt": "a portrait coming to life",
            "image": b64_img,
            "image_strength": 0.85,
            "width": 256,
            "height": 256,
            "frames": 16,
            "fps": 24,
            "response_format": "b64_json",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["data"]) == 1
    item = body["data"][0]
    assert item["format"] == "mp4"
    assert item["frames"] == 16
    assert item.get("has_source_image") is True


def test_video_generations_i2v_ltx(client, tmp_path):
    import io
    from PIL import Image

    p_weights = tmp_path / "pantry-home" / "packages" / "vdplabs.ltx-video.standard.v1" / "weights" / "transformer"
    p_weights.mkdir(parents=True, exist_ok=True)
    (p_weights / "config.json").write_text("{}", encoding="utf-8")
    (p_weights / "model.safetensors").write_bytes(b"dummy")

    img = Image.new("RGB", (32, 32), color=(40, 120, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64_img = f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"

    r = client.post(
        "/v1/video/generations",
        json={
            "model": "video-standard",
            "prompt": "animate this concept art",
            "image": b64_img,
            "image_strength": 0.9,
            "include_audio": True,
            "width": 256,
            "height": 256,
            "frames": 17,
            "fps": 24,
            "response_format": "b64_json",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["data"]) == 1
    item = body["data"][0]
    assert item["format"] == "mp4"
    assert item.get("has_source_image") is True
    assert item.get("has_audio") is True


def test_video_generation_marks_loaded(client):
    r = client.post(
        "/v1/video/generations",
        json={
            "model": "video-compact",
            "prompt": "flying over rivers",
            "width": 128,
            "height": 128,
            "frames": 8,
            "fps": 12,
        },
    )
    assert r.status_code == 200
    h = client.get("/v1/health").json()
    assert "vdplabs.demo-video.compact.v1" in h["loaded"]

    # Unload via alias
    r_un = client.post("/v1/unload", json={"package_id": "video-compact"})
    assert r_un.status_code == 200
    h_after = client.get("/v1/health").json()
    assert "vdplabs.demo-video.compact.v1" not in h_after["loaded"]


def test_load_and_unload_by_alias(client):
    # Load via alias
    r_load = client.post("/v1/load", json={"package_id": "video-standard"})
    assert r_load.status_code == 200
    assert r_load.json()["package_id"] == "vdplabs.ltx-video.standard.v1"
    h = client.get("/v1/health").json()
    assert "vdplabs.ltx-video.standard.v1" in h["loaded"]

    # Unload via alias
    r_unload = client.post("/v1/unload", json={"package_id": "video-standard"})
    assert r_unload.status_code == 200
    h_after = client.get("/v1/health").json()
    assert "vdplabs.ltx-video.standard.v1" not in h_after["loaded"]


def test_ltx_video_runtime_unload(tmp_path):
    from pantry.video_runtime import LTXVideoRuntime

    store = PackageStore(tmp_path / "home", data_root=tmp_path / "data")
    store.mark_loaded("vdplabs.ltx-video.standard.v1")
    assert "vdplabs.ltx-video.standard.v1" in store.read_state()["loaded"]

    runtime = LTXVideoRuntime(store)
    runtime._pipe = "mock_pipe"
    runtime._loaded_path = "some/path"

    runtime.unload("vdplabs.ltx-video.standard.v1")
    assert runtime._pipe is None
    assert runtime._loaded_path is None
    assert "vdplabs.ltx-video.standard.v1" not in store.read_state()["loaded"]


def test_cli_load_unload_by_alias(tmp_path):
    from typer.testing import CliRunner
    from pantry.cli import app

    home = tmp_path / "home"
    runner = CliRunner()
    # Test load via alias
    res_load = runner.invoke(app, ["load", "video-standard", "--port", "19999", "--home", str(home)])
    assert res_load.exit_code == 0
    assert "vdplabs.ltx-video.standard.v1" in res_load.output

    # Test unload via alias
    res_unload = runner.invoke(app, ["unload", "video-standard", "--port", "19999", "--home", str(home)])
    assert res_unload.exit_code == 0





