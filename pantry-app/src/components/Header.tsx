import React from 'react';
import { FiSearch, FiRefreshCw } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';

export default function Header() {
  const { state } = useApp();

  return (
    <header className="header">
      <div className="header-left">
        <div className="header-brand">
          <span className="header-name">pantry</span>
          <span className="header-version">v0.5.4</span>
        </div>
        <span className="header-separator" />
        <span className="header-tab">
          {state.activeTab}
        </span>
      </div>

      <div className="header-right">
        <div className="header-search">
          <FiSearch size={12} color="#8b949e" />
          <input
            placeholder="Search models, docs..."
            className="header-search-input"
          />
        </div>
        <button className="header-refresh">
          <FiRefreshCw size={11} />
          Refresh
        </button>
      </div>
    </header>
  );
}
