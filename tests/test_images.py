from __future__ import annotations

import base64
from pathlib import Path


def test_models_includes_image_compact(client):
    r = client.get("/v1/models")
    assert r.status_code == 200
    rows = {m["id"]: m for m in r.json()["data"]}
    assert "image-compact" not in rows  # Demo hidden by default

    r_demos = client.get("/v1/models", params={"demos": "true"})
    assert r_demos.status_code == 200
    rows_demos = {m["id"]: m for m in r_demos.json()["data"]}
    assert "image-compact" in rows_demos
    assert "image_gen" in rows_demos["image-compact"]["modalities"]
    assert rows_demos["image-compact"]["role"] == "image_gen"


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
            "size": "768x1344",
            "n": 1,
            "response_format": "b64_json",
            "steps": 8,
            "guidance": 3.5,
            "negative_prompt": "blurry",
            "seed": 1234,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["package_id"] == "vdplabs.demo-image.compact.v1"
    assert len(body["data"]) == 1
    assert body["data"][0]["width"] == 768
    assert body["data"][0]["height"] == 1344
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


def test_mflux_source_and_quantize_prequant_zimage():
    from pantry.image_runtime import mflux_source_and_quantize

    man = PackageManifest(
        id="vdplabs.z-image-turbo.standard.v1",
        family="z-image",
        modalities=["image_gen"],
        bits_approx=4.0,
        quant_method="mflux-4bit",
        runtime={
            "primary": "mflux",
            "hf_repo": "filipstrand/Z-Image-Turbo-mflux-4bit",
        },
    )
    source, quantize = mflux_source_and_quantize(man, store=None)
    assert source == "filipstrand/Z-Image-Turbo-mflux-4bit"
    assert quantize is None  # must not on-the-fly quantize a 4-bit mirror


def test_mflux_source_and_quantize_full_precision_gets_q4():
    from pantry.image_runtime import mflux_source_and_quantize

    man = PackageManifest(
        id="demo-full",
        family="z-image",
        modalities=["image_gen"],
        bits_approx=16.0,
        quant_method="mlx-bf16",
        runtime={
            "primary": "mflux",
            "hf_repo": "mlx-community/Z-Image-Turbo-bf16",
        },
    )
    source, quantize = mflux_source_and_quantize(man, store=None)
    assert source.endswith("Z-Image-Turbo-bf16")
    assert quantize == 4


def test_mflux_runtime_mocked(tmp_path, monkeypatch):
    monkeypatch.setattr("pantry.image_runtime._swap_used_gb", lambda: 0.0)
    monkeypatch.setattr("pantry.image_runtime._host_ram_gb", lambda: 32.0)
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
    mock_flux_cls.from_name.return_value = mock_flux_instance

    mock_img = MagicMock()
    def _save(p):
        Path(p).write_bytes(b"\x89PNG\r\n\x1a\nfake-flux-image")
    mock_img.save.side_effect = _save
    mock_flux_instance.generate_image.return_value = mock_img

    mock_mflux_module = MagicMock()
    mock_mflux_module.Flux1 = mock_flux_cls
    mock_submod = MagicMock()
    mock_submod.Flux1 = mock_flux_cls

    with patch.dict(
        "sys.modules",
        {
            "mflux": mock_mflux_module,
            "mflux.models.flux.variants.txt2img.flux": mock_submod,
        },
    ):
        res = rt.generate(mflux_man, prompt="a neon sunset", size="256x256", n=1)
        assert len(res) == 1
        assert "b64_json" in res[0]
        raw = base64.b64decode(res[0]["b64_json"])
        assert raw.startswith(b"\x89PNG")
        assert mock_flux_cls.from_alias.called or mock_flux_cls.from_name.called
        mock_flux_instance.generate_image.assert_called_once()


def test_mflux_retries_once_on_metal_cold_start(tmp_path, monkeypatch):
    monkeypatch.setattr("pantry.image_runtime._swap_used_gb", lambda: 0.0)
    monkeypatch.setattr("pantry.image_runtime._host_ram_gb", lambda: 16.0)
    monkeypatch.setattr("pantry.image_runtime._clear_mlx_after_timeout", lambda: None)
    monkeypatch.setattr("pantry.image_runtime._enable_mflux_low_ram", lambda *_a, **_k: None)
    monkeypatch.setattr("time.sleep", lambda _s: None)

    store = PackageStore(tmp_path / "home")
    store.ensure()
    man = PackageManifest(
        id="vdplabs.z-image-turbo.standard.v1",
        family="z-image",
        modalities=["image_gen"],
        ram_gb_min=10.0,
        bits_approx=4.0,
        quant_method="mflux-4bit",
        runtime={
            "primary": "mflux",
            "hf_repo": "filipstrand/Z-Image-Turbo-mflux-4bit",
        },
    )

    mock_zimage_cls = MagicMock()
    mock_model = MagicMock()
    mock_zimage_cls.return_value = mock_model

    mock_img = MagicMock()

    def _save(p):
        Path(p).write_bytes(b"\x89PNG\r\n\x1a\nfake-zimage")

    mock_img.save.side_effect = _save
    calls = {"n": 0}

    def _generate_image(**_kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError(
                "[METAL] Command buffer execution failed: Caused GPU Timeout Error "
                "(00000002:kIOGPUCommandBufferCallbackErrorTimeout)."
            )
        return mock_img

    mock_model.generate_image.side_effect = _generate_image

    mock_model_config = MagicMock()
    mock_model_config.z_image_turbo.return_value = MagicMock()

    with patch.dict(
        "sys.modules",
        {
            "mflux": MagicMock(),
            "mflux.models.common.config.model_config": MagicMock(ModelConfig=mock_model_config),
            "mflux.models.z_image.variants.z_image": MagicMock(ZImage=mock_zimage_cls),
        },
    ):
        rt = MFluxImageRuntime(store)
        res = rt.generate(man, prompt="cabin", size="512x512", n=1)

    assert calls["n"] == 2
    assert len(res) == 1
    assert base64.b64decode(res[0]["b64_json"]).startswith(b"\x89PNG")


def test_mflux_model_intact_helper():
    from pantry.image_runtime import _mflux_model_intact

    class _M:
        pass

    m = _M()
    m.text_encoder = object()
    m.transformer = object()
    m.vae = object()
    assert _mflux_model_intact(m)
    m.text_encoder = None
    assert not _mflux_model_intact(m)


def test_mflux_reloads_when_memory_saver_gutted_model(tmp_path, monkeypatch):
    """Reproduce Sink 500: cold-start timeout after MemorySaver nulled text_encoder."""
    monkeypatch.setattr("pantry.image_runtime._swap_used_gb", lambda: 0.0)
    monkeypatch.setattr("pantry.image_runtime._host_ram_gb", lambda: 16.0)
    monkeypatch.setattr("pantry.image_runtime._clear_mlx_after_timeout", lambda: None)
    monkeypatch.setattr("pantry.image_runtime._enable_mflux_low_ram", lambda *_a, **_k: None)
    monkeypatch.setattr("time.sleep", lambda _s: None)

    store = PackageStore(tmp_path / "home")
    store.ensure()
    man = PackageManifest(
        id="vdplabs.z-image-turbo.standard.v1",
        family="z-image",
        modalities=["image_gen"],
        ram_gb_min=10.0,
        bits_approx=4.0,
        quant_method="mflux-4bit",
        runtime={
            "primary": "mflux",
            "hf_repo": "filipstrand/Z-Image-Turbo-mflux-4bit",
        },
    )

    loads = {"n": 0}

    class _FakeZImage:
        def __init__(self, **_kwargs):
            loads["n"] += 1
            self.text_encoder = object()
            self.transformer = object()
            self.vae = object()
            self._calls = 0

        def generate_image(self, **_kwargs):
            self._calls += 1
            if loads["n"] == 1 and self._calls == 1:
                # Mirror mflux MemorySaver.call_before_loop
                self.text_encoder = None
                raise RuntimeError(
                    "[METAL] Command buffer execution failed: Caused GPU Timeout Error "
                    "(00000002:kIOGPUCommandBufferCallbackErrorTimeout)."
                )
            img = MagicMock()

            def _save(p):
                Path(p).write_bytes(b"\x89PNG\r\n\x1a\nfake-zimage-reload")

            img.save.side_effect = _save
            return img

    mock_model_config = MagicMock()
    mock_model_config.z_image_turbo.return_value = MagicMock()

    with patch.dict(
        "sys.modules",
        {
            "mflux": MagicMock(),
            "mflux.models.common.config.model_config": MagicMock(ModelConfig=mock_model_config),
            "mflux.models.z_image.variants.z_image": MagicMock(ZImage=_FakeZImage),
        },
    ):
        rt = MFluxImageRuntime(store)
        res = rt.generate(man, prompt="cabin", size="512x512", n=1)

    assert loads["n"] == 2  # initial + reload after gutting
    assert len(res) == 1
    assert base64.b64decode(res[0]["b64_json"]).startswith(b"\x89PNG")


def test_mflux_refuses_when_swap_high(tmp_path, monkeypatch):
    store = PackageStore(tmp_path / "home")
    store.ensure()
    man = PackageManifest(
        id="vdplabs.z-image-turbo.standard.v1",
        family="z-image",
        modalities=["image_gen"],
        ram_gb_min=10.0,
        bits_approx=4.0,
        quant_method="mflux-4bit",
        runtime={
            "primary": "mflux",
            "hf_repo": "filipstrand/Z-Image-Turbo-mflux-4bit",
        },
    )
    monkeypatch.setattr("pantry.image_runtime._swap_used_gb", lambda: 9.0)
    monkeypatch.setattr("pantry.image_runtime._host_ram_gb", lambda: 16.0)
    rt = MFluxImageRuntime(store)
    with pytest.raises(RuntimeError, match="cold image load|swap"):
        rt.generate(man, prompt="cabin", size="512x512")


def test_mflux_allows_high_swap_when_model_warm(tmp_path, monkeypatch):
    """Residual swap after first gen must not block a warm second Sink request."""
    monkeypatch.setattr("pantry.image_runtime._swap_used_gb", lambda: 5.4)
    monkeypatch.setattr("pantry.image_runtime._host_ram_gb", lambda: 16.0)
    monkeypatch.setattr("pantry.image_runtime._enable_mflux_low_ram", lambda *_a, **_k: None)

    store = PackageStore(tmp_path / "home")
    store.ensure()
    man = PackageManifest(
        id="vdplabs.z-image-turbo.standard.v1",
        family="z-image",
        modalities=["image_gen"],
        ram_gb_min=10.0,
        bits_approx=4.0,
        quant_method="mflux-4bit",
        runtime={
            "primary": "mflux",
            "hf_repo": "filipstrand/Z-Image-Turbo-mflux-4bit",
        },
    )

    class _FakeZImage:
        def __init__(self, **_kwargs):
            self.text_encoder = object()
            self.transformer = object()
            self.vae = object()

        def generate_image(self, **_kwargs):
            img = MagicMock()

            def _save(p):
                Path(p).write_bytes(b"\x89PNG\r\n\x1a\nwarm")

            img.save.side_effect = _save
            return img

    mock_model_config = MagicMock()
    mock_model_config.z_image_turbo.return_value = MagicMock()

    with patch.dict(
        "sys.modules",
        {
            "mflux": MagicMock(),
            "mflux.models.common.config.model_config": MagicMock(ModelConfig=mock_model_config),
            "mflux.models.z_image.variants.z_image": MagicMock(ZImage=_FakeZImage),
        },
    ):
        rt = MFluxImageRuntime(store)
        # Seed warm cache as if the first generate already succeeded.
        warm = _FakeZImage()
        rt._models[man.id] = warm
        res = rt.generate(man, prompt="cabin", size="512x512", n=1)

    assert len(res) == 1
    assert man.id in store.read_state().get("loaded", [])


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
