import React from 'react';
import {
  FiDownload, FiPause, FiCalendar, FiSettings, FiZap,
  FiMessageSquare, FiImage, FiBox, FiSliders, FiSearch
} from 'react-icons/fi';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '@/context/AppContext';

const navItems = [
  { id: 'chat', icon: FiMessageSquare, label: 'Chat' },
  { id: 'generate', icon: FiImage, label: 'Generate' },
  // { id: 'models', icon: FiBox, label: 'Models' },
  // { id: 'settings', icon: FiSliders, label: 'Settings' },
];

export default function TopMenu() {
  const { state } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  const pathTab = location.pathname.split('/').filter(Boolean)[0] || 'chat';

  const goTo = (tab: string) => {
    navigate(tab === 'chat' ? '/' : `/${tab}`);
  };

  return (
    <nav className="topmenu">
      <div className="topmenu-brand">
        <div className="topmenu-logo-icon">
          <FiZap size={18} />
        </div>
        <span className="topmenu-logo-name">PANTRY</span>
        <br/><span className="header-version">v0.5.4</span>
      </div>

      <div className="topmenu-nav-wrap">
        <div className="topmenu-nav-pill">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = pathTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => goTo(item.id)}
                className={`topmenu-nav-item ${active ? 'active' : ''}`}
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="topmenu-right">
        <div className="topmenu-stats-pill">
          <div className="header-search">
            <FiSearch size={12} color="#8b949e" />
            <input
              placeholder="Search models, docs..."
              className="header-search-input"
            />
          </div>
        </div>

        <button className="topmenu-settings-btn" onClick={() => goTo('settings')}>
          <FiSettings size={18} />
        </button>
      </div>
    </nav>
  );
}