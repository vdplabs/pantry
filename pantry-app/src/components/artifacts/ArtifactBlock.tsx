import React, { useState } from 'react';
import { FiCopy, FiCheck, FiCode, FiSidebar, FiTerminal } from 'react-icons/fi';
import hljs from 'highlight.js';
import MermaidViewer from './MermaidViewer';
import LiveHtmlPreview from './LiveHtmlPreview';

interface Props {
  code: string;
  language?: string;
  onOpenCanvas?: (code: string, type: string) => void;
}

export default function ArtifactBlock({ code, language = '', onOpenCanvas }: Props) {
  const [copied, setCopied] = useState(false);
  const cleanLang = (language || '').trim().toLowerCase();

  // 1. Mermaid Diagram
  if (cleanLang === 'mermaid' || code.trim().startsWith('graph ') || code.trim().startsWith('flowchart ') || code.trim().startsWith('sequenceDiagram')) {
    return <MermaidViewer code={code} onOpenCanvas={onOpenCanvas ? (c, t) => onOpenCanvas(c, t) : undefined} />;
  }

  // 2. HTML / Interactive SVG Live App
  const isHtml = cleanLang === 'html' || cleanLang === 'svg' || (cleanLang === 'xml' && code.includes('<svg'));
  const looksLikeInteractiveWeb = isHtml || (
    cleanLang === '' && (code.includes('<!DOCTYPE html>') || (code.includes('<div') && code.includes('</div>')))
  );

  if (looksLikeInteractiveWeb && (code.includes('<html') || code.includes('<svg') || code.includes('<button') || code.includes('<style>') || code.includes('<script>'))) {
    return <LiveHtmlPreview code={code} language={cleanLang || 'html'} onOpenCanvas={onOpenCanvas ? (c, t) => onOpenCanvas(c, t) : undefined} />;
  }

  // 3. Standard Code Block with syntax highlighting and workbench integration
  const validLang = cleanLang && hljs.getLanguage(cleanLang) ? cleanLang : null;
  const displayLang = cleanLang || 'code';
  let highlighted = '';
  try {
    if (validLang) {
      highlighted = hljs.highlight(code, { language: validLang, ignoreIllegals: true }).value;
    } else {
      const autoRes = hljs.highlightAuto(code);
      highlighted = autoRes.value || code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  } catch {
    highlighted = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const lineCount = code.trim().split('\n').length;

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="code-lang">{displayLang}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={handleCopy} className="code-copy-btn">
            {copied ? <FiCheck size={12} color="var(--accent-emerald)" /> : <FiCopy size={12} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {onOpenCanvas && (
            <button
              onClick={() => onOpenCanvas(code, cleanLang || 'code')}
              className="code-canvas-btn"
              title="Open in split-screen Canvas Workbench"
            >
              <FiSidebar size={12} />
              <span>Canvas</span>
            </button>
          )}
        </div>
      </div>

      <pre style={{ margin: 0 }}>
        <code
          className={`hljs language-${validLang || 'plaintext'}`}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}
