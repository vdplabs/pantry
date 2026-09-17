import React from 'react';
import { FiMessageSquare, FiBox, FiImage, FiMusic, FiMic, FiSliders, FiList, FiChevronLeft, FiChevronRight, FiSearch, FiSettings } from 'react-icons/fi';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '@/context/AppContext';

const navItems = [
  { id: 'chat', icon: FiMessageSquare, label: 'Chat' },
  { id: 'generate', icon: FiImage, label: 'Generate' },
];

const footerNavItems = [
  { id: 'models', icon: FiBox, label: 'Models' },
  { id: 'settings', icon: FiSliders, label: 'Settings' },
];


export default function Sidebar() {
  const { state } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  const pathTab = location.pathname.replace(/^\//, '') || 'chat';

  const goTo = (tab: string) => {
    navigate(tab === 'chat' ? '/' : `/${tab}`);
  };

  return (
    <aside className={`sidebar ${state.sidebarOpen ? '' : 'closed'}`}>
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          🏠
        </div>
        {state.sidebarOpen && (
          <span className="sidebar-logo-name">
            Pantry
          </span>
        )}
      </div>

      <nav className="sidebar-nav">
        {navItems.map(item => {
          const Icon = item.icon;
          const active = pathTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => goTo(item.id)}
              className={`sidebar-nav-button ${active ? 'active' : ''}`}
            >
              <Icon size={18} className="sidebar-nav-icon" />
              {state.sidebarOpen && item.label}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">

      {footerNavItems.map(item => {
          const Icon = item.icon;
          const active = pathTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => goTo(item.id)}
              className={`sidebar-footer-button ${active ? 'active' : ''}`}
            >
              <Icon size={18} className="sidebar-nav-icon" />
              {state.sidebarOpen && item.label}
            </button>
          );
        })}

        <button
          onClick={() => {}}
          className="sidebar-footer-button"
        >
          <FiSettings size={18} className="sidebar-nav-icon" />
          {state.sidebarOpen && <span>Preferences</span>}
        </button>
        <button
          onClick={() => {}}
          className="sidebar-footer-button sidebar-footer-button-speech"
        >
          <FiMic size={18} className="sidebar-nav-icon" />
          {state.sidebarOpen && <span>Speech</span>}
        </button>
      </div>
    </aside>
  );
}
