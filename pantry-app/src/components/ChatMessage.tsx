import React, { useState, useMemo } from 'react';
import { FiCopy, FiCheck, FiChevronDown, FiChevronUp, FiCpu, FiTerminal, FiZap, FiUser, FiRefreshCw } from 'react-icons/fi';
import type { Message, MessageContent, ToolCall } from '@/types';
import { marked } from 'marked';
import hljs from 'highlight.js';

interface Props {
  message: Message;
  isStreaming?: boolean;
  onRetry?: () => void;
}

const renderer = new marked.Renderer();
renderer.code = ({ text, lang }: { text: string; lang?: string; escaped?: boolean }) => {
  const cleanLang = (lang || '').trim().toLowerCase();
  const validLang = cleanLang && hljs.getLanguage(cleanLang) ? cleanLang : null;
  const displayLang = cleanLang || 'code';
  let highlighted = '';
  try {
    if (validLang) {
      highlighted = hljs.highlight(text, { language: validLang, ignoreIllegals: true }).value;
    } else {
      const autoRes = hljs.highlightAuto(text);
      highlighted = autoRes.value || text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  } catch {
    highlighted = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${displayLang}</span><button class="code-copy-btn" onclick="(function(btn){navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(text)}')).then(function(){btn.innerHTML='<svg width=\\'12\\' height=\\'12\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2.5\\'><polyline points=\\'20 6 9 17 4 12\\'/></svg> Copied';setTimeout(function(){btn.innerHTML='<svg width=\\'12\\' height=\\'12\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\'><rect x=\\'9\\' y=\\'9\\' width=\\'13\\' height=\\'13\\' rx=\\'2\\' ry=\\'2\\'/><path d=\\'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1\\'/></svg> Copy';},2000);});})(this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button></div><pre><code class="hljs language-${validLang || 'plaintext'}">${highlighted}</code></pre></div>`;
};

marked.setOptions({ renderer, gfm: true, breaks: true });

function parseThinking(text: string): { thinking: string; response: string } | null {
  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i);
  const reasoningMatch = text.match(/<reasoning>([\s\S]*?)<\/reasoning>/i);
  const thinking = thinkMatch?.[1] || reasoningMatch?.[1];
  if (!thinking) return null;
  const response = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .trim();
  return { thinking: thinking.trim(), response };
}

function ChatMessageComponent({ message, isStreaming, onRetry }: Props) {
  const [copied, setCopied] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(true);

  const isUser = message.role === 'user';
  const isSystem = message.role === 'system' || message.role === 'developer';
  const isTool = message.role === 'tool';

  let rawText = '';
  let images: string[] = [];

  if (typeof message.content === 'string') {
    rawText = message.content;
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text') rawText += part.text;
      if (part.type === 'image_url') images.push(part.image_url.url);
    }
  }

  // Check reasoning content
  const parsedThinking = useMemo(() => parseThinking(rawText), [rawText]);
  const reasoningText = message.reasoning_content || parsedThinking?.thinking;
  const mainText = parsedThinking ? parsedThinking.response : rawText;

  const parsedHtml = useMemo(() => {
    if (!mainText) return '';
    try {
      return marked.parse(mainText) as string;
    } catch {
      return mainText;
    }
  }, [mainText]);

  const handleCopy = () => {
    navigator.clipboard.writeText(mainText || rawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`chat-message-row ${message.role}`}>
      <div className={`chat-avatar ${message.role}`}>
        {isUser ? <FiUser size={15} /> : isSystem ? <FiTerminal size={15} /> : isTool ? <FiCpu size={15} /> : <FiZap size={15} />}
      </div>

      <div className="chat-message-body">
        <div className="chat-message-header">
          <span className="chat-sender-name">
            {isUser ? 'You' : isSystem ? 'System Prompt' : isTool ? 'Tool Result' : 'Pantry Assistant'}
          </span>
          {message.token_stats?.tps && (
            <span className="chat-tps-badge">
              ⚡ {message.token_stats.tps.toFixed(1)} tok/s
            </span>
          )}
        </div>

        {/* Reasoning / Thinking Accordion */}
        {reasoningText && (
          <div className="chat-thinking-accordion">
            <button
              className="chat-thinking-header"
              onClick={() => setThinkingOpen(!thinkingOpen)}
            >
              <div className="thinking-indicator">
                <span className={`thinking-dot ${isStreaming && !mainText ? 'pulse' : ''}`} />
                <span>Thought Process</span>
              </div>
              {thinkingOpen ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
            </button>
            {thinkingOpen && (
              <div className="chat-thinking-body">
                {reasoningText}
              </div>
            )}
          </div>
        )}

        {/* Tool Calls */}
        {message.tool_calls && message.tool_calls.length > 0 && (
          <div className="chat-tool-calls-container">
            <button
              className="chat-tool-header"
              onClick={() => setToolsOpen(!toolsOpen)}
            >
              <div className="tool-indicator">
                <FiCpu size={13} />
                <span>Tool Execution ({message.tool_calls.length})</span>
              </div>
              {toolsOpen ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
            </button>
            {toolsOpen && (
              <div className="chat-tool-body">
                {message.tool_calls.map((tc, idx) => (
                  <div key={tc.id || idx} className="tool-call-item">
                    <div className="tool-call-name">
                      <code>{tc.function.name}</code>
                    </div>
                    <pre className="tool-call-args">
                      {tc.function.arguments}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Image Attachments */}
        {images.length > 0 && (
          <div className="chat-image-attachments">
            {images.map((img, idx) => (
              <img
                key={idx}
                src={img}
                alt="Attachment"
                className="chat-attachment-img"
                onClick={() => window.open(img, '_blank')}
              />
            ))}
          </div>
        )}

        {/* Main Message Content */}
        {parsedHtml ? (
          <div className="chat-markdown-content-wrapper">
            <div
              className="chat-markdown-content"
              dangerouslySetInnerHTML={{ __html: parsedHtml }}
            />
            {isStreaming && <span className="chat-streaming-cursor">▌</span>}
          </div>
        ) : isStreaming && !reasoningText && !message.tool_calls?.length ? (
          <div className="streaming-status-pill">
            <span className="pulsing-indicator-dot" />
            <span>Thinking & generating response...</span>
          </div>
        ) : null}

        {/* Actions & Metadata Toolbar */}
        {!isUser && mainText && (
          <div className="chat-message-actions">
            <button onClick={handleCopy} className="chat-action-btn" title="Copy response">
              {copied ? <FiCheck size={12} className="copied" /> : <FiCopy size={12} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            {onRetry && (
              <button onClick={onRetry} className="chat-action-btn" title="Retry generation">
                <FiRefreshCw size={12} />
                <span>Retry</span>
              </button>
            )}

            {/* Response Metadata Badges */}
            {(message.token_stats || message.meta || message.model) && (
              <div className="chat-meta-group">
                {message.token_stats?.tps && (
                  <span className="chat-meta-pill highlight" title="Generation Speed">
                    ⚡ {message.token_stats.tps.toFixed(1)} tok/s
                  </span>
                )}
                {message.token_stats?.duration_s !== undefined && (
                  <span className="chat-meta-pill" title="Inference Latency">
                    ⏱ {message.token_stats.duration_s < 1
                      ? `${Math.round(message.token_stats.duration_s * 1000)}ms`
                      : `${message.token_stats.duration_s.toFixed(2)}s`}
                  </span>
                )}
                {message.token_stats?.completion_tokens !== undefined && (
                  <span
                    className="chat-meta-pill"
                    title={
                      message.token_stats.prompt_tokens
                        ? `${message.token_stats.prompt_tokens} input + ${message.token_stats.completion_tokens} output = ${message.token_stats.total_tokens || (message.token_stats.prompt_tokens + message.token_stats.completion_tokens)} total tokens`
                        : `${message.token_stats.completion_tokens} tokens`
                    }
                  >
                    🔤 {message.token_stats.prompt_tokens
                      ? `${message.token_stats.prompt_tokens} ↑ · ${message.token_stats.completion_tokens} ↓`
                      : `${message.token_stats.completion_tokens} tok`}
                  </span>
                )}
                {message.token_stats?.cached_tokens && message.token_stats.cached_tokens > 0 ? (
                  <span className="chat-meta-pill cache" title={`${message.token_stats.cached_tokens} prompt tokens served from prefix cache`}>
                    🎯 {message.token_stats.cached_tokens} cached
                  </span>
                ) : null}
                {message.meta?.speculative ? (
                  <span
                    className="chat-meta-pill speculative"
                    title={`Speculative decoding active${message.meta.draft_package_id ? ` (draft: ${message.meta.draft_package_id})` : ''}`}
                  >
                    🚀 Speculative
                  </span>
                ) : null}
                {(message.meta?.model || message.model) && (
                  <span
                    className="chat-meta-pill"
                    title={`Model: ${message.meta?.model || message.model}${message.meta?.id ? ` (${message.meta.id})` : ''}`}
                  >
                    🤖 {message.meta?.model || message.model}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const ChatMessage = React.memo(ChatMessageComponent, (prev, next) => {
  return (
    prev.message === next.message &&
    prev.isStreaming === next.isStreaming &&
    prev.onRetry === next.onRetry
  );
});

export default ChatMessage;
