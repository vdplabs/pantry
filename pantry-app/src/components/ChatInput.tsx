import React, { useRef, useState, useCallback, useEffect } from 'react';
import { FiSend, FiPaperclip, FiX, FiSliders, FiZap, FiCode, FiLayers } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import type { MessageContent } from '@/types';

interface Props {
  placeholder?: string;
  onSend?: (content: string | MessageContent[]) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ChatInput({ placeholder, onSend, autoFocus, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { state, setMaxTokens, setTemperature, setPreferSpeculative } = useApp();
  const defaultPlaceholder = placeholder || 'Message Pantry model... (Enter to send, Shift+Enter for newline)';

  const [attachments, setAttachments] = useState<{ id: string; preview: string; file: File }[]>([]);
  const [showControls, setShowControls] = useState(false);
  const [inputValue, setInputValue] = useState('');

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

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const base64 = await fileToBase64(file);
          setAttachments(prev => [...prev, { id: crypto.randomUUID(), preview: base64, file }]);
        }
      }
    }
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const base64 = await fileToBase64(file);
        setAttachments(prev => [...prev, { id: crypto.randomUUID(), preview: base64, file }]);
      }
    }
    if (e.target) e.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleSend = () => {
    const text = inputValue.trim();
    if ((!text && attachments.length === 0) || !onSend || disabled) return;

    if (attachments.length === 0) {
      onSend(text);
    } else {
      const parts: MessageContent[] = [];
      if (text) parts.push({ type: 'text', text });
      for (const att of attachments) {
        parts.push({ type: 'image_url', image_url: { url: att.preview, detail: 'auto' } });
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
          <div className="composer-attachments-row" style={{ display: 'flex', gap: '8px', padding: '10px 14px 0 14px' }}>
            {attachments.map(att => (
              <div
                key={att.id}
                style={{
                  position: 'relative',
                  width: '54px',
                  height: '54px',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: '1px solid var(--border-card)',
                }}
              >
                <img src={att.preview} alt="Attachment" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  style={{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    border: 'none',
                    background: 'rgba(0,0,0,0.7)',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <FiX size={10} />
                </button>
              </div>
            ))}
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
            <label className="composer-btn" title="Attach Image">
              <FiPaperclip size={16} />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
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
