from __future__ import annotations

import hashlib
from unittest.mock import patch

import pytest

from pantry.pull import PullError, pull_package
from pantry.resolve import ResolveError, find_by_model_string, resolve
from pantry.schemas import CapabilityRequest, ChatMessage, PackageManifest, QualityTier
from pantry.store import PackageStore
from pantry.template import apply_chat_template


def _pkg(**kwargs) -> PackageManifest:
    base = {
        "id": "pkg.a",
        "family": "demo",
        "quality_tier": QualityTier.standard,
        "ram_gb_min": 2,
        "ram_gb_comfortable": 4,
        "modalities": ["text"],
        "template_family": "chatml",
        "runtime": {"primary": "echo"},
    }
    base.update(kwargs)
    return PackageManifest.model_validate(base)


@pytest.mark.parametrize(
    "request_kwargs,expect_id",
    [
        ({"modality": "chat", "ram_gb_max": 8}, "vdplabs.qwen25-0.5b.compact.v1"),
        (
            {"modality": "chat", "quality_tier": QualityTier.standard, "family_prefer": "demo"},
            "vdplabs.demo-chat.standard.v1",
        ),
        (
            {"modality": "chat", "quality_tier": QualityTier.compact},
            "vdplabs.qwen25-0.5b.compact.v1",
        ),
        (
            {"modality": "chat", "template_family": "llama3"},
            "vdplabs.llama32-1b.compact.v1",
        ),
        (
            {
                "modality": "chat",
                "prefer_speculative": True,
                "quality_tier": QualityTier.standard,
                "family_prefer": "demo",
            },
            "vdplabs.demo-chat.standard.v1",
        ),
    ],
)
def test_resolve_table(catalog_packages, request_kwargs, expect_id):
    req = CapabilityRequest(**request_kwargs)
    result = resolve(req, catalog_packages)
    assert result.package_id == expect_id
    if request_kwargs.get("prefer_speculative"):
        assert result.plan.get("speculative") is True
        assert result.plan.get("draft_package_id") == "vdplabs.demo-chat.compact.v1"


def test_resolve_prefers_real_over_echo_even_if_unready(catalog_packages, tmp_path):
    """Clean install: resolve must point at Qwen (need pull), not a hidden echo demo."""
    store = PackageStore(tmp_path / "lib")
    store.ensure()
    for p in catalog_packages:
        store.write_manifest(p)
    qwen = next(p for p in catalog_packages if "qwen25-0.5b" in p.id)
    echo = next(p for p in catalog_packages if p.id.endswith("demo-chat.compact.v1"))

    def ready(p: PackageManifest) -> bool:
        return p.id != qwen.id  # echo ready, qwen not

    result = resolve(
        CapabilityRequest(modality="chat", quality_tier=QualityTier.compact),
        [qwen, echo],
        is_ready=ready,
    )
    assert result.package_id == qwen.id
    assert result.plan.get("weights_ready") is False


def test_resolve_extreme_no_silent_fallback(catalog_packages):
    with pytest.raises(ResolveError, match="quality_tier=extreme"):
        resolve(
            CapabilityRequest(modality="chat", quality_tier=QualityTier.extreme),
            catalog_packages,
        )


def test_resolve_refuses_template_cross(catalog_packages):
    req = CapabilityRequest(modality="chat", template_family="chatml", pin_family="llama")
    with pytest.raises(ResolveError, match="template_family|pin_family|no package"):
        resolve(req, catalog_packages)


def test_resolve_ram_too_small():
    pkgs = [_pkg(id="big", ram_gb_min=16, ram_gb_comfortable=24)]
    with pytest.raises(ResolveError, match="ram_gb_max"):
        resolve(CapabilityRequest(modality="chat", ram_gb_max=8), pkgs)


def test_resolve_image_gen_ignores_chat(catalog_packages):
    chat_only = [p for p in catalog_packages if "text" in [m.lower() for m in p.modalities]]
    with pytest.raises(ResolveError, match="modality"):
        resolve(CapabilityRequest(modality="image_gen"), chat_only)


def test_resolve_image_gen_picks_image_pack(catalog_packages):
    result = resolve(CapabilityRequest(modality="image_gen"), catalog_packages)
    resolved = next((p for p in catalog_packages if p.id == result.package_id), None)
    assert resolved is not None
    assert "image_gen" in resolved.modalities


def test_resolve_chat_never_picks_image(catalog_packages):
    result = resolve(
        CapabilityRequest(modality="chat", quality_tier=QualityTier.compact),
        catalog_packages,
    )
    chosen = next(p for p in catalog_packages if p.id == result.package_id)
    assert "image_gen" not in [m.lower() for m in chosen.modalities]
    assert "text" in [m.lower() for m in chosen.modalities]


def test_find_by_alias(catalog_packages):
    assert find_by_model_string("chat-standard", catalog_packages).id == (
        "vdplabs.qwen25-1.5b.standard.v1"
    )
    assert find_by_model_string("chat-fast", catalog_packages).id == (
        "vdplabs.qwen25-1.5b.standard.v1"
    )
    assert find_by_model_string("chat-compact", catalog_packages).id == (
        "vdplabs.qwen25-0.5b.compact.v1"
    )


def test_template_chatml_includes_system():
    man = _pkg(system_preamble="Be brief.")
    text = apply_chat_template(man, [ChatMessage(role="user", content="hi")])
    assert "<|im_start|>system" in text
    assert "Be brief." in text
    assert text.endswith("<|im_start|>assistant\n")


def test_cas_store_dedupes(tmp_path):
    store = PackageStore(tmp_path / "lib")
    store.ensure()
    data = b"hello-weights"
    d1 = store.put_blob(data)
    d2 = store.put_blob(data)
    assert d1 == d2 == hashlib.sha256(data).hexdigest()
    assert len(list((tmp_path / "lib" / "blobs").iterdir())) == 1


def test_split_home_and_data_roots(tmp_path):
    """Metadata on home; blobs + weights on a separate data volume."""
    home = tmp_path / "ssd-home"
    data = tmp_path / "thunderbolt-data"
    store = PackageStore(home, data_root=data)
    store.ensure()
    digest = store.put_blob(b"big-blob")
    assert (data / "blobs" / digest).is_file()
    assert not (home / "blobs").exists() or not any((home / "blobs").iterdir())
    wdir = store.weights_dir("vdplabs.demo.v1")
    assert wdir == data / "packages" / "vdplabs.demo.v1" / "weights"
    assert store.artifacts_dir == data / "artifacts"
    store.write_manifest(_pkg(id="vdplabs.demo.v1"))
    assert (home / "packages" / "vdplabs.demo.v1" / "manifest.json").is_file()
    assert store.load_manifest("vdplabs.demo.v1") is not None


def test_seed_catalog(tmp_path, catalog_dir):
    store = PackageStore(tmp_path / "lib")
    store.ensure()
    ids = store.seed_from_catalog(catalog_dir)
    assert "vdplabs.demo-chat.standard.v1" in ids
    assert "vdplabs.qwen25-0.5b.compact.v1" in ids
    assert "vdplabs.qwen25-1.5b.standard.v1" in ids
    assert "vdplabs.demo-image.compact.v1" in ids
    assert "vdplabs.demo-music.compact.v1" in ids
    assert len(store.list_manifests()) >= 7


def test_pull_echo_ready(tmp_path, catalog_dir):
    store = PackageStore(tmp_path / "lib")
    store.ensure()
    store.seed_from_catalog(catalog_dir)
    result = pull_package(store, "vdplabs.demo-chat.standard.v1")
    assert result["status"] == "ready"
    assert result["runtime"] == "echo"


def test_pull_mlx_uses_snapshot(tmp_path, catalog_dir, monkeypatch):
    store = PackageStore(tmp_path / "lib")
    store.ensure()
    store.seed_from_catalog(catalog_dir)
    pkg_id = "vdplabs.qwen25-0.5b.compact.v1"
    hf_hub = tmp_path / "hf_hub"
    monkeypatch.setenv("HF_HUB_CACHE", str(hf_hub))

    def fake_download(**kwargs):
        assert "local_dir" not in kwargs  # one copy: shared HF cache only
        repo = kwargs["repo_id"]
        snap = hf_hub / f"models--{repo.replace('/', '--')}" / "snapshots" / "abc"
        snap.mkdir(parents=True, exist_ok=True)
        (snap / "config.json").write_text("{}", encoding="utf-8")
        (snap / "model.safetensors").write_bytes(b"fake")
        return str(snap)

    with patch("huggingface_hub.snapshot_download", side_effect=fake_download):
        result = pull_package(store, pkg_id)
    assert result["status"] == "ready"
    assert result["weights_path"].endswith("/snapshots/abc")
    assert store.weights_ready(store.load_manifest(pkg_id))
    # Must not have duplicated into packages/<id>/weights
    assert not store.weights_dir(pkg_id).exists()


def test_pull_unknown_raises(tmp_path):
    store = PackageStore(tmp_path / "lib")
    store.ensure()
    with pytest.raises(PullError, match="not found"):
        pull_package(store, "does.not.exist")
