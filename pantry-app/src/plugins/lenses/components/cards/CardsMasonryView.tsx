import React, { useState, useMemo } from 'react';
import {
  FiSearch, FiPlus, FiBookmark, FiEdit2, FiTrash2,
  FiShield, FiCheckCircle, FiCode, FiArrowRight, FiX, FiCheck, FiLayers,
  FiExternalLink
} from 'react-icons/fi';
import type {
  LensState,
  LensThreat,
  LensDecision,
  LensInvariant,
  ThreatSeverity,
  ThreatStatus,
  DecisionStatus,
} from '../../types';
import { useApp } from '@/context/AppContext';

interface Props {
  state: LensState;
  onChange: (newState: LensState) => void;
  onSendPrompt: (prompt: string) => void;
}

export default function CardsMasonryView({ state, onChange, onSendPrompt }: Props) {
  const { state: appState } = useApp();
  const isDark = (appState?.theme || state.theme || 'dark') === 'dark';
  const [activeCategory, setActiveCategory] = useState<'all' | 'findings' | 'threats' | 'decisions' | 'invariants'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Edit / Add Modal State
  const [editingItem, setEditingItem] = useState<{
    type: 'threat' | 'decision' | 'invariant';
    item: any;
    isNew?: boolean;
  } | null>(null);

  const totalCount =
    (state.threats?.length || 0) +
    (state.decisions?.length || 0) +
    (state.invariants?.length || 0) +
    (state.findings?.length || 0);

  // Filter items
  const filteredThreats = useMemo(() => {
    return (state.threats || []).filter(t => {
      if (activeCategory !== 'all' && activeCategory !== 'threats') return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return t.title.toLowerCase().includes(q) ||
             t.description.toLowerCase().includes(q) ||
             (t.threatActor && t.threatActor.toLowerCase().includes(q)) ||
             (t.componentName && t.componentName.toLowerCase().includes(q)) ||
             t.id.toLowerCase().includes(q);
    });
  }, [state.threats, activeCategory, searchQuery]);

  const filteredDecisions = useMemo(() => {
    return (state.decisions || []).filter(d => {
      if (activeCategory !== 'all' && activeCategory !== 'decisions') return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return d.title.toLowerCase().includes(q) ||
             d.approach.toLowerCase().includes(q) ||
             d.rationale.toLowerCase().includes(q) ||
             d.id.toLowerCase().includes(q);
    });
  }, [state.decisions, activeCategory, searchQuery]);

  const filteredInvariants = useMemo(() => {
    return (state.invariants || []).filter(i => {
      if (activeCategory !== 'all' && activeCategory !== 'invariants') return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return i.title.toLowerCase().includes(q) ||
             i.statement.toLowerCase().includes(q) ||
             i.id.toLowerCase().includes(q);
    });
  }, [state.invariants, activeCategory, searchQuery]);

  // Toggle Pin handlers
  const handleTogglePinThreat = (id: string) => {
    onChange({
      ...state,
      threats: state.threats.map(t => t.id === id ? { ...t, isPinned: !t.isPinned } : t),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleTogglePinDecision = (id: string) => {
    onChange({
      ...state,
      decisions: state.decisions.map(d => d.id === id ? { ...d, isPinned: !d.isPinned } : d),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleTogglePinInvariant = (id: string) => {
    onChange({
      ...state,
      invariants: state.invariants.map(i => i.id === id ? { ...i, isPinned: !i.isPinned } : i),
      updatedAt: new Date().toISOString(),
    });
  };

  // Delete handlers
  const handleDeleteThreat = (id: string) => {
    onChange({
      ...state,
      threats: state.threats.filter(t => t.id !== id),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleDeleteDecision = (id: string) => {
    onChange({
      ...state,
      decisions: state.decisions.filter(d => d.id !== id),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleDeleteInvariant = (id: string) => {
    onChange({
      ...state,
      invariants: state.invariants.filter(i => i.id !== id),
      updatedAt: new Date().toISOString(),
    });
  };

  // Save Modal
  const handleSaveModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    if (editingItem.type === 'threat') {
      const threat = editingItem.item as LensThreat;
      if (editingItem.isNew) {
        onChange({
          ...state,
          threats: [threat, ...state.threats],
          updatedAt: new Date().toISOString(),
        });
      } else {
        onChange({
          ...state,
          threats: state.threats.map(t => t.id === threat.id ? threat : t),
          updatedAt: new Date().toISOString(),
        });
      }
    } else if (editingItem.type === 'decision') {
      const dec = editingItem.item as LensDecision;
      if (editingItem.isNew) {
        onChange({
          ...state,
          decisions: [dec, ...state.decisions],
          updatedAt: new Date().toISOString(),
        });
      } else {
        onChange({
          ...state,
          decisions: state.decisions.map(d => d.id === dec.id ? dec : d),
          updatedAt: new Date().toISOString(),
        });
      }
    } else if (editingItem.type === 'invariant') {
      const inv = editingItem.item as LensInvariant;
      if (editingItem.isNew) {
        onChange({
          ...state,
          invariants: [inv, ...state.invariants],
          updatedAt: new Date().toISOString(),
        });
      } else {
        onChange({
          ...state,
          invariants: state.invariants.map(i => i.id === inv.id ? inv : i),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    setEditingItem(null);
  };

  // Theme-aware styles
  const themeStyles = {
    viewBg: isDark ? '#0b0f19' : '#f8fafc',
    headerBg: isDark ? '#121824' : '#ffffff',
    headerBorder: isDark ? '#1e2638' : '#e2e8f0',
    cardBg: isDark ? '#131c2a' : '#ffffff',
    cardBorder: isDark ? '#1f2e45' : '#e2e8f0',
    cardHoverBorder: isDark ? '#3b82f6' : '#cbd5e1',
    titleColor: isDark ? '#f8fafc' : '#0f172a',
    descColor: isDark ? '#94a3b8' : '#475569',
    subtextColor: isDark ? '#64748b' : '#94a3b8',
    pillBg: isDark ? '#1a2436' : '#f1f5f9',
    pillText: isDark ? '#cbd5e1' : '#475569',
    searchBg: isDark ? '#161f30' : '#f8fafc',
    searchBorder: isDark ? '#23324c' : '#e2e8f0',
    searchColor: isDark ? '#f1f5f9' : '#0f172a',
    flowBoxBg: isDark ? '#0f1623' : '#f8fafc',
    flowBoxBorder: isDark ? '#1e2b40' : '#e2e8f0',
    flowPillBg: isDark ? '#182336' : '#ffffff',
  };

  return (
    <div
      className="lens-cards-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: themeStyles.viewBg,
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Top Filter and Search Bar matching Screenshot 2 */}
      <div
        className="lens-cards-header"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '10px 18px',
          backgroundColor: themeStyles.headerBg,
          borderBottom: `1px solid ${themeStyles.headerBorder}`,
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          zIndex: 10,
          flexShrink: 0,
        }}
      >
        {/* Left: Category Filter Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflowX: 'auto' }}>
          <button
            type="button"
            onClick={() => setActiveCategory('all')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              borderRadius: '9999px',
              fontSize: '11.5px',
              fontWeight: 700,
              cursor: 'pointer',
              border: activeCategory === 'all' ? '1px solid #2563eb' : `1px solid ${themeStyles.cardBorder}`,
              backgroundColor: activeCategory === 'all' ? '#2563eb' : themeStyles.cardBg,
              color: activeCategory === 'all' ? '#ffffff' : themeStyles.descColor,
              transition: 'all 0.15s ease',
            }}
          >
            <span>All</span>
            <span style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '9999px',
              backgroundColor: activeCategory === 'all' ? 'rgba(0,0,0,0.25)' : themeStyles.pillBg,
              color: activeCategory === 'all' ? '#ffffff' : themeStyles.descColor,
              fontWeight: 800,
            }}>
              {totalCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveCategory('findings')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 12px',
              borderRadius: '9999px',
              fontSize: '11.5px',
              fontWeight: 600,
              cursor: 'pointer',
              border: activeCategory === 'findings' ? '1px solid #2563eb' : `1px solid ${themeStyles.cardBorder}`,
              backgroundColor: activeCategory === 'findings' ? '#2563eb' : themeStyles.cardBg,
              color: activeCategory === 'findings' ? '#ffffff' : themeStyles.descColor,
            }}
          >
            <FiLayers size={11} />
            <span>Findings</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveCategory('threats')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              borderRadius: '9999px',
              fontSize: '11.5px',
              fontWeight: 600,
              cursor: 'pointer',
              border: activeCategory === 'threats' ? '1px solid #dc2626' : `1px solid ${themeStyles.cardBorder}`,
              backgroundColor: activeCategory === 'threats' ? '#dc2626' : themeStyles.cardBg,
              color: activeCategory === 'threats' ? '#ffffff' : themeStyles.descColor,
            }}
          >
            <FiShield size={11} style={{ color: activeCategory === 'threats' ? '#fff' : '#ef4444' }} />
            <span>Threats</span>
            <span style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '9999px',
              backgroundColor: activeCategory === 'threats' ? 'rgba(0,0,0,0.25)' : isDark ? '#261719' : '#fee2e2',
              color: activeCategory === 'threats' ? '#ffffff' : '#ef4444',
              fontWeight: 800,
            }}>
              {state.threats.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveCategory('decisions')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              borderRadius: '9999px',
              fontSize: '11.5px',
              fontWeight: 600,
              cursor: 'pointer',
              border: activeCategory === 'decisions' ? '1px solid #d97706' : `1px solid ${themeStyles.cardBorder}`,
              backgroundColor: activeCategory === 'decisions' ? '#d97706' : themeStyles.cardBg,
              color: activeCategory === 'decisions' ? '#ffffff' : themeStyles.descColor,
            }}
          >
            <FiCheckCircle size={11} style={{ color: activeCategory === 'decisions' ? '#fff' : '#f59e0b' }} />
            <span>Decisions</span>
            <span style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '9999px',
              backgroundColor: activeCategory === 'decisions' ? 'rgba(0,0,0,0.25)' : isDark ? '#261f14' : '#fef3c7',
              color: activeCategory === 'decisions' ? '#ffffff' : '#f59e0b',
              fontWeight: 800,
            }}>
              {state.decisions.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveCategory('invariants')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              borderRadius: '9999px',
              fontSize: '11.5px',
              fontWeight: 600,
              cursor: 'pointer',
              border: activeCategory === 'invariants' ? '1px solid #9333ea' : `1px solid ${themeStyles.cardBorder}`,
              backgroundColor: activeCategory === 'invariants' ? '#9333ea' : themeStyles.cardBg,
              color: activeCategory === 'invariants' ? '#ffffff' : themeStyles.descColor,
            }}
          >
            <FiCode size={11} style={{ color: activeCategory === 'invariants' ? '#fff' : '#a855f7' }} />
            <span>Invariants</span>
            <span style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '9999px',
              backgroundColor: activeCategory === 'invariants' ? 'rgba(0,0,0,0.25)' : isDark ? '#23182b' : '#f3e8ff',
              color: activeCategory === 'invariants' ? '#ffffff' : '#a855f7',
              fontWeight: 800,
            }}>
              {state.invariants.length}
            </span>
          </button>
        </div>

        {/* Center/Right: Search and Add Item */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ position: 'relative', width: '280px' }}>
            <FiSearch size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: themeStyles.subtextColor }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search findings, decisions, threats..."
              style={{
                width: '100%',
                padding: '6px 10px 6px 30px',
                borderRadius: '8px',
                border: `1px solid ${themeStyles.searchBorder}`,
                backgroundColor: themeStyles.searchBg,
                color: themeStyles.searchColor,
                fontSize: '12px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowAddMenu(!showAddMenu)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '8px',
                backgroundColor: '#2563eb',
                border: '1px solid #1d4ed8',
                color: '#ffffff',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }}
            >
              <FiPlus size={13} />
              <span>Add Item</span>
            </button>

            {showAddMenu && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '100%',
                  marginTop: '6px',
                  width: '180px',
                  borderRadius: '10px',
                  backgroundColor: isDark ? '#151c2a' : '#ffffff',
                  border: `1px solid ${themeStyles.cardBorder}`,
                  boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
                  padding: '4px',
                  zIndex: 50,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
                onClick={() => setShowAddMenu(false)}
              >
                <button
                  type="button"
                  onClick={() => setEditingItem({
                    type: 'threat',
                    isNew: true,
                    item: {
                      id: `THR-${String(state.threats.length + 1).padStart(2, '0')}`,
                      title: '',
                      componentId: state.components[0]?.id || '',
                      componentName: state.components[0]?.name || '',
                      category: 'Elevation of Privilege',
                      description: '',
                      mitigation: '',
                      severity: 'High',
                      likelihood: 'Medium',
                      risk: 'High',
                      status: 'Open',
                    },
                  })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    color: '#ef4444',
                    fontSize: '12px',
                    fontWeight: 600,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <FiShield size={13} />
                  <span>New Threat</span>
                </button>

                <button
                  type="button"
                  onClick={() => setEditingItem({
                    type: 'decision',
                    isNew: true,
                    item: {
                      id: `ADR-${String(state.decisions.length + 1).padStart(2, '0')}`,
                      title: '',
                      componentId: state.components[0]?.id || '',
                      componentName: state.components[0]?.name || '',
                      approach: '',
                      rationale: '',
                      status: 'Proposed',
                    },
                  })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    color: '#f59e0b',
                    fontSize: '12px',
                    fontWeight: 600,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <FiCheckCircle size={13} />
                  <span>New Decision (ADR)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setEditingItem({
                    type: 'invariant',
                    isNew: true,
                    item: {
                      id: `INV-${String(state.invariants.length + 1).padStart(2, '0')}`,
                      title: '',
                      componentId: state.components[0]?.id || '',
                      componentName: state.components[0]?.name || '',
                      statement: '',
                      category: 'Automated Policy / Runtime Verification',
                      status: 'Enforced',
                    },
                  })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    color: '#a855f7',
                    fontSize: '12px',
                    fontWeight: 600,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <FiCode size={13} />
                  <span>New Invariant</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Masonry Layout Grid matching Screenshot 2 */}
      <div
        className="lens-cards-scroll-body"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 28px',
        }}
      >
        <div
          className="lens-masonry-grid"
          style={{
            columnCount: 4,
            columnGap: '18px',
            width: '100%',
          }}
        >
          {/* Threats */}
          {filteredThreats.map(threat => (
            <div
              key={threat.id}
              className="lens-card-item"
              style={{
                breakInside: 'avoid',
                marginBottom: '18px',
                borderRadius: '12px',
                backgroundColor: themeStyles.cardBg,
                border: `1px solid ${themeStyles.cardBorder}`,
                boxShadow: isDark ? '0 4px 14px rgba(0,0,0,0.25)' : '0 2px 8px rgba(0,0,0,0.06)',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'all 0.15s ease',
              }}
            >
              <div>
                {/* Header matching Screenshot 2 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, color: '#ef4444' }}>
                    <FiShield size={12} />
                    <span>Threat • {threat.id}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: themeStyles.subtextColor }}>
                    <button
                      type="button"
                      title={threat.isPinned ? "Unpin card" : "Pin card"}
                      onClick={() => handleTogglePinThreat(threat.id)}
                      style={{
                        padding: '4px',
                        borderRadius: '4px',
                        border: 'none',
                        background: 'transparent',
                        color: threat.isPinned ? '#3b82f6' : themeStyles.subtextColor,
                        cursor: 'pointer',
                      }}
                    >
                      <FiBookmark size={13} />
                    </button>
                    <button
                      type="button"
                      title="Edit card"
                      onClick={() => setEditingItem({ type: 'threat', item: threat })}
                      style={{
                        padding: '4px',
                        borderRadius: '4px',
                        border: 'none',
                        background: 'transparent',
                        color: themeStyles.subtextColor,
                        cursor: 'pointer',
                      }}
                    >
                      <FiEdit2 size={12} />
                    </button>
                    <button
                      type="button"
                      title="Delete card"
                      onClick={() => handleDeleteThreat(threat.id)}
                      style={{
                        padding: '4px',
                        borderRadius: '4px',
                        border: 'none',
                        background: 'transparent',
                        color: '#ef4444',
                        cursor: 'pointer',
                      }}
                    >
                      <FiTrash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Title */}
                <div style={{ fontWeight: 700, fontSize: '13.5px', color: themeStyles.titleColor, lineHeight: 1.35, marginBottom: '8px' }}>
                  {threat.title}
                </div>

                {/* Metadata Pills */}
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                  {threat.componentName && (
                    <span style={{
                      padding: '2px 7px',
                      borderRadius: '5px',
                      backgroundColor: themeStyles.pillBg,
                      color: themeStyles.pillText,
                      fontFamily: 'monospace',
                      fontSize: '10px',
                      fontWeight: 600,
                    }}>
                      {threat.componentName}
                    </span>
                  )}
                  <span style={{
                    padding: '2px 7px',
                    borderRadius: '5px',
                    backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#f8fafc',
                    border: `1px solid ${themeStyles.cardBorder}`,
                    color: themeStyles.descColor,
                    fontSize: '10px',
                    fontWeight: 500,
                  }}>
                    {threat.category}
                  </span>
                </div>

                {/* Threat Actor flow diagram (Actor -> Vector -> Target) */}
                {threat.threatActor && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    backgroundColor: themeStyles.flowBoxBg,
                    border: `1px solid ${themeStyles.flowBoxBorder}`,
                    fontSize: '9.5px',
                    color: themeStyles.descColor,
                    marginBottom: '10px',
                  }}>
                    <span style={{
                      padding: '2px 5px',
                      borderRadius: '4px',
                      backgroundColor: themeStyles.flowPillBg,
                      border: `1px solid ${themeStyles.cardBorder}`,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '85px',
                      fontWeight: 600,
                    }} title={threat.threatActor}>
                      {threat.threatActor}
                    </span>
                    <FiArrowRight size={10} style={{ color: themeStyles.subtextColor, flexShrink: 0 }} />
                    <span style={{
                      padding: '2px 5px',
                      borderRadius: '4px',
                      backgroundColor: themeStyles.flowPillBg,
                      border: `1px solid ${themeStyles.cardBorder}`,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }} title={threat.attackVector || 'Vector'}>
                      {threat.attackVector || 'Attack Vector'}
                    </span>
                    <FiArrowRight size={10} style={{ color: themeStyles.subtextColor, flexShrink: 0 }} />
                    <span style={{
                      padding: '2px 5px',
                      borderRadius: '4px',
                      backgroundColor: themeStyles.flowPillBg,
                      border: `1px solid ${themeStyles.cardBorder}`,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '85px',
                      fontWeight: 600,
                    }} title={threat.componentName}>
                      {threat.componentName || 'Target'}
                    </span>
                  </div>
                )}

                {/* Description */}
                <div style={{ fontSize: '11.5px', color: themeStyles.descColor, lineHeight: 1.55, marginBottom: '10px' }}>
                  {threat.description}
                </div>

                {/* Targeted Asset if present */}
                {threat.targetedAsset && (
                  <div style={{ fontSize: '10.5px', color: themeStyles.subtextColor, marginBottom: '8px' }}>
                    <span style={{ fontWeight: 600 }}>Targeted Asset:</span> {threat.targetedAsset}
                  </div>
                )}

                {/* Mitigation / Action Callout */}
                {threat.mitigation && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '6px',
                    padding: '8px 10px',
                    borderRadius: '7px',
                    backgroundColor: isDark ? 'rgba(37, 99, 235, 0.12)' : '#eff6ff',
                    border: isDark ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid #bfdbfe',
                    color: isDark ? '#93c5fd' : '#1e40af',
                    fontSize: '11px',
                    marginBottom: '10px',
                  }}>
                    <FiCheck size={12} style={{ color: '#3b82f6', marginTop: '2px', flexShrink: 0 }} />
                    <div style={{ fontWeight: 500, lineHeight: 1.4 }}>{threat.mitigation}</div>
                  </div>
                )}

                {/* Linked ADR pill if present */}
                {threat.linkedAdrId && (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 7px',
                    borderRadius: '4px',
                    backgroundColor: isDark ? 'rgba(59, 130, 246, 0.15)' : '#eff6ff',
                    border: isDark ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid #bfdbfe',
                    color: isDark ? '#60a5fa' : '#1d4ed8',
                    fontSize: '10px',
                    fontWeight: 700,
                    marginBottom: '10px',
                    marginRight: '6px',
                  }}>
                    <span>ADR: {threat.linkedAdrId}</span>
                  </div>
                )}

                {/* Reference Link if present */}
                {threat.url && (
                  <div style={{ marginBottom: '10px' }}>
                    <a
                      href={threat.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: isDark ? 'rgba(239, 68, 68, 0.12)' : '#fef2f2',
                        border: isDark ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid #fecaca',
                        color: '#ef4444',
                        fontSize: '10px',
                        fontWeight: 600,
                        textDecoration: 'none',
                      }}
                    >
                      <span>Documentation / Reference</span>
                      <FiExternalLink size={10} />
                    </a>
                  </div>
                )}
              </div>

              {/* Footer matching Screenshot 2 (Severity, Likelihood, Risk, Status) */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '10px',
                borderTop: `1px solid ${themeStyles.cardBorder}`,
                fontSize: '10px',
                fontWeight: 700,
                color: themeStyles.descColor,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ padding: '2px 5px', borderRadius: '4px', backgroundColor: themeStyles.pillBg }}>{threat.severity}</span>
                  <span style={{ padding: '2px 5px', borderRadius: '4px', backgroundColor: themeStyles.pillBg }}>L: {threat.likelihood}</span>
                  <span style={{ padding: '2px 5px', borderRadius: '4px', backgroundColor: themeStyles.pillBg }}>Risk: {threat.risk}</span>
                </div>
                <span style={{
                  padding: '2px 7px',
                  borderRadius: '4px',
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  color: threat.status === 'Open' ? '#ef4444' : '#10b981',
                  backgroundColor: threat.status === 'Open' ? (isDark ? 'rgba(239, 68, 68, 0.15)' : '#fef2f2') : (isDark ? 'rgba(16, 185, 129, 0.15)' : '#ecfdf5'),
                  border: threat.status === 'Open' ? (isDark ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid #fecaca') : (isDark ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid #a7f3d0'),
                }}>
                  {threat.status}
                </span>
              </div>
            </div>
          ))}

          {/* Decisions / ADRs */}
          {filteredDecisions.map(decision => (
            <div
              key={decision.id}
              className="lens-card-item"
              style={{
                breakInside: 'avoid',
                marginBottom: '18px',
                borderRadius: '12px',
                backgroundColor: themeStyles.cardBg,
                border: `1px solid ${themeStyles.cardBorder}`,
                boxShadow: isDark ? '0 4px 14px rgba(0,0,0,0.25)' : '0 2px 8px rgba(0,0,0,0.06)',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'all 0.15s ease',
              }}
            >
              <div>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, color: '#f59e0b' }}>
                    <FiCheckCircle size={12} />
                    <span>Decision • {decision.id}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: themeStyles.subtextColor }}>
                    <button
                      type="button"
                      title={decision.isPinned ? "Unpin card" : "Pin card"}
                      onClick={() => handleTogglePinDecision(decision.id)}
                      style={{
                        padding: '4px',
                        borderRadius: '4px',
                        border: 'none',
                        background: 'transparent',
                        color: decision.isPinned ? '#3b82f6' : themeStyles.subtextColor,
                        cursor: 'pointer',
                      }}
                    >
                      <FiBookmark size={13} />
                    </button>
                    <button
                      type="button"
                      title="Edit card"
                      onClick={() => setEditingItem({ type: 'decision', item: decision })}
                      style={{
                        padding: '4px',
                        borderRadius: '4px',
                        border: 'none',
                        background: 'transparent',
                        color: themeStyles.subtextColor,
                        cursor: 'pointer',
                      }}
                    >
                      <FiEdit2 size={12} />
                    </button>
                    <button
                      type="button"
                      title="Delete card"
                      onClick={() => handleDeleteDecision(decision.id)}
                      style={{
                        padding: '4px',
                        borderRadius: '4px',
                        border: 'none',
                        background: 'transparent',
                        color: '#ef4444',
                        cursor: 'pointer',
                      }}
                    >
                      <FiTrash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Title */}
                <div style={{ fontWeight: 700, fontSize: '13.5px', color: themeStyles.titleColor, lineHeight: 1.35, marginBottom: '10px' }}>
                  {decision.title}
                </div>

                {/* Approach Box */}
                {decision.approach && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '6px',
                    padding: '8px 10px',
                    borderRadius: '7px',
                    backgroundColor: isDark ? 'rgba(59, 130, 246, 0.12)' : '#eff6ff',
                    border: isDark ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid #bfdbfe',
                    color: isDark ? '#93c5fd' : '#1e40af',
                    fontSize: '11px',
                    fontWeight: 500,
                    lineHeight: 1.4,
                    marginBottom: '10px',
                  }}>
                    <FiCheckCircle size={12} style={{ color: '#3b82f6', marginTop: '2px', flexShrink: 0 }} />
                    <div>{decision.approach}</div>
                  </div>
                )}

                {/* Rationale */}
                <div style={{ fontSize: '11.5px', color: themeStyles.descColor, lineHeight: 1.55, marginBottom: '10px' }}>
                  {decision.rationale}
                </div>

                {/* Alternatives */}
                {decision.alternatives && (
                  <div style={{ fontSize: '10.5px', color: themeStyles.subtextColor, fontStyle: 'italic', marginBottom: '10px' }}>
                    {decision.alternatives}
                  </div>
                )}

                {/* Reference Link if present */}
                {decision.url && (
                  <div style={{ marginBottom: '10px' }}>
                    <a
                      href={decision.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: isDark ? 'rgba(245, 158, 11, 0.12)' : '#fef3c7',
                        border: isDark ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid #fde68a',
                        color: '#f59e0b',
                        fontSize: '10px',
                        fontWeight: 600,
                        textDecoration: 'none',
                      }}
                    >
                      <span>Design Document / Reference</span>
                      <FiExternalLink size={10} />
                    </a>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '10px',
                borderTop: `1px solid ${themeStyles.cardBorder}`,
                fontSize: '10px',
                fontWeight: 700,
              }}>
                <span style={{ color: themeStyles.subtextColor }}>Status</span>
                <span style={{
                  padding: '2px 7px',
                  borderRadius: '4px',
                  fontWeight: 900,
                  color: decision.status === 'Approved' ? '#10b981' : '#f59e0b',
                  backgroundColor: decision.status === 'Approved' ? (isDark ? 'rgba(16, 185, 129, 0.15)' : '#ecfdf5') : (isDark ? 'rgba(245, 158, 11, 0.15)' : '#fffbeb'),
                  border: decision.status === 'Approved' ? (isDark ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid #a7f3d0') : (isDark ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid #fde68a'),
                }}>
                  {decision.status}
                </span>
              </div>
            </div>
          ))}

          {/* Invariants */}
          {filteredInvariants.map(invariant => (
            <div
              key={invariant.id}
              className="lens-card-item"
              style={{
                breakInside: 'avoid',
                marginBottom: '18px',
                borderRadius: '12px',
                backgroundColor: themeStyles.cardBg,
                border: `1px solid ${themeStyles.cardBorder}`,
                boxShadow: isDark ? '0 4px 14px rgba(0,0,0,0.25)' : '0 2px 8px rgba(0,0,0,0.06)',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'all 0.15s ease',
              }}
            >
              <div>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, color: '#a855f7' }}>
                    <FiCode size={12} />
                    <span>Invariant • {invariant.id}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: themeStyles.subtextColor }}>
                    <button
                      type="button"
                      title={invariant.isPinned ? "Unpin card" : "Pin card"}
                      onClick={() => handleTogglePinInvariant(invariant.id)}
                      style={{
                        padding: '4px',
                        borderRadius: '4px',
                        border: 'none',
                        background: 'transparent',
                        color: invariant.isPinned ? '#3b82f6' : themeStyles.subtextColor,
                        cursor: 'pointer',
                      }}
                    >
                      <FiBookmark size={13} />
                    </button>
                    <button
                      type="button"
                      title="Edit card"
                      onClick={() => setEditingItem({ type: 'invariant', item: invariant })}
                      style={{
                        padding: '4px',
                        borderRadius: '4px',
                        border: 'none',
                        background: 'transparent',
                        color: themeStyles.subtextColor,
                        cursor: 'pointer',
                      }}
                    >
                      <FiEdit2 size={12} />
                    </button>
                    <button
                      type="button"
                      title="Delete card"
                      onClick={() => handleDeleteInvariant(invariant.id)}
                      style={{
                        padding: '4px',
                        borderRadius: '4px',
                        border: 'none',
                        background: 'transparent',
                        color: '#ef4444',
                        cursor: 'pointer',
                      }}
                    >
                      <FiTrash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Title */}
                <div style={{ fontWeight: 700, fontSize: '13.5px', color: themeStyles.titleColor, lineHeight: 1.35, marginBottom: '10px' }}>
                  {invariant.title}
                </div>

                {/* Statement Callout */}
                <div style={{
                  padding: '8px 10px',
                  borderRadius: '7px',
                  backgroundColor: isDark ? 'rgba(168, 85, 247, 0.12)' : '#fdf4ff',
                  border: isDark ? '1px solid rgba(168, 85, 247, 0.3)' : '1px solid #f0abfc',
                  color: isDark ? '#d8b4fe' : '#7e22ce',
                  fontSize: '11.5px',
                  lineHeight: 1.5,
                  marginBottom: '10px',
                }}>
                  {invariant.statement}
                </div>

                {/* Category & Component */}
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', fontSize: '10px', color: themeStyles.subtextColor, marginBottom: '8px' }}>
                  {invariant.componentName && (
                    <span style={{
                      padding: '2px 7px',
                      borderRadius: '5px',
                      backgroundColor: themeStyles.pillBg,
                      color: themeStyles.pillText,
                      fontFamily: 'monospace',
                      fontWeight: 600,
                    }}>
                      {invariant.componentName}
                    </span>
                  )}
                  <span>{invariant.category}</span>
                </div>

                {/* Enforcement Mechanism if present */}
                {invariant.enforcementMechanism && (
                  <div style={{ fontSize: '10.5px', color: themeStyles.descColor, marginBottom: '8px' }}>
                    <span style={{ fontWeight: 600 }}>Enforcement:</span> {invariant.enforcementMechanism}
                  </div>
                )}

                {/* Reference Link if present */}
                {invariant.url && (
                  <div style={{ marginBottom: '10px' }}>
                    <a
                      href={invariant.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: isDark ? 'rgba(168, 85, 247, 0.12)' : '#faf5ff',
                        border: isDark ? '1px solid rgba(168, 85, 247, 0.35)' : '1px solid #e9d5ff',
                        color: '#a855f7',
                        fontSize: '10px',
                        fontWeight: 600,
                        textDecoration: 'none',
                      }}
                    >
                      <span>Specification / Reference</span>
                      <FiExternalLink size={10} />
                    </a>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '10px',
                borderTop: `1px solid ${themeStyles.cardBorder}`,
                fontSize: '10px',
                fontWeight: 700,
              }}>
                <span style={{ color: themeStyles.subtextColor }}>Verification</span>
                <span style={{
                  padding: '2px 7px',
                  borderRadius: '4px',
                  fontWeight: 900,
                  color: '#10b981',
                  backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : '#ecfdf5',
                  border: isDark ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid #a7f3d0',
                }}>
                  {invariant.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Edit / Add Modal */}
      {editingItem && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: '16px',
        }}>
          <div style={{
            width: '100%',
            maxWidth: '520px',
            backgroundColor: isDark ? '#141d2d' : '#ffffff',
            border: `1px solid ${themeStyles.cardBorder}`,
            borderRadius: '16px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 18px',
              borderBottom: `1px solid ${themeStyles.cardBorder}`,
              backgroundColor: isDark ? '#111824' : '#f8fafc',
            }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: themeStyles.titleColor }}>
                {editingItem.isNew ? 'Create New' : 'Edit'} {editingItem.type.toUpperCase()}
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                style={{ border: 'none', background: 'transparent', color: themeStyles.subtextColor, cursor: 'pointer' }}
              >
                <FiX size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveModal} style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: themeStyles.descColor, marginBottom: '4px' }}>Title</label>
                <input
                  type="text"
                  required
                  value={editingItem.item.title || ''}
                  onChange={(e) => setEditingItem({
                    ...editingItem,
                    item: { ...editingItem.item, title: e.target.value },
                  })}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '7px',
                    border: `1px solid ${themeStyles.searchBorder}`,
                    backgroundColor: themeStyles.searchBg,
                    color: themeStyles.searchColor,
                    fontSize: '12px',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>

              {editingItem.type === 'threat' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: themeStyles.descColor, marginBottom: '4px' }}>Description</label>
                    <textarea
                      rows={3}
                      value={editingItem.item.description || ''}
                      onChange={(e) => setEditingItem({
                        ...editingItem,
                        item: { ...editingItem.item, description: e.target.value },
                      })}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '7px',
                        border: `1px solid ${themeStyles.searchBorder}`,
                        backgroundColor: themeStyles.searchBg,
                        color: themeStyles.searchColor,
                        fontSize: '12px',
                        boxSizing: 'border-box',
                        outline: 'none',
                        resize: 'none',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: themeStyles.descColor, marginBottom: '4px' }}>Mitigation</label>
                    <input
                      type="text"
                      value={editingItem.item.mitigation || ''}
                      onChange={(e) => setEditingItem({
                        ...editingItem,
                        item: { ...editingItem.item, mitigation: e.target.value },
                      })}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '7px',
                        border: `1px solid ${themeStyles.searchBorder}`,
                        backgroundColor: themeStyles.searchBg,
                        color: themeStyles.searchColor,
                        fontSize: '12px',
                        boxSizing: 'border-box',
                        outline: 'none',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: themeStyles.descColor, marginBottom: '4px' }}>Targeted Asset</label>
                    <input
                      type="text"
                      placeholder="e.g. Transaction data in PostgreSQL"
                      value={editingItem.item.targetedAsset || ''}
                      onChange={(e) => setEditingItem({
                        ...editingItem,
                        item: { ...editingItem.item, targetedAsset: e.target.value },
                      })}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '7px',
                        border: `1px solid ${themeStyles.searchBorder}`,
                        backgroundColor: themeStyles.searchBg,
                        color: themeStyles.searchColor,
                        fontSize: '12px',
                        boxSizing: 'border-box',
                        outline: 'none',
                      }}
                    />
                  </div>
                </>
              )}

              {editingItem.type === 'decision' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: themeStyles.descColor, marginBottom: '4px' }}>Approach</label>
                    <textarea
                      rows={2}
                      value={editingItem.item.approach || ''}
                      onChange={(e) => setEditingItem({
                        ...editingItem,
                        item: { ...editingItem.item, approach: e.target.value },
                      })}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '7px',
                        border: `1px solid ${themeStyles.searchBorder}`,
                        backgroundColor: themeStyles.searchBg,
                        color: themeStyles.searchColor,
                        fontSize: '12px',
                        boxSizing: 'border-box',
                        outline: 'none',
                        resize: 'none',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: themeStyles.descColor, marginBottom: '4px' }}>Rationale</label>
                    <textarea
                      rows={2}
                      value={editingItem.item.rationale || ''}
                      onChange={(e) => setEditingItem({
                        ...editingItem,
                        item: { ...editingItem.item, rationale: e.target.value },
                      })}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '7px',
                        border: `1px solid ${themeStyles.searchBorder}`,
                        backgroundColor: themeStyles.searchBg,
                        color: themeStyles.searchColor,
                        fontSize: '12px',
                        boxSizing: 'border-box',
                        outline: 'none',
                        resize: 'none',
                      }}
                    />
                  </div>
                </>
              )}

              {editingItem.type === 'invariant' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: themeStyles.descColor, marginBottom: '4px' }}>Statement</label>
                    <textarea
                      rows={3}
                      value={editingItem.item.statement || ''}
                      onChange={(e) => setEditingItem({
                        ...editingItem,
                        item: { ...editingItem.item, statement: e.target.value },
                      })}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '7px',
                        border: `1px solid ${themeStyles.searchBorder}`,
                        backgroundColor: themeStyles.searchBg,
                        color: themeStyles.searchColor,
                        fontSize: '12px',
                        boxSizing: 'border-box',
                        outline: 'none',
                        resize: 'none',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: themeStyles.descColor, marginBottom: '4px' }}>Enforcement Mechanism</label>
                    <input
                      type="text"
                      placeholder="e.g. Cache Eviction Policies Misconfiguration"
                      value={editingItem.item.enforcementMechanism || ''}
                      onChange={(e) => setEditingItem({
                        ...editingItem,
                        item: { ...editingItem.item, enforcementMechanism: e.target.value },
                      })}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '7px',
                        border: `1px solid ${themeStyles.searchBorder}`,
                        backgroundColor: themeStyles.searchBg,
                        color: themeStyles.searchColor,
                        fontSize: '12px',
                        boxSizing: 'border-box',
                        outline: 'none',
                      }}
                    />
                  </div>
                </>
              )}

              {/* Reference URL for all item types */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: themeStyles.descColor, marginBottom: '4px' }}>Reference URL / Link</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={editingItem.item.url || ''}
                  onChange={(e) => setEditingItem({
                    ...editingItem,
                    item: { ...editingItem.item, url: e.target.value },
                  })}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '7px',
                    border: `1px solid ${themeStyles.searchBorder}`,
                    backgroundColor: themeStyles.searchBg,
                    color: themeStyles.searchColor,
                    fontSize: '12px',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '7px',
                    border: `1px solid ${themeStyles.cardBorder}`,
                    backgroundColor: 'transparent',
                    color: themeStyles.descColor,
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '6px 16px',
                    borderRadius: '7px',
                    border: '1px solid #1d4ed8',
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Save Card
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
