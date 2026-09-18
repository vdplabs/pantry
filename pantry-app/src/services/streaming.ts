import api from './api';
import type { Message, ToolCall } from '@/types';

export interface StreamingResult {
  content: string;
  reasoningContent?: string;
  toolCalls?: ToolCall[];
  finishReason: string;
  usage?: any;
  model: string;
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

          try {
            const parsed = JSON.parse(data);
            if (parsed.model) modelName = parsed.model;
            if (parsed.usage) usageInfo = parsed.usage;

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
          } catch {
            // skip malformed SSE JSON lines
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
