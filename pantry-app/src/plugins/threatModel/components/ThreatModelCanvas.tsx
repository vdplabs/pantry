import React, { useState } from 'react';
import {
  FiShield, FiLayers, FiList, FiPieChart, FiDownload, FiPlus,
  FiAlertTriangle, FiCheckCircle, FiActivity, FiCpu, FiDatabase,
  FiGlobe, FiServer, FiLock, FiChevronRight, FiEdit2, FiTrash2, FiSearch, FiFilter
} from 'react-icons/fi';
import type { ThreatModelState, ThreatComponent, ThreatItem, ThreatSeverity, ThreatStatus } from '../types';
import MermaidViewer from '@/components/artifacts/MermaidViewer';

interface Props {
  state: ThreatModelState;
  framework?: string;
  onChange: (newState: ThreatModelState) => void;
  onSendPrompt: (prompt: string) => void;
}

export default function ThreatModelCanvas({ state, framework, onChange, onSendPrompt }: Props) {
  const [activeTab, setActiveTab] = useState<'dfd' | 'threats' | 'stages' | 'summary'>('dfd');
  const [selectedCompId, setSelectedCompId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showAddCompModal, setShowAddCompModal] = useState(false);
  const [showAddThreatModal, setShowAddThreatModal] = useState(false);

  // New Component form state
  const [newCompName, setNewCompName] = useState('');
  const [newCompType, setNewCompType] = useState<ThreatComponent['type']>('process');
  const [newCompBoundary, setNewCompBoundary] = useState('Internal Trust Zone');
  const [newCompTech, setNewCompTech] = useState('');

  // New Threat form state
  const [newThreatTitle, setNewThreatTitle] = useState('');
  const [newThreatCompId, setNewThreatCompId] = useState(state.components[0]?.id || '');
  const [newThreatCategory, setNewThreatCategory] = useState('Spoofing');
  const [newThreatActor, setNewThreatActor] = useState('External Attacker');
  const [newThreatSeverity, setNewThreatSeverity] = useState<ThreatSeverity>('High');
  const [newThreatDesc, setNewThreatDesc] = useState('');
  const [newThreatMitigation, setNewThreatMitigation] = useState('');

  const threats = state.threats || [];
  const components = state.components || [];
  const stages = state.stages || [];

  const criticalCount = threats.filter(t => t.severity === 'Critical').length;
  const highCount = threats.filter(t => t.severity === 'High').length;
  const mediumCount = threats.filter(t => t.severity === 'Medium').length;
  const lowCount = threats.filter(t => t.severity === 'Low').length;
  const openCount = threats.filter(t => t.status === 'Open').length;
  const mitigatedCount = threats.filter(t => t.status === 'Mitigated').length;

  const completedStagesCount = stages.filter(s => s.status === 'completed').length;
  const stageProgressPct = stages.length > 0 ? Math.round((completedStagesCount / stages.length) * 100) : 0;

  // Filtered threats
  const filteredThreats = threats.filter(t => {
    if (severityFilter !== 'all' && t.severity !== severityFilter) return false;
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        t.id.toLowerCase().includes(q) ||
        (t.componentName || '').toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.threatActor.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleStatusChange = (threatId: string, newStatus: ThreatStatus) => {
    const updatedThreats = threats.map(t => (t.id === threatId ? { ...t, status: newStatus } : t));
    onChange({ ...state, threats: updatedThreats, updatedAt: new Date().toISOString() });
  };

  const handleDeleteThreat = (threatId: string) => {
    const updatedThreats = threats.filter(t => t.id !== threatId);
    onChange({ ...state, threats: updatedThreats, updatedAt: new Date().toISOString() });
  };

  const handleAddCustomComponent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompName.trim()) return;
    const newComp: ThreatComponent = {
      id: `comp-${Date.now().toString(36)}`,
      name: newCompName.trim(),
      type: newCompType,
      trustBoundary: newCompBoundary.trim() || 'Internal Zone',
      techStack: newCompTech.trim() || undefined,
    };
    onChange({
      ...state,
      components: [...components, newComp],
      updatedAt: new Date().toISOString(),
    });
    setNewCompName('');
    setNewCompTech('');
    setShowAddCompModal(false);
  };

  const handleAddCustomThreat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newThreatDesc.trim()) return;
    const comp = components.find(c => c.id === newThreatCompId);
    const newThreat: ThreatItem = {
      id: `TM-${String(threats.length + 1).padStart(2, '0')}`,
      componentId: newThreatCompId,
      componentName: comp ? comp.name : 'General Architecture',
      category: newThreatCategory,
      threatActor: newThreatActor || 'External Adversary',
      attackVector: newThreatTitle || 'Direct Exploitation',
      description: newThreatDesc,
      impact: 'Security violation / unauthorized access',
      severity: newThreatSeverity,
      mitigation: newThreatMitigation || 'Apply security controls',
      status: 'Open',
    };
    onChange({
      ...state,
      threats: [...threats, newThreat],
      updatedAt: new Date().toISOString(),
    });
    setNewThreatDesc('');
    setNewThreatMitigation('');
    setNewThreatTitle('');
    setShowAddThreatModal(false);
  };

  const exportMarkdownReport = () => {
    const md = `# Security & Threat Model Report
**Application**: ${state.appName || 'Target System'}
**Framework**: ${state.framework || 'PASTA'}
**Scope**: ${state.scope || 'System Architecture'}
**Date**: ${new Date().toLocaleDateString()}

---

## 1. Executive Summary
- **Total Registered Threats**: ${threats.length}
- **Critical Severity**: ${criticalCount}
- **High Severity**: ${highCount}
- **Medium Severity**: ${mediumCount}
- **Low Severity**: ${lowCount}
- **Mitigated / Resolved**: ${mitigatedCount} (${threats.length > 0 ? Math.round((mitigatedCount / threats.length) * 100) : 0}%)

---

## 2. Architecture & Components Inventory
${components.map(c => `### ${c.name} (${c.type.toUpperCase()})
- **Component ID**: \`${c.id}\`
- **Trust Boundary**: ${c.trustBoundary}
- **Tech Stack**: ${c.techStack || 'N/A'}
- **Description**: ${c.description || 'Core system component'}
`).join('\n')}

---

## 3. Data Flow Diagram (Mermaid)
\`\`\`mermaid
${state.dfdMermaid}
\`\`\`

---

## 4. Threat Matrix & Mitigation Register
| ID | Target Component | Category | Threat Actor | Severity | Status | Mitigation |
|---|---|---|---|---|---|---|
${threats.map(t => `| **${t.id}** | ${t.componentName || t.componentId} | ${t.category} | ${t.threatActor} | \`${t.severity}\` | ${t.status} | ${t.mitigation} |`).join('\n')}

---

## 5. Threat Details & Attack Vectors
${threats.map(t => `### [${t.id}] ${t.category}: ${t.componentName || t.componentId}
- **Threat Actor**: ${t.threatActor}
- **Attack Vector**: ${t.attackVector}
- **Severity**: **${t.severity}** (Status: ${t.status})
- **Impact**: ${t.impact}
- **Description**: ${t.description}
- **Recommended Mitigation**: ${t.mitigation}
`).join('\n\n')}
`;

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `threat-model-report-${(state.appName || 'pantry').toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getComponentIcon = (type: ThreatComponent['type']) => {
    switch (type) {
      case 'actor': return <FiGlobe className="comp-type-icon actor" />;
      case 'gateway': return <FiShield className="comp-type-icon gateway" />;
      case 'process': return <FiCpu className="comp-type-icon process" />;
      case 'datastore': return <FiDatabase className="comp-type-icon datastore" />;
      case 'external': return <FiServer className="comp-type-icon external" />;
      default: return <FiLayers className="comp-type-icon" />;
    }
  };

  return (
    <div className="threat-model-canvas">
      {/* Canvas Top Bar */}
      <div className="tm-topbar">
        <div className="tm-topbar-info">
          <div className="tm-badge-group">
            <span className="tm-framework-badge">
              <FiShield size={12} /> {state.framework || framework || 'PASTA'} STUDIO
            </span>
            <span className="tm-threats-badge">
              {threats.length} Threats ({criticalCount} Crit, {highCount} High)
            </span>
          </div>
          <h2 className="tm-title">{state.appName || 'Target Architecture'}</h2>
        </div>

        <div className="tm-topbar-actions">
          <button onClick={() => setShowAddCompModal(true)} className="tm-btn secondary" title="Add architecture component">
            <FiPlus size={13} /> Component
          </button>
          <button onClick={() => setShowAddThreatModal(true)} className="tm-btn secondary" title="Add threat item">
            <FiPlus size={13} /> Threat
          </button>
          <button onClick={exportMarkdownReport} className="tm-btn primary" title="Export complete Threat Model Report">
            <FiDownload size={13} /> Export Report
          </button>
        </div>
      </div>

      {/* Canvas Nav Tabs */}
      <div className="tm-nav-tabs">
        <button
          className={`tm-tab-btn ${activeTab === 'dfd' ? 'active' : ''}`}
          onClick={() => setActiveTab('dfd')}
        >
          <FiLayers size={14} /> DFD & Architecture
        </button>
        <button
          className={`tm-tab-btn ${activeTab === 'threats' ? 'active' : ''}`}
          onClick={() => setActiveTab('threats')}
        >
          <FiShield size={14} /> Threat Matrix ({threats.length})
        </button>
        <button
          className={`tm-tab-btn ${activeTab === 'stages' ? 'active' : ''}`}
          onClick={() => setActiveTab('stages')}
        >
          <FiList size={14} /> Stages ({completedStagesCount}/{stages.length})
        </button>
        <button
          className={`tm-tab-btn ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          <FiPieChart size={14} /> Risk Summary
        </button>
      </div>

      {/* Main Canvas Body */}
      <div className="tm-body">
        {/* TAB 1: DFD & ARCHITECTURE */}
        {activeTab === 'dfd' && (
          <div className="tm-dfd-view">
            <div className="tm-diagram-card">
              <div className="tm-card-header">
                <span className="tm-card-title">Interactive Data Flow Diagram (DFD)</span>
                <span className="tm-card-hint">Generated live from system decomposition</span>
              </div>
              <div className="tm-diagram-container">
                <MermaidViewer code={state.dfdMermaid} />
              </div>
            </div>

            {/* Component Inventory & Quick Prompts */}
            <div className="tm-components-section">
              <div className="tm-section-header">
                <h3>Registered System Components ({components.length})</h3>
                <span className="tm-hint">Click any component to trigger targeted AI threat queries</span>
              </div>

              <div className="tm-components-grid">
                {components.map(comp => {
                  const compThreats = threats.filter(t => t.componentId === comp.id);
                  const isSelected = selectedCompId === comp.id;

                  return (
                    <div
                      key={comp.id}
                      className={`tm-comp-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedCompId(isSelected ? null : comp.id)}
                    >
                      <div className="tm-comp-head">
                        <div className="tm-comp-title-wrap">
                          {getComponentIcon(comp.type)}
                          <div className="tm-comp-name">{comp.name}</div>
                        </div>
                        <span className="tm-comp-boundary-pill">{comp.trustBoundary}</span>
                      </div>

                      {comp.techStack && (
                        <div className="tm-comp-tech">
                          <span>Tech:</span> {comp.techStack}
                        </div>
                      )}

                      <div className="tm-comp-footer">
                        <span className={`tm-comp-threat-count ${compThreats.length > 0 ? 'has-threats' : ''}`}>
                          {compThreats.length} threat{compThreats.length === 1 ? '' : 's'} identified
                        </span>

                        <div className="tm-comp-quick-actions" onClick={e => e.stopPropagation()}>
                          <button
                            className="tm-comp-action-btn"
                            title={`Ask AI: Threat actors against ${comp.name}`}
                            onClick={() => onSendPrompt(`Analyze realistic threat actors and attack vectors against "${comp.name}" (${comp.trustBoundary}). Identify 1-2 key threats with mitigations.`)}
                          >
                            ⚡ Threat Actors
                          </button>
                          <button
                            className="tm-comp-action-btn"
                            title={`Ask AI: STRIDE analysis for ${comp.name}`}
                            onClick={() => onSendPrompt(`Perform a concise STRIDE analysis for "${comp.name}" (${comp.trustBoundary}, ${comp.techStack || 'Standard'}). Suggest 1-2 key mitigations.`)}
                          >
                            🛡️ STRIDE
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: THREAT MATRIX & REGISTER */}
        {activeTab === 'threats' && (
          <div className="tm-threats-view">
            {/* Filters Bar */}
            <div className="tm-filters-bar">
              <div className="tm-search-box">
                <FiSearch size={14} className="tm-search-icon" />
                <input
                  type="text"
                  placeholder="Search threats, components, or actors..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="tm-search-input"
                />
              </div>

              <div className="tm-filter-group">
                <span className="tm-filter-label"><FiFilter size={12} /> Severity:</span>
                <select
                  value={severityFilter}
                  onChange={e => setSeverityFilter(e.target.value)}
                  className="tm-select"
                >
                  <option value="all">All Severities</option>
                  <option value="Critical">Critical</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>

                <span className="tm-filter-label">Status:</span>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="tm-select"
                >
                  <option value="all">All Statuses</option>
                  <option value="Open">Open</option>
                  <option value="Mitigated">Mitigated</option>
                  <option value="Accepted">Accepted</option>
                </select>
              </div>
            </div>

            {/* Threats Table / Card List */}
            {filteredThreats.length === 0 ? (
              <div className="tm-empty-state">
                <FiShield size={36} className="tm-empty-icon" />
                <h4>No threats found matching criteria</h4>
                <p>Ask the AI in chat to analyze your architecture or add a custom threat item.</p>
                <button
                  className="tm-btn primary"
                  onClick={() => onSendPrompt(`Analyze the current architecture and identify the top 5 critical security threats across all trust boundaries.`)}
                >
                  ⚡ Run AI Threat Discovery
                </button>
              </div>
            ) : (
              <div className="tm-threats-list">
                {filteredThreats.map(threat => (
                  <div key={threat.id} className={`tm-threat-card severity-${threat.severity.toLowerCase()}`}>
                    <div className="tm-threat-header">
                      <div className="tm-threat-id-wrap">
                        <span className="tm-threat-id">{threat.id}</span>
                        <span className={`tm-sev-badge ${threat.severity.toLowerCase()}`}>{threat.severity}</span>
                        <span className="tm-cat-badge">{threat.category}</span>
                      </div>

                      <div className="tm-threat-status-wrap">
                        <select
                          value={threat.status}
                          onChange={e => handleStatusChange(threat.id, e.target.value as ThreatStatus)}
                          className={`tm-status-select ${threat.status.toLowerCase()}`}
                        >
                          <option value="Open">🔴 Open</option>
                          <option value="Mitigated">🟢 Mitigated</option>
                          <option value="Accepted">🟡 Accepted</option>
                        </select>
                        <button
                          onClick={() => handleDeleteThreat(threat.id)}
                          className="tm-delete-btn"
                          title="Delete threat"
                        >
                          <FiTrash2 size={13} />
                        </button>
                      </div>
                    </div>

                    <div className="tm-threat-target">
                      <span className="label">Target Component:</span>
                      <span className="value">🎯 {threat.componentName || threat.componentId}</span>
                      <span className="actor">🦹 Actor: {threat.threatActor}</span>
                    </div>

                    <p className="tm-threat-desc">{threat.description}</p>

                    <div className="tm-threat-details-grid">
                      <div className="tm-detail-box attack">
                        <span className="detail-title">⚡ Attack Vector</span>
                        <p>{threat.attackVector}</p>
                      </div>
                      <div className="tm-detail-box impact">
                        <span className="detail-title">💥 Impact</span>
                        <p>{threat.impact}</p>
                      </div>
                    </div>

                    <div className="tm-mitigation-box">
                      <div className="tm-mitigation-head">
                        <FiLock size={13} />
                        <span>Recommended Mitigation & Controls</span>
                      </div>
                      <p>{threat.mitigation}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: STAGES & WALKTHROUGH */}
        {activeTab === 'stages' && (
          <div className="tm-stages-view">
            <div className="tm-stages-progress-card">
              <div className="tm-progress-info">
                <h3>{state.framework || 'PASTA'} Methodology Walkthrough</h3>
                <span>{completedStagesCount} of {stages.length} Stages Completed ({stageProgressPct}%)</span>
              </div>
              <div className="tm-progress-track">
                <div className="tm-progress-fill" style={{ width: `${stageProgressPct}%` }} />
              </div>
            </div>

            <div className="tm-stages-timeline">
              {stages.map((stage, idx) => (
                <div key={stage.id} className={`tm-stage-card ${stage.status}`}>
                  <div className="tm-stage-number">{idx + 1}</div>
                  <div className="tm-stage-content">
                    <div className="tm-stage-top">
                      <h4 className="tm-stage-title">{stage.name}</h4>
                      <span className={`tm-stage-status-pill ${stage.status}`}>
                        {stage.status === 'completed' ? '✓ Completed' : stage.status === 'in_progress' ? '⏳ In Progress' : 'Pending'}
                      </span>
                    </div>
                    <p className="tm-stage-desc">{stage.description}</p>
                    {stage.findings && (
                      <div className="tm-stage-findings">
                        <span className="findings-label">Findings / Output:</span>
                        <p>{stage.findings}</p>
                      </div>
                    )}
                    <div className="tm-stage-actions">
                      <button
                        className="tm-btn secondary sm"
                        onClick={() => onSendPrompt(`Let's work on "${stage.name}". Please analyze and update the threat model canvas for this stage.`)}
                      >
                        ⚡ Execute Stage with AI
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: RISK SUMMARY */}
        {activeTab === 'summary' && (
          <div className="tm-summary-view">
            <div className="tm-metrics-grid">
              <div className="tm-metric-card critical">
                <div className="metric-val">{criticalCount}</div>
                <div className="metric-label">Critical Severity</div>
              </div>
              <div className="tm-metric-card high">
                <div className="metric-val">{highCount}</div>
                <div className="metric-label">High Severity</div>
              </div>
              <div className="tm-metric-card medium">
                <div className="metric-val">{mediumCount}</div>
                <div className="metric-label">Medium Severity</div>
              </div>
              <div className="tm-metric-card mitigated">
                <div className="metric-val">{mitigatedCount}</div>
                <div className="metric-label">Mitigated Threats</div>
              </div>
            </div>

            <div className="tm-summary-card">
              <div className="tm-card-header">
                <span className="tm-card-title">🛡️ High Priority Threat Matrix</span>
              </div>
              <div className="tm-priority-list">
                {threats.filter(t => t.severity === 'Critical' || t.severity === 'High').map(t => (
                  <div key={t.id} className="tm-priority-item">
                    <div className="pri-head">
                      <span className={`tm-sev-badge ${t.severity.toLowerCase()}`}>{t.severity}</span>
                      <span className="pri-title">[{t.id}] {t.componentName}: {t.category}</span>
                    </div>
                    <p className="pri-desc">{t.description}</p>
                    <div className="pri-mit">
                      <strong>Mitigation:</strong> {t.mitigation}
                    </div>
                  </div>
                ))}
                {threats.filter(t => t.severity === 'Critical' || t.severity === 'High').length === 0 && (
                  <p className="tm-no-critical">No Critical or High severity threats recorded yet.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Add Custom Component */}
      {showAddCompModal && (
        <div className="tm-modal-overlay" onClick={() => setShowAddCompModal(false)}>
          <div className="tm-modal" onClick={e => e.stopPropagation()}>
            <h3>Add System Component</h3>
            <form onSubmit={handleAddCustomComponent}>
              <div className="tm-form-field">
                <label>Component Name</label>
                <input
                  type="text"
                  placeholder="e.g. Payment Gateway / Redis Cache"
                  value={newCompName}
                  onChange={e => setNewCompName(e.target.value)}
                  required
                />
              </div>
              <div className="tm-form-field">
                <label>Component Type</label>
                <select value={newCompType} onChange={e => setNewCompType(e.target.value as any)}>
                  <option value="process">⚙️ Process / Microservice</option>
                  <option value="gateway">🛡️ Gateway / Reverse Proxy</option>
                  <option value="datastore">🗄️ Data Store / Database</option>
                  <option value="actor">🌐 External Actor / Client</option>
                  <option value="external">☁️ Third-Party / External API</option>
                  <option value="agent">🤖 AI Agent / Tool</option>
                </select>
              </div>
              <div className="tm-form-field">
                <label>Trust Boundary</label>
                <input
                  type="text"
                  placeholder="e.g. DMZ, Internal VPC, Untrusted Internet"
                  value={newCompBoundary}
                  onChange={e => setNewCompBoundary(e.target.value)}
                />
              </div>
              <div className="tm-form-field">
                <label>Tech Stack</label>
                <input
                  type="text"
                  placeholder="e.g. Go, Envoy, PostgreSQL, Kafka"
                  value={newCompTech}
                  onChange={e => setNewCompTech(e.target.value)}
                />
              </div>
              <div className="tm-modal-actions">
                <button type="button" onClick={() => setShowAddCompModal(false)} className="tm-btn secondary">Cancel</button>
                <button type="submit" className="tm-btn primary">Add Component</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Custom Threat */}
      {showAddThreatModal && (
        <div className="tm-modal-overlay" onClick={() => setShowAddThreatModal(false)}>
          <div className="tm-modal" onClick={e => e.stopPropagation()}>
            <h3>Register Security Threat</h3>
            <form onSubmit={handleAddCustomThreat}>
              <div className="tm-form-field">
                <label>Target Component</label>
                <select value={newThreatCompId} onChange={e => setNewThreatCompId(e.target.value)}>
                  {components.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.trustBoundary})</option>
                  ))}
                </select>
              </div>
              <div className="tm-form-field">
                <label>Threat Category (STRIDE / PASTA)</label>
                <select value={newThreatCategory} onChange={e => setNewThreatCategory(e.target.value)}>
                  <option value="Spoofing">Spoofing Identity</option>
                  <option value="Tampering">Tampering with Data</option>
                  <option value="Repudiation">Repudiation</option>
                  <option value="InfoDisclosure">Information Disclosure</option>
                  <option value="DoS">Denial of Service</option>
                  <option value="Elevation">Elevation of Privilege</option>
                  <option value="PromptInjection">Prompt Injection / LLM Jailbreak</option>
                  <option value="BusinessLogic">Business Logic Flaw</option>
                </select>
              </div>
              <div className="tm-form-field">
                <label>Severity</label>
                <select value={newThreatSeverity} onChange={e => setNewThreatSeverity(e.target.value as any)}>
                  <option value="Critical">🔴 Critical</option>
                  <option value="High">🟠 High</option>
                  <option value="Medium">🟡 Medium</option>
                  <option value="Low">🔵 Low</option>
                </select>
              </div>
              <div className="tm-form-field">
                <label>Threat Actor</label>
                <input
                  type="text"
                  placeholder="e.g. Malicious Insider, External Botnet, Script Kiddie"
                  value={newThreatActor}
                  onChange={e => setNewThreatActor(e.target.value)}
                />
              </div>
              <div className="tm-form-field">
                <label>Threat Description</label>
                <textarea
                  rows={2}
                  placeholder="Describe how the attack is carried out..."
                  value={newThreatDesc}
                  onChange={e => setNewThreatDesc(e.target.value)}
                  required
                />
              </div>
              <div className="tm-form-field">
                <label>Recommended Mitigation</label>
                <textarea
                  rows={2}
                  placeholder="Security controls, rate limiting, encryption, mTLS..."
                  value={newThreatMitigation}
                  onChange={e => setNewThreatMitigation(e.target.value)}
                />
              </div>
              <div className="tm-modal-actions">
                <button type="button" onClick={() => setShowAddThreatModal(false)} className="tm-btn secondary">Cancel</button>
                <button type="submit" className="tm-btn primary">Register Threat</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
