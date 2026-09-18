import api from './api';
import type { Message, ToolCall } from '@/types';

export interface StreamingResult {
  content: string;
  reasoningContent?: string;
  toolCalls?: ToolCall[];
  finishReason: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
  model: string;
  id?: string;
  speculative?: boolean;
  draftPackageId?: string | null;
  created?: number;
}

export function streamChat(
  response: Response,
  onToken?: (token: string) => void,
  onDone?: (result: StreamingResult) => void,
  onError?: (err: Error) => void,
  onReasoning?: (reasoning: string) => void,
  onToolCalls?: (toolCalls: ToolCall[]) => void
): AbortController {
  const controller = new AbortController();

  if (!response.body) {
    console.warn('[streamChat] no response.body, returning early');
    return controller;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let fullReasoning = '';
  let accumulatedToolCalls: ToolCall[] = [];
  let modelName = '';
  let usageInfo: any = null;
  let finishReason = 'stop';
  let chunkId: string | undefined = undefined;
  let isSpeculative: boolean | undefined = undefined;
  let draftPackageId: string | null | undefined = undefined;
  let createdTimestamp: number | undefined = undefined;

  const readLoop = async () => {
    try {
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          let parsed: any = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            // skip malformed SSE JSON lines
            continue;
          }

          if (parsed?.error) {
            const errMsg = typeof parsed.error === 'string' ? parsed.error : parsed.error.message || 'Streaming generation error';
            throw new Error(errMsg);
          }

          if (parsed.id) chunkId = parsed.id;
          if (parsed.model) modelName = parsed.model;
          if (parsed.usage) usageInfo = parsed.usage;
          if (parsed.speculative !== undefined) isSpeculative = parsed.speculative;
          if (parsed.draft_package_id !== undefined) draftPackageId = parsed.draft_package_id;
          if (parsed.created) createdTimestamp = parsed.created;

          const choice = parsed?.choices?.[0];
          if (choice) {
            if (choice.finish_reason) finishReason = choice.finish_reason;

            // 1. Text delta
            const deltaContent = choice.delta?.content ?? choice.text;
            if (deltaContent) {
              fullText += deltaContent;
              onToken?.(deltaContent);
            }

            // 2. Reasoning delta (<think>)
            const deltaReasoning = choice.delta?.reasoning_content;
            if (deltaReasoning) {
              fullReasoning += deltaReasoning;
              onReasoning?.(deltaReasoning);
            }

            // 3. Tool calls delta
            const deltaTools = choice.delta?.tool_calls;
            if (deltaTools && Array.isArray(deltaTools)) {
              for (const dt of deltaTools) {
                const idx = dt.index ?? 0;
                if (!accumulatedToolCalls[idx]) {
                  accumulatedToolCalls[idx] = {
                    id: dt.id || `call_${idx}`,
                    type: dt.type || 'function',
                    function: {
                      name: dt.function?.name || '',
                      arguments: dt.function?.arguments || '',
                    },
                  };
                } else {
                  if (dt.id) accumulatedToolCalls[idx].id = dt.id;
                  if (dt.function?.name) accumulatedToolCalls[idx].function.name += dt.function.name;
                  if (dt.function?.arguments) accumulatedToolCalls[idx].function.arguments += dt.function.arguments;
                }
              }
              onToolCalls?.(accumulatedToolCalls);
            }
          }
        }
      }

      reader.releaseLock();

      onDone?.({
        content: fullText,
        reasoningContent: fullReasoning || undefined,
        toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
        finishReason,
        usage: usageInfo,
        model: modelName,
        id: chunkId,
        speculative: isSpeculative,
        draftPackageId,
        created: createdTimestamp,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      onError?.(err as Error);
      console.error('[streamChat] error:', err);
    }
  };

  readLoop();

  return controller;
}

export function streamTextCompletion(
  response: Response,
  onToken?: (token: string) => void,
  onDone?: (result: StreamingResult) => void,
  onError?: (err: Error) => void
): AbortController {
  return streamChat(response, onToken, onDone, onError);
}

export async function chatOnce(
  messages: Message[],
  opts?: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
    system_prompt?: string;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    tools?: any[];
  }
): Promise<{ content: string; reasoningContent?: string; toolCalls?: ToolCall[]; usage?: any }> {
  const res = await api.chat(messages, { ...opts, stream: false });
  const json = await res.json();
  const choice = json.choices?.[0];
  return {
    content: choice?.message?.content || '',
    reasoningContent: choice?.message?.reasoning_content,
    toolCalls: choice?.message?.tool_calls,
    usage: json.usage,
  };
}

export interface ImageStepEvent {
  type: 'step';
  step: number;
  total: number;
  width?: number;
  height?: number;
  b64_json?: string;
  previewUrl?: string;
}

export interface ImageDoneEvent {
  type: 'done';
  created?: number;
  model?: string;
  package_id?: string;
  data: Array<{
    b64_json?: string;
    url?: string;
    revised_prompt?: string;
    width?: number;
    height?: number;
  }>;
}

export function streamImage(
  opts: {
    prompt: string;
    model?: string;
    size?: string;
    n?: number;
    steps?: number;
    guidance?: number;
    negative_prompt?: string;
  },
  callbacks: {
    onStep?: (step: ImageStepEvent) => void;
    onDone?: (done: ImageDoneEvent) => void;
    onError?: (err: Error) => void;
  }
): AbortController {
  const controller = new AbortController();
  const BASE_URL = import.meta.env.VITE_API_URL || '';

  (async () => {
    try {
      const response = await fetch(`${BASE_URL}/v1/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          model: opts.model || 'image-standard',
          prompt: opts.prompt,
          size: opts.size || '1024x1024',
          n: opts.n || 1,
          steps: opts.steps ?? 4,
          guidance: opts.guidance ?? 0.0,
          negative_prompt: opts.negative_prompt,
          response_format: 'b64_json',
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errMessage = `Image generation failed (${response.status})`;
        try {
          const errJson = await response.json();
          errMessage = errJson.detail || errJson.error?.message || errMessage;
        } catch {}
        throw new Error(errMessage);
      }

      if (!response.body) {
        throw new Error('No response stream returned by server');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = 'message';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
            continue;
          }
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (!dataStr || dataStr === '[DONE]') continue;

          let parsed: any = null;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (parsed.type === 'error' || parsed.error) {
            const msg = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message || parsed.message || 'Image generation failed';
            throw new Error(msg);
          }

          if (parsed.type === 'step' || currentEvent === 'step') {
            const stepEvent: ImageStepEvent = {
              type: 'step',
              step: parsed.step,
              total: parsed.total,
              width: parsed.width,
              height: parsed.height,
              b64_json: parsed.b64_json,
              previewUrl: parsed.b64_json ? `data:image/jpeg;base64,${parsed.b64_json}` : undefined,
            };
            callbacks.onStep?.(stepEvent);
          } else if (parsed.type === 'done' || currentEvent === 'done') {
            callbacks.onDone?.(parsed as ImageDoneEvent);
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return controller;
}
