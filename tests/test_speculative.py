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
