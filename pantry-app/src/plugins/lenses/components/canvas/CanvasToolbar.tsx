import React, { useState } from 'react';
import {
  FiMousePointer, FiPlus, FiSquare, FiShare2,
  FiFileText, FiLock, FiUnlock, FiShield, FiUserCheck,
  FiAlertTriangle, FiAward, FiCheckSquare
} from 'react-icons/fi';

interface Props {
  activeTool: 'select' | 'addComponent' | 'addBoundary' | 'connect' | 'addNote';
  isLocked: boolean;
  theme?: 'dark' | 'light';
  showThreats?: boolean;
  showBoundaries?: boolean;
  showDecisions?: boolean;
  onSelectTool: (tool: 'select' | 'addComponent' | 'addBoundary' | 'connect' | 'addNote') => void;
  onToggleLock: () => void;
  onToggleThreats?: () => void;
  onToggleBoundaries?: () => void;
  onToggleDecisions?: () => void;
  onAddComponent: () => void;
  onAddBoundary: () => void;
  onAddNote: () => void;
}

export default function CanvasToolbar({
  activeTool,
  isLocked,
  theme = 'dark',
  showThreats = true,
  showBoundaries = true,
  showDecisions = true,
  onSelectTool,
  onToggleLock,
  onToggleThreats,
  onToggleBoundaries,
  onToggleDecisions,
  onAddComponent,
  onAddBoundary,
  onAddNote,
}: Props) {
  const isDark = theme === 'dark';
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);

  const renderTooltip = (text: string) => (
    <div
      style={{
        position: 'absolute',
        left: 'calc(100% + 12px)',
        top: '50%',
        transform: 'translateY(-50%)',
        backgroundColor: isDark ? '#1e293b' : '#ffffff',
        color: isDark ? '#f8fafc' : '#0f172a',
        padding: '7px 14px',
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        boxShadow: isDark
          ? '0 10px 25px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1)'
          : '0 10px 25px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.06)',
        border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
        pointerEvents: 'none',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        letterSpacing: '0.01em',
      }}
    >
      {text}
    </div>
  );

  return (
    <>
      {/* Top-Left Category Legend (Positioned to the right of toolbar with zero overlap) */}
      <div
        className="lens-category-legend"
        style={{
          position: 'absolute',
          top: '16px',
          left: '74px',
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '6px 14px',
          background: isDark ? 'rgba(18, 24, 36, 0.95)' : 'rgba(255, 255, 255, 0.96)',
          border: `1px solid ${isDark ? '#1e2638' : '#e2e8f0'}`,
          borderRadius: '9999px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
          backdropFilter: 'blur(8px)',
          fontSize: '11px',
          fontWeight: 600,
          color: isDark ? '#cbd5e1' : '#475569',
          userSelect: 'none',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
          <span>External Network</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#a855f7' }} />
          <span>Service / Process</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#06b6d4' }} />
          <span>Database / Store</span>
        </span>
      </div>

      {/* Left Dock Toolbar matching Screenshot 1 */}
      <div
        className="lens-toolbar-dock"
        style={{
          position: 'absolute',
          left: '16px',
          top: '16px',
          zIndex: 35,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '6px',
          padding: '6px',
          background: isDark ? 'rgba(18, 24, 36, 0.96)' : 'rgba(255, 255, 255, 0.98)',
          border: `1px solid ${isDark ? '#1e2638' : '#e2e8f0'}`,
          borderRadius: '14px',
          boxShadow: isDark ? '0 8px 24px rgba(0, 0, 0, 0.35)' : '0 6px 20px rgba(0, 0, 0, 0.08)',
          backdropFilter: 'blur(10px)',
        }}
      >
        {/* 1. Select / Pan */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onMouseEnter={() => setHoveredButton('select')}
            onMouseLeave={() => setHoveredButton(null)}
            onClick={() => onSelectTool('select')}
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: activeTool === 'select' ? '1px solid #3b82f6' : '1px dashed transparent',
              backgroundColor: activeTool === 'select' ? (isDark ? 'rgba(37, 99, 235, 0.25)' : '#eff6ff') : 'transparent',
              color: activeTool === 'select' ? '#60a5fa' : (isDark ? '#94a3b8' : '#64748b'),
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <FiMousePointer size={15} />
          </button>
          {hoveredButton === 'select' && renderTooltip('Select / Pan')}
        </div>

        {/* 2. Actor / Component */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onMouseEnter={() => setHoveredButton('component')}
            onMouseLeave={() => setHoveredButton(null)}
            onClick={onAddComponent}
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              backgroundColor: 'transparent',
              color: isDark ? '#94a3b8' : '#64748b',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <FiUserCheck size={16} />
          </button>
          {hoveredButton === 'component' && renderTooltip('Actor / Component')}
        </div>

        {/* 3. Trust boundary */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onMouseEnter={() => setHoveredButton('boundary')}
            onMouseLeave={() => setHoveredButton(null)}
            onClick={onAddBoundary}
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: activeTool === 'addBoundary' ? '1px solid #3b82f6' : 'none',
              backgroundColor: activeTool === 'addBoundary' ? (isDark ? 'rgba(37, 99, 235, 0.25)' : '#eff6ff') : 'transparent',
              color: activeTool === 'addBoundary' ? '#3b82f6' : (isDark ? '#94a3b8' : '#64748b'),
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <FiShield size={16} />
          </button>
          {hoveredButton === 'boundary' && renderTooltip('Trust boundary')}
        </div>

        {/* 4. Sticky note */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onMouseEnter={() => setHoveredButton('note')}
            onMouseLeave={() => setHoveredButton(null)}
            onClick={onAddNote}
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              backgroundColor: 'transparent',
              color: isDark ? '#94a3b8' : '#64748b',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <FiFileText size={16} />
          </button>
          {hoveredButton === 'note' && renderTooltip('Sticky note')}
        </div>

        <div style={{ width: '22px', height: '1px', backgroundColor: isDark ? '#26344d' : '#e2e8f0', margin: '2px 0' }} />

        {/* 5. Threat filter */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onMouseEnter={() => setHoveredButton('threats')}
            onMouseLeave={() => setHoveredButton(null)}
            onClick={onToggleThreats}
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              backgroundColor: showThreats ? (isDark ? 'rgba(239, 68, 68, 0.15)' : '#fee2e2') : 'transparent',
              color: showThreats ? '#ef4444' : (isDark ? '#64748b' : '#94a3b8'),
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <FiAlertTriangle size={15} />
          </button>
          {hoveredButton === 'threats' && renderTooltip(showThreats ? 'Threat filter (Active)' : 'Threat filter (Hidden)')}
        </div>

        {/* 6. Guarantees & Invariants */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onMouseEnter={() => setHoveredButton('invariants')}
            onMouseLeave={() => setHoveredButton(null)}
            onClick={onToggleDecisions}
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              backgroundColor: showDecisions ? (isDark ? 'rgba(168, 85, 247, 0.15)' : '#f3e8ff') : 'transparent',
              color: showDecisions ? '#a855f7' : (isDark ? '#64748b' : '#94a3b8'),
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <FiAward size={15} />
          </button>
          {hoveredButton === 'invariants' && renderTooltip('Guarantees & Invariants')}
        </div>

        {/* 7. Lock canvas */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onMouseEnter={() => setHoveredButton('lock')}
            onMouseLeave={() => setHoveredButton(null)}
            onClick={onToggleLock}
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              backgroundColor: isLocked ? (isDark ? '#2a1e12' : '#fffbeb') : 'transparent',
              color: isLocked ? '#f59e0b' : (isDark ? '#94a3b8' : '#64748b'),
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {isLocked ? <FiLock size={15} /> : <FiUnlock size={15} />}
          </button>
          {hoveredButton === 'lock' && renderTooltip(isLocked ? 'Unlock canvas' : 'Lock canvas')}
        </div>
      </div>
    </>
  );
}
