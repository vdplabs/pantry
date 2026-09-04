from __future__ import annotations

import base64
from pathlib import Path


def test_models_includes_image_compact(client):
    r = client.get("/v1/models")
    assert r.status_code == 200
    rows = {m["id"]: m for m in r.json()["data"]}
    assert "image-compact" in rows
    assert "image_gen" in rows["image-compact"]["modalities"]
    assert rows["image-compact"]["role"] == "image_gen"


def test_resolve_image_gen_http(client):
    r = client.post("/v1/resolve", json={"modality": "image_gen", "quality_tier": "compact"})
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

from unittest.mock import MagicMock, patch

import pytest
from typer.testing import CliRunner

from pantry.cli import app
from pantry.config import bundled_catalog_dir
from pantry.image_runtime import EchoImageRuntime, MFluxImageRuntime, image_runtime_for
from pantry.schemas import PackageManifest
from pantry.store import PackageStore


def test_image_runtime_for_routing(tmp_path):
    store = PackageStore(tmp_path / "home")
    store.ensure()

    echo_man = PackageManifest(
        id="test-echo-image",
        family="image",
        modalities=["image_gen"],
        runtime={"primary": "echo_image"},
    )
    mflux_man = PackageManifest(
        id="test-mflux",
        family="flux",
        modalities=["image_gen"],
        runtime={"primary": "mflux"},
    )
    bad_man = PackageManifest(
        id="test-bad",
        family="flux",
        modalities=["image_gen"],
        runtime={"primary": "unknown_backend"},
    )

    assert isinstance(image_runtime_for(echo_man, store), EchoImageRuntime)
    assert isinstance(image_runtime_for(mflux_man, store), MFluxImageRuntime)
    with pytest.raises(RuntimeError, match="not implemented yet"):
        image_runtime_for(bad_man, store)


def test_mflux_runtime_mocked(tmp_path):
    store = PackageStore(tmp_path / "home")
    store.ensure()

    mflux_man = PackageManifest(
        id="vdplabs.flux1-schnell.standard.v1",
        family="flux",
        modalities=["image_gen"],
        bits_approx=8.0,
        runtime={"primary": "mflux", "hf_repo": "black-forest-labs/FLUX.1-schnell"},
    )

    rt = MFluxImageRuntime(store)

    # Mock Flux1 and its generated image
    mock_flux_cls = MagicMock()
    mock_flux_instance = MagicMock()
    mock_flux_cls.from_alias.return_value = mock_flux_instance

    mock_img = MagicMock()
    def _save(p):
        Path(p).write_bytes(b"\x89PNG\r\n\x1a\nfake-flux-image")
    mock_img.save.side_effect = _save
    mock_flux_instance.generate_image.return_value = mock_img

    mock_mflux_module = MagicMock()
    mock_mflux_module.Flux1 = mock_flux_cls

    with patch.dict("sys.modules", {"mflux": mock_mflux_module}):
        res = rt.generate(mflux_man, prompt="a neon sunset", size="256x256", n=1)
        assert len(res) == 1
        assert "b64_json" in res[0]
        raw = base64.b64decode(res[0]["b64_json"])
        assert raw.startswith(b"\x89PNG")
        mock_flux_cls.from_alias.assert_called_with(alias="schnell", quantize=8)
        mock_flux_instance.generate_image.assert_called_once()


def test_cli_image_local(tmp_path):
    home = tmp_path / "pantry-home"
    store = PackageStore(home)
    store.ensure()
    store.seed_from_catalog(bundled_catalog_dir())

    out_file = tmp_path / "custom_out.png"
    runner = CliRunner()
    res = runner.invoke(
        app,
        [
            "image",
            "a tranquil forest",
            "--model",
            "image-compact",
            "--home",
            str(home),
            "--output",
            str(out_file),
        ],
    )
    assert res.exit_code == 0
    assert out_file.is_file()
    assert out_file.read_bytes().startswith(b"\x89PNG")
