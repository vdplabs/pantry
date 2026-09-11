from __future__ import annotations

from pantry.runtime import resolve_draft_path
from pantry.schemas import PackageManifest, QualityTier
from pantry.store import PackageStore


def test_resolve_draft_path_requires_ready_weights(tmp_path, catalog_dir):
    store = PackageStore(tmp_path / "lib")
    store.ensure()
    store.seed_from_catalog(catalog_dir)
    target = store.load_manifest("vdplabs.qwen25-1.5b.standard.v1")
    assert target is not None
    assert target.runtime.draft_package_id == "vdplabs.qwen25-0.5b.compact.v1"

    path, draft_id = resolve_draft_path(store, target, prefer_speculative=True)
    assert path is None  # draft not pulled in tmp home
    assert draft_id is None

    path2, _ = resolve_draft_path(store, target, prefer_speculative=False)
    assert path2 is None


def test_echo_speculative_annotation():
    import asyncio

    from pantry.runtime import EchoRuntime
    from pantry.schemas import ChatMessage, RuntimeInfo

    man = PackageManifest(
        id="t",
        family="demo",
        quality_tier=QualityTier.standard,
        runtime=RuntimeInfo(primary="echo", draft_package_id="draft.x"),
    )
    rt = EchoRuntime()

    async def _run() -> str:
        return await rt.complete(
            man,
            [ChatMessage(role="user", content="hi")],
            max_tokens=64,
            temperature=0,
            prefer_speculative=True,
        )

    text = asyncio.run(_run())
    assert "speculative draft=draft.x" in text


def test_discover_speculative_pairs_curated(catalog_packages):
    from pantry.resolve import discover_speculative_pairs

    pairs = discover_speculative_pairs(
        catalog_packages,
        is_ready=lambda p: True,
        dynamic_ceiling_gb=32.0,
        chip_name="Apple M3 Max",
    )
    assert len(pairs) > 0
    # Find curated pair
    curated = [p for p in pairs if p.draft_package_id == "vdplabs.qwen25-0.5b.compact.v1"]
    assert len(curated) >= 1
    p = curated[0]
    assert p.target_package_id == "vdplabs.qwen25-1.5b.standard.v1"
    assert p.feasible_on_hardware is True
    assert p.composite_ram_gb > 0
    assert p.estimated_speedup > 1.0
    assert p.ready is True


def test_discover_speculative_pairs_dynamic_family():
    from pantry.resolve import discover_speculative_pairs
    from pantry.schemas import RuntimeInfo

    m_target = PackageManifest(
        id="meta.llama3.8b.standard.v1",
        family="llama3",
        modalities=["text"],
        quality_tier=QualityTier.standard,
        ram_gb_min=8.0,
        runtime=RuntimeInfo(primary="mlx", draft_package_id=None),
    )
    m_draft = PackageManifest(
        id="meta.llama3.1b.compact.v1",
        family="llama3",
        modalities=["text"],
        quality_tier=QualityTier.compact,
        ram_gb_min=2.0,
        runtime=RuntimeInfo(primary="mlx", draft_package_id=None),
    )

    pairs = discover_speculative_pairs(
        [m_target, m_draft],
        is_ready=lambda p: True,
        dynamic_ceiling_gb=16.0,
    )
    assert len(pairs) == 1
    p = pairs[0]
    assert p.target_package_id == "meta.llama3.8b.standard.v1"
    assert p.draft_package_id == "meta.llama3.1b.compact.v1"
    assert p.composite_ram_gb == 10.0
    assert p.feasible_on_hardware is True
    assert p.estimated_speedup > 1.0


def test_discover_speculative_pairs_hardware_ceiling():
    from pantry.resolve import discover_speculative_pairs
    from pantry.schemas import RuntimeInfo

    m_target = PackageManifest(
        id="large.model.v1",
        family="test",
        modalities=["text"],
        quality_tier=QualityTier.standard,
        ram_gb_min=20.0,
        runtime=RuntimeInfo(primary="mlx", draft_package_id="small.model.v1"),
    )
    m_draft = PackageManifest(
        id="small.model.v1",
        family="test",
        modalities=["text"],
        quality_tier=QualityTier.compact,
        ram_gb_min=4.0,
        runtime=RuntimeInfo(primary="mlx"),
    )

    # Dynamic ceiling is 16 GB, composite is 24 GB -> feasible_on_hardware should be False
    pairs = discover_speculative_pairs(
        [m_target, m_draft],
        is_ready=lambda p: True,
        dynamic_ceiling_gb=16.0,
    )
    assert len(pairs) == 1
    assert pairs[0].feasible_on_hardware is False


def test_resolve_with_explicit_draft_model(catalog_packages):
    from pantry.resolve import resolve
    from pantry.schemas import CapabilityRequest

    req = CapabilityRequest(
        modality="chat",
        quality_tier="standard",
        draft_model="chat-compact",
        prefer_speculative=True,
    )
    res = resolve(req, catalog_packages, is_ready=lambda p: True)
    assert res is not None
    assert res.package_id == "vdplabs.qwen25-1.5b.standard.v1"


def test_complete_request_draft_fields():
    from pantry.schemas import CompleteRequest

    req = CompleteRequest(
        model="chat-standard",
        messages=[{"role": "user", "content": "hi"}],
        draft_model="chat-compact",
        num_draft_tokens=5,
    )
    assert req.draft_model == "chat-compact"
    assert req.num_draft_tokens == 5
    dump = req.model_dump()
    assert dump["draft_model"] == "chat-compact"
    assert dump["num_draft_tokens"] == 5


def test_speculative_api_pairs_endpoint(client):
    r = client.get("/v1/speculative/pairs")
    assert r.status_code == 200
    data = r.json()
    assert "data" in data
    assert "chip_name" in data
    assert "dynamic_ceiling_gb" in data
    assert isinstance(data["data"], list)
    assert data["dynamic_ceiling_gb"] > 0


def test_speculative_api_benchmark_endpoint(client, monkeypatch):
    from pantry.runtime import EchoRuntime

    # Replace runtime with EchoRuntime for benchmark execution and mark ready
    monkeypatch.setattr(client.app.state.svc.runtimes, "for_manifest", lambda pkg: EchoRuntime())
    monkeypatch.setattr(client.app.state.svc.store, "weights_ready", lambda pkg: True)

    payload = {
        "target_model": "chat-standard",
        "draft_model": "chat-compact",
        "prompt": "Hello speculative world",
        "tokens": 16,
        "num_draft_tokens": 4,
    }
    r = client.post("/v1/speculative/benchmark", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["target_model"] == "chat-standard"
    assert data["draft_package_id"] == "vdplabs.qwen25-0.5b.compact.v1"
    assert "standalone_tps" in data
    assert "speculative_tps" in data
    assert "speedup" in data
    assert "accepted_tokens" in data


def test_speculative_chat_completions_speculative_details(client, monkeypatch):
    from pantry.runtime import EchoRuntime

    monkeypatch.setattr(client.app.state.svc.runtimes, "for_manifest", lambda pkg: EchoRuntime())
    monkeypatch.setattr(client.app.state.svc.store, "weights_ready", lambda pkg: True)

    # Seed demo package
    r = client.post(
        "/v1/chat/completions",
        json={
            "model": "chat-standard",
            "messages": [{"role": "user", "content": "test speculative"}],
            "max_tokens": 16,
            "draft_model": "chat-compact",
            "num_draft_tokens": 4,
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert "speculative_details" in data
    details = data["speculative_details"]
    assert details["draft_model"] == "chat-compact"
    assert details["num_draft_tokens"] == 4


def test_speculative_cli_commands(tmp_path, catalog_dir):
    import json

    from typer.testing import CliRunner

    from pantry.cli import app
    from pantry.store import PackageStore

    runner = CliRunner()
    home = tmp_path / "pantry_home"
    data = tmp_path / "pantry_data"

    # Seed manifests so store has packages
    store = PackageStore(home)
    store.ensure()
    store.seed_from_catalog(catalog_dir)

    # Test 'pantry speculative list --as-json'
    res = runner.invoke(
        app,
        ["speculative", "list", "--as-json", "--home", str(home), "--data", str(data)],
    )
    assert res.exit_code == 0
    parsed = json.loads(res.output)
    assert isinstance(parsed, list)
    assert len(parsed) > 0

    # Test alias 'pantry spec list'
    res_alias = runner.invoke(
        app,
        ["spec", "list", "--home", str(home), "--data", str(data)],
    )
    assert res_alias.exit_code == 0
    assert "Speculative Candidate Pairs" in res_alias.output

    # Test 'pantry spec pair chat-standard chat-compact'
    res_pair = runner.invoke(
        app,
        ["spec", "pair", "chat-standard", "chat-compact", "--home", str(home), "--data", str(data)],
    )
    assert res_pair.exit_code == 0
    assert "vdplabs.qwen25-0.5b.compact.v1" in res_pair.output

