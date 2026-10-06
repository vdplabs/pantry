import React, { memo } from 'react';
import { type NodeProps, type Node, NodeResizer } from '@xyflow/react';
import { FiShield, FiLock, FiGlobe } from 'react-icons/fi';
import type { LensBoundary } from '../../types';

export type BoundaryNodeType = Node<{
  boundary: LensBoundary;
  theme?: 'dark' | 'light';
  isDimmed?: boolean;
  onSelectBoundary?: (id: string) => void;
  onResizeBoundary?: (id: string, width: number, height: number, x?: number, y?: number) => void;
}, 'boundaryNode'>;

function CustomBoundaryNode({ data, selected }: NodeProps<BoundaryNodeType>) {
  const b = data.boundary;
  const isDark = (data.theme || 'dark') === 'dark';
  const isOrange = b.color === 'orange';
  const isBlue = b.color === 'blue';

  const borderColor = isOrange ? '#f59e0b' : isBlue ? '#3b82f6' : '#a855f7';
  const bgColor = isDark
    ? (isOrange ? 'rgba(245, 158, 11, 0.05)' : isBlue ? 'rgba(59, 130, 246, 0.05)' : 'rgba(168, 85, 247, 0.05)')
    : (isOrange ? 'rgba(254, 243, 199, 0.22)' : isBlue ? 'rgba(239, 246, 255, 0.22)' : 'rgba(250, 245, 255, 0.22)');

  const badgeBg = isDark
    ? (isOrange ? '#26190e' : isBlue ? '#122036' : '#231530')
    : (isOrange ? '#fef3c7' : isBlue ? '#eff6ff' : '#f3e8ff');

  const badgeBorder = isOrange ? '#d97706' : isBlue ? '#2563eb' : '#9333ea';
  const badgeColor = isDark ? '#ffffff' : (isOrange ? '#92400e' : isBlue ? '#1e40af' : '#6b21a8');

  return (
    <div
      className="lens-boundary-node"
      style={{
        width: '100%',
        height: '100%',
        minWidth: '220px',
        minHeight: '150px',
        position: 'relative',
        borderRadius: '16px',
        border: selected ? '2px dashed #3b82f6' : `2px dashed ${borderColor}`,
        backgroundColor: bgColor,
        pointerEvents: 'none', // Crucial: allow clicks through interior to reach connector wires and components!
        boxShadow: selected ? '0 0 0 3px rgba(59, 130, 246, 0.4), 0 4px 20px rgba(0,0,0,0.2)' : 'none',
        opacity: data.isDimmed ? 0.2 : 1,
        transition: 'opacity 0.25s ease, border-color 0.15s ease',
      }}
    >
      {/* NodeResizer for interactive boundary dragging to resize */}
      <NodeResizer
        minWidth={220}
        minHeight={150}
        isVisible={selected}
        color={borderColor}
        lineStyle={{ borderColor, borderWidth: 1 }}
        handleStyle={{ width: 10, height: 10, borderRadius: 3, backgroundColor: borderColor, pointerEvents: 'auto' }}
        onResizeEnd={(_, params) => {
          data.onResizeBoundary?.(
            b.id,
            Math.round(params.width),
            Math.round(params.height),
            params.x !== undefined ? Math.round(params.x) : undefined,
            params.y !== undefined ? Math.round(params.y) : undefined
          );
        }}
      />
      {/* Clickable Header Tag Pill (Draggable and Selectable) */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          data.onSelectBoundary?.(b.id);
        }}
        style={{
          position: 'absolute',
          top: '-12px',
          left: '16px',
          pointerEvents: 'auto',
          userSelect: 'none',
          cursor: 'pointer',
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 11px',
            borderRadius: '9999px',
            fontSize: '10px',
            fontWeight: 800,
            letterSpacing: '0.04em',
            backgroundColor: badgeBg,
            borderColor: badgeBorder,
            borderWidth: '1px',
            borderStyle: 'solid',
            color: badgeColor,
            boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
          }}
        >
          {isOrange ? (
            <FiShield size={11} style={{ color: '#f59e0b' }} />
          ) : isBlue ? (
            <FiLock size={11} style={{ color: '#3b82f6' }} />
          ) : (
            <FiGlobe size={11} style={{ color: '#a855f7' }} />
          )}
          <span>{b.title}</span>
          {b.subtitle && <span style={{ opacity: 0.85, fontWeight: 500 }}>{b.subtitle}</span>}
        </div>
      </div>
    </div>
  );
}

export default memo(CustomBoundaryNode);
