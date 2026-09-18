import React, { useState, useMemo } from 'react';
import { FiPlus, FiMessageSquare, FiTrash2, FiEdit3, FiSearch, FiCheck, FiX } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import type { Conversation } from '@/types';

function formatTime(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getGroupLabel(iso: string): string {
  if (!iso) return 'Older';
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const lastWeek = new Date(today.getTime() - 7 * 86400000);

  if (d >= today) return 'Today';
  if (d >= yesterday) return 'Yesterday';
  if (d >= lastWeek) return 'Previous 7 Days';
  return 'Older';
}

export default function ConversationList() {
  const { conversations, activeConversationId, selectConversation, createConversation, deleteConversation, renameConversation } = useApp();
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return conversations;
    const term = searchTerm.toLowerCase();
    return conversations.filter(c => 
      (c.title || '').toLowerCase().includes(term) ||
      (c.model || '').toLowerCase().includes(term)
    );
  }, [conversations, searchTerm]);

  const grouped = useMemo(() => {
    const groups: { label: string; items: Conversation[] }[] = [
      { label: 'Today', items: [] },
      { label: 'Yesterday', items: [] },
      { label: 'Previous 7 Days', items: [] },
      { label: 'Older', items: [] },
    ];

    for (const conv of filtered) {
      const g = getGroupLabel(conv.updated_at || conv.created_at);
      const target = groups.find(grp => grp.label === g) || groups[3];
      target.items.push(conv);
    }

    return groups.filter(g => g.items.length > 0);
  }, [filtered]);

  return (
    <div className="conversation-list">
      <div className="conversation-list-header">
        <button
          onClick={() => createConversation()}
          title="Start a new chat session"
          className="new-chat-btn"
        >
          <FiPlus size={16} />
          <span>New Chat</span>
        </button>
      </div>

      <div className="conversation-search-wrap">
        <FiSearch size={13} className="search-icon" />
        <input
          type="text"
          placeholder="Search chats..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="conversation-search-input"
        />
        {searchTerm && (
          <button onClick={() => setSearchTerm('')} className="search-clear-btn">
            <FiX size={12} />
          </button>
        )}
      </div>

      <div className="conversation-list-scroll">
        {filtered.length === 0 && (
          <div className="conversation-empty">
            <FiMessageSquare size={24} className="empty-icon" />
            <p>{searchTerm ? 'No matching chats found' : 'No conversations yet'}</p>
          </div>
        )}

        {grouped.map(group => (
          <div key={group.label} className="conversation-group">
            <div className="conversation-group-title">{group.label}</div>
            {group.items.map(conv => (
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
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(conv.title || 'Untitled Chat');
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  const handleSave = () => {
    setRenaming(false);
    if (title.trim() && title !== conv.title) {
      onRename(title.trim());
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this conversation?')) {
      onDelete();
    }
  };

  return (
    <div
      className={`conversation-item ${active ? 'active' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
    >
      <FiMessageSquare className="conversation-item-icon" size={14} />
      
      <div className="conversation-item-content">
        {renaming ? (
          <div className="rename-wrap" onClick={e => e.stopPropagation()}>
            <input
              ref={inputRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={handleSave}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') { setRenaming(false); setTitle(conv.title || 'Untitled Chat'); }
              }}
              className="conversation-item-input"
            />
            <button onClick={handleSave} className="rename-btn save" title="Save">
              <FiCheck size={11} />
            </button>
          </div>
        ) : (
          <div className="conversation-item-title" title={conv.title || 'Untitled Chat'}>
            {conv.title || 'Untitled Chat'}
          </div>
        )}
        <div className="conversation-item-sub">
          <span className="conversation-item-time">{formatTime(conv.updated_at || conv.created_at)}</span>
          {conv.message_count > 0 && (
            <span className="conversation-item-count">{conv.message_count} msgs</span>
          )}
        </div>
      </div>

      {!renaming && (
        <div className="conversation-item-actions">
          <button
            onClick={(e) => { e.stopPropagation(); setRenaming(true); }}
            title="Rename chat"
            className="conversation-item-action"
          >
            <FiEdit3 size={12} />
          </button>
          <button
            onClick={handleDelete}
            title="Delete chat"
            className="conversation-item-action delete"
          >
            <FiTrash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
