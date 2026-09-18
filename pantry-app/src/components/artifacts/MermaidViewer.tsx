import React, { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import hljs from 'highlight.js';
import {
  FiZoomIn, FiZoomOut, FiMaximize2, FiDownload, FiCopy, FiCheck,
  FiRefreshCw, FiCode, FiEye, FiSliders, FiSidebar, FiZap, FiAlertCircle
} from 'react-icons/fi';
import { sanitizeMermaidCode } from './mermaidSanitizer';

interface Props {
  code: string;
  onOpenCanvas?: (code: string, type: 'mermaid') => void;
  inline?: boolean;
}

// Configure mermaid with Pantry dark neon theme
mermaid.initialize({
  startOnLoad: false,
  suppressErrorRendering: true,
  theme: 'base',
  securityLevel: 'loose',
  fontFamily: 'Outfit, system-ui, sans-serif',
  themeVariables: {
    darkMode: true,
    background: '#090e18',
    mainBkg: '#111827',
    textColor: '#f1f5f9',
    primaryColor: '#312e81',
    primaryTextColor: '#e0e7ff',
    primaryBorderColor: '#6366f1',
    lineColor: '#38bdf8',
    secondaryColor: '#1e293b',
    tertiaryColor: '#0f172a',
    nodeBorder: '#6366f1',
    clusterBkg: '#0d1527',
    clusterBorder: '#3b82f6',
    defaultLinkColor: '#38bdf8',
    titleColor: '#f8fafc',
    edgeLabelBackground: '#0b1120',
    actorBkg: '#1e1b4b',
    actorBorder: '#6366f1',
    actorTextColor: '#e0e7ff',
    actorLineColor: '#818cf8',
    signalColor: '#38bdf8',
    signalTextColor: '#e0e7ff',
    labelBoxBkgColor: '#1e293b',
    labelBoxBorderColor: '#6366f1',
    labelTextColor: '#f8fafc',
    loopTextColor: '#e0e7ff',
    noteBorderColor: '#eab308',
    noteBkgColor: '#1e1b4b',
    noteTextColor: '#fef08a',
  },
});

function MermaidViewerComponent({ code, onOpenCanvas, inline = true }: Props) {
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isAutoRepaired, setIsAutoRepaired] = useState(false);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'diagram' | 'code'>('diagram');

  const containerRef = useRef<HTMLDivElement>(null);
  const lastRenderedCodeRef = useRef<string>('');
  const renderTimeoutRef = useRef<any>(null);
  const renderSeqRef = useRef<number>(0);

  const renderDiagram = useCallback(async () => {
    const trimmed = (code || '').trim();
    if (!trimmed) return;
    if (trimmed === lastRenderedCodeRef.current && svgContent) return;

    const currentSeq = ++renderSeqRef.current;

    const validateAndRender = async () => {
      setError(null);
      let targetCode = trimmed;
      let repaired = false;

      // 1. Try parsing raw code first
      try {
        await mermaid.parse(targetCode);
      } catch {
        // 2. If raw fails, try sanitized code
        const sanitized = sanitizeMermaidCode(targetCode);
        if (sanitized && sanitized !== targetCode) {
          try {
            await mermaid.parse(sanitized);
            targetCode = sanitized;
            repaired = true;
          } catch {}
        }
      }

      try {
        const id = `mermaid-render-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const { svg } = await mermaid.render(id, targetCode);

        if (renderSeqRef.current !== currentSeq) return;
        setSvgContent(svg);
        setIsAutoRepaired(repaired);
        lastRenderedCodeRef.current = trimmed;
        setError(null);
      } catch (err: any) {
        if (renderSeqRef.current !== currentSeq) return;
        console.warn('[MermaidViewer] render error:', err);
        const rawMsg = err?.message || 'Invalid Mermaid syntax';
        let cleanMsg = rawMsg;
        if (rawMsg.includes('firstChild') || rawMsg.includes('null')) {
          cleanMsg = 'Mermaid syntax requires repair. Click below to auto-fix.';
        } else {
          cleanMsg = rawMsg.replace(/Parse error on line \d+:/g, (m: string) => m.trim());
        }
        setError(cleanMsg);
      }
    };

    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }
    renderTimeoutRef.current = setTimeout(validateAndRender, 120);
  }, [code, svgContent]);

  useEffect(() => {
    renderDiagram();
    return () => {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [renderDiagram]);

  const handleZoomIn = () => setZoom(z => Math.min(z + 0.2, 3));
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.2, 0.4));
  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSvg = () => {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diagram-${Date.now()}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPng = () => {
    if (!svgContent) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      canvas.width = (img.width || 800) * 2;
      canvas.height = (img.height || 600) * 2;
      if (ctx) {
        ctx.fillStyle = '#090e18';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const pngUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = `diagram-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return (
    <div className={`mermaid-artifact-card ${inline ? 'inline' : 'standalone'}`}>
      {/* Header Toolbar */}
      <div className="artifact-toolbar">
        <div className="artifact-toolbar-left">
          <div className="artifact-badge mermaid">
            <span className="badge-dot" />
            <span>Mermaid Diagram</span>
          </div>
          {isAutoRepaired && (
            <div className="artifact-auto-badge" title="Syntax was automatically sanitized for rendering">
              <FiZap size={11} />
              <span>Auto-Repaired</span>
            </div>
          )}
          <div className="artifact-tab-group">
            <button
              className={`artifact-tab-btn ${viewMode === 'diagram' ? 'active' : ''}`}
              onClick={() => setViewMode('diagram')}
            >
              <FiEye size={12} /> Preview
            </button>
            <button
              className={`artifact-tab-btn ${viewMode === 'code' ? 'active' : ''}`}
              onClick={() => setViewMode('code')}
            >
              <FiCode size={12} /> Code
            </button>
          </div>
        </div>

        <div className="artifact-toolbar-right">
          {viewMode === 'diagram' && !error && (
            <>
              <button onClick={handleZoomOut} className="artifact-tool-btn" title="Zoom Out">
                <FiZoomOut size={13} />
              </button>
              <span className="artifact-zoom-text">{Math.round(zoom * 100)}%</span>
              <button onClick={handleZoomIn} className="artifact-tool-btn" title="Zoom In">
                <FiZoomIn size={13} />
              </button>
              <button onClick={handleResetZoom} className="artifact-tool-btn" title="Reset Zoom">
                <FiRefreshCw size={12} />
              </button>
              <button onClick={handleDownloadSvg} className="artifact-tool-btn" title="Export as SVG">
                <FiDownload size={12} /> SVG
              </button>
              <button onClick={handleDownloadPng} className="artifact-tool-btn" title="Export as PNG">
                <FiDownload size={12} /> PNG
              </button>
            </>
          )}

          <button onClick={handleCopyCode} className="artifact-tool-btn" title="Copy Mermaid code">
            {copied ? <FiCheck size={13} color="var(--accent-emerald)" /> : <FiCopy size={13} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {onOpenCanvas && (
            <button
              onClick={() => onOpenCanvas(code, 'mermaid')}
              className="artifact-canvas-btn"
              title="Open in split-screen Canvas Workbench"
            >
              <FiSidebar size={13} />
              <span>Canvas</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === 'diagram' ? (
        <div
          ref={containerRef}
          className="mermaid-viewport"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          {error ? (
            <div className="mermaid-error-box">
              <div className="error-title">
                <FiAlertCircle size={16} /> Unable to render diagram
              </div>
              <div className="error-msg">{error}</div>
              <div className="error-actions">
                <button
                  onClick={() => {
                    const repaired = sanitizeMermaidCode(code);
                    if (onOpenCanvas) {
                      onOpenCanvas(repaired, 'mermaid');
                    } else {
                      setViewMode('code');
                    }
                  }}
                  className="error-repair-btn"
                >
                  <FiZap size={13} /> Open & Fix in Canvas
                </button>
                <button onClick={() => setViewMode('code')} className="error-fallback-btn">
                  <FiCode size={13} /> View Raw Code
                </button>
              </div>
            </div>
          ) : svgContent ? (
            <div
              className="mermaid-svg-wrapper"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 0.15s ease-out',
              }}
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
          ) : (
            <div className="mermaid-loading">
              <FiRefreshCw className="spinning" size={24} />
              <span>Rendering diagram...</span>
            </div>
          )}
        </div>
      ) : (
        <pre className="mermaid-code-view">
          <code
            className="hljs language-mermaid"
            dangerouslySetInnerHTML={{
              __html: (() => {
                try {
                  const validLang = hljs.getLanguage('mermaid') ? 'mermaid' : null;
                  if (validLang) {
                    return hljs.highlight(code, { language: 'mermaid', ignoreIllegals: true }).value;
                  }
                  return hljs.highlightAuto(code).value || code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                } catch {
                  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                }
              })(),
            }}
          />
        </pre>
      )}
    </div>
  );
}

const MermaidViewer = React.memo(MermaidViewerComponent, (prev, next) => {
  return (
    prev.code === next.code &&
    prev.inline === next.inline &&
    prev.onOpenCanvas === next.onOpenCanvas
  );
});

export default MermaidViewer;
