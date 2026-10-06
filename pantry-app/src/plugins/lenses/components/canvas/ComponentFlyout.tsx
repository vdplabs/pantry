import React from 'react';
import {
  FiShield, FiCheckCircle, FiMessageSquare,
  FiZap, FiX, FiExternalLink, FiCode
} from 'react-icons/fi';
import type { LensComponent, LensThreat, LensDecision, LensInvariant } from '../../types';

interface Props {
  component: LensComponent;
  threats: LensThreat[];
  decisions: LensDecision[];
  invariants: LensInvariant[];
  side?: 'left' | 'right';
  theme?: 'dark' | 'light';
  onClose: () => void;
  onNavigateToCard: (cardId: string, category: 'threats' | 'decisions' | 'invariants') => void;
  onChatAboutComponent: (component: LensComponent) => void;
  onRecommendDependencies: (component: LensComponent) => void;
  onGenerateThreats: (component: LensComponent) => void;
  onGenerateDecisions: (component: LensComponent) => void;
}

export default function ComponentFlyout({
  component,
  threats,
  decisions,
  invariants,
  side = 'left',
  theme = 'dark',
  onClose,
  onNavigateToCard,
  onChatAboutComponent,
  onRecommendDependencies,
  onGenerateThreats,
  onGenerateDecisions,
}: Props) {
  const isDark = theme === 'dark';
  const componentThreats = threats.filter(t => t.componentId === component.id);
  const componentDecisions = decisions.filter(d => d.componentId === component.id);
  const componentInvariants = invariants.filter(i => i.componentId === component.id);

  const leftPosition = side === 'left'
    ? `${component.x - 305}px`
    : `${component.x + (component.width || 200) + 15}px`;

  const bg = isDark ? '#141d2d' : '#ffffff';
  const border = isDark ? '#23324c' : '#cbd5e1';
  const text = isDark ? '#f8fafc' : '#0f172a';
  const subtext = isDark ? '#94a3b8' : '#64748b';
  const headerBg = isDark ? '#111824' : '#f8fafc';

  return (
    <div
      className="lens-component-flyout"
      style={{
        position: 'absolute',
        zIndex: 50,
        width: '290px',
        left: leftPosition,
        top: `${component.y - 15}px`,
        borderRadius: '12px',
        backgroundColor: bg,
        border: `1px solid ${border}`,
        boxShadow: isDark ? '0 16px 40px rgba(0, 0, 0, 0.4)' : '0 16px 36px rgba(0, 0, 0, 0.16)',
        backdropFilter: 'blur(12px)',
        overflow: 'hidden',
        color: text,
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '9px 12px',
        backgroundColor: headerBg,
        borderBottom: `1px solid ${border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#3b82f6' }} />
          <div style={{ fontSize: '12px', fontWeight: 700, color: text, maxWidth: '190px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {component.name}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            border: 'none',
            background: 'transparent',
            color: subtext,
            cursor: 'pointer',
            padding: '2px',
          }}
        >
          <FiX size={14} />
        </button>
      </div>

      {/* Flyout List matching Screenshot 3 */}
      <div style={{
        maxHeight: '320px',
        overflowY: 'auto',
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}>
        {/* Threats list */}
        {componentThreats.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {componentThreats.map(threat => (
              <div
                key={threat.id}
                onClick={() => onNavigateToCard(threat.id, 'threats')}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '7px 9px',
                  borderRadius: '8px',
                  backgroundColor: isDark ? 'rgba(239, 68, 68, 0.12)' : '#fef2f2',
                  border: isDark ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid #fee2e2',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', fontWeight: 800, color: '#ef4444' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <FiShield size={10} />
                    <span>THREAT {threat.id}</span>
                  </span>
                  <FiExternalLink size={10} style={{ opacity: 0.7 }} />
                </div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: text, marginTop: '2px', lineHeight: 1.3 }}>
                  {threat.title}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Decisions (ADRs) list */}
        {componentDecisions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '4px', borderTop: `1px solid ${border}`, paddingTop: '6px' }}>
            {componentDecisions.map(decision => (
              <div
                key={decision.id}
                onClick={() => onNavigateToCard(decision.id, 'decisions')}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '7px 9px',
                  borderRadius: '8px',
                  backgroundColor: isDark ? 'rgba(245, 158, 11, 0.12)' : '#fffbeb',
                  border: isDark ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid #fef3c7',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', fontWeight: 800, color: '#f59e0b' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <FiCheckCircle size={10} />
                    <span>DECISION {decision.id}</span>
                  </span>
                  <FiExternalLink size={10} style={{ opacity: 0.7 }} />
                </div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: text, marginTop: '2px', lineHeight: 1.3 }}>
                  {decision.title}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Invariants list */}
        {componentInvariants.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '4px', borderTop: `1px solid ${border}`, paddingTop: '6px' }}>
            {componentInvariants.map(inv => (
              <div
                key={inv.id}
                onClick={() => onNavigateToCard(inv.id, 'invariants')}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '7px 9px',
                  borderRadius: '8px',
                  backgroundColor: isDark ? 'rgba(168, 85, 247, 0.12)' : '#fdf4ff',
                  border: isDark ? '1px solid rgba(168, 85, 247, 0.3)' : '1px solid #f5d0fe',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', fontWeight: 800, color: '#a855f7' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <FiCode size={10} />
                    <span>INVARIANT {inv.id}</span>
                  </span>
                  <FiExternalLink size={10} style={{ opacity: 0.7 }} />
                </div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: text, marginTop: '2px', lineHeight: 1.3 }}>
                  {inv.title}
                </div>
              </div>
            ))}
          </div>
        )}

        {componentThreats.length === 0 && componentDecisions.length === 0 && componentInvariants.length === 0 && (
          <div style={{ padding: '12px 0', textAlign: 'center', fontSize: '11px', color: subtext, fontStyle: 'italic' }}>
            No cards attached to this component yet.
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div style={{
        padding: '8px',
        backgroundColor: headerBg,
        borderTop: `1px solid ${border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: '5px',
      }}>
        <button
          type="button"
          onClick={() => onChatAboutComponent(component)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '6px 8px',
            borderRadius: '6px',
            backgroundColor: isDark ? 'rgba(37, 99, 235, 0.2)' : '#eff6ff',
            border: isDark ? '1px solid rgba(37, 99, 235, 0.4)' : '1px solid #bfdbfe',
            color: '#60a5fa',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <FiMessageSquare size={12} />
          <span>Chat about Component with AI</span>
        </button>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
          <button
            type="button"
            onClick={() => onRecommendDependencies(component)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              padding: '5px',
              borderRadius: '6px',
              backgroundColor: isDark ? '#1a2436' : '#ffffff',
              border: `1px solid ${border}`,
              color: isDark ? '#cbd5e1' : '#475569',
              fontSize: '10px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <FiZap size={10} style={{ color: '#a855f7' }} />
            <span>Dependencies</span>
          </button>
          <button
            type="button"
            onClick={() => onGenerateThreats(component)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              padding: '5px',
              borderRadius: '6px',
              backgroundColor: isDark ? '#1a2436' : '#ffffff',
              border: `1px solid ${border}`,
              color: isDark ? '#cbd5e1' : '#475569',
              fontSize: '10px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <FiShield size={10} style={{ color: '#ef4444' }} />
            <span>Threats & ADRs</span>
          </button>
        </div>
      </div>
    </div>
  );
}
