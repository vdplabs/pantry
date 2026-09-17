import React, { useRef } from 'react';
import { FiSend } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';

interface Props {
  placeholder?: string;
  onSend?: (text: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}

export default function ChatInput({ placeholder, onSend, autoFocus, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { state } = useApp();
  const p = placeholder || 'Message your model… (Enter to send, Shift+Enter for newline)';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const val = textareaRef.current?.value.trim();
      if (val && onSend && !disabled) {
        onSend(val);
        if (textareaRef.current) textareaRef.current.value = '';
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  return (
    <div className="chat-input">
      <textarea
        ref={textareaRef}
        rows={1}
        placeholder={p}
        autoFocus={autoFocus}
        disabled={disabled}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        className="chat-input-textarea" />
      <button
        onClick={() => {
          const val = textareaRef.current?.value.trim();
          if (val && onSend && !disabled) {
            onSend(val);
            if (textareaRef.current) {
              textareaRef.current.value = '';
              textareaRef.current.style.height = 'auto';
            }
          }
        }}
        disabled={disabled || !state.messages.length}
        className={`chat-input-send ${state.messages.length && !disabled ? 'active' : 'inactive'}`}
      >
        <FiSend size={14} />
      </button>
    </div>
  );
}
