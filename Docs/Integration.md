# Integration

Step-by-step walkthrough showing how an **external client (native macOS application, containerized sandboxed process, backend service, web UI, or CLI script)** connects to and leverages **Pantry** and all its endpoints.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                            External Client Application                           │
│             (OpenAI SDK, Web UI, Native Swift App, Sandboxed Agent, CLI)         │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │  HTTP / Loopback / IPC
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             Pantry Host Broker Daemon                            │
│                                 (127.0.0.1:18787)                                │
├──────────────────────────┬───────────────────────────┬───────────────────────────┤
│    1. TELEMETRY & HEALTH │   2. INTENT RESOLUTION    │  3. RUNTIME & INFERENCE   │
│   • GET /v1/health       │   • POST /v1/resolve      │   • /v1/chat/completions  │
│   • GET /v1/memory       │   • GET /v1/models        │   • /v1/embeddings        │
│   • POST /v1/memory/clear│   • POST /v1/pull         │   • /v1/audio/transcribe  │
│   • GET /v1/storage      │   • POST /v1/load/unload  │   • /v1/images/generations│
│                          │                           │   • /v1/video/generations │
└──────────────────────────┴───────────────────────────┴───────────────────────────┘
```

---

### Step 1: Health & Memory Telemetry Inspection

Before scheduling workloads, an orchestrator or client queries Pantry’s system telemetry to verify daemon readiness and monitor unified memory pressure.

#### 1.1 Daemon Health: `GET /v1/health`
Verifies process status, loaded packages, and unified memory pressure.

```bash
curl -s http://127.0.0.1:18787/v1/health | jq
```
```json
{
  "ok": true,
  "name": "pantry",
  "version": "0.5.4",
  "packages": 20,
  "loaded": ["vdplabs.qwen25-1.5b.standard.v1"],
  "memory": {
    "pressure": "ok",
    "active_bytes": 870318080,
    "active_human": "830.00 MB",
    "peak_human": "1.20 GB",
    "cache_human": "450.00 MB",
    "metal_available": true,
    "message": "Metal heap 830.00 MB active / 11.84 GB recommended"
  }
}
```

#### 1.2 Detailed Unified Memory Watchdog: `GET /v1/memory`
Exposes the hardware telemetry registers (Darwin sysctl and Metal working-set headroom):

```bash
curl -s http://127.0.0.1:18787/v1/memory | jq
```

#### 1.3 Free Cache Eviction: `POST /v1/memory/clear`
Forces immediate reclamation of dormant Metal and MLX cache pages without unloading the model weights:

```bash
curl -s -X POST http://127.0.0.1:18787/v1/memory/clear | jq
```

#### 1.4 Content-Addressed Storage Stats: `GET /v1/storage` & `POST /v1/storage/prune`
Inspects chunk deduplication metrics across all stored model weights:

```bash
curl -s http://127.0.0.1:18787/v1/storage | jq
```

#### 1.5 Real-Time System Monitor & Token Telemetry: `GET /v1/monitor/stats` & `/dashboard`
Provides comprehensive telemetry across CPU, GPU (Metal or NVIDIA CUDA), memory segmentation, network rates, active models, and real-time token performance (prefill/decode latency, context fill %, estimated KV cache):

```bash
# Query full telemetry snapshot
curl -s http://127.0.0.1:18787/v1/monitor/stats | jq

# Reset session token metrics
curl -s -X POST http://127.0.0.1:18787/v1/monitor/reset | jq

# Launch interactive Web System Monitor in browser
pantry dashboard
# or navigate to http://127.0.0.1:18787/dashboard
```

---

### Step 2: Intent-Based Capability Resolution (`POST /v1/resolve`)

Rather than hardcoding Hugging Face repo tags or quant filenames into the client application, the client submits an **abstract Intent Tuple** to `/v1/resolve` (**Patent FIG. 2, Step 202**).

Pantry interrogates real-time hardware telemetry, evaluates speculative pair feasibility, applies automated fallback if RAM is tight, and returns an **Execution Plan** (**Patent Step 218**).

#### 2.1 Standard Chat with Speculative Acceleration
```bash
curl -s http://127.0.0.1:18787/v1/resolve \
  -H "Content-Type: application/json" \
  -d '{
    "modality": "chat",
    "quality_tier": "standard",
    "prefer_speculative": true
  }' | jq
```
**Response:**
```json
{
  "package_id": "vdplabs.qwen25-1.5b.standard.v1",
  "alias": "chat-standard",
  "weights_ready": true,
  "ram_gb_min": 2.0,
  "approx_bytes": 750000000,
  "plan": {
    "runtime": "mlx",
    "quant_scheme": "mlx_4bit",
    "context_window": 32768,
    "estimated_tps": 157.5,
    "footprint_bytes": 1000000000,
    "dynamic_ceiling_bytes": 17179869184,
    "speculative": true,
    "draft_package_id": "vdplabs.qwen25-0.5b.compact.v1",
    "speculative_speedup": 1.63,
    "fallback_applied": []
  }
}
```

#### 2.2 Task-Specific Intent (e.g., Coding)
When a client requests a coding model without naming any model family:
```bash
curl -s http://127.0.0.1:18787/v1/resolve \
  -H "Content-Type: application/json" \
  -d '{
    "modality": "chat",
    "task": "coding",
    "ram_gb_max": 8
  }' | jq
```
*Pantry’s task alignment matrix automatically resolves `vdplabs.qwen25-coder-1.5b.compact.v1` over generic models.*

#### 2.3 Automated Fallback Under Constrained RAM (Patent Step 216)
If the client requests speculative execution on standard quality with tight RAM (`ram_gb_max: 2.5`):
* The composite draft + target pair ($2\text{GB} + 1\text{GB} = 3\text{GB}$) exceeds $2.5\text{GB}$.
* **Fallback triggers:** Pantry disables speculative decoding to run the target model standalone, capping context safely without failing.
```json
{
  "package_id": "vdplabs.qwen25-1.5b.standard.v1",
  "plan": {
    "speculative": false,
    "fallback_applied": ["disabled_speculative"],
    "dynamic_ceiling_bytes": 2684354560
  }
}
```

---

### Step 3: Model Weights Lifecycle (`POST /v1/pull`, `/v1/load`, `/v1/unload`)

#### 3.1 Pulling Model Weights
If `weights_ready` is `false`, the client or daemon pulls the weights once into the single-instance shared library:
```bash
curl -s -X POST http://127.0.0.1:18787/v1/pull \
  -H "Content-Type: application/json" \
  -d '{"package_id": "vdplabs.qwen25-1.5b.standard.v1"}' | jq
```

#### 3.2 Pre-warming / Loading
Marks a package as warm so weights are memory-mapped into unified memory:
```bash
curl -s -X POST http://127.0.0.1:18787/v1/load \
  -H "Content-Type: application/json" \
  -d '{"package_id": "chat-standard"}' | jq
```

#### 3.3 Unloading & Reclaiming Metal Memory
Unloads the model and releases memory back to the macOS unified pool:
```bash
curl -s -X POST http://127.0.0.1:18787/v1/unload \
  -H "Content-Type: application/json" \
  -d '{"package_id": "chat-standard"}' | jq
```

---

### Step 4: Model Listing (`GET /v1/models`)

OpenAI-compatible models catalog endpoint used by standard UI drop-downs (Open WebUI, LibreChat, Cherry Studio):

```bash
curl -s http://127.0.0.1:18787/v1/models | jq
```
* Query parameters:
  * `?ready_only=1`: Show only packages with weights already downloaded.
  * `?demos=1`: Include offline echo/scaffold test packs.
  * `?all_ids=1`: Include full package IDs alongside friendly aliases.

---

### Step 5: Multi-Modal Inference Execution

All inference endpoints conform to OpenAI API specifications or standard REST conventions, enabling seamless drop-in adoption.

#### 5.1 Chat Completions with SSE Streaming (`POST /v1/chat/completions`)
Clients can use either concrete IDs or capability aliases (`chat-standard`, `chat-compact`, `chat-fast`):

```bash
curl -s http://127.0.0.1:18787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "chat-fast",
    "messages": [
      {"role": "system", "content": "You are a concise engineering assistant."},
      {"role": "user", "content": "Explain zero-copy mmap in 2 sentences."}
    ],
    "stream": true,
    "temperature": 0.3
  }'
```
*Streams tokens via Server-Sent Events (`text/event-stream`), stripping stop tokens and returning exact tokenizer usage.*

#### 5.2 Tool / Function Calling Support
Pantry manages host-owned prompt shaping for tools and parses assistant responses into standard OpenAI `tool_calls`:

```bash
curl -s http://127.0.0.1:18787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "chat-standard",
    "messages": [{"role": "user", "content": "What is the weather in Boston?"}],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get current weather for a city",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {"type": "string"}
            },
            "required": ["location"]
          }
        }
      }
    ]
  }' | jq
```

#### 5.3 Vector Embeddings (`POST /v1/embeddings`)
Vector embeddings for semantic search or RAG pipelines:

```bash
curl -s http://127.0.0.1:18787/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "embed-compact",
    "input": ["Unified memory architecture", "Speculative decoding pipeline"]
  }' | jq
```

#### 5.4 Audio Transcription / STT (`POST /v1/audio/transcriptions`)
Powered by `mlx-whisper` on Apple Silicon Metal:

```bash
curl -s http://127.0.0.1:18787/v1/audio/transcriptions \
  -F "file=@meeting_audio.wav" \
  -F "model=whisper-1" \
  -F "response_format=verbose_json" | jq
```

#### 5.5 Image Generation (`POST /v1/images/generations`)
Powered by `mflux` (FLUX.1-schnell / FLUX.1-dev / SD-Turbo):

```bash
curl -s http://127.0.0.1:18787/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "image-standard",
    "prompt": "A modern datastore node running in a datacenter, cinematic lighting",
    "size": "512x512",
    "response_format": "url"
  }' | jq
```

#### 5.6 Video Generation (`POST /v1/video/generations`)
Powered by `ltx_video` on Apple Silicon Metal:

```bash
curl -s http://127.0.0.1:18787/v1/video/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "video-standard",
    "prompt": "Drone shot of ocean waves crashing against rocks at sunrise",
    "duration_seconds": 2.0
  }' | jq
```

#### 5.7 Audio / Music Generation (`POST /v1/audio/generations`)
```bash
curl -s http://127.0.0.1:18787/v1/audio/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "music-compact",
    "prompt": "Upbeat synthwave rhythm with analog bass",
    "duration_seconds": 3.0
  }' | jq
```

---

### Step 6: Client Integration Examples

#### Python (Official `openai` SDK Drop-In)
Because Pantry exposes OpenAI-compatible wire contracts, zero code changes are needed in Python apps:

```python
import os
from openai import OpenAI

# Point to Pantry host daemon
client = OpenAI(
    base_url="http://127.0.0.1:18787/v1",
    api_key="not-needed"  # Local loopback requires no auth
)

# 1. Resolve capability dynamically or use alias directly
response = client.chat.completions.create(
    model="chat-fast",  # or "chat-standard", "chat-compact"
    messages=[
        {"role": "user", "content": "How does speculative decoding improve speed?"}
    ],
    stream=True
)

for chunk in response:
    content = chunk.choices[0].delta.content
    if content:
        print(content, end="", flush=True)
print()
```

#### Terminal CLI Usage (`pantry` CLI)
Command-line users can query resolve or run one-shot tasks without writing code:

```bash
# Resolve optimal model for coding under 8 GB RAM
pantry resolve --task coding --ram-gb-max 8

# Interactive chat directly in the terminal
pantry chat "Draft a release note for Pantry v0.5.4" --speculative

# Transcribe an audio file locally
pantry transcribe recording.mp3

# Generate an image locally
pantry image "Neon cyberpunk city at night"
```