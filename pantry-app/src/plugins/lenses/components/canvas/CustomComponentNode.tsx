import React, { memo, useState } from 'react';
import { Handle, Position, NodeResizer, NodeResizeControl, type NodeProps, type Node } from '@xyflow/react';
import {
  FiMonitor, FiServer, FiShield, FiDatabase,
  FiLock, FiUser, FiLayers, FiCpu, FiHardDrive,
  FiZap, FiGlobe, FiKey, FiTerminal, FiCode,
  FiShare2, FiBox, FiCloud, FiRadio, FiBarChart2,
  FiClock, FiFileText, FiSettings, FiPlus, FiEdit2, FiMaximize2
} from 'react-icons/fi';
import type { LensComponent, LensThreat, LensDecision, LensInvariant } from '../../types';

function getComponentIcon(type: string, category?: string, customIcon?: string) {
  if (customIcon) {
    switch (customIcon) {
      case 'monitor': return <FiMonitor style={{ color: '#3b82f6' }} size={20} />;
      case 'server': return <FiServer style={{ color: '#a855f7' }} size={20} />;
      case 'database': return <FiDatabase style={{ color: '#06b6d4' }} size={20} />;
      case 'shield': return <FiShield style={{ color: '#ef4444' }} size={20} />;
      case 'lock': return <FiLock style={{ color: '#c084fc' }} size={20} />;
      case 'user': return <FiUser style={{ color: '#ef4444' }} size={20} />;
      case 'layers': return <FiLayers style={{ color: '#60a5fa' }} size={20} />;
      case 'cpu': return <FiCpu style={{ color: '#10b981' }} size={20} />;
      case 'zap': return <FiZap style={{ color: '#f59e0b' }} size={20} />;
      case 'globe': return <FiGlobe style={{ color: '#3b82f6' }} size={20} />;
      case 'key': return <FiKey style={{ color: '#eab308' }} size={20} />;
      case 'hard-drive': return <FiHardDrive style={{ color: '#06b6d4' }} size={20} />;
      case 'terminal': return <FiTerminal style={{ color: '#10b981' }} size={20} />;
      case 'code': return <FiCode style={{ color: '#a855f7' }} size={20} />;
      case 'share': return <FiShare2 style={{ color: '#f97316' }} size={20} />;
      case 'box': return <FiBox style={{ color: '#3b82f6' }} size={20} />;
      case 'cloud': return <FiCloud style={{ color: '#38bdf8' }} size={20} />;
      case 'radio': return <FiRadio style={{ color: '#ec4899' }} size={20} />;
      case 'bar-chart': return <FiBarChart2 style={{ color: '#14b8a6' }} size={20} />;
      case 'clock': return <FiClock style={{ color: '#8b5cf6' }} size={20} />;
      case 'file-text': return <FiFileText style={{ color: '#64748b' }} size={20} />;
      case 'settings': return <FiSettings style={{ color: '#64748b' }} size={20} />;
    }
  }

  if (category === 'external_network') {
    return <FiUser style={{ color: '#ef4444' }} size={20} />;
  }
  switch (type) {
    case 'client':
      return <FiMonitor style={{ color: '#3b82f6' }} size={20} />;
    case 'gateway':
      return <FiShield style={{ color: '#a855f7' }} size={20} />;
    case 'service':
      return <FiServer style={{ color: '#a855f7' }} size={20} />;
    case 'datastore':
      return <FiDatabase style={{ color: '#06b6d4' }} size={20} />;
    case 'security':
      return <FiLock style={{ color: '#c084fc' }} size={20} />;
    case 'asset':
      return <FiShield style={{ color: '#f59e0b' }} size={20} />;
    case 'actor':
      return <FiUser style={{ color: '#ef4444' }} size={20} />;
    default:
      return <FiLayers style={{ color: '#60a5fa' }} size={20} />;
  }
}

function getCategoryColor(category?: string, type?: string): string {
  if (category === 'external_network') return '#ef4444';
  if (category === 'database_store' || type === 'datastore') return '#06b6d4';
  if (type === 'client') return '#3b82f6';
  if (type === 'security') return '#c084fc';
  if (type === 'asset') return '#f59e0b';
  return '#a855f7'; // default service
}

export type ComponentNodeType = Node<{
  component: LensComponent;
  threatsCount?: number;
  decisionsCount?: number;
  invariantsCount?: number;
  attachedThreats?: LensThreat[];
  attachedDecisions?: LensDecision[];
  attachedInvariants?: LensInvariant[];
  selectedCardId?: string | null;
  theme?: 'dark' | 'light';
  showThreats?: boolean;
  showDecisions?: boolean;
  isDimmed?: boolean;
  isHighlighted?: boolean;
  onSelectComponent?: (id: string) => void;
  onResizeComponent?: (id: string, width: number, height: number, x?: number, y?: number) => void;
  onSelectForEdit?: (id: string) => void;
  onSelectCard?: (card: { id: string; category: 'threats' | 'decisions' | 'invariants' }) => void;
  onCreateThreat?: (componentId: string) => void;
  onCreateDecision?: (componentId: string) => void;
}, 'componentNode'>;

function CustomComponentNode({ data, selected }: NodeProps<ComponentNodeType>) {
  const comp = data.component;
  const isDark = (data.theme || 'dark') === 'dark';
  const isExternal = comp.category === 'external_network';
  const accentColor = getCategoryColor(comp.category, comp.type);

  const isNodeSelected = Boolean(selected || (data as any).isSelected);
  const [isHovered, setIsHovered] = useState(false);
  const isHandleActive = isHovered || isNodeSelected;

  const showThreats = data.showThreats !== false;
  const showDecisions = data.showDecisions !== false;

  const attachedThreats = showThreats ? (data.attachedThreats || []) : [];
  const attachedDecisions = showDecisions ? (data.attachedDecisions || []) : [];
  const attachedInvariants = data.attachedInvariants || [];

  const threatsCount = attachedThreats.length;
  const decisionsCount = attachedDecisions.length;
  const invariantsCount = attachedInvariants.length;

  const handleClickNode = (e: React.MouseEvent) => {
    e.stopPropagation();
    data.onSelectComponent?.(comp.id);
  };

  const nodeBg = isDark
    ? (isExternal ? 'rgba(38, 18, 24, 0.96)' : 'rgba(18, 25, 38, 0.96)')
    : (isExternal ? 'rgba(254, 242, 242, 0.96)' : 'rgba(255, 255, 255, 0.98)');

  const nodeBorder = isNodeSelected
    ? accentColor
    : data.isHighlighted
    ? '#3b82f6'
    : isExternal
    ? (isDark ? '#ef4444' : '#f87171')
    : comp.category === 'database_store'
    ? (isDark ? '#0284c7' : '#38bdf8')
    : (isDark ? '#263750' : '#e2e8f0');

  const textColor = isDark ? '#f8fafc' : '#0f172a';
  const subtextColor = isDark ? '#94a3b8' : '#64748b';
  const iconBoxBg = isDark
    ? (isExternal ? 'rgba(56, 22, 30, 0.9)' : '#162234')
    : (isExternal ? '#fee2e2' : '#f1f5f9');
  const iconBoxBorder = isDark
    ? (isExternal ? '#5c1d27' : '#23324c')
    : (isExternal ? '#fca5a5' : '#e2e8f0');

  // Popover placement: left only if component is way over on the right edge of canvas
  const popoverOnLeft = comp.x > 700;

  return (
    <div
      className={`lens-component-node ${isNodeSelected ? 'selected' : ''}`}
      onClick={handleClickNode}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        width: '100%',
        height: '100%',
        minWidth: '160px',
        minHeight: '70px',
        borderRadius: '16px',
        border: isNodeSelected
          ? `2.5px solid ${accentColor}`
          : data.isHighlighted
          ? '2px solid #3b82f6'
          : `1.5px solid ${nodeBorder}`,
        backgroundColor: nodeBg,
        boxShadow: isNodeSelected
          ? `0 0 0 2px ${accentColor}35, 0 0 22px ${accentColor}35`
          : data.isHighlighted
          ? '0 0 0 2px rgba(59, 130, 246, 0.4), 0 4px 16px rgba(59, 130, 246, 0.2)'
          : isDark
          ? '0 4px 16px rgba(0, 0, 0, 0.3)'
          : '0 2px 10px rgba(0, 0, 0, 0.07)',
        backdropFilter: 'blur(10px)',
        userSelect: 'none',
        cursor: 'pointer',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px 14px',
        textAlign: 'center',
        boxSizing: 'border-box',
        opacity: data.isDimmed ? 0.18 : 1,
        filter: data.isDimmed ? 'grayscale(35%) blur(0.5px)' : 'none',
        transform: isNodeSelected ? 'scale(1.025)' : 'scale(1)',
        transition: 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease, filter 0.25s ease, border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      {/* NodeResizer for interactive dragging to resize */}
      <NodeResizer
        minWidth={160}
        minHeight={70}
        isVisible={isNodeSelected}
        color={accentColor}
        lineStyle={{ borderColor: accentColor }}
        handleStyle={{
          width: 10,
          height: 10,
          borderRadius: 2,
          backgroundColor: accentColor,
          border: '1.5px solid #ffffff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          pointerEvents: 'auto',
          zIndex: 30,
        }}
        onResizeEnd={(_, params) => {
          data.onResizeComponent?.(
            comp.id,
            Math.round(params.width),
            Math.round(params.height),
            params.x !== undefined ? Math.round(params.x) : undefined,
            params.y !== undefined ? Math.round(params.y) : undefined
          );
        }}
      />

      {/* Handles on 4 sides (HIDDEN until active/hovered/selected) */}
      <Handle
        id="top-target"
        type="target"
        position={Position.Top}
        style={{
          width: 8,
          height: 8,
          backgroundColor: '#60a5fa',
          borderColor: isDark ? '#0b0f19' : '#ffffff',
          opacity: isHandleActive ? 1 : 0,
          pointerEvents: isHandleActive ? 'all' : 'none',
          transition: 'opacity 0.15s ease',
        }}
      />
      <Handle
        id="top-source"
        type="source"
        position={Position.Top}
        style={{
          width: 8,
          height: 8,
          backgroundColor: '#3b82f6',
          borderColor: isDark ? '#0b0f19' : '#ffffff',
          opacity: isHandleActive ? 1 : 0,
          pointerEvents: isHandleActive ? 'all' : 'none',
          transition: 'opacity 0.15s ease',
        }}
      />

      <Handle
        id="bottom-target"
        type="target"
        position={Position.Bottom}
        style={{
          width: 8,
          height: 8,
          backgroundColor: '#60a5fa',
          borderColor: isDark ? '#0b0f19' : '#ffffff',
          opacity: isHandleActive ? 1 : 0,
          pointerEvents: isHandleActive ? 'all' : 'none',
          transition: 'opacity 0.15s ease',
        }}
      />
      <Handle
        id="bottom-source"
        type="source"
        position={Position.Bottom}
        style={{
          width: 8,
          height: 8,
          backgroundColor: '#3b82f6',
          borderColor: isDark ? '#0b0f19' : '#ffffff',
          opacity: isHandleActive ? 1 : 0,
          pointerEvents: isHandleActive ? 'all' : 'none',
          transition: 'opacity 0.15s ease',
        }}
      />

      <Handle
        id="left-target"
        type="target"
        position={Position.Left}
        style={{
          width: 8,
          height: 8,
          backgroundColor: '#60a5fa',
          borderColor: isDark ? '#0b0f19' : '#ffffff',
          opacity: isHandleActive ? 1 : 0,
          pointerEvents: isHandleActive ? 'all' : 'none',
          transition: 'opacity 0.15s ease',
        }}
      />
      <Handle
        id="left-source"
        type="source"
        position={Position.Left}
        style={{
          width: 8,
          height: 8,
          backgroundColor: '#3b82f6',
          borderColor: isDark ? '#0b0f19' : '#ffffff',
          opacity: isHandleActive ? 1 : 0,
          pointerEvents: isHandleActive ? 'all' : 'none',
          transition: 'opacity 0.15s ease',
        }}
      />

      <Handle
        id="right-target"
        type="target"
        position={Position.Right}
        style={{
          width: 8,
          height: 8,
          backgroundColor: '#60a5fa',
          borderColor: isDark ? '#0b0f19' : '#ffffff',
          opacity: isHandleActive ? 1 : 0,
          pointerEvents: isHandleActive ? 'all' : 'none',
          transition: 'opacity 0.15s ease',
        }}
      />
      <Handle
        id="right-source"
        type="source"
        position={Position.Right}
        style={{
          width: 8,
          height: 8,
          backgroundColor: '#3b82f6',
          borderColor: isDark ? '#0b0f19' : '#ffffff',
          opacity: isHandleActive ? 1 : 0,
          pointerEvents: isHandleActive ? 'all' : 'none',
          transition: 'opacity 0.15s ease',
        }}
      />

      {/* Attached Entity Indicator Dots in Top Left Corner matching Screenshot */}
      {(threatsCount > 0 || invariantsCount > 0 || decisionsCount > 0) && (
        <div
          style={{
            position: 'absolute',
            top: '9px',
            left: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            zIndex: 10,
          }}
        >
          {attachedThreats.slice(0, 3).map((t, idx) => (
            <span
              key={`threat-dot-${t.id || idx}`}
              title={`Threat: ${t.title}`}
              style={{
                width: '6.5px',
                height: '6.5px',
                borderRadius: '50%',
                backgroundColor: '#ef4444',
                boxShadow: '0 0 4px rgba(239, 68, 68, 0.6)',
                display: 'inline-block',
              }}
            />
          ))}
          {attachedInvariants.slice(0, 3).map((inv, idx) => (
            <span
              key={`inv-dot-${inv.id || idx}`}
              title={`Invariant: ${inv.title}`}
              style={{
                width: '6.5px',
                height: '6.5px',
                borderRadius: '50%',
                backgroundColor: '#06b6d4',
                boxShadow: '0 0 4px rgba(6, 182, 212, 0.6)',
                display: 'inline-block',
              }}
            />
          ))}
          {attachedDecisions.slice(0, 2).map((d, idx) => (
            <span
              key={`adr-dot-${d.id || idx}`}
              title={`Decision: ${d.title}`}
              style={{
                width: '6.5px',
                height: '6.5px',
                borderRadius: '50%',
                backgroundColor: '#f59e0b',
                boxShadow: '0 0 4px rgba(245, 158, 11, 0.6)',
                display: 'inline-block',
              }}
            />
          ))}
        </div>
      )}

      {/* Pill Badge in Top Right Corner (shows count • N matching Screenshot) */}
      {(threatsCount > 0 || (comp.threatCount && comp.threatCount > 0)) && (
        <div
          title={`${threatsCount || comp.threatCount} Threats`}
          style={{
            position: 'absolute',
            top: '8px',
            right: '9px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3.5px',
            padding: '2.5px 7px',
            borderRadius: '9999px',
            backgroundColor: isDark ? 'rgba(239, 68, 68, 0.22)' : '#ffe4e6',
            color: '#ef4444',
            fontSize: '10.5px',
            fontWeight: 800,
            border: isDark ? '1px solid rgba(239, 68, 68, 0.45)' : '1px solid #fecdd3',
            lineHeight: 1,
            zIndex: 10,
          }}
        >
          <span style={{ width: '4.5px', height: '4.5px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
          <span>{threatsCount || comp.threatCount}</span>
        </div>
      )}

      {/* Bottom-right Resize Badge when selected matching Screenshot */}
      {isNodeSelected && (
        <NodeResizeControl
          position="bottom-right"
          minWidth={160}
          minHeight={70}
          style={{
            position: 'absolute',
            bottom: '3px',
            right: '3px',
            width: '18px',
            height: '18px',
            borderRadius: '4px',
            backgroundColor: accentColor,
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'nwse-resize',
            zIndex: 35,
            boxShadow: `0 2px 6px ${accentColor}60`,
            border: 'none',
            padding: 0,
            left: 'auto',
            top: 'auto',
            transform: 'none',
            translate: 'none',
          }}
          onResizeEnd={(_, params) => {
            data.onResizeComponent?.(
              comp.id,
              Math.round(params.width),
              Math.round(params.height),
              params.x !== undefined ? Math.round(params.x) : undefined,
              params.y !== undefined ? Math.round(params.y) : undefined
            );
          }}
        >
          <FiMaximize2 size={10} />
        </NodeResizeControl>
      )}

      {/* Clean Card Body */}
      <div
        style={{
          width: '38px',
          height: '38px',
          borderRadius: '10px',
          backgroundColor: iconBoxBg,
          border: `1px solid ${iconBoxBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '8px',
        }}
      >
        {getComponentIcon(comp.type, comp.category, comp.icon)}
      </div>

      <div style={{ fontWeight: 700, fontSize: '13.5px', color: textColor, lineHeight: 1.25 }}>
        {comp.name}
      </div>

      {comp.subtitle && (
        <div style={{
          fontSize: '11px',
          color: subtextColor,
          fontWeight: 450,
          marginTop: '3px',
          maxWidth: '190px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1.3,
        }}>
          {comp.subtitle}
        </div>
      )}

      {/* Popover Callout Cards Stack matching Screenshot media_1791300608115.png */}
      {isNodeSelected && (
        <div
          className="nodrag nopan lens-popover-cards"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '-8px',
            [popoverOnLeft ? 'right' : 'left']: 'calc(100% + 14px)',
            width: '330px',
            maxHeight: '480px',
            overflowY: 'auto',
            borderRadius: '18px',
            backgroundColor: isDark ? 'rgba(18, 25, 38, 0.98)' : '#ffffff',
            border: `1px solid ${isDark ? '#2a3a54' : 'rgba(0, 0, 0, 0.08)'}`,
            boxShadow: isDark
              ? '0 16px 40px rgba(0, 0, 0, 0.75)'
              : '0 12px 32px -4px rgba(0, 0, 0, 0.12), 0 4px 12px -2px rgba(0, 0, 0, 0.06)',
            backdropFilter: 'blur(16px)',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            zIndex: 99999,
            cursor: 'default',
            userSelect: 'none',
          }}
        >
          {/* Callout Arrow Pointer on Left / Right edge */}
          {!popoverOnLeft ? (
            <div
              style={{
                position: 'absolute',
                left: '-8px',
                top: '26px',
                width: 0,
                height: 0,
                borderTop: '8px solid transparent',
                borderBottom: '8px solid transparent',
                borderRight: `8px solid ${isDark ? 'rgba(18, 25, 38, 0.98)' : '#ffffff'}`,
                zIndex: 100000,
                filter: isDark ? 'drop-shadow(-2px 0 2px rgba(0,0,0,0.4))' : 'drop-shadow(-2px 0 1px rgba(0,0,0,0.06))',
              }}
            />
          ) : (
            <div
              style={{
                position: 'absolute',
                right: '-8px',
                top: '26px',
                width: 0,
                height: 0,
                borderTop: '8px solid transparent',
                borderBottom: '8px solid transparent',
                borderLeft: `8px solid ${isDark ? 'rgba(18, 25, 38, 0.98)' : '#ffffff'}`,
                zIndex: 100000,
                filter: isDark ? 'drop-shadow(2px 0 2px rgba(0,0,0,0.4))' : 'drop-shadow(2px 0 1px rgba(0,0,0,0.06))',
              }}
            />
          )}

          {/* 1. THREATS (Rose tint) */}
          {attachedThreats.map(t => {
            const isCardActive = data.selectedCardId === t.id;
            return (
              <div
                key={t.id}
                onClick={(e) => {
                  e.stopPropagation();
                  data.onSelectCard?.({ id: t.id, category: 'threats' });
                }}
                style={{
                  padding: '10px 14px',
                  borderRadius: '12px',
                  backgroundColor: isCardActive
                    ? (isDark ? 'rgba(239, 68, 68, 0.24)' : '#fee2e2')
                    : (isDark ? 'rgba(239, 68, 68, 0.14)' : '#fff1f2'),
                  border: isCardActive
                    ? '1.5px solid #e11d48'
                    : `1px solid ${isDark ? 'rgba(239, 68, 68, 0.35)' : '#fecdd3'}`,
                  boxShadow: isCardActive ? '0 0 0 2px rgba(225, 29, 72, 0.35)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  textAlign: 'left',
                }}
              >
                <div style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: '#e11d48',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}>
                  THREAT&nbsp;&nbsp;{t.id}
                </div>
                <div style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: isDark ? '#f8fafc' : '#0f172a',
                  marginTop: '4px',
                  lineHeight: 1.3,
                }}>
                  {t.title}
                </div>
              </div>
            );
          })}

          {/* 2. INVARIANTS (Sky / Cyan tint) */}
          {attachedInvariants.map(inv => {
            const isCardActive = data.selectedCardId === inv.id;
            return (
              <div
                key={inv.id}
                onClick={(e) => {
                  e.stopPropagation();
                  data.onSelectCard?.({ id: inv.id, category: 'invariants' });
                }}
                style={{
                  padding: '10px 14px',
                  borderRadius: '12px',
                  backgroundColor: isCardActive
                    ? (isDark ? 'rgba(6, 182, 212, 0.24)' : '#e0f2fe')
                    : (isDark ? 'rgba(6, 182, 212, 0.14)' : '#f0f9ff'),
                  border: isCardActive
                    ? '1.5px solid #0284c7'
                    : `1px solid ${isDark ? 'rgba(6, 182, 212, 0.35)' : '#bae6fd'}`,
                  boxShadow: isCardActive ? '0 0 0 2px rgba(2, 132, 199, 0.35)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  textAlign: 'left',
                }}
              >
                <div style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: '#0284c7',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}>
                  INVARIANT&nbsp;&nbsp;{inv.id}
                </div>
                <div style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: isDark ? '#f8fafc' : '#0f172a',
                  marginTop: '4px',
                  lineHeight: 1.3,
                }}>
                  {inv.title}
                </div>
              </div>
            );
          })}

          {/* 3. DECISIONS (Amber tint) */}
          {attachedDecisions.map(d => {
            const isCardActive = data.selectedCardId === d.id;
            return (
              <div
                key={d.id}
                onClick={(e) => {
                  e.stopPropagation();
                  data.onSelectCard?.({ id: d.id, category: 'decisions' });
                }}
                style={{
                  padding: '10px 14px',
                  borderRadius: '12px',
                  backgroundColor: isCardActive
                    ? (isDark ? 'rgba(245, 158, 11, 0.24)' : '#fef3c7')
                    : (isDark ? 'rgba(245, 158, 11, 0.14)' : '#fffbeb'),
                  border: isCardActive
                    ? '1.5px solid #d97706'
                    : `1px solid ${isDark ? 'rgba(245, 158, 11, 0.35)' : '#fde68a'}`,
                  boxShadow: isCardActive ? '0 0 0 2px rgba(217, 119, 6, 0.35)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  textAlign: 'left',
                }}
              >
                <div style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: '#d97706',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}>
                  DECISION&nbsp;&nbsp;{d.id}
                </div>
                <div style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: isDark ? '#f8fafc' : '#0f172a',
                  marginTop: '4px',
                  lineHeight: 1.3,
                }}>
                  {d.title}
                </div>
              </div>
            );
          })}

          {/* Empty state if no cards exist on this component */}
          {attachedThreats.length === 0 && attachedInvariants.length === 0 && attachedDecisions.length === 0 && (
            <div style={{ padding: '12px 8px', textAlign: 'center', fontSize: '12px', color: subtextColor }}>
              <div style={{ marginBottom: '8px', fontStyle: 'italic' }}>No cards attached yet.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => data.onCreateThreat?.(comp.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    padding: '7px 10px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#ef4444',
                    color: '#ffffff',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <FiPlus size={11} />
                  <span>Add Threat Card</span>
                </button>
                <button
                  type="button"
                  onClick={() => data.onCreateDecision?.(comp.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    padding: '7px 10px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#f59e0b',
                    color: '#ffffff',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <FiPlus size={11} />
                  <span>Add Decision (ADR)</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(CustomComponentNode);
