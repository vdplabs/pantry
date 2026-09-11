from __future__ import annotations

import logging
import os
import re
import shutil
from pathlib import Path
from typing import Any

from pantry.hardware import get_apple_silicon_device_info
from pantry.schemas import PackageManifest, QualityTier, RuntimeInfo
from pantry.store import PackageStore

logger = logging.getLogger(__name__)

# Curated high-performance models optimized for Apple Silicon MLX and diffusers
CURATED_MODELS: list[dict[str, Any]] = [
    {
        "repo_id": "mlx-community/DeepSeek-R1-Distill-Qwen-7B-4bit",
        "title": "DeepSeek R1 7B",
        "description": "Distilled reasoning model based on Qwen 2.5 7B. Outstanding chain-of-thought performance.",
        "modality": "text",
        "role": "reasoning",
        "family": "deepseek-r1",
        "architecture": "Qwen2ForCausalLM",
        "quant_method": "mlx_4bit",
        "quant_label": "4-bit (mlx)",
        "params_b": 7.6,
        "context_max": 32768,
        "license": "mit",
        "chat_template_id": "deepseek-r1-distill-qwen",
        "template_family": "chatml",
        "aliases": ["reasoning", "reasoning-standard", "r1-7b"],
        "quality_tier": "standard",
        "approx_bytes": 4295831322,  # ~4.3 GB
    },
    {
        "repo_id": "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
        "title": "Qwen2.5 Coder 7B",
        "description": "State-of-the-art coding and agentic reasoning model in 7B parameter footprint.",
        "modality": "text",
        "role": "coder",
        "family": "qwen2.5-coder",
        "architecture": "Qwen2ForCausalLM",
        "quant_method": "mlx_4bit",
        "quant_label": "4-bit (mlx)",
        "params_b": 7.6,
        "context_max": 32768,
        "license": "apache-2.0",
        "chat_template_id": "qwen2.5-coder-instruct-v1",
        "template_family": "chatml",
        "aliases": ["coder", "coder-standard"],
        "quality_tier": "standard",
        "approx_bytes": 4450000000,  # ~4.45 GB
    },
    {
        "repo_id": "mlx-community/Qwen2.5-7B-Instruct-4bit",
        "title": "Qwen2.5 7B Instruct",
        "description": "Powerful general-purpose instruction-tuned model with 32k context and robust multilingual capabilities.",
        "modality": "text",
        "role": "chat",
        "family": "qwen2.5",
        "architecture": "Qwen2ForCausalLM",
        "quant_method": "mlx_4bit",
        "quant_label": "4-bit (mlx)",
        "params_b": 7.6,
        "context_max": 32768,
        "license": "apache-2.0",
        "chat_template_id": "qwen2.5-instruct-v1",
        "template_family": "chatml",
        "aliases": ["chat-standard", "qwen-7b"],
        "quality_tier": "standard",
        "approx_bytes": 4450000000,  # ~4.45 GB
    },
    {
        "repo_id": "mlx-community/Meta-Llama-3.1-8B-Instruct-4bit",
        "title": "Llama 3.1 8B Instruct",
        "description": "Meta's flagship 8B instruction-tuned model with 128k context and extensive tool-calling support.",
        "modality": "text",
        "role": "chat",
        "family": "llama3.1",
        "architecture": "LlamaForCausalLM",
        "quant_method": "mlx_4bit",
        "quant_label": "4-bit (mlx)",
        "params_b": 8.0,
        "context_max": 131072,
        "license": "llama3.1",
        "chat_template_id": "llama-3-instruct",
        "template_family": "llama3",
        "aliases": ["chat-standard", "llama-8b"],
        "quality_tier": "standard",
        "approx_bytes": 4920000000,  # ~4.9 GB
    },
    {
        "repo_id": "mlx-community/Qwen2.5-1.5B-Instruct-4bit",
        "title": "Qwen2.5 1.5B Instruct",
        "description": "Lightweight, ultra-fast chat model with low memory footprint and high responsiveness.",
        "modality": "text",
        "role": "chat",
        "family": "qwen2.5",
        "architecture": "Qwen2ForCausalLM",
        "quant_method": "mlx_4bit",
        "quant_label": "4-bit (mlx)",
        "params_b": 1.5,
        "context_max": 32768,
        "license": "apache-2.0",
        "chat_template_id": "qwen2.5-instruct-v1",
        "template_family": "chatml",
        "aliases": ["chat-compact", "chat-fast"],
        "quality_tier": "compact",
        "approx_bytes": 980000000,  # ~0.98 GB
    },
    {
        "repo_id": "mlx-community/DeepSeek-R1-Distill-Qwen-1.5B-4bit",
        "title": "DeepSeek R1 1.5B",
        "description": "Compact distilled reasoning model. Fast chain-of-thought reasoning in under 1 GB RAM.",
        "modality": "text",
        "role": "reasoning",
        "family": "deepseek-r1",
        "architecture": "Qwen2ForCausalLM",
        "quant_method": "mlx_4bit",
        "quant_label": "4-bit (mlx)",
        "params_b": 1.5,
        "context_max": 32768,
        "license": "mit",
        "chat_template_id": "deepseek-r1-distill-qwen",
        "template_family": "chatml",
        "aliases": ["reasoning-compact", "r1-1.5b"],
        "quality_tier": "compact",
        "approx_bytes": 980000000,  # ~0.98 GB
    },
    {
        "repo_id": "mlx-community/Qwen2.5-Coder-1.5B-Instruct-4bit",
        "title": "Qwen2.5 Coder 1.5B",
        "description": "Fast code generation and completion assistant in compact footprint.",
        "modality": "text",
        "role": "coder",
        "family": "qwen2.5-coder",
        "architecture": "Qwen2ForCausalLM",
        "quant_method": "mlx_4bit",
        "quant_label": "4-bit (mlx)",
        "params_b": 1.5,
        "context_max": 32768,
        "license": "apache-2.0",
        "chat_template_id": "qwen2.5-coder-instruct-v1",
        "template_family": "chatml",
        "aliases": ["coder-compact"],
        "quality_tier": "compact",
        "approx_bytes": 980000000,  # ~0.98 GB
    },
    {
        "repo_id": "mlx-community/Llama-3.2-3B-Instruct-4bit",
        "title": "Llama 3.2 3B Instruct",
        "description": "Compact multilingual model from Meta with balanced quality and 2 GB memory usage.",
        "modality": "text",
        "role": "chat",
        "family": "llama3.2",
        "architecture": "LlamaForCausalLM",
        "quant_method": "mlx_4bit",
        "quant_label": "4-bit (mlx)",
        "params_b": 3.2,
        "context_max": 131072,
        "license": "llama3.2",
        "chat_template_id": "llama-3-instruct",
        "template_family": "llama3",
        "aliases": ["chat-compact"],
        "quality_tier": "compact",
        "approx_bytes": 2040000000,  # ~2.04 GB
    },
    {
        "repo_id": "mlx-community/DeepSeek-R1-Distill-Qwen-14B-4bit",
        "title": "DeepSeek R1 14B",
        "description": "Deep reasoning model with near-frontier analytical capabilities on 16GB+ Macs.",
        "modality": "text",
        "role": "reasoning",
        "family": "deepseek-r1",
        "architecture": "Qwen2ForCausalLM",
        "quant_method": "mlx_4bit",
        "quant_label": "4-bit (mlx)",
        "params_b": 14.7,
        "context_max": 32768,
        "license": "mit",
        "chat_template_id": "deepseek-r1-distill-qwen",
        "template_family": "chatml",
        "aliases": ["reasoning-extreme", "r1-14b"],
        "quality_tier": "extreme",
        "approx_bytes": 8800000000,  # ~8.8 GB
    },
    {
        "repo_id": "mlx-community/Qwen2.5-Coder-14B-Instruct-4bit",
        "title": "Qwen2.5 Coder 14B",
        "description": "Frontier-tier coding model capable of complex refactors and repository-level architecture.",
        "modality": "text",
        "role": "coder",
        "family": "qwen2.5-coder",
        "architecture": "Qwen2ForCausalLM",
        "quant_method": "mlx_4bit",
        "quant_label": "4-bit (mlx)",
        "params_b": 14.7,
        "context_max": 32768,
        "license": "apache-2.0",
        "chat_template_id": "qwen2.5-coder-instruct-v1",
        "template_family": "chatml",
        "aliases": ["coder-extreme"],
        "quality_tier": "extreme",
        "approx_bytes": 8800000000,  # ~8.8 GB
    },
    {
        "repo_id": "black-forest-labs/FLUX.1-schnell",
        "title": "FLUX.1 Schnell",
        "description": "12B parameter 4-step rectified flow transformer model for ultra-high fidelity text-to-image.",
        "modality": "image_gen",
        "role": "image",
        "family": "flux",
        "architecture": "FluxTransformer2DModel",
        "quant_method": "bfloat16",
        "quant_label": "bf16 / 4-step",
        "params_b": 12.0,
        "context_max": 512,
        "license": "apache-2.0",
        "chat_template_id": "",
        "template_family": "",
        "aliases": ["image-standard", "flux"],
        "quality_tier": "standard",
        "approx_bytes": 12200000000,  # ~12.2 GB
    },
    {
        "repo_id": "Lightricks/LTX-Video",
        "title": "LTX-Video 0.9.1",
        "description": "High resolution text-to-video diffusion transformer generating 24fps video clips.",
        "modality": "video",
        "role": "video",
        "family": "ltx-video",
        "architecture": "LTXVideoTransformer3D",
        "quant_method": "fp16",
        "quant_label": "fp16 (quantizable)",
        "params_b": 2.0,
        "context_max": 256,
        "license": "open-rail-m",
        "chat_template_id": "",
        "template_family": "",
        "aliases": ["video-standard", "ltx"],
        "quality_tier": "standard",
        "approx_bytes": 8200000000,  # ~8.2 GB
    },
    {
        "repo_id": "mlx-community/whisper-large-v3-turbo",
        "title": "Whisper Large v3 Turbo",
        "description": "High accuracy multilingual speech-to-text transcription running efficiently on MLX.",
        "modality": "stt",
        "role": "audio",
        "family": "whisper",
        "architecture": "WhisperForConditionalGeneration",
        "quant_method": "fp16",
        "quant_label": "fp16 (mlx)",
        "params_b": 0.8,
        "context_max": 448,
        "license": "mit",
        "chat_template_id": "",
        "template_family": "",
        "aliases": ["transcribe-standard", "whisper-turbo"],
        "quality_tier": "standard",
        "approx_bytes": 1640000000,  # ~1.64 GB
    },
    {
        "repo_id": "mlx-community/whisper-tiny",
        "title": "Whisper Tiny",
        "description": "Ultra-lightweight speech-to-text transcription engine. Instant startup and minimal RAM.",
        "modality": "stt",
        "role": "audio",
        "family": "whisper",
        "architecture": "WhisperForConditionalGeneration",
        "quant_method": "fp16",
        "quant_label": "fp16 (mlx)",
        "params_b": 0.04,
        "context_max": 448,
        "license": "mit",
        "chat_template_id": "",
        "template_family": "",
        "aliases": ["transcribe-compact", "whisper-tiny"],
        "quality_tier": "compact",
        "approx_bytes": 150000000,  # ~0.15 GB
    },
]


STANDARD_INTENTS: list[dict[str, Any]] = [
    {
        "alias": "chat-standard",
        "title": "Standard Chat",
        "description": "Daily general-purpose conversational assistant",
        "modality": "text",
        "default_package_id": "vdplabs.qwen25-1.5b.standard.v1",
    },
    {
        "alias": "chat-compact",
        "title": "Compact Chat",
        "description": "Ultra-lightweight conversational model for low RAM",
        "modality": "text",
        "default_package_id": "vdplabs.qwen25-0.5b.compact.v1",
    },
    {
        "alias": "coder",
        "title": "Coding Assistant",
        "description": "Code generation, completion, refactoring, and review",
        "modality": "text",
        "default_package_id": "vdplabs.qwen25-coder-1.5b.compact.v1",
    },
    {
        "alias": "reasoning",
        "title": "Deep Reasoning",
        "description": "Chain-of-thought analysis and complex problem solving",
        "modality": "text",
        "default_package_id": "vdplabs.deepseek-r1-distill-qwen-1.5b.compact.v1",
    },
    {
        "alias": "image",
        "title": "Image Generation",
        "description": "High fidelity text-to-image synthesis",
        "modality": "image_gen",
        "default_package_id": "vdplabs.z-image-turbo.standard.v1",
    },
    {
        "alias": "video",
        "title": "Video Generation",
        "description": "Text-to-video generative synthesis",
        "modality": "video",
        "default_package_id": "vdplabs.ltx-video-q4.compact.v1",
    },
    {
        "alias": "transcribe",
        "title": "Speech-to-Text",
        "description": "Multilingual audio transcription and subtitling",
        "modality": "stt",
        "default_package_id": "vdplabs.whisper-tiny.compact.v1",
    },
]


def _dir_size(path: Path) -> int:
    if not path.is_dir():
        return 0
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            p = Path(root) / f
            try:
                total += p.stat().st_size
            except OSError:
                pass
    return total


def get_package_disk_size(store: PackageStore, manifest: PackageManifest) -> int:
    """Calculate the actual bytes on disk for a package if weights are present."""
    if not store.weights_ready(manifest):
        return 0
    weights_path = store.resolve_weights_path(manifest)
    if weights_path and weights_path.exists():
        return _dir_size(weights_path)
    return 0


def evaluate_hardware_fit(
    estimated_bytes: int,
    device_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Evaluate how well a model fits into the host's unpaged memory working set budget.

    Patent FIG. 2, Step 204/214:
    - Working set budget = Metal recommendedMaxWorkingSetSize (or 75% total DRAM)
    - macOS baseline DRAM overhead = ~3.0 GB
    - Model working set = weight bytes * 1.15 (weights + initial activation / KV headroom)
    - Fit ratio = (baseline_os_bytes + model_working_set_bytes) / working_set_budget
    """
    if device_info is None:
        device_info = get_apple_silicon_device_info()

    total_mem_b = int(device_info.get("memory_size_bytes") or 16 * 1024**3)
    rec_ws_b = int(
        device_info.get("recommended_working_set_bytes") or int(total_mem_b * 0.75)
    )
    if rec_ws_b <= 0:
        rec_ws_b = int(total_mem_b * 0.75)

    device_name = str(device_info.get("device_name") or "Host Machine")
    total_ram_gb = round(total_mem_b / (1024**3), 1)
    working_set_gb = round(rec_ws_b / (1024**3), 1)

    macos_baseline_gb = 3.0
    macos_baseline_b = int(macos_baseline_gb * 1024**3)

    model_gb = round(estimated_bytes / (1024**3), 2)
    # Weights plus 15% activation / KV cache buffer
    model_working_b = int(estimated_bytes * 1.15)
    total_working_b = macos_baseline_b + model_working_b
    total_working_gb = round(total_working_b / (1024**3), 1)

    ratio = total_working_b / float(rec_ws_b) if rec_ws_b > 0 else 1.0

    if ratio <= 0.65:
        fit_status = "runs_great"
        fit_label = "Runs Great"
        fit_color = "#10b981"  # Emerald green
        badge = f"Best Fit for Your {device_name}"
        compatible = True
        message = f"Compatible with Sink on this {device_name}."
    elif ratio <= 0.85:
        fit_status = "good_fit"
        fit_label = "Good Fit"
        fit_color = "#3b82f6"  # Blue
        badge = f"Runs smoothly on {device_name}"
        compatible = True
        message = f"Comfortable working set headroom on {device_name}."
    elif ratio <= 1.00:
        fit_status = "tight_fit"
        fit_label = "Tight Fit"
        fit_color = "#f59e0b"  # Amber
        badge = "Fits within budget (Tight)"
        compatible = True
        message = "Tight memory headroom. May throttle other heavy applications."
    else:
        fit_status = "requires_more_ram"
        fit_label = "Requires More RAM"
        fit_color = "#ef4444"  # Red
        badge = f"Exceeds {working_set_gb} GB budget"
        compatible = False
        message = f"Requires ~{round(total_working_gb, 1)} GB working set, exceeding {working_set_gb} GB budget."

    return {
        "fit_status": fit_status,
        "fit_label": fit_label,
        "fit_color": fit_color,
        "fit_badge": badge,
        "compatible": compatible,
        "message": message,
        "ratio": round(ratio, 3),
        "model_bytes": estimated_bytes,
        "model_gb": model_gb,
        "macos_baseline_gb": macos_baseline_gb,
        "total_working_gb": total_working_gb,
        "working_set_gb": working_set_gb,
        "total_ram_gb": total_ram_gb,
        "device_name": device_name,
    }


def search_hub(
    query: str = "",
    modality: str = "all",
    limit: int = 20,
    source: str = "all",
    device_info: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Search Hugging Face Hub for MLX and compatible open-weights models, annotated with hardware fit."""
    if device_info is None:
        device_info = get_apple_silicon_device_info()

    q_clean = query.strip()
    norm_mod = modality.strip().lower()

    results: list[dict[str, Any]] = []

    # 1. Curated Models (if source is "all" or "curated")
    if source in ("all", "curated"):
        for m in CURATED_MODELS:
            m_mod = m.get("modality", "text")
            if norm_mod != "all":
                if norm_mod in {"chat", "reasoning", "coder"} and m.get("role") != norm_mod:
                    continue
                if norm_mod in {"image", "image_gen"} and m_mod not in {"image", "image_gen"}:
                    continue
                if norm_mod in {"video", "video_gen"} and m_mod not in {"video", "video_gen"}:
                    continue
                if norm_mod in {"audio", "stt"} and m_mod not in {"stt", "audio"}:
                    continue

            if q_clean:
                q_lower = q_clean.lower()
                text_haystack = f"{m['title']} {m['repo_id']} {m['family']} {m.get('description', '')}".lower()
                if q_lower not in text_haystack:
                    continue

            fit = evaluate_hardware_fit(m["approx_bytes"], device_info)
            results.append({
                **m,
                "source": "curated",
                "fit": fit,
            })

    # 2. Live Hugging Face Hub Query (if source is "all" or "hf")
    # For source == "hf", if query is empty we default to "mlx" to discover trending Apple Silicon models
    if source in ("all", "hf") and (q_clean or source == "hf"):
        try:
            from huggingface_hub import HfApi

            api = HfApi()
            search_str = q_clean if q_clean else "mlx"

            # list_models accepts search, sort, limit. (direction argument is invalid)
            fetch_limit = min(50, limit * 2) if norm_mod != "all" else limit
            hf_candidates = list(api.list_models(search=search_str, limit=fetch_limit, sort="downloads"))
            existing_repos = {r["repo_id"].lower() for r in results}

            for model_card in hf_candidates:
                repo_id = model_card.id
                if repo_id.lower() in existing_repos:
                    continue

                tags = [t.lower() for t in (getattr(model_card, "tags", None) or [])]
                pipeline_tag = getattr(model_card, "pipeline_tag", None) or ""
                is_mlx = "mlx" in tags or "mlx" in repo_id.lower()
                is_diffusers = "diffusers" in tags or "diffusers" in repo_id.lower() or "image-generation" in tags

                inferred_mod = "text"
                inferred_role = "chat"

                if pipeline_tag in {"automatic-speech-recognition", "audio-to-audio", "audio-classification"} or any("audio" in t or "speech" in t for t in tags):
                    inferred_mod = "stt"
                    inferred_role = "audio"
                elif pipeline_tag in {"text-to-video", "image-to-video"} or any("video" in t for t in tags):
                    inferred_mod = "video"
                    inferred_role = "video"
                elif pipeline_tag in {"text-to-image", "image-to-image"} or is_diffusers or any("image" in t for t in tags):
                    inferred_mod = "image_gen"
                    inferred_role = "image"
                elif "reasoning" in repo_id.lower() or "r1" in repo_id.lower() or "deepseek-r1" in tags:
                    inferred_role = "reasoning"
                elif "coder" in repo_id.lower() or "code" in repo_id.lower():
                    inferred_role = "coder"

                if norm_mod != "all":
                    if norm_mod in {"chat", "reasoning", "coder"}:
                        if norm_mod == "chat" and inferred_mod != "text":
                            continue
                        if norm_mod in {"reasoning", "coder"} and inferred_role != norm_mod:
                            continue
                    elif (
                        (norm_mod in {"image", "image_gen"} and inferred_mod not in {"image", "image_gen"})
                        or (norm_mod in {"video", "video_gen"} and inferred_mod not in {"video", "video_gen"})
                        or (norm_mod in {"audio", "stt"} and inferred_mod not in {"stt", "audio"})
                    ):
                        continue

                approx_bytes = 4_000_000_000
                params_b = 7.0
                quant_label = "4-bit" if ("4bit" in repo_id.lower() or "4-bit" in tags) else "8-bit" if ("8bit" in repo_id.lower() or "8-bit" in tags) else "fp16"

                pmatch = re.search(r"(\d+(?:\.\d+)?)[bB]", repo_id)
                if pmatch:
                    try:
                        params_b = float(pmatch.group(1))
                        multiplier = 0.55 if "4bit" in repo_id.lower() or "4-bit" in tags else 1.1 if "8bit" in repo_id.lower() else 2.1
                        approx_bytes = int(params_b * 1024**3 * multiplier)
                    except Exception:  # noqa: BLE001, S110
                        pass

                fit = evaluate_hardware_fit(approx_bytes, device_info)
                title = repo_id.split("/")[-1].replace("-", " ")

                downloads = getattr(model_card, "downloads", 0) or 0
                likes = getattr(model_card, "likes", 0) or 0
                dl_parts = []
                if downloads:
                    dl_parts.append(f"{downloads:,} downloads")
                if likes:
                    dl_parts.append(f"{likes:,} likes")
                meta_sub = " · ".join(dl_parts)
                desc = f"Hugging Face model {repo_id} ({meta_sub})" if meta_sub else f"Hugging Face repository {repo_id}"

                results.append({
                    "repo_id": repo_id,
                    "title": title,
                    "description": desc,
                    "modality": inferred_mod,
                    "role": inferred_role,
                    "family": repo_id.split("/")[-1].split("-")[0].lower(),
                    "architecture": "CausalLM" if inferred_mod == "text" else "DiffusionTransformer",
                    "quant_method": "mlx_4bit" if is_mlx and "4bit" in repo_id.lower() else "bfloat16",
                    "quant_label": quant_label,
                    "params_b": params_b,
                    "context_max": 32768 if inferred_mod == "text" else 512,
                    "license": "open-weights",
                    "chat_template_id": "chatml-v1",
                    "template_family": "chatml",
                    "aliases": [],
                    "quality_tier": "standard" if params_b >= 6.0 else "compact",
                    "approx_bytes": approx_bytes,
                    "downloads": downloads,
                    "likes": likes,
                    "source": "hub",
                    "fit": fit,
                })
        except Exception as exc:  # noqa: BLE001
            import logging
            logging.getLogger(__name__).warning("Failed to search Hugging Face Hub: %s", exc)

    return results[:limit]


def get_model_details(repo_id: str, device_info: dict[str, Any] | None = None) -> dict[str, Any]:
    """Fetch exact metadata, siblings file size, and architecture for a Hugging Face repo."""
    if device_info is None:
        device_info = get_apple_silicon_device_info()

    # Check curated cache first for fast response
    for m in CURATED_MODELS:
        if m["repo_id"].lower() == repo_id.lower():
            fit = evaluate_hardware_fit(m["approx_bytes"], device_info)
            return {
                **m,
                "fit": fit,
            }

    # Fetch from huggingface_hub
    from huggingface_hub import HfApi

    api = HfApi()
    info = api.model_info(repo_id, files_metadata=True)

    total_size = 0
    if info.siblings:
        total_size = sum(f.size for f in info.siblings if f.size and not f.rfilename.endswith((".md", ".txt", ".png", ".jpg")))
    if total_size <= 0:
        total_size = 4_000_000_000

    cfg = getattr(info, "config", {}) or {}
    arch = "Unknown"
    if isinstance(cfg, dict):
        arch_list = cfg.get("architectures", [])
        if arch_list:
            arch = arch_list[0]
        elif cfg.get("model_type"):
            arch = str(cfg.get("model_type")).capitalize()

    tags = [t.lower() for t in (info.tags or [])]
    is_mlx = "mlx" in tags or "mlx" in repo_id.lower()
    quant_label = "4-bit (mlx)" if is_mlx and "4bit" in repo_id.lower() else "4-bit" if "4bit" in repo_id.lower() or "4-bit" in tags else "fp16"
    quant_method = "mlx_4bit" if is_mlx and "4bit" in repo_id.lower() else "mlx_8bit" if "8bit" in repo_id.lower() else "bfloat16"

    context_max = 32768
    if isinstance(cfg, dict):
        context_max = int(cfg.get("max_position_embeddings") or cfg.get("seq_length") or 32768)

    license_str = "open-weights"
    if isinstance(cfg, dict) and cfg.get("license"):
        license_str = str(cfg.get("license"))
    elif info.card_data and getattr(info.card_data, "license", None):
        license_str = str(info.card_data.license)

    st_info = getattr(info, "safetensors", None)
    params_b = 7.0
    if st_info and getattr(st_info, "total", None):
        params_b = round(st_info.total / 1_000_000_000.0, 1)
    else:
        pmatch = re.search(r"(\d+(?:\.\d+)?)[bB]", repo_id)
        if pmatch:
            try:
                params_b = float(pmatch.group(1))
            except Exception:  # noqa: BLE001, S110
                pass

    template_family = "chatml"
    chat_template_id = "chatml-v1"
    if "deepseek" in repo_id.lower():
        template_family = "chatml"
        chat_template_id = "deepseek-r1-distill-qwen"
    elif "llama-3" in repo_id.lower() or "llama3" in repo_id.lower():
        template_family = "llama3"
        chat_template_id = "llama-3-instruct"
    elif "qwen" in repo_id.lower():
        template_family = "chatml"
        chat_template_id = "qwen2.5-instruct-v1"

    fit = evaluate_hardware_fit(total_size, device_info)
    title = repo_id.split("/")[-1].replace("-", " ")

    return {
        "repo_id": repo_id,
        "title": title,
        "description": f"Hugging Face repository {repo_id}",
        "modality": "text",
        "role": "chat",
        "family": repo_id.split("/")[-1].split("-")[0].lower(),
        "architecture": arch,
        "quant_method": quant_method,
        "quant_label": quant_label,
        "params_b": params_b,
        "context_max": context_max,
        "license": license_str,
        "chat_template_id": chat_template_id,
        "template_family": template_family,
        "aliases": [],
        "quality_tier": "standard" if params_b >= 5.0 else "compact",
        "approx_bytes": total_size,
        "fit": fit,
    }


def generate_manifest_template(
    repo_id: str,
    title: str | None = None,
    modality: str = "text",
    role: str = "chat",
    tier: str = "standard",
    aliases: list[str] | None = None,
    context_max: int = 32768,
    custom_package_id: str | None = None,
) -> PackageManifest:
    """Synthesize a complete PackageManifest valid for local registration or catalog submission."""
    clean_repo = repo_id.strip()
    slug = clean_repo.split("/")[-1].lower()
    clean_slug = re.sub(r"[^a-z0-9\.\-]", "-", slug).strip("-")

    if not custom_package_id:
        package_id = f"local.{clean_slug}.{tier}.v1"
    else:
        package_id = custom_package_id.strip()

    if not title:
        title = clean_repo.split("/")[-1].replace("-", " ")

    family = "custom"
    if "coder" in clean_slug and "qwen" in clean_slug:
        family = "qwen2.5-coder"
    elif "qwen" in clean_slug:
        family = "qwen2.5"
    elif "deepseek" in clean_slug:
        family = "deepseek-r1"
    elif "llama" in clean_slug:
        family = "llama3"
    elif "flux" in clean_slug:
        family = "flux"
    elif "ltx" in clean_slug:
        family = "ltx-video"
    elif "whisper" in clean_slug:
        family = "whisper"

    template_family = "chatml"
    chat_template_id = "chatml-v1"
    if "deepseek" in clean_slug:
        template_family = "chatml"
        chat_template_id = "deepseek-r1-distill-qwen"
    elif "llama" in clean_slug:
        template_family = "llama3"
        chat_template_id = "llama-3-instruct"
    elif "coder" in clean_slug:
        template_family = "chatml"
        chat_template_id = "qwen2.5-coder-instruct-v1"
    elif "qwen" in clean_slug:
        template_family = "chatml"
        chat_template_id = "qwen2.5-instruct-v1"

    mod_list = [modality]
    if modality == "chat":
        mod_list = ["text"]

    params_b = 7.0
    pmatch = re.search(r"(\d+(?:\.\d+)?)[bB]", clean_slug)
    if pmatch:
        try:
            params_b = float(pmatch.group(1))
        except Exception:  # noqa: BLE001, S110
            pass

    ram_min = max(1.0, round(params_b * 0.6, 1))
    ram_comf = max(2.0, round(ram_min * 1.5, 1))

    q_tier = QualityTier.standard
    if tier.lower() == "compact":
        q_tier = QualityTier.compact
    elif tier.lower() == "extreme":
        q_tier = QualityTier.extreme

    manifest = PackageManifest(
        id=package_id,
        title=title,
        family=family,
        role=role,
        params_b=params_b,
        quality_tier=q_tier,
        quant_method="mlx_4bit" if "4bit" in clean_slug else "bfloat16",
        bits_approx=4.0 if "4bit" in clean_slug else 16.0,
        ram_gb_min=ram_min,
        ram_gb_comfortable=ram_comf,
        modalities=mod_list,
        context_max=context_max,
        license="open-weights",
        chat_template_id=chat_template_id,
        template_family=template_family,
        aliases=aliases or [],
        runtime=RuntimeInfo(
            primary="mlx",
            hf_repo=clean_repo,
            hf_revision=None,
        ),
        system_preamble="You are a helpful assistant running locally via pantry.",
        listable=True,
    )
    return manifest


def get_intent_bindings(store: PackageStore) -> list[dict[str, Any]]:
    """Inspect all active intent packages, their download status, size on disk, and candidates."""
    from pantry.resolve import find_by_model_string

    manifests = store.list_manifests()
    # Map manifests by id
    manifest_map = {m.id: m for m in manifests}

    # Also make sure we have candidates by modality
    results: list[dict[str, Any]] = []

    for intent in STANDARD_INTENTS:
        alias = intent["alias"]
        modality = intent["modality"]

        # Step 1: Find currently bound package
        active_pkg = None
        # Check explicit alias match first
        for m in manifests:
            if alias in m.aliases:
                active_pkg = m
                break

        # Fallback to resolver
        if active_pkg is None:
            active_pkg = find_by_model_string(alias, manifests)

        # Fallback to default catalog package if not seeded yet
        if active_pkg is None and intent.get("default_package_id"):
            def_id = intent["default_package_id"]
            if def_id in manifest_map:
                active_pkg = manifest_map[def_id]
            else:
                try:
                    active_pkg = store.install_from_bundled_catalog(def_id)
                    if active_pkg:
                        manifests.append(active_pkg)
                        manifest_map[active_pkg.id] = active_pkg
                except Exception:  # noqa: BLE001, S110
                    pass

        # Check candidate packages matching modality
        candidates: list[dict[str, Any]] = []
        for m in manifests:
            # Check if modality matches
            m_mods = [x.lower() for x in m.modalities]
            norm_target_mod = "text" if modality in {"text", "chat"} else modality
            if norm_target_mod in m_mods or (norm_target_mod == "text" and (m.role or "").lower() in {"chat", "coder", "reasoning"}):
                is_ready = store.weights_ready(m)
                disk_b = get_package_disk_size(store, m)
                candidates.append({
                    "package_id": m.id,
                    "title": m.title or m.id,
                    "family": m.family,
                    "quality_tier": m.quality_tier.value,
                    "weights_ready": is_ready,
                    "bytes_on_disk": disk_b,
                    "hf_repo": m.runtime.hf_repo,
                })

        active_info = None
        if active_pkg is not None:
            is_ready = store.weights_ready(active_pkg)
            disk_b = get_package_disk_size(store, active_pkg)
            active_info = {
                "package_id": active_pkg.id,
                "title": active_pkg.title or active_pkg.id,
                "family": active_pkg.family,
                "quality_tier": active_pkg.quality_tier.value,
                "weights_ready": is_ready,
                "bytes_on_disk": disk_b,
                "hf_repo": active_pkg.runtime.hf_repo,
                "context_max": active_pkg.context_max,
                "aliases": list(active_pkg.aliases),
            }

        results.append({
            "alias": alias,
            "title": intent["title"],
            "description": intent["description"],
            "modality": modality,
            "default_package_id": intent.get("default_package_id"),
            "active_package": active_info,
            "candidates": candidates,
        })

    return results


def rebind_intent_alias(store: PackageStore, alias: str, target_package_id: str) -> PackageManifest:
    """Rebind an intent alias to target_package_id, removing it from any previous holder."""
    alias_clean = alias.strip()
    target_id_clean = target_package_id.strip()

    manifests = store.list_manifests()

    # Step 1: Remove alias from all current holders in store
    for m in manifests:
        if alias_clean in m.aliases and m.id != target_id_clean:
            m.aliases = [a for a in m.aliases if a != alias_clean]
            store.write_manifest(m)

    # Step 2: Ensure target package exists in store
    target = store.load_manifest(target_id_clean)
    if target is None:
        target = store.install_from_bundled_catalog(target_id_clean)
    if target is None:
        raise ValueError(f"Target package not found: {target_id_clean}")

    # Step 3: Add alias to target
    if alias_clean not in target.aliases:
        target.aliases.append(alias_clean)
    store.write_manifest(target)

    # Invalidate store cache
    store._manifests_cache = None
    return target


def create_custom_pack(
    store: PackageStore,
    package_data: dict[str, Any],
) -> PackageManifest:
    """Create a new local model package and write its manifest into store."""
    if "runtime" in package_data and isinstance(package_data["runtime"], dict):
        runtime_dict = package_data["runtime"]
    else:
        runtime_dict = {
            "primary": package_data.get("primary", "mlx"),
            "hf_repo": package_data.get("hf_repo"),
            "hf_revision": package_data.get("hf_revision"),
        }

    modality = package_data.get("modality", "text")
    mod_list = [modality] if isinstance(modality, str) else list(modality)
    if "chat" in mod_list:
        mod_list = ["text" if m == "chat" else m for m in mod_list]

    tier_val = str(package_data.get("quality_tier", "standard")).lower()
    q_tier = QualityTier.standard
    if tier_val == "compact":
        q_tier = QualityTier.compact
    elif tier_val == "extreme":
        q_tier = QualityTier.extreme

    pkg_id = package_data.get("id") or package_data.get("package_id")
    if not pkg_id:
        hf_repo = runtime_dict.get("hf_repo") or "custom-model"
        slug = hf_repo.split("/")[-1].lower()
        clean_slug = re.sub(r"[^a-z0-9\.\-]", "-", slug).strip("-")
        pkg_id = f"local.{clean_slug}.{tier_val}.v1"

    manifest = PackageManifest(
        id=pkg_id,
        title=package_data.get("title") or pkg_id,
        family=package_data.get("family", "custom"),
        role=package_data.get("role", "chat"),
        params_b=float(package_data.get("params_b", 7.0)),
        quality_tier=q_tier,
        quant_method=package_data.get("quant_method", "mlx_4bit"),
        bits_approx=float(package_data.get("bits_approx", 4.0)),
        ram_gb_min=float(package_data.get("ram_gb_min", 4.0)),
        ram_gb_comfortable=float(package_data.get("ram_gb_comfortable", 6.0)),
        modalities=mod_list,
        context_max=int(package_data.get("context_max", 32768)),
        license=package_data.get("license", "open-weights"),
        chat_template_id=package_data.get("chat_template_id", "chatml-v1"),
        template_family=package_data.get("template_family", "chatml"),
        aliases=list(package_data.get("aliases", [])),
        runtime=RuntimeInfo(**runtime_dict),
        system_preamble=package_data.get("system_preamble", "You are a helpful assistant running locally via pantry."),
        listable=True,
    )

    store.write_manifest(manifest)
    # Handle alias rebinding if requested (remove from previous packages)
    for alias in manifest.aliases:
        rebind_intent_alias(store, alias, manifest.id)

    store._manifests_cache = None
    return manifest


def delete_custom_pack(store: PackageStore, package_id: str) -> bool:
    """Delete a custom package from store."""
    pdir = store.package_dir(package_id)
    if pdir.exists() and pdir.is_dir():
        shutil.rmtree(pdir, ignore_errors=True)
    wdir = store.weights_dir(package_id)
    if wdir.exists() and wdir.is_dir():
        shutil.rmtree(wdir, ignore_errors=True)
    store._manifests_cache = None
    return True
