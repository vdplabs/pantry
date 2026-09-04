# Packages

A **package** is an immutable manifest plus optional on-disk weights. Catalog manifests ship with pantry; `pantry pull` fetches weights into the local library.

## Library layout

```
$PANTRY_HOME/                      # metadata (small) — default Application Support
  state.json                       # loaded / pinned package ids
  packages/
    <package_id>/
      manifest.json

$PANTRY_DATA/                      # heavy content — defaults to same path as HOME
  blobs/                           # content-addressed raw blobs (sha256)
  packages/
    <package_id>/
      weights/                     # HF / MLX tree after pull
  artifacts/                       # generated demos (image/music scaffolds)
```

Defaults: both unset → `~/Library/Application Support/VDPPantry/` (single directory).

**External SSD:** set `PANTRY_DATA` (alias `PANTRY_BLOBS`) or `pantry serve --data /Volumes/Models/VDPPantry` so multi‑GB weights leave the internal drive while manifests stay local. See README [Configuration](../README.md#configuration).

## Manifest (fields)

Conceptual example:

```json
{
  "id": "vdplabs.qwen25-0.5b.compact.v1",
  "family": "qwen2.5",
  "role": "chat",
  "params_b": 0.5,
  "quality_tier": "compact",
  "quant_method": "mlx_4bit",
  "bits_approx": 4.0,
  "ram_gb_min": 1,
  "ram_gb_comfortable": 2,
  "modalities": ["text"],
  "context_max": 32768,
  "license": "apache-2.0",
  "chat_template_id": "qwen2.5-instruct-v1",
  "template_family": "chatml",
  "tool_protocol": null,
  "aliases": ["chat-compact"],
  "listable": true,
  "runtime": {
    "primary": "mlx",
    "hf_repo": "mlx-community/Qwen2.5-0.5B-Instruct-4bit",
    "draft_package_id": null
  },
  "eval": {
    "suite_id": "vdplabs-chat-smoke-2026.09",
    "score": 0.55,
    "notes": "Starter pack; prefer larger packs for quality."
  },
  "system_preamble": "You are a helpful assistant running locally via pantry."
}
```

| Field | Notes |
| --- | --- |
| `id` | Stable package id (`publisher.family.tier.version`) |
| `role` | Coarse job: `chat`, `image_gen`, … |
| `modalities` | Resolve keys: `text`, `image_gen`, … (see [Modalities.md](Modalities.md)) |
| `quality_tier` | `standard` \| `compact` \| `extreme` |
| `template_family` | Chat packs: `chatml` / `llama3`; generative packs may use `none` |
| `aliases` | Soft names; first alias is the preferred `/v1/models` id |
| `listable` | If `false`, hidden from `/v1/models` unless `?demos=1` |
| `runtime.primary` | `echo` \| `echo_image` \| `mlx` \| … |
| `runtime.hf_repo` | Hugging Face repo for `pantry pull` (omit for echo*) |
| `eval` | Optional measured notes; required before advertising extreme packs |

## Quality tiers

| Tier | Intent |
| --- | --- |
| `standard` | Default quality balance |
| `compact` | Smaller / faster; slight quality tradeoff |
| `extreme` | Max fit / speed; expect quality loss; ship with eval notes |

## Pull

```bash
pantry pull <package_id>
```

1. Install / refresh the catalog manifest into `packages/<id>/manifest.json`.
2. If `runtime.hf_repo` is set, `huggingface_hub.snapshot_download` into `packages/<id>/weights/`.
3. Mark ready when `config.json` and at least one weight shard are present.

Echo packages need no download.

## Bundled catalog

Seeded by `pantry init` from the `catalog/` directory:

| Package ID | Modality | Role | Tier | RAM (Comfortable) | Primary Runtime | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `vdplabs.qwen25-0.5b.compact.v1` | `text` | `chat` | `compact` | 2 GB | `mlx` | Starter chat / draft model |
| `vdplabs.qwen25-1.5b.standard.v1` | `text` | `chat` | `standard` | 4 GB | `mlx` | Standard chat + speculative target |
| `vdplabs.llama32-1b.compact.v1` | `text` | `chat` | `compact` | 3 GB | `mlx` | Llama 3.2 1B Instruct (Llama3 template) |
| `vdplabs.llama32-3b.standard.v1` | `text` | `chat` | `standard` | 5 GB | `mlx` | Llama 3.2 3B Instruct + 1B speculative pair |
| `vdplabs.qwen25-coder-1.5b.compact.v1` | `text` | `code` | `compact` | 4 GB | `mlx` | Code specialization |
| `vdplabs.deepseek-r1-distill-qwen-1.5b.compact.v1` | `text` | `reasoning` | `compact` | 4 GB | `mlx` | Distilled reasoning model |
| `vdplabs.demo-embed.compact.v1` | `embed` | `embed` | `compact` | 0.5 GB | `echo_embed` | Deterministic embeddings scaffold |
| `vdplabs.demo-image.compact.v1` | `image_gen` | `image_gen` | `compact` | 0.5 GB | `echo_image` | Image generation scaffold |
| `vdplabs.demo-music.compact.v1` | `music` | `music` | `compact` | 0.5 GB | `echo_music` | Music generation scaffold |

## Remote catalog sync

To update or discover new manifests from the remote registry:

```bash
pantry catalog update
pantry catalog list
```
