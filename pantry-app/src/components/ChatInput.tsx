import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  FiSend,
  FiPaperclip,
  FiX,
  FiSliders,
  FiZap,
  FiCode,
  FiLayers,
  FiFileText,
  FiFile,
  FiAlertCircle,
  FiChevronDown,
  FiCheck,
  FiUser,
  FiSettings,
} from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import type { MessageContent } from '@/types';
import { extractTextFromPdf } from '@/utils/pdfExtractor';

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
  preview?: string; // base64 for images, or page count for PDF
  content?: string; // text content for files
  file: File;
}

export const SYSTEM_PROMPTS = [
  { id: 'default', label: 'Default Assistant', prompt: 'You are a helpful, accurate, and concise AI assistant.' },
  { id: 'coder', label: 'Expert Software Engineer', prompt: 'You are an expert senior software engineer. Provide production-ready, clean, well-commented code solutions with architectural insights.' },
  { id: 'concise', label: 'Concise Terminal Expert', prompt: 'Answer directly, accurately, and without unnecessary preamble. Output shell commands and code succinctly.' },
  { id: 'analyst', label: 'Research & Data Analyst', prompt: 'Analyze problems methodically with step-by-step reasoning, tradeoffs, and structured summaries.' },
];

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
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const personaDrawerRef = useRef<HTMLDivElement>(null);

  const {
    state,
    setModel,
    setSystemPrompt,
    setMaxTokens,
    setTemperature,
    setPreferSpeculative,
  } = useApp();
  const defaultPlaceholder = placeholder || 'Message Pantry model... (Enter to send, Shift+Enter for newline)';

  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showPersonaDrawer, setShowPersonaDrawer] = useState(false);
  const [activePromptId, setActivePromptId] = useState('default');
  const [inputValue, setInputValue] = useState('');

  const currentModel = state.models.find(m => m.id === state.model || (m.aliases || []).includes(state.model)) || state.models[0];
  
  const chatModels = state.models.filter(m =>
    (m.modalities || []).some(mod => mod.toLowerCase().includes('text') || mod.toLowerCase().includes('chat')) ||
    (m.role || '').toLowerCase().includes('chat') ||
    (m.role || '').toLowerCase().includes('reasoning')
  );
  const displayModels = chatModels.length > 0 ? chatModels : state.models;
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

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setShowModelDropdown(false);
      }
      if (personaDrawerRef.current && !personaDrawerRef.current.contains(event.target as Node)) {
        setShowPersonaDrawer(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectSystemPrompt = (preset: typeof SYSTEM_PROMPTS[0]) => {
    setActivePromptId(preset.id);
    setSystemPrompt(preset.prompt);
  };

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
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

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
    } else if (isPdf) {
      try {
        const extracted = await extractTextFromPdf(file);
        return {
          id: crypto.randomUUID(),
          type: 'file',
          name: file.name,
          size: file.size,
          preview: `${extracted.numPages} ${extracted.numPages === 1 ? 'page' : 'pages'}`,
          content: extracted.text,
          file,
        };
      } catch (err: any) {
        return {
          id: crypto.randomUUID(),
          type: 'file',
          name: file.name,
          size: file.size,
          content: `[Could not parse PDF text: ${err.message || 'Error reading PDF'}]`,
          file,
        };
      }
    } else {
      try {
        const content = await file.text();
        const cleanContent = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        return {
          id: crypto.randomUUID(),
          type: 'file',
          name: file.name,
          size: file.size,
          content: cleanContent,
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
    const filesToProcess: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) filesToProcess.push(file);
      }
    }
    if (filesToProcess.length > 0) {
      e.preventDefault();
      setIsProcessingFile(true);
      try {
        const newAttachments: ChatAttachment[] = [];
        for (const file of filesToProcess) {
          const att = await processFile(file);
          newAttachments.push(att);
        }
        setAttachments(prev => [...prev, ...newAttachments]);
      } finally {
        setIsProcessingFile(false);
      }
    }
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setIsProcessingFile(true);
    try {
      const newAttachments: ChatAttachment[] = [];
      for (const file of files) {
        const att = await processFile(file);
        newAttachments.push(att);
      }
      setAttachments(prev => [...prev, ...newAttachments]);
    } finally {
      setIsProcessingFile(false);
      if (e.target) e.target.value = '';
    }
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
        return `[Attached Document: ${f.name} (${formatFileSize(f.size)}${f.preview ? ` · ${f.preview}` : ''})]\n` +
          `--- Begin Document Content ---\n` +
          `${f.content || ''}\n` +
          `--- End Document Content ---`;
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
          <div className="composer-controls-drawer">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Temperature:</span>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                value={temperature}
                onChange={e => setTemperature(parseFloat(e.target.value))}
                style={{ width: '80px', accentColor: 'var(--accent-primary)' }}
              />
              <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-primary)', width: '28px' }}>{temperature}</span>
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
            {/* Model Selector Pill & Popup */}
            <div className="composer-tool-item" ref={modelDropdownRef}>
              <button
                type="button"
                className={`composer-model-pill ${showModelDropdown ? 'active' : ''}`}
                onClick={() => {
                  setShowModelDropdown(prev => !prev);
                  setShowPersonaDrawer(false);
                  setShowControls(false);
                }}
                title="Select Active Chat Model"
              >
                <span className="model-ready-dot" />
                <span className="composer-model-name-label">{currentModel?.id || state.model || 'Select Model'}</span>
                {currentModel?.quality_tier && (
                  <span className="spec-badge">{currentModel.quality_tier}</span>
                )}
                <FiChevronDown size={13} className={`composer-chevron ${showModelDropdown ? 'open' : ''}`} />
              </button>

              {showModelDropdown && (
                <div className="composer-popup-menu composer-model-dropdown">
                  <div className="composer-popup-header">
                    <span>Available Chat Models</span>
                    <span className="composer-popup-count">{displayModels.length} models</span>
                  </div>
                  <div className="composer-popup-list">
                    {displayModels.map(m => {
                      const isSelected = m.id === state.model || (m.aliases || []).includes(state.model);
                      return (
                        <div
                          key={m.id}
                          onClick={() => {
                            setModel(m.id);
                            setShowModelDropdown(false);
                          }}
                          className={`composer-model-option ${isSelected ? 'selected' : ''}`}
                        >
                          <div className="composer-model-option-top">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span className={`model-ready-dot ${isSelected ? 'online' : 'dim'}`} />
                              <span className="composer-model-option-title">{m.id}</span>
                            </div>
                            <span className="spec-badge">{m.quality_tier || 'standard'}</span>
                          </div>
                          <div className="composer-model-option-sub">
                            <span>Context: {m.context_max || 4096} tokens</span>
                            <span>•</span>
                            <span>Family: {m.family || 'general'}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Persona Selector Pill & Popup */}
            <div className="composer-tool-item" ref={personaDrawerRef}>
              <button
                type="button"
                className={`composer-persona-pill ${showPersonaDrawer ? 'active' : ''}`}
                onClick={() => {
                  setShowPersonaDrawer(prev => !prev);
                  setShowModelDropdown(false);
                  setShowControls(false);
                }}
                title="System Persona & Instructions"
              >
                <FiSliders size={13} />
                <span>Persona</span>
                {state.systemPrompt && state.systemPrompt !== SYSTEM_PROMPTS[0].prompt && (
                  <span className="composer-active-dot" />
                )}
              </button>

              {showPersonaDrawer && (
                <div className="composer-popup-menu composer-persona-dropdown">
                  <div className="composer-popup-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FiSliders size={13} color="var(--accent-primary)" />
                      <span>System Persona & Instructions</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPersonaDrawer(false)}
                      className="composer-drawer-close-btn"
                    >
                      Done
                    </button>
                  </div>

                  <div className="composer-persona-presets">
                    {SYSTEM_PROMPTS.map(preset => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSelectSystemPrompt(preset)}
                        className={`composer-preset-chip ${activePromptId === preset.id ? 'active' : ''}`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <div className="composer-persona-custom">
                    <label className="composer-persona-label">Custom Instructions:</label>
                    <textarea
                      rows={3}
                      value={state.systemPrompt || ''}
                      onChange={e => {
                        setSystemPrompt(e.target.value);
                        setActivePromptId('custom');
                      }}
                      placeholder="Enter custom instructions or persona guidelines for the model..."
                      className="composer-persona-textarea"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="composer-tools-divider" />

            {/* Attach File Button */}
            <label className="composer-btn" title="Attach image, document, text, or code">
              <FiPaperclip size={15} />
              <input
                ref={fileInputRef}
                type="file"
                accept="*"
                multiple
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </label>

            {/* Parameters Settings Button */}
            <button
              type="button"
              className={`composer-btn ${showControls ? 'active' : ''}`}
              onClick={() => {
                setShowControls(!showControls);
                setShowModelDropdown(false);
                setShowPersonaDrawer(false);
              }}
              title="Generation Parameters (Temp, Tokens, Speculative)"
            >
              <FiSettings size={14} />
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
