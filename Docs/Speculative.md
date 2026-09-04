# Speculative decoding

pantry supports **curated** draft → target speculative decoding via `mlx-lm` (`draft_model=` on `stream_generate`).

## Curated pair (v0.2)

| Role | Package | Alias | Size (approx) |
| --- | --- | --- | --- |
| Target | `vdplabs.qwen25-1.5b.standard.v1` | `chat-standard`, `chat-fast` | ~869 MB |
| Draft | `vdplabs.qwen25-0.5b.compact.v1` | `chat-compact` | ~290 MB |

Both must be pulled. The target manifest sets:

```json
"runtime": {
  "primary": "mlx",
  "draft_package_id": "vdplabs.qwen25-0.5b.compact.v1",
  "hf_repo": "mlx-community/Qwen2.5-1.5B-Instruct-4bit"
}
```

## Enabling

Speculative runs when **all** of:

1. The target package declares `draft_package_id`
2. Draft weights are present on disk
3. The client asks for it:

```bash
# Explicit flag
curl -s http://127.0.0.1:18787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "chat-standard",
    "messages": [{"role":"user","content":"hi"}],
    "prefer_speculative": true,
    "max_tokens": 64
  }'

# Or use the chat-fast alias (implies prefer_speculative)
curl … -d '{"model":"chat-fast","messages":[{"role":"user","content":"hi"}]}'
```

Non-stream responses include `"speculative": true` and `"draft_package_id"` when the draft was used.

If the draft is missing, pantry falls back to the target alone (no error).

## Resolve

```bash
pantry resolve --modality chat --quality standard --speculative
```

Sets `plan.speculative` when the chosen package has a draft id (draft install is still required at generate time).
