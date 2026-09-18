import type {
  ModelInfo,
  Message,
  ChatCompletionResponse,
  ChatChunk,
  ImageGenerationResponse,
  AudioGenerationResponse,
  TranscriptionResponse,
  EmbeddingsResponse,
  ResolveResponse,
  StorageInfo,
  HealthResponse,
  MonitorStats,
  ModelLoadRequest,
  ResolveRequest,
  MetricRow,
} from '@/types';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:18787';

class ApiError extends Error {
  status: number;
  detail?: string;
  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = await res.json();
      detail = body.detail || body.error?.message;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, res.statusText, detail);
  }
  return res.json();
}

const api = {
  get: <T>(url: string) =>
    fetch(`${BASE_URL}${url}`).then(handleResponse<T>),

  post: <T>(url: string, body?: any) =>
    fetch(`${BASE_URL}${url}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(handleResponse<T>),

  put: <T>(url: string, body?: any) =>
    fetch(`${BASE_URL}${url}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(handleResponse<T>),

  delete: <T>(url: string) =>
    fetch(`${BASE_URL}${url}`, { method: 'DELETE' }).then(handleResponse<T>),

  // Models
  listModels: () =>
    fetch(`${BASE_URL}/v1/models`).then(handleResponse<{ data: ModelInfo[] }>),

  listModelsAll: () =>
    fetch(`${BASE_URL}/v1/models?all_ids=1`).then(handleResponse<{ data: ModelInfo[] }>),

  pullModel: (packageId: string) =>
    fetch(`${BASE_URL}/v1/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package_id: packageId }),
    }).then(handleResponse),

  loadModel: (req: ModelLoadRequest) =>
    fetch(`${BASE_URL}/v1/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }).then(handleResponse),

  unloadModel: (req: ModelLoadRequest) =>
    fetch(`${BASE_URL}/v1/unload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }).then(handleResponse),

  resolve: (req: ResolveRequest) =>
    fetch(`${BASE_URL}/v1/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }).then(handleResponse<ResolveResponse>),

  // Chat
  chat: (messages: Message[], opts?: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    tools?: any[];
    tool_choice?: string;
    response_format?: Record<string, string>;
    adapters?: string[];
    adapter?: string;
    draft_model?: string;
    prefer_speculative?: boolean;
    prefer_prefix_cache?: boolean;
    prefill_step_size?: number;
    num_draft_tokens?: number;
    system_prompt?: string;
    priority?: 'interactive' | 'batch';
  }) => {
    const body: Record<string, any> = {
      model: opts?.model || 'chat-standard',
      messages: (opts?.system_prompt
        ? [{ role: 'system', content: opts.system_prompt }, ...messages]
        : messages) as any,
      temperature: opts?.temperature ?? 0.7,
      max_tokens: opts?.max_tokens ?? 1024,
      stream: opts?.stream ?? true,
    };
    if (opts?.top_p !== undefined) body.top_p = opts.top_p;
    if (opts?.frequency_penalty !== undefined) body.frequency_penalty = opts.frequency_penalty;
    if (opts?.presence_penalty !== undefined) body.presence_penalty = opts.presence_penalty;
    if (opts?.tools) body.tools = opts.tools;
    if (opts?.tool_choice) body.tool_choice = opts.tool_choice;
    if (opts?.response_format) body.response_format = opts.response_format;
    if (opts?.adapters?.length) body.adapters = opts.adapters;
    if (opts?.adapter) body.adapter = opts.adapter;
    if (opts?.draft_model) body.draft_model = opts.draft_model;
    if (opts?.prefer_speculative !== undefined) body.prefer_speculative = opts.prefer_speculative;
    if (opts?.prefer_prefix_cache !== undefined) body.prefer_prefix_cache = opts.prefer_prefix_cache;
    if (opts?.prefill_step_size !== undefined) body.prefill_step_size = opts.prefill_step_size;
    if (opts?.num_draft_tokens !== undefined) body.num_draft_tokens = opts.num_draft_tokens;
    if (opts?.priority) body.priority = opts.priority;

    return fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  // Code & Text Completions (FIM supported)
  complete: (opts: {
    model: string;
    prompt: string;
    suffix?: string;
    max_tokens?: number;
    temperature?: number;
    stop?: string[];
    stream?: boolean;
  }) => {
    return fetch(`${BASE_URL}/v1/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        prompt: opts.prompt,
        suffix: opts.suffix,
        max_tokens: opts.max_tokens ?? 256,
        temperature: opts.temperature ?? 0.2,
        stop: opts.stop,
        stream: opts.stream ?? true,
      }),
    });
  },

  // Images
  generateImage: (prompt: string, model = 'image-standard', size = '1024x1024', n = 1, steps = 4, guidance = 0.0) =>
    fetch(`${BASE_URL}/v1/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size, n, steps, guidance, response_format: 'b64_json' }),
    }).then(handleResponse<ImageGenerationResponse>),

  // Audio generation
  generateAudio: (prompt: string, model = 'music-compact', duration = 3.0) =>
    fetch(`${BASE_URL}/v1/audio/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, duration_seconds: duration, response_format: 'b64_json' }),
    }).then(handleResponse<AudioGenerationResponse>),

  // Transcription
  transcribe: (file: File, model = 'transcribe-compact', language?: string, responseFormat = 'verbose_json') => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('model', model);
    fd.append('response_format', responseFormat);
    if (language) fd.append('language', language);
    return fetch(`${BASE_URL}/v1/audio/transcriptions`, {
      method: 'POST',
      body: fd,
    }).then(handleResponse<TranscriptionResponse>);
  },

  // Translation (to English)
  translate: (file: File, model = 'transcribe-compact', prompt?: string, responseFormat = 'verbose_json') => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('model', model);
    fd.append('response_format', responseFormat);
    if (prompt) fd.append('prompt', prompt);
    return fetch(`${BASE_URL}/v1/audio/translations`, {
      method: 'POST',
      body: fd,
    }).then(handleResponse<TranscriptionResponse>);
  },

  // Embeddings
  embeddings: (input: string | string[], model = 'embed-compact') =>
    fetch(`${BASE_URL}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input, encoding_format: 'float' }),
    }).then(handleResponse<EmbeddingsResponse>),

  // System
  health: () =>
    fetch(`${BASE_URL}/v1/health`).then(handleResponse<HealthResponse>),

  stats: () =>
    fetch(`${BASE_URL}/v1/monitor/stats`).then(handleResponse<MonitorStats>),

  storage: () =>
    fetch(`${BASE_URL}/v1/storage`).then(handleResponse<StorageInfo>),

  prune: (dryRun = false) =>
    fetch(`${BASE_URL}/v1/storage/prune`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: dryRun }),
    }).then(handleResponse),

  monitorReset: () =>
    fetch(`${BASE_URL}/v1/monitor/reset`, { method: 'POST' }).then(handleResponse),

  memory: () =>
    fetch(`${BASE_URL}/v1/memory`).then(handleResponse),

  clearMemory: () =>
    fetch(`${BASE_URL}/v1/memory/clear`, { method: 'POST' }).then(handleResponse),

  unloadAll: () =>
    fetch(`${BASE_URL}/v1/models/unload`, { method: 'POST' }).then(handleResponse),

  metricRows: () =>
    fetch(`${BASE_URL}/v1/monitor/metric-rows`).then(handleResponse<{ rows: MetricRow[] }>),
};

export default api;
export { ApiError };
