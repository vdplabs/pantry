import React, { memo, useState } from 'react';
import { Handle, Position, NodeResizer, NodeResizeControl, type NodeProps, type Node } from '@xyflow/react';
import type { LensNote, NoteColor } from '../../types';

export type NoteNodeType = Node<{
  note: LensNote;
  theme?: 'dark' | 'light';
  isDimmed?: boolean;
  onSelectNote?: (id: string) => void;
  onResizeNote?: (id: string, width: number, height: number, x?: number, y?: number) => void;
}, 'noteNode'>;

export function getNoteColorStyles(color: NoteColor | undefined, isDark: boolean) {
  switch (color) {
    case 'green':
      return {
        bg: isDark ? 'rgba(16, 42, 27, 0.95)' : '#dcfce7',
        border: isDark ? '#166534' : '#86efac',
        text: isDark ? '#bbf7d0' : '#14532d',
      };
    case 'yellow':
      return {
        bg: isDark ? 'rgba(42, 36, 16, 0.95)' : '#fef9c3',
        border: isDark ? '#854d0e' : '#fde047',
        text: isDark ? '#fef08a' : '#713f12',
      };
    case 'pink':
      return {
        bg: isDark ? 'rgba(46, 20, 33, 0.95)' : '#fce7f3',
        border: isDark ? '#9d174d' : '#f472b6',
        text: isDark ? '#fbcfe8' : '#831843',
      };
    case 'blue':
      return {
        bg: isDark ? 'rgba(17, 34, 56, 0.95)' : '#e0f2fe',
        border: isDark ? '#1d4ed8' : '#7dd3fc',
        text: isDark ? '#bae6fd' : '#075985',
      };
    case 'orange':
      return {
        bg: isDark ? 'rgba(44, 25, 16, 0.95)' : '#ffedd5',
        border: isDark ? '#9a3412' : '#fdba74',
        text: isDark ? '#fed7aa' : '#7c2d12',
      };
    case 'gray':
    default:
      return {
        bg: isDark ? 'rgba(19, 27, 46, 0.95)' : 'rgba(255, 255, 255, 0.98)',
        border: isDark ? '#23334d' : '#cbd5e1',
        text: isDark ? '#f1f5f9' : '#0f172a',
      };
  }
}

function CustomNoteNode({ data, selected }: NodeProps<NoteNodeType>) {
  const note = data.note;
  const isDark = (data.theme || 'dark') === 'dark';
  const [isHovered, setIsHovered] = useState(false);
  const isHandleActive = isHovered || selected;

  const colorStyles = getNoteColorStyles(note.color, isDark);

  // Dynamic font sizing: as the user expands the note card, the text scales to fill the note nicely
  const noteW = note.width || 220;
  const noteH = note.height || 85;
  const area = noteW * noteH;
  const textLen = Math.max(20, note.text?.length || 20);
  const autoFontSize = Math.min(26, Math.max(11, Math.round(Math.sqrt((area / textLen) * 0.95))));

  return (
    <div
      className={`lens-note-node ${selected ? 'selected' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        data.onSelectNote?.(note.id);
      }}
      style={{
        width: '100%',
        height: '100%',
        minWidth: '140px',
        minHeight: '65px',
        padding: '14px 16px',
        borderRadius: '14px',
        border: selected ? '2px solid #3b82f6' : `1px solid ${colorStyles.border}`,
        backgroundColor: colorStyles.bg,
        fontSize: `${autoFontSize}px`,
        lineHeight: 1.5,
        color: colorStyles.text,
        boxShadow: selected
          ? '0 0 0 3px rgba(59, 130, 246, 0.35), 0 8px 24px rgba(0, 0, 0, 0.25)'
          : isDark
          ? '0 4px 14px rgba(0, 0, 0, 0.3)'
          : '0 2px 8px rgba(0, 0, 0, 0.06)',
        backdropFilter: 'blur(8px)',
        userSelect: 'none',
        boxSizing: 'border-box',
        cursor: 'pointer',
        position: 'relative',
        opacity: data.isDimmed ? 0.22 : 1,
        filter: data.isDimmed ? 'blur(0.5px)' : 'none',
        transition: 'opacity 0.25s ease, filter 0.25s ease, font-size 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      {/* NodeResizer for interactive note dragging to resize */}
      <NodeResizer
        minWidth={140}
        minHeight={65}
        isVisible={selected}
        color="#3b82f6"
        lineStyle={{ borderColor: '#3b82f6', borderWidth: 1 }}
        handleStyle={{ width: 8, height: 8, borderRadius: 2, backgroundColor: '#3b82f6' }}
        onResizeEnd={(_, params) => {
          data.onResizeNote?.(
            note.id,
            Math.round(params.width),
            Math.round(params.height),
            params.x !== undefined ? Math.round(params.x) : undefined,
            params.y !== undefined ? Math.round(params.y) : undefined
          );
        }}
      />
      {/* Handles hidden until active */}
      <Handle
        id="top-target"
        type="target"
        position={Position.Top}
        style={{
          width: 8,
          height: 8,
          backgroundColor: '#3b82f6',
          borderColor: isDark ? '#080c14' : '#ffffff',
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
          borderColor: isDark ? '#080c14' : '#ffffff',
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
          backgroundColor: '#3b82f6',
          borderColor: isDark ? '#080c14' : '#ffffff',
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
          borderColor: isDark ? '#080c14' : '#ffffff',
          opacity: isHandleActive ? 1 : 0,
          pointerEvents: isHandleActive ? 'all' : 'none',
          transition: 'opacity 0.15s ease',
        }}
      />

      {selected && (
        <NodeResizeControl
          position="bottom-right"
          minWidth={140}
          minHeight={65}
          style={{
            position: 'absolute',
            bottom: '3px',
            right: '3px',
            width: '16px',
            height: '16px',
            borderRadius: '3px',
            backgroundColor: '#3b82f6',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'nwse-resize',
            zIndex: 35,
            boxShadow: '0 2px 6px rgba(59, 130, 246, 0.4)',
            border: 'none',
            padding: 0,
            left: 'auto',
            top: 'auto',
            transform: 'none',
            translate: 'none',
          }}
          onResizeEnd={(_, params) => {
            data.onResizeNote?.(
              note.id,
              Math.round(params.width),
              Math.round(params.height),
              params.x !== undefined ? Math.round(params.x) : undefined,
              params.y !== undefined ? Math.round(params.y) : undefined
            );
          }}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M7 1L1 7M7 4L4 7M7 7L7 7" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </NodeResizeControl>
      )}

      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontWeight: 450 }}>
        {note.text}
      </div>
    </div>
  );
}

export default memo(CustomNoteNode);
