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
  "version": "0.5.3",
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

- Omits echo / demo packages (`runtime.primary` contains `echo`, `family` contains `demo`, or `listable: false`)
- One preferred id per package (first alias, else package id)
- Includes unpulled listable packs (`weights_ready: false`)
- Each row includes `role` and `modalities`

Query flags:

| Flag | Effect |
| --- | --- |
| `demos=1` | Include demo / echo packages (chat, image, music, embed, STT scaffolds) |
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

### `POST /v1/audio/transcriptions`

OpenAI-compatible speech-to-text endpoint (`multipart/form-data`) powered by **`mlx-whisper`** on Apple Silicon (or `echo_stt` offline demo).

| Field | Type | Description |
| --- | --- | --- |
| `file` | File | Binary audio file upload (`.wav`, `.mp3`, `.m4a`, `.ogg`, etc.) |
| `model` | String | Model ID or alias (e.g. `whisper-1`, `whisper-tiny`, `transcribe-compact`) |
| `language` | String? | Optional BCP-47 / ISO language code (e.g. `en`, `es`, `fr`) |
| `prompt` | String? | Optional guidance prompt for vocabulary or context |
| `response_format` | String | Output format: `json` (default), `verbose_json`, `text`, `vtt`, `srt` |
| `temperature` | Float? | Sampling temperature |
| `timestamp_granularities[]` | List? | E.g. `["word"]` (with `verbose_json`) for word-level timestamps |

#### Example (curl)

```bash
curl http://127.0.0.1:18787/v1/audio/transcriptions \
  -F "file=@meeting.wav" \
  -F "model=whisper-1" \
  -F "response_format=verbose_json"
```

#### Response (`json`)

```json
{
  "text": "Welcome to Pantry, local model host on Apple Silicon."
}
```

#### Response (`verbose_json`)

```json
{
  "task": "transcribe",
  "language": "english",
  "duration": 3.42,
  "text": "Welcome to Pantry, local model host on Apple Silicon.",
  "segments": [
    {
      "id": 0,
      "seek": 0,
      "start": 0.0,
      "end": 3.42,
      "text": "Welcome to Pantry, local model host on Apple Silicon.",
      "tokens": [50364, 1234, 50464],
      "temperature": 0.0,
      "avg_logprob": -0.18,
      "compression_ratio": 1.15,
      "no_speech_prob": 0.005,
      "words": [
        { "word": "Welcome", "start": 0.0, "end": 0.4 },
        { "word": "to", "start": 0.4, "end": 0.6 },
        { "word": "Pantry", "start": 0.6, "end": 1.1 }
      ]
    }
  ]
}
```

### `POST /v1/images/generations`

OpenAI Images-style endpoint for `image_gen` packages. Powered by **`mflux`** (FLUX.1-schnell / FLUX.1-dev / SD-Turbo) with Metal acceleration and 8-bit/4-bit quantization, or **`echo_image`** placeholder.

| Field | Notes |
| --- | --- |
| `model` | e.g. `flux-schnell`, `image-standard`, `image-compact` |
| `prompt` | Required text prompt |
| `n` | 1–4 |
| `size` | e.g. `512x512`, `1024x1024` |
| `response_format` | `b64_json` (default) or `url` (file URI) |
| `priority` | `interactive` \| `batch` |

Response:

```json
{
  "created": 1788540000,
  "model": "flux-schnell",
  "package_id": "vdplabs.flux1-schnell.standard.v1",
  "data": [
    {
      "b64_json": "…",
      "path": "/…/VDPPantry/artifacts/vdplabs.flux1-schnell.standard.v1/mflux-512x512-….png",
      "revised_prompt": "A serene mountain landscape at sunset"
    }
  ]
}
```

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

Demo pack uses **`echo_music`** (deterministic sine WAV).

## CLI

| Command | Purpose |
| --- | --- |
| `pantry init` | Ensure library dirs; seed bundled catalog |
| `pantry pull <id>` | Fetch weights |
| `pantry resolve --modality chat --ram-gb-max 8 --quality compact` | Capability resolve |
| `pantry list` | Installed packages (`need-pull` / `ready`) |
| `pantry load` / `unload` | Prefer running daemon (`POST /v1/load`, `/v1/unload`); else local `state.json` only |
| `pantry serve [--host] [--port] [--worker-isolation]` | HTTP server + menu bar (`--worker-isolation` so unload reclaims that worker's Metal allocations) |
| `pantry service install` / `start` / `stop` / `status` | Manage macOS login LaunchAgent daemon |
| `pantry catalog update` / `list` | Sync remote catalog manifests from registry / GitHub |
| `pantry transcribe <file>` | Local speech-to-text audio transcription via Whisper |
| `pantry image "<prompt>"` | Generate image on Apple Silicon Metal via mflux |
| `pantry status` | JSON library snapshot + Metal memory |
| `pantry health [--host] [--port]` | Hit `/v1/health` |

Common options: `--home` / `PANTRY_HOME` (metadata), `--data` / `PANTRY_DATA` or `PANTRY_BLOBS` (blobs + weights).
