import React, { useState, useMemo } from 'react';
import { FiPlus, FiMessageSquare, FiTrash2, FiEdit3, FiSearch, FiCheck, FiX, FiShield, FiChevronDown } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import type { Conversation } from '@/types';
import { formatTime, getGroupLabel, getConversationTimestamp, sortConversations } from '@/utils/conversationUtils';

export default function ConversationList() {
  const { conversations, activeConversationId, selectConversation, createConversation, deleteConversation, renameConversation } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [showStudioMenu, setShowStudioMenu] = useState(false);

  const filtered = useMemo(() => {
    let list = conversations;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = conversations.filter(c => 
        (c.title || '').toLowerCase().includes(term) ||
        (c.model || '').toLowerCase().includes(term)
      );
    }
    return sortConversations(list);
  }, [conversations, searchTerm]);

  const grouped = useMemo(() => {
    const groups: { label: string; items: Conversation[] }[] = [
      { label: 'Today', items: [] },
      { label: 'Yesterday', items: [] },
      { label: 'Previous 7 Days', items: [] },
      { label: 'Older', items: [] },
    ];

    for (const conv of filtered) {
      const g = getGroupLabel(getConversationTimestamp(conv));
      const target = groups.find(grp => grp.label === g) || groups[3];
      target.items.push(conv);
    }

    // Ensure items within each group are strictly ordered newest to oldest
    for (const grp of groups) {
      grp.items = sortConversations(grp.items);
    }

    return groups.filter(g => g.items.length > 0);
  }, [filtered]);

  return (
    <div className="conversation-list">
      <div className="conversation-list-header">
        <button
          onClick={() => createConversation()}
          title="Start a new standard chat"
          className="new-chat-btn"
        >
          <FiPlus size={16} />
          <span>New Chat</span>
        </button>

        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowStudioMenu(!showStudioMenu)}
            title="Start a specialized Studio session (Threat Modeling, etc.)"
            className="new-studio-btn"
          >
            <FiShield size={14} />
            <span>Studio</span>
            <FiChevronDown size={11} />
          </button>

          {showStudioMenu && (
            <div className="studio-menu-dropdown">
              <div className="studio-menu-header">Specialized Studio Canvases</div>
              <button
                className="studio-menu-item"
                onClick={() => {
                  createConversation('Threat Model (PASTA)', 'threat-model', 'PASTA');
                  setShowStudioMenu(false);
                }}
              >
                <div className="menu-item-icon">🛡️</div>
                <div className="menu-item-info">
                  <div className="menu-item-title">PASTA Threat Modeling</div>
                  <div className="menu-item-desc">Risk-centric 7-stage architecture analysis</div>
                </div>
              </button>
              <button
                className="studio-menu-item"
                onClick={() => {
                  createConversation('Threat Model (STRIDE)', 'threat-model', 'STRIDE');
                  setShowStudioMenu(false);
                }}
              >
                <div className="menu-item-icon">🔍</div>
                <div className="menu-item-info">
                  <div className="menu-item-title">STRIDE Matrix Studio</div>
                  <div className="menu-item-desc">Asset & trust boundary threat breakdown</div>
                </div>
              </button>
              <button
                className="studio-menu-item"
                onClick={() => {
                  createConversation('Threat Model (MAESTRO)', 'threat-model', 'MAESTRO');
                  setShowStudioMenu(false);
                }}
              >
                <div className="menu-item-icon">🤖</div>
                <div className="menu-item-info">
                  <div className="menu-item-title">MAESTRO Agentic Security</div>
                  <div className="menu-item-desc">LLM agent, prompt injection & tool analysis</div>
                </div>
              </button>
            </div>
          )}
        </div>
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
      {conv.plugin_id === 'threat-model' ? (
        <FiShield className="conversation-item-icon studio-badge-icon" size={14} />
      ) : (
        <FiMessageSquare className="conversation-item-icon" size={14} />
      )}
      
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
          <span className="conversation-item-time">{formatTime(getConversationTimestamp(conv))}</span>
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
