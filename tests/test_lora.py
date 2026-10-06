from __future__ import annotations

import json
from pathlib import Path
from typer.testing import CliRunner
from starlette.testclient import TestClient

from pantry.cli import app as cli_app
from pantry.lora import LoRAAdapter, LoRAAdapterManager
from pantry.store import PackageStore


def test_lora_manager_registry_and_benchmarking():
    LoRAAdapterManager.reset()
    mgr = LoRAAdapterManager.get()

    # Verify default curated adapters are present
    adapters = mgr.list_adapters()
    ids = [a.id for a in adapters]
    assert "coder-lora" in ids
    assert "reasoning-lora" in ids
    assert "medical-lora" in ids
    assert "flux-realism-lora" in ids
    assert "flux-anime-lora" in ids

    realism = mgr.get_adapter("flux-realism-lora")
    assert realism is not None
    assert realism.modality == "image"
    assert realism.base_family == "flux"

    # Test custom adapter registration
    custom = LoRAAdapter(
        adapter_id="custom-sec-lora",
        name="Security Audit Specialist",
        base_family="qwen",
        rank=32,
        alpha=64.0,
        target_modules=["q_proj", "v_proj", "k_proj"],
        size_bytes=42 * 1024 * 1024,
    )
    mgr.register_adapter(custom)
    fetched = mgr.get_adapter("custom-sec-lora")
    assert fetched is not None
    assert fetched.rank == 32
    assert fetched.scale == 2.0

    # Test hot-swap performance benchmark (<30ms)
    swap_ms = mgr.apply_adapter("chat-model", "coder-lora", scale=1.0)
    assert swap_ms < 30.0, f"Swap latency {swap_ms}ms exceeded 30ms SLA!"
    assert mgr.get_active_adapters("chat-model") == ["coder-lora"]

    # Swap in another adapter
    mgr.apply_adapter("chat-model", "custom-sec-lora", scale=0.8)
    assert mgr.get_active_adapters("chat-model") == ["coder-lora", "custom-sec-lora"]

    # Partial unload
    unloaded = mgr.unload_adapter("chat-model", "coder-lora")
    assert unloaded == ["coder-lora"]
    assert mgr.get_active_adapters("chat-model") == ["custom-sec-lora"]

    # Full unload
    unloaded_all = mgr.unload_adapter("chat-model")
    assert unloaded_all == ["custom-sec-lora"]
    assert mgr.get_active_adapters("chat-model") == []


def test_server_adapter_endpoints(client: TestClient):
    # 1. GET /v1/adapters
    r_list = client.get("/v1/adapters")
    assert r_list.status_code == 200
    data = r_list.json().get("adapters", [])
    assert any(a["id"] == "coder-lora" for a in data)

    # 2. POST /v1/adapters/apply
    r_apply = client.post(
        "/v1/adapters/apply",
        json={"model": "chat-standard", "adapter": "coder-lora", "scale": 1.0},
    )
    assert r_apply.status_code == 200
    apply_data = r_apply.json()
    assert apply_data["ok"] is True
    assert apply_data["adapter"] == "coder-lora"
    assert apply_data["swap_duration_ms"] < 30.0
    assert "coder-lora" in apply_data["active_adapters"]

    # 3. POST /v1/adapters/unload
    r_unload = client.post(
        "/v1/adapters/unload",
        json={"model": "chat-standard", "adapter": "coder-lora"},
    )
    assert r_unload.status_code == 200
    unload_data = r_unload.json()
    assert unload_data["ok"] is True
    assert unload_data["unloaded_adapters"] == ["coder-lora"]


def test_chat_completions_with_adapters(client: TestClient):
    # Chat completion requesting coder-lora
    resp = client.post(
        "/v1/chat/completions",
        json={
            "model": "demo-standard",
            "messages": [{"role": "user", "content": "Write a python fibonacci function"}],
            "adapters": ["coder-lora"],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("adapters") == ["coder-lora"]
    content = body["choices"][0]["message"]["content"]
    assert "[active lora: coder-lora]" in content
    assert body["usage"].get("active_adapters") == ["coder-lora"]


def test_cli_lora_subcommands(tmp_path: Path, catalog_dir: Path):
    store = PackageStore(tmp_path / "pantry-home")
    store.ensure()
    store.seed_from_catalog(catalog_dir)
    home = store.root
    data = store.data_root
    runner = CliRunner()

    # CLI lora list
    res_list = runner.invoke(cli_app, ["lora", "list", "--port", "59999", "--home", str(home), "--data", str(data)])
    assert res_list.exit_code == 0
    assert "coder-lora" in res_list.output

    # CLI lora apply
    res_apply = runner.invoke(
        cli_app,
        ["lora", "apply", "demo-standard", "coder-lora", "--port", "59999", "--home", str(home), "--data", str(data)],
    )
    assert res_apply.exit_code == 0
    assert "Applied LoRA 'coder-lora'" in res_apply.output

    # CLI lora unload
    res_unload = runner.invoke(
        cli_app,
        ["lora", "unload", "demo-standard", "coder-lora", "--port", "59999", "--home", str(home), "--data", str(data)],
    )
    assert res_unload.exit_code == 0
    assert "Unloaded adapters" in res_unload.output

    # CLI chat with adapter flag
    res_chat = runner.invoke(
        cli_app,
        ["chat", "write a hello function", "--model", "demo-standard", "-a", "coder-lora", "--port", "59999", "--home", str(home), "--data", str(data)],
    )
    assert res_chat.exit_code == 0
    assert "[active lora: coder-lora]" in res_chat.output


def test_resolve_adapter_path_and_discovery(tmp_path: Path):
    import os

    test_dir = tmp_path / "adapters"
    test_dir.mkdir(parents=True, exist_ok=True)
    ana_file = test_dir / "AnaDeArmas_KREA2.safetensors"
    ana_file.write_bytes(b"dummy safetensors content")

    os.environ["PANTRY_ADAPTERS_PATH"] = str(test_dir)
    try:
        mgr = LoRAAdapterManager()

        # 1. Resolve AnaDeArmas_KREA2 present in PANTRY_ADAPTERS_PATH
        resolved = mgr.resolve_adapter_path("AnaDeArmas_KREA2")
        assert resolved is not None
        assert Path(resolved).is_file()
        assert "AnaDeArmas_KREA2.safetensors" in resolved

        # 2. Case and variation handling
        assert Path(mgr.resolve_adapter_path("anadearmas_krea2")).samefile(resolved)
        assert Path(mgr.resolve_adapter_path("AnaDeArmas_KREA2.safetensors")).samefile(resolved)
        assert Path(mgr.resolve_adapter_path("AnaDeArmas-KREA2")).samefile(resolved)

        # 3. file:// URI handling
        file_uri = f"file://{resolved}"
        assert mgr.resolve_adapter_path(file_uri) == resolved

        # 4. Custom folder path resolution
        custom_dir = tmp_path / "custom_loras"
        custom_dir.mkdir()
        dummy_lora = custom_dir / "my_custom_lora.safetensors"
        dummy_lora.write_bytes(b"dummy")

        os.environ["PANTRY_ADAPTERS_PATH"] = f"{test_dir}:{custom_dir}"
        custom_resolved = mgr.resolve_adapter_path("my_custom_lora")
        assert custom_resolved == str(dummy_lora.resolve())

        # 5. Non-existent returns None
        assert mgr.resolve_adapter_path("non_existent_lora_xyz_123") is None

        # 6. Auto-discovery surfaces AnaDeArmas_KREA2 in list_adapters
        adapters = mgr.list_adapters()
        adapter_ids = [a.id for a in adapters]
        assert "AnaDeArmas_KREA2" in adapter_ids
        ana_record = mgr.get_adapter("AnaDeArmas_KREA2")
        assert ana_record is not None
        assert ana_record.path == resolved
    finally:
        os.environ.pop("PANTRY_ADAPTERS_PATH", None)

