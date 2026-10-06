import React, { memo, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  getSmoothStepPath,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';

export type CustomEdgeType = Edge<{
  label?: string;
  color?: string;
  style?: 'solid' | 'dashed' | 'dotted';
  direction?: 'forward' | 'bidirectional' | 'reverse';
  routing?: 'straight' | 'angled' | 'curved';
  controlX?: number;
  controlY?: number;
  selected?: boolean;
  theme?: 'dark' | 'light';
  onSelectEdge?: (id: string) => void;
  onUpdateControlPoints?: (id: string, controlX?: number, controlY?: number) => void;
}, 'customEdge'>;

export function buildAngledPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  sPos: string = 'right',
  tPos: string = 'left',
  controlX?: number,
  controlY?: number,
  r: number = 8
) {
  const cx = controlX !== undefined ? controlX : Math.round((sx + tx) / 2);
  const cy = controlY !== undefined ? controlY : Math.round((sy + ty) / 2);

  let points: { x: number; y: number }[] = [];
  const isSourceHoriz = sPos === 'left' || sPos === 'right';
  const isTargetHoriz = tPos === 'left' || tPos === 'right';

  if (isSourceHoriz && isTargetHoriz) {
    // Both horizontal (Z or C step): sx -> cx,sy -> cx,ty -> tx,ty
    points = [
      { x: sx, y: sy },
      { x: cx, y: sy },
      { x: cx, y: ty },
      { x: tx, y: ty },
    ];
  } else if (!isSourceHoriz && !isTargetHoriz) {
    // Both vertical (N or U step): sx,sy -> sx,cy -> tx,cy -> tx,ty
    points = [
      { x: sx, y: sy },
      { x: sx, y: cy },
      { x: tx, y: cy },
      { x: tx, y: ty },
    ];
  } else if (isSourceHoriz && !isTargetHoriz) {
    // Horizontal exit, Vertical entry (S or L step): sx,sy -> cx,sy -> cx,cy -> tx,cy -> tx,ty
    points = [
      { x: sx, y: sy },
      { x: cx, y: sy },
      { x: cx, y: cy },
      { x: tx, y: cy },
      { x: tx, y: ty },
    ];
  } else {
    // Vertical exit, Horizontal entry: sx,sy -> sx,cy -> cx,cy -> cx,ty -> tx,ty
    points = [
      { x: sx, y: sy },
      { x: sx, y: cy },
      { x: cx, y: cy },
      { x: cx, y: ty },
      { x: tx, y: ty },
    ];
  }

  // Generate SVG path with rounded corners
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const pPrev = points[i - 1];
    const pCurr = points[i];
    const pNext = points[i + 1];

    const dPrev = { x: pPrev.x - pCurr.x, y: pPrev.y - pCurr.y };
    const dNext = { x: pNext.x - pCurr.x, y: pNext.y - pCurr.y };
    const lenPrev = Math.hypot(dPrev.x, dPrev.y);
    const lenNext = Math.hypot(dNext.x, dNext.y);
    const radius = Math.min(r, lenPrev / 2, lenNext / 2);

    if (radius > 0) {
      const startX = pCurr.x + (dPrev.x / lenPrev) * radius;
      const startY = pCurr.y + (dPrev.y / lenPrev) * radius;
      const endX = pCurr.x + (dNext.x / lenNext) * radius;
      const endY = pCurr.y + (dNext.y / lenNext) * radius;

      d += ` L ${startX.toFixed(1)} ${startY.toFixed(1)}`;
      d += ` Q ${pCurr.x.toFixed(1)} ${pCurr.y.toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}`;
    } else {
      d += ` L ${pCurr.x} ${pCurr.y}`;
    }
  }
  d += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;

  // Find center of the middle segment for label and drag handle
  const midIndex = Math.floor(points.length / 2);
  const pA = points[midIndex - 1];
  const pB = points[midIndex];
  const labelX = (pA.x + pB.x) / 2;
  const labelY = (pA.y + pB.y) / 2;

  let horizSeg: { x: number; y: number } | null = null;
  let vertSeg: { x: number; y: number } | null = null;

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if (Math.abs(p1.y - p2.y) < 2 && Math.abs(p1.x - p2.x) > 15) {
      horizSeg = { x: (p1.x + p2.x) / 2, y: p1.y };
    }
    if (Math.abs(p1.x - p2.x) < 2 && Math.abs(p1.y - p2.y) > 15) {
      vertSeg = { x: p1.x, y: (p1.y + p2.y) / 2 };
    }
  }

  // Ensure handles always exist for draggable angled paths
  if (!vertSeg && isFinite(cx) && isFinite(sy) && isFinite(ty)) {
    vertSeg = { x: cx, y: Math.round((sy + ty) / 2) };
  }
  if (!horizSeg && isFinite(cy) && isFinite(sx) && isFinite(tx)) {
    horizSeg = { x: Math.round((sx + tx) / 2), y: cy };
  }

  return { d, labelX, labelY, cx, cy, horizSeg, vertSeg };
}

function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style = {},
  markerEnd,
  markerStart,
  selected,
  data,
}: EdgeProps<CustomEdgeType>) {
  const routing = (data as any)?.routing || 'straight'; // Default is straight matching user request
  const reactFlow = useReactFlow();

  // Local drag state: changes only this edge during drag, avoids crashing parent with 60fps state churn
  const [dragCx, setDragCx] = useState<number | null>(null);
  const [dragCy, setDragCy] = useState<number | null>(null);

  const effectiveControlX = dragCx !== null ? dragCx : (data as any)?.controlX;
  const effectiveControlY = dragCy !== null ? dragCy : (data as any)?.controlY;

  let edgePath = '';
  let labelX = 0;
  let labelY = 0;
  let angledInfo: ReturnType<typeof buildAngledPath> | null = null;

  if (routing === 'curved') {
    [edgePath, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  } else if (routing === 'angled') {
    angledInfo = buildAngledPath(
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      effectiveControlX,
      effectiveControlY,
      10
    );
    edgePath = angledInfo.d;
    labelX = angledInfo.labelX;
    labelY = angledInfo.labelY;
  } else {
    // Default: straight
    [edgePath, labelX, labelY] = getStraightPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
    });
  }

  const handleMouseDownVert = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startCx = effectiveControlX !== undefined ? effectiveControlX : (angledInfo?.cx ?? labelX);
    const zoom = reactFlow?.getZoom ? reactFlow.getZoom() : 1;
    let latestCx = startCx;

    const onMouseMove = (moveEvt: MouseEvent) => {
      const deltaX = (moveEvt.clientX - startX) / zoom;
      const newCx = Math.round(startCx + deltaX);
      latestCx = newCx;
      setDragCx(newCx); // Fast local update only
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setDragCx(null);
      // Commit once on mouse release
      (data as any)?.onUpdateControlPoints?.(id, latestCx, (data as any)?.controlY);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleMouseDownHoriz = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const startCy = effectiveControlY !== undefined ? effectiveControlY : (angledInfo?.cy ?? labelY);
    const zoom = reactFlow?.getZoom ? reactFlow.getZoom() : 1;
    let latestCy = startCy;

    const onMouseMove = (moveEvt: MouseEvent) => {
      const deltaY = (moveEvt.clientY - startY) / zoom;
      const newCy = Math.round(startCy + deltaY);
      latestCy = newCy;
      setDragCy(newCy); // Fast local update only
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setDragCy(null);
      // Commit once on mouse release
      (data as any)?.onUpdateControlPoints?.(id, (data as any)?.controlX, latestCy);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const edgeLabel = label || (data as any)?.label;
  const isExploit = edgeLabel?.toLowerCase().includes('exploit') || edgeLabel?.toLowerCase().includes('escalat');
  const isDark = ((data as any)?.theme || 'dark') === 'dark';
  const isSelected = selected || (data as any)?.selected;

  const edgeStyle = (data as any)?.style || 'solid';
  let strokeDasharray: string | undefined = undefined;
  if (edgeStyle === 'dotted') {
    strokeDasharray = '2,3';
  } else if (edgeStyle === 'dashed' || isExploit) {
    strokeDasharray = '6,4';
  }

  const strokeColor = isSelected
    ? '#3b82f6'
    : isExploit
    ? '#ef4444'
    : (data as any)?.color || '#94a3b8';

  return (
    <>
      {/* Invisible wide stroke for effortless click interaction everywhere, even in boundaries */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={32}
        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
        onClick={(e) => {
          e.stopPropagation();
          (data as any)?.onSelectEdge?.(id);
        }}
      />

      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth: isSelected ? 2.5 : 1.6,
          strokeDasharray,
          filter: isSelected ? 'drop-shadow(0 0 5px rgba(59, 130, 246, 0.6))' : undefined,
          cursor: 'pointer',
          pointerEvents: 'stroke',
          opacity: (data as any)?.isDimmed ? 0.18 : 1,
          transition: 'opacity 0.25s ease',
        }}
      />

      {/* Interactive Drag Handles for Angled Routing */}
      {routing === 'angled' && isSelected && angledInfo && (
        <EdgeLabelRenderer>
          {angledInfo.vertSeg && (
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${angledInfo.vertSeg.x}px,${angledInfo.vertSeg.y}px)`,
                pointerEvents: 'all',
                zIndex: 1002,
              }}
              className="nodrag nopan"
            >
              <div
                onMouseDown={handleMouseDownVert}
                title="Drag left/right to move vertical line segment"
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  backgroundColor: '#2563eb',
                  border: '2px solid #ffffff',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: 'ew-resize',
                  boxShadow: '0 2px 10px rgba(37, 99, 235, 0.6)',
                  userSelect: 'none',
                }}
              >
                ↔
              </div>
            </div>
          )}

          {angledInfo.horizSeg && (
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${angledInfo.horizSeg.x}px,${angledInfo.horizSeg.y}px)`,
                pointerEvents: 'all',
                zIndex: 1002,
              }}
              className="nodrag nopan"
            >
              <div
                onMouseDown={handleMouseDownHoriz}
                title="Drag up/down to move horizontal line segment"
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  backgroundColor: '#2563eb',
                  border: '2px solid #ffffff',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: 'ns-resize',
                  boxShadow: '0 2px 10px rgba(37, 99, 235, 0.6)',
                  userSelect: 'none',
                }}
              >
                ↕
              </div>
            </div>
          )}
        </EdgeLabelRenderer>
      )}

      {edgeLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: 1000,
              opacity: (data as any)?.isDimmed ? 0.18 : 1,
              transition: 'opacity 0.25s ease',
            }}
            className="nodrag nopan"
          >
            <div
              onClick={(e) => {
                e.stopPropagation();
                (data as any)?.onSelectEdge?.(id);
              }}
              title="Click to inspect/edit connection"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 8px',
                borderRadius: '9999px',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.02em',
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                backgroundColor: isSelected
                  ? '#2563eb'
                  : isExploit
                  ? (isDark ? '#3b1219' : '#fee2e2')
                  : edgeLabel === 'calls'
                  ? '#3b82f6'
                  : (isDark ? '#162032' : 'rgba(255, 255, 255, 0.95)'),
                color: isSelected
                  ? '#ffffff'
                  : isExploit
                  ? '#ef4444'
                  : edgeLabel === 'calls'
                  ? '#ffffff'
                  : (isDark ? '#cbd5e1' : '#475569'),
                border: isSelected
                  ? '1px solid #60a5fa'
                  : isExploit
                  ? `1px solid ${isDark ? '#5c1d27' : '#fecaca'}`
                  : edgeLabel === 'calls'
                  ? '1px solid #2563eb'
                  : `1px solid ${isDark ? '#28374f' : '#cbd5e1'}`,
                boxShadow: isSelected
                  ? '0 0 8px rgba(59, 130, 246, 0.6)'
                  : isDark
                  ? '0 2px 6px rgba(0,0,0,0.4)'
                  : '0 1px 3px rgba(0,0,0,0.08)',
                transition: 'all 0.15s ease',
              }}
            >
              {edgeLabel}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(CustomEdge);
