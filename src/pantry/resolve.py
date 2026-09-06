from __future__ import annotations

from collections.abc import Callable

from pantry.schemas import (
    CapabilityRequest,
    LatencyClass,
    PackageManifest,
    QualityTier,
    ResolveResult,
)

ReadyFn = Callable[[PackageManifest], bool]


class ResolveError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def _normalize_modality(modality: str) -> str:
    key = modality.strip().lower()
    if key in {"chat", "text"}:
        return "text"
    if key in {"music", "audio_gen"}:
        return "music"
    if key in {"stt", "transcribe", "transcription", "speech_to_text", "audio_transcription", "audio"}:
        return "stt"
    if key in {"image_gen", "image"}:
        return "image_gen"
    if key in {"embed", "embeddings", "embedding"}:
        return "embed"
    return key


def _package_modalities(p: PackageManifest) -> set[str]:
    mods = {m.strip().lower() for m in p.modalities if m and m.strip()}
    # Legacy chat packs sometimes only set role.
    if not mods and (p.role or "").lower() in {"chat", "text"}:
        mods.add("text")
    return mods


def _matches_modality(p: PackageManifest, modality_key: str) -> bool:
    """Strict: package must advertise the requested modality (no chat fallback)."""
    return modality_key in _package_modalities(p)


def _is_echo(p: PackageManifest) -> bool:
    primary = (p.runtime.primary or "echo").lower()
    return primary == "echo" or primary.startswith("echo_")


def resolve(
    request: CapabilityRequest,
    packages: list[PackageManifest],
    *,
    is_ready: ReadyFn | None = None,
    store: Any = None,
) -> ResolveResult:
    """Pick a package without crossing incompatible template/tool contracts."""
    modality_key = _normalize_modality(request.modality)

    candidates = [p for p in packages if _matches_modality(p, modality_key)]
    if not candidates:
        raise ResolveError("no packages match modality")

    if request.quality_tier is not None:
        tiered = [p for p in candidates if p.quality_tier == request.quality_tier]
        if not tiered:
            raise ResolveError(
                f"no package with quality_tier={request.quality_tier.value}"
            )
        candidates = tiered

    if request.ram_gb_max is not None:
        fit = [p for p in candidates if p.ram_gb_min <= request.ram_gb_max]
        if not fit:
            raise ResolveError(
                f"no package fits ram_gb_max={request.ram_gb_max} "
                f"(candidates need min {[p.ram_gb_min for p in candidates]})"
            )
        candidates = fit

    if request.context_min is not None:
        fit = [p for p in candidates if p.context_max >= request.context_min]
        if not fit:
            raise ResolveError("no package meets context_min")
        candidates = fit

    if request.family_prefer:
        prefer = request.family_prefer.lower()
        preferred = [p for p in candidates if p.family.lower() == prefer]
        if preferred:
            candidates = preferred

    if request.pin_family:
        pin = request.pin_family.lower()
        candidates = [p for p in candidates if p.family.lower() == pin]
        if not candidates:
            raise ResolveError(f"no package in pin_family={request.pin_family}")

    if request.template_family:
        tf = request.template_family.lower()
        candidates = [p for p in candidates if p.template_family.lower() == tf]
        if not candidates:
            raise ResolveError(
                f"no package with template_family={request.template_family} "
                "(host will not swap templates silently)"
            )

    if request.tool_protocol:
        tp = request.tool_protocol.lower()
        candidates = [
            p
            for p in candidates
            if (p.tool_protocol or "").lower() == tp
        ]
        if not candidates:
            raise ResolveError(
                f"no package with tool_protocol={request.tool_protocol}"
            )

    if request.license_allow:
        allow = {x.lower() for x in request.license_allow}
        candidates = [p for p in candidates if p.license.lower() in allow]
        if not candidates:
            raise ResolveError("no package matches license_allow")

    # Prefer: real runtimes over echo → ready weights → listable → lower RAM → score.
    # Echo demos must not win on a clean install just because weights_ready is always true.
    def sort_key(p: PackageManifest) -> tuple:
        ready = True if is_ready is None else bool(is_ready(p))
        score = p.eval.score if p.eval.score is not None else 0.0
        return (
            0 if not _is_echo(p) else 1,
            0 if ready else 1,
            0 if p.listable else 1,
            p.ram_gb_comfortable,
            -score,
            p.id,
        )

    candidates.sort(key=sort_key)
    chosen = candidates[0]

    plan: dict = {
        "runtime": chosen.runtime.primary,
        "speculative": False,
        "weights_ready": True if is_ready is None else bool(is_ready(chosen)),
    }
    if (
        request.prefer_speculative or request.latency_class == LatencyClass.fast
    ) and chosen.runtime.draft_package_id:
        plan["speculative"] = True
        plan["draft_package_id"] = chosen.runtime.draft_package_id

    alias = None
    if chosen.aliases:
        alias = chosen.aliases[0]
    elif modality_key == "text":
        if chosen.quality_tier == QualityTier.standard:
            alias = "chat-standard"
        elif chosen.quality_tier == QualityTier.compact:
            alias = "chat-compact"
        elif chosen.quality_tier == QualityTier.extreme:
            alias = "chat-extreme"
    elif modality_key == "embed":
        if chosen.quality_tier == QualityTier.standard:
            alias = "embed-standard"
        elif chosen.quality_tier == QualityTier.compact:
            alias = "embed-compact"
        elif chosen.quality_tier == QualityTier.extreme:
            alias = "embed-extreme"

    approx = _approx_package_bytes(chosen)
    apparent_bytes = approx
    is_ready_bool = bool(plan.get("weights_ready", False))
    download_bytes = 0 if is_ready_bool else approx
    shared_bytes = approx if is_ready_bool else 0

    if store is not None:
        try:
            recipe = store.load_recipe(chosen.id)
            if recipe is not None:
                apparent_bytes = recipe.total_uncompressed_bytes
                if is_ready_bool:
                    download_bytes = 0
                    shared_bytes = apparent_bytes
                else:
                    needed = sum(
                        ch.length
                        for f in recipe.files
                        for ch in f.chunks
                        if not store.cas.has_chunk(ch.sha256)
                    )
                    download_bytes = needed
                    shared_bytes = max(0, apparent_bytes - download_bytes)
        except Exception:
            pass

    return ResolveResult(
        package_id=chosen.id,
        alias=alias,
        reason=(
            f"matched modality={modality_key} tier={chosen.quality_tier.value} "
            f"family={chosen.family} runtime={chosen.runtime.primary}"
        ),
        weights_ready=is_ready_bool,
        ram_gb_min=float(chosen.ram_gb_min),
        approx_bytes=approx,
        apparent_size_bytes=apparent_bytes,
        download_size_bytes=download_bytes,
        shared_existing_bytes=shared_bytes,
        plan=plan,
    )


def _approx_package_bytes(pkg: PackageManifest) -> int:
    blob_sum = sum(b.size_bytes for b in pkg.blobs if b.size_bytes)
    if blob_sum > 0:
        return blob_sum
    if pkg.params_b and pkg.bits_approx:
        return int(pkg.params_b * 1_000_000_000 * (pkg.bits_approx / 8.0))
    return 0


def find_by_model_string(
    model: str,
    packages: list[PackageManifest],
    *,
    is_ready: ReadyFn | None = None,
) -> PackageManifest | None:
    key = model.strip()
    for p in packages:
        if p.id == key or key in p.aliases:
            return p

    soft = {
        "chat-standard": (QualityTier.standard, "text"),
        "chat-compact": (QualityTier.compact, "text"),
        "chat-extreme": (QualityTier.extreme, "text"),
        "chat-fast": (QualityTier.standard, "text"),
        "image-compact": (QualityTier.compact, "image_gen"),
        "image-standard": (QualityTier.standard, "image_gen"),
        "music-compact": (QualityTier.compact, "music"),
        "music-standard": (QualityTier.standard, "music"),
        "embed-compact": (QualityTier.compact, "embed"),
        "embed-standard": (QualityTier.standard, "embed"),
        "whisper-1": (QualityTier.compact, "stt"),
        "whisper-compact": (QualityTier.compact, "stt"),
        "whisper-standard": (QualityTier.standard, "stt"),
        "transcribe-compact": (QualityTier.compact, "stt"),
        "transcribe-standard": (QualityTier.standard, "stt"),
    }
    if key in soft:
        tier, modality_key = soft[key]
        tiered = [
            p
            for p in packages
            if p.quality_tier == tier and _matches_modality(p, modality_key)
        ]
        # Honest music scaffold is compact-only until a real engine ships.
        # music-standard soft-falls back to compact rather than failing closed.
        if not tiered and modality_key == "music" and tier == QualityTier.standard:
            tiered = [
                p
                for p in packages
                if p.quality_tier == QualityTier.compact
                and _matches_modality(p, modality_key)
            ]
        if not tiered:
            return None

        def sort_key(p: PackageManifest) -> tuple:
            ready = True if is_ready is None else bool(is_ready(p))
            return (
                0 if not _is_echo(p) else 1,
                0 if ready else 1,
                0 if p.listable else 1,
                p.ram_gb_comfortable,
                p.id,
            )

        return min(tiered, key=sort_key)
    return None
