import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiZap, FiLoader, FiChevronDown, FiImage } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import ChatInput from '@/components/ChatInput';
import type { Message, ModelInfo, MessageContent } from '@/types';
import { streamChat } from '@/services/streaming';
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

function renderMessageContent(content: string | MessageContent[]): React.ReactNode {
  if (typeof content === 'string') {
    return content;
  }
  return (
    <>
      {content.map((part, idx) => {
        if (part.type === 'text') {
          return <span key={idx}>{part.text}</span>;
        }
        if (part.type === 'image_url') {
          return (
            <img
              key={idx}
              src={part.image_url.url}
              alt="attachment"
              className="chat-message-image"
              style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '6px', marginTop: '4px' }}
            />
          );
        }
        return null;
      })}
    </>
  );
}

function getTextContent(content: string | MessageContent[]): string {
  if (typeof content === 'string') return content;
  return content.filter(p => p.type === 'text').map(p => p.text).join('');
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
  
  const hasImageAttachments = state.messages.some(msg => 
    Array.isArray(msg.content) && msg.content.some(c => c.type === 'image_url')
  );
  
  const currentModelSupportsVision = state.models.some(m => 
    m.id === state.model && (m.modalities || []).some(mod => mod.toLowerCase().includes('vision') || mod.toLowerCase().includes('image'))
  );
  
  const visionModels = state.models.filter(m =>
    (m.modalities || []).some(mod => mod.toLowerCase().includes('vision') || mod.toLowerCase().includes('image'))
  );
  
  const chatModels = state.models.filter(m =>
    (m.modalities || []).some(mod => mod.toLowerCase().includes('chat')) ||
    (m.role || '').toLowerCase().includes('reasoning') ||
    (m.role || '').toLowerCase().includes('chat')
  );
  
  const modelOptions = hasImageAttachments && visionModels.length > 0
    ? visionModels
    : chatModels.length > 0
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

  const sendMessage = useCallback(async (content: string | MessageContent[]) => {
    // Check if content has images
    const hasImages = Array.isArray(content) && content.some(c => c.type === 'image_url');
    
    if (hasImages) {
      // Check if current model supports vision
      const currentModel = state.models.find(m => m.id === state.model);
      const currentModelSupportsVision = currentModel && (currentModel.modalities || []).some(mod => 
        mod.toLowerCase().includes('vision') || mod.toLowerCase().includes('image')
      );
      
      if (!currentModelSupportsVision) {
        // Try to auto-switch to a vision model
        const visionModel = state.models.find(m => 
          (m.modalities || []).some(mod => mod.toLowerCase().includes('vision') || mod.toLowerCase().includes('image'))
        );
        
        if (visionModel) {
          setModel(visionModel.id);
        } else {
          // Show error to user
          setMessages(prev => [...prev, { 
            role: 'assistant', 
            content: 'Error: Cannot send images - no vision-capable model is available. Please load a vision model first.' 
          }]);
          setIsStreaming(false);
          return;
        }
      }
    }
    
    const userMsg: Message = { role: 'user', content };
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

      streamChat(res,
        (token) => {
          setMessages(prev => {
            const u = [...prev];
            const idx = u.length - 1;
            if (u[idx]?.role === 'assistant') {
              u[idx] = { ...u[idx], content: u[idx].content + token };
            }
            return u;
          });
        },
        () => {
          setIsStreaming(false);
        },
        (err) => {
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
      );
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

  const handleSendFromInput = useCallback((content: string | MessageContent[]) => {
    sendMessage(content);
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
              const textContent = getTextContent(msg.content);
              return (
                <div key={i} className={`chat-message-row ${isUser ? 'right' : 'left'}`}>
                  <div className="chat-message-content ">
                    {isAssistant && !isLastAssistant ? (
                      <div
                        className="markdown-body"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(textContent) }}
                      />
                    ) : (
                      <div className={`chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-assistant'}`}>
                        <div className="chat-bubble-name">
                          {isUser ? "Me" : "Assistant"}
                          <span className="chat-message-time-text">
                          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        </div>
                        <div className="chat-bubble-content">
                          {isAssistant && isLastAssistant ? (
                            <>  {/* Streaming: raw text + cursor, no markdown re-render */}
                              <pre className="chat-streaming-text">{textContent}</pre>
                              <span className="chat-cursor">▌</span>
                            </>
                          ) : (
                            <>  {/* User message or completed assistant: render images only */}
                              {renderMessageContent(msg.content)}
                            </>
                          )}
                        </div>
                      </div>
                    )}
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
            <div className="chat-model-wrapper">
              <button
                onClick={() => setShowModelSelect(!showModelSelect)}
                className={`chat-model-btn ${showModelSelect ? 'active' : ''}`}
              >
                <span className="chat-model-text">{state.model}</span>
                <FiChevronDown size={10} />
              </button>
              {hasImageAttachments && !currentModelSupportsVision && (
                <span className="chat-model-warning" title="Current model doesn't support images">
                  <FiImage size={10} /> Vision required
                </span>
              )}
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
            </div>
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

<style>{`
        @keyframes blink { 50% { opacity: 0; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .chat-message-image { max-width: 100%; max-height: 300px; border-radius: 6px; margin-top: 4px; display: block; }
        .chat-bubble { display: flex; flex-direction: column; gap: 4px; }
        .chat-bubble-content { white-space: pre-wrap; word-wrap: break-word; overflow-wrap: anywhere; }
        .chat-streaming-text { margin: 0; font-family: inherit; font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: anywhere; max-width: 100%; }
        .chat-model-wrapper { position: relative; display: flex; align-items: center; gap: 6px; }
        .chat-model-warning { display: flex; align-items: center; gap: 4px; padding: 2px 8px; background: rgba(248, 81, 73, 0.15); border: 1px solid rgba(248, 81, 73, 0.3); border-radius: 4px; color: #f85149; font-size: 10px; font-weight: 500; }
      `}</style>
    </div>
  );
}
