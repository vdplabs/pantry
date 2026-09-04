# Architecture

pantry is a user-installed **CLI + localhost daemon**. Apps do not embed the model library; they call the host.

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│ App A    │  │ App B    │  │ CLI/curl │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │  OpenAI-compatible HTTP (localhost)
     └─────────────┼─────────────┘
                   ▼
         ┌─────────────────┐
         │  pantry serve   │
         │  resolve · pull │
         │  complete/stream│
         └────────┬────────┘
    ┌─────────────┼──────────────┐
    ▼             ▼              ▼
 Package       Runtime        Scheduler
 store (CAS)   (echo / MLX)   (interactive vs batch)
```

## Components

| Component | Role |
| --- | --- |
| **Package store** | Manifests under `PANTRY_HOME`; content-addressed blobs + HF weight trees under `PANTRY_DATA` (defaults to same path) |
| **Resolve** | Capability request → package id (respects template/tool constraints) |
| **Runtime hub** | Picks `echo` or `mlx` (and later other engines) per package |
| **Template layer** | Host applies chat templates and strips stop tokens |
| **HTTP server** | OpenAI-compatible chat/images/audio plus `/v1/resolve`, `/v1/memory` |
| **CLI** | `init`, `pull`, `resolve`, `list`, `serve` (+ menu bar), `status` |
| **Memory watchdog** | Soft Metal cache/memory caps; heap stats on health/status/menu bar |

## Process model

- **Install**: Homebrew (`brew tap vdplabs/tap && brew install pantry`), or `pip` / `uv`.
- **Daemon**: `pantry serve` binds `127.0.0.1` by default (port `18787`).
- **Library root**: metadata in `~/Library/Application Support/VDPPantry/` (`PANTRY_HOME`); heavy blobs/weights in `PANTRY_DATA` / `PANTRY_BLOBS` when set (else same as home).
- **IPC**: localhost HTTP first. Unix domain sockets or native IPC can come later; they are optimizations, not the adoption path.

## Resolve and semantics

If a client uses **capability resolve** (or soft aliases like `chat-compact`), the host **must**:

1. Select a package that matches modality, RAM, tier, and optional `template_family` / `tool_protocol`.
2. Apply that package’s chat template itself.
3. Strip model-specific stop / special tokens before the client sees output.

Pinned package ids may still be used for power users. The host will **not** silently swap template families.

Preference order when several packages match: weights ready → non-demo/real runtime → lower comfortable RAM → higher eval score.

## Runtimes

| Runtime | When |
| --- | --- |
| `echo` | Deterministic chat demo / tests (hidden from `/v1/models` by default) |
| `echo_embed` | Deterministic vector embedding scaffold for `/v1/embeddings` |
| `echo_image` | Deterministic PNG scaffold for `/v1/images/generations` |
| `echo_music` | Deterministic WAV scaffold for `/v1/audio/generations` |
| `mlx` | Apple Silicon chat & embeddings via `mlx-lm` after `pantry pull` |

Planner hooks exist for speculative draft packages and future adapters; chat inference supports exact token usage telemetry, OpenAI-compatible tool/function calling, and optional worker process isolation for complete Metal memory reclaim.

## Process model & Worker Isolation

- **Install**: Homebrew (`brew tap vdplabs/tap && brew install pantry`), or `pip` / `uv`.
- **Daemon**: `pantry serve` binds `127.0.0.1` by default (port `18787`). Managed at login via `pantry service install`.
- **Worker Isolation**: Pass `--worker-isolation` to isolate MLX graph evaluation inside a child worker process. Calling `pantry unload` terminates the worker process, guaranteeing 100% of GPU Metal driver allocations and OS unified memory pools are reclaimed immediately.

## Scheduling (MVP)

Completions take a process-wide asyncio lock (FIFO). A `priority=batch` flag exists for future work; today it does **not** preempt interactive requests.

## Security posture

- Bind to loopback by default.
- No arbitrary shell from packages.
- Optional auth / LAN bind / signed manifests are post-MVP.
