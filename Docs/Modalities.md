# Modalities

pantry packages declare one or more **modalities**. Resolve and HTTP routes are modality-aware: a chat pack never answers an image or music request.

## Supported today

| Modality key | Package `role` (typical) | HTTP | Runtime |
| --- | --- | --- | --- |
| `text` (resolve also accepts `chat`) | `chat` | `POST /v1/chat/completions` | `echo`, `mlx` |
| `embed` (also `embeddings`) | `embed` | `POST /v1/embeddings` | `echo_embed`, `mlx` |
| `image_gen` (also `image`) | `image_gen` | `POST /v1/images/generations` | `echo_image` (scaffold) |
| `music` (also `audio_gen` / `audio`) | `music` | `POST /v1/audio/generations` | `echo_music` (scaffold) |

## Planned (not implemented)

| Modality | Likely API | Notes |
| --- | --- | --- |
| `stt` | `/v1/audio/transcriptions` | Speech → text (Whisper) |
| Real `image_gen` / `music` engines | same routes | Z-Image / MAGNeT replacing echo_* |

## Resolve rules

1. Request `modality` is normalized (`chat` → `text`, `audio_gen` → `music`, `embeddings` → `embed`).
2. Only packages whose `modalities` list contains that key are candidates.
3. There is **no** fallback to `role: chat` for non-text requests.
4. Soft aliases are scoped: `chat-compact` → text; `embed-compact` → `embed`; `image-compact` → `image_gen`; `music-compact` → `music`.

```bash
pantry resolve --modality chat --quality compact
pantry resolve --modality embed --quality compact
pantry resolve --modality image_gen
pantry resolve --modality music
```

## Embeddings

```bash
curl -s http://127.0.0.1:18787/v1/embeddings \
  -H 'content-type: application/json' \
  -d '{"model":"embed-compact","input":"Hello unified memory"}'
```

## Image generations (scaffold)

```bash
curl -s http://127.0.0.1:18787/v1/images/generations \
  -H 'content-type: application/json' \
  -d '{"model":"image-compact","prompt":"a blue square","size":"64x64"}'
```

Demo pack `vdplabs.demo-image.compact.v1` (`image-compact`) uses **`echo_image`**: a deterministic PNG under `$PANTRY_HOME/artifacts/`.

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
