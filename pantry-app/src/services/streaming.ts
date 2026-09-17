import api from './api';
import type { Message } from '@/types';

export interface StreamingResult {
  content: string;
  finishReason: string;
  usage?: any;
  model: string;
}

export function streamChat(
  response: Response,
  onToken?: (token: string) => void,
  onDone?: (result: StreamingResult) => void,
  onError?: (err: Error) => void,
  onStatus?: (status: string) => void
): AbortController {
  const controller = new AbortController();

  if (!response.body) { console.warn('[streamChat] no response.body, returning early'); return controller; }

  console.log('[streamChat] starting stream, status:', (response as any).status);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  const readLoop = async () => {
    try {
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data) as any;
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              console.log('[streamChat] token:', JSON.stringify(delta));
              onToken?.(delta);
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      reader.releaseLock();

      if (buffer.trim()) {
        if (buffer.startsWith('data: ')) {
          const data = buffer.slice(6);
          if (data !== '[DONE]') {
            try {
              const parsed = JSON.parse(data) as any;
              const delta = parsed?.choices?.[0]?.delta?.content;
              if (delta) {
                fullText += delta;
                onToken?.(delta);
              }
            } catch {
              // skip malformed lines
            }
          }
        }
      }

      console.log('[streamChat] done, fullText length:', fullText.length);
      onDone?.({
        content: fullText,
        finishReason: 'stop',
        model: '',
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
  }
): Promise<{ content: string; usage?: any }> {
  const res = await api.chat(messages, { ...opts, stream: false });
  const json = await res.json();
  return {
    content: json.choices?.[0]?.message?.content || '',
    usage: json.usage,
  };
}
