import React from 'react';
import { FiPlus, FiMessageSquare, FiTrash2, FiEdit3, FiClock } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import type { Conversation } from '@/types';

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

export default function ConversationList() {
  const { state, conversations, activeConversationId, selectConversation, createConversation, deleteConversation, renameConversation, refreshConversations } = useApp();

  return (
    <div className="conversation-list">
      <div className="conversation-list-header">
        <span className="conversation-list-title">Conversations</span>
        <div className="conversation-list-actions">
          <button
            onClick={() => refreshConversations()}
            title="Refresh"
            className="conversation-list-action"
          >
            <FiClock size={12} />
          </button>
          <button
            onClick={() => createConversation()}
            title="New conversation"
            className="conversation-list-action"
          >
            <FiPlus size={12} /> New
          </button>
        </div>
      </div>

      <div className="conversation-list-scroll">
        {conversations.length === 0 && (
          <div className="conversation-empty">
            <FiMessageSquare size={24} />
            No conversations yet
          </div>
        )}
        {conversations.map(conv => (
          <ConversationItem
            key={conv.id}
            conv={conv}
            active={conv.id === activeConversationId}
            onSelect={() => selectConversation(conv.id)}
            onDelete={() => deleteConversation(conv.id)}
            onRename={(title) => renameConversation(conv.id, title)}
          />
        ))}
      </div>
    </div>
  );
}

function ConversationItem({
  conv, active, onSelect, onDelete, onRename,
}: {
  conv: Conversation;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [renaming, setRenaming] = React.useState(false);
  const [title, setTitle] = React.useState(conv.title);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  return (
    <div
      className={`conversation-item ${active ? 'active' : ''}`}
      onClick={onSelect}
    >
      <FiMessageSquare className="conversation-item-icon" />
      {renaming ? (
        <input
          ref={inputRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => { setRenaming(false); if (title !== conv.title && title.trim()) onRename(title); }}
          onKeyDown={e => { if (e.key === 'Enter') { setRenaming(false); if (title.trim()) onRename(title); } }}
          onClick={e => e.stopPropagation()}
          className="conversation-item-input"
        />
      ) : (
        <span className="conversation-item-title">
          {conv.title || 'Untitled'}
        </span>
      )}
      <div className="conversation-item-actions">
        <button
          onClick={() => setRenaming(!renaming)}
          title="Rename"
          className="conversation-item-action"
        >
          <FiEdit3 size={10} />
        </button>
        <button
          onClick={onDelete}
          title="Delete"
          className="conversation-item-action"
        >
          <FiTrash2 size={10} />
        </button>
      </div>
      <span className="conversation-item-meta">
        {conv.message_count > 0 ? `${conv.message_count} msgs` : ''}
      </span>
      <span className="conversation-item-time">
        {formatTime(conv.updated_at)}
      </span>
    </div>
  );
}
