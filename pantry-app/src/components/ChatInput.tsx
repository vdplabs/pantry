import React, { useRef, useState, useCallback, useEffect } from 'react';
import { FiSend, FiPaperclip, FiX, FiSliders, FiZap, FiCode, FiLayers, FiFileText, FiFile, FiAlertCircle } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import type { MessageContent } from '@/types';

interface Props {
  placeholder?: string;
  onSend?: (content: string | MessageContent[]) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}

export interface ChatAttachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  size: number;
  preview?: string; // base64 for images
  content?: string; // text content for files
  file: File;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatInput({ placeholder, onSend, autoFocus, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { state, setModel, setMaxTokens, setTemperature, setPreferSpeculative } = useApp();
  const defaultPlaceholder = placeholder || 'Message Pantry model... (Enter to send, Shift+Enter for newline)';

  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [showControls, setShowControls] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const currentModel = state.models.find(m => m.id === state.model || (m.aliases || []).includes(state.model));
  const isVisionModel = (currentModel?.modalities || []).some(m => m.toLowerCase().includes('vision') || m.toLowerCase().includes('image')) ||
    (currentModel?.role || '').toLowerCase().includes('vision') ||
    (state.model || '').toLowerCase().includes('vision') ||
    (state.model || '').toLowerCase().includes('vl');

  const visionModels = state.models.filter(m =>
    (m.modalities || []).some(mod => mod.toLowerCase().includes('vision') || mod.toLowerCase().includes('image')) ||
    (m.role || '').toLowerCase().includes('vision') ||
    m.id.toLowerCase().includes('vision') ||
    m.id.toLowerCase().includes('vl')
  );

  const hasImages = attachments.some(a => a.type === 'image');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputValue(val);
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 180) + 'px';
    }
  };

  const processFile = async (file: File): Promise<ChatAttachment> => {
    const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(file.name);
    if (isImage) {
      const preview = await fileToBase64(file);
      return {
        id: crypto.randomUUID(),
        type: 'image',
        name: file.name,
        size: file.size,
        preview,
        file,
      };
    } else {
      try {
        const content = await file.text();
        return {
          id: crypto.randomUUID(),
          type: 'file',
          name: file.name,
          size: file.size,
          content,
          file,
        };
      } catch {
        return {
          id: crypto.randomUUID(),
          type: 'file',
          name: file.name,
          size: file.size,
          content: `[Attached file: ${file.name}, size: ${formatFileSize(file.size)}]`,
          file,
        };
      }
    }
  };

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const newAttachments: ChatAttachment[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          const att = await processFile(file);
          newAttachments.push(att);
        }
      }
    }
    if (newAttachments.length > 0) {
      e.preventDefault();
      setAttachments(prev => [...prev, ...newAttachments]);
    }
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const newAttachments: ChatAttachment[] = [];
    for (const file of files) {
      const att = await processFile(file);
      newAttachments.push(att);
    }
    setAttachments(prev => [...prev, ...newAttachments]);
    if (e.target) e.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleSend = () => {
    const text = inputValue.trim();
    if ((!text && attachments.length === 0) || !onSend || disabled) return;

    const imageAtts = attachments.filter(a => a.type === 'image' && a.preview);
    const fileAtts = attachments.filter(a => a.type === 'file');

    let combinedText = text;
    if (fileAtts.length > 0) {
      const fileBlocks = fileAtts.map(f => {
        const ext = f.name.includes('.') ? f.name.split('.').pop() : '';
        return `[Attached file: ${f.name} (${formatFileSize(f.size)})]\n\`\`\`${ext || ''}\n${f.content || ''}\n\`\`\``;
      }).join('\n\n');

      combinedText = combinedText ? `${fileBlocks}\n\n${combinedText}` : fileBlocks;
    }

    if (imageAtts.length === 0) {
      onSend(combinedText);
    } else {
      const parts: MessageContent[] = [];
      if (combinedText) parts.push({ type: 'text', text: combinedText });
      for (const att of imageAtts) {
        if (att.preview) {
          parts.push({ type: 'image_url', image_url: { url: att.preview, detail: 'auto' } });
        }
      }
      onSend(parts);
    }

    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.value = '';
      textareaRef.current.style.height = 'auto';
    }
    setAttachments([]);
  };

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  const maxTokens = state.maxTokens || 2048;
  const temperature = state.temperature ?? 0.7;

  return (
    <div className="chat-input-container">
      <div className="chat-composer-box">
        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="composer-attachments-row">
            {attachments.map(att => (
              <div key={att.id} className="composer-attachment-pill">
                {att.type === 'image' ? (
                  <img src={att.preview} alt={att.name} className="composer-attachment-thumb" />
                ) : (
                  <div className="composer-file-icon-box">
                    <FiFileText size={16} />
                  </div>
                )}
                <div className="composer-attachment-info">
                  <span className="composer-attachment-name" title={att.name}>{att.name}</span>
                  <span className="composer-attachment-size">{formatFileSize(att.size)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  className="composer-attachment-remove-btn"
                  title="Remove attachment"
                >
                  <FiX size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Vision Model Suggestion Pill */}
        {hasImages && !isVisionModel && (
          <div className="composer-vision-warning">
            <FiAlertCircle size={14} color="#f59e0b" />
            <span>Image attached, but <strong>{currentModel?.id || state.model}</strong> is a text-only model.</span>
            {visionModels.length > 0 && (
              <button
                type="button"
                onClick={() => setModel(visionModels[0].id)}
                className="composer-switch-vision-btn"
              >
                Switch to {visionModels[0].id}
              </button>
            )}
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={inputValue}
          placeholder={defaultPlaceholder}
          disabled={disabled}
          onKeyDown={handleKeyDown}
          onChange={handleInput}
          onPaste={handlePaste}
          className="composer-textarea"
        />

        {/* Parameters Drawer */}
        {showControls && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-card-subtle)', background: 'var(--bg-card-inner)', display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Temperature:</span>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                value={temperature}
                onChange={e => setTemperature(parseFloat(e.target.value))}
                style={{ width: '90px', accentColor: 'var(--accent-primary)' }}
              />
              <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-primary)' }}>{temperature}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Max Tokens:</span>
              <input
                type="number"
                min="64"
                max="8192"
                step="64"
                value={maxTokens}
                onChange={e => setMaxTokens(parseInt(e.target.value) || 256)}
                style={{ width: '70px', padding: '2px 6px', background: 'var(--bg-input)', border: '1px solid var(--border-card)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px' }}
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={state.preferSpeculative}
                onChange={e => setPreferSpeculative(e.target.checked)}
                style={{ accentColor: 'var(--accent-primary)' }}
              />
              <span style={{ color: 'var(--text-muted)' }}>⚡ Speculative Decoding</span>
            </label>
          </div>
        )}

        {/* Bottom Bar */}
        <div className="composer-bottom-bar">
          <div className="composer-tools-left">
            <label className="composer-btn" title="Attach image, text, code, or document">
              <FiPaperclip size={16} />
              <input
                ref={fileInputRef}
                type="file"
                accept="*"
                multiple
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </label>

            <button
              type="button"
              className={`composer-btn ${showControls ? 'active' : ''}`}
              onClick={() => setShowControls(!showControls)}
              title="Generation Parameters"
            >
              <FiSliders size={15} />
            </button>
          </div>

          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || (!inputValue.trim() && attachments.length === 0)}
            className="composer-send-btn"
            title="Send Message"
          >
            <FiSend size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
