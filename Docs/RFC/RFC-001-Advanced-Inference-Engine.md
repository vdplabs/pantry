# RFC-001: Next-Generation Inference Engine & Multi-Modal Extensions

* **Author:** Google DeepMind pair programming assistant (Antigravity) & Vishal
* **Status:** In Progress / Tracking
* **Created:** 2026-09-12
* **Target System:** Pantry (Host-Managed Local AI Engine for Apple Silicon & Heterogeneous Unified Memory)
* **Patent Context:** U.S. Patent Application # 64/148,883 (Claims 1, 5, 7)

---

## 1. Executive Summary

This RFC establishes the technical specifications, architectural blueprints, and phased execution roadmap for the next major generation of Pantry. Building upon Pantry's host-managed capability arbitration, Content-Addressable Storage (CAS) weight deduplication, and speculative decoding engine, this proposal introduces five foundational capabilities:

1. **Radix Prefix KV-Cache Sharing & Chunked Prefill (Zero-Cost Prompt Reuse)**: Sub-20ms Time to First Token (TTFT) across sandboxed clients by indexing past attention KV states in zero-copy unified memory (Patent Claim 7).
2. **Grammar-Guided Structured Outputs & Tool Calling Guard**: Mathematically guaranteed valid JSON adhering to Pydantic/JSON schemas and strict tool-call formatting via token-level logit automata.
3. **Semantic Cross-Encoder Reranking (`/v1/rerank`)**: Cohere-compatible two-stage retrieval endpoint powered by efficient local cross-encoders.
4. **Native Vision-Language (VLM) Modality (`image_to_text`)**: Full multimodal vision-language understanding supporting Qwen2-VL and Llama 3.2 Vision via MLX with zero-copy SHM image passing.
5. **Dynamic LoRA Adapter Hot-Swapping**: Sub-30ms specialization switching on shared resident base models without redundant multi-gigabyte DRAM consumption.

---

## 2. Pillar Specifications

### Pillar 1: Radix Prefix KV-Cache Sharing (Zero-Cost Prompt Reuse)

#### Motivation & Patent Alignment
In multi-turn chats, agentic code generation, and RAG pipelines, repeated system prompts, tool schemas, and repository file context currently trigger redundant prefill computation on every request. On Apple Silicon, unified memory allows CPU and Metal GPU to access identical physical DRAM pages without bus transfers. **Patent Claim 7** explicitly covers host-managed read-only shared virtual memory pages across sandboxed clients.

#### Architecture
* **Radix Cache Tree**: A tree structure indexing token sequence prefixes. Nodes store references to MLX/Metal KV-cache buffers in unified DRAM.
* **Prefix Matching**: Incoming prompts are tokenized and traversed through the Radix tree. The longest matching prefix KV-cache is referenced directly; only the newly appended tokens are processed during prefill.
* **Eviction Policy**: Least-Recently-Used (LRU) with memory ceiling integration (`get_available_unified_dram()`). When memory pressure rises, unreferenced prefix leaves are evicted first.
* **Telemetry**: Tracks cache hits, cache misses, reused prefix tokens, and prefill compute reduction ratio.

#### API & Telemetry Contract
* Header/Option: `prefer_prefix_cache: bool = True` (default enabled for chat).
* Response Metadata:
  ```json
  "usage": {
    "prompt_tokens": 1500,
    "completion_tokens": 120,
    "prompt_tokens_details": {
      "cached_tokens": 1420
    }
  }
  ```

---

### Pillar 2: Grammar-Guided Structured Outputs & Strict Tool Calling

#### Motivation
Agentic loops (such as Sink, IDE extensions, or autonomous workflows) require rigid structured responses. Standard LLM decoding frequently fails strict schema constraints or hallucinates syntax errors in JSON.

#### Architecture
* **Logit Masking Automata**: Compiles JSON schemas, Pydantic models, or Context-Free Grammars (CFG/GBNF) into finite state automata.
* **Token Pruning**: At each autoregressive decode step, tokens that violate schema transitions have their logits masked to `-inf` before sampling.
* **OpenAI & Tool-Calling Compatibility**: Seamlessly intercepts:
  * `response_format: {"type": "json_schema", "json_schema": {"schema": ...}}`
  * `response_format: {"type": "json_object"}`
  * `tools: [...]` and `tool_choice: "required" | "auto"`

---

### Pillar 3: Semantic Cross-Encoder Reranking (`/v1/rerank`)

#### Motivation
Local RAG pipelines achieve highest precision using a two-stage retrieval pattern: initial vector embedding search (`/v1/embeddings`) followed by cross-encoder re-scoring of candidate passages.

#### Architecture
* **Cross-Encoder Runtime**: Dedicated lightweight runtime running cross-encoder models (e.g. `bge-reranker-base`, `bge-reranker-large`, `ms-marco-MiniLM-L-6-v2`).
* **Endpoint Contract** (Cohere API compatibility):
  * `POST /v1/rerank`
  ```json
  {
    "model": "reranker-standard",
    "query": "What is speculative decoding?",
    "documents": [
      "Speculative decoding uses a compact draft model...",
      "Pantry is a package manager..."
    ],
    "top_n": 3,
    "return_documents": true
  }
  ```
* **CLI Interface**: `pantry rank "query" --doc file1.txt --doc file2.txt [--json]`.

---

### Pillar 4: Native Vision-Language (VLM) Modality (`image_to_text`)

#### Motivation
Completes Pantry's multi-modal spectrum by adding visual understanding to existing diffusion image generation (MFlux), video generation (LTX-Video), and transcription (Whisper).

#### Architecture
* **Model Family Support**: `qwen2-vl` (2B/7B), `llama-3.2-vision` (11B), and `molmo` via MLX-VLM.
* **Input Parsing**: Handles base64 data URLs, remote URLs, local file paths, and zero-copy POSIX Shared Memory (SHM) image descriptors produced by MFlux.
* **OpenAI Multimodal Compatibility**:
  ```json
  {
    "model": "vision-standard",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "Inspect this UI diagram."},
          {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
        ]
      }
    ]
  }
  ```

---

### Pillar 5: Dynamic LoRA Adapter Hot-Swapping

#### Motivation
Specialized tasks (coding, legal reasoning, creative writing) often demand specialized fine-tunes. Loading full separate base models consumes prohibitive unified memory.

#### Architecture
* **Single Resident Base Weight**: Base model (e.g. Qwen2.5-7B or Llama-3.1-8B) remains resident in Metal unified DRAM.
* **Low-Rank Weight Composition**: 20 MB – 100 MB LoRA matrices are dynamically injected into active linear layers per-request.
* **Intent Routing**: Automatically selects adapters when `task_intent="coding"` or `task_intent="reasoning"` is passed in capability resolution.
* **Latency Guarantee**: Adapter hot-swapping occurs in under 30ms without base model memory eviction.

---

## 3. Phased Implementation Roadmap & Tracking

| Phase | Feature Pillar | Core Deliverables | Tracking Status |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Prefix KV-Cache Sharing** | Radix tree KV cache manager, prefix match prefill bypass, TTFT benchmark, dashboard telemetry | ✅ **Completed** (223/223 tests passing) |
| **Phase 2** | **Structured Output & Grammars** | JSON schema & regex logit maskers, `response_format` enforcement, strict tool-call guard, `/v1/grammar/validate` | ✅ **Completed** (230/230 tests passing) |
| **Phase 3** | **Semantic Reranking** | Cohere-compatible `/v1/rerank` endpoint, cross-encoder runtime, `pantry rank` CLI, RAG evaluation | ✅ **Completed** (233/233 tests passing) |
| **Phase 4** | **Vision-Language Modality** | Multimodal content block parser, MLX-VLM runtime, Qwen2-VL catalog manifest, SHM cross-pipe | ⏳ Planned |
| **Phase 5** | **LoRA Adapter Hot-Swapping** | LoRA weight injector, intent adapter mapping, `pantry lora` CLI, latency validation | ⏳ Planned |

---

## 4. Verification & Quality Gates

Each phase must pass the following release criteria:
1. **Zero Swapping**: Combined operational memory remains bounded by dynamic DRAM headroom (`get_available_unified_dram()`).
2. **Backward Compatibility**: Standard OpenAI-compatible API routes (`/v1/chat/completions`, `/v1/models`) remain 100% compliant.
3. **Automated Testing**: Dedicated unit & integration tests per phase; 100% pass rate across entire Pantry test suite (216+ existing tests).
4. **Interactive Dashboard**: System Monitor dashboard updated with live observability for each feature.
