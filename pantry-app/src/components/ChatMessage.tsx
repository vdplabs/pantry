import React, { useState, useMemo } from 'react';
import { FiCopy, FiCheck, FiChevronDown, FiChevronUp, FiCpu, FiTerminal, FiZap, FiUser, FiRefreshCw, FiPlay, FiX, FiDownload, FiMaximize2, FiFileText } from 'react-icons/fi';
import type { Message, MessageContent, ToolCall } from '@/types';
import { marked } from 'marked';
import hljs from 'highlight.js';

import ArtifactBlock from './artifacts/ArtifactBlock';

interface Props {
  message: Message;
  isStreaming?: boolean;
  onRetry?: () => void;
  onContinue?: () => void;
  onOpenCanvas?: (code: string, type: string) => void;
}

interface ContentBlock {
  id: string;
  type: 'markdown' | 'code';
  content: string;
  language?: string;
  isClosed?: boolean;
}

interface AttachedDoc {
  name: string;
  meta: string;
  content: string;
}

function parseUserDocuments(text: string): { docs: AttachedDoc[]; promptText: string } {
  if (!text) return { docs: [], promptText: '' };
  const docs: AttachedDoc[] = [];
  
  // Match [Attached Document: ...]--- Begin Document Content --- ... --- End Document Content ---
  const docRegex = /\[Attached Document:\s*([^\n\]]+)\]\s*\n--- Begin Document Content ---\n([\s\S]*?)\n--- End Document Content ---/g;
  let match: RegExpExecArray | null;
  let cleaned = text;

  while ((match = docRegex.exec(text)) !== null) {
    const fullMatch = match[0];
    const rawHeader = match[1];
    const docContent = match[2];

    const nameMatch = rawHeader.match(/^(.*?)(?:\s*\((.*?)\))?$/);
    const name = nameMatch ? nameMatch[1].trim() : rawHeader.trim();
    const meta = nameMatch && nameMatch[2] ? nameMatch[2].trim() : '';

    docs.push({ name, meta, content: docContent });
    cleaned = cleaned.replace(fullMatch, '').trim();
  }

  return { docs, promptText: cleaned };
}

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const cleanLang = (lang || '').trim().toLowerCase();
      const validLang = cleanLang && hljs.getLanguage(cleanLang) ? cleanLang : null;
      let highlighted = '';
      try {
        if (validLang) {
          highlighted = hljs.highlight(text, { language: validLang, ignoreIllegals: true }).value;
        } else {
          highlighted = hljs.highlightAuto(text).value || text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
      } catch {
        highlighted = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${cleanLang || 'code'}</span></div><pre><code class="hljs language-${validLang || 'plaintext'}">${highlighted}</code></pre></div>`;
    }
  }
});

function parseMarkdownBlocks(text: string, isStreaming = false): ContentBlock[] {
  if (!text) return [];
  const blocks: ContentBlock[] = [];
  const regex = /```([a-zA-Z0-9_#+.-]*)[^\n\r]*[\r\n]+([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let blockIdx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const chunk = text.slice(lastIndex, match.index);
      if (chunk) {
        blocks.push({
          id: `md-${blockIdx++}`,
          type: 'markdown',
          content: chunk,
        });
      }
    }
    blocks.push({
      id: `code-${blockIdx++}`,
      type: 'code',
      language: (match[1] || '').trim().toLowerCase(),
      content: match[2] || '',
      isClosed: true,
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    const openCodeMatch = remaining.match(/```([a-zA-Z0-9_#+.-]*)[^\n\r]*[\r\n]+([\s\S]*)$/);
    if (openCodeMatch && openCodeMatch.index !== undefined) {
      const pre = remaining.slice(0, openCodeMatch.index);
      if (pre) {
        blocks.push({ id: `md-${blockIdx++}`, type: 'markdown', content: pre });
      }
      blocks.push({
        id: `code-${blockIdx++}`,
        type: 'code',
        language: (openCodeMatch[1] || '').trim().toLowerCase(),
        content: openCodeMatch[2] || '',
        isClosed: !isStreaming,
      });
    } else {
      blocks.push({ id: `md-${blockIdx++}`, type: 'markdown', content: remaining });
    }
  }

  if (blocks.length === 0 && text) {
    blocks.push({ id: 'md-0', type: 'markdown', content: text });
  }

  return blocks;
}

function parseThinking(text: string): { thinking: string; response: string } | null {
  if (!text) return null;
  // 1. Check for closed <think> or <reasoning>
  const thinkClosed = text.match(/<think>([\s\S]*?)<\/think>/i) || text.match(/<reasoning>([\s\S]*?)<\/reasoning>/i);
  if (thinkClosed) {
    const thinking = thinkClosed[1];
    const response = text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
      .trim();
    return { thinking: thinking.trim(), response };
  }

  // 2. Check for open <think> during streaming
  const thinkOpen = text.match(/<think>([\s\S]*)$/i) || text.match(/<reasoning>([\s\S]*)$/i);
  if (thinkOpen) {
    return { thinking: thinkOpen[1].trim(), response: '' };
  }

  return null;
}

const MarkdownSegment = React.memo(function MarkdownSegment({ content }: { content: string }) {
  const html = useMemo(() => {
    try {
      return marked.parse(content) as string;
    } catch {
      return content;
    }
  }, [content]);

  return (
    <div
      className="chat-markdown-segment"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

function ChatMessageComponent({ message, isStreaming, onRetry, onContinue, onOpenCanvas }: Props) {
  const [copied, setCopied] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [activeLightboxImg, setActiveLightboxImg] = useState<string | null>(null);
  const [expandedDocIdx, setExpandedDocIdx] = useState<number | null>(null);

  const isUser = message.role === 'user';
  const isSystem = message.role === 'system' || message.role === 'developer';
  const isTool = message.role === 'tool';
  const isTruncated = message.meta?.finish_reason === 'length';

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

  // Parse attached documents if user message
  const { docs: userDocs, promptText: userPromptText } = useMemo(() => {
    if (!isUser) return { docs: [], promptText: rawText };
    return parseUserDocuments(rawText);
  }, [rawText, isUser]);

  // Check reasoning content
  const parsedThinking = useMemo(() => parseThinking(isUser ? userPromptText : rawText), [rawText, isUser, userPromptText]);
  const reasoningText = message.reasoning_content || parsedThinking?.thinking;
  const mainText = parsedThinking ? parsedThinking.response : (isUser ? userPromptText : rawText);

  // Split into markdown and rich interactive artifact blocks
  const contentBlocks = useMemo(() => {
    return parseMarkdownBlocks(mainText, isStreaming);
  }, [mainText, isStreaming]);

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

        {/* Document Attachments (PDF / Text / Code) */}
        {userDocs.length > 0 && (
          <div className="chat-user-docs-container">
            {userDocs.map((doc, idx) => (
              <div key={idx} className="chat-user-doc-card">
                <div className="chat-user-doc-header">
                  <div className="chat-user-doc-icon">
                    <FiFileText size={18} />
                  </div>
                  <div className="chat-user-doc-details">
                    <span className="chat-user-doc-name" title={doc.name}>{doc.name}</span>
                    <span className="chat-user-doc-meta">{doc.meta || 'Document'} · Extracted Text</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedDocIdx(expandedDocIdx === idx ? null : idx)}
                    className="chat-user-doc-toggle-btn"
                  >
                    {expandedDocIdx === idx ? <FiChevronUp size={13} /> : <FiChevronDown size={13} />}
                    <span>{expandedDocIdx === idx ? 'Hide Text' : 'View Text'}</span>
                  </button>
                </div>
                {expandedDocIdx === idx && (
                  <pre className="chat-user-doc-preview">
                    <code>{doc.content}</code>
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Image Attachments */}
        {images.length > 0 && (
          <div className="chat-image-attachments">
            {images.map((img, idx) => (
              <div key={idx} className="chat-attachment-thumb-wrap" onClick={() => setActiveLightboxImg(img)}>
                <img
                  src={img}
                  alt={`Attachment ${idx + 1}`}
                  className="chat-attachment-img"
                />
                <div className="chat-attachment-zoom-overlay">
                  <FiMaximize2 size={14} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Main Message Content / Tool Output */}
        {isTool ? (
          <div className="chat-tool-result-container">
            <div className="chat-tool-result-header">
              <span className="tool-name-badge"><code>{message.name || 'tool'}</code></span>
              <span className="tool-status-badge success">✓ Execution Output</span>
            </div>
            <pre className="chat-tool-result-body">
              <code>{rawText}</code>
            </pre>
          </div>
        ) : contentBlocks.length > 0 ? (
          <div className="chat-markdown-content-wrapper">
            <div className="chat-markdown-content">
              {contentBlocks.map(block => {
                if (block.type === 'code') {
                  return (
                    <ArtifactBlock
                      key={block.id}
                      code={block.content}
                      language={block.language}
                      isClosed={block.isClosed}
                      onOpenCanvas={onOpenCanvas}
                    />
                  );
                }
                return (
                  <MarkdownSegment
                    key={block.id}
                    content={block.content}
                  />
                );
              })}
            </div>
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

            {onContinue && isTruncated && (
              <button onClick={onContinue} className="chat-action-btn continue-btn" title="Continue generation from where it stopped">
                <FiPlay size={12} />
                <span>Continue</span>
              </button>
            )}

            {onRetry && (
              <button onClick={onRetry} className="chat-action-btn" title="Retry generation">
                <FiRefreshCw size={12} />
                <span>Retry</span>
              </button>
            )}

            {/* Response Metadata Badges */}
            {(message.token_stats || message.meta || message.model || isTruncated) && (
              <div className="chat-meta-group">
                {isTruncated && (
                  <span className="chat-meta-pill warning" title="Response was cut off because token limit (max_tokens) was reached">
                    ⚠️ Truncated (max tokens)
                  </span>
                )}
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

      {/* Lightbox Modal */}
      {activeLightboxImg && (
        <div className="image-lightbox-overlay" onClick={() => setActiveLightboxImg(null)}>
          <div className="image-lightbox-card" onClick={e => e.stopPropagation()}>
            <div className="image-lightbox-header">
              <span className="image-lightbox-title">Image Attachment Preview</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <a
                  href={activeLightboxImg}
                  download={`pantry-attachment-${Date.now()}.png`}
                  className="image-lightbox-action-btn"
                  title="Download full image"
                >
                  <FiDownload size={14} />
                  <span>Download</span>
                </a>
                <button
                  type="button"
                  onClick={() => setActiveLightboxImg(null)}
                  className="image-lightbox-action-btn"
                  title="Close"
                >
                  <FiX size={14} />
                </button>
              </div>
            </div>
            <div className="image-lightbox-img-area">
              <img src={activeLightboxImg} alt="Enlarged preview" className="image-lightbox-full-img" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const ChatMessage = React.memo(ChatMessageComponent, (prev, next) => {
  return (
    prev.message === next.message &&
    prev.isStreaming === next.isStreaming &&
    prev.onRetry === next.onRetry &&
    prev.onContinue === next.onContinue &&
    prev.onOpenCanvas === next.onOpenCanvas
  );
});

export default ChatMessage;
