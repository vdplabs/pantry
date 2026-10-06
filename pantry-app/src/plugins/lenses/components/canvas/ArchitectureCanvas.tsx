import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import {
  FiShield, FiLayers, FiBookmark, FiDownload,
  FiRotateCcw, FiCode, FiLayout, FiSun, FiMoon
} from 'react-icons/fi';

import type {
  LensState, LensComponent, LensBoundary, LensConnection, LensNote,
  LensThreat, LensDecision, LensInvariant
} from '../../types';
import CustomComponentNode from './CustomComponentNode';
import CustomBoundaryNode from './CustomBoundaryNode';
import CustomNoteNode from './CustomNoteNode';
import CustomEdge from './CustomEdge';
import ComponentFlyout from './ComponentFlyout';
import CanvasInspectorDrawer from './CanvasInspectorDrawer';
import CanvasToolbar from './CanvasToolbar';
import HostCanvasBar from './HostCanvasBar';
import { useApp } from '@/context/AppContext';

const nodeTypes = {
  componentNode: CustomComponentNode,
  boundaryNode: CustomBoundaryNode,
  noteNode: CustomNoteNode,
};

const edgeTypes = {
  customEdge: CustomEdge,
};

interface Props {
  state: LensState;
  onChange: (newState: LensState) => void;
  onSendPrompt: (prompt: string) => void;
  onNavigateToCard: (cardId: string, category: 'threats' | 'decisions' | 'invariants') => void;
}

export default function ArchitectureCanvas({
  state,
  onChange,
  onSendPrompt,
  onNavigateToCard,
}: Props) {
  const { state: appState, setTheme } = useApp();
  const isDark = (appState?.theme || state.theme || 'dark') === 'dark';

  useEffect(() => {
    if (appState?.theme && appState.theme !== state.theme) {
      onChange({
        ...state,
        theme: appState.theme,
      });
    }
  }, [appState?.theme]);

  const [subView, setSubView] = useState<'canvas' | 'code'>('canvas');
  const [activeTool, setActiveTool] = useState<'select' | 'addComponent' | 'addBoundary' | 'connect' | 'addNote'>('select');
  const [isLocked, setIsLocked] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);

  // Filter toggles matching user request and Image 4
  const [showThreats, setShowThreats] = useState<boolean>(true);
  const [showBoundaries, setShowBoundaries] = useState<boolean>(true);
  const [showDecisions, setShowDecisions] = useState<boolean>(true);

  // Inspector Selections
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedBoundaryId, setSelectedBoundaryId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<{ id: string; category: 'threats' | 'decisions' | 'invariants' } | null>(null);
  const [initialEditMode, setInitialEditMode] = useState<boolean>(false);

  // React Flow Instance for screen-to-canvas coordinate mapping
  const [rfInstance, setRfInstance] = useState<any>(null);

  // Popover Flyout State
  const [flyoutComponentId, setFlyoutComponentId] = useState<string | null>(null);
  const [flyoutSide, setFlyoutSide] = useState<'left' | 'right'>('right');

  // Track boundary dragging state
  const boundaryDragRef = useRef<{
    boundaryId: string;
    lastPos: { x: number; y: number };
    memberComponentIds: string[];
  } | null>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    component: LensComponent | null;
  }>({ visible: false, x: 0, y: 0, component: null });

  // Component resizing handler
  const handleResizeComponent = useCallback((id: string, width: number, height: number, x?: number, y?: number) => {
    const comp = state.components.find(c => c.id === id);
    const compX = x !== undefined ? x : (comp?.x ?? 0);
    const compY = y !== undefined ? y : (comp?.y ?? 0);

    let updatedBoundaries = state.boundaries;
    const targetBoundary = state.boundaries.find(b =>
      b.componentIds?.includes(id) || comp?.boundaryId === b.id
    );

    if (targetBoundary) {
      const PAD_X = 35;
      const PAD_Y = 45;

      const bLeft = Math.min(targetBoundary.x, compX - PAD_X);
      const bTop = Math.min(targetBoundary.y, compY - PAD_Y);
      const bRight = Math.max(targetBoundary.x + targetBoundary.width, compX + width + PAD_X);
      const bBottom = Math.max(targetBoundary.y + targetBoundary.height, compY + height + PAD_X);

      const newWidth = Math.round(bRight - bLeft);
      const newHeight = Math.round(bBottom - bTop);
      const newBoundaryX = Math.round(bLeft);
      const newBoundaryY = Math.round(bTop);

      updatedBoundaries = state.boundaries.map(b =>
        b.id === targetBoundary.id
          ? {
              ...b,
              x: newBoundaryX,
              y: newBoundaryY,
              width: newWidth,
              height: newHeight,
            }
          : b
      );
    }

    onChange({
      ...state,
      components: state.components.map(c =>
        c.id === id
          ? {
              ...c,
              width,
              height,
              x: compX,
              y: compY,
            }
          : c
      ),
      boundaries: updatedBoundaries,
      updatedAt: new Date().toISOString(),
    });
  }, [state, onChange]);

  // Boundary resizing handler
  const handleResizeBoundary = useCallback((id: string, width: number, height: number, x?: number, y?: number) => {
    onChange({
      ...state,
      boundaries: state.boundaries.map(b =>
        b.id === id
          ? {
              ...b,
              width,
              height,
              x: x !== undefined ? x : b.x,
              y: y !== undefined ? y : b.y,
            }
          : b
      ),
      updatedAt: new Date().toISOString(),
    });
  }, [state, onChange]);

  // Note resizing handler
  const handleResizeNote = useCallback((id: string, width: number, height: number, x?: number, y?: number) => {
    onChange({
      ...state,
      notes: state.notes.map(n =>
        n.id === id
          ? {
              ...n,
              width,
              height,
              x: x !== undefined ? x : n.x,
              y: y !== undefined ? y : n.y,
            }
          : n
      ),
      updatedAt: new Date().toISOString(),
    });
  }, [state, onChange]);

  // Angled connector wire control point handler
  const handleUpdateControlPoints = useCallback((edgeId: string, controlX?: number, controlY?: number) => {
    onChange({
      ...state,
      connections: state.connections.map(c =>
        c.id === edgeId ? { ...c, controlX, controlY } : c
      ),
      updatedAt: new Date().toISOString(),
    });
  }, [state, onChange]);

  // Connected components calculation: clicked component + all connected components stay highlighted
  const connectedComponentIds = useMemo(() => {
    if (!selectedComponentId) return new Set<string>();
    const set = new Set<string>();
    set.add(selectedComponentId);
    for (const conn of state.connections) {
      if (conn.from === selectedComponentId) set.add(conn.to);
      if (conn.to === selectedComponentId) set.add(conn.from);
    }
    return set;
  }, [selectedComponentId, state.connections]);

  // Select component and show card popover + show component in right inspector
  const handleSelectComponent = useCallback((id: string) => {
    setSelectedComponentId(id);
    setSelectedEdgeId(null);
    setSelectedBoundaryId(null);
    setSelectedNoteId(null);
    setSelectedCard(null);
    setInitialEditMode(false);
    setIsInspectorOpen(true);
  }, []);

  // Create threat directly for component
  const handleCreateThreatForComponent = useCallback((compId: string) => {
    const targetComp = state.components.find(c => c.id === compId);
    const count = state.threats.length + 1;
    const threatId = `THR-${count < 10 ? '0' + count : count}`;
    const newThreat: LensThreat = {
      id: threatId,
      title: `Privileged access on ${targetComp?.name || compId}`,
      componentId: compId,
      componentName: targetComp?.name,
      category: 'Elevation of Privilege',
      severity: 'High',
      likelihood: 'High',
      risk: 'High',
      status: 'Open',
      description: `Hypothetical escalation targeting ${targetComp?.name || compId}.`,
      mitigation: 'Implement mutual TLS, strict RBAC and continuous audit review.',
    };
    onChange({
      ...state,
      threats: [...state.threats, newThreat],
      updatedAt: new Date().toISOString(),
    });
    setSelectedCard({ id: threatId, category: 'threats' });
    setIsInspectorOpen(true);
  }, [state, onChange]);

  // Create decision directly for component
  const handleCreateDecisionForComponent = useCallback((compId: string) => {
    const targetComp = state.components.find(c => c.id === compId);
    const count = state.decisions.length + 1;
    const adrId = `ADR-${count < 10 ? '0' + count : count}`;
    const newDecision: LensDecision = {
      id: adrId,
      title: `Architectural Strategy for ${targetComp?.name || compId}`,
      componentId: compId,
      componentName: targetComp?.name,
      approach: 'Adopt zero-trust microsegmentation and resilient fallbacks.',
      rationale: 'Guarantees service isolation and bounded failure domains.',
      status: 'Proposed',
    };
    onChange({
      ...state,
      decisions: [...state.decisions, newDecision],
      updatedAt: new Date().toISOString(),
    });
    setSelectedCard({ id: adrId, category: 'decisions' });
    setIsInspectorOpen(true);
  }, [state, onChange]);

  // Threat handlers
  const handleUpdateThreat = useCallback((updated: LensThreat) => {
    onChange({
      ...state,
      threats: state.threats.map(t => t.id === updated.id ? updated : t),
      updatedAt: new Date().toISOString(),
    });
  }, [state, onChange]);

  const handleDeleteThreat = useCallback((threatId: string) => {
    onChange({
      ...state,
      threats: state.threats.filter(t => t.id !== threatId),
      updatedAt: new Date().toISOString(),
    });
    setSelectedCard(prev => prev?.id === threatId ? null : prev);
  }, [state, onChange]);

  // Decision handlers
  const handleUpdateDecision = useCallback((updated: LensDecision) => {
    onChange({
      ...state,
      decisions: state.decisions.map(d => d.id === updated.id ? updated : d),
      updatedAt: new Date().toISOString(),
    });
  }, [state, onChange]);

  const handleDeleteDecision = useCallback((decisionId: string) => {
    onChange({
      ...state,
      decisions: state.decisions.filter(d => d.id !== decisionId),
      updatedAt: new Date().toISOString(),
    });
    setSelectedCard(prev => prev?.id === decisionId ? null : prev);
  }, [state, onChange]);

  // Invariant handlers
  const handleUpdateInvariant = useCallback((updated: LensInvariant) => {
    onChange({
      ...state,
      invariants: state.invariants.map(i => i.id === updated.id ? updated : i),
      updatedAt: new Date().toISOString(),
    });
  }, [state, onChange]);

  const handleDeleteInvariant = useCallback((invariantId: string) => {
    onChange({
      ...state,
      invariants: state.invariants.filter(i => i.id !== invariantId),
      updatedAt: new Date().toISOString(),
    });
    setSelectedCard(prev => prev?.id === invariantId ? null : prev);
  }, [state, onChange]);

  // Draft ADR from threat
  const handleDraftAdrFromThreat = useCallback((threat: LensThreat) => {
    const targetComp = state.components.find(c => c.id === threat.componentId);
    const count = state.decisions.length + 1;
    const adrId = `ADR-${count < 10 ? '0' + count : count}`;
    const newDecision: LensDecision = {
      id: adrId,
      title: `Mitigation Strategy for ${threat.title}`,
      componentId: threat.componentId,
      componentName: targetComp?.name || threat.componentName,
      approach: threat.mitigation ? `Mitigation: ${threat.mitigation}` : 'Implement security guardrails and access controls.',
      rationale: `Drafted to mitigate threat ${threat.id} (${threat.title}): ${threat.description || 'System vulnerability mitigation.'}`,
      status: 'Proposed',
    };
    const updatedThreat: LensThreat = {
      ...threat,
      linkedAdrId: adrId,
    };
    onChange({
      ...state,
      decisions: [...state.decisions, newDecision],
      threats: state.threats.map(t => t.id === threat.id ? updatedThreat : t),
      updatedAt: new Date().toISOString(),
    });
    setSelectedCard({ id: adrId, category: 'decisions' });
  }, [state, onChange]);

  // Map state components, boundaries, notes to React Flow nodes
  const currentTheme = appState?.theme || state.theme || 'dark';
  const initialNodes: Node[] = useMemo(() => {
    const list: Node[] = [];

    // 1. Boundaries (Rendered behind components when showBoundaries is toggled on)
    if (showBoundaries) {
      for (const b of state.boundaries) {
        list.push({
          id: `boundary-${b.id}`,
          type: 'boundaryNode',
          position: { x: b.x, y: b.y },
          style: { width: b.width || 420, height: b.height || 260 },
          width: b.width || 420,
          height: b.height || 260,
          data: {
            boundary: b,
            theme: currentTheme,
            isDimmed: Boolean(selectedComponentId),
            onResizeBoundary: handleResizeBoundary,
            onSelectBoundary: (id: string) => {
              setSelectedBoundaryId(id);
              setSelectedComponentId(null);
              setSelectedEdgeId(null);
              setSelectedNoteId(null);
              setSelectedCard(null);
              setIsInspectorOpen(true);
            },
          },
          selected: selectedBoundaryId === b.id,
          zIndex: 0,
          selectable: true,
          draggable: !isLocked,
        });
      }
    }

    // 2. Notes
    for (const n of state.notes) {
      list.push({
        id: `note-${n.id}`,
        type: 'noteNode',
        position: { x: n.x, y: n.y },
        style: { width: n.width || 180, height: n.height || 90 },
        width: n.width || 180,
        height: n.height || 90,
        data: {
          note: n,
          theme: currentTheme,
          isDimmed: Boolean(selectedComponentId),
          onResizeNote: handleResizeNote,
          onSelectNote: (id: string) => {
            setSelectedNoteId(id);
            setSelectedComponentId(null);
            setSelectedEdgeId(null);
            setSelectedBoundaryId(null);
            setSelectedCard(null);
            setIsInspectorOpen(true);
          },
        },
        selected: selectedNoteId === n.id,
        zIndex: 5,
        draggable: !isLocked,
      });
    }

    // 3. Components
    for (const c of state.components) {
      const cThreats = state.threats.filter(t => t.componentId === c.id || (t.componentName && t.componentName.toLowerCase() === c.name.toLowerCase()));
      const cDecisions = state.decisions.filter(d => d.componentId === c.id || (d.componentName && d.componentName.toLowerCase() === c.name.toLowerCase()));
      const cInvariants = state.invariants.filter(i => i.componentId === c.id || (i.componentName && i.componentName.toLowerCase() === c.name.toLowerCase()));

      const isSelected = selectedComponentId === c.id;
      const isConnected = connectedComponentIds.has(c.id);
      const isHighlighted = Boolean(selectedComponentId && isConnected && !isSelected);
      const isDimmed = Boolean(selectedComponentId && !isConnected);

      list.push({
        id: c.id,
        type: 'componentNode',
        position: { x: c.x, y: c.y },
        selected: isSelected,
        style: { width: c.width || 210, height: c.height || 85 },
        width: c.width || 210,
        height: c.height || 85,
        data: {
          component: c,
          isSelected,
          threatsCount: cThreats.length,
          decisionsCount: cDecisions.length,
          invariantsCount: cInvariants.length,
          attachedThreats: cThreats,
          attachedDecisions: cDecisions,
          attachedInvariants: cInvariants,
          selectedCardId: selectedCard?.id || null,
          theme: currentTheme,
          showThreats,
          showDecisions,
          isHighlighted,
          isDimmed,
          onSelectCard: (card: { id: string; category: 'threats' | 'decisions' | 'invariants' }) => {
            setSelectedCard(card);
            setIsInspectorOpen(true);
          },
          onResizeComponent: handleResizeComponent,
          onCreateThreat: (compId: string) => {
            handleCreateThreatForComponent(compId);
          },
          onCreateDecision: (compId: string) => {
            handleCreateDecisionForComponent(compId);
          },
          onOpenFlyout: (id: string, side: 'left' | 'right') => {
            setFlyoutSide(side);
            setFlyoutComponentId(id);
          },
          onSelectComponent: (id: string) => {
            handleSelectComponent(id);
          },
          onSelectForEdit: (id: string) => {
            setSelectedComponentId(id);
            setSelectedEdgeId(null);
            setSelectedBoundaryId(null);
            setSelectedNoteId(null);
            setSelectedCard(null);
            setInitialEditMode(true);
            setIsInspectorOpen(true);
          },
        },
        zIndex: isSelected ? 1000 : (isHighlighted ? 60 : 10),
        draggable: !isLocked,
      });
    }

    return list;
  }, [state.boundaries, state.notes, state.components, state.threats, state.decisions, state.invariants, state.theme, isLocked, selectedComponentId, selectedBoundaryId, selectedNoteId, selectedCard, showBoundaries, showThreats, showDecisions, connectedComponentIds, handleResizeComponent, handleResizeBoundary, handleResizeNote, handleSelectComponent, handleCreateThreatForComponent, handleCreateDecisionForComponent]);

  // Map state connections to React Flow edges with smart handle calculation
  const initialEdges: Edge[] = useMemo(() => {
    return state.connections.map(c => {
      const isExploit = showThreats && c.label?.toLowerCase().includes('exploit');
      const edgeColor = isExploit ? '#ef4444' : (c.color || '#94a3b8');
      const isSelected = selectedEdgeId === c.id;

      // Find source and target components to determine smart handle connections
      const fromComp = state.components.find(item => item.id === c.from);
      const toComp = state.components.find(item => item.id === c.to);

      let sourceHandle = c.sourceHandle;
      let targetHandle = c.targetHandle;

      if (!sourceHandle || !targetHandle) {
        if (fromComp && toComp) {
          const fromW = fromComp.width || 210;
          const fromH = fromComp.height || 85;
          const toW = toComp.width || 210;
          const toH = toComp.height || 85;

          const c1 = { x: fromComp.x + fromW / 2, y: fromComp.y + fromH / 2 };
          const c2 = { x: toComp.x + toW / 2, y: toComp.y + toH / 2 };

          const dx = c2.x - c1.x;
          const dy = c2.y - c1.y;

          // Determine dominant axis for natural routing
          if (Math.abs(dx) >= Math.abs(dy)) {
            if (dx >= 0) {
              sourceHandle = 'right-source';
              targetHandle = 'left-target';
            } else {
              sourceHandle = 'left-source';
              targetHandle = 'right-target';
            }
          } else {
            if (dy >= 0) {
              sourceHandle = 'bottom-source';
              targetHandle = 'top-target';
            } else {
              sourceHandle = 'top-source';
              targetHandle = 'bottom-target';
            }
          }
        } else {
          sourceHandle = 'right-source';
          targetHandle = 'left-target';
        }
      }

      const dir = c.direction || (c.bidirectional ? 'bidirectional' : 'forward');

      const markerConfig = {
        type: MarkerType.ArrowClosed,
        color: isSelected ? '#3b82f6' : edgeColor,
        width: 14,
        height: 14,
      };

      const isConnectedToSelected = selectedComponentId ? (c.from === selectedComponentId || c.to === selectedComponentId) : false;
      const isDimmed = Boolean(selectedComponentId && !isConnectedToSelected);

      return {
        id: c.id,
        source: c.from,
        target: c.to,
        sourceHandle,
        targetHandle,
        type: 'customEdge',
        selected: isSelected,
        data: {
          label: c.label,
          color: edgeColor,
          style: isExploit ? 'dashed' : (c.style || 'solid'),
          direction: dir,
          routing: c.routing || 'straight',
          controlX: c.controlX,
          controlY: c.controlY,
          selected: isSelected,
          theme: currentTheme,
          isDimmed,
          onUpdateControlPoints: handleUpdateControlPoints,
          onSelectEdge: (id: string) => {
            setSelectedEdgeId(id);
            setSelectedComponentId(null);
            setSelectedBoundaryId(null);
            setSelectedNoteId(null);
            setSelectedCard(null);
            setIsInspectorOpen(true);
          },
        },
        markerEnd: dir === 'reverse' ? undefined : markerConfig,
        markerStart: (dir === 'bidirectional' || dir === 'reverse') ? markerConfig : undefined,
      };
    });
  }, [state.connections, state.components, state.theme, selectedEdgeId, selectedComponentId, showThreats, handleUpdateControlPoints]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync internal React Flow state when outer state changes
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // On Boundary Drag Start: identify enclosed member components
  const onNodeDragStart = useCallback((_: any, node: Node) => {
    if (node.type === 'boundaryNode') {
      const rawId = node.id.replace('boundary-', '');
      const b = state.boundaries.find(item => item.id === rawId);
      if (b) {
        // Only drag explicit member components, never adopt unassigned components based on spatial coordinates
        const members = state.components.filter(c =>
          b.componentIds?.includes(c.id) ||
          c.boundaryId === rawId
        ).map(c => c.id);

        boundaryDragRef.current = {
          boundaryId: rawId,
          lastPos: { x: node.position.x, y: node.position.y },
          memberComponentIds: members,
        };
      }
    }
  }, [state.boundaries, state.components]);

  // On Node Drag: if boundary is moving, shift its child components with it in real-time
  const onNodeDrag = useCallback((_: any, node: Node) => {
    if (node.type === 'boundaryNode' && boundaryDragRef.current && node.id === `boundary-${boundaryDragRef.current.boundaryId}`) {
      const dx = node.position.x - boundaryDragRef.current.lastPos.x;
      const dy = node.position.y - boundaryDragRef.current.lastPos.y;
      boundaryDragRef.current.lastPos = { x: node.position.x, y: node.position.y };

      if (dx !== 0 || dy !== 0) {
        setNodes(prevNodes => prevNodes.map(n => {
          if (boundaryDragRef.current?.memberComponentIds.includes(n.id)) {
            return {
              ...n,
              position: {
                x: Math.round(n.position.x + dx),
                y: Math.round(n.position.y + dy),
              },
            };
          }
          return n;
        }));
      }
    }
  }, [setNodes]);

  // Handle Drag Stop: auto-expand boundary if member component moved, or finalize boundary move
  const onNodeDragStop = useCallback((_: any, node: Node) => {
    if (node.type === 'componentNode') {
      const compId = node.id;
      const comp = state.components.find(c => c.id === compId);
      if (!comp) return;

      const newX = Math.round(node.position.x);
      const newY = Math.round(node.position.y);
      const compW = comp.width || 200;
      const compH = comp.height || 85;

      // Identify which boundary this component belongs to (strictly by assignment, never accidental proximity)
      const targetBoundary = state.boundaries.find(b =>
        b.componentIds?.includes(compId) || comp.boundaryId === b.id
      );

      let updatedBoundaries = [...state.boundaries];
      let assignedBoundaryId = comp.boundaryId;

      if (targetBoundary) {
        assignedBoundaryId = targetBoundary.id;
        const PAD_X = 35;
        const PAD_Y = 45;

        // Auto-expand boundary if member component moved near or beyond perimeter
        const bLeft = Math.min(targetBoundary.x, newX - PAD_X);
        const bTop = Math.min(targetBoundary.y, newY - PAD_Y);
        const bRight = Math.max(targetBoundary.x + targetBoundary.width, newX + compW + PAD_X);
        const bBottom = Math.max(targetBoundary.y + targetBoundary.height, newY + compH + PAD_X);

        const newWidth = Math.round(bRight - bLeft);
        const newHeight = Math.round(bBottom - bTop);
        const newBoundaryX = Math.round(bLeft);
        const newBoundaryY = Math.round(bTop);

        const componentIds = Array.from(new Set([...(targetBoundary.componentIds || []), compId]));

        updatedBoundaries = updatedBoundaries.map(b =>
          b.id === targetBoundary.id
            ? {
                ...b,
                x: newBoundaryX,
                y: newBoundaryY,
                width: newWidth,
                height: newHeight,
                componentIds,
              }
            : b
        );
      }

      const updatedComponents = state.components.map(c =>
        c.id === compId
          ? { ...c, x: newX, y: newY, boundaryId: assignedBoundaryId }
          : c
      );

      onChange({
        ...state,
        components: updatedComponents,
        boundaries: updatedBoundaries,
        updatedAt: new Date().toISOString(),
      });
    } else if (node.type === 'boundaryNode') {
      if (!boundaryDragRef.current) {
        // Was resizing or clicking, not dragging - ignore
        return;
      }
      const rawId = node.id.replace('boundary-', '');
      const b = state.boundaries.find(item => item.id === rawId);
      if (b) {
        const finalBx = Math.round(node.position.x);
        const finalBy = Math.round(node.position.y);
        const totalDx = finalBx - b.x;
        const totalDy = finalBy - b.y;
        const memberIds = boundaryDragRef.current?.memberComponentIds || [];

        boundaryDragRef.current = null;

        const updatedBoundaries = state.boundaries.map(item =>
          item.id === rawId ? { ...item, x: finalBx, y: finalBy } : item
        );

        const updatedComponents = state.components.map(c => {
          if (memberIds.includes(c.id) || c.boundaryId === rawId) {
            return {
              ...c,
              x: Math.round(c.x + totalDx),
              y: Math.round(c.y + totalDy),
            };
          }
          return c;
        });

        onChange({
          ...state,
          boundaries: updatedBoundaries,
          components: updatedComponents,
          updatedAt: new Date().toISOString(),
        });
      }
    } else if (node.type === 'noteNode') {
      const rawId = node.id.replace('note-', '');
      const updated = state.notes.map(n =>
        n.id === rawId ? { ...n, x: Math.round(node.position.x), y: Math.round(node.position.y) } : n
      );
      onChange({ ...state, notes: updated, updatedAt: new Date().toISOString() });
    }
  }, [state, onChange]);

  // Handle Connecting Wires (Default straight routing)
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const newConn: LensConnection = {
      id: `w_${Date.now()}`,
      from: connection.source,
      to: connection.target,
      label: 'calls',
      color: '#3b82f6',
      style: 'solid',
      direction: 'forward',
      routing: 'straight',
      sourceHandle: connection.sourceHandle || undefined,
      targetHandle: connection.targetHandle || undefined,
    };
    onChange({
      ...state,
      connections: [...state.connections, newConn],
      updatedAt: new Date().toISOString(),
    });
    setSelectedEdgeId(newConn.id);
    setSelectedComponentId(null);
    setSelectedBoundaryId(null);
    setSelectedNoteId(null);
    setSelectedCard(null);
    setIsInspectorOpen(true);
  }, [state, onChange]);

  // Handle Node Click
  const onNodeClick = useCallback((_: any, node: Node) => {
    if (node.type === 'componentNode') {
      handleSelectComponent(node.id);
    } else if (node.type === 'boundaryNode') {
      const rawId = node.id.replace('boundary-', '');
      setSelectedBoundaryId(rawId);
      setSelectedComponentId(null);
      setSelectedEdgeId(null);
      setSelectedNoteId(null);
      setSelectedCard(null);
      setIsInspectorOpen(true);
    } else if (node.type === 'noteNode') {
      const rawId = node.id.replace('note-', '');
      setSelectedNoteId(rawId);
      setSelectedComponentId(null);
      setSelectedEdgeId(null);
      setSelectedBoundaryId(null);
      setSelectedCard(null);
      setIsInspectorOpen(true);
    }
  }, [handleSelectComponent]);

  // Handle Edge Click
  const onEdgeClick = useCallback((_: any, edge: Edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedComponentId(null);
    setSelectedBoundaryId(null);
    setSelectedNoteId(null);
    setSelectedCard(null);
    setIsInspectorOpen(true);
  }, []);

  // Handle Right-Click on Node (Context Menu)
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    if (node.type === 'componentNode') {
      const comp = state.components.find(c => c.id === node.id);
      if (comp) {
        setContextMenu({
          visible: true,
          x: event.clientX,
          y: event.clientY,
          component: comp,
        });
      }
    }
  }, [state.components]);

  // Close context menu and flyouts on canvas click + clear dimming
  const onPaneClick = useCallback(() => {
    setFlyoutComponentId(null);
    setContextMenu({ visible: false, x: 0, y: 0, component: null });
    setSelectedComponentId(null);
    setSelectedEdgeId(null);
    setSelectedBoundaryId(null);
    setSelectedNoteId(null);
    setSelectedCard(null);
  }, []);

  // Double Click on Canvas creates a Note matching user instruction!
  const handleCanvasDoubleClick = useCallback((e: React.MouseEvent) => {
    // Avoid triggering when double-clicking on existing nodes or controls
    if ((e.target as HTMLElement).closest('.react-flow__node') || (e.target as HTMLElement).closest('.react-flow__controls')) {
      return;
    }

    let x = 450;
    let y = 350;
    if (rfInstance?.screenToFlowPosition) {
      const pos = rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      x = Math.round(pos.x);
      y = Math.round(pos.y);
    }

    const newNote: LensNote = {
      id: `note_${Date.now()}`,
      text: 'Ensuring customer-managed keys are implemented using FIPS 140-3 validated hardware offers strong cryptographic isolation within each tenant\'s environment.',
      color: 'green',
      x,
      y,
      width: 240,
      height: 95,
    };

    onChange({
      ...state,
      notes: [...state.notes, newNote],
      updatedAt: new Date().toISOString(),
    });

    setSelectedNoteId(newNote.id);
    setSelectedComponentId(null);
    setSelectedEdgeId(null);
    setSelectedBoundaryId(null);
    setIsInspectorOpen(true);
  }, [rfInstance, state, onChange]);

  // Dagre Auto-Arrange Layout Algorithm
  const handleAutoArrange = useCallback(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 60 });
    g.setDefaultEdgeLabel(() => ({}));

    // Register components
    state.components.forEach(c => {
      g.setNode(c.id, { width: c.width || 200, height: c.height || 85 });
    });

    // Register connections
    state.connections.forEach(conn => {
      g.setEdge(conn.from, conn.to);
    });

    dagre.layout(g);

    // Apply computed positions
    const arrangedComponents = state.components.map(c => {
      const nodePos = g.node(c.id);
      if (nodePos) {
        return {
          ...c,
          x: Math.round(nodePos.x - (c.width || 200) / 2 + 100),
          y: Math.round(nodePos.y - (c.height || 85) / 2 + 150),
        };
      }
      return c;
    });

    onChange({
      ...state,
      components: arrangedComponents,
      updatedAt: new Date().toISOString(),
    });
  }, [state, onChange]);

  // Add Component directly on flow
  const handleAddComponent = useCallback(() => {
    const existingCount = state.components.length;
    const xPos = 480 + (existingCount % 4) * 50;
    const yPos = 360 + (existingCount % 3) * 45;

    const newComp: LensComponent = {
      id: `comp_${Date.now()}`,
      name: `Component ${existingCount + 1}`,
      subtitle: 'Service / Microservice',
      type: 'service',
      category: 'service_process',
      cardSize: 'standard',
      x: xPos,
      y: yPos,
      width: 210,
      height: 85,
      threatCount: 0,
    };

    onChange({
      ...state,
      components: [...state.components, newComp],
      updatedAt: new Date().toISOString(),
    });

    setSelectedComponentId(newComp.id);
    setSelectedEdgeId(null);
    setSelectedBoundaryId(null);
    setSelectedNoteId(null);
    setInitialEditMode(true);
    setIsInspectorOpen(true);
  }, [state, onChange]);

  // Add Boundary directly on flow
  const handleAddBoundary = useCallback(() => {
    const existingCount = state.boundaries.length;
    const xPos = 320 + (existingCount % 3) * 40;
    const yPos = 300 + (existingCount % 3) * 40;

    const colors: ('orange' | 'blue' | 'purple' | 'green')[] = ['orange', 'blue', 'purple', 'green'];
    const assignedColor = colors[existingCount % colors.length];

    const newBoundary: LensBoundary = {
      id: `bnd_${Date.now()}`,
      title: `SECURITY BOUNDARY ${existingCount + 1}`,
      subtitle: '• Network Perimeter',
      color: assignedColor,
      x: xPos,
      y: yPos,
      width: 440,
      height: 270,
      componentIds: [],
    };

    onChange({
      ...state,
      boundaries: [...state.boundaries, newBoundary],
      updatedAt: new Date().toISOString(),
    });

    setSelectedBoundaryId(newBoundary.id);
    setSelectedComponentId(null);
    setSelectedEdgeId(null);
    setSelectedNoteId(null);
    setIsInspectorOpen(true);
  }, [state, onChange]);

  // Add Note directly on flow
  const handleAddNote = useCallback(() => {
    const existingCount = state.notes.length;
    const newNote: LensNote = {
      id: `note_${Date.now()}`,
      text: 'Ensuring customer-managed keys are implemented using FIPS 140-3 validated hardware offers strong cryptographic isolation within each tenant\'s environment.',
      color: 'green',
      x: 420 + (existingCount % 3) * 30,
      y: 280 + (existingCount % 3) * 30,
      width: 240,
      height: 95,
    };

    onChange({
      ...state,
      notes: [...state.notes, newNote],
      updatedAt: new Date().toISOString(),
    });

    setSelectedNoteId(newNote.id);
    setSelectedComponentId(null);
    setSelectedEdgeId(null);
    setSelectedBoundaryId(null);
    setIsInspectorOpen(true);
  }, [state, onChange]);

  // Handlers for Component Inspector updates
  const handleUpdateComponent = useCallback((updated: LensComponent, boundaryIds?: string[]) => {
    let newBoundaries = state.boundaries;
    if (boundaryIds !== undefined) {
      newBoundaries = state.boundaries.map(b => {
        const shouldContain = boundaryIds.includes(b.id);
        const currentContains = b.componentIds?.includes(updated.id);
        if (shouldContain && !currentContains) {
          return { ...b, componentIds: [...(b.componentIds || []), updated.id] };
        } else if (!shouldContain && currentContains) {
          return { ...b, componentIds: (b.componentIds || []).filter(id => id !== updated.id) };
        }
        return b;
      });
    }

    onChange({
      ...state,
      components: state.components.map(c => c.id === updated.id ? updated : c),
      boundaries: newBoundaries,
      updatedAt: new Date().toISOString(),
    });
  }, [state, onChange]);

  const handleDeleteComponent = useCallback((compId: string) => {
    onChange({
      ...state,
      components: state.components.filter(c => c.id !== compId),
      connections: state.connections.filter(conn => conn.from !== compId && conn.to !== compId),
      threats: state.threats.filter(t => t.componentId !== compId),
      decisions: state.decisions.filter(d => d.componentId !== compId),
      invariants: state.invariants.filter(i => i.componentId !== compId),
      boundaries: state.boundaries.map(b => ({
        ...b,
        componentIds: b.componentIds.filter(id => id !== compId),
      })),
      updatedAt: new Date().toISOString(),
    });
    setSelectedComponentId(prev => prev === compId ? null : prev);
  }, [state, onChange]);

  // Handlers for Connection Inspector updates
  const handleUpdateConnection = useCallback((updated: LensConnection) => {
    onChange({
      ...state,
      connections: state.connections.map(c => c.id === updated.id ? updated : c),
      updatedAt: new Date().toISOString(),
    });
  }, [state, onChange]);

  const handleDeleteConnection = useCallback((connId: string) => {
    onChange({
      ...state,
      connections: state.connections.filter(c => c.id !== connId),
      updatedAt: new Date().toISOString(),
    });
    setSelectedEdgeId(prev => prev === connId ? null : prev);
  }, [state, onChange]);

  const handleAddConnection = useCallback((from: string, to: string, label: string) => {
    const newConn: LensConnection = {
      id: `w_${Date.now()}`,
      from,
      to,
      label: label || 'calls',
      color: '#3b82f6',
      style: 'solid',
      direction: 'forward',
      routing: 'straight',
    };
    onChange({
      ...state,
      connections: [...state.connections, newConn],
      updatedAt: new Date().toISOString(),
    });
    setSelectedEdgeId(newConn.id);
  }, [state, onChange]);

  // Handlers for Boundary Inspector updates
  const handleUpdateBoundary = useCallback((updated: LensBoundary) => {
    onChange({
      ...state,
      boundaries: state.boundaries.map(b => b.id === updated.id ? updated : b),
      updatedAt: new Date().toISOString(),
    });
  }, [state, onChange]);

  const handleDeleteBoundary = useCallback((boundaryId: string) => {
    onChange({
      ...state,
      boundaries: state.boundaries.filter(b => b.id !== boundaryId),
      components: state.components.map(c => c.boundaryId === boundaryId ? { ...c, boundaryId: undefined } : c),
      updatedAt: new Date().toISOString(),
    });
    setSelectedBoundaryId(prev => prev === boundaryId ? null : prev);
  }, [state, onChange]);

  // Handlers for Note Inspector updates
  const handleUpdateNote = useCallback((updated: LensNote) => {
    onChange({
      ...state,
      notes: state.notes.map(n => n.id === updated.id ? updated : n),
      updatedAt: new Date().toISOString(),
    });
  }, [state, onChange]);

  const handleDeleteNote = useCallback((noteId: string) => {
    onChange({
      ...state,
      notes: state.notes.filter(n => n.id !== noteId),
      updatedAt: new Date().toISOString(),
    });
    setSelectedNoteId(prev => prev === noteId ? null : prev);
  }, [state, onChange]);

  // Contextual Chat action from component
  const handleChatAboutComponent = (component: LensComponent) => {
    setFlyoutComponentId(null);
    setContextMenu({ visible: false, x: 0, y: 0, component: null });
    const prompt = `Regarding component [${component.name}] (${component.subtitle || component.type}): What are the primary architectural tradeoffs, failure modes, trust boundaries, and potential invariants for this component?`;
    onSendPrompt(prompt);
  };

  // Recommend dependencies AI action
  const handleRecommendDependencies = (component: LensComponent) => {
    setFlyoutComponentId(null);
    setContextMenu({ visible: false, x: 0, y: 0, component: null });
    const prompt = `Analyze component [${component.name}] in our topology and recommend what architecture dependencies, caching layers, or security gateways we should add to support it. Provide a \`\`\`lens_patch block to add them to the canvas.`;
    onSendPrompt(prompt);
  };

  // Generate Threats AI action
  const handleGenerateThreats = (component: LensComponent) => {
    setFlyoutComponentId(null);
    setContextMenu({ visible: false, x: 0, y: 0, component: null });
    const prompt = `Perform a STRIDE & PASTA threat analysis specifically on component [${component.name}]. Identify potential threat vectors, mitigations, and ADR decisions, returning them in a \`\`\`lens_patch block.`;
    onSendPrompt(prompt);
  };

  // Generate ADR AI action
  const handleGenerateDecisions = (component: LensComponent) => {
    setFlyoutComponentId(null);
    setContextMenu({ visible: false, x: 0, y: 0, component: null });
    const prompt = `Formulate an Architecture Decision Record (ADR) for [${component.name}] addressing its trade-offs, technology choices, and reliability strategy. Return it in a \`\`\`lens_patch block.`;
    onSendPrompt(prompt);
  };

  // Bottom Host Canvas Bar submit
  const handleApplyTopologyEdit = (promptText: string) => {
    const fullPrompt = `Edit canvas topology according to user instruction: "${promptText}". Output clear architecture rationale and the updated topology inside a \`\`\`lens_patch block.`;
    onSendPrompt(fullPrompt);
  };

  // Active flyout component
  const activeFlyoutComponent = useMemo(() => {
    if (!flyoutComponentId) return null;
    return state.components.find(c => c.id === flyoutComponentId) || null;
  }, [flyoutComponentId, state.components]);

  // Export topology as JSON
  const handleExportJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `lens-${state.preset}-${Date.now()}.json`);
    dlAnchor.click();
  };

  return (
    <div
      className="lens-architecture-canvas"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: isDark ? '#080c14' : '#f8fafc',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Subheader Toolbar matching Image 4 */}
      <div
        className="lens-subheader"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          backgroundColor: isDark ? '#0d121c' : 'rgba(255, 255, 255, 0.95)',
          borderBottom: `1px solid ${isDark ? '#1e2638' : '#e2e8f0'}`,
          backdropFilter: 'blur(8px)',
          zIndex: 20,
          flexShrink: 0,
        }}
      >
        {/* Left: View Mode Pills (Canvas | Code) + Interactive Filter Toggles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            className="lens-view-toggle-group"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '2px',
              backgroundColor: isDark ? '#141d2d' : '#f1f5f9',
              border: `1px solid ${isDark ? '#23324c' : '#e2e8f0'}`,
              borderRadius: '8px',
            }}
          >
            <button
              type="button"
              onClick={() => setSubView('canvas')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '11.5px',
                fontWeight: 600,
                border: 'none',
                backgroundColor: subView === 'canvas' ? (isDark ? '#1e293b' : '#ffffff') : 'transparent',
                color: subView === 'canvas' ? (isDark ? '#f8fafc' : '#0f172a') : (isDark ? '#94a3b8' : '#64748b'),
                boxShadow: subView === 'canvas' ? (isDark ? '0 1px 3px rgba(0,0,0,0.3)' : '0 1px 2px rgba(0,0,0,0.05)') : 'none',
                cursor: 'pointer',
              }}
            >
              <FiLayout size={12} />
              <span>Canvas</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('code')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '11.5px',
                fontWeight: 600,
                border: 'none',
                backgroundColor: subView === 'code' ? (isDark ? '#1e293b' : '#ffffff') : 'transparent',
                color: subView === 'code' ? (isDark ? '#f8fafc' : '#0f172a') : (isDark ? '#94a3b8' : '#64748b'),
                boxShadow: subView === 'code' ? (isDark ? '0 1px 3px rgba(0,0,0,0.3)' : '0 1px 2px rgba(0,0,0,0.05)') : 'none',
                cursor: 'pointer',
              }}
            >
              <FiCode size={12} />
              <span>Code</span>
            </button>
          </div>

          {/* Interactive Filter Toggles matching user instruction & Image 4 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {/* Threats Toggle */}
            <button
              type="button"
              onClick={() => setShowThreats(!showThreats)}
              title={showThreats ? 'Click to hide threats on canvas' : 'Click to show threats on canvas'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '9999px',
                backgroundColor: showThreats
                  ? (isDark ? 'rgba(239, 68, 68, 0.16)' : '#fee2e2')
                  : (isDark ? '#141c2c' : '#f1f5f9'),
                color: showThreats ? '#ef4444' : (isDark ? '#64748b' : '#94a3b8'),
                border: showThreats
                  ? `1px solid ${isDark ? 'rgba(239, 68, 68, 0.4)' : '#fca5a5'}`
                  : `1px dashed ${isDark ? '#28374f' : '#cbd5e1'}`,
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                opacity: showThreats ? 1 : 0.5,
                textDecoration: showThreats ? 'none' : 'line-through',
                transition: 'all 0.15s ease',
              }}
            >
              <FiShield size={11} />
              <span>Threats {state.threats.length}</span>
            </button>

            {/* Boundaries Toggle */}
            <button
              type="button"
              onClick={() => setShowBoundaries(!showBoundaries)}
              title={showBoundaries ? 'Click to hide boundaries on canvas' : 'Click to show boundaries on canvas'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '9999px',
                backgroundColor: showBoundaries
                  ? (isDark ? 'rgba(16, 185, 129, 0.16)' : '#dcfce7')
                  : (isDark ? '#141c2c' : '#f1f5f9'),
                color: showBoundaries ? '#10b981' : (isDark ? '#64748b' : '#94a3b8'),
                border: showBoundaries
                  ? `1px solid ${isDark ? 'rgba(16, 185, 129, 0.4)' : '#86efac'}`
                  : `1px dashed ${isDark ? '#28374f' : '#cbd5e1'}`,
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                opacity: showBoundaries ? 1 : 0.5,
                textDecoration: showBoundaries ? 'none' : 'line-through',
                transition: 'all 0.15s ease',
              }}
            >
              <FiLayers size={11} />
              <span>Boundaries {state.boundaries.length}</span>
            </button>

            {/* Decisions Toggle */}
            <button
              type="button"
              onClick={() => setShowDecisions(!showDecisions)}
              title={showDecisions ? 'Click to hide decisions on canvas' : 'Click to show decisions on canvas'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '9999px',
                backgroundColor: showDecisions
                  ? (isDark ? 'rgba(245, 158, 11, 0.16)' : '#fef3c7')
                  : (isDark ? '#141c2c' : '#f1f5f9'),
                color: showDecisions ? '#f59e0b' : (isDark ? '#64748b' : '#94a3b8'),
                border: showDecisions
                  ? `1px solid ${isDark ? 'rgba(245, 158, 11, 0.4)' : '#fde68a'}`
                  : `1px dashed ${isDark ? '#28374f' : '#cbd5e1'}`,
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                opacity: showDecisions ? 1 : 0.5,
                textDecoration: showDecisions ? 'none' : 'line-through',
                transition: 'all 0.15s ease',
              }}
            >
              <FiBookmark size={11} />
              <span>Decisions {state.decisions.length}</span>
            </button>
          </div>
        </div>

        {/* Right: Actions (Theme Toggle, Export, Undo) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Theme Switcher Toggle */}
          <button
            type="button"
            onClick={() => {
              const nextTheme = isDark ? 'light' : 'dark';
              setTheme(nextTheme);
              onChange({
                ...state,
                theme: nextTheme,
                updatedAt: new Date().toISOString(),
              });
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 10px',
              borderRadius: '6px',
              fontSize: '11.5px',
              fontWeight: 600,
              color: isDark ? '#f8fafc' : '#334155',
              backgroundColor: isDark ? '#1a2333' : '#f1f5f9',
              border: `1px solid ${isDark ? '#2b3a55' : '#cbd5e1'}`,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            title={`Switch to ${isDark ? 'Light' : 'Dark'} Mode`}
          >
            {isDark ? <FiSun size={12} style={{ color: '#f59e0b' }} /> : <FiMoon size={12} style={{ color: '#6366f1' }} />}
            <span>{isDark ? 'Light' : 'Dark'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 10px',
              borderRadius: '6px',
              fontSize: '11.5px',
              fontWeight: 500,
              color: isDark ? '#cbd5e1' : '#475569',
              backgroundColor: isDark ? '#162032' : '#ffffff',
              border: `1px solid ${isDark ? '#263650' : '#cbd5e1'}`,
              cursor: 'pointer',
            }}
          >
            <FiDownload size={12} />
            <span>Export</span>
          </button>
          <button
            type="button"
            onClick={() => onChange(state)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 10px',
              borderRadius: '6px',
              fontSize: '11.5px',
              fontWeight: 500,
              color: isDark ? '#cbd5e1' : '#475569',
              backgroundColor: isDark ? '#162032' : '#ffffff',
              border: `1px solid ${isDark ? '#263650' : '#cbd5e1'}`,
              cursor: 'pointer',
            }}
          >
            <FiRotateCcw size={12} />
            <span>Undo</span>
          </button>
        </div>
      </div>

      {/* Main Canvas Area */}
      {subView === 'canvas' ? (
        <div
          className="lens-canvas-area"
          style={{
            position: 'relative',
            flex: 1,
            width: '100%',
            height: '100%',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* React Flow Container */}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes as any}
            edgeTypes={edgeTypes as any}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={(instance) => setRfInstance(instance)}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onNodeContextMenu={onNodeContextMenu}
            onPaneClick={onPaneClick}
            onDoubleClick={handleCanvasDoubleClick}
            fitView
            minZoom={0.2}
            maxZoom={2.0}
            defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
            style={{ width: '100%', height: '100%', backgroundColor: isDark ? '#090e18' : '#f8fafc' }}
          >
            {/* Background Grid with Dots matching Screenshot 1 */}
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1.2}
              color={isDark ? '#1e293b' : '#cbd5e1'}
            />
            <Controls
              style={{
                backgroundColor: isDark ? '#141d2d' : '#ffffff',
                borderRadius: '10px',
                overflow: 'hidden',
                border: `1px solid ${isDark ? '#23324c' : '#e2e8f0'}`,
                boxShadow: isDark ? '0 4px 16px rgba(0,0,0,0.4)' : '0 4px 12px rgba(0,0,0,0.08)',
              }}
            />
          </ReactFlow>

          {/* Left Toolbar Dock */}
          <CanvasToolbar
            activeTool={activeTool}
            isLocked={isLocked}
            theme={state.theme || 'dark'}
            showThreats={showThreats}
            showBoundaries={showBoundaries}
            showDecisions={showDecisions}
            onSelectTool={setActiveTool}
            onToggleLock={() => setIsLocked(!isLocked)}
            onToggleThreats={() => setShowThreats(!showThreats)}
            onToggleBoundaries={() => setShowBoundaries(!showBoundaries)}
            onToggleDecisions={() => setShowDecisions(!showDecisions)}
            onAddComponent={handleAddComponent}
            onAddBoundary={handleAddBoundary}
            onAddNote={handleAddNote}
          />

          {/* Component Flyout Popover matching Screenshot 3 */}
          {activeFlyoutComponent && (
            <ComponentFlyout
              component={activeFlyoutComponent}
              threats={state.threats}
              decisions={state.decisions}
              invariants={state.invariants}
              side={flyoutSide}
              theme={currentTheme}
              onClose={() => setFlyoutComponentId(null)}
              onNavigateToCard={onNavigateToCard}
              onChatAboutComponent={handleChatAboutComponent}
              onRecommendDependencies={handleRecommendDependencies}
              onGenerateThreats={handleGenerateThreats}
              onGenerateDecisions={handleGenerateDecisions}
            />
          )}

          {/* Right Inspector Drawer matching Screenshots 1, 2, 3, 4 */}
          {isInspectorOpen && (
            <CanvasInspectorDrawer
              state={state}
              theme={currentTheme}
              selectedComponentId={selectedComponentId}
              selectedEdgeId={selectedEdgeId}
              selectedBoundaryId={selectedBoundaryId}
              selectedNoteId={selectedNoteId}
              selectedCard={selectedCard}
              initialEditMode={initialEditMode}
              onCloseSelection={() => {
                setSelectedComponentId(null);
                setSelectedEdgeId(null);
                setSelectedBoundaryId(null);
                setSelectedNoteId(null);
                setSelectedCard(null);
              }}
              onCloseCard={() => setSelectedCard(null)}
              onSelectCard={(c) => setSelectedCard(c)}
              onUpdateComponent={handleUpdateComponent}
              onDeleteComponent={handleDeleteComponent}
              onUpdateConnection={handleUpdateConnection}
              onDeleteConnection={handleDeleteConnection}
              onAddConnection={handleAddConnection}
              onUpdateBoundary={handleUpdateBoundary}
              onDeleteBoundary={handleDeleteBoundary}
              onUpdateNote={handleUpdateNote}
              onDeleteNote={handleDeleteNote}
              onUpdateThreat={handleUpdateThreat}
              onDeleteThreat={handleDeleteThreat}
              onUpdateDecision={handleUpdateDecision}
              onDeleteDecision={handleDeleteDecision}
              onUpdateInvariant={handleUpdateInvariant}
              onDeleteInvariant={handleDeleteInvariant}
              onDraftAdrFromThreat={handleDraftAdrFromThreat}
              onAutoArrange={handleAutoArrange}
              onSelectComponent={(id) => {
                handleSelectComponent(id);
              }}
              onNavigateToCard={onNavigateToCard}
              onSendPrompt={onSendPrompt}
            />
          )}

          {/* Bottom Host Canvas Bar matching Screenshot 1 */}
          <HostCanvasBar
            onApplyTopologyEdit={handleApplyTopologyEdit}
            theme={currentTheme}
          />

          {/* Custom Right-Click Context Menu */}
          {contextMenu.visible && contextMenu.component && (
            <div
              className="lens-context-menu"
              style={{
                position: 'fixed',
                zIndex: 100,
                width: '230px',
                left: `${contextMenu.x}px`,
                top: `${contextMenu.y}px`,
                borderRadius: '12px',
                backgroundColor: isDark ? 'rgba(18, 24, 36, 0.98)' : 'rgba(255, 255, 255, 0.98)',
                border: `1px solid ${isDark ? '#28354d' : '#cbd5e1'}`,
                boxShadow: isDark ? '0 16px 40px rgba(0, 0, 0, 0.6)' : '0 14px 32px rgba(0, 0, 0, 0.16)',
                padding: '6px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                backdropFilter: 'blur(12px)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  padding: '4px 10px',
                  fontSize: '10px',
                  fontWeight: 800,
                  color: isDark ? '#64748b' : '#94a3b8',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  borderBottom: `1px solid ${isDark ? '#1e2638' : '#f1f5f9'}`,
                  marginBottom: '3px',
                }}
              >
                {contextMenu.component.name}
              </div>

              <button
                type="button"
                onClick={() => handleChatAboutComponent(contextMenu.component!)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: '#3b82f6',
                  fontSize: '12px',
                  fontWeight: 600,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span>💬 Chat with AI</span>
              </button>

              <button
                type="button"
                onClick={() => handleRecommendDependencies(contextMenu.component!)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 10px',
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
                <span>⚡ Recommend Dependencies</span>
              </button>

              <button
                type="button"
                onClick={() => handleGenerateThreats(contextMenu.component!)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 10px',
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
                <span>🛡️ Generate Threats & ADRs</span>
              </button>

              <button
                type="button"
                onClick={() => handleGenerateDecisions(contextMenu.component!)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 10px',
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
                <span>📐 Formulate Decision (ADR)</span>
              </button>

              <div style={{ width: '100%', height: '1px', backgroundColor: isDark ? '#1e2638' : '#f1f5f9', margin: '3px 0' }} />

              <button
                type="button"
                onClick={() => {
                  const compId = contextMenu.component!.id;
                  setContextMenu({ visible: false, x: 0, y: 0, component: null });
                  handleDeleteComponent(compId);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 10px',
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
                <span>🗑️ Delete Component</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Code Subview Mode */
        <div style={{ flex: 1, padding: '24px', overflow: 'auto', backgroundColor: '#0f172a', color: '#f8fafc', fontFamily: 'monospace', fontSize: '12px' }}>
          <pre>{JSON.stringify({
            title: state.title,
            components: state.components,
            boundaries: state.boundaries,
            connections: state.connections,
            threats: state.threats,
            decisions: state.decisions,
            invariants: state.invariants,
          }, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
