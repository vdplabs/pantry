from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path
from typing import Any

from pantry.hub import create_custom_pack
from pantry.schemas import PackageManifest
from pantry.store import PackageStore


class AdoptError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def inspect_model_source(path: Path) -> dict[str, Any]:
    """Inspect local file or directory and extract model metadata."""
    if not path.exists():
        raise AdoptError(f"Target path does not exist: {path}")

    target = path.resolve()
    info: dict[str, Any] = {
        "source_path": str(target),
        "is_dir": target.is_dir(),
        "format": "unknown",
        "primary": "mlx",
        "role": "chat",
        "modality": "text",
        "family": "custom",
        "title": target.name,
        "params_b": 7.0,
        "context_max": 32768,
        "quality_tier": "standard",
        "quant_method": "none",
        "bits_approx": 16.0,
        "ram_gb_min": 8.0,
        "ram_gb_comfortable": 12.0,
        "approx_bytes": 0,
    }

    # Single GGUF file
    if target.is_file() and target.suffix.lower() == ".gguf":
        info["format"] = "gguf"
        info["primary"] = "llama_cpp"
        info["quant_method"] = "gguf"
        size_gb = target.stat().st_size / (1024**3)
        info["approx_bytes"] = target.stat().st_size
        info["params_b"] = round(size_gb * 1.5, 1)
        info["ram_gb_min"] = round(max(2.0, size_gb * 1.2), 1)
        info["ram_gb_comfortable"] = round(max(4.0, size_gb * 1.5), 1)
        return info

    # Single safetensors checkpoint
    if target.is_file() and target.suffix.lower() == ".safetensors":
        info["format"] = "safetensors"
        info["primary"] = "mlx"
        size_gb = target.stat().st_size / (1024**3)
        info["approx_bytes"] = target.stat().st_size
        info["ram_gb_min"] = round(max(4.0, size_gb * 1.2), 1)
        info["ram_gb_comfortable"] = round(max(6.0, size_gb * 1.5), 1)
        return info

    if not target.is_dir():
        raise AdoptError(f"Unsupported file format: {target.name}")

    # Inspect directory
    config_file = target / "config.json"
    model_index_file = target / "model_index.json"

    # Diffusion / image / video pipelines
    if model_index_file.is_file():
        try:
            with open(model_index_file, "r", encoding="utf-8") as f:
                idx = json.load(f)
            cls_name = str(idx.get("_class_name", ""))
            if "Flux" in cls_name:
                info["format"] = "flux"
                info["primary"] = "mflux"
                info["role"] = "image"
                info["modality"] = "image"
                info["family"] = "flux"
                info["params_b"] = 12.0
            elif "LTX" in cls_name or (target / "transformer").is_dir():
                info["format"] = "ltx-video"
                info["primary"] = "ltx_video"
                info["role"] = "video"
                info["modality"] = "video"
                info["family"] = "ltx-video"
                info["params_b"] = 2.0
        except Exception:  # noqa: BLE001, S110
            pass

    if config_file.is_file():
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            arch = cfg.get("architectures", [""])[0] if cfg.get("architectures") else ""
            model_type = cfg.get("model_type", "")
            info["format"] = "safetensors_tree"
            info["architecture"] = arch or model_type

            # Detect whisper / audio
            if "whisper" in model_type.lower() or "whisper" in arch.lower():
                info["role"] = "transcribe"
                info["modality"] = "audio"
                info["primary"] = "mlx_whisper"
                info["family"] = "whisper"
            # Detect vision / VLM
            elif "qwen2_vl" in model_type.lower() or "vision" in arch.lower() or "vlm" in arch.lower():
                info["role"] = "vision"
                info["modality"] = "vision"
                info["primary"] = "mlx_vlm"
            # Detect cross-encoder / rerank
            elif "rerank" in model_type.lower() or "cross-encoder" in arch.lower() or "forsequenceclassification" in arch.lower():
                info["role"] = "rerank"
                info["modality"] = "rerank"
                info["primary"] = "mlx"
            # Detect embeddings
            elif "embedding" in model_type.lower() or "bert" in model_type.lower():
                info["role"] = "embed"
                info["modality"] = "embed"
                info["primary"] = "mlx"
            else:
                info["role"] = "chat"
                info["modality"] = "text"
                info["primary"] = "mlx"

            # Parse parameter count / context length
            if "max_position_embeddings" in cfg:
                info["context_max"] = int(cfg["max_position_embeddings"])
            elif "seq_length" in cfg:
                info["context_max"] = int(cfg["seq_length"])

            # Check quantization in config
            quant = cfg.get("quantization", {})
            if quant and isinstance(quant, dict):
                bits = quant.get("bits", 4)
                info["quant_method"] = f"mlx_{bits}bit"
                info["bits_approx"] = float(bits)
        except Exception:  # noqa: BLE001, S110
            pass

    # Calculate directory size
    total_bytes = 0
    for p in target.rglob("*"):
        if p.is_file():
            try:
                total_bytes += p.stat().st_size
            except Exception:  # noqa: BLE001, S110
                pass
    info["approx_bytes"] = total_bytes
    size_gb = total_bytes / (1024**3)
    info["ram_gb_min"] = round(max(2.0, size_gb * 1.15), 1)
    info["ram_gb_comfortable"] = round(max(4.0, size_gb * 1.4), 1)

    return info


def adopt_local_model(
    store: PackageStore,
    source_path: Path | str,
    package_id: str | None = None,
    alias: str | None = None,
    title: str | None = None,
    role: str | None = None,
) -> tuple[PackageManifest, dict[str, Any]]:
    """Adopt existing weights on disk into Pantry with zero secondary disk copies."""
    path = Path(source_path).expanduser().resolve()
    info = inspect_model_source(path)

    # Determine package_id
    if not package_id:
        clean_name = re.sub(r"[^a-z0-9\.\-]", "-", path.name.lower()).strip("-")
        package_id = f"local.{clean_name}.v1"

    target_weights_dir = store.weights_dir(package_id)
    target_weights_dir.parent.mkdir(parents=True, exist_ok=True)

    # Create symlink from store weights directory to source path (zero copy)
    if target_weights_dir.is_symlink() or target_weights_dir.exists():
        if target_weights_dir.is_symlink():
            target_weights_dir.unlink()
        elif target_weights_dir.is_dir():
            shutil.rmtree(target_weights_dir)
        else:
            target_weights_dir.unlink()

    os.symlink(path, target_weights_dir)

    aliases = []
    if alias:
        aliases.append(alias)

    pack_data: dict[str, Any] = {
        "id": package_id,
        "title": title or info.get("title") or package_id,
        "family": info.get("family", "custom"),
        "role": role or info.get("role", "chat"),
        "modality": info.get("modality", "text"),
        "params_b": info.get("params_b", 7.0),
        "context_max": info.get("context_max", 32768),
        "quant_method": info.get("quant_method", "none"),
        "bits_approx": info.get("bits_approx", 16.0),
        "ram_gb_min": info.get("ram_gb_min", 4.0),
        "ram_gb_comfortable": info.get("ram_gb_comfortable", 6.0),
        "aliases": aliases,
        "runtime": {
            "primary": info.get("primary", "mlx"),
            "local_path": str(path),
        },
    }

    manifest = create_custom_pack(store, pack_data)

    # Index into CAS metadata without physical block duplication
    recipe = None
    try:
        recipe = store.ingest_package_into_cas(manifest.id, target_weights_dir, store_chunks=False)
    except Exception:  # noqa: BLE001, S110
        pass

    stats = {
        "package_id": manifest.id,
        "source_path": str(path),
        "weights_path": str(target_weights_dir),
        "bytes_on_disk": info.get("approx_bytes", 0),
        "bytes_duplicated": 0,
        "recipe_present": recipe is not None,
    }
    return manifest, stats
