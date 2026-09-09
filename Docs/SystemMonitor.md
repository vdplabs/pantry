# Web System Monitor Dashboard

Pantry includes an interactive, zero-dependency, real-time **Web System Monitor Dashboard** served directly from the daemon. Styled with a dark glassmorphism design matching SINK's native macOS System Monitor, it provides full visual telemetry across host hardware, inference throughput, and active model lifetimes on both Apple Silicon and NVIDIA DGX / Linux hosts.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  PANTRY SYSTEM MONITOR                                  [Refresh: 1.0s ▼] [Copy] │
├──────────────────────────────────────────────────────────────────────────────────┤
│  [ CPU: 14.2% ]         [ GPU: 28.5% ]         [ MEMORY: 64.0 GB ]               │
│  Sparkline & per-core   Sparkline & VRAM       App / Wired / Compressed / Free   │
├──────────────────────────────────────────────────────────────────────────────────┤
│  [ NETWORK I/O ]                               [ CAS STORAGE DEDUPLICATION ]     │
│  ↓ 142.5 KB/s   ↑ 12.8 KB/s                    Dedup Ratio: 2.41x  (Saved 18 GB) │
├──────────────────────────────────────────────────────────────────────────────────┤
│  AI RESIDENT MODELS IN MEMORY                         [ Unload All ] [Purge Pool]│
│  • vdplabs.qwen25-1.5b.standard.v1  (830 MB)   Context: 32,768      [ Unload ]   │
├──────────────────────────────────────────────────────────────────────────────────┤
│  INFERENCE & TOKEN TELEMETRY                                   [ Reset Session ] │
│  Prefill: 182.4 tok/s (14ms)   Decode: 64.2 tok/s   Context Fill: 12.4%          │
│  Session Tokens: 1,420 (Prompt: 890, Completion: 530)  Requests: 18              │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Accessing the Dashboard

### Via Browser
When `pantry serve` is running, navigate to:
```
http://127.0.0.1:18787/dashboard
```
*Note: Pointing your browser to the root URL `http://127.0.0.1:18787/` automatically detects browser requests (`Accept: text/html`) and renders the dashboard.*

### Via CLI
Launch the dashboard directly in your default browser using the Pantry CLI:
```bash
pantry dashboard
```
Options:
* `--host <ip>`: Daemon host address (default: `127.0.0.1`).
* `--port <port>`: Daemon port (default: `18787`).
* `--no-open`: Print the dashboard URL without opening the browser automatically.

---

## 2. Dashboard Features & Capabilities

### Real-Time Hardware Gauges
* **CPU Utilization**: Overall system percentage, real-time Canvas sparkline history (last 30 samples), and per-core visual progress bars.
* **GPU Utilization & VRAM**:
  * **Apple Silicon**: Metal active heap, free cache, peak bytes, and recommended working set.
  * **NVIDIA DGX / CUDA**: Core GPU utilization %, active VRAM allocation, reserved memory, and total device VRAM.
* **Memory Breakdown**: Segmented bar visualization dividing system RAM into App, Wired, Compressed, and Free memory.
* **Network Throughput**: Live download ($\downarrow$) and upload ($\uparrow$) rates computed dynamically across polling intervals.
* **Content-Addressed Storage (CAS)**: Total stored weight bytes, deduplicated blob footprint, and storage reduction ratio.

### Live Operation & Model Loading Tracking (Beyond SINK)
* **Live Activity Banner**: Displays an animated glowing banner whenever a model is loading or generating (e.g. `Generating image / loading weights... (vdplabs.z-image-turbo.standard.v1)`).
* **Live Elapsed Timer**: Visual counter tracking the exact seconds spent preparing weights or computing inferences.
* **Model State Badges**: Model entries visually indicate busy loading states with pulsing badges, elapsed loading counters, and active backend tags (Apple Silicon Metal / NVIDIA CUDA).
* **Activity & Lifecycle Event Log**: Real-time ticker logging daemon start, model loads, model unloads, inference completions, and memory cache purges.

### AI Resident Models Management & Pre-Warming
* Lists all models currently resident in memory as well as catalog models available on standby.
* Displays model parameters, runtime backend (`mlx` or `cuda`), resident RAM footprint, and maximum context window.
* **1-Click Pre-Warming (⚡ Load)**: Pre-load any standby model into RAM/VRAM before invoking inference requests via `POST /v1/load`.
* **1-Click Unload**: Eject specific models from memory immediately via `POST /v1/unload`.
* **Unload All**: Free all warm models from GPU and host RAM.
* **Purge Pool**: Clear dormant Metal / CUDA caches and force Python garbage collection without ejecting model weights.

### Quick Inference Playground
* Directly embedded into the monitor dashboard to test and benchmark models in real-time.
* Send test prompts, observe live token throughput sparklines, verify context fill progress, and benchmark latency directly from the browser.

### Inference & Token Telemetry
* **Decode Throughput**: Real-time tokens per second (TPS) with live Canvas sparkline.
* **Prefill Telemetry**: Time-to-first-token (TTFT) latency and prefill speed (tok/s).
* **Context Usage**: Visual progress bar indicating percentage of the model's maximum context window currently populated.
* **Estimated KV Cache**: Projected memory consumed by the key-value cache under the active context load.
* **Token Counters**: Real-time tracking of session and lifetime prompt tokens, completion tokens, total tokens, and served request counts.

### Interactive Controls
* **Refresh Rate Selector**: Choose update intervals of `0.5s`, `1.0s`, `2.0s`, `5.0s`, or `Pause`.
* **Export Snapshot**: One-click button to copy the complete JSON telemetry state directly to your system clipboard.
* **Reset Counters**: Reset session token metrics without interrupting the daemon.

---

## 3. Telemetry REST API

External services, monitoring daemons (Prometheus/Grafana exporters), or custom client UIs can query the raw telemetry JSON API backing the dashboard.

### `GET /v1/monitor/stats`
Returns the full system telemetry snapshot.

#### Example Request
```bash
curl -s http://127.0.0.1:18787/v1/monitor/stats | jq
```

#### Example Response
```json
{
  "timestamp": 1788989500.123,
  "hardware": {
    "platform": "darwin",
    "device_name": "Apple M3 Max",
    "chip_family": "m3_max",
    "arch": "arm64",
    "memory_bandwidth_gbps": 350.0,
    "total_ram_gb": 64.0,
    "cores_physical": 16,
    "cores_logical": 16
  },
  "cpu": {
    "percent": 14.2,
    "per_cpu": [18.0, 12.5, 14.1, 15.0, 10.2, 9.8, 16.4, 14.0, 12.1, 11.0, 15.5, 13.2, 19.0, 14.8, 12.6, 15.1],
    "count": 16
  },
  "memory": {
    "total_bytes": 68719476736,
    "available_bytes": 43980465152,
    "used_bytes": 24739011584,
    "percent": 36.0,
    "wired_bytes": 8589934592,
    "active_bytes": 870318080,
    "active_human": "830.00 MB",
    "peak_human": "1.20 GB",
    "cache_human": "450.00 MB",
    "metal_available": true
  },
  "gpu": {
    "available": true,
    "backend": "metal",
    "device_name": "Apple M3 Max",
    "utilization_percent": 28.5,
    "vram_used_bytes": 870318080,
    "vram_total_bytes": 68719476736,
    "vram_used_human": "830.00 MB",
    "vram_total_human": "64.00 GB"
  },
  "network": {
    "bytes_sent": 104857600,
    "bytes_recv": 524288000,
    "rate_sent_kbps": 12.8,
    "rate_recv_kbps": 142.5
  },
  "storage": {
    "total_bytes": 25769803776,
    "dedup_bytes": 10737418240,
    "saved_bytes": 15032385536,
    "dedup_ratio": 2.4
  },
  "models": {
    "count": 1,
    "active": [
      {
        "package_id": "vdplabs.qwen25-1.5b.standard.v1",
        "alias": "chat-standard",
        "loaded_at": 1788989100.0,
        "runtime": "mlx",
        "params_b": 1.5,
        "context_max": 32768,
        "resident_bytes": 870318080,
        "resident_human": "830.00 MB"
      }
    ]
  },
  "tokens": {
    "session": {
      "prompt_tokens": 890,
      "completion_tokens": 530,
      "total_tokens": 1420,
      "requests": 18
    },
    "cumulative": {
      "prompt_tokens": 890,
      "completion_tokens": 530,
      "total_tokens": 1420,
      "requests": 18
    },
    "throughput": {
      "decode_tps": 64.2,
      "prefill_tps": 182.4,
      "prefill_latency_ms": 14.5
    },
    "context": {
      "current_tokens": 4096,
      "max_tokens": 32768,
      "fill_percent": 12.5,
      "estimated_kv_cache_bytes": 134217728,
      "estimated_kv_cache_human": "128.00 MB"
    }
  }
}
```

---

### `POST /v1/monitor/reset`
Resets the session token counters, request tallies, and throughput averages back to zero.

#### Example Request
```bash
curl -s -X POST http://127.0.0.1:18787/v1/monitor/reset | jq
```

#### Response
```json
{
  "status": "reset",
  "tokens": {
    "session": {
      "prompt_tokens": 0,
      "completion_tokens": 0,
      "total_tokens": 0,
      "requests": 0
    }
  }
}
```
