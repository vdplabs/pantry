import time
from pathlib import Path

from fastapi.testclient import TestClient
from typer.testing import CliRunner

from pantry.cli import app as cli_app
from pantry.config import bundled_catalog_dir
from pantry.hub import (
    create_custom_pack,
    delete_custom_pack,
    evaluate_hardware_fit,
    generate_manifest_template,
    get_intent_bindings,
    get_model_details,
    rebind_intent_alias,
    search_hub,
)
from pantry.resolve import find_by_model_string
from pantry.server import create_app
from pantry.store import PackageStore
from pantry.telemetry import TelemetryCollector


def test_evaluate_hardware_fit_thresholds():
    device_info = {
        "device_name": "Apple M1 Pro",
        "memory_size_bytes": 16 * 1024**3,
        "recommended_working_set_bytes": 11800000000,
    }

    # Small 1 GB model: working set = 3 GB + 1.15 GB = 4.15 GB / 11.8 GB (~35%) -> Runs Great
    fit_small = evaluate_hardware_fit(1 * 1024**3, device_info)
    assert fit_small["fit_status"] == "runs_great"
    assert fit_small["compatible"] is True
    assert fit_small["working_set_gb"] == 11.0 or fit_small["working_set_gb"] == 11.8

    # Moderate 5 GB model: working set = 3 GB + 5.75 GB = 8.75 GB / 11.8 GB (~74%) -> Good Fit
    fit_med = evaluate_hardware_fit(5 * 1024**3, device_info)
    assert fit_med["fit_status"] == "good_fit"
    assert fit_med["compatible"] is True

    # Large 14 GB model: working set = 3 GB + 16.1 GB = 19.1 GB / 11.8 GB (>100%) -> Requires More RAM
    fit_large = evaluate_hardware_fit(14 * 1024**3, device_info)
    assert fit_large["fit_status"] == "requires_more_ram"
    assert fit_large["compatible"] is False


def test_search_hub_curated():
    results = search_hub(query="DeepSeek", modality="all")
    assert len(results) >= 2
    first = results[0]
    assert "deepseek" in first["repo_id"].lower()
    assert "fit" in first
    assert first["fit"]["fit_label"] in ["Runs Great", "Good Fit", "Tight Fit", "Requires More RAM"]


def test_search_hub_modality_filter():
    results_coder = search_hub(query="", modality="coder")
    assert len(results_coder) >= 1
    for m in results_coder:
        assert m["role"] == "coder" or "coder" in m["family"]

    results_audio = search_hub(query="", modality="audio")
    assert len(results_audio) >= 1
    for m in results_audio:
        assert m["modality"] in ["stt", "audio"] or m["role"] == "audio"


def test_get_model_details_curated():
    details = get_model_details("mlx-community/DeepSeek-R1-Distill-Qwen-7B-4bit")
    assert details["repo_id"] == "mlx-community/DeepSeek-R1-Distill-Qwen-7B-4bit"
    assert details["architecture"] == "Qwen2ForCausalLM"
    assert details["fit"]["compatible"] is True
    assert details["params_b"] == 7.6


def test_generate_manifest_template():
    man = generate_manifest_template(
        repo_id="mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
        title="Qwen 2.5 Coder 7B",
        modality="text",
        role="coder",
        tier="standard",
        aliases=["coder", "coder-standard"],
    )
    assert man.id == "local.qwen2.5-coder-7b-instruct-4bit.standard.v1"
    assert man.title == "Qwen 2.5 Coder 7B"
    assert man.family == "qwen2.5-coder"
    assert man.aliases == ["coder", "coder-standard"]
    assert man.runtime.hf_repo == "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit"


def test_pack_intents_and_rebinding(tmp_path: Path):
    store = PackageStore(tmp_path)
    store.seed_from_catalog(bundled_catalog_dir())

    # 1. Inspect default intents
    intents = get_intent_bindings(store)
    chat_intent = next(i for i in intents if i["alias"] == "chat-standard")
    assert chat_intent["active_package"] is not None
    assert "qwen" in chat_intent["active_package"]["package_id"].lower()

    # 2. Rebind chat-standard to deepseek-r1
    target_id = "vdplabs.deepseek-r1-distill-qwen-1.5b.compact.v1"
    rebound = rebind_intent_alias(store, "chat-standard", target_id)
    assert "chat-standard" in rebound.aliases

    # 3. Verify resolve resolution
    pkgs = store.list_manifests()
    resolved = find_by_model_string("chat-standard", pkgs)
    assert resolved is not None
    assert resolved.id == target_id

    # 4. Verify updated intent bindings
    intents_updated = get_intent_bindings(store)
    chat_updated = next(i for i in intents_updated if i["alias"] == "chat-standard")
    assert chat_updated["active_package"]["package_id"] == target_id


def test_create_and_delete_custom_pack(tmp_path: Path):
    store = PackageStore(tmp_path)
    manifest_data = {
        "id": "local.custom-agent-llm.v1",
        "title": "Custom Agent LLM",
        "hf_repo": "mlx-community/Custom-Agent-7B-4bit",
        "aliases": ["agent-primary"],
        "quality_tier": "standard",
        "params_b": 7.0,
    }

    pkg = create_custom_pack(store, manifest_data)
    assert pkg.id == "local.custom-agent-llm.v1"
    assert store.load_manifest("local.custom-agent-llm.v1") is not None

    # Verify alias resolution
    pkgs = store.list_manifests()
    matched = find_by_model_string("agent-primary", pkgs)
    assert matched is not None
    assert matched.id == "local.custom-agent-llm.v1"

    # Delete pack
    deleted = delete_custom_pack(store, "local.custom-agent-llm.v1")
    assert deleted is True
    assert store.load_manifest("local.custom-agent-llm.v1") is None


def test_server_pack_endpoints(tmp_path: Path):
    store = PackageStore(tmp_path)
    store.seed_from_catalog(bundled_catalog_dir())
    app = create_app(store)
    client = TestClient(app)

    # 1. GET /v1/hub/search
    r = client.get("/v1/hub/search?modality=chat")
    assert r.status_code == 200
    models = r.json().get("models", [])
    assert len(models) >= 1

    # 2. GET /v1/hub/details
    r = client.get("/v1/hub/details?repo_id=mlx-community/DeepSeek-R1-Distill-Qwen-7B-4bit")
    assert r.status_code == 200
    m_info = r.json().get("model", {})
    assert m_info["title"] == "DeepSeek R1 7B"

    # 3. GET /v1/packs/intents
    r = client.get("/v1/packs/intents")
    assert r.status_code == 200
    intents = r.json().get("intents", [])
    assert any(i["alias"] == "chat-standard" for i in intents)

    # 4. POST /v1/packs/rebind
    r = client.post("/v1/packs/rebind", json={
        "alias": "chat-standard",
        "package_id": "vdplabs.deepseek-r1-distill-qwen-1.5b.compact.v1",
    })
    assert r.status_code == 200
    assert r.json()["package_id"] == "vdplabs.deepseek-r1-distill-qwen-1.5b.compact.v1"

    # 5. POST /v1/packs/create
    r = client.post("/v1/packs/create", json={
        "id": "local.api-test-pack.v1",
        "title": "API Test Pack",
        "hf_repo": "mlx-community/ApiTestPack-4bit",
        "aliases": ["api-alias"],
    })
    assert r.status_code == 200
    assert r.json()["package"]["id"] == "local.api-test-pack.v1"

    # 6. DELETE /v1/packs/{package_id}
    r = client.delete("/v1/packs/local.api-test-pack.v1")
    assert r.status_code == 200
    assert r.json()["deleted"] == "local.api-test-pack.v1"


def test_cli_hub_and_pack_commands(tmp_path: Path):
    runner = CliRunner()

    # 1. pantry hub search
    res = runner.invoke(cli_app, ["hub", "search", "DeepSeek", "--json"])
    assert res.exit_code == 0
    assert "DeepSeek R1" in res.stdout

    # 2. pantry pack intents
    res = runner.invoke(cli_app, ["pack", "intents", "--home", str(tmp_path), "--json"])
    assert res.exit_code == 0
    assert "chat-standard" in res.stdout

    # 3. pantry pack create
    res = runner.invoke(cli_app, [
        "pack", "create",
        "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
        "--id", "local.cli-test.v1",
        "--title", "CLI Test Pack",
        "--home", str(tmp_path),
    ])
    assert res.exit_code == 0
    assert "Registered model pack: local.cli-test.v1" in res.stdout

    # 4. pantry pack rebind
    res = runner.invoke(cli_app, [
        "pack", "rebind",
        "coder", "local.cli-test.v1",
        "--home", str(tmp_path),
    ])
    assert res.exit_code == 0
    assert "Successfully rebound 'coder' to 'local.cli-test.v1'" in res.stdout

    # 5. pantry pack delete
    res = runner.invoke(cli_app, [
        "pack", "delete",
        "local.cli-test.v1",
        "--home", str(tmp_path),
    ])
    assert res.exit_code == 0
    assert "Deleted package local.cli-test.v1" in res.stdout


def test_telemetry_real_apple_silicon_gpu_and_macos_memory(tmp_path: Path):
    store = PackageStore(root=tmp_path)
    collector = TelemetryCollector(store)

    hw_info = {"device_name": "Apple M1 Pro", "is_apple_silicon": True}
    snap = {"active_bytes": int(1.5 * 1024**3), "total_bytes": 16 * 1024**3}

    # 1. Real hardware GPU sampling
    gpu = collector._sample_apple_silicon_gpu(hw_info, snap, is_busy=False)
    assert 0.0 <= gpu["utilization_percent"] <= 100.0
    assert "vram_used_human" in gpu
    assert "Apple" in gpu["name"]
    assert "GPU" in gpu["name"]

    # 2. Test 100% GPU utilization during video generation (no longer stuck at 38%)
    collector._last_apple_gpu = (time.time(), (100.0, 1200 * 1024**2))
    gpu_video = collector._sample_apple_silicon_gpu(hw_info, snap, is_busy=True)
    assert gpu_video["utilization_percent"] == 100.0
    assert gpu_video["vram_used_bytes"] == 1200 * 1024**2
    assert gpu_video["power_watts"] > 25.0

    # 3. Test system memory sample
    mem = collector._sample_memory(snap)
    assert mem["total_bytes"] > 0
    assert mem["used_bytes"] > 0
    assert "app_human" in mem
    assert "wired_human" in mem
    assert "compressed_human" in mem


def test_huggingface_hub_search(tmp_path: Path):
    store = PackageStore(tmp_path)
    app = create_app(store)
    client = TestClient(app)

    # 1. Search Hugging Face Hub for Qwen models
    r = client.get("/v1/hub/search?q=qwen&source=hf&limit=5")
    assert r.status_code == 200
    models = r.json().get("models", [])
    assert len(models) >= 1
    assert any("qwen" in m["repo_id"].lower() for m in models)
    assert all(m["source"] == "hub" for m in models)
    assert "downloads" in models[0]
    assert "fit" in models[0]

    # 2. Search Hugging Face Hub with empty query (defaults to top MLX models)
    r = client.get("/v1/hub/search?source=hf&limit=5")
    assert r.status_code == 200
    models_empty = r.json().get("models", [])
    assert len(models_empty) >= 1
    assert all(m["source"] == "hub" for m in models_empty)

    # 3. Search for "hugging face" specifically
    r = client.get("/v1/hub/search?q=hugging+face&source=hf&limit=5")
    assert r.status_code == 200
    models_hf = r.json().get("models", [])
    assert len(models_hf) >= 1
    assert all(m["source"] == "hub" for m in models_hf)


