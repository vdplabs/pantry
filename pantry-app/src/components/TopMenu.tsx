import React, { useEffect, useState } from 'react';
import {
  FiSettings, FiZap,
  FiMessageSquare, FiCode, FiImage, FiMusic, FiMic, FiBox, FiCheckCircle, FiAlertCircle
} from 'react-icons/fi';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import api from '@/services/api';

const navItems = [
  { id: 'chat', icon: FiMessageSquare, label: 'Chat' },
  { id: 'code', icon: FiCode, label: 'Code & FIM' },
  { id: 'image', icon: FiImage, label: 'Image' },
  { id: 'music', icon: FiMusic, label: 'Music' },
  { id: 'stt', icon: FiMic, label: 'Audio & STT' },
  { id: 'models', icon: FiBox, label: 'Models' },
];

export default function TopMenu() {
  const { state } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [serverInfo, setServerInfo] = useState<{ version?: string; loadedCount?: number }>({});

  const pathTab = location.pathname.split('/').filter(Boolean)[0] || 'chat';

  useEffect(() => {
    let mounted = true;
    const checkHealth = () => {
      api.health()
        .then(res => {
          if (!mounted) return;
          setServerOnline(true);
          setServerInfo({
            version: res.version || 'v0.5.4',
            loadedCount: res.loaded?.length || 0,
          });
        })
        .catch(() => {
          if (!mounted) return;
          setServerOnline(false);
        });
    };
    checkHealth();
    const interval = setInterval(checkHealth, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const goTo = (tab: string) => {
    navigate(tab === 'chat' ? '/' : `/${tab}`);
  };

  return (
    <nav className="topmenu">
      <div className="topmenu-brand" onClick={() => goTo('chat')} role="button" tabIndex={0}>
        <div className="topmenu-logo-icon">
          <FiZap size={18} />
        </div>
        <div className="topmenu-brand-text">
          <span className="topmenu-logo-name">PANTRY</span>
          <span className="header-version">{serverInfo.version || 'v0.5.4'}</span>
        </div>
      </div>

      <div className="topmenu-nav-wrap">
        <div className="topmenu-nav-pill">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = pathTab === item.id || (item.id === 'chat' && (pathTab === '' || pathTab === 'chat'));
            return (
              <button
                key={item.id}
                onClick={() => goTo(item.id)}
                className={`topmenu-nav-item ${active ? 'active' : ''}`}
                title={item.label}
              >
                <Icon size={15} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="topmenu-right">
        {serverOnline !== null && (
          <div className={`topmenu-health-badge ${serverOnline ? 'online' : 'offline'}`}>
            {serverOnline ? (
              <>
                <FiCheckCircle size={13} />
                <span>Local Pantry Ready</span>
              </>
            ) : (
              <>
                <FiAlertCircle size={13} />
                <span>Server Offline</span>
              </>
            )}
          </div>
        )}

        <button 
          className={`topmenu-settings-btn ${pathTab === 'settings' ? 'active' : ''}`} 
          onClick={() => goTo('settings')}
          title="Settings & Diagnostics"
        >
          <FiSettings size={17} />
        </button>
      </div>
    </nav>
  );
}