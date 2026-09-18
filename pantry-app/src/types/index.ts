export interface ModelInfo {
  id: string;
  alias?: string;
  modalities: string[];
  aliases: string[];
  runtime: string;
  role?: string;
  size_gb?: number;
  context_max?: number;
  quant_label?: string;
  weights_ready?: boolean;
  resident?: boolean;
  draft_package_id?: string;
  family?: string;
  quality_tier?: string;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'developer' | 'tool';
  content: string | MessageContent[];
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  model?: string;
  meta?: {
    id?: string;
    model?: string;
    finish_reason?: string;
    speculative?: boolean;
    draft_package_id?: string | null;
    created?: number;
  };
  token_stats?: {
    tps?: number;
    duration_s?: number;
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    cached_tokens?: number;
  };
}

export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
    tool_calls?: ToolCall[];
    reasoning_content?: string;
  };
  finish_reason: string;
}

export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface TextCompletionRequest {
  model: string;
  prompt: string;
  suffix?: string;
  max_tokens?: number;
  temperature?: number;
  stop?: string[];
  stream?: boolean;
}

export interface TextCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  system_fingerprint?: string;
  choices: Array<{
    text: string;
    index: number;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens: number };
  };
  speculative?: boolean;
  draft_package_id?: string;
  speculative_details?: Record<string, any>;
}

export interface ChatChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      content?: string;
      role?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  };
}

export interface ImageGenerationResponse {
  created: number;
  model: string;
  package_id: string;
  data: Array<{
    b64_json?: string;
    url?: string;
    path?: string;
    revised_prompt?: string;
  }>;
}

export interface AudioGenerationResponse {
  created: number;
  model: string;
  package_id: string;
  data: Array<{
    b64_json?: string;
    url?: string;
    path?: string;
    format: string;
    sample_rate: number;
    duration_seconds: number;
  }>;
}

export interface TranscriptionResponse {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    id: number;
    seek: number;
    start: number;
    end: number;
    text: string;
    tokens: number[];
  }>;
}

export interface EmbeddingsResponse {
  object: string;
  data: Array<{
    object: string;
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface ResolveRequest {
  modality?: string;
  ram_gb_max?: number;
  quality_tier?: string;
  latency_class?: string;
  family_prefer?: string | null;
  template_family?: string | null;
  tool_protocol?: string | null;
  prefer_speculative?: boolean;
  pin_family?: string | null;
  task?: string;
}

export interface ResolveResponse {
  package_id: string;
  alias?: string;
  reason?: string;
  plan: {
    runtime?: string;
    speculative?: boolean;
    draft_package_id?: string;
    context_max?: number;
    estimated_tps?: number;
  };
}

export interface StorageInfo {
  apparent_human?: string;
  physical_human?: string;
  cas_saved_human?: string;
  dedup_ratio?: number;
  chunk_count?: number;
  total_chunks_size?: string;
}

export interface HealthResponse {
  ok: boolean;
  name: string;
  version: string;
  packages: number;
  loaded: string[];
  home: string;
  data: string;
  memory: {
    pressure: string;
    active_bytes: number;
    active_human: string;
    peak_bytes: number;
    cache_bytes: number;
    metal_available: boolean;
    limits?: { applied: boolean; cache_limit_bytes: number };
  };
}

export interface MonitorStats {
  ok: boolean;
  device: {
    name: string;
    architecture: string;
    bandwidth_gbps: number;
  };
  cpu: {
    overall_percent: number;
    per_core_percent: number[];
    cores_count: number;
  };
  memory: {
    status: string;
    total_human: string;
    used_human: string;
    percent: number;
  };
  gpu: {
    utilization_percent: number;
    allocated_vram_human: string;
  };
  network: {
    interface: string;
    download_human_sec: string;
    upload_human_sec: string;
  };
  disk: {
    volume: string;
    used_human: string;
    cas_saved_human: string;
  };
  ai_models: {
    total_resident_human: string;
    cache_pool_human: string;
    resident_models: string[];
  };
  inference: {
    decode_tps: number;
    prefill_tps: number;
    context_fill: { percent: number };
    kv_cache_human: string;
  };
}

export interface ModelLoadRequest {
  package_id: string;
  pin?: boolean;
}

export interface MetricRow {
  model: string;
  modality: string;
  p50_tps: number;
  p95_tps: number;
  peak_tps: number;
  ttft_ms: number;
  energy_efficiency: number;
  context_limit: number;
  resident: boolean;
  size_human: string;
  memory_human: string;
  speculative_enabled: boolean;
}

export type ChatModality = 'chat' | 'image' | 'music' | 'speech' | 'embedding' | 'text';

export interface Generation {
  id: string;
  type: 'image' | 'audio' | 'text';
  prompt: string;
  result: string;
  createdAt: string;
  model: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  model: string;
  messages: Message[];
}
