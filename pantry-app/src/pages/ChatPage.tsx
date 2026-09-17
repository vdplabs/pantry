import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiZap, FiLoader, FiChevronDown } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import ChatInput from '@/components/ChatInput';
import type { Message, ModelInfo } from '@/types';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';

const renderer = new marked.Renderer();
renderer.code = ({ text, lang }: { text: string; lang?: string; escaped?: boolean }) => {
  const highlighted =
    lang && hljs.getLanguage(lang)
      ? hljs.highlight(text, { language: lang }).value
      : hljs.highlightAuto(text).value;
  return `<pre><code class="hljs language-${lang || "text"}">${highlighted}</code></pre>`;
};

marked.setOptions({ renderer, gfm: true, breaks: true });

// function MessageContent({ content }: { content: string }) {
//   return (
//     <div
//       className="markdown-body"
//       dangerouslySetInnerHTML={{ __html: marked.parse(content) }}
//     />
//   );
// }

// marked.setOptions({ renderer, breaks: true });

function renderMarkdown(text: string): string {
  return marked.parse(text) as string;
}

const quickPrompts = [
  'Explain what you can do.',
  'Write a haiku about coding.',
  'Explain quantum computing simply.',
  'Write a Python function to sort a list.',
  'What is LoRA adapters in LLM?',
  'What is speculative decoding?',
];

export default function ChatPage() {
  const { state, setMessages, setIsStreaming, setModel } = useApp();
  const [showSettings, setShowSettings] = useState(false);
  const [showSpeculative, setShowSpeculative] = useState(false);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const chatModels = state.models.filter(m =>
    (m.modalities || []).some(mod => mod.toLowerCase().includes('chat')) ||
    (m.role || '').toLowerCase().includes('reasoning') ||
    (m.role || '').toLowerCase().includes('chat')
  );
  const modelOptions = chatModels.length > 0
    ? chatModels
    : state.models.length > 0
      ? state.models
      : [{ id: state.model } as ModelInfo];

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [state.messages, state.isStreaming]);

  const sendMessage = useCallback(async (text: string) => {
    const userMsg: Message = { role: 'user', content: text };
    setIsStreaming(true);

    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '' }]);

    const currentMessages = [...state.messages, userMsg];

    try {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: state.model,
          messages: currentMessages,
          temperature: state.temperature,
          max_tokens: state.maxTokens,
          stream: true,
          system_prompt: state.systemPrompt,
          top_p: state.topP,
          prefer_speculative: state.preferSpeculative,
          adapters: state.adapters.length ? state.adapters : undefined,
          adapter: state.selectedAdapter || undefined,
          draft_model: state.draftModel || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.error?.message || `Request failed (${res.status})`);
      }

      if (res.body) {
        const text = await res.text();
        const lines = text.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (delta) {
              setMessages(prev => {
                const u = [...prev];
                const idx = u.length - 1;
                if (u[idx]?.role === 'assistant') {
                  u[idx] = { ...u[idx], content: u[idx].content + delta };
                }
                return u;
              });
            }
          } catch { }
        }
      } else {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '';
        setMessages(prev => { const u = [...prev]; const i = u.length - 1; if (u[i]?.role === 'assistant') u[i] = { ...u[i], content }; return u; });
      }
      setIsStreaming(false);
    } catch (err) {
      setIsStreaming(false);
      setMessages(prev => {
        const u = [...prev];
        const i = u.length - 1;
        if (u[i]?.role === 'assistant') {
          u[i] = { ...u[i], content: `Error: ${String(err).split('\n')[0]}` };
        } else {
          u.push({ role: 'assistant', content: `Error: ${String(err).split('\n')[0]}` });
        }
        return u;
      });
    }
  }, [state.messages, state.model, state.temperature, state.maxTokens, state.systemPrompt, state.topP, state.preferSpeculative, state.adapters, state.selectedAdapter, state.draftModel]);

  const handleSendFromInput = useCallback((text: string) => {
    sendMessage(text);
  }, [sendMessage]);

  return (
    <div className="chat-page">
      {/* Messages area */}
      <div className="chat-messages">
        <div className="chat-messages-inner">
          {state.messages.length === 0 && (
            <>
              <div className="chat-welcome">
                <div className="chat-welcome-icon">🏠</div>
                <h1 className="chat-welcome-title">
                  What can Pantry do for you?
                </h1>
                <p className="chat-welcome-text">
                  Local AI model hosting with capability resolution and CAS storage.
                </p>
              </div>
              <div className="chat-quick-prompts">
                {quickPrompts.map(p => (
                  <button
                    key={p}
                    onClick={() => sendMessage(p)}
                    disabled={state.isStreaming}
                    className={`chat-quick-btn ${state.isStreaming ? 'disabled' : ''}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="chat-messages-list">
            {state.messages.map((msg, i) => {
              const isUser = msg.role === 'user';
              const isLastAssistant = i === state.messages.length - 1 && state.isStreaming;
              const isAssistant = msg.role === 'assistant';
              return (
                <div key={i} className={`chat-message-row ${isUser ? 'right' : 'left'}`}>
                  <div className="chat-message-content ">
                    {isAssistant && !isLastAssistant ? (


                      <div
                        className="markdown-body"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                      />
                    ) : (
                      <div className={`chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-assistant'}`}>
                        <div className="chat-bubble-name">
                          {isUser ? "Me" : "Assistant"}
                          <span className="chat-message-time-text">
                          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        </div>
                        {isUser ? msg.content : <>{msg.content}<span className="chat-cursor">▌</span></>}
                      </div>
                    )}
                    {/* {isUser && (
                      <div className="chat-message-time">
                        <span className="chat-message-time-text">
                          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    )} */}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} className="chat-message-end" />
          </div>
        </div>
      </div>

      {/* Composer */}
      <div className="chat-composer">
        <div className="chat-composer-inner">
          {/* Meta row */}
          <div className="chat-composer-row">
            <button
              onClick={() => setShowSpeculative(!showSpeculative)}
              className={`chat-spec-btn ${showSpeculative ? 'active' : ''}`}
            >
              <FiZap size={10} /> Speculative
            </button>
            <button
              onClick={() => setShowModelSelect(!showModelSelect)}
              className={`chat-model-btn ${showModelSelect ? 'active' : ''}`}
            >
              <span className="chat-model-text">{state.model}</span>
              <FiChevronDown size={10} />
            </button>
            {showModelSelect && modelOptions.length > 0 && (
              <div className="chat-model-dropdown">
                {modelOptions.map(m => (
                  <button
                    key={m.id}
                    onClick={() => { setModel(m.id); setShowModelSelect(false); }}
                    className={`chat-model-dropdown-btn ${state.model === m.id ? 'active' : ''}`}
                  >
                    {m.id}{m.alias ? ` (${m.alias})` : ''}
                  </button>
                ))}
              </div>
            )}
            {state.isStreaming && (
              <span className="chat-streaming-label">
                <FiLoader size={11} className="chat-spinner" /> Generating…
              </span>
            )}
            <div className="chat-spacer" />
          </div>

          {/* Settings panel */}
          {showSettings && (
            <div className="chat-settings-panel">
              <div className="chat-settings-group">
                <label className="chat-settings-label">System Prompt</label>
                <input
                  value={state.systemPrompt}
                  onChange={(e) => { /* state setSystemPrompt handled externally */ }}
                  className="chat-settings-input"
                />
              </div>
              <div className="chat-settings-group">
                <label className="chat-settings-label">Temperature ({state.temperature})</label>
                <input
                  type="range" min="0" max="1.5" step="0.05" value={state.temperature}
                  onChange={(e) => { /* state setTemperature handled externally */ }}
                  className="chat-settings-input"
                />
              </div>
              <div className="chat-settings-group">
                <label className="chat-settings-label">Max Tokens ({state.maxTokens})</label>
                <input
                  type="range" min="16" max="4096" step="16" value={state.maxTokens}
                  onChange={(e) => { /* state setMaxTokens handled externally */ }}
                  className="chat-settings-input"
                />
              </div>
            </div>
          )}

          <ChatInput onSend={handleSendFromInput} disabled={state.isStreaming} autoFocus />
        </div>
      </div>

      <style>{`@keyframes blink { 50% { opacity: 0; } } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
