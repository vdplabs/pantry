<p align="center">
  <img src="Docs/images/logo.jpeg" alt="pantry" width="160" />
</p>

# pantry

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://www.python.org/downloads/"><img src="https://img.shields.io/badge/Python-3.11+-blue.svg" alt="Python: 3.11+" /></a>
  <a href="https://github.com/vdplabs/pantry/actions"><img src="https://img.shields.io/badge/CI-Passing-brightgreen.svg" alt="CI: Passing" /></a>
  <a href="#cross-platform-execution"><img src="https://img.shields.io/badge/Hardware-Apple%20Silicon%20%7C%20CUDA%20DGX-success.svg" alt="Hardware: Apple Silicon & CUDA" /></a>
  <a href="#http-api"><img src="https://img.shields.io/badge/API-OpenAI%20Compatible-orange.svg" alt="API: OpenAI Compatible" /></a>
  <a href="Docs/Patent-Claims.md"><img src="https://img.shields.io/badge/Patent%20Ref-US%2064%2F148%2C883-purple.svg" alt="Patent: 64/148,883" /></a>
</p>

**pantry** is an open-source, local and cluster AI model host built for Apple Silicon and Linux (NVIDIA DGX / CUDA): one shared model library on disk, a lightweight background daemon with capability resolution, Content-Addressable Storage (CAS) deduplication, and an OpenAI-compatible HTTP API.

Instead of hardcoding Hugging Face repo names or quantization filenames into every application, clients ask pantry for *capabilities* — `"chat that fits in ~8 GB RAM, prefer speed"` — and pantry dynamically queries physical hardware headroom, resolves a concrete package, configures speculative decoding, and streams tokens. Weights live once on disk; multiple applications and background agents reuse them.

---

## ⚡ 60-Second Quickstart

### 1. Install Pantry
```bash
# macOS (Apple Silicon with MLX & menu bar)
pip install "pantry[mac]"

# Or clone for development
git clone https://github.com/vdplabs/pantry.git && cd pantry
pip install -e ".[mac,dev]"
```

### 2. Pull a Starter Model
```bash
# Pull standard compact chat model (~290 MB)
pantry pull vdplabs.qwen25-0.5b.compact.v1
```

### 3. Launch the Server
```bash
pantry serve
```
*The daemon starts on `http://127.0.0.1:18787` with a macOS menu bar status icon.*

### 4. Open the Web Dashboard
```bash
pantry dashboard
```
*Launches the real-time glassmorphism System Monitor with interactive Playground, Model Performance benchmarks, and Cloud Cost Savings (ROI) Ledger.*

### 5. Chat via OpenAI-Compatible API
```bash
curl -s http://127.0.0.1:18787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "chat-compact",
    "messages": [{"role": "user", "content": "Explain unified memory in one sentence."}],
    "max_tokens": 64
  }' | jq '.choices[0].message.content'
```

---

## 🔬 Core Innovations & Patent Architecture

Pantry serves as the open-source reference implementation of **U.S. Provisional Patent Application # 64/148,883** (*Shared Unified Memory Storage & Host Model Management for Local and Edge Intelligence*).

```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ Sink AI Studio  │   │ Background CLI  │   │ LangChain Agent │
└────────┬────────┘   └────────┬────────┘   └────────┬────────┘
         │                     │                     │
         └─────────────────────┼─────────────────────┘
                               ▼
               ┌───────────────────────────────┐
               │    pantry host (:18787)       │
               │   OpenAI HTTP + SSE Stream    │
               └───────────────┬───────────────┘
       ┌───────────────────────┼───────────────────────┐
       ▼                       ▼                       ▼
  CLAIM 1 (FIG. 2)        CLAIM 2 (CAS)           CLAIM 3
Dynamic Telemetry &     Content-Addressable     Zero-Retention
Capability Arbitration  Storage & Deduplication Ephemeral Memory
```

### 1. Dynamic Capability Resolution (Patent Claim 1 & FIG. 2)
Order by *dish*, not by *recipe*. Clients submit an abstract capability request tuple:
```bash
pantry resolve --modality chat --ram-gb-max 8 --quality compact
```
- **Hardware Telemetry Interrogation (Step 204)**: Interrogates Apple Silicon unified DRAM or NVIDIA VRAM to compute the instantaneous unpaged dynamic memory ceiling: $C_{\text{dynamic}} = \min(R_{\text{budget}}, D_{\text{available}})$.
- **Roofline Throughput Estimation (Step 208)**: Uses the physical memory bus bandwidth to predict generation speed before loading:
  $$\text{TPS} = \left(\frac{\text{Bandwidth}_{\text{GB/s}}}{\text{Model Size}_{\text{GB}}}\right) \times 0.55$$
- **Speculative Candidate Feasibility (Steps 212–214)**: Evaluates composite footprint ($P_{\text{target}} + P_{\text{draft}}$) against the dynamic ceiling.
- **Automated Fallback Cascade (Step 216)**: Automatically disables speculative decoding or downgrades quality tiers if system memory is constrained, preventing OOM crashes.
- **Execution Plan Output (Step 218)**: Returns an actionable execution specification with context window ceilings and predicted TPS.

*Inspect via CLI:* `pantry patent` or `pantry patent --json`. Full specification: [`Docs/Patent-Claims.md`](Docs/Patent-Claims.md).

### 2. Content-Addressable Storage & APFS Deduplication (Patent Claim 2 & RFC-0006)
- **Shared Chunk Store**: Chunks are stored under `$PANTRY_DATA/cas/chunks/` keyed by immutable SHA-256 cryptographic hashes.
- **Cross-Quantization Deduplication**: Invariant model structures—such as token embeddings (`embed_tokens`), normalization layers, and multimodal vision towers—are shared 100% across 4-bit, 8-bit, and 16-bit variants of the same model family, saving **30%–60% disk space**.
- **Zero-Copy APFS Extent Sharing**: Uses macOS `copyfile(..., COPYFILE_CLONE)` to materialize standard `.safetensors` files without duplicating physical disk blocks and with **zero read latency overhead** during Metal inference.
- **SQLite WAL Refcounting**: Transactional tracking with automated garbage collection (`pantry prune`).

*Inspect via CLI:* `pantry storage` and `pantry prune --dry-run`.

### 3. Zero-Retention Privacy & Hardware Isolation (Patent Claim 3)
- **Ephemeral Virtual Memory**: Prompts, tokens, and KV-cache activations reside strictly in transient memory buffers and are never persisted to unencrypted temporary files or local databases.
- **Subprocess Worker Isolation (`--worker-isolation`)**: Spawns inference engines in isolated worker processes. Unloading a model terminates the worker, causing macOS/Linux kernels to immediately reclaim 100% of driver Metal/CUDA allocations.

---

## 🖥️ Interactive Web System Monitor Dashboard

When the daemon is running, open **`http://127.0.0.1:18787/dashboard`** (or run `pantry dashboard`):

1. **System Monitor**:
   - Modern vertical **Hero Platform Vitals** KPI cards (*Host & Architecture*, *Unified RAM Pool*, *Inference Pipeline*, *Concurrency Queue*, *CAS Storage Savings*).
   - Real-time CPU core matrix, GPU compute load, unified memory distribution, and storage I/O sparklines.
   - **Model Inventory & Weights Table**: Live resident/standby status, RAM footprint, idle memory reclaim countdown timers, and 1-click **Purge Pool** and **Unload All**.
2. **📈 Model Performance Intelligence**:
   - Per-model decode throughput percentiles (`p50 / p95 tok/s`), peak TPS, time-to-first-token (TTFT), and energy efficiency (`tok/W`).
   - Speculative decoding acceleration meters and KV-cache footprint scaling curves.
3. **💎 Usage & Cloud Cost Savings (ROI) Ledger**:
   - Real-time accounting of session and cumulative tokens across all modalities (Text, Images, Audio, Video, Embeddings).
   - Side-by-side comparison showing actual money saved versus commercial cloud API rates (OpenAI GPT-4o, Claude 3.5 Sonnet).
4. **⚡ Playground**:
   - Test chat completions, diffusion image generation, and audio transcriptions directly from your browser.

---

## 🥊 Comparison: How Pantry Differs

| Feature | Pantry | Ollama / llama.cpp | vLLM |
| :--- | :--- | :--- | :--- |
| **Model Resolution** | **Capability Intent Tuple** (modality, RAM budget, quality tier, task intent) or package ID | Fixed tag / file path (`llama3.2:3b`) | Hugging Face repo tag pinned at launch |
| **Storage Architecture** | **Shared CAS with Cross-Quant Deduplication** (1 copy on disk; APFS extent clone) | Coarse file duplication per model/tag | Coarse Hugging Face cache |
| **Hardware Telemetry** | **Real-time roofline model** + dynamic memory ceiling arbitration | Static memory limits | Pre-allocated GPU memory fraction |
| **Speculative Decoding** | **Automated dynamic pair arbitration** with fallback cascade | Manual configuration | Manual configuration |
| **Prompt Ownership** | **Host-owned templates** + stop-token stripping (clients never stranded) | Modelfile / client dependent | Client / model tokenizer dependent |
| **Zero-Retention Privacy** | **Guaranteed ephemeral execution** + worker process Metal reclaim | Varies | Persistent KV-cache options |
| **Web Dashboard** | **Full System Monitor, Performance Benchmarks, & ROI Ledger** | Community web UIs | Minimal metrics endpoint |
| **Multi-Modal Support** | Real MLX Chat, Whisper STT, FLUX Diffusion, and Embeddings | Primarily LLMs / vision | Primarily LLMs / vision |

---

## 💻 CLI Command Reference

| Command | Purpose |
| :--- | :--- |
| `pantry init` | Initialize library directory tree and seed the bundled model catalog |
| `pantry pull <package_id>` | Download and verify package weights into shared store |
| `pantry resolve …` | Arbitrate model selection from capability constraints (Patent Claim 1) |
| `pantry list` | List all available and installed model packages |
| `pantry load` / `unload` | Warm model weights into memory or release allocations |
| `pantry serve` | Start OpenAI-compatible HTTP daemon + macOS menu bar |
| `pantry dashboard` | Open the interactive Web System Monitor in your default browser |
| `pantry patent` / `claims` | Display Patent Application # 64/148,883 specifications & live telemetry |
| `pantry storage` | Inspect CAS deduplication ratio and disk savings |
| `pantry prune` | Reclaim unreferenced model weight chunks (`--dry-run` supported) |
| `pantry chat "<prompt>"` | Fast terminal chat completions with optional speculative decoding |
| `pantry transcribe <file>` | Local speech-to-text audio transcription via Whisper |
| `pantry image "<prompt>"` | Generate diffusion images locally via Metal acceleration |
| `pantry service install` | Install background login LaunchAgent on macOS (`com.vdplabs.pantry.serve`) |

---

## 🌐 HTTP API Surface

Pantry exposes standard OpenAI-compatible endpoints along with local host management APIs:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/v1/chat/completions` | Streaming SSE & non-streaming chat with exact token accounting & tool calling |
| `POST` | `/v1/images/generations` | Diffusion image generation powered by `mflux` (FLUX.1-schnell/dev) |
| `POST` | `/v1/audio/transcriptions` | Speech-to-text audio transcription powered by `mlx-whisper` |
| `POST` | `/v1/embeddings` | Vector embeddings generation (single or batched) |
| `POST` | `/v1/resolve` | **Capability Arbitration (Patent Claim 1)**: Submit intent tuple $\to$ receive ExecutionPlan |
| `GET` | `/v1/storage` | **CAS Telemetry (Patent Claim 2)**: Apparent vs physical bytes, dedup ratio |
| `POST` | `/v1/storage/prune` | Garbage collection of unreferenced weight chunks |
| `GET` | `/v1/monitor/stats` | Comprehensive telemetry feed powering the Web Dashboard |
| `POST` | `/v1/models/unload` | Eager memory release with worker process termination |
| `GET` | `/v1/health` | Service uptime, active models, and unified memory pressure |

---

## 🛠️ Cross-Platform Execution

Pantry is engineered to run seamlessly across:
1. **Apple Silicon macOS (M1/M2/M3/M4)**: Native unified memory architecture using Apple MLX with zero-copy Metal acceleration.
2. **NVIDIA DGX & Linux CUDA**: High-performance GPU servers using PyTorch, Hugging Face `transformers`, `accelerate`, and NVML (`pynvml`).
3. **Generic Linux / CPU**: Headless fallback environments using standard system DRAM and CPU execution.

---

## 🤝 Contributing

We welcome contributions from the community! Check out our [Contributing Guide](CONTRIBUTING.md) for:
- Development environment setup with `uv` or Python `venv`.
- Running the test suite (`pytest`) and code formatting (`ruff`).
- Adding new model packages to `catalog/`.
- Adding new inference runtime adapters.

---

## 📄 License & Patent Notice

Pantry is licensed under the **[MIT License](LICENSE)**:

```
MIT License
Copyright (c) 2026 VDP Labs
```

The underlying technical architecture is subject to **U.S. Provisional Patent Application # 64/148,883** (*Shared Unified Memory Storage & Host Model Management for Local and Edge Intelligence*). VDP Labs grants royalty-free permission to use, copy, modify, and distribute this software under the terms of the MIT License.
