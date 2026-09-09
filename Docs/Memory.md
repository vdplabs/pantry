# Multi-Backend Memory Watchdog

Pantry provides active memory monitoring and telemetry across **Apple Silicon Unified Memory** and **NVIDIA CUDA VRAM**. It exposes real-time heap and buffer statistics, protects systems against out-of-memory thrashing via soft caps, and dynamically calculates safe context window limits and KV cache footprints.

---

## 1. What You See

Depending on whether Pantry is running on macOS or an NVIDIA GPU cluster, the memory watchdog interrogates the appropriate hardware registers:

| Field | Meaning on Apple Silicon | Meaning on NVIDIA CUDA / Linux |
| --- | --- | --- |
| `active_bytes` | Currently allocated Metal / MLX heap | Active CUDA allocated bytes (`torch.cuda.memory_allocated()`) |
| `peak_bytes` | Peak Metal allocation since process start | Peak CUDA memory allocation (`torch.cuda.max_memory_allocated()`) |
| `cache_bytes` | Unused pages retained in MLX free cache | Reserved but unallocated CUDA cache pages |
| `vram_free_bytes` | N/A (Unified with host DRAM) | Free VRAM on the primary device (`torch.cuda.mem_get_info()`) |
| `vram_total_bytes` | N/A (Unified with host DRAM) | Total physical VRAM on the GPU accelerator |
| `pressure` | `ok` / `elevated` / `critical` vs recommended set | `ok` / `elevated` / `critical` vs total VRAM threshold |
| `limits` | Cache / memory soft caps applied | Device memory reservation limits |

```bash
# Compact memory status
curl -s http://127.0.0.1:18787/v1/health | jq .memory

# Full memory watchdog snapshot
curl -s http://127.0.0.1:18787/v1/memory | jq

# Real-time full system telemetry
curl -s http://127.0.0.1:18787/v1/monitor/stats | jq .memory
```

On macOS, `pantry serve` opens a menu bar status item: **Memory** line + **Unified memory** submenu, with **Clear Metal cache…**. Title hints: `P` ok · `P!` elevated · `P!!` critical.

---

## 2. Dynamic Telemetry Ceiling & Context KV Cache

In accordance with **Patent Claim 1 and FIG. 2 (Step 204)**, Pantry dynamically calculates available DRAM/VRAM headroom before admitting or resolving models:

```python
dynamic_ceiling = min(ram_gb_max or float("inf"), get_available_unified_dram())
```

### Context KV Cache Calculation
As context lengths grow, key-value caches expand substantially. Pantry projects KV cache consumption as:

$$\text{KV Cache Bytes} = 2 \times n_{\text{layers}} \times n_{\text{heads\_kv}} \times d_{\text{head}} \times 2 \times \text{tokens}$$

If available headroom cannot accommodate both weights and the maximum context window, Pantry computes a safe **usable context window**:

$$\text{usable\_context} = \min\left(\text{context\_max}, \frac{\text{Headroom} - \text{Weights}}{\text{Bytes\_Per\_Token}}\right)$$

This ensures client inference requests never induce system swap or crash the host daemon.

---

## 3. Cross-Platform Cache Reclaim: `POST /v1/memory/clear`

Clearing memory caches forces immediate reclamation of dormant pages across all loaded runtimes:
1. **Apple Silicon**: Calls `mx.metal.clear_cache()`.
2. **NVIDIA CUDA**: Calls `torch.cuda.empty_cache()` and `torch.cuda.ipc_collect()`.
3. **Apple MPS**: Calls `torch.mps.empty_cache()` (if PyTorch MPS is loaded).
4. **Host Runtime**: Forces Python `gc.collect()`.

```bash
curl -s -X POST http://127.0.0.1:18787/v1/memory/clear | jq
```

---

## 4. Protection (Soft Caps on Apple Silicon)

At serve startup on Apple Silicon, Pantry calls MLX:
- `set_cache_limit` — reclaim free cache above the cap on the next allocation  
- `set_memory_limit` — guideline for graph evaluation

| Environment Variable | Default Value | Description |
| --- | --- | --- |
| `PANTRY_METAL_CACHE_LIMIT_RATIO` | `0.45` | Ratio of recommended working set for free cache |
| `PANTRY_METAL_MEMORY_LIMIT_RATIO` | `0.85` | Ratio of recommended working set for active allocations |
| `PANTRY_METAL_CACHE_LIMIT_BYTES` | unset | Absolute byte override for cache limit |
| `PANTRY_METAL_MEMORY_LIMIT_BYTES` | unset | Absolute byte override for memory limit |

---

## 5. Worker Process Isolation (OS-level GPU Reclaim)

On both macOS (Metal drivers) and Linux (CUDA driver runtimes), system allocator pools often retain committed memory within the host process address space even after calling memory clear routines.

To guarantee that GPU driver allocations are fully returned to the operating system when models are unloaded, Pantry supports **Worker Subprocess Isolation**:

```bash
pantry serve --worker-isolation
# or: export PANTRY_WORKER_ISOLATION=1
```

When worker isolation is enabled:
1. Model loading and graph evaluation run in an isolated subprocess.
2. Unloading all packages (`POST /v1/unload` or `pantry unload`) cleanly terminates the worker process.
3. The operating system kernel immediately reclaims all GPU driver allocations and heap associated with the terminated worker, while the host server remains lightweight.
4. Subsequent inference requests automatically spin up a fresh worker on demand.

---

## 6. Endpoints Summary

- `GET /v1/health`: Compact memory pressure status.
- `GET /v1/memory`: Full multi-backend memory watchdog snapshot.
- `POST /v1/memory/clear`: Multi-backend cache reclaim (Metal + CUDA + MPS + GC).
- `GET /v1/monitor/stats`: Complete hardware and token telemetry, including memory segmentation.
  

