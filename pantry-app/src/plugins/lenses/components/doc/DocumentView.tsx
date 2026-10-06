import React, { useState, useMemo } from 'react';
import { marked } from 'marked';
import {
  FiEdit2,
  FiEye,
  FiColumns,
  FiZap,
  FiCopy,
  FiDownload,
  FiCheck,
  FiFileText,
  FiRefreshCw
} from 'react-icons/fi';
import type { LensState } from '../../types';
import { useApp } from '@/context/AppContext';

interface Props {
  state: LensState;
  onChange: (newState: LensState) => void;
  onSendPrompt: (prompt: string) => void;
}

export default function DocumentView({ state, onChange, onSendPrompt }: Props) {
  const { state: appState } = useApp();
  const isDark = (appState?.theme || state.theme || 'dark') === 'dark';
  const [viewMode, setViewMode] = useState<'split' | 'edit' | 'preview'>('split');
  const [copied, setCopied] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);

  // Markdown content
  const content = state.documentMarkdown || '';

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange({
      ...state,
      documentMarkdown: e.target.value,
      updatedAt: new Date().toISOString(),
    });
  };

  // Synthesize structured document from current topology, boundaries, and cards
  const synthesizeFromCanvasAndCards = () => {
    setIsSynthesizing(true);
    setTimeout(() => {
      const now = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });

      // Group components by boundary
      const boundaryMap = new Map<string, string>();
      state.boundaries.forEach(b => {
        b.componentIds.forEach(cId => boundaryMap.set(cId, b.title));
      });

      const synthesized = `# Architecture Decision Record & System Specification
**Preset Lens:** ${state.title || 'Architecture Decision (ADR)'}  
**Last Updated:** ${now}  
**Topology Summary:** ${state.components.length} Components, ${state.connections.length} Directed Wires, ${state.boundaries.length} Boundaries  
**Security & Governance:** ${state.threats.length} Threats, ${state.decisions.length} Decisions (ADRs), ${state.invariants.length} System Invariants  

---

## 1. Executive Summary
This document synthesizes the architectural topology, security threat assessments, architectural decisions (ADRs), and formal invariants defined within the **${state.title}** canvas. It establishes the verifiable design contract and risk boundary model for the distributed system.

---

## 2. Network Perimeters & Trust Boundaries

The system is partitioned across **${state.boundaries.length}** distinct security and networking perimeters:

${state.boundaries.map((b, idx) => `
### 2.${idx + 1} ${b.title} ${b.subtitle || ''}
- **Boundary ID:** \`${b.id}\`
- **Isolation Scope:** ${b.subtitle ? b.subtitle.replace(/^•\s*/, '') : 'Network boundary perimeter'}
- **Enclosed Components:** ${b.componentIds.map(id => {
    const comp = state.components.find(c => c.id === id);
    return comp ? `\`${comp.name}\`` : `\`${id}\``;
  }).join(', ') || '*(No components assigned)*'}
`).join('\n')}

---

## 3. Component Inventory & Topologies

| Component | Category | Type | Enclosing Boundary | Active Threats |
| :--- | :--- | :--- | :--- | :---: |
${state.components.map(c => {
  const boundary = state.boundaries.find(b => b.componentIds.includes(c.id));
  return `| **${c.name}** | \`${c.category}\` | ${c.type} | ${boundary ? boundary.title : '*Unbounded*'} | ${c.threatCount ? `🔴 ${c.threatCount}` : '🟢 None'} |`;
}).join('\n')}

---

## 4. Directed Communication & Data Flow Matrix

The inter-service message bus and wire connections enforce the following directional protocols:

| Source | Flow / Protocol | Target | Wire Style |
| :--- | :---: | :--- | :--- |
${state.connections.map(conn => {
  const src = state.components.find(c => c.id === conn.from)?.name || conn.from;
  const dst = state.components.find(c => c.id === conn.to)?.name || conn.to;
  return `| **${src}** | \`${conn.label || 'connects'}\` | **${dst}** | ${conn.style || 'solid'} |`;
}).join('\n')}

---

## 5. Security Threat Register (STRIDE Analysis)

The threat register tracks **${state.threats.length}** identified vulnerabilities across the architecture:

| ID | Title | Component Target | Severity | Status | Attack Vector | Mitigation / Linked ADR |
| :---: | :--- | :--- | :---: | :---: | :--- | :--- |
${state.threats.map(t => {
  return `| **${t.id}** | ${t.title} | ${t.componentName || t.componentId || 'System Wide'} | **${t.severity}** | \`${t.status}\` | ${t.attackVector || t.category} | ${t.mitigation || (t.linkedAdrId ? `Ref: [${t.linkedAdrId}]` : 'Pending Review')} |`;
}).join('\n')}

---

## 6. Architecture Decision Records (ADRs)

${state.decisions.map(d => `
### ${d.id}: ${d.title}
- **Status:** **\`${d.status}\`**
- **Associated Target:** ${d.componentName || d.componentId || 'Platform-wide'}
- **Approach:**
  ${d.approach}
- **Rationale:**
  ${d.rationale}
${d.alternatives ? `- **Alternatives Considered:**\n  ${d.alternatives}` : ''}
${d.tradeoffs ? `- **Trade-offs & Constraints:**\n  ${d.tradeoffs}` : ''}
`).join('\n')}

---

## 7. Formal System Invariants & Guarantees

The following **${state.invariants.length}** formal invariants represent non-negotiable guarantees verified during runtime:

${state.invariants.map(inv => `
- **[${inv.id}] ${inv.title}** (\`${inv.status}\`)
  > ${inv.statement}
  *Category:* ${inv.category}
`).join('\n')}

---

## 8. Synthesis Notes & Next Review Actions
- Verified against topological canvas elements.
- Ensure all open threats marked **High** or **Critical** have corresponding ADR approvals.
- Run automated contract tests against the declared invariants.
`;

      onChange({
        ...state,
        documentMarkdown: synthesized,
        updatedAt: new Date().toISOString(),
      });
      setIsSynthesizing(false);
    }, 250);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${(state.title || 'architecture_spec').toLowerCase().replace(/\s+/g, '_')}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderedHtml = useMemo(() => {
    try {
      return marked.parse(content || '*No content available. Click Synthesize or type markdown.*') as string;
    } catch {
      return '<p>Error rendering markdown.</p>';
    }
  }, [content]);

  const stats = useMemo(() => {
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const lines = content ? content.split('\n').length : 0;
    return { words, lines };
  }, [content]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      backgroundColor: isDark ? '#0f141c' : '#f8fafc',
      color: isDark ? '#e2e8f0' : '#0f172a',
      overflow: 'hidden',
    }}>
      {/* Sub-header Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 18px',
        backgroundColor: isDark ? '#141a24' : '#ffffff',
        borderBottom: `1px solid ${isDark ? '#1e2638' : '#e2e8f0'}`,
        fontSize: '13px',
      }}>
        {/* Left: Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={synthesizeFromCanvasAndCards}
            disabled={isSynthesizing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 13px',
              borderRadius: '7px',
              border: '1px solid #3b82f6',
              backgroundColor: '#1d4ed8',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: '12px',
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              transition: 'all 0.15s ease',
            }}
            title="Automatically reconstruct the document specification by aggregating all canvas components, boundaries, wires, threats, and ADR cards."
          >
            {isSynthesizing ? <FiRefreshCw className="animate-spin" size={13} /> : <FiZap size={13} />}
            <span>Synthesize from Drawing & Cards</span>
          </button>

          <button
            onClick={() => onSendPrompt(`Review the current Architecture Document for completeness, potential gaps in threat coverage, and consistency with invariants:\n\n${content.slice(0, 2000)}`)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '7px',
              border: `1px solid ${isDark ? '#2a354c' : '#cbd5e1'}`,
              backgroundColor: isDark ? '#192233' : '#f1f5f9',
              color: isDark ? '#94a3b8' : '#475569',
              fontWeight: 500,
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            <FiZap size={13} style={{ color: '#818cf8' }} />
            <span>AI Review Spec</span>
          </button>

          <div style={{ fontSize: '11px', color: isDark ? '#64748b' : '#94a3b8', marginLeft: '6px' }}>
            {stats.words} words • {stats.lines} lines
          </div>
        </div>

        {/* Right: View Toggles & Export */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: isDark ? '#0a0d14' : '#f1f5f9',
            borderRadius: '6px',
            padding: '2px',
            border: `1px solid ${isDark ? '#1e2638' : '#e2e8f0'}`,
          }}>
            <button
              onClick={() => setViewMode('edit')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '5px',
                border: 'none',
                backgroundColor: viewMode === 'edit' ? '#2563eb' : 'transparent',
                color: viewMode === 'edit' ? '#ffffff' : (isDark ? '#94a3b8' : '#64748b'),
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <FiEdit2 size={11} />
              <span>Edit</span>
            </button>
            <button
              onClick={() => setViewMode('split')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '5px',
                border: 'none',
                backgroundColor: viewMode === 'split' ? '#2563eb' : 'transparent',
                color: viewMode === 'split' ? '#ffffff' : (isDark ? '#94a3b8' : '#64748b'),
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <FiColumns size={11} />
              <span>Split</span>
            </button>
            <button
              onClick={() => setViewMode('preview')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '5px',
                border: 'none',
                backgroundColor: viewMode === 'preview' ? '#2563eb' : 'transparent',
                color: viewMode === 'preview' ? '#ffffff' : (isDark ? '#94a3b8' : '#64748b'),
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <FiEye size={11} />
              <span>Preview</span>
            </button>
          </div>

          <div style={{ width: '1px', height: '18px', backgroundColor: isDark ? '#2a354c' : '#e2e8f0', margin: '0 4px' }} />

          <button
            onClick={handleCopy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 10px',
              borderRadius: '6px',
              border: `1px solid ${isDark ? '#2a354c' : '#cbd5e1'}`,
              backgroundColor: isDark ? '#192233' : '#ffffff',
              color: isDark ? '#cbd5e1' : '#334155',
              fontSize: '11px',
              cursor: 'pointer',
            }}
            title="Copy document markdown to clipboard"
          >
            {copied ? <FiCheck size={12} style={{ color: '#10b981' }} /> : <FiCopy size={12} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            onClick={handleDownload}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 10px',
              borderRadius: '6px',
              border: `1px solid ${isDark ? '#2a354c' : '#cbd5e1'}`,
              backgroundColor: isDark ? '#192233' : '#ffffff',
              color: isDark ? '#cbd5e1' : '#334155',
              fontSize: '11px',
              cursor: 'pointer',
            }}
            title="Download document as .md file"
          >
            <FiDownload size={12} />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}>
        {/* Editor Pane */}
        {(viewMode === 'edit' || viewMode === 'split') && (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            borderRight: viewMode === 'split' ? `1px solid ${isDark ? '#1e2638' : '#e2e8f0'}` : 'none',
            backgroundColor: isDark ? '#0a0d14' : '#ffffff',
            overflow: 'hidden',
          }}>
            <textarea
              value={content}
              onChange={handleContentChange}
              placeholder="Write or synthesize architecture document markdown here..."
              style={{
                flex: 1,
                width: '100%',
                padding: '24px 28px',
                border: 'none',
                outline: 'none',
                resize: 'none',
                backgroundColor: 'transparent',
                color: isDark ? '#e2e8f0' : '#0f172a',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '13px',
                lineHeight: 1.7,
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}

        {/* Markdown Preview Pane */}
        {(viewMode === 'preview' || viewMode === 'split') && (
          <div style={{
            flex: 1,
            padding: '28px 36px',
            backgroundColor: isDark ? '#0d1117' : '#f8fafc',
            overflowY: 'auto',
            boxSizing: 'border-box',
          }}>
            <div
              className="lenses-doc-preview"
              style={{
                maxWidth: '850px',
                margin: '0 auto',
                lineHeight: 1.65,
                fontSize: '13.5px',
                color: isDark ? '#cbd5e1' : '#334155',
              }}
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          </div>
        )}
      </div>

      <style>{`
        .lenses-doc-preview h1 {
          font-size: 22px;
          font-weight: 700;
          color: ${isDark ? '#f8fafc' : '#0f172a'};
          border-bottom: 1px solid ${isDark ? '#1e293b' : '#e2e8f0'};
          padding-bottom: 10px;
          margin-top: 0;
          margin-bottom: 16px;
        }
        .lenses-doc-preview h2 {
          font-size: 17px;
          font-weight: 600;
          color: ${isDark ? '#f1f5f9' : '#1e293b'};
          border-bottom: 1px solid ${isDark ? '#1e293b' : '#e2e8f0'};
          padding-bottom: 6px;
          margin-top: 28px;
          margin-bottom: 14px;
        }
        .lenses-doc-preview h3 {
          font-size: 14.5px;
          font-weight: 600;
          color: ${isDark ? '#e2e8f0' : '#334155'};
          margin-top: 20px;
          margin-bottom: 10px;
        }
        .lenses-doc-preview p {
          margin-bottom: 14px;
        }
        .lenses-doc-preview table {
          width: 100%;
          border-collapse: collapse;
          margin: 16px 0;
          font-size: 12.5px;
        }
        .lenses-doc-preview th, .lenses-doc-preview td {
          border: 1px solid ${isDark ? '#243048' : '#e2e8f0'};
          padding: 8px 12px;
          text-align: left;
        }
        .lenses-doc-preview th {
          background-color: ${isDark ? '#162032' : '#f1f5f9'};
          color: ${isDark ? '#94a3b8' : '#475569'};
          font-weight: 600;
        }
        .lenses-doc-preview tr:nth-child(even) {
          background-color: ${isDark ? '#0f1623' : '#ffffff'};
        }
        .lenses-doc-preview code {
          background-color: ${isDark ? '#1e293b' : '#e2e8f0'};
          padding: 2px 5px;
          border-radius: 4px;
          font-size: 11.5px;
          color: ${isDark ? '#93c5fd' : '#2563eb'};
          font-family: ui-monospace, Menlo, Monaco, monospace;
        }
        .lenses-doc-preview blockquote {
          border-left: 3px solid #3b82f6;
          margin: 12px 0;
          padding: 6px 14px;
          background-color: ${isDark ? '#101c2e' : '#eff6ff'};
          border-radius: 0 6px 6px 0;
          color: ${isDark ? '#93c5fd' : '#1d4ed8'};
          font-size: 12.5px;
        }
        .lenses-doc-preview ul, .lenses-doc-preview ol {
          padding-left: 22px;
          margin-bottom: 14px;
        }
        .lenses-doc-preview li {
          margin-bottom: 5px;
        }
        .lenses-doc-preview hr {
          border: none;
          border-top: 1px solid ${isDark ? '#1e293b' : '#e2e8f0'};
          margin: 24px 0;
        }
      `}</style>
    </div>
  );
}
