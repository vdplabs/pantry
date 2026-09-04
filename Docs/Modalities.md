# Modalities

pantry packages declare one or more **modalities**. Resolve and HTTP routes are modality-aware: a chat pack never answers an image or music request.

## Supported today

| Modality key | Package `role` (typical) | HTTP | Runtime |
| --- | --- | --- | --- |
| `text` (resolve also accepts `chat`) | `chat` | `POST /v1/chat/completions` | `echo`, `mlx` |
| `embed` (also `embeddings`) | `embed` | `POST /v1/embeddings` | `echo_embed`, `mlx` |
| `stt` (also `transcribe`) | `transcribe` | `POST /v1/audio/transcriptions` | `echo_stt`, `mlx_whisper` |
| `image_gen` (also `image`) | `image_gen` | `POST /v1/images/generations` | `echo_image`, `mflux` |
| `music` (also `audio_gen`) | `music` | `POST /v1/audio/generations` | `echo_music` (scaffold) |

## Planned (not implemented)

| Modality | Likely API | Notes |
| --- | --- | --- |
| Real `music` engines | `/v1/audio/generations` | MAGNeT replacing echo_music |

## Resolve rules

1. Request `modality` is normalized (`chat` → `text`, `stt` / `transcribe` → `stt`, `embeddings` → `embed`).
2. Only packages whose `modalities` list contains that key are candidates.
3. There is **no** fallback to `role: chat` for non-text requests.
4. Soft aliases are scoped: `chat-compact` → text; `embed-compact` → `embed`; `whisper-1` / `whisper-compact` → `stt`; `image-standard` / `image-compact` → `image_gen`; `music-compact` → `music`.

```bash
pantry resolve --modality chat --quality compact
pantry resolve --modality embed --quality compact
pantry resolve --modality stt --quality compact
pantry resolve --modality image_gen
pantry resolve --modality music
```

## Speech-to-Text (Whisper)

```bash
curl -s http://127.0.0.1:18787/v1/audio/transcriptions \
  -F "file=@memo.wav" \
  -F "model=whisper-1" \
  -F "response_format=verbose_json"
```

## Embeddings

```bash
curl -s http://127.0.0.1:18787/v1/embeddings \
  -H 'content-type: application/json' \
  -d '{"model":"embed-compact","input":"Hello unified memory"}'
```

## Image generations

```bash
curl -s http://127.0.0.1:18787/v1/images/generations \
  -H 'content-type: application/json' \
  -d '{"model":"flux-schnell","prompt":"a blue square on metal","size":"512x512"}'
```

Pantry supports **`mflux`** for Metal GPU image generation:
- **`image-standard`** → `filipstrand/Z-Image-Turbo-mflux-4bit` (pre-quantized ~6 GB; fits 16 GB Apple Silicon). Do **not** on-the-fly quantize bf16/fp16 trees — that spikes unified memory and trips Metal’s GPU timeout watchdog.
- **`flux-schnell`** → FLUX.1-schnell (8-bit; needs ≥24 GB)
- **`echo_image`** → deterministic offline smoke tests (`image-compact`)


## Music generations (scaffold)

```bash
curl -s http://127.0.0.1:18787/v1/audio/generations \
  -H 'content-type: application/json' \
  -d '{"model":"music-compact","prompt":"lofi chill","duration_seconds":1}'
```

Demo pack `vdplabs.demo-music.compact.v1` (`music-compact`) uses **`echo_music`**: a short sine WAV (prompt → frequency) under `$PANTRY_HOME/artifacts/`.

## Package conventions

```json
{
  "modalities": ["music"],
  "role": "music",
  "template_family": "none",
  "runtime": { "primary": "echo_music" }
}
```

Chat packs keep `modalities: ["text"]` and a real `template_family` (`chatml`, `llama3`, …).

See [Packages.md](Packages.md) for full manifest fields and [API.md](API.md) for endpoints.
