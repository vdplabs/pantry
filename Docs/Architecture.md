# Architecture

pantry is a user-installed **CLI + localhost daemon** providing local and cluster AI execution. Apps do not embed the model library; they call the host.

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│ App A    │  │ App B    │  │ CLI/curl │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │  OpenAI-compatible HTTP (localhost or LAN)
     └─────────────┼─────────────┘
                   ▼
         ┌─────────────────┐
         │  pantry serve   │
         │  resolve · pull │
         │  complete/stream│
         └────────┬────────┘
    ┌─────────────┼──────────────┬──────────────────┐
    ▼             ▼              ▼                  ▼
 Package       Runtime        Scheduler          Telemetry &
 store (CAS)   (MLX / CUDA)   (interactive/batch) Web Dashboard
```

## Components

| Component | Role |
| --- | --- |
| **Package store** | Manifests under `PANTRY_HOME`; content-addressed blobs + HF weight trees under `PANTRY_DATA` (defaults to same path) |
| **Resolve (Patent FIG. 2)** | Multi-constraint capability resolution: maps modality, RAM budget, quality tier, and task intent to concrete package and speculative execution plan |
| **Hardware detector** | Discovers Apple Silicon M-series or NVIDIA DGX/CUDA GPUs; maps memory bandwidth and computes roofline throughput |
| **Runtime hub** | Dynamically routes packages to `mlx` (Apple Silicon Metal) or `cuda` (NVIDIA GPUs / PyTorch / Transformers) |
| **Template layer** | Host applies chat templates and strips stop tokens |
| **HTTP server** | OpenAI-compatible chat/images/audio/transcriptions plus `/v1/resolve`, `/v1/memory`, and `/v1/monitor/stats` |
| **Telemetry & Dashboard** | Thread-safe token metrics tracker, system load aggregator, and responsive Web System Monitor (`/dashboard`) |
| **CLI** | `init`, `pull`, `resolve`, `list`, `serve` (+ menu bar on Mac), `dashboard`, `status` |
| **Memory watchdog** | Multi-backend cache manager: soft Metal limits on macOS, CUDA VRAM tracking on Linux, and cross-backend cache clearing |

## Cross-Platform Execution

Pantry is architected to run seamlessly across:
1. **Apple Silicon macOS**: Native unified memory architecture using `mlx` and `mlx-lm` with Metal acceleration.
2. **NVIDIA DGX / Linux / CUDA**: High-performance GPU servers and workstations using PyTorch, Hugging Face `transformers`, `accelerate`, and NVML (`pynvml`).
3. **Generic Linux / CPU**: Headless fallback environments using standard host memory and CPU inference.

### Hardware-Aware Roofline Throughput Model
To fulfill Patent Claim 1 and evaluate speculative decoding acceleration, Pantry interrogates the host memory bus:

$$\text{Tokens/Sec} = \left(\frac{\text{Bandwidth}_{\text{GB/s}}}{\text{Model Size}_{\text{GB}}}\right) \times 0.55$$

The embedded hardware lookup table covers:
* **Apple Silicon**: M1–M4 Base (68–150 GB/s), Pro (150–200 GB/s), Max (300–400 GB/s), Ultra (800 GB/s).
* **NVIDIA Accelerators**: B200 (8,000 GB/s), H200 (4,800 GB/s), GH200 (4,000 GB/s), H100 SXM (3,350 GB/s), H100 PCIe (2,000 GB/s), A100 SXM (2,039 GB/s), A100 PCIe (1,555 GB/s), RTX 4090 (1,008 GB/s), L40S, RTX 3090, V100, T4.

## Process model

- **Install**: Homebrew (`brew tap vdplabs/tap && brew install pantry`), or `pip` / `uv` (`.[mac]` or `.[cuda]`).
- **Daemon**: `pantry serve` binds `127.0.0.1` by default (port `18787`). Managed at login via `pantry service install` on macOS.
- **Library root**: metadata in `~/Library/Application Support/VDPPantry/` on macOS or `~/.local/share/VDPPantry/` on Linux (`PANTRY_HOME`); heavy blobs/weights in `PANTRY_DATA` / `PANTRY_BLOBS` when set (else same as home).
- **IPC**: localhost HTTP first. Unix domain sockets or native IPC can come later; they are optimizations, not the adoption path.

## Resolve and semantics

If a client uses **capability resolve** (or soft aliases like `chat-compact`), the host **must**:

1. Select a package that matches modality, RAM, tier, task intent, and optional `template_family` / `tool_protocol`.
2. Interrogate hardware DRAM/VRAM headroom to calculate dynamic memory ceiling.
3. Validate composite footprint if speculative execution is requested. If budget is constrained, trigger automated fallback (disable speculative or downgrade tier).
4. Apply that package’s chat template itself.
5. Strip model-specific stop / special tokens before the client sees output.

Pinned package ids may still be used for power users. The host will **not** silently swap template families.

Preference order when several packages match: non-demo/real runtime → weights ready → listable → lower comfortable RAM → higher eval score.

## Runtimes

| Runtime | When |
| --- | --- |
| `echo` | Deterministic chat demo / tests (hidden from `/v1/models` by default) |
| `echo_embed` | Deterministic vector embedding scaffold for `/v1/embeddings` |
| `echo_image` | Deterministic PNG scaffold for `/v1/images/generations` |
| `echo_music` | Deterministic WAV scaffold for `/v1/audio/generations` |
| `mlx` | Apple Silicon chat & embeddings via `mlx-lm` after `pantry pull` |
| `cuda` | NVIDIA GPU chat inference via PyTorch & Hugging Face `transformers` with `TextIteratorStreamer` |

Planner hooks exist for speculative draft packages and future adapters; chat inference supports exact token usage telemetry, OpenAI-compatible tool/function calling, and optional worker process isolation so unload can reclaim that worker's GPU allocations.

## Process model & Worker Isolation

- **Install**: Homebrew (`brew tap vdplabs/tap && brew install pantry`), or `pip` / `uv`.
- **Daemon**: `pantry serve` binds `127.0.0.1` by default (port `18787`). Managed at login via `pantry service install`.
- **Worker Isolation**: Pass `--worker-isolation` to run model graph evaluation in a child process. Unloading all packages terminates that worker so the operating system can reclaim its GPU driver allocations; the host daemon stays up.

## Scheduling (MVP)

Completions take a process-wide asyncio lock (FIFO). A `priority=batch` flag exists for future work; today it does **not** preempt interactive requests.

## Security posture

- Bind to loopback by default (`127.0.0.1`), configurable via `--host`.
- No arbitrary shell from packages.
- Optional auth / LAN bind / signed manifests are post-MVP.

