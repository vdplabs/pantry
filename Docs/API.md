# API

Default base URL: `http://127.0.0.1:18787`.

## HTTP

### `GET /`

Service name, version, and path hints (`chat`, `images`, `resolve`, …).

### `GET /v1/health`

```json
{
  "ok": true,
  "name": "pantry",
  "version": "0.4.0",
  "packages": 7,
  "loaded": [],
  "home": "/Users/…/VDPPantry",
  "data": "/Users/…/VDPPantry",
  "memory": {
    "pressure": "ok",
    "active_bytes": 0,
    "active_human": "0 B",
    "peak_bytes": 0,
    "cache_bytes": 0,
    "metal_available": true,
    "message": "Metal heap 0 B active / …",
    "limits": { "applied": true, "cache_limit_bytes": 0 }
  }
}
```

See [Memory.md](Memory.md) for the watchdog and `GET /v1/memory` / `POST /v1/memory/clear`.

### `GET /v1/models`

OpenAI-style list. By default:

- Omits demo chat echo packages (`runtime.primary == echo` or `listable: false`)
- Includes listable generative demos (e.g. `image-compact`)
- One preferred id per package (first alias, else package id)
- Includes unpulled listable packs (`weights_ready: false`)
- Each row includes `role` and `modalities`

Query flags:

| Flag | Effect |
| --- | --- |
| `demos=1` | Include demo / echo chat packages |
| `ready_only=1` | Only packages with weights on disk |
| `all_ids=1` | Also emit raw package ids when they differ from the preferred alias |

### `POST /v1/resolve`

Capability → package.

```json
{
  "modality": "chat",
  "ram_gb_max": 8,
  "quality_tier": "compact",
  "latency_class": "balanced",
  "family_prefer": null,
  "template_family": null,
  "tool_protocol": null,
  "prefer_speculative": false,
  "pin_family": null
}
```

`modality` values: `chat` / `text`, `image_gen`, … (see [Modalities.md](Modalities.md)). Matching is **strict** — chat packs are never returned for `image_gen`.

Response includes `package_id`, optional `alias`, `reason`, and a `plan` (`runtime`, speculative flags).

Errors: `404` when no package matches (including template/tool mismatches).

### `POST /v1/pull`

```json
{ "package_id": "vdplabs.qwen25-0.5b.compact.v1" }
```

Downloads weights when needed. Returns status, paths, and byte counts.

### `POST /v1/load` / `POST /v1/unload`

```json
{ "package_id": "vdplabs.qwen25-0.5b.compact.v1", "pin": false }
```

`load` updates warm markers (weights still load on first chat). `unload` clears markers **and** drops in-process MLX runtimes. CLI `pantry load` / `pantry unload` call these when `serve` is up.

### `POST /v1/chat/completions`

OpenAI Chat Completions subset. Rejects non-text packages (`400`).

| Field | Notes |
| --- | --- |
| `model` | Package id, alias, or soft alias (`chat-compact`) |
| `messages` | `content` may be `string`, `null`, or OpenAI text-part arrays |
| `stream` | `true` → SSE (`text/event-stream`) |
| `max_tokens` / `max_completion_tokens` | Default 256; hard-capped at 4096 |
| `temperature` | Optional |
| `prefer_speculative` | Use curated draft model when declared + pulled |
| `priority` | `interactive` (default) or `batch` (FIFO today; no preemption yet) |
| `tools` | Optional array of OpenAI-compatible function definitions |
| `tool_choice` | Optional (`auto`, `none`, or function object) |

Non-stream and stream responses include exact token `usage` (`prompt_tokens`, `completion_tokens`, `total_tokens`) computed via the tokenizer. When `tools` are passed, the host formats tool schemas into the prompt and parses `<tool_call>` outputs into standard OpenAI `tool_calls` structures with `finish_reason="tool_calls"`.

If weights are missing for an MLX package: `409` with a pull hint.

Streaming emits live SSE deltas from the runtime.

### `POST /v1/embeddings`

OpenAI-style vector embeddings endpoint for `embed` packages.

| Field | Notes |
| --- | --- |
| `model` | e.g. `embed-compact`, `embed-standard`, or package id |
| `input` | Single `string` or `list[string]` |
| `encoding_format` | `float` (default) |
| `priority` | `interactive` \| `batch` |

Response:

```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [-0.0123, 0.0456, "..."]
    }
  ],
  "model": "embed-compact",
  "usage": {
    "prompt_tokens": 8,
    "total_tokens": 8
  }
}
```

### `POST /v1/images/generations`

OpenAI Images-style subset for `image_gen` packages.

| Field | Notes |
| --- | --- |
| `model` | e.g. `image-compact` |
| `prompt` | Required text prompt |
| `n` | 1–4 |
| `size` | e.g. `256x256` (echo clamps to 16–1024) |
| `response_format` | `b64_json` (default) or `url` (file URI) |
| `priority` | `interactive` \| `batch` |

Response:

```json
{
  "created": 0,
  "model": "image-compact",
  "package_id": "vdplabs.demo-image.compact.v1",
  "data": [
    {
      "b64_json": "…",
      "path": "/…/VDPPantry/artifacts/…/echo-….png",
      "revised_prompt": "[pantry echo_image · …] …"
    }
  ]
}
```

Today’s catalog pack uses the **`echo_image`** runtime (placeholder PNG). Real Diffusers / Z-Image engines are follow-on work.

### `POST /v1/audio/generations`

Music / audio generation for `music` packages.

| Field | Notes |
| --- | --- |
| `model` | e.g. `music-compact` |
| `prompt` | Required text prompt |
| `duration_seconds` | Default 2; echo clamps to 0.25–8 |
| `response_format` | `b64_json` (default) or `url` |
| `priority` | `interactive` \| `batch` |

Response `data[]` entries include `b64_json` / `url`, `path`, `format: "wav"`, `sample_rate`, `duration_seconds`.

Demo pack uses **`echo_music`** (deterministic sine WAV). Real MAGNeT is follow-on.

## CLI

| Command | Purpose |
| --- | --- |
| `pantry init` | Ensure library dirs; seed bundled catalog |
| `pantry pull <id>` | Fetch weights |
| `pantry resolve --modality chat --ram-gb-max 8 --quality compact` | Capability resolve |
| `pantry list` | Installed packages (`need-pull` / `ready`) |
| `pantry load` / `unload` | Prefer running daemon (`POST /v1/load`, `/v1/unload`); else local `state.json` only |
| `pantry serve [--host] [--port] [--worker-isolation]` | HTTP server + menu bar (`--worker-isolation` for 100% Metal reclaim) |
| `pantry service install` / `start` / `stop` / `status` | Manage macOS login LaunchAgent daemon |
| `pantry catalog update` / `list` | Sync remote catalog manifests from registry / GitHub |
| `pantry status` | JSON library snapshot + Metal memory |
| `pantry health [--host] [--port]` | Hit `/v1/health` |

Common options: `--home` / `PANTRY_HOME` (metadata), `--data` / `PANTRY_DATA` or `PANTRY_BLOBS` (blobs + weights).
