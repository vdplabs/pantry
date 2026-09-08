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
