import React, { useRef, useState, useCallback, useEffect } from 'react';
import { FiSend, FiImage, FiPaperclip, FiX, FiMaximize2, FiMinimize2, FiTrash2 } from 'react-icons/fi';
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

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export default function ChatInput({ placeholder, onSend, autoFocus, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { state, setMaxTokens } = useApp();
  const p = placeholder || 'Message your model… (Enter to send, Shift+Enter for newline)';

  const [attachments, setAttachments] = useState<{ id: string; preview: string; file: File; type: 'image' }[]>([]);
  const [showTokenControls, setShowTokenControls] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const handleCompositionStart = () => setIsComposing(true);
  const handleCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    setIsComposing(false);
    if (e.data && !(e.nativeEvent as any).isComposing) {
      handleSend();
    }
  };

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const base64 = await fileToBase64(file);
          setAttachments(prev => [...prev, { id: crypto.randomUUID(), preview: base64, file, type: 'image' }]);
        }
      }
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (isImageFile(file)) {
        const base64 = await fileToBase64(file);
        setAttachments(prev => [...prev, { id: crypto.randomUUID(), preview: base64, file, type: 'image' }]);
      }
    }
  }, []);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (isImageFile(file)) {
        const base64 = await fileToBase64(file);
        setAttachments(prev => [...prev, { id: crypto.randomUUID(), preview: base64, file, type: 'image' }]);
      }
    }
    if (e.target) e.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleSend = () => {
    const text = textareaRef.current?.value.trim() || '';
    if ((!text && attachments.length === 0) || !onSend || disabled) return;

    const content: MessageContent[] = [];
    if (text) content.push({ type: 'text', text });
    for (const att of attachments) {
      content.push({ type: 'image_url', image_url: { url: att.preview, detail: 'auto' } });
    }

    onSend(content.length === 1 && content[0].type === 'text' ? content[0].text : content);
    if (textareaRef.current) {
      textareaRef.current.value = '';
      textareaRef.current.style.height = 'auto';
    }
    setAttachments([]);
  };

  const handleTokenControlChange = (key: 'maxTokens' | 'temperature' | 'topP', value: number) => {
    const update: Record<string, number> = { [key]: value };
    if (key === 'maxTokens') setMaxTokens(value);
  };

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  const maxTokens = state.maxTokens || 1024;
  const temperature = state.temperature ?? 0.7;
  const topP = state.topP ?? 1.0;

  return (
    <div className="chat-input">
      <div className="chat-input-toolbar">
        <div className="chat-input-tools">
          <label className="chat-input-tool-btn" title="Attach image">
            <FiPaperclip size={16} />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              className="chat-input-file-hidden"
            />
          </label>
          <button
            type="button"
            className={`chat-input-tool-btn ${showTokenControls ? 'active' : ''}`}
            onClick={() => setShowTokenControls(!showTokenControls)}
            title="Token controls"
          >
            {showTokenControls ? <FiMinimize2 size={16} /> : <FiMaximize2 size={16} />}
          </button>
        </div>

        {attachments.length > 0 && (
          <div className="chat-input-attachments">
            {attachments.map(att => (
              <div key={att.id} className="chat-input-attachment">
                <img src={att.preview} alt="attachment" className="chat-input-attachment-preview" />
                <button
                  type="button"
                  className="chat-input-attachment-remove"
                  onClick={() => removeAttachment(att.id)}
                  aria-label="Remove attachment"
                >
                  <FiX size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {showTokenControls && (
          <div className="chat-input-token-controls">
            <div className="chat-input-token-row">
              <label className="chat-input-token-label">
                <span>Max Tokens</span>
                <input
                  type="number"
                  min="16"
                  max={state.model && state.models?.find(m => m.id === state.model)?.context_max || 4096}
                  value={maxTokens}
                  onChange={e => handleTokenControlChange('maxTokens', parseInt(e.target.value) || 16)}
                  className="chat-input-token-input"
                />
              </label>
              <label className="chat-input-token-label">
                <span>Temperature ({temperature})</span>
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.05"
                  value={temperature}
                  onChange={e => handleTokenControlChange('temperature', parseFloat(e.target.value))}
                  className="chat-input-token-slider"
                />
              </label>
              <label className="chat-input-token-label">
                <span>Top P ({topP})</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={topP}
                  onChange={e => handleTokenControlChange('topP', parseFloat(e.target.value))}
                  className="chat-input-token-slider"
                />
              </label>
            </div>
          </div>
        )}
      </div>

      <div
        className={`chat-input-main ${isDragging ? 'dragging' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder={p}
          autoFocus={autoFocus}
          disabled={disabled}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          className="chat-input-textarea"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || (!textareaRef.current?.value.trim() && attachments.length === 0)}
          className={`chat-input-send ${(textareaRef.current?.value.trim() || attachments.length > 0) && !disabled ? 'active' : 'inactive'}`}
        >
          <FiSend size={14} />
        </button>
      </div>

      <style>{`
        .chat-input { display: flex; flex-direction: column; gap: 4px; }
        .chat-input-toolbar { display: flex; flex-direction: column; gap: 6px; }
        .chat-input-tools { display: flex; gap: 4px; align-items: center; padding: 0 4px; }
        .chat-input-tool-btn {
          position: relative; display: flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 6px; border: none; background: transparent;
          color: #8b949e; cursor: pointer; transition: all 0.15s ease;
        }
        .chat-input-tool-btn:hover { background: #21262d; color: #e6edf3; }
        .chat-input-tool-btn.active { background: #238636; color: white; }
        .chat-input-file-hidden { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
        .chat-input-attachments { display: flex; gap: 6px; padding: 0 8px; max-height: 60px; overflow-x: auto; }
        .chat-input-attachment { position: relative; flex-shrink: 0; width: 56px; height: 56px; border-radius: 6px; overflow: hidden; border: 1px solid #30363d; }
        .chat-input-attachment-preview { width: 100%; height: 100%; object-fit: cover; }
        .chat-input-attachment-remove {
          position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%;
          border: none; background: rgba(0,0,0,0.7); color: white; display: flex; align-items: center; justify-content: center;
          cursor: pointer; opacity: 0; transition: opacity 0.15s;
        }
        .chat-input-attachment:hover .chat-input-attachment-remove { opacity: 1; }
        .chat-input-token-controls { display: flex; flex-direction: column; gap: 8px; padding: 8px; background: #161b22; border-radius: 6px; border: 1px solid #30363d; }
        .chat-input-token-row { display: flex; flex-wrap: wrap; gap: 12px; }
        .chat-input-token-label { display: flex; flex-direction: column; gap: 4px; min-width: 120px; flex: 1; }
        .chat-input-token-label span { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
        .chat-input-token-input { padding: 6px 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #e6edf3; font-size: 13px; }
        .chat-input-token-slider { width: 100%; accent-color: #58a6ff; }
        .chat-input-main { position: relative; display: flex; align-items: flex-end; gap: 8px; padding: 8px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; transition: border-color 0.15s; }
        .chat-input-main.dragging { border-color: #58a6ff; background: #1c2530; }
        .chat-input-main:focus-within { border-color: #58a6ff; }
        .chat-input-textarea {
          flex: 1; min-height: 44px; max-height: 160px; padding: 10px 12px; background: transparent; border: none; outline: none;
          color: #e6edf3; font-size: 14px; line-height: 1.5; resize: none; font-family: inherit;
        }
        .chat-input-textarea::placeholder { color: #6e7681; }
        .chat-input-textarea:disabled { color: #6e7681; cursor: not-allowed; }
        .chat-input-send {
          flex-shrink: 0; width: 36px; height: 36px; border-radius: 6px; border: none;
          background: #238636; color: white; display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.15s ease;
        }
        .chat-input-send:hover:not(:disabled) { background: #2ea043; }
        .chat-input-send.inactive { background: #30363d; color: #6e7681; cursor: not-allowed; }
        .chat-input-send:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}