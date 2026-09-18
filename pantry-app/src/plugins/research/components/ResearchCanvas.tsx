import React, { useState } from 'react';
import {
  FiBookOpen, FiList, FiPieChart, FiDownload, FiPlus,
  FiCheckCircle, FiHelpCircle, FiFileText, FiTrash2,
  FiSearch, FiFilter, FiEdit3, FiZap, FiLayers, FiCheck
} from 'react-icons/fi';
import type { ResearchState, ResearchFinding, ResearchQuestion } from '../types';
import MermaidViewer from '@/components/artifacts/MermaidViewer';
import { marked } from 'marked';

interface Props {
  state: ResearchState;
  framework?: string;
  onChange: (newState: ResearchState) => void;
  onSendPrompt: (prompt: string) => void;
}

export default function ResearchCanvas({ state, framework, onChange, onSendPrompt }: Props) {
  const [activeTab, setActiveTab] = useState<'doc' | 'findings' | 'questions' | 'diagram'>('doc');
  const [isEditingDoc, setIsEditingDoc] = useState(false);
  const [docContent, setDocContent] = useState(state.documentMarkdown || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [confidenceFilter, setConfidenceFilter] = useState('all');

  // Modals
  const [showAddFindingModal, setShowAddFindingModal] = useState(false);
  const [showAddQuestionModal, setShowAddQuestionModal] = useState(false);

  // New Finding state
  const [newFindingTopic, setNewFindingTopic] = useState('');
  const [newFindingInsight, setNewFindingInsight] = useState('');
  const [newFindingConfidence, setNewFindingConfidence] = useState<'High' | 'Medium' | 'Low'>('High');
  const [newFindingTakeaway, setNewFindingTakeaway] = useState('');

  // New Question state
  const [newQuestionText, setNewQuestionText] = useState('');

  const findings = state.findings || [];
  const questions = state.questions || [];
  const resolvedQuestionsCount = questions.filter(q => q.status === 'resolved').length;

  const handleSaveDoc = () => {
    onChange({
      ...state,
      documentMarkdown: docContent,
      updatedAt: new Date().toISOString(),
    });
    setIsEditingDoc(false);
  };

  const handleAddFinding = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFindingInsight.trim()) return;
    const newFinding: ResearchFinding = {
      id: `RF-${String(findings.length + 1).padStart(2, '0')}`,
      topic: newFindingTopic.trim() || 'Core Analysis',
      insight: newFindingInsight.trim(),
      confidence: newFindingConfidence,
      takeaway: newFindingTakeaway.trim() || undefined,
    };
    onChange({
      ...state,
      findings: [...findings, newFinding],
      updatedAt: new Date().toISOString(),
    });
    setNewFindingTopic('');
    setNewFindingInsight('');
    setNewFindingTakeaway('');
    setShowAddFindingModal(false);
  };

  const handleDeleteFinding = (id: string) => {
    onChange({
      ...state,
      findings: findings.filter(f => f.id !== id),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleAddQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuestionText.trim()) return;
    const newQ: ResearchQuestion = {
      id: `q-${Date.now().toString(36)}`,
      question: newQuestionText.trim(),
      status: 'open',
    };
    onChange({
      ...state,
      questions: [...questions, newQ],
      updatedAt: new Date().toISOString(),
    });
    setNewQuestionText('');
    setShowAddQuestionModal(false);
  };

  const handleToggleQuestionStatus = (id: string, newStatus: 'open' | 'investigating' | 'resolved') => {
    onChange({
      ...state,
      questions: questions.map(q => q.id === id ? { ...q, status: newStatus } : q),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleDeleteQuestion = (id: string) => {
    onChange({
      ...state,
      questions: questions.filter(q => q.id !== id),
      updatedAt: new Date().toISOString(),
    });
  };

  const exportMarkdownReport = () => {
    const report = `# Research Report: ${state.topicTitle || 'Technical Analysis'}
**Framework**: ${state.framework || 'Technical'}
**Date**: ${new Date().toLocaleDateString()}
**Hypothesis**: ${state.hypothesis}

---

## 1. Living Research Document
${state.documentMarkdown}

---

## 2. Key Findings & Evidence Register (${findings.length} findings)
| ID | Topic | Key Insight | Confidence | Takeaway |
|---|---|---|---|---|
${findings.map(f => `| **${f.id}** | ${f.topic} | ${f.insight} | \`${f.confidence}\` | ${f.takeaway || 'N/A'} |`).join('\n')}

---

## 3. Research Questions & Status
${questions.map(q => `- [${q.status === 'resolved' ? 'x' : ' '}] **${q.question}** (${q.status})${q.findings ? `\n  - *Findings*: ${q.findings}` : ''}`).join('\n')}
`;

    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research-report-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredFindings = findings.filter(f => {
    if (confidenceFilter !== 'all' && f.confidence !== confidenceFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        f.id.toLowerCase().includes(q) ||
        f.topic.toLowerCase().includes(q) ||
        f.insight.toLowerCase().includes(q) ||
        (f.takeaway || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="threat-model-canvas research-studio-canvas">
      {/* Top Bar */}
      <div className="tm-topbar">
        <div className="tm-topbar-info">
          <div className="tm-badge-group">
            <span className="tm-framework-badge" style={{ color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.4)' }}>
              🔬 RESEARCH STUDIO ({state.framework ? state.framework.toUpperCase() : 'TECHNICAL'})
            </span>
            <span className="tm-threats-badge">
              {findings.length} Findings · {resolvedQuestionsCount}/{questions.length} Questions Resolved
            </span>
          </div>
          <h2 className="tm-title">{state.topicTitle || 'Technical Research Topic'}</h2>
        </div>

        <div className="tm-topbar-actions">
          <button onClick={() => setShowAddFindingModal(true)} className="tm-btn secondary" title="Add Key Finding">
            <FiPlus size={13} /> Finding
          </button>
          <button onClick={() => setShowAddQuestionModal(true)} className="tm-btn secondary" title="Add Question">
            <FiPlus size={13} /> Question
          </button>
          <button onClick={exportMarkdownReport} className="tm-btn primary" title="Export Markdown Report">
            <FiDownload size={13} /> Export Report
          </button>
        </div>
      </div>

      {/* Nav Tabs */}
      <div className="tm-nav-tabs">
        <button
          className={`tm-tab-btn ${activeTab === 'doc' ? 'active' : ''}`}
          onClick={() => setActiveTab('doc')}
        >
          <FiFileText size={14} /> Living Research Doc
        </button>
        <button
          className={`tm-tab-btn ${activeTab === 'findings' ? 'active' : ''}`}
          onClick={() => setActiveTab('findings')}
        >
          <FiBookOpen size={14} /> Key Findings ({findings.length})
        </button>
        <button
          className={`tm-tab-btn ${activeTab === 'questions' ? 'active' : ''}`}
          onClick={() => setActiveTab('questions')}
        >
          <FiHelpCircle size={14} /> Questions ({resolvedQuestionsCount}/{questions.length})
        </button>
        <button
          className={`tm-tab-btn ${activeTab === 'diagram' ? 'active' : ''}`}
          onClick={() => setActiveTab('diagram')}
        >
          <FiLayers size={14} /> Architecture / Matrix Diagram
        </button>
      </div>

      {/* Main Content Body */}
      <div className="tm-body">
        {/* TAB 1: LIVING RESEARCH DOC */}
        {activeTab === 'doc' && (
          <div className="research-doc-view">
            <div className="tm-diagram-card">
              <div className="tm-card-header">
                <div>
                  <span className="tm-card-title">Living Research Document</span>
                  <span className="tm-card-hint">Updated automatically by AI as questions are investigated</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    className="tm-btn secondary sm"
                    onClick={() =>
                      onSendPrompt(
                        `Please synthesize our findings and update the living research document for "${state.topicTitle}". Format with clear sections, evidence, and actionable conclusions.`
                      )
                    }
                  >
                    ✨ Synthesize with AI
                  </button>
                  {isEditingDoc ? (
                    <button className="tm-btn primary sm" onClick={handleSaveDoc}>
                      <FiCheck size={12} /> Save Doc
                    </button>
                  ) : (
                    <button
                      className="tm-btn secondary sm"
                      onClick={() => {
                        setDocContent(state.documentMarkdown);
                        setIsEditingDoc(true);
                      }}
                    >
                      <FiEdit3 size={12} /> Edit Markdown
                    </button>
                  )}
                </div>
              </div>

              <div className="research-doc-content-wrap">
                {isEditingDoc ? (
                  <textarea
                    value={docContent}
                    onChange={e => setDocContent(e.target.value)}
                    className="research-doc-editor"
                    placeholder="Enter research markdown..."
                  />
                ) : (
                  <div
                    className="research-doc-rendered markdown-body"
                    dangerouslySetInnerHTML={{
                      __html: marked.parse(state.documentMarkdown || '*No content generated yet.*') as string,
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: FINDINGS REGISTER */}
        {activeTab === 'findings' && (
          <div className="tm-threats-view">
            <div className="tm-filters-bar">
              <div className="tm-search-box">
                <FiSearch size={14} className="tm-search-icon" />
                <input
                  type="text"
                  placeholder="Search findings, topics, or takeaways..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="tm-search-input"
                />
              </div>

              <div className="tm-filter-group">
                <span className="tm-filter-label"><FiFilter size={12} /> Confidence:</span>
                <select
                  value={confidenceFilter}
                  onChange={e => setConfidenceFilter(e.target.value)}
                  className="tm-select"
                >
                  <option value="all">All Levels</option>
                  <option value="High">High Confidence</option>
                  <option value="Medium">Medium Confidence</option>
                  <option value="Low">Low Confidence</option>
                </select>
              </div>
            </div>

            {filteredFindings.length === 0 ? (
              <div className="tm-empty-state">
                <FiBookOpen size={36} className="tm-empty-icon" />
                <h4>No research findings recorded yet</h4>
                <p>Ask the AI in chat to investigate a topic or click below to start a deep-dive.</p>
                <button
                  className="tm-btn primary"
                  onClick={() => onSendPrompt(`Conduct a deep technical analysis on "${state.topicTitle}" and extract 3 high-confidence findings with supporting evidence.`)}
                >
                  ⚡ Start AI Investigation
                </button>
              </div>
            ) : (
              <div className="tm-threats-list">
                {filteredFindings.map(f => (
                  <div key={f.id} className="tm-threat-card" style={{ borderLeft: `3px solid ${f.confidence === 'High' ? '#10b981' : f.confidence === 'Medium' ? '#f59e0b' : '#38bdf8'}` }}>
                    <div className="tm-threat-header">
                      <div className="tm-threat-id-wrap">
                        <span className="tm-threat-id">{f.id}</span>
                        <span className="tm-cat-badge">{f.topic}</span>
                        <span className={`tm-sev-badge ${f.confidence === 'High' ? 'low' : f.confidence === 'Medium' ? 'medium' : 'high'}`}>
                          {f.confidence} Confidence
                        </span>
                      </div>
                      <button onClick={() => handleDeleteFinding(f.id)} className="tm-delete-btn" title="Delete Finding">
                        <FiTrash2 size={13} />
                      </button>
                    </div>
                    <p className="tm-threat-desc" style={{ fontWeight: 600, color: '#f8fafc' }}>{f.insight}</p>
                    {f.takeaway && (
                      <div className="tm-mitigation-box">
                        <div className="tm-mitigation-head">
                          <FiCheckCircle size={12} /> Actionable Takeaway:
                        </div>
                        <p>{f.takeaway}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: QUESTIONS TRACKER */}
        {activeTab === 'questions' && (
          <div className="research-questions-view">
            <div className="tm-section-header">
              <h3>Core Research Questions ({questions.length})</h3>
              <span className="tm-hint">Click "Investigate with AI" to execute targeted research on any topic</span>
            </div>

            <div className="research-questions-list">
              {questions.map((q, idx) => (
                <div key={q.id} className={`research-q-card ${q.status}`}>
                  <div className="research-q-head">
                    <div className="research-q-num">Q{idx + 1}</div>
                    <div className="research-q-text">{q.question}</div>
                    <div className="research-q-actions">
                      <select
                        value={q.status}
                        onChange={e => handleToggleQuestionStatus(q.id, e.target.value as any)}
                        className={`tm-status-select ${q.status === 'resolved' ? 'mitigated' : q.status === 'investigating' ? 'accepted' : 'open'}`}
                      >
                        <option value="open">Open</option>
                        <option value="investigating">Investigating</option>
                        <option value="resolved">✓ Resolved</option>
                      </select>
                      <button onClick={() => handleDeleteQuestion(q.id)} className="tm-delete-btn">
                        <FiTrash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {q.findings && (
                    <div className="research-q-findings">
                      <span className="findings-label">Synthesized Resolution:</span>
                      <p>{q.findings}</p>
                    </div>
                  )}

                  <div className="research-q-footer">
                    <button
                      className="tm-btn secondary sm"
                      onClick={() => onSendPrompt(`Deep-dive research question: "${q.question}". Analyze technical tradeoffs, performance profiles, and concrete findings.`)}
                    >
                      ⚡ Investigate with AI
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: DIAGRAM / MATRIX */}
        {activeTab === 'diagram' && (
          <div className="tm-dfd-view">
            <div className="tm-diagram-card">
              <div className="tm-card-header">
                <div>
                  <span className="tm-card-title">Architecture & Evaluation Matrix Diagram</span>
                  <span className="tm-card-hint">Live editable Mermaid diagram</span>
                </div>
                <button
                  className="tm-btn secondary sm"
                  onClick={() =>
                    onSendPrompt(
                      `Please update and synchronize the Mermaid comparison diagram to illustrate the technical architecture, evaluation matrix, or tradeoff dimensions for "${state.topicTitle}".`
                    )
                  }
                >
                  ✨ AI Redraw Diagram
                </button>
              </div>
              <div className="tm-diagram-container">
                <MermaidViewer
                  code={state.diagramMermaid || 'graph TD\n  Start --> Next'}
                  editable={true}
                  onChangeCode={(newCode) => onChange({ ...state, diagramMermaid: newCode, updatedAt: new Date().toISOString() })}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Add Finding */}
      {showAddFindingModal && (
        <div className="tm-modal-overlay" onClick={() => setShowAddFindingModal(false)}>
          <div className="tm-modal" onClick={e => e.stopPropagation()}>
            <h3>Record Research Finding</h3>
            <form onSubmit={handleAddFinding}>
              <div className="tm-form-field">
                <label>Topic / Domain</label>
                <input
                  type="text"
                  placeholder="e.g. Memory Layout, Latency, Concurrency"
                  value={newFindingTopic}
                  onChange={e => setNewFindingTopic(e.target.value)}
                  required
                />
              </div>
              <div className="tm-form-field">
                <label>Key Finding / Insight</label>
                <textarea
                  rows={3}
                  placeholder="Describe the technical insight..."
                  value={newFindingInsight}
                  onChange={e => setNewFindingInsight(e.target.value)}
                  required
                />
              </div>
              <div className="tm-form-field">
                <label>Confidence Level</label>
                <select value={newFindingConfidence} onChange={e => setNewFindingConfidence(e.target.value as any)}>
                  <option value="High">High Confidence (Proven / Measured)</option>
                  <option value="Medium">Medium Confidence (Hypothesis / Literature)</option>
                  <option value="Low">Low Confidence (Theoretical / Speculative)</option>
                </select>
              </div>
              <div className="tm-form-field">
                <label>Actionable Takeaway (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Adopt arena allocation for message payloads"
                  value={newFindingTakeaway}
                  onChange={e => setNewFindingTakeaway(e.target.value)}
                />
              </div>
              <div className="tm-modal-actions">
                <button type="button" onClick={() => setShowAddFindingModal(false)} className="tm-btn secondary">Cancel</button>
                <button type="submit" className="tm-btn primary">Add Finding</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Question */}
      {showAddQuestionModal && (
        <div className="tm-modal-overlay" onClick={() => setShowAddQuestionModal(false)}>
          <div className="tm-modal" onClick={e => e.stopPropagation()}>
            <h3>Add Research Question</h3>
            <form onSubmit={handleAddQuestion}>
              <div className="tm-form-field">
                <label>Research Question</label>
                <input
                  type="text"
                  placeholder="e.g. What is the cache eviction overhead under high write volume?"
                  value={newQuestionText}
                  onChange={e => setNewQuestionText(e.target.value)}
                  required
                />
              </div>
              <div className="tm-modal-actions">
                <button type="button" onClick={() => setShowAddQuestionModal(false)} className="tm-btn secondary">Cancel</button>
                <button type="submit" className="tm-btn primary">Add Question</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
