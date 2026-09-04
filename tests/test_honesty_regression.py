from __future__ import annotations

import os
from pathlib import Path

from fastapi.testclient import TestClient

from pantry.pull import pull_package
from pantry.resolve import find_by_model_string
from pantry.store import PackageStore


def test_shared_hf_cache_pull_skip_no_empty_dir(tmp_path: Path) -> None:
    """Ensure that pull_package reuses pre-existing HF snapshots and does NOT mkdir an empty weights dir."""
    store = PackageStore(tmp_path / "pantry-home")
    store.ensure()

    # Create a manifest that references an HF repo
    man = store.install_from_bundled_catalog("vdplabs.qwen25-0.5b.compact.v1")
    assert man is not None

    # Set up a fake shared Hugging Face cache snapshot
    hf_hub = tmp_path / "fake_hf_hub"
    os.environ["HF_HUB_CACHE"] = str(hf_hub)
    repo_folder = hf_hub / f"models--{man.runtime.hf_repo.replace('/', '--')}"
    snapshot = repo_folder / "snapshots" / "abc123def"
    snapshot.mkdir(parents=True, exist_ok=True)
    (snapshot / "config.json").write_text("{}", encoding="utf-8")
    (snapshot / "model.safetensors").write_bytes(b"dummy weight data")

    # Package weights directory before pull
    pkg_weights = store.weights_dir(man.id)
    assert not pkg_weights.exists()

    # Pull should detect the existing snapshot in the shared cache
    res = pull_package(store, man.id)
    assert res["status"] == "ready"
    assert res["weights_path"] == str(snapshot)

    # CRITICAL: pkg_weights must NOT have been created as an empty directory!
    assert not pkg_weights.exists()


def test_no_hardcoded_developer_paths() -> None:
    """Verify no developer external volume paths are hardcoded in the codebase."""
    root = Path(__file__).resolve().parent.parent
    check_dirs = [root / "src", root / "catalog", root / "Docs"]
    target_drive = "".join(["/Volumes/", "T7", " ", "Shield"])

    for d in check_dirs:
        if not d.is_dir():
            continue
        for p in d.rglob("*"):
            if p.is_file() and p.suffix in {".py", ".json", ".md", ".toml"}:
                content = p.read_text(encoding="utf-8", errors="ignore")
                assert target_drive not in content, f"Forbidden hardcoded path found in {p}"


def test_music_resolve_honesty(client: TestClient, catalog_packages) -> None:
    """Ensure capability resolve for music returns honest demo scaffold and never a fake neural runtime."""
    r = client.post("/v1/resolve", json={"modality": "music"})
    assert r.status_code == 200
    body = r.json()
    assert body["package_id"] == "vdplabs.demo-music.compact.v1"
    assert body["alias"] in {"music-compact", "music"}

    # Soft alias music-standard must not invent a fake engine — fall back to compact scaffold.
    chosen = find_by_model_string("music-standard", catalog_packages, is_ready=lambda _p: True)
    assert chosen is not None
    assert chosen.id == "vdplabs.demo-music.compact.v1"
    assert (chosen.runtime.primary or "").startswith("echo")
    assert "magnet" not in (chosen.runtime.primary or "").lower()
    assert "magnet" not in chosen.family.lower()
    assert not any(p.family.lower() == "magnet" for p in catalog_packages)


def test_mflux_component_tree_counts_as_ready(tmp_path: Path) -> None:
    """mflux Z-Image trees have transformer/*.safetensors and no root config.json."""
    from pantry.schemas import PackageManifest

    store = PackageStore(tmp_path / "home", data_root=tmp_path / "huggingface" / "pantry")
    store.ensure()
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
    weights = store.weights_dir(man.id)
    (weights / "transformer").mkdir(parents=True)
    (weights / "text_encoder").mkdir(parents=True)
    (weights / "vae").mkdir(parents=True)
    (weights / "transformer" / "0.safetensors").write_bytes(b"x")
    (weights / "text_encoder" / "0.safetensors").write_bytes(b"x")
    (weights / "vae" / "0.safetensors").write_bytes(b"x")

    assert store._is_dir_weights_complete(weights, man)
    assert store.resolve_weights_path(man) == weights
    assert store.weights_ready(man)


def test_models_excludes_all_demos_by_default(client: TestClient) -> None:
    """Ensure /v1/models hides chat, image, music, embed, and STT demos unless demos=true is passed."""
    r = client.get("/v1/models")
    assert r.status_code == 200
    ids = {m["id"] for m in r.json()["data"]}

    # None of the demo aliases or package IDs should appear in the default public list
    assert "demo-compact" not in ids
    assert "demo-standard" not in ids
    assert "demo-llama" not in ids
    assert "image-compact" not in ids
    assert "music-compact" not in ids
    assert "embed-compact" not in ids
    assert "transcribe-compact" not in ids
    assert "whisper-demo" not in ids

    # But with demos=true, they should all appear
    r_demos = client.get("/v1/models", params={"demos": "true"})
    assert r_demos.status_code == 200
    ids_demos = {m["id"] for m in r_demos.json()["data"]}
    assert "demo-compact" in ids_demos
    assert "image-compact" in ids_demos
    assert "music-compact" in ids_demos
    assert "embed-compact" in ids_demos
