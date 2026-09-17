import React from 'react';
import { FiLoader, FiCheck, FiX, FiCopy } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';

interface Props {
  content: string;
  isStreaming?: boolean;
  showMeta?: boolean;
  onCopy?: () => void;
}

export default function ChatMessage({ content, isStreaming, showMeta, onCopy }: Props) {
  const { state } = useApp();

  return (
    <div className="chat-message">
      <div className="chat-message-row">
        <div className={`chat-avatar ${state.activeTab === 'chat' ? 'bot' : 'user'}`}>
          {state.activeTab === 'chat' ? '🤖' : '👤'}
        </div>
        <div className="chat-content">
          <div className="chat-bubble">
            {content || (isStreaming && <span className="chat-thinking">Thinking…</span>)}
            {isStreaming && <span className="chat-cursor">▌</span>}
          </div>
          {showMeta && onCopy && (
            <div className="chat-actions">
              <button onClick={onCopy} className="chat-copy-btn">
                <FiCopy size={10} /> Copy
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes blink { 50% { opacity: 0; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
