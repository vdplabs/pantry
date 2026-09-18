import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FiZap, FiChevronDown, FiSettings, FiLayers, FiCpu,
  FiMessageSquare, FiSliders, FiArrowDown, FiTerminal, FiCode, FiCompass
} from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import ChatInput from '@/components/ChatInput';
import ChatMessage from '@/components/ChatMessage';
import type { Message, ModelInfo, MessageContent, ToolCall } from '@/types';
import { streamChat } from '@/services/streaming';
import api from '@/services/api';

const SYSTEM_PROMPTS = [
  { id: 'default', label: 'Default Assistant', prompt: 'You are a helpful, accurate, and concise AI assistant.' },
  { id: 'coder', label: 'Expert Software Engineer', prompt: 'You are an expert senior software engineer. Provide production-ready, clean, well-commented code solutions with architectural insights.' },
  { id: 'concise', label: 'Concise Terminal Expert', prompt: 'Answer directly, accurately, and without unnecessary preamble. Output shell commands and code succinctly.' },
  { id: 'analyst', label: 'Research & Data Analyst', prompt: 'Analyze problems methodically with step-by-step reasoning, tradeoffs, and structured summaries.' },
];

const PROMPT_SUGGESTIONS = [
  { title: 'Write a Python script', desc: 'Implement an asynchronous rate limiter with Redis or in-memory token bucket' },
  { title: 'Explain a technical concept', desc: 'How does speculative decoding and prefix caching speed up LLM inference?' },
  { title: 'Refactor code', desc: 'Analyze complexity and modernize legacy code with idiomatic patterns' },
  { title: 'Draft an architectural design', desc: 'Design an OpenAI-compatible edge inference server for local neural models' },
];

export default function ChatPage() {
  const { state, setMessages, setIsStreaming, setModel, setSystemPrompt, activeConversationId } = useApp();
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showSystemPromptDrawer, setShowSystemPromptDrawer] = useState(false);
  const [activePromptId, setActivePromptId] = useState('default');
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);

  const chatModels = state.models.filter(m =>
    (m.modalities || []).some(mod => mod.toLowerCase().includes('text') || mod.toLowerCase().includes('chat')) ||
    (m.role || '').toLowerCase().includes('chat') ||
    (m.role || '').toLowerCase().includes('reasoning')
  );

  const currentModel = state.models.find(m => m.id === state.model || (m.aliases || []).includes(state.model)) || state.models[0];

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight <= 80;
    const hasScrolledUp = !isAtBottom;
    userScrolledUpRef.current = hasScrolledUp;
    setUserScrolledUp(hasScrolledUp);
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    if (!scrollContainerRef.current) return;
    userScrolledUpRef.current = false;
    setUserScrolledUp(false);
    if (smooth) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    } else {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, []);

  // On conversation switch or initial load, jump to bottom
  useEffect(() => {
    if (activeConversationId) {
      userScrolledUpRef.current = false;
      setUserScrolledUp(false);
      setTimeout(() => scrollToBottom(false), 50);
    }
  }, [activeConversationId, scrollToBottom]);

  const handleSelectSystemPrompt = (preset: typeof SYSTEM_PROMPTS[0]) => {
    setActivePromptId(preset.id);
    setSystemPrompt(preset.prompt);
  };

  const sendMessage = useCallback(async (content: string | MessageContent[]) => {
    const userMsg: Message = { role: 'user', content };
    
    // Add user message and empty assistant placeholder
    setMessages(prev => [
      ...prev,
      userMsg,
      { role: 'assistant', content: '', reasoning_content: '' }
    ]);
    
    userScrolledUpRef.current = false;
    setUserScrolledUp(false);
    setTimeout(() => scrollToBottom(false), 10);

    setIsStreaming(true);
    const t0 = performance.now();
    let tokenCount = 0;

    const messagesPayload = [...state.messages, userMsg];

    try {
      const res = await api.chat(messagesPayload, {
        model: state.model || 'chat-compact',
        temperature: state.temperature ?? 0.7,
        max_tokens: state.maxTokens ?? 1024,
        top_p: state.topP ?? 1.0,
        stream: true,
        system_prompt: state.systemPrompt || undefined,
        prefer_speculative: state.preferSpeculative,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.error?.message || `API error (${res.status})`);
      }

      let currentStreamContent = '';
      let currentReasoning = '';
      let currentTools: ToolCall[] = [];

      const controller = streamChat(
        res,
        (token) => {
          tokenCount++;
          currentStreamContent += token;
          setMessages(prev => {
            const copy = [...prev];
            const idx = copy.length - 1;
            if (copy[idx]?.role === 'assistant') {
              copy[idx] = {
                ...copy[idx],
                content: currentStreamContent,
                reasoning_content: currentReasoning || undefined,
                tool_calls: currentTools.length > 0 ? currentTools : undefined,
              };
            }
            return copy;
          });

          // Only auto-scroll if the user hasn't scrolled up to read previous messages
          if (!userScrolledUpRef.current && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
          }
        },
        (result) => {
          const duration_s = Math.max(0.01, (performance.now() - t0) / 1000);
          const tps = tokenCount > 0 ? tokenCount / duration_s : undefined;

          setIsStreaming(false);
          setMessages(prev => {
            const copy = [...prev];
            const idx = copy.length - 1;
            if (copy[idx]?.role === 'assistant') {
              copy[idx] = {
                ...copy[idx],
                content: result.content || currentStreamContent,
                reasoning_content: result.reasoningContent || currentReasoning || undefined,
                tool_calls: result.toolCalls || (currentTools.length > 0 ? currentTools : undefined),
                token_stats: {
                  tps,
                  duration_s,
                  total_tokens: tokenCount,
                },
              };
            }
            return copy;
          });

          if (!userScrolledUpRef.current && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
          }
        },
        (err) => {
          setIsStreaming(false);
          setMessages(prev => {
            const copy = [...prev];
            const idx = copy.length - 1;
            if (copy[idx]?.role === 'assistant') {
              copy[idx] = {
                ...copy[idx],
                content: `⚠️ Error: ${err.message || String(err)}`,
              };
            }
            return copy;
          });
        },
        (reasoningChunk) => {
          currentReasoning += reasoningChunk;
          setMessages(prev => {
            const copy = [...prev];
            const idx = copy.length - 1;
            if (copy[idx]?.role === 'assistant') {
              copy[idx] = {
                ...copy[idx],
                reasoning_content: currentReasoning,
              };
            }
            return copy;
          });

          if (!userScrolledUpRef.current && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
          }
        },
        (tools) => {
          currentTools = tools;
          setMessages(prev => {
            const copy = [...prev];
            const idx = copy.length - 1;
            if (copy[idx]?.role === 'assistant') {
              copy[idx] = {
                ...copy[idx],
                tool_calls: currentTools,
              };
            }
            return copy;
          });
        }
      );

      streamAbortRef.current = controller;
    } catch (err: any) {
      setIsStreaming(false);
      setMessages(prev => {
        const copy = [...prev];
        const idx = copy.length - 1;
        if (copy[idx]?.role === 'assistant') {
          copy[idx] = {
            ...copy[idx],
            content: `⚠️ Connection Error: ${err.message || String(err)}`,
          };
        }
        return copy;
      });
    }
  }, [state.messages, state.model, state.temperature, state.maxTokens, state.topP, state.systemPrompt, state.preferSpeculative, setMessages, setIsStreaming, scrollToBottom]);

  const handleRetry = () => {
    if (state.messages.length < 2) return;
    const lastUserMsg = [...state.messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
      // Remove last assistant message
      setMessages(prev => {
        const copy = [...prev];
        if (copy[copy.length - 1]?.role === 'assistant') copy.pop();
        return copy;
      });
      sendMessage(lastUserMsg.content);
    }
  };

  return (
    <div className="chat-page-container">
      {/* Top Header Controls */}
      <div className="chat-header-bar">
        <div style={{ position: 'relative' }}>
          <button
            className="chat-model-selector-btn"
            onClick={() => setShowModelDropdown(!showModelDropdown)}
          >
            <span className="model-ready-dot" />
            <span>{currentModel?.id || state.model || 'Select Model'}</span>
            {currentModel?.quality_tier && (
              <span className="spec-badge">{currentModel.quality_tier}</span>
            )}
            <FiChevronDown size={14} />
          </button>

          {showModelDropdown && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: '6px',
                width: '320px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-card)',
                zIndex: 50,
                padding: '6px',
                maxHeight: '340px',
                overflowY: 'auto',
              }}
            >
              <div style={{ padding: '6px 8px', fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                Available Chat Models
              </div>
              {chatModels.map(m => (
                <div
                  key={m.id}
                  onClick={() => { setModel(m.id); setShowModelDropdown(false); }}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    background: (m.id === state.model || (m.aliases || []).includes(state.model)) ? 'var(--bg-card-hover)' : 'transparent',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-title)' }}>{m.id}</span>
                    <span className="spec-badge">{m.quality_tier || 'standard'}</span>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                    Context: {m.context_max || 4096} tokens • Family: {m.family || 'general'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="chat-header-controls">
          <button
            className={`chat-control-pill ${showSystemPromptDrawer ? 'active' : ''}`}
            onClick={() => setShowSystemPromptDrawer(!showSystemPromptDrawer)}
            title="System Persona & Instructions"
          >
            <FiSliders size={13} />
            <span>Persona</span>
          </button>

          {state.preferSpeculative && (
            <span className="chat-control-pill active" title="Speculative Decoding Enabled">
              ⚡ Speculative
            </span>
          )}
        </div>
      </div>

      {/* System Prompt Persona Drawer */}
      {showSystemPromptDrawer && (
        <div style={{ padding: '14px 20px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-card)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-title)' }}>System Persona & Instructions</span>
            <button onClick={() => setShowSystemPromptDrawer(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '12px' }}>Done</button>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {SYSTEM_PROMPTS.map(preset => (
              <button
                key={preset.id}
                onClick={() => handleSelectSystemPrompt(preset)}
                className={`chat-control-pill ${activePromptId === preset.id ? 'active' : ''}`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            value={state.systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            placeholder="Custom system instructions..."
            className="gen-textarea"
            style={{ fontSize: '12px' }}
          />
        </div>
      )}

      {/* Messages Scroll Area with Smooth, Non-Interfering Scroll */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="chat-messages-scroll"
      >
        {state.messages.length === 0 ? (
          <div className="chat-empty-state">
            <div className="empty-logo-glow">
              <FiZap size={32} />
            </div>
            <h1 className="empty-title">What would you like to explore?</h1>
            <p className="empty-sub">
              Running locally on Apple Silicon / MLX with Pantry. Full OpenAI API compatibility with real tool calling, reasoning models, and instant low latency.
            </p>

            <div className="prompt-suggestions-grid">
              {PROMPT_SUGGESTIONS.map((item, idx) => (
                <button
                  key={idx}
                  className="prompt-suggestion-card"
                  onClick={() => sendMessage(item.desc)}
                >
                  <strong style={{ color: 'var(--text-title)', marginBottom: '4px' }}>{item.title}</strong>
                  <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{item.desc}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          state.messages.map((msg, idx) => (
            <ChatMessage
              key={idx}
              message={msg}
              isStreaming={state.isStreaming && idx === state.messages.length - 1}
              onRetry={idx === state.messages.length - 1 ? handleRetry : undefined}
            />
          ))
        )}
      </div>

      {/* Floating Jump to Bottom Button */}
      {userScrolledUp && state.messages.length > 0 && (
        <button
          className="chat-jump-bottom-btn"
          onClick={() => scrollToBottom(true)}
        >
          <FiArrowDown size={14} />
          <span>Latest message</span>
        </button>
      )}

      {/* Composer Input Bar */}
      <ChatInput
        onSend={sendMessage}
        disabled={state.isStreaming}
        autoFocus
      />
    </div>
  );
}

