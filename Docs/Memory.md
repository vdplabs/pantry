# Unified memory watchdog

On Apple Silicon, MLX keeps Metal heaps and a free **cache** that can linger after unload. pantry applies soft caps at `serve` start and exposes live heap stats so you can see pressure before the machine swaps.

## What you see

| Field | Meaning |
| --- | --- |
| `active_bytes` | Currently allocated Metal / MLX heap |
| `peak_bytes` | Peak since process start |
| `cache_bytes` | Unused pages still held in the MLX free cache |
| `pressure` | `ok` / `elevated` / `critical` vs recommended working set |
| `limits` | Cache / memory caps pantry applied |

```bash
curl -s http://127.0.0.1:18787/v1/health | jq .memory
curl -s http://127.0.0.1:18787/v1/memory | jq
pantry status | jq .memory
```

Menu bar (opened by `pantry serve`): **Memory** line + **Unified memory** submenu, with **Clear Metal cache…**.

Title hints: `P` ok · `P!` elevated · `P!!` critical.

## Protection (soft caps)

At serve startup pantry calls MLX:

- `set_cache_limit` — reclaim free cache above the cap on the next allocation  
- `set_memory_limit` — guideline for graph evaluation

Defaults (overridable):

| Env | Default |
| --- | --- |
| `PANTRY_METAL_CACHE_LIMIT_RATIO` | `0.45` of recommended working set |
| `PANTRY_METAL_MEMORY_LIMIT_RATIO` | `0.85` of recommended working set |
| `PANTRY_METAL_CACHE_LIMIT_BYTES` | absolute override |
| `PANTRY_METAL_MEMORY_LIMIT_BYTES` | absolute override |

```bash
curl -s -X POST http://127.0.0.1:18787/v1/memory/clear | jq
```

Unload models (`POST /v1/unload` or the menu) then clear cache if the heap stays high.

## API

- `GET /v1/health` → compact `memory` object  
- `GET /v1/memory` → full snapshot + limits applied at start  
- `POST /v1/memory/clear` → `mx.clear_cache()` best-effort  
