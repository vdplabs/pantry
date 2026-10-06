from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from pantry.adopt import adopt_local_model, inspect_model_source
from pantry.cli import app as cli_app
from pantry.store import PackageStore


def test_inspect_model_source_safetensors_tree(tmp_path: Path):
    model_dir = tmp_path / "my-custom-model"
    model_dir.mkdir(parents=True)

    config = {
        "architectures": ["Qwen2ForCausalLM"],
        "model_type": "qwen2",
        "max_position_embeddings": 32768,
        "quantization": {"bits": 4},
    }
    (model_dir / "config.json").write_text(json.dumps(config), encoding="utf-8")
    (model_dir / "model.safetensors").write_bytes(b"dummy-weights" * 100)

    info = inspect_model_source(model_dir)
    assert info["format"] == "safetensors_tree"
    assert info["architecture"] == "Qwen2ForCausalLM"
    assert info["role"] == "chat"
    assert info["quant_method"] == "mlx_4bit"
    assert info["bits_approx"] == 4.0
    assert info["context_max"] == 32768


def test_inspect_model_source_single_gguf(tmp_path: Path):
    gguf_file = tmp_path / "model-q4_0.gguf"
    gguf_file.write_bytes(b"GGUF" + b"\x00" * 1024)

    info = inspect_model_source(gguf_file)
    assert info["format"] == "gguf"
    assert info["primary"] == "llama_cpp"
    assert info["quant_method"] == "gguf"


def test_adopt_local_model_zero_copy(tmp_path: Path):
    store = PackageStore(tmp_path / "pantry-home")
    store.ensure()

    # Create dummy local model
    source_dir = tmp_path / "external_models" / "qwen-mini"
    source_dir.mkdir(parents=True)
    (source_dir / "config.json").write_text(json.dumps({"model_type": "qwen2"}), encoding="utf-8")
    (source_dir / "model.safetensors").write_bytes(b"safetensors-content" * 200)

    man, stats = adopt_local_model(
        store,
        source_path=source_dir,
        package_id="local.qwen-mini.v1",
        alias="mini",
        title="Qwen Mini Local",
    )

    assert man.id == "local.qwen-mini.v1"
    assert "mini" in man.aliases
    assert stats["bytes_duplicated"] == 0

    # Verify weights_ready and resolve_weights_path
    assert store.weights_ready(man) is True
    resolved = store.resolve_weights_path(man)
    assert resolved is not None
    # Resolved points to source path or symlink
    assert resolved.resolve() == source_dir.resolve()


def test_cli_adopt_command(tmp_path: Path):
    pantry_home = tmp_path / "pantry-home"
    store = PackageStore(pantry_home)
    store.ensure()

    source_dir = tmp_path / "downloads" / "whisper-local"
    source_dir.mkdir(parents=True)
    (source_dir / "config.json").write_text(json.dumps({"model_type": "whisper"}), encoding="utf-8")
    (source_dir / "model.safetensors").write_bytes(b"audio-data" * 100)

    runner = CliRunner()
    res = runner.invoke(
        cli_app,
        [
            "adopt",
            str(source_dir),
            "--id",
            "local.whisper-test.v1",
            "--alias",
            "whisper-local",
            "--home",
            str(pantry_home),
        ],
    )
    assert res.exit_code == 0
    assert "Adopted model package 'local.whisper-test.v1'" in res.stdout
    assert "0 bytes duplicated" in res.stdout

    # Verify manifest is registered in store
    saved_man = store.load_manifest("local.whisper-test.v1")
    assert saved_man is not None
    assert "whisper-local" in saved_man.aliases
    assert store.weights_ready(saved_man) is True
