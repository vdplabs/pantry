import React, { useState } from 'react';
import {
  FiFileText, FiLayers, FiList, FiDownload, FiPlus,
  FiCheckCircle, FiShield, FiAlertTriangle, FiTrash2,
  FiSearch, FiFilter, FiEdit3, FiZap, FiCheck
} from 'react-icons/fi';
import type { RfcState, RfcDecision, RfcInvariant, RfcStatus } from '../types';
import MermaidViewer from '@/components/artifacts/MermaidViewer';
import { marked } from 'marked';

interface Props {
  state: RfcState;
  framework?: string;
  onChange: (newState: RfcState) => void;
  onSendPrompt: (prompt: string) => void;
}

export default function ArchitectureRfcCanvas({ state, framework, onChange, onSendPrompt }: Props) {
  const [activeTab, setActiveTab] = useState<'rfc' | 'diagram' | 'decisions' | 'invariants'>('rfc');
  const [isEditingRfc, setIsEditingRfc] = useState(false);
  const [rfcContent, setRfcContent] = useState(state.rfcMarkdown || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [decisionFilter, setDecisionFilter] = useState('all');

  // Modals
  const [showAddDecisionModal, setShowAddDecisionModal] = useState(false);
  const [showAddInvariantModal, setShowAddInvariantModal] = useState(false);

  // New Decision state
  const [newDecTitle, setNewDecTitle] = useState('');
  const [newDecChosen, setNewDecChosen] = useState('');
  const [newDecAlternatives, setNewDecAlternatives] = useState('');
  const [newDecRationale, setNewDecRationale] = useState('');
  const [newDecTradeoffs, setNewDecTradeoffs] = useState('');

  // New Invariant state
  const [newInvStatement, setNewInvStatement] = useState('');
  const [newInvCategory, setNewInvCategory] = useState<RfcInvariant['category']>('Correctness');

  const decisions = state.decisions || [];
  const invariants = state.invariants || [];
  const approvedDecisionsCount = decisions.filter(d => d.status === 'Approved').length;

  const handleStatusChange = (newStatus: RfcStatus) => {
    onChange({
      ...state,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleSaveRfc = () => {
    onChange({
      ...state,
      rfcMarkdown: rfcContent,
      updatedAt: new Date().toISOString(),
    });
    setIsEditingRfc(false);
  };

  const handleAddDecision = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDecTitle.trim() || !newDecChosen.trim()) return;
    const newDec: RfcDecision = {
      id: `ADR-${String(decisions.length + 1).padStart(2, '0')}`,
      title: newDecTitle.trim(),
      status: 'Approved',
      context: 'Architecture evaluation',
      chosenOption: newDecChosen.trim(),
      alternativesConsidered: newDecAlternatives.trim() || undefined,
      rationale: newDecRationale.trim() || 'Selected based on architecture requirements.',
      tradeoffs: newDecTradeoffs.trim() || undefined,
    };
    onChange({
      ...state,
      decisions: [...decisions, newDec],
      updatedAt: new Date().toISOString(),
    });
    setNewDecTitle('');
    setNewDecChosen('');
    setNewDecAlternatives('');
    setNewDecRationale('');
    setNewDecTradeoffs('');
    setShowAddDecisionModal(false);
  };

  const handleDeleteDecision = (id: string) => {
    onChange({
      ...state,
      decisions: decisions.filter(d => d.id !== id),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleAddInvariant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInvStatement.trim()) return;
    const newInv: RfcInvariant = {
      id: `INV-${String(invariants.length + 1).padStart(2, '0')}`,
      statement: newInvStatement.trim(),
      category: newInvCategory,
      status: 'Enforced',
    };
    onChange({
      ...state,
      invariants: [...invariants, newInv],
      updatedAt: new Date().toISOString(),
    });
    setNewInvStatement('');
    setShowAddInvariantModal(false);
  };

  const handleDeleteInvariant = (id: string) => {
    onChange({
      ...state,
      invariants: invariants.filter(i => i.id !== id),
      updatedAt: new Date().toISOString(),
    });
  };

  const exportMarkdownReport = () => {
    const report = `# ${state.title || 'Architecture RFC'}
**Framework**: ${state.framework ? state.framework.toUpperCase() : 'RFC'}
**Status**: ${state.status}
**Scope**: ${state.scope}
**Date**: ${new Date().toLocaleDateString()}

---

## 1. RFC Design Document
${state.rfcMarkdown}

---

## 2. Architecture Diagram (Mermaid)
\`\`\`mermaid
${state.diagramMermaid}
\`\`\`

---

## 3. Architecture Decisions & ADRs (${decisions.length} records)
| ID | Decision Topic | Chosen Approach | Status | Rationale |
|---|---|---|---|---|
${decisions.map(d => `| **${d.id}** | ${d.title} | ${d.chosenOption} | \`${d.status}\` | ${d.rationale} |`).join('\n')}

---

## 4. System Invariants & Guarantees
${invariants.map(i => `- **[${i.id}] [${i.category}]**: ${i.statement} (\`${i.status}\`)`).join('\n')}
`;

    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `architecture-rfc-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredDecisions = decisions.filter(d => {
    if (decisionFilter !== 'all' && d.status !== decisionFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        d.id.toLowerCase().includes(q) ||
        d.title.toLowerCase().includes(q) ||
        d.chosenOption.toLowerCase().includes(q) ||
        d.rationale.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="threat-model-canvas rfc-studio-canvas">
      {/* Top Bar */}
      <div className="tm-topbar">
        <div className="tm-topbar-info">
          <div className="tm-badge-group">
            <span className="tm-framework-badge" style={{ color: '#a855f7', borderColor: 'rgba(168, 85, 247, 0.4)' }}>
              📐 ARCHITECTURE RFC ({state.framework ? state.framework.toUpperCase() : 'DESIGN DOC'})
            </span>
            <select
              value={state.status}
              onChange={e => handleStatusChange(e.target.value as any)}
              className={`tm-status-select ${state.status === 'Approved' ? 'mitigated' : state.status === 'In Review' ? 'accepted' : 'open'}`}
              style={{ padding: '2px 8px', fontSize: '11px', fontWeight: 700 }}
            >
              <option value="Draft">Draft</option>
              <option value="In Review">In Review</option>
              <option value="Approved">✓ Approved</option>
              <option value="Superseded">Superseded</option>
            </select>
            <span className="tm-threats-badge">
              {decisions.length} Decisions · {invariants.length} Invariants
            </span>
          </div>
          <h2 className="tm-title">{state.title || 'Architecture RFC'}</h2>
        </div>

        <div className="tm-topbar-actions">
          <button onClick={() => setShowAddDecisionModal(true)} className="tm-btn secondary" title="Add Architecture Decision">
            <FiPlus size={13} /> Decision
          </button>
          <button onClick={() => setShowAddInvariantModal(true)} className="tm-btn secondary" title="Add System Invariant">
            <FiPlus size={13} /> Invariant
          </button>
          <button onClick={exportMarkdownReport} className="tm-btn primary" title="Export Complete RFC">
            <FiDownload size={13} /> Export RFC
          </button>
        </div>
      </div>

      {/* Nav Tabs */}
      <div className="tm-nav-tabs">
        <button
          className={`tm-tab-btn ${activeTab === 'rfc' ? 'active' : ''}`}
          onClick={() => setActiveTab('rfc')}
        >
          <FiFileText size={14} /> RFC Design Document
        </button>
        <button
          className={`tm-tab-btn ${activeTab === 'diagram' ? 'active' : ''}`}
          onClick={() => setActiveTab('diagram')}
        >
          <FiLayers size={14} /> Architecture Diagram
        </button>
        <button
          className={`tm-tab-btn ${activeTab === 'decisions' ? 'active' : ''}`}
          onClick={() => setActiveTab('decisions')}
        >
          <FiCheckCircle size={14} /> Decisions & ADRs ({decisions.length})
        </button>
        <button
          className={`tm-tab-btn ${activeTab === 'invariants' ? 'active' : ''}`}
          onClick={() => setActiveTab('invariants')}
        >
          <FiShield size={14} /> System Invariants ({invariants.length})
        </button>
      </div>

      {/* Main Content Body */}
      <div className="tm-body">
        {/* TAB 1: RFC DESIGN DOCUMENT */}
        {activeTab === 'rfc' && (
          <div className="research-doc-view">
            <div className="tm-diagram-card">
              <div className="tm-card-header">
                <div>
                  <span className="tm-card-title">RFC Design Document</span>
                  <span className="tm-card-hint">Formal system design specification and tradeoffs</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    className="tm-btn secondary sm"
                    onClick={() =>
                      onSendPrompt(
                        `Review the current RFC document for "${state.title}". Identify any architectural gaps, single points of failure, scaling bottlenecks, or unaddressed failure modes.`
                      )
                    }
                  >
                    ✨ AI Architectural Review
                  </button>
                  {isEditingRfc ? (
                    <button className="tm-btn primary sm" onClick={handleSaveRfc}>
                      <FiCheck size={12} /> Save RFC
                    </button>
                  ) : (
                    <button
                      className="tm-btn secondary sm"
                      onClick={() => {
                        setRfcContent(state.rfcMarkdown);
                        setIsEditingRfc(true);
                      }}
                    >
                      <FiEdit3 size={12} /> Edit Markdown
                    </button>
                  )}
                </div>
              </div>

              <div className="research-doc-content-wrap">
                {isEditingRfc ? (
                  <textarea
                    value={rfcContent}
                    onChange={e => setRfcContent(e.target.value)}
                    className="research-doc-editor"
                    placeholder="Enter RFC markdown..."
                  />
                ) : (
                  <div
                    className="research-doc-rendered markdown-body"
                    dangerouslySetInnerHTML={{
                      __html: marked.parse(state.rfcMarkdown || '*No RFC draft written yet.*') as string,
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: ARCHITECTURE DIAGRAM */}
        {activeTab === 'diagram' && (
          <div className="tm-dfd-view">
            <div className="tm-diagram-card">
              <div className="tm-card-header">
                <div>
                  <span className="tm-card-title">System Architecture & Component Topology</span>
                  <span className="tm-card-hint">Live editable Mermaid architecture diagram</span>
                </div>
                <button
                  className="tm-btn secondary sm"
                  onClick={() =>
                    onSendPrompt(
                      `Please update and synchronize the Mermaid system diagram to illustrate the proposed architecture topology, ingress, coordinator, and storage layers for "${state.title}".`
                    )
                  }
                >
                  ✨ AI Redraw Diagram
                </button>
              </div>
              <div className="tm-diagram-container">
                <MermaidViewer
                  code={state.diagramMermaid || 'graph TD\n  Client --> Gateway'}
                  editable={true}
                  onChangeCode={(newCode) => onChange({ ...state, diagramMermaid: newCode, updatedAt: new Date().toISOString() })}
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: DECISIONS & ALTERNATIVES */}
        {activeTab === 'decisions' && (
          <div className="tm-threats-view">
            <div className="tm-filters-bar">
              <div className="tm-search-box">
                <FiSearch size={14} className="tm-search-icon" />
                <input
                  type="text"
                  placeholder="Search decisions, chosen options, or rationale..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="tm-search-input"
                />
              </div>

              <div className="tm-filter-group">
                <span className="tm-filter-label"><FiFilter size={12} /> Status:</span>
                <select
                  value={decisionFilter}
                  onChange={e => setDecisionFilter(e.target.value)}
                  className="tm-select"
                >
                  <option value="all">All Statuses</option>
                  <option value="Approved">Approved</option>
                  <option value="Draft">Draft</option>
                  <option value="Superseded">Superseded</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </div>
            </div>

            {filteredDecisions.length === 0 ? (
              <div className="tm-empty-state">
                <FiCheckCircle size={36} className="tm-empty-icon" />
                <h4>No architecture decisions recorded yet</h4>
                <p>Formulate decisions and tradeoff evaluations with the AI in chat.</p>
                <button
                  className="tm-btn primary"
                  onClick={() => onSendPrompt(`Analyze the architectural choices for "${state.title}". Compare candidate approaches and record 2 structured Architecture Decision Records (ADRs).`)}
                >
                  ⚡ Analyze Design Decisions
                </button>
              </div>
            ) : (
              <div className="tm-threats-list">
                {filteredDecisions.map(d => (
                  <div key={d.id} className="tm-threat-card" style={{ borderLeft: `3px solid ${d.status === 'Approved' ? '#10b981' : d.status === 'Draft' ? '#f59e0b' : '#64748b'}` }}>
                    <div className="tm-threat-header">
                      <div className="tm-threat-id-wrap">
                        <span className="tm-threat-id">{d.id}</span>
                        <span className="tm-cat-badge" style={{ color: '#c084fc', background: 'rgba(192, 132, 252, 0.1)' }}>{d.title}</span>
                        <span className={`tm-sev-badge ${d.status === 'Approved' ? 'low' : d.status === 'Draft' ? 'medium' : 'high'}`}>
                          {d.status}
                        </span>
                      </div>
                      <button onClick={() => handleDeleteDecision(d.id)} className="tm-delete-btn" title="Delete Decision">
                        <FiTrash2 size={13} />
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ fontSize: '12px', color: '#e2e8f0' }}>
                        <strong style={{ color: '#38bdf8' }}>Chosen Approach:</strong> {d.chosenOption}
                      </div>
                      {d.alternativesConsidered && (
                        <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                          <strong style={{ color: '#94a3b8' }}>Alternatives Considered:</strong> {d.alternativesConsidered}
                        </div>
                      )}
                    </div>

                    <div className="tm-mitigation-box">
                      <div className="tm-mitigation-head" style={{ color: '#38bdf8' }}>
                        <FiCheckCircle size={12} /> Architectural Rationale & Tradeoffs:
                      </div>
                      <p>{d.rationale}</p>
                      {d.tradeoffs && (
                        <p style={{ marginTop: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                          <strong>Tradeoffs:</strong> {d.tradeoffs}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: SYSTEM INVARIANTS */}
        {activeTab === 'invariants' && (
          <div className="research-questions-view">
            <div className="tm-section-header">
              <h3>System Invariants & Guarantees ({invariants.length})</h3>
              <span className="tm-hint">Non-negotiable correctness, security, and performance invariants</span>
            </div>

            <div className="research-questions-list">
              {invariants.map(inv => (
                <div key={inv.id} className="research-q-card resolved">
                  <div className="research-q-head">
                    <span className="tm-threat-id">{inv.id}</span>
                    <span className="tm-cat-badge">{inv.category}</span>
                    <div className="research-q-text" style={{ fontWeight: 600 }}>{inv.statement}</div>
                    <div className="research-q-actions">
                      <span className="tm-stage-status-pill completed">✓ {inv.status}</span>
                      <button onClick={() => handleDeleteInvariant(inv.id)} className="tm-delete-btn">
                        <FiTrash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {invariants.length === 0 && (
                <div className="tm-empty-state">
                  <FiShield size={36} className="tm-empty-icon" />
                  <h4>No system invariants registered</h4>
                  <p>Invariants define rules that must never be broken (e.g. idempotency, atomicity, mTLS).</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal: Add Decision */}
      {showAddDecisionModal && (
        <div className="tm-modal-overlay" onClick={() => setShowAddDecisionModal(false)}>
          <div className="tm-modal" onClick={e => e.stopPropagation()}>
            <h3>Record Architecture Decision (ADR)</h3>
            <form onSubmit={handleAddDecision}>
              <div className="tm-form-field">
                <label>Decision Title / Question</label>
                <input
                  type="text"
                  placeholder="e.g. Storage Engine Selection"
                  value={newDecTitle}
                  onChange={e => setNewDecTitle(e.target.value)}
                  required
                />
              </div>
              <div className="tm-form-field">
                <label>Chosen Approach</label>
                <input
                  type="text"
                  placeholder="e.g. RocksDB LSM-Tree Engine"
                  value={newDecChosen}
                  onChange={e => setNewDecChosen(e.target.value)}
                  required
                />
              </div>
              <div className="tm-form-field">
                <label>Alternatives Considered</label>
                <input
                  type="text"
                  placeholder="e.g. SQLite, Redis, LevelDB"
                  value={newDecAlternatives}
                  onChange={e => setNewDecAlternatives(e.target.value)}
                />
              </div>
              <div className="tm-form-field">
                <label>Rationale</label>
                <textarea
                  rows={2}
                  placeholder="Why this approach was chosen..."
                  value={newDecRationale}
                  onChange={e => setNewDecRationale(e.target.value)}
                />
              </div>
              <div className="tm-form-field">
                <label>Tradeoffs & Drawbacks</label>
                <input
                  type="text"
                  placeholder="e.g. Higher compaction CPU overhead"
                  value={newDecTradeoffs}
                  onChange={e => setNewDecTradeoffs(e.target.value)}
                />
              </div>
              <div className="tm-modal-actions">
                <button type="button" onClick={() => setShowAddDecisionModal(false)} className="tm-btn secondary">Cancel</button>
                <button type="submit" className="tm-btn primary">Add Decision</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Invariant */}
      {showAddInvariantModal && (
        <div className="tm-modal-overlay" onClick={() => setShowAddInvariantModal(false)}>
          <div className="tm-modal" onClick={e => e.stopPropagation()}>
            <h3>Add System Invariant</h3>
            <form onSubmit={handleAddInvariant}>
              <div className="tm-form-field">
                <label>Invariant Statement</label>
                <input
                  type="text"
                  placeholder="e.g. State machine transitions must be strictly linear."
                  value={newInvStatement}
                  onChange={e => setNewInvStatement(e.target.value)}
                  required
                />
              </div>
              <div className="tm-form-field">
                <label>Category</label>
                <select value={newInvCategory} onChange={e => setNewInvCategory(e.target.value as any)}>
                  <option value="Correctness">Correctness & Data Integrity</option>
                  <option value="Security">Security & Access Control</option>
                  <option value="Availability">Availability & Fault Tolerance</option>
                  <option value="Performance">Performance & Latency Budget</option>
                </select>
              </div>
              <div className="tm-modal-actions">
                <button type="button" onClick={() => setShowAddInvariantModal(false)} className="tm-btn secondary">Cancel</button>
                <button type="submit" className="tm-btn primary">Add Invariant</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
