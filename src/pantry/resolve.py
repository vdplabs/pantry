from __future__ import annotations

from collections.abc import Callable
from typing import Any

from pantry.hardware import (
    estimate_generation_tps,
    estimate_speculative_speedup,
    get_apple_silicon_device_info,
)
from pantry.memory import calculate_usable_context, get_available_unified_dram
from pantry.schemas import (
    CapabilityRequest,
    LatencyClass,
    PackageManifest,
    QualityTier,
    ResolveResult,
)
from pantry.task_benchmarks import normalize_task_intent, score_package

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
    if key in {"video", "video_gen"}:
        return "video"
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
    """Dynamically arbitrate model capability execution based on intent and hardware telemetry (Patent Claim 1 & FIG. 2)."""
    modality_key = _normalize_modality(request.modality)
    fallback_applied: list[str] = []

    # Step 204: Interrogate System Telemetry Engine
    available_dram_bytes = get_available_unified_dram()
    available_dram_gb = available_dram_bytes / (1024.0 * 1024.0 * 1024.0)
    dynamic_ceiling_gb = (
        min(request.ram_gb_max, available_dram_gb)
        if request.ram_gb_max is not None
        else available_dram_gb
    )

    # Step 206: Filter Model Manifest by Modality Constraint
    candidates = [p for p in packages if _matches_modality(p, modality_key)]
    if not candidates:
        raise ResolveError("no packages match modality")

    # Filter by explicit template/tool constraints
    if request.template_family:
        tf = request.template_family.lower()
        candidates = [p for p in candidates if p.template_family.lower() == tf]
        if not candidates:
            raise ResolveError(
                f"no package with template_family={request.template_family} "
                "(host will not swap templates silently)"
            )

    if request.pin_family:
        pin = request.pin_family.lower()
        candidates = [p for p in candidates if p.family.lower() == pin]
        if not candidates:
            raise ResolveError(f"no package in pin_family={request.pin_family}")

    if request.tool_protocol:
        tp = request.tool_protocol.lower()
        candidates = [p for p in candidates if (p.tool_protocol or "").lower() == tp]
        if not candidates:
            raise ResolveError(f"no package with tool_protocol={request.tool_protocol}")

    if request.license_allow:
        allow = {x.lower() for x in request.license_allow}
        candidates = [p for p in candidates if p.license.lower() in allow]
        if not candidates:
            raise ResolveError("no package matches license_allow")

    if request.context_min is not None:
        fit = [p for p in candidates if p.context_max >= request.context_min]
        if not fit:
            raise ResolveError("no package meets context_min")
        candidates = fit

    # Quality Tier Filtering & Fallback
    if request.quality_tier is not None:
        tiered = [p for p in candidates if p.quality_tier == request.quality_tier]
        if not tiered:
            if request.quality_tier == QualityTier.extreme or not request.allow_fallback:
                raise ResolveError(
                    f"no package with quality_tier={request.quality_tier.value}"
                )
            fallback_applied.append(f"downgraded_tier_from_{request.quality_tier.value}")
        else:
            candidates = tiered

    if request.family_prefer:
        prefer = request.family_prefer.lower()
        preferred = [p for p in candidates if p.family.lower() == prefer or prefer in p.family.lower()]
        if preferred:
            candidates = preferred

    # Evaluate memory fit against dynamic ceiling (Step 214)
    fit = [p for p in candidates if p.ram_gb_min <= dynamic_ceiling_gb]
    if not fit:
        if request.allow_fallback:
            # Fallback: step down to smaller package across modality that fits
            broader = [p for p in packages if _matches_modality(p, modality_key) and p.ram_gb_min <= dynamic_ceiling_gb]
            if request.family_prefer:
                prefer = request.family_prefer.lower()
                fam_broader = [p for p in broader if p.family.lower() == prefer or prefer in p.family.lower()]
                if fam_broader:
                    broader = fam_broader
            if broader:
                candidates = broader
                fallback_applied.append("downgraded_tier_for_ram")
            else:
                effective_limit = request.ram_gb_max if request.ram_gb_max is not None else round(dynamic_ceiling_gb, 1)
                raise ResolveError(
                    f"no package fits ram_gb_max={effective_limit} "
                    f"(candidates need min {[p.ram_gb_min for p in candidates]})"
                )
        else:
            effective_limit = request.ram_gb_max if request.ram_gb_max is not None else round(dynamic_ceiling_gb, 1)
            raise ResolveError(
                f"no package fits ram_gb_max={effective_limit} "
                f"(candidates need min {[p.ram_gb_min for p in candidates]})"
            )
    else:
        candidates = fit

    # Multi-dimensional sorting: Real runtimes > Ready > Listable > Task Intent Score > Comfort RAM > Eval Score
    device_info = get_apple_silicon_device_info()
    chip_name = device_info.get("device_name")
    task_intent = normalize_task_intent(request.task_intent) if request.task_intent else None

    def sort_key(p: PackageManifest) -> tuple:
        ready = True if is_ready is None else bool(is_ready(p))
        score = p.eval.score if p.eval.score is not None else 0.0
        task_score = 0.0
        if task_intent:
            approx_b = _approx_package_bytes(p)
            tps = estimate_generation_tps(approx_b, chip_name)
            task_score = score_package(
                p,
                task_intent,
                estimated_tps=tps,
                available_bytes=int(dynamic_ceiling_gb * (1024**3)),
                requested_context=request.context_min or 4096,
            )
        return (
            0 if not _is_echo(p) else 1,
            0 if ready else 1,
            0 if p.listable else 1,
            -task_score if task_intent else 0,
            p.ram_gb_comfortable,
            -score,
            p.id,
        )

    candidates.sort(key=sort_key)
    chosen = candidates[0]

    # Step 208-216: Speculative Candidate Pair Feasibility Check and Fallback Resolution
    want_spec = bool(request.prefer_speculative or request.latency_class == LatencyClass.fast)
    draft_pkg = None
    if want_spec and chosen.runtime.draft_package_id:
        draft_pkg = next((p for p in packages if p.id == chosen.runtime.draft_package_id), None)

    speculative = False
    draft_package_id = None
    if draft_pkg is not None:
        composite_ram = chosen.ram_gb_min + draft_pkg.ram_gb_min
        # Step 214: Footprint <= min(RAM_budget, Available_DRAM)
        if composite_ram <= dynamic_ceiling_gb:
            speculative = True
            draft_package_id = draft_pkg.id
        elif request.allow_fallback:
            # Step 216: Disable Speculative Decoding to run target standalone
            speculative = False
            draft_package_id = None
            fallback_applied.append("disabled_speculative")
        else:
            raise ResolveError(
                f"speculative pair requires {composite_ram} GB, exceeding limit {dynamic_ceiling_gb} GB"
            )

    # Compute usable context window and roofline speed
    approx = _approx_package_bytes(chosen)
    footprint_bytes = approx
    if speculative and draft_pkg:
        footprint_bytes += _approx_package_bytes(draft_pkg)

    ceiling_bytes = int(dynamic_ceiling_gb * (1024**3))
    usable_context = calculate_usable_context(
        ceiling_bytes,
        footprint_bytes,
        chosen.params_b,
        chosen.context_max or 32768,
    )
    if usable_context < (chosen.context_max or 32768) and (request.context_min or 0) <= usable_context:
        fallback_applied.append("capped_context")

    estimated_tps = estimate_generation_tps(approx, chip_name)

    # Step 218: Output Resolved Execution Plan
    plan: dict = {
        "runtime": chosen.runtime.primary,
        "speculative": speculative,
        "weights_ready": True if is_ready is None else bool(is_ready(chosen)),
        "quant_scheme": chosen.quant_method or "mlx_4bit",
        "context_window": usable_context,
        "estimated_tps": estimated_tps,
        "footprint_bytes": footprint_bytes,
        "dynamic_ceiling_bytes": ceiling_bytes,
        "fallback_applied": fallback_applied,
    }
    if speculative and draft_package_id:
        plan["draft_package_id"] = draft_package_id
        if draft_pkg:
            spec_speedup = estimate_speculative_speedup(approx, _approx_package_bytes(draft_pkg), chip_name)
            plan["speculative_speedup"] = spec_speedup.get("speedup", 1.0)

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
    elif modality_key == "video":
        if chosen.quality_tier == QualityTier.standard:
            alias = "video-standard"
        elif chosen.quality_tier == QualityTier.compact:
            alias = "video-compact"
        elif chosen.quality_tier == QualityTier.extreme:
            alias = "video-extreme"

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
        "video-compact": (QualityTier.compact, "video"),
        "video-standard": (QualityTier.standard, "video"),
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
        # Video scaffold is compact-only until real weights ship.
        # video-standard soft-falls back to compact rather than failing closed.
        if not tiered and modality_key == "video" and tier == QualityTier.standard:
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
