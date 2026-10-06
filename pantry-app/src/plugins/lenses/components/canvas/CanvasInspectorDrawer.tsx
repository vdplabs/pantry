import React, { useState, useEffect } from 'react';
import {
  FiShield, FiChevronRight, FiChevronLeft, FiChevronDown, FiShuffle,
  FiX, FiTrash2, FiPlus, FiArrowRight, FiArrowLeft, FiRepeat, FiCheck,
  FiRefreshCw, FiZap, FiBookmark, FiMonitor, FiServer, FiDatabase,
  FiLock, FiUser, FiLayers, FiCpu, FiGlobe, FiKey, FiHardDrive,
  FiTerminal, FiCode, FiShare2, FiCalendar, FiCheckCircle, FiBox,
  FiCloud, FiSettings, FiBarChart2, FiClock, FiFileText, FiRadio, FiGrid,
  FiExternalLink
} from 'react-icons/fi';
import type {
  LensState, LensComponent, LensBoundary, LensConnection, LensNote, NoteColor,
  ComponentType, ComponentCategory, LensThreat, LensDecision, LensInvariant,
  ThreatSeverity, ThreatLikelihood, ThreatStatus, DecisionStatus
} from '../../types';
import { getNoteColorStyles } from './CustomNoteNode';

interface Props {
  state: LensState;
  theme?: 'dark' | 'light';
  selectedComponentId?: string | null;
  selectedEdgeId?: string | null;
  selectedBoundaryId?: string | null;
  selectedNoteId?: string | null;
  selectedCard?: { id: string; category: 'threats' | 'decisions' | 'invariants' } | null;
  initialEditMode?: boolean;
  onCloseSelection: () => void;
  onCloseCard?: () => void;
  onSelectCard?: (card: { id: string; category: 'threats' | 'decisions' | 'invariants' }) => void;
  onUpdateComponent: (updated: LensComponent, boundaryIds?: string[]) => void;
  onDeleteComponent: (componentId: string) => void;
  onUpdateConnection: (updated: LensConnection) => void;
  onDeleteConnection: (connectionId: string) => void;
  onAddConnection: (from: string, to: string, label: string) => void;
  onUpdateBoundary: (updated: LensBoundary) => void;
  onDeleteBoundary: (boundaryId: string) => void;
  onUpdateNote?: (updated: LensNote) => void;
  onDeleteNote?: (noteId: string) => void;
  onUpdateThreat?: (updated: LensThreat) => void;
  onDeleteThreat?: (threatId: string) => void;
  onUpdateDecision?: (updated: LensDecision) => void;
  onDeleteDecision?: (decisionId: string) => void;
  onUpdateInvariant?: (updated: LensInvariant) => void;
  onDeleteInvariant?: (invariantId: string) => void;
  onDraftAdrFromThreat?: (threat: LensThreat) => void;
  onAutoArrange: () => void;
  onSelectComponent: (componentId: string) => void;
  onNavigateToCard: (cardId: string, category: 'threats' | 'decisions' | 'invariants') => void;
  onSendPrompt: (prompt: string) => void;
  bottomOffset?: number;
}

const ICON_PICKER = [
  { id: 'monitor', label: 'Monitor / Client', icon: FiMonitor },
  { id: 'server', label: 'Server / Backend', icon: FiServer },
  { id: 'database', label: 'Database / Store', icon: FiDatabase },
  { id: 'shield', label: 'Security / Firewall', icon: FiShield },
  { id: 'lock', label: 'KMS / Vault', icon: FiLock },
  { id: 'user', label: 'Actor / User', icon: FiUser },
  { id: 'layers', label: 'Layers / Service', icon: FiLayers },
  { id: 'cpu', label: 'Processor / Compute', icon: FiCpu },
  { id: 'zap', label: 'Cache / In-Memory', icon: FiZap },
  { id: 'globe', label: 'API / Network', icon: FiGlobe },
  { id: 'key', label: 'Key / Auth', icon: FiKey },
  { id: 'hard-drive', label: 'Persistent Disk', icon: FiHardDrive },
  { id: 'terminal', label: 'CLI / Shell', icon: FiTerminal },
  { id: 'code', label: 'Lambda / Function', icon: FiCode },
  { id: 'share', label: 'Queue / Event Broker', icon: FiShare2 },
  { id: 'box', label: 'Container / Microservice', icon: FiBox },
  { id: 'cloud', label: 'External Cloud', icon: FiCloud },
  { id: 'radio', label: 'IoT / Device', icon: FiRadio },
  { id: 'bar-chart', label: 'Metrics / Analytics', icon: FiBarChart2 },
  { id: 'clock', label: 'Scheduler / Cron', icon: FiClock },
  { id: 'file-text', label: 'Document / Log', icon: FiFileText },
  { id: 'settings', label: 'Configuration', icon: FiSettings },
];

export default function CanvasInspectorDrawer({
  state,
  theme = 'dark',
  selectedComponentId,
  selectedEdgeId,
  selectedBoundaryId,
  selectedNoteId,
  selectedCard,
  initialEditMode = false,
  onCloseSelection,
  onCloseCard,
  onSelectCard,
  onUpdateComponent,
  onDeleteComponent,
  onUpdateConnection,
  onDeleteConnection,
  onAddConnection,
  onUpdateBoundary,
  onDeleteBoundary,
  onUpdateNote,
  onDeleteNote,
  onUpdateThreat,
  onDeleteThreat,
  onUpdateDecision,
  onDeleteDecision,
  onUpdateInvariant,
  onDeleteInvariant,
  onDraftAdrFromThreat,
  onAutoArrange,
  onSelectComponent,
  onNavigateToCard,
  onSendPrompt,
  bottomOffset = 64,
}: Props) {
  const isDark = theme === 'dark';
  const [width, setWidth] = useState(380);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isEditingComponent, setIsEditingComponent] = useState(initialEditMode);

  // Form State for Component Editing
  const [compName, setCompName] = useState('');
  const [compSubtitle, setCompSubtitle] = useState('');
  const [compCategory, setCompCategory] = useState<ComponentCategory>('service_process');
  const [compType, setCompType] = useState<ComponentType>('service');
  const [compCardSize, setCompCardSize] = useState<'compact' | 'standard' | 'wide' | 'large'>('standard');
  const [compIcon, setCompIcon] = useState('server');
  const [compBoundaries, setCompBoundaries] = useState<string[]>([]);

  // Form State for New Connection quick add
  const [newConnTarget, setNewConnTarget] = useState('');
  const [newConnLabel, setNewConnLabel] = useState('calls');
  const [showAddConnForm, setShowAddConnForm] = useState(false);

  // Active selections
  const activeComponent = selectedComponentId
    ? state.components.find(c => c.id === selectedComponentId) || null
    : null;

  const activeEdge = selectedEdgeId
    ? state.connections.find(e => e.id === selectedEdgeId) || null
    : null;

  const activeBoundary = selectedBoundaryId
    ? state.boundaries.find(b => b.id === selectedBoundaryId) || null
    : null;

  const activeNote = selectedNoteId
    ? state.notes.find(n => n.id === selectedNoteId) || null
    : null;

  // Active Card Selections
  const activeThreat = selectedCard?.category === 'threats'
    ? state.threats.find(t => t.id === selectedCard.id) || null
    : null;

  const activeDecision = selectedCard?.category === 'decisions'
    ? state.decisions.find(d => d.id === selectedCard.id) || null
    : null;

  const activeInvariant = selectedCard?.category === 'invariants'
    ? state.invariants.find(i => i.id === selectedCard.id) || null
    : null;

  // Form state for Threat Editing (Matching Screenshot 1)
  const [threatTitle, setThreatTitle] = useState('');
  const [threatCategory, setThreatCategory] = useState('Elevation of Privilege');
  const [threatStatus, setThreatStatus] = useState<ThreatStatus>('Open');
  const [threatSeverity, setThreatSeverity] = useState<ThreatSeverity>('High');
  const [threatLikelihood, setThreatLikelihood] = useState<ThreatLikelihood>('High');
  const [threatActor, setThreatActor] = useState('');
  const [threatAttackVector, setThreatAttackVector] = useState('');
  const [threatTargetedAsset, setThreatTargetedAsset] = useState('');
  const [threatDescription, setThreatDescription] = useState('');
  const [threatMitigation, setThreatMitigation] = useState('');
  const [threatLinkedAdrId, setThreatLinkedAdrId] = useState('');
  const [threatEnforcingInvId, setThreatEnforcingInvId] = useState('');
  const [threatComponentId, setThreatComponentId] = useState('');
  const [threatUrl, setThreatUrl] = useState('');

  useEffect(() => {
    if (activeThreat) {
      setThreatTitle(activeThreat.title || '');
      setThreatCategory(activeThreat.category || 'Elevation of Privilege');
      setThreatStatus(activeThreat.status || 'Open');
      setThreatSeverity(activeThreat.severity || 'High');
      setThreatLikelihood(activeThreat.likelihood || 'High');
      setThreatActor(activeThreat.threatActor || '');
      setThreatAttackVector(activeThreat.attackVector || '');
      setThreatTargetedAsset(activeThreat.targetedAsset || '');
      setThreatDescription(activeThreat.description || '');
      setThreatMitigation(activeThreat.mitigation || '');
      setThreatLinkedAdrId(activeThreat.linkedAdrId || '');
      setThreatEnforcingInvId(activeThreat.enforcingInvariantId || '');
      setThreatComponentId(activeThreat.componentId || '');
      setThreatUrl(activeThreat.url || '');
    }
  }, [activeThreat]);

  // Form state for Decision (ADR) Editing
  const [decisionTitle, setDecisionTitle] = useState('');
  const [decisionStatus, setDecisionStatus] = useState<DecisionStatus>('Proposed');
  const [decisionApproach, setDecisionApproach] = useState('');
  const [decisionRationale, setDecisionRationale] = useState('');
  const [decisionAlternatives, setDecisionAlternatives] = useState('');
  const [decisionTradeoffs, setDecisionTradeoffs] = useState('');
  const [decisionComponentId, setDecisionComponentId] = useState('');
  const [decisionUrl, setDecisionUrl] = useState('');

  useEffect(() => {
    if (activeDecision) {
      setDecisionTitle(activeDecision.title || '');
      setDecisionStatus(activeDecision.status || 'Proposed');
      setDecisionApproach(activeDecision.approach || '');
      setDecisionRationale(activeDecision.rationale || '');
      setDecisionAlternatives(activeDecision.alternatives || '');
      setDecisionTradeoffs(activeDecision.tradeoffs || '');
      setDecisionComponentId(activeDecision.componentId || '');
      setDecisionUrl(activeDecision.url || '');
    }
  }, [activeDecision]);

  // Form state for Invariant Editing
  const [invariantTitle, setInvariantTitle] = useState('');
  const [invariantCategory, setInvariantCategory] = useState('Security Policy');
  const [invariantStatus, setInvariantStatus] = useState<'Enforced' | 'Planned'>('Enforced');
  const [invariantStatement, setInvariantStatement] = useState('');
  const [invariantComponentId, setInvariantComponentId] = useState('');
  const [invariantEnforcement, setInvariantEnforcement] = useState('');
  const [invariantUrl, setInvariantUrl] = useState('');

  useEffect(() => {
    if (activeInvariant) {
      setInvariantTitle(activeInvariant.title || '');
      setInvariantCategory(activeInvariant.category || 'Security Policy');
      setInvariantStatus(activeInvariant.status || 'Enforced');
      setInvariantStatement(activeInvariant.statement || '');
      setInvariantComponentId(activeInvariant.componentId || '');
      setInvariantEnforcement(activeInvariant.enforcementMechanism || '');
      setInvariantUrl(activeInvariant.url || '');
    }
  }, [activeInvariant]);

  // Sync component form state when selected component changes
  useEffect(() => {
    if (activeComponent) {
      setCompName(activeComponent.name || '');
      setCompSubtitle(activeComponent.subtitle || '');
      setCompCategory(activeComponent.category || 'service_process');
      setCompType(activeComponent.type || 'service');
      setCompCardSize(activeComponent.cardSize || 'standard');
      setCompIcon(activeComponent.icon || activeComponent.type || 'server');

      const boundIds = state.boundaries
        .filter(b => b.componentIds?.includes(activeComponent.id) || activeComponent.boundaryId === b.id)
        .map(b => b.id);
      setCompBoundaries(boundIds);
      if (initialEditMode) setIsEditingComponent(true);
    }
  }, [activeComponent, state.boundaries, initialEditMode]);

  // Handle drag resize
  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (moveEvt: MouseEvent) => {
      const deltaX = startX - moveEvt.clientX;
      const newWidth = Math.min(Math.max(startWidth + deltaX, 290), 550);
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const bg = isDark ? '#121824' : 'rgba(255, 255, 255, 0.98)';
  const border = isDark ? '#1e2638' : '#e2e8f0';
  const headerBg = isDark ? '#0f1420' : '#fafafa';
  const text = isDark ? '#f8fafc' : '#0f172a';
  const subtext = isDark ? '#94a3b8' : '#64748b';
  const cellBg = isDark ? '#161f30' : '#f8fafc';
  const cellBorder = isDark ? '#23324c' : '#e2e8f0';
  const inputBg = isDark ? '#182234' : '#ffffff';
  const inputBorder = isDark ? '#283852' : '#cbd5e1';

  // Save changes to active component
  const handleSaveComponent = () => {
    if (!activeComponent) return;

    let widthVal = 210;
    let heightVal = 85;
    if (compCardSize === 'compact') { widthVal = 175; heightVal = 75; }
    else if (compCardSize === 'wide') { widthVal = 250; heightVal = 85; }
    else if (compCardSize === 'large') { widthVal = 250; heightVal = 110; }

    const updated: LensComponent = {
      ...activeComponent,
      name: compName.trim() || activeComponent.name,
      subtitle: compSubtitle.trim(),
      category: compCategory,
      type: compType,
      cardSize: compCardSize,
      width: widthVal,
      height: heightVal,
      icon: compIcon,
      boundaryId: compBoundaries[0] || undefined,
    };

    onUpdateComponent(updated, compBoundaries);
    setIsEditingComponent(false);
  };

  // Save changes to active threat (Screenshot 1)
  const handleSaveThreat = () => {
    if (!activeThreat || !onUpdateThreat) return;
    const targetComp = state.components.find(c => c.id === threatComponentId);
    const updated: LensThreat = {
      ...activeThreat,
      title: threatTitle.trim() || activeThreat.title,
      category: threatCategory,
      status: threatStatus,
      severity: threatSeverity,
      likelihood: threatLikelihood,
      threatActor: threatActor.trim(),
      attackVector: threatAttackVector.trim(),
      targetedAsset: threatTargetedAsset.trim(),
      description: threatDescription.trim(),
      mitigation: threatMitigation.trim(),
      linkedAdrId: threatLinkedAdrId || undefined,
      enforcingInvariantId: threatEnforcingInvId || undefined,
      componentId: threatComponentId || undefined,
      componentName: targetComp?.name || activeThreat.componentName,
      url: threatUrl.trim() || undefined,
    };
    onUpdateThreat(updated);
  };

  // Save changes to active decision (ADR)
  const handleSaveDecision = () => {
    if (!activeDecision || !onUpdateDecision) return;
    const targetComp = state.components.find(c => c.id === decisionComponentId);
    const updated: LensDecision = {
      ...activeDecision,
      title: decisionTitle.trim() || activeDecision.title,
      status: decisionStatus,
      approach: decisionApproach.trim(),
      rationale: decisionRationale.trim(),
      alternatives: decisionAlternatives.trim(),
      tradeoffs: decisionTradeoffs.trim(),
      componentId: decisionComponentId || undefined,
      componentName: targetComp?.name || activeDecision.componentName,
      url: decisionUrl.trim() || undefined,
    };
    onUpdateDecision(updated);
  };

  // Save changes to active invariant
  const handleSaveInvariant = () => {
    if (!activeInvariant || !onUpdateInvariant) return;
    const targetComp = state.components.find(c => c.id === invariantComponentId);
    const updated: LensInvariant = {
      ...activeInvariant,
      title: invariantTitle.trim() || activeInvariant.title,
      category: invariantCategory,
      status: invariantStatus,
      statement: invariantStatement.trim(),
      enforcementMechanism: invariantEnforcement.trim() || undefined,
      componentId: invariantComponentId || undefined,
      componentName: targetComp?.name || activeInvariant.componentName,
      url: invariantUrl.trim() || undefined,
    };
    onUpdateInvariant(updated);
  };

  // Render Threat Inspector / Editor matching Screenshot 1
  const renderThreatEditor = (threat: LensThreat) => {
    const getImpactNum = (sev: ThreatSeverity) => {
      switch (sev) {
        case 'Critical': return 4;
        case 'High': return 3;
        case 'Medium': return 2;
        case 'Low': return 1;
        default: return 3;
      }
    };
    const getLikelihoodNum = (lik: ThreatLikelihood) => {
      switch (lik) {
        case 'High': return 3;
        case 'Medium': return 2;
        case 'Low': return 1;
        default: return 3;
      }
    };
    const initialScore = getImpactNum(threatSeverity) * getLikelihoodNum(threatLikelihood);
    const residualScore = threatStatus === 'Mitigated' ? Math.max(1, Math.round(initialScore / 2.5)) : initialScore;
    const initialLevel = initialScore >= 9 ? 'HIGH' : initialScore >= 4 ? 'MEDIUM' : 'LOW';
    const residualLevel = residualScore >= 9 ? 'HIGH' : residualScore >= 4 ? 'MEDIUM' : 'LOW';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
        {/* Header matching Screenshot 1 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: `1px solid ${border}`,
          backgroundColor: headerBg,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              backgroundColor: isDark ? 'rgba(239, 68, 68, 0.2)' : '#fee2e2',
              border: `1px solid ${isDark ? 'rgba(239, 68, 68, 0.4)' : '#fca5a5'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ef4444',
            }}>
              <FiShield size={17} />
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {threat.id}
              </div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: text }}>
                {threatTitle || threat.title}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={onCloseCard || onCloseSelection}
              title="Close Threat Details"
              style={{
                border: 'none',
                background: 'transparent',
                color: subtext,
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <FiX size={16} />
            </button>
            {onDeleteThreat && (
              <button
                type="button"
                onClick={() => onDeleteThreat(threat.id)}
                title="Delete Threat"
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#ef4444',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <FiTrash2 size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Content Body matching Screenshot 1 */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Row 1: STRIDE Category & Status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
                STRIDE Category:
              </label>
              <select
                value={threatCategory}
                onChange={(e) => setThreatCategory(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: `1px solid ${inputBorder}`,
                  backgroundColor: inputBg,
                  color: text,
                  fontSize: '12px',
                }}
              >
                <option value="Elevation of Privilege">Elevation of Privilege</option>
                <option value="Spoofing">Spoofing</option>
                <option value="Tampering">Tampering</option>
                <option value="Repudiation">Repudiation</option>
                <option value="Information Disclosure">Information Disclosure</option>
                <option value="Denial of Service">Denial of Service</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
                Status:
              </label>
              <select
                value={threatStatus}
                onChange={(e) => setThreatStatus(e.target.value as ThreatStatus)}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: `1px solid ${inputBorder}`,
                  backgroundColor: inputBg,
                  color: text,
                  fontSize: '12px',
                }}
              >
                <option value="Open">Open</option>
                <option value="Mitigated">Mitigated</option>
                <option value="Accepted">Accepted</option>
              </select>
            </div>
          </div>

          {/* Row 2: Impact & Likelihood */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
                Impact:
              </label>
              <select
                value={threatSeverity}
                onChange={(e) => setThreatSeverity(e.target.value as ThreatSeverity)}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: `1px solid ${inputBorder}`,
                  backgroundColor: inputBg,
                  color: text,
                  fontSize: '12px',
                }}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
                Likelihood:
              </label>
              <select
                value={threatLikelihood}
                onChange={(e) => setThreatLikelihood(e.target.value as ThreatLikelihood)}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: `1px solid ${inputBorder}`,
                  backgroundColor: inputBg,
                  color: text,
                  fontSize: '12px',
                }}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            </div>
          </div>

          {/* Row 3: Risk Badges matching Screenshot 1 */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 9px',
              borderRadius: '6px',
              backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : '#fef3c7',
              border: `1px solid ${isDark ? 'rgba(245, 158, 11, 0.3)' : '#fde68a'}`,
              color: isDark ? '#fbbf24' : '#b45309',
              fontSize: '10.5px',
              fontWeight: 700,
              letterSpacing: '0.02em',
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#f59e0b' }} />
              <span>INITIAL: {initialLevel} ({initialScore}/16)</span>
            </div>

            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 9px',
              borderRadius: '6px',
              backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : '#fef3c7',
              border: `1px solid ${isDark ? 'rgba(245, 158, 11, 0.3)' : '#fde68a'}`,
              color: isDark ? '#fbbf24' : '#b45309',
              fontSize: '10.5px',
              fontWeight: 700,
              letterSpacing: '0.02em',
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#f59e0b' }} />
              <span>RESIDUAL: {residualLevel} ({residualScore}/16)</span>
            </div>
          </div>

          {/* Row 4: Title */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Title:
            </label>
            <input
              type="text"
              value={threatTitle}
              onChange={(e) => setThreatTitle(e.target.value)}
              placeholder="e.g. Privileged access"
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: text,
                fontSize: '12px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Row 5: Threat Schema (Hypothetical) */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '10px',
            borderRadius: '8px',
            backgroundColor: cellBg,
            border: `1px solid ${cellBorder}`,
          }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: text }}>
              Threat Schema (Hypothetical):
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '10.5px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '3px' }}>
                  Attacker:
                </label>
                <input
                  type="text"
                  value={threatActor}
                  onChange={(e) => setThreatActor(e.target.value)}
                  placeholder="e.g. Untrusted Client"
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: '5px',
                    border: `1px solid ${inputBorder}`,
                    backgroundColor: inputBg,
                    color: text,
                    fontSize: '11px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '10.5px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '3px' }}>
                  Attack Vector:
                </label>
                <input
                  type="text"
                  value={threatAttackVector}
                  onChange={(e) => setThreatAttackVector(e.target.value)}
                  placeholder="e.g. Unauthenticated API"
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: '5px',
                    border: `1px solid ${inputBorder}`,
                    backgroundColor: inputBg,
                    color: text,
                    fontSize: '11px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
            <div>
              <label style={{ fontSize: '10.5px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '3px' }}>
                Targeted Asset:
              </label>
              <input
                type="text"
                value={threatTargetedAsset}
                onChange={(e) => setThreatTargetedAsset(e.target.value)}
                placeholder="e.g. Transaction data in PostgreSQL"
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: '5px',
                  border: `1px solid ${inputBorder}`,
                  backgroundColor: inputBg,
                  color: text,
                  fontSize: '11px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Row 6: Hypothetical Scenario Description */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Hypothetical Scenario Description:
            </label>
            <textarea
              rows={3}
              value={threatDescription}
              onChange={(e) => setThreatDescription(e.target.value)}
              placeholder="Describe the threat scenario..."
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: text,
                fontSize: '11.5px',
                lineHeight: 1.4,
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />
          </div>

          {/* Row 7: Mitigation & Decision Linkage */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '10px',
            borderRadius: '8px',
            backgroundColor: cellBg,
            border: `1px solid ${cellBorder}`,
          }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: text }}>
              Mitigation & Decision Linkage:
            </div>
            <div>
              <label style={{ fontSize: '10.5px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '3px' }}>
                Mitigation Controls:
              </label>
              <input
                type="text"
                value={threatMitigation}
                onChange={(e) => setThreatMitigation(e.target.value)}
                placeholder="Periodic PUM and user access review"
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: '5px',
                  border: `1px solid ${inputBorder}`,
                  backgroundColor: inputBg,
                  color: text,
                  fontSize: '11px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ fontSize: '10.5px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '3px' }}>
                  Mitigating ADR:
                </label>
                <select
                  value={threatLinkedAdrId}
                  onChange={(e) => setThreatLinkedAdrId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: '5px',
                    border: `1px solid ${inputBorder}`,
                    backgroundColor: inputBg,
                    color: text,
                    fontSize: '11px',
                  }}
                >
                  <option value="">(None linked)</option>
                  {state.decisions.map(d => (
                    <option key={d.id} value={d.id}>{d.id} - {d.title}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '10.5px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '3px' }}>
                  Enforcing Invariant:
                </label>
                <select
                  value={threatEnforcingInvId}
                  onChange={(e) => setThreatEnforcingInvId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: '5px',
                    border: `1px solid ${inputBorder}`,
                    backgroundColor: inputBg,
                    color: text,
                    fontSize: '11px',
                  }}
                >
                  <option value="">(None linked)</option>
                  {state.invariants.map(inv => (
                    <option key={inv.id} value={inv.id}>{inv.id} - {inv.title}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* + Draft ADR from this threat button matching Screenshot 1 */}
            <button
              type="button"
              onClick={() => onDraftAdrFromThreat?.(threat)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '7px 10px',
                borderRadius: '6px',
                border: '1px dashed #3b82f6',
                backgroundColor: isDark ? 'rgba(59, 130, 246, 0.1)' : '#eff6ff',
                color: '#3b82f6',
                fontSize: '11.5px',
                fontWeight: 600,
                cursor: 'pointer',
                marginTop: '4px',
              }}
            >
              <FiPlus size={13} />
              <span>Draft ADR from this threat</span>
            </button>
          </div>

          {/* Row 8: Target Component */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Target Component:
            </label>
            <select
              value={threatComponentId}
              onChange={(e) => setThreatComponentId(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: text,
                fontSize: '12px',
              }}
            >
              <option value="">(None)</option>
              {state.components.map(c => (
                <option key={c.id} value={c.id}>◎ {c.name}</option>
              ))}
            </select>
          </div>

          {/* Reference URL / Link field */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Reference URL / External Link:
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="url"
                value={threatUrl}
                onChange={(e) => setThreatUrl(e.target.value)}
                placeholder="https://..."
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: `1px solid ${inputBorder}`,
                  backgroundColor: inputBg,
                  color: text,
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
              {threatUrl && (
                <a
                  href={threatUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open reference in new tab"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#fee2e2',
                    border: `1px solid ${isDark ? 'rgba(239, 68, 68, 0.35)' : '#fca5a5'}`,
                    color: '#ef4444',
                    textDecoration: 'none',
                    flexShrink: 0,
                  }}
                >
                  <FiExternalLink size={14} />
                </a>
              )}
            </div>
          </div>

          {/* Bottom Red Save Button matching Screenshot 1 */}
          <button
            type="button"
            onClick={handleSaveThreat}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#ef4444',
              color: '#ffffff',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: 'pointer',
              marginTop: '4px',
              boxShadow: '0 4px 12px rgba(239, 68, 68, 0.35)',
            }}
          >
            <FiCheck size={15} />
            <span>Save Threat Changes</span>
          </button>
        </div>
      </div>
    );
  };

  // Render Decision (ADR) Inspector / Editor
  const renderDecisionEditor = (decision: LensDecision) => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: `1px solid ${border}`,
          backgroundColor: headerBg,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              backgroundColor: isDark ? 'rgba(245, 158, 11, 0.2)' : '#fef3c7',
              border: `1px solid ${isDark ? 'rgba(245, 158, 11, 0.4)' : '#fde68a'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#f59e0b',
            }}>
              <FiBookmark size={17} />
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {decision.id}
              </div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: text }}>
                {decisionTitle || decision.title}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={onCloseCard || onCloseSelection}
              title="Close Decision Details"
              style={{ border: 'none', background: 'transparent', color: subtext, cursor: 'pointer', padding: '4px' }}
            >
              <FiX size={16} />
            </button>
            {onDeleteDecision && (
              <button
                type="button"
                onClick={() => onDeleteDecision(decision.id)}
                title="Delete Decision"
                style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
              >
                <FiTrash2 size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Status:
            </label>
            <select
              value={decisionStatus}
              onChange={(e) => setDecisionStatus(e.target.value as DecisionStatus)}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: text,
                fontSize: '12px',
              }}
            >
              <option value="Proposed">Proposed</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
              <option value="Superseded">Superseded</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Title:
            </label>
            <input
              type="text"
              value={decisionTitle}
              onChange={(e) => setDecisionTitle(e.target.value)}
              placeholder="e.g. Grpc Vs Rest Communication Strategy"
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: text,
                fontSize: '12px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Approach / Context:
            </label>
            <textarea
              rows={3}
              value={decisionApproach}
              onChange={(e) => setDecisionApproach(e.target.value)}
              placeholder="State the decision and architectural approach taken..."
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: text,
                fontSize: '11.5px',
                lineHeight: 1.4,
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Rationale:
            </label>
            <textarea
              rows={3}
              value={decisionRationale}
              onChange={(e) => setDecisionRationale(e.target.value)}
              placeholder="Explain why this option was chosen..."
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: text,
                fontSize: '11.5px',
                lineHeight: 1.4,
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Alternatives & Trade-offs:
            </label>
            <textarea
              rows={2}
              value={decisionAlternatives}
              onChange={(e) => setDecisionAlternatives(e.target.value)}
              placeholder="Mention considered alternatives..."
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: text,
                fontSize: '11.5px',
                lineHeight: 1.4,
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Target Component:
            </label>
            <select
              value={decisionComponentId}
              onChange={(e) => setDecisionComponentId(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: text,
                fontSize: '12px',
              }}
            >
              <option value="">(None)</option>
              {state.components.map(c => (
                <option key={c.id} value={c.id}>◎ {c.name}</option>
              ))}
            </select>
          </div>

          {/* Reference URL / Link field */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Reference URL / Design Doc Link:
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="url"
                value={decisionUrl}
                onChange={(e) => setDecisionUrl(e.target.value)}
                placeholder="https://..."
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: `1px solid ${inputBorder}`,
                  backgroundColor: inputBg,
                  color: text,
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
              {decisionUrl && (
                <a
                  href={decisionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open design doc link in new tab"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : '#fef3c7',
                    border: `1px solid ${isDark ? 'rgba(245, 158, 11, 0.35)' : '#fde68a'}`,
                    color: '#f59e0b',
                    textDecoration: 'none',
                    flexShrink: 0,
                  }}
                >
                  <FiExternalLink size={14} />
                </a>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handleSaveDecision}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#f59e0b',
              color: '#ffffff',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: 'pointer',
              marginTop: '4px',
              boxShadow: '0 4px 12px rgba(245, 158, 11, 0.35)',
            }}
          >
            <FiCheck size={15} />
            <span>Save ADR Changes</span>
          </button>
        </div>
      </div>
    );
  };

  // Render Invariant Inspector / Editor
  const renderInvariantEditor = (invariant: LensInvariant) => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: `1px solid ${border}`,
          backgroundColor: headerBg,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              backgroundColor: isDark ? 'rgba(168, 85, 247, 0.2)' : '#f3e8ff',
              border: `1px solid ${isDark ? 'rgba(168, 85, 247, 0.4)' : '#e9d5ff'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#a855f7',
            }}>
              <FiCheckCircle size={17} />
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#a855f7', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {invariant.id}
              </div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: text }}>
                {invariantTitle || invariant.title}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={onCloseCard || onCloseSelection}
              title="Close Invariant Details"
              style={{ border: 'none', background: 'transparent', color: subtext, cursor: 'pointer', padding: '4px' }}
            >
              <FiX size={16} />
            </button>
            {onDeleteInvariant && (
              <button
                type="button"
                onClick={() => onDeleteInvariant(invariant.id)}
                title="Delete Invariant"
                style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
              >
                <FiTrash2 size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
                Category:
              </label>
              <input
                type="text"
                value={invariantCategory}
                onChange={(e) => setInvariantCategory(e.target.value)}
                placeholder="e.g. Security Policy"
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: `1px solid ${inputBorder}`,
                  backgroundColor: inputBg,
                  color: text,
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
                Status:
              </label>
              <select
                value={invariantStatus}
                onChange={(e) => setInvariantStatus(e.target.value as any)}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: `1px solid ${inputBorder}`,
                  backgroundColor: inputBg,
                  color: text,
                  fontSize: '12px',
                }}
              >
                <option value="Enforced">Enforced</option>
                <option value="Planned">Planned</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Title:
            </label>
            <input
              type="text"
              value={invariantTitle}
              onChange={(e) => setInvariantTitle(e.target.value)}
              placeholder="e.g. State Durability & Write-Ahead Log Integrity"
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: text,
                fontSize: '12px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Formal Statement / Guarantee:
            </label>
            <textarea
              rows={3}
              value={invariantStatement}
              onChange={(e) => setInvariantStatement(e.target.value)}
              placeholder="Every state write must be persisted and replicated before acknowledgment."
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: text,
                fontSize: '11.5px',
                lineHeight: 1.4,
                boxSizing: 'border-box',
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Target Component:
            </label>
            <select
              value={invariantComponentId}
              onChange={(e) => setInvariantComponentId(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: text,
                fontSize: '12px',
              }}
            >
              <option value="">(None)</option>
              {state.components.map(c => (
                <option key={c.id} value={c.id}>◎ {c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Enforcement Mechanism:
            </label>
            <input
              type="text"
              value={invariantEnforcement}
              onChange={(e) => setInvariantEnforcement(e.target.value)}
              placeholder="e.g. Cache Eviction Policies Misconfiguration"
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: text,
                fontSize: '12px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Reference URL / Specification Link:
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="url"
                value={invariantUrl}
                onChange={(e) => setInvariantUrl(e.target.value)}
                placeholder="https://..."
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: `1px solid ${inputBorder}`,
                  backgroundColor: inputBg,
                  color: text,
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
              {invariantUrl && (
                <a
                  href={invariantUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open specification in new tab"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    backgroundColor: isDark ? 'rgba(168, 85, 247, 0.15)' : '#f3e8ff',
                    border: `1px solid ${isDark ? 'rgba(168, 85, 247, 0.35)' : '#e9d5ff'}`,
                    color: '#a855f7',
                    textDecoration: 'none',
                    flexShrink: 0,
                  }}
                >
                  <FiExternalLink size={14} />
                </a>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handleSaveInvariant}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#a855f7',
              color: '#ffffff',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: 'pointer',
              marginTop: '4px',
              boxShadow: '0 4px 12px rgba(168, 85, 247, 0.35)',
            }}
          >
            <FiCheck size={15} />
            <span>Save Invariant Changes</span>
          </button>
        </div>
      </div>
    );
  };

  // Render Component Inspector (Screenshots 3 & 4)
  const renderComponentView = (comp: LensComponent) => {
    const attachedThreats = state.threats.filter(t => t.componentId === comp.id || (t.componentName && t.componentName.toLowerCase() === comp.name.toLowerCase()));
    const attachedDecisions = state.decisions.filter(d => d.componentId === comp.id || (d.componentName && d.componentName.toLowerCase() === comp.name.toLowerCase()));
    const attachedInvariants = state.invariants.filter(i => i.componentId === comp.id || (i.componentName && i.componentName.toLowerCase() === comp.name.toLowerCase()));

    const outgoing = state.connections.filter(c => c.from === comp.id);
    const incoming = state.connections.filter(c => c.to === comp.id);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
        {/* Header matching Screenshot 3 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: `1px solid ${border}`,
          backgroundColor: headerBg,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              backgroundColor: isDark ? '#1e293b' : '#eff6ff',
              border: `1px solid ${isDark ? '#334155' : '#bfdbfe'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#3b82f6',
            }}>
              <FiMonitor size={17} />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: text }}>
                {comp.name}
              </div>
              <div style={{ fontSize: '11px', color: '#3b82f6', fontWeight: 600 }}>
                {comp.subtitle || comp.type}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={onCloseSelection}
              title="Close Inspector"
              style={{
                border: 'none',
                background: 'transparent',
                color: subtext,
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '4px',
              }}
            >
              <FiX size={16} />
            </button>
            <button
              type="button"
              onClick={() => onDeleteComponent(comp.id)}
              title="Delete Component"
              style={{
                border: 'none',
                background: 'transparent',
                color: '#ef4444',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '4px',
              }}
            >
              <FiTrash2 size={16} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Accordion: > Edit component (Screenshot 3 & 4) */}
          <div style={{
            borderRadius: '10px',
            border: `1px solid ${cellBorder}`,
            backgroundColor: cellBg,
            overflow: 'hidden',
          }}>
            <button
              type="button"
              onClick={() => setIsEditingComponent(!isEditingComponent)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                border: 'none',
                background: 'transparent',
                color: text,
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {isEditingComponent ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
                <span>Edit component</span>
              </span>
            </button>

            {/* Expanded Edit Form matching Screenshot 4 */}
            {isEditingComponent && (
              <div style={{ padding: '12px', borderTop: `1px solid ${cellBorder}`, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
                    Name:
                  </label>
                  <input
                    type="text"
                    value={compName}
                    onChange={(e) => setCompName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: '6px',
                      border: `1px solid ${inputBorder}`,
                      backgroundColor: inputBg,
                      color: text,
                      fontSize: '12px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
                    Subtitle / Tech Stack (Optional):
                  </label>
                  <input
                    type="text"
                    value={compSubtitle}
                    onChange={(e) => setCompSubtitle(e.target.value)}
                    placeholder="e.g. Go / gRPC / Port 8080"
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: '6px',
                      border: `1px solid ${inputBorder}`,
                      backgroundColor: inputBg,
                      color: text,
                      fontSize: '12px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Trust Boundaries Checkboxes */}
                {state.boundaries.length > 0 && (
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '6px' }}>
                      Trust boundaries:
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {state.boundaries.map(b => (
                        <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11.5px', color: text, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={compBoundaries.includes(b.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setCompBoundaries([...compBoundaries, b.id]);
                              } else {
                                setCompBoundaries(compBoundaries.filter(id => id !== b.id));
                              }
                            }}
                          />
                          <span>{b.title}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Card Size Preset */}
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '6px' }}>
                    Card Size Preset:
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                    {(['compact', 'standard', 'wide', 'large'] as const).map(sz => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => setCompCardSize(sz)}
                        style={{
                          padding: '5px 0',
                          borderRadius: '6px',
                          border: `1px solid ${compCardSize === sz ? '#3b82f6' : cellBorder}`,
                          backgroundColor: compCardSize === sz ? '#2563eb' : inputBg,
                          color: compCardSize === sz ? '#ffffff' : subtext,
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          textTransform: 'capitalize',
                        }}
                      >
                        {sz}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Category Pills matching Screenshot 4 */}
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '6px' }}>
                    Category:
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {[
                      { id: 'service_process', label: 'Service / Process' },
                      { id: 'database_store', label: 'Database / Store' },
                      { id: 'in_memory_cache', label: 'In-Memory Cache' },
                      { id: 'message_queue', label: 'Message Queue' },
                      { id: 'api_gateway', label: 'API Gateway / Guardrail' },
                      { id: 'client_ui', label: 'Client / UI' },
                      { id: 'critical_asset', label: 'Critical Asset' },
                      { id: 'external_network', label: 'External System' },
                    ].map(cat => {
                      const isActive = compCategory === (cat.id as any);
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setCompCategory(cat.id as any)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: `1px solid ${isActive ? '#3b82f6' : cellBorder}`,
                            backgroundColor: isActive ? (isDark ? '#1e293b' : '#eff6ff') : inputBg,
                            color: isActive ? '#3b82f6' : subtext,
                            fontSize: '10.5px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {cat.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Icon Grid Picker */}
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '6px' }}>
                    Icon:
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', maxHeight: '110px', overflowY: 'auto' }}>
                    {ICON_PICKER.map(item => {
                      const IconCmp = item.icon;
                      const isSelected = compIcon === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setCompIcon(item.id)}
                          title={item.label}
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '6px',
                            border: `1px solid ${isSelected ? '#3b82f6' : cellBorder}`,
                            backgroundColor: isSelected ? '#2563eb' : inputBg,
                            color: isSelected ? '#ffffff' : subtext,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                          }}
                        >
                          <IconCmp size={14} />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Save Changes Button */}
                <button
                  type="button"
                  onClick={handleSaveComponent}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '7px',
                    backgroundColor: '#2563eb',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    marginTop: '4px',
                  }}
                >
                  <FiCheck size={14} />
                  <span>Save Changes</span>
                </button>
              </div>
            )}
          </div>

          {/* Section: "On this component" matching Screenshot 3 */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: subtext, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
              On this component
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {attachedDecisions.map(d => (
                <div
                  key={d.id}
                  onClick={() => onSelectCard ? onSelectCard({ id: d.id, category: 'decisions' }) : onNavigateToCard(d.id, 'decisions')}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    backgroundColor: isDark ? 'rgba(245, 158, 11, 0.08)' : '#fffbeb',
                    border: `1px solid ${isDark ? 'rgba(245, 158, 11, 0.25)' : '#fde68a'}`,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: '10px', fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase' }}>
                    DECISION {d.id}
                  </div>
                  <div style={{ fontSize: '11.5px', fontWeight: 600, color: text, marginTop: '2px' }}>
                    {d.title}
                  </div>
                </div>
              ))}

              {attachedThreats.map(t => (
                <div
                  key={t.id}
                  onClick={() => onSelectCard ? onSelectCard({ id: t.id, category: 'threats' }) : onNavigateToCard(t.id, 'threats')}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    backgroundColor: isDark ? 'rgba(239, 68, 68, 0.08)' : '#fef2f2',
                    border: `1px solid ${isDark ? 'rgba(239, 68, 68, 0.25)' : '#fecaca'}`,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: '10px', fontWeight: 800, color: '#ef4444', textTransform: 'uppercase' }}>
                    THREAT {t.id} • {t.severity}
                  </div>
                  <div style={{ fontSize: '11.5px', fontWeight: 600, color: text, marginTop: '2px' }}>
                    {t.title}
                  </div>
                </div>
              ))}

              {attachedInvariants.map(inv => (
                <div
                  key={inv.id}
                  onClick={() => onSelectCard ? onSelectCard({ id: inv.id, category: 'invariants' }) : onNavigateToCard(inv.id, 'invariants')}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    backgroundColor: isDark ? 'rgba(168, 85, 247, 0.08)' : '#faf5ff',
                    border: `1px solid ${isDark ? 'rgba(168, 85, 247, 0.25)' : '#f3e8ff'}`,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: '10px', fontWeight: 800, color: '#a855f7', textTransform: 'uppercase' }}>
                    INVARIANT {inv.id}
                  </div>
                  <div style={{ fontSize: '11.5px', fontWeight: 600, color: text, marginTop: '2px' }}>
                    {inv.title}
                  </div>
                </div>
              ))}

              {attachedDecisions.length === 0 && attachedThreats.length === 0 && attachedInvariants.length === 0 && (
                <div style={{ fontSize: '11.5px', color: subtext, padding: '8px', fontStyle: 'italic' }}>
                  No threats, decisions, or invariants attached to this component yet.
                </div>
              )}
            </div>
          </div>

          {/* Section: "Relationships" matching Screenshot 3 */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: subtext, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
              Relationships
            </div>

            {/* Outgoing Connections */}
            <div style={{ fontSize: '11px', fontWeight: 600, color: subtext, marginBottom: '6px' }}>
              Outgoing ({outgoing.length}):
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {outgoing.map(conn => {
                const targetComp = state.components.find(c => c.id === conn.to);
                const targetBound = state.boundaries.find(b => b.id === conn.to);
                const targetName = targetComp ? targetComp.name : targetBound ? targetBound.title : conn.to;
                return (
                  <div
                    key={conn.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '7px 10px',
                      borderRadius: '8px',
                      backgroundColor: cellBg,
                      border: `1px solid ${cellBorder}`,
                      fontSize: '11.5px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
                      <FiArrowRight size={13} style={{ color: '#3b82f6', flexShrink: 0 }} />
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: 600, color: text }}>{targetName}</span>
                        <span style={{ color: subtext, marginLeft: '6px', fontSize: '10.5px' }}>({conn.label || 'calls'})</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      {/* Direction toggle */}
                      <select
                        value={conn.direction || (conn.bidirectional ? 'bidirectional' : 'forward')}
                        onChange={(e) => onUpdateConnection({ ...conn, direction: e.target.value as any, bidirectional: e.target.value === 'bidirectional' })}
                        style={{
                          fontSize: '10.5px',
                          padding: '2px 4px',
                          borderRadius: '4px',
                          border: `1px solid ${inputBorder}`,
                          backgroundColor: inputBg,
                          color: text,
                        }}
                      >
                        <option value="forward">One way</option>
                        <option value="bidirectional">Bidirectional</option>
                        <option value="reverse">Reverse</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => onDeleteConnection(conn.id)}
                        title="Delete Relationship"
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: subtext,
                          cursor: 'pointer',
                          padding: '2px',
                        }}
                      >
                        <FiX size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* + Connect to another component button */}
            {!showAddConnForm ? (
              <button
                type="button"
                onClick={() => setShowAddConnForm(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  width: '100%',
                  padding: '7px 10px',
                  marginTop: '8px',
                  borderRadius: '7px',
                  border: `1px dashed ${cellBorder}`,
                  backgroundColor: 'transparent',
                  color: '#3b82f6',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <FiPlus size={13} />
                <span>Connect to another component...</span>
              </button>
            ) : (
              <div style={{
                marginTop: '8px',
                padding: '10px',
                borderRadius: '8px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: cellBg,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: text }}>
                  Add Connection from {comp.name}
                </div>
                <select
                  value={newConnTarget}
                  onChange={(e) => setNewConnTarget(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px',
                    borderRadius: '6px',
                    border: `1px solid ${inputBorder}`,
                    backgroundColor: inputBg,
                    color: text,
                    fontSize: '11.5px',
                  }}
                >
                  <option value="">Select Target Component...</option>
                  {state.components.filter(c => c.id !== comp.id).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>

                <input
                  type="text"
                  placeholder="Connection Label (e.g. 'calls', 'mTLS', 'exploits')"
                  value={newConnLabel}
                  onChange={(e) => setNewConnLabel(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px',
                    borderRadius: '6px',
                    border: `1px solid ${inputBorder}`,
                    backgroundColor: inputBg,
                    color: text,
                    fontSize: '11.5px',
                    boxSizing: 'border-box',
                  }}
                />

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    disabled={!newConnTarget}
                    onClick={() => {
                      if (!newConnTarget) return;
                      onAddConnection(comp.id, newConnTarget, newConnLabel.trim() || 'calls');
                      setNewConnTarget('');
                      setShowAddConnForm(false);
                    }}
                    style={{
                      flex: 1,
                      padding: '6px',
                      borderRadius: '6px',
                      backgroundColor: '#2563eb',
                      border: 'none',
                      color: '#ffffff',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      cursor: newConnTarget ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Connect
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddConnForm(false)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '6px',
                      backgroundColor: 'transparent',
                      border: `1px solid ${cellBorder}`,
                      color: subtext,
                      fontSize: '11.5px',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Section: "Targeted AI Actions" matching Screenshot 3 */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: subtext, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
              Targeted AI Actions:
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => onSendPrompt(`Conduct a STRIDE threat modeling analysis on [${comp.name}]. Identify high-priority attack vectors and return actionable mitigations in a \`\`\`lens_patch block.`)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  backgroundColor: isDark ? 'rgba(239, 68, 68, 0.12)' : '#fef2f2',
                  border: `1px solid ${isDark ? 'rgba(239, 68, 68, 0.3)' : '#fecaca'}`,
                  color: '#ef4444',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <span>🛡️ STRIDE Threats</span>
              </button>
              <button
                type="button"
                onClick={() => onSendPrompt(`Formulate an Architecture Decision Record (ADR) for component [${comp.name}] defining its trade-offs and tech choice. Return it in a \`\`\`lens_patch block.`)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  backgroundColor: isDark ? 'rgba(59, 130, 246, 0.12)' : '#eff6ff',
                  border: `1px solid ${isDark ? 'rgba(59, 130, 246, 0.3)' : '#bfdbfe'}`,
                  color: '#3b82f6',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <span>📐 ADR Record</span>
              </button>
              <button
                type="button"
                onClick={() => onSendPrompt(`Define formal runtime safety and data integrity invariants for component [${comp.name}]. Return them in a \`\`\`lens_patch block.`)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  backgroundColor: isDark ? 'rgba(16, 185, 129, 0.12)' : '#ecfdf5',
                  border: `1px solid ${isDark ? 'rgba(16, 185, 129, 0.3)' : '#a7f3d0'}`,
                  color: '#10b981',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <span>⚖️ Invariants</span>
              </button>
            </div>
          </div>

          {/* Section: "Suggested Dependencies" matching Screenshot 3 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: subtext, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Suggested Dependencies:
              </div>
              <button
                type="button"
                onClick={() => onSendPrompt(`Recommend what architecture dependencies or caches component [${comp.name}] needs. Return a \`\`\`lens_patch block.`)}
                title="Refresh Suggestions"
                style={{ border: 'none', background: 'transparent', color: subtext, cursor: 'pointer', padding: '2px' }}
              >
                <FiRefreshCw size={11} />
              </button>
            </div>
            <div style={{ fontSize: '11.5px', color: subtext, fontStyle: 'italic' }}>
              Nothing missing stands out from this drawing.
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render Connector / Relationship Inspector
  const renderEdgeView = (edge: LensConnection) => {
    const fromComp = state.components.find(c => c.id === edge.from);
    const toComp = state.components.find(c => c.id === edge.to);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: `1px solid ${border}`,
          backgroundColor: headerBg,
        }}>
          <div>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: text }}>
              Connection Details
            </div>
            <div style={{ fontSize: '11px', color: subtext, marginTop: '2px' }}>
              {fromComp?.name || edge.from} → {toComp?.name || edge.to}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={onCloseSelection}
              title="Close"
              style={{ border: 'none', background: 'transparent', color: subtext, cursor: 'pointer', padding: '4px' }}
            >
              <FiX size={16} />
            </button>
            <button
              type="button"
              onClick={() => onDeleteConnection(edge.id)}
              title="Delete Connection"
              style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
            >
              <FiTrash2 size={16} />
            </button>
          </div>
        </div>

        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Label / Text:
            </label>
            <input
              type="text"
              value={edge.label || ''}
              onChange={(e) => onUpdateConnection({ ...edge, label: e.target.value })}
              placeholder="e.g. 'calls', 'authorizes', 'exploits'"
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: text,
                fontSize: '12px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '6px' }}>
              Routing / Path Shape:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
              {[
                { id: 'straight', label: '— Straight' },
                { id: 'angled', label: '⌐ Angled' },
                { id: 'curved', label: '∿ Curved' },
              ].map(rt => {
                const isSelected = (edge.routing || 'straight') === rt.id;
                return (
                  <button
                    key={rt.id}
                    type="button"
                    onClick={() => onUpdateConnection({ ...edge, routing: rt.id as any })}
                    style={{
                      padding: '6px 0',
                      borderRadius: '6px',
                      border: `1px solid ${isSelected ? '#3b82f6' : cellBorder}`,
                      backgroundColor: isSelected ? '#2563eb' : inputBg,
                      color: isSelected ? '#ffffff' : subtext,
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {rt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {(edge.routing || 'straight') === 'angled' && (
            <div style={{
              padding: '10px 12px',
              borderRadius: '8px',
              backgroundColor: cellBg,
              border: `1px solid ${cellBorder}`,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: text }}>
                Angled Line Controls
              </div>
              <div style={{ fontSize: '10.5px', color: subtext, lineHeight: 1.4 }}>
                Drag the <span style={{ color: '#3b82f6', fontWeight: 700 }}>↔</span> or <span style={{ color: '#3b82f6', fontWeight: 700 }}>↕</span> handles directly on the canvas connector wire to route around components.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => onUpdateConnection({
                    ...edge,
                    controlX: (edge.controlX ?? 0) - 25,
                  })}
                  style={{
                    padding: '5px 8px',
                    borderRadius: '6px',
                    border: `1px solid ${border}`,
                    backgroundColor: inputBg,
                    color: text,
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ← Move Left
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateConnection({
                    ...edge,
                    controlX: (edge.controlX ?? 0) + 25,
                  })}
                  style={{
                    padding: '5px 8px',
                    borderRadius: '6px',
                    border: `1px solid ${border}`,
                    backgroundColor: inputBg,
                    color: text,
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Move Right →
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateConnection({
                    ...edge,
                    controlY: (edge.controlY ?? 0) - 25,
                  })}
                  style={{
                    padding: '5px 8px',
                    borderRadius: '6px',
                    border: `1px solid ${border}`,
                    backgroundColor: inputBg,
                    color: text,
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ↑ Move Up
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateConnection({
                    ...edge,
                    controlY: (edge.controlY ?? 0) + 25,
                  })}
                  style={{
                    padding: '5px 8px',
                    borderRadius: '6px',
                    border: `1px solid ${border}`,
                    backgroundColor: inputBg,
                    color: text,
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Move Down ↓
                </button>
              </div>
              {(edge.controlX !== undefined || edge.controlY !== undefined) && (
                <button
                  type="button"
                  onClick={() => onUpdateConnection({
                    ...edge,
                    controlX: undefined,
                    controlY: undefined,
                  })}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    color: '#ef4444',
                    fontSize: '10.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'center',
                    textDecoration: 'underline',
                  }}
                >
                  Reset to Auto Routing
                </button>
              )}
            </div>
          )}

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '6px' }}>
              Line Style:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
              {(['solid', 'dashed', 'dotted'] as const).map(st => (
                <button
                  key={st}
                  type="button"
                  onClick={() => onUpdateConnection({ ...edge, style: st })}
                  style={{
                    padding: '6px 0',
                    borderRadius: '6px',
                    border: `1px solid ${edge.style === st ? '#3b82f6' : cellBorder}`,
                    backgroundColor: edge.style === st ? '#2563eb' : inputBg,
                    color: edge.style === st ? '#ffffff' : subtext,
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '6px' }}>
              Arrow Direction:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
              {[
                { id: 'forward', label: '→ One way' },
                { id: 'bidirectional', label: '⇄ Both ways' },
                { id: 'reverse', label: '← Reverse' },
              ].map(dir => (
                <button
                  key={dir.id}
                  type="button"
                  onClick={() => onUpdateConnection({ ...edge, direction: dir.id as any, bidirectional: dir.id === 'bidirectional' })}
                  style={{
                    padding: '6px 0',
                    borderRadius: '6px',
                    border: `1px solid ${(edge.direction || (edge.bidirectional ? 'bidirectional' : 'forward')) === dir.id ? '#3b82f6' : cellBorder}`,
                    backgroundColor: (edge.direction || (edge.bidirectional ? 'bidirectional' : 'forward')) === dir.id ? '#2563eb' : inputBg,
                    color: (edge.direction || (edge.bidirectional ? 'bidirectional' : 'forward')) === dir.id ? '#ffffff' : subtext,
                    fontSize: '10.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {dir.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '6px' }}>
              Color:
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[
                { id: '#3b82f6', label: 'Blue' },
                { id: '#ef4444', label: 'Red' },
                { id: '#f59e0b', label: 'Amber' },
                { id: '#a855f7', label: 'Purple' },
                { id: '#10b981', label: 'Green' },
                { id: '#94a3b8', label: 'Gray' },
              ].map(col => (
                <button
                  key={col.id}
                  type="button"
                  onClick={() => onUpdateConnection({ ...edge, color: col.id })}
                  title={col.label}
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '50%',
                    backgroundColor: col.id,
                    border: edge.color === col.id ? '3px solid #ffffff' : '2px solid transparent',
                    cursor: 'pointer',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render Boundary Inspector
  const renderBoundaryView = (bound: LensBoundary) => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: `1px solid ${border}`,
          backgroundColor: headerBg,
        }}>
          <div>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: text }}>
              Boundary Properties
            </div>
            <div style={{ fontSize: '11px', color: subtext, marginTop: '2px' }}>
              {bound.title}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={onCloseSelection}
              title="Close"
              style={{ border: 'none', background: 'transparent', color: subtext, cursor: 'pointer', padding: '4px' }}
            >
              <FiX size={16} />
            </button>
            <button
              type="button"
              onClick={() => onDeleteBoundary(bound.id)}
              title="Delete Boundary"
              style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
            >
              <FiTrash2 size={16} />
            </button>
          </div>
        </div>

        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Boundary Title:
            </label>
            <input
              type="text"
              value={bound.title}
              onChange={(e) => onUpdateBoundary({ ...bound, title: e.target.value.toUpperCase() })}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: text,
                fontSize: '12px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '4px' }}>
              Subtitle / Perimeter Type:
            </label>
            <input
              type="text"
              value={bound.subtitle || ''}
              onChange={(e) => onUpdateBoundary({ ...bound, subtitle: e.target.value })}
              placeholder="e.g. '• Network Perimeter', '• mTLS Zero Trust'"
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                border: `1px solid ${inputBorder}`,
                backgroundColor: inputBg,
                color: text,
                fontSize: '12px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: subtext, display: 'block', marginBottom: '6px' }}>
              Perimeter Color:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
              {(['orange', 'blue', 'purple', 'green'] as const).map(col => (
                <button
                  key={col}
                  type="button"
                  onClick={() => onUpdateBoundary({ ...bound, color: col })}
                  style={{
                    padding: '6px 0',
                    borderRadius: '6px',
                    border: `1px solid ${bound.color === col ? '#3b82f6' : cellBorder}`,
                    backgroundColor: bound.color === col ? '#2563eb' : inputBg,
                    color: bound.color === col ? '#ffffff' : subtext,
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {col}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Note background swatches matching Image 2
  const NOTE_SWATCHES: { id: NoteColor; label: string; swatch: string }[] = [
    { id: 'yellow', label: 'Yellow', swatch: '#fef08a' },
    { id: 'pink', label: 'Pink', swatch: '#fbcfe8' },
    { id: 'blue', label: 'Blue', swatch: '#bae6fd' },
    { id: 'green', label: 'Green', swatch: '#bbf7d0' },
    { id: 'orange', label: 'Peach / Orange', swatch: '#fed7aa' },
    { id: 'gray', label: 'Gray / White', swatch: '#e2e8f0' },
  ];

  // Render Note Inspector matching Image 2
  const renderNoteView = (note: LensNote) => {
    const currentColor = note.color || 'gray';
    const noteStyle = getNoteColorStyles(note.color, isDark);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
        {/* Header matching Image 2: "Note" with red trash can on right */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: `1px solid ${border}`,
          backgroundColor: headerBg,
        }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: text }}>
            Note
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={onCloseSelection}
              title="Close"
              style={{ border: 'none', background: 'transparent', color: subtext, cursor: 'pointer', padding: '4px' }}
            >
              <FiX size={18} />
            </button>
            <button
              type="button"
              onClick={() => onDeleteNote?.(note.id)}
              title="Delete Note"
              style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
            >
              <FiTrash2 size={18} />
            </button>
          </div>
        </div>

        {/* Note Body matching Image 2: editable textarea in colored background */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <textarea
              value={note.text}
              onChange={(e) => onUpdateNote?.({ ...note, text: e.target.value })}
              placeholder="Enter note contents..."
              rows={7}
              style={{
                width: '100%',
                padding: '14px 16px',
                borderRadius: '14px',
                border: `1.5px solid ${noteStyle.border}`,
                backgroundColor: noteStyle.bg,
                color: noteStyle.text,
                fontSize: '13px',
                lineHeight: 1.6,
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
                boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.2)' : '0 1px 4px rgba(0,0,0,0.05)',
              }}
            />
          </div>

          {/* Background color swatches matching Image 2 */}
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: subtext, marginBottom: '10px' }}>
              Background
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {NOTE_SWATCHES.map(sw => {
                const isSelected = currentColor === sw.id;
                return (
                  <button
                    key={sw.id}
                    type="button"
                    onClick={() => onUpdateNote?.({ ...note, color: sw.id })}
                    title={sw.label}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      backgroundColor: sw.swatch,
                      border: isSelected
                        ? (isDark ? '2.5px solid #ffffff' : '2.5px solid #1e293b')
                        : '1px solid rgba(0,0,0,0.15)',
                      boxShadow: isSelected
                        ? '0 0 0 2px #3b82f6'
                        : '0 1px 3px rgba(0,0,0,0.1)',
                      cursor: 'pointer',
                      transform: isSelected ? 'scale(1.15)' : 'scale(1)',
                      transition: 'all 0.15s ease',
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render Overview when nothing is selected
  const renderOverview = () => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${border}`, backgroundColor: headerBg }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '7px',
                backgroundColor: isDark ? '#1e293b' : '#eff6ff',
                border: `1px solid ${isDark ? '#334155' : '#bfdbfe'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#3b82f6',
              }}>
                <FiShield size={14} />
              </div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: text }}>
                  {state.title || 'Architecture Decision Record'}
                </div>
                <div style={{ fontSize: '10.5px', color: subtext }}>
                  Canvas Overview & Topology Stats
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onAutoArrange}
              title="Auto Arrange Canvas"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                borderRadius: '6px',
                border: `1px solid ${border}`,
                backgroundColor: cellBg,
                color: subtext,
                fontSize: '10.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <FiShuffle size={12} />
              <span>Arrange</span>
            </button>
          </div>
        </div>

        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Quick Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
            <div style={{ padding: '10px', borderRadius: '8px', backgroundColor: cellBg, border: `1px solid ${cellBorder}`, textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#3b82f6' }}>{state.components.length}</div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: subtext }}>Components</div>
            </div>
            <div style={{ padding: '10px', borderRadius: '8px', backgroundColor: cellBg, border: `1px solid ${cellBorder}`, textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#10b981' }}>{state.connections.length}</div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: subtext }}>Connections</div>
            </div>
            <div style={{ padding: '10px', borderRadius: '8px', backgroundColor: cellBg, border: `1px solid ${cellBorder}`, textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#f59e0b' }}>{state.boundaries.length}</div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: subtext }}>Boundaries</div>
            </div>
          </div>

          {/* Quick Component Selection */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: subtext, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
              Click any component to inspect & edit:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {state.components.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectComponent(c.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: `1px solid ${cellBorder}`,
                    backgroundColor: cellBg,
                    color: text,
                    fontSize: '11.5px',
                    fontWeight: 600,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span>{c.name}</span>
                  <FiChevronRight size={13} style={{ color: subtext }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={() => setIsCollapsed(false)}
        title="Expand Inspector Drawer"
        style={{
          position: 'absolute',
          top: '12px',
          right: '14px',
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 12px',
          borderRadius: '10px',
          backgroundColor: bg,
          border: `1px solid ${border}`,
          color: text,
          fontSize: '11.5px',
          fontWeight: 700,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          cursor: 'pointer',
        }}
      >
        <FiChevronLeft size={13} />
        <span>Inspector</span>
      </button>
    );
  }

  return (
    <aside
      className="lens-inspector-drawer"
      style={{
        position: 'absolute',
        top: '12px',
        right: '14px',
        bottom: '64px',
        width: `${width}px`,
        borderRadius: '16px',
        background: bg,
        border: `1px solid ${border}`,
        boxShadow: isDark ? '0 10px 30px rgba(0, 0, 0, 0.4)' : '0 8px 24px rgba(0, 0, 0, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
        overflow: 'hidden',
        backdropFilter: 'blur(10px)',
        userSelect: 'none',
      }}
    >
      {/* Drag Resize Handle on Left Edge */}
      <div
        onMouseDown={handleMouseDownResize}
        title="Drag left/right to resize inspector drawer"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '5px',
          cursor: 'ew-resize',
          zIndex: 50,
          backgroundColor: 'transparent',
        }}
      />

      {activeThreat
        ? renderThreatEditor(activeThreat)
        : activeDecision
        ? renderDecisionEditor(activeDecision)
        : activeInvariant
        ? renderInvariantEditor(activeInvariant)
        : activeComponent
        ? renderComponentView(activeComponent)
        : activeEdge
        ? renderEdgeView(activeEdge)
        : activeBoundary
        ? renderBoundaryView(activeBoundary)
        : activeNote
        ? renderNoteView(activeNote)
        : renderOverview()}
    </aside>
  );
}
