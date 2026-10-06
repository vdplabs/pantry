import React, { useState } from 'react';
import {
  FiChevronDown,
  FiFileText,
  FiLayers,
  FiCpu,
  FiZap,
  FiPlus,
  FiShare2,
  FiDownload,
  FiCheck,
  FiMenu,
} from 'react-icons/fi';
import type { LensState, LensViewMode, LensPreset } from '../types';
import ArchitectureCanvas from './canvas/ArchitectureCanvas';
import CardsMasonryView from './cards/CardsMasonryView';
import DocumentView from './doc/DocumentView';
import { useApp } from '@/context/AppContext';

interface Props {
  state: LensState;
  framework?: string;
  onChange: (newState: LensState) => void;
  onSendPrompt: (prompt: string) => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  isChatCollapsed?: boolean;
  onToggleChat?: () => void;
}

const LENS_PRESETS: { id: LensPreset; title: string; subtitle: string; icon: string }[] = [
  {
    id: 'adr',
    title: 'Architecture Decision (ADR)',
    subtitle: 'System components, design choices, invariants & trade-offs',
    icon: '🏛️',
  },
  {
    id: 'threat_model',
    title: 'Security & Threat Model',
    subtitle: 'STRIDE perimeters, threat vectors, mitigations & boundaries',
    icon: '🛡️',
  },
  {
    id: 'research',
    title: 'System Research & Architecture',
    subtitle: 'Exploratory topology, data stores, external APIs & synthesis',
    icon: '🔬',
  },
];

export default function LensesWorkspace({
  state,
  framework,
  onChange,
  onSendPrompt,
  sidebarOpen,
  onToggleSidebar,
  isChatCollapsed,
  onToggleChat,
}: Props) {
  const { state: appState } = useApp();
  const isDark = (appState?.theme || state.theme || 'dark') === 'dark';
  const [showLensDropdown, setShowLensDropdown] = useState(false);

  const activeView: LensViewMode = state.activeView || 'architecture';

  const setView = (view: LensViewMode) => {
    onChange({
      ...state,
      activeView: view,
    });
  };

  const handleSelectPreset = (preset: LensPreset) => {
    setShowLensDropdown(false);
    const target = LENS_PRESETS.find(p => p.id === preset);
    onChange({
      ...state,
      preset,
      title: target ? target.title : state.title,
    });
  };

  const handleNavigateToCard = (cardId: string, _category: 'threats' | 'decisions' | 'invariants') => {
    onChange({
      ...state,
      activeView: 'cards',
    });
  };

  const totalCardsCount =
    (state.threats?.length || 0) +
    (state.decisions?.length || 0) +
    (state.invariants?.length || 0) +
    (state.findings?.length || 0);

  const handleAiReviewClick = () => {
    if (activeView === 'architecture') {
      onSendPrompt(
        `Conduct an AI Architectural Review of this topology.\n` +
        `Examine the ${state.components.length} components, ${state.connections.length} connections, and ${state.boundaries.length} boundary perimeters. ` +
        `Identify any single points of failure, missing trust boundaries, or unmitigated security paths.`
      );
    } else if (activeView === 'cards') {
      onSendPrompt(
        `Review the current cards register (${state.threats.length} threats, ${state.decisions.length} ADR decisions, ${state.invariants.length} invariants). ` +
        `Are there any unaddressed threats without ADR mitigations, or invariants that conflict with design choices?`
      );
    } else {
      onSendPrompt(
        `Review the synthesis document for consistency with the canvas architecture and threat model.`
      );
    }
  };

  const handleToggleMenu = onToggleSidebar || onToggleChat;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      backgroundColor: isDark ? '#0a0d14' : '#f8fafc',
      overflow: 'hidden',
    }}>
      {/* Top Lenses Header matching Screenshots */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '46px',
        padding: '0 16px',
        backgroundColor: isDark ? '#121824' : '#ffffff',
        borderBottom: `1px solid ${isDark ? '#1e2638' : '#e2e8f0'}`,
        zIndex: 20,
        userSelect: 'none',
      }}>
        {/* Left: Hamburger Chat List Toggle + Lens Selector Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* {handleToggleMenu && (
            <button
              type="button"
              onClick={handleToggleMenu}
              className="lenses-chat-toggle-btn"
              title={sidebarOpen ? "Hide Chat List" : "Show Chat List"}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '30px',
                height: '30px',
                borderRadius: '6px',
                backgroundColor: isDark ? '#182030' : '#f1f5f9',
                border: `1px solid ${isDark ? '#28354d' : '#e2e8f0'}`,
                color: sidebarOpen ? (isDark ? '#ffffff' : '#0f172a') : (isDark ? '#94a3b8' : '#64748b'),
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <FiMenu size={15} />
            </button>
          )} */}

          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowLensDropdown(prev => !prev)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                borderRadius: '6px',
                backgroundColor: isDark ? '#182030' : '#f1f5f9',
                border: `1px solid ${isDark ? '#28354d' : '#e2e8f0'}`,
                color: isDark ? '#e2e8f0' : '#0f172a',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background-color 0.15s ease',
              }}
            >
              <span style={{ color: isDark ? '#94a3b8' : '#64748b', fontWeight: 500 }}>Lens:</span>
              <span>{state.title || 'Architecture Decision (ADR)'}</span>
              <FiChevronDown size={13} style={{ color: isDark ? '#94a3b8' : '#64748b', marginLeft: '2px' }} />
            </button>

            {showLensDropdown && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: '6px',
                  width: '320px',
                  backgroundColor: isDark ? '#151c2a' : '#ffffff',
                  border: `1px solid ${isDark ? '#2a374e' : '#e2e8f0'}`,
                  borderRadius: '8px',
                  boxShadow: isDark ? '0 10px 25px -5px rgba(0,0,0,0.6)' : '0 10px 25px -5px rgba(0,0,0,0.1)',
                  padding: '6px',
                  zIndex: 100,
                }}
              >
                <div style={{
                  fontSize: '10.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: isDark ? '#64748b' : '#94a3b8',
                  padding: '6px 10px',
                  fontWeight: 600,
                }}>
                  Select Active Lens
                </div>
                {LENS_PRESETS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectPreset(p.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: 'none',
                      backgroundColor: state.preset === p.id ? (isDark ? '#1e293b' : '#f1f5f9') : 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s',
                    }}
                  >
                    <span style={{ fontSize: '16px', lineHeight: 1.2 }}>{p.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: isDark ? '#f1f5f9' : '#0f172a' }}>{p.title}</div>
                      <div style={{ fontSize: '11px', color: isDark ? '#94a3b8' : '#64748b', marginTop: '2px' }}>{p.subtitle}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Center: Segmented Navigation Switcher [ Document | Cards (20) | Architecture ] */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: isDark ? '#0d121c' : '#f1f5f9',
          padding: '3px',
          borderRadius: '7px',
          border: `1px solid ${isDark ? '#1e2638' : '#e2e8f0'}`,
        }}>
          <button
            onClick={() => setView('document')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 14px',
              borderRadius: '5px',
              border: 'none',
              backgroundColor: activeView === 'document' ? '#2563eb' : 'transparent',
              color: activeView === 'document' ? '#ffffff' : (isDark ? '#94a3b8' : '#64748b'),
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <FiFileText size={13} />
            <span>Document</span>
          </button>

          <button
            onClick={() => setView('cards')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 14px',
              borderRadius: '5px',
              border: 'none',
              backgroundColor: activeView === 'cards' ? '#2563eb' : 'transparent',
              color: activeView === 'cards' ? '#ffffff' : (isDark ? '#94a3b8' : '#64748b'),
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <FiLayers size={13} />
            <span>Cards ({totalCardsCount})</span>
          </button>

          <button
            onClick={() => setView('architecture')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 14px',
              borderRadius: '5px',
              border: 'none',
              backgroundColor: activeView === 'architecture' ? '#2563eb' : 'transparent',
              color: activeView === 'architecture' ? '#ffffff' : (isDark ? '#94a3b8' : '#64748b'),
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <FiCpu size={13} />
            <span>Architecture</span>
          </button>
        </div>

        {/* Right: + AI Review Action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={handleAiReviewClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 13px',
              borderRadius: '6px',
              backgroundColor: isDark ? '#1e293b' : '#f1f5f9',
              border: `1px solid ${isDark ? '#334155' : '#cbd5e1'}`,
              color: isDark ? '#cbd5e1' : '#334155',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            title="Ask AI to review the active lens for threats, architectural debt, or missing guarantees"
          >
            <FiZap size={13} style={{ color: '#818cf8' }} />
            <span>+ AI Review</span>
          </button>
        </div>
      </header>

      {/* Main View Area */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {activeView === 'architecture' && (
          <ArchitectureCanvas
            state={state}
            onChange={onChange}
            onSendPrompt={onSendPrompt}
            onNavigateToCard={handleNavigateToCard}
          />
        )}

        {activeView === 'cards' && (
          <CardsMasonryView
            state={state}
            onChange={onChange}
            onSendPrompt={onSendPrompt}
          />
        )}

        {activeView === 'document' && (
          <DocumentView
            state={state}
            onChange={onChange}
            onSendPrompt={onSendPrompt}
          />
        )}
      </div>
    </div>
  );
}
