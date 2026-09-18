import React, { useState, useRef, useEffect } from 'react';
import {
  FiMonitor, FiTablet, FiSmartphone, FiRefreshCw, FiCopy,
  FiCheck, FiCode, FiEye, FiDownload, FiSidebar, FiMaximize2
} from 'react-icons/fi';

interface Props {
  code: string;
  language?: string;
  onOpenCanvas?: (code: string, type: 'html' | 'svg') => void;
  inline?: boolean;
}

type DeviceMode = 'desktop' | 'tablet' | 'mobile';

export default function LiveHtmlPreview({ code, language = 'html', onOpenCanvas, inline = true }: Props) {
  const [device, setDevice] = useState<DeviceMode>('desktop');
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const [key, setKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const isSvg = language === 'svg' || code.trim().startsWith('<svg');

  // Build sandboxed HTML payload
  const getDocumentSrcDoc = () => {
    if (isSvg && !code.includes('<!DOCTYPE html>') && !code.includes('<html')) {
      return `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body {
                margin: 0;
                padding: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background: #090e18;
                box-sizing: border-box;
              }
              svg {
                max-width: 100%;
                max-height: 100%;
                filter: drop-shadow(0 4px 16px rgba(0,0,0,0.4));
              }
            </style>
          </head>
          <body>
            ${code}
          </body>
        </html>
      `;
    }

    if (!code.includes('<html') && !code.includes('<!DOCTYPE')) {
      return `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
              body {
                margin: 0;
                padding: 16px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                background: #090e18;
                color: #f8fafc;
                min-height: 100vh;
              }
            </style>
          </head>
          <body>
            ${code}
          </body>
        </html>
      `;
    }

    return code;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRefresh = () => {
    setKey(prev => prev + 1);
  };

  const handleDownload = () => {
    const ext = isSvg ? 'svg' : 'html';
    const mime = isSvg ? 'image/svg+xml' : 'text/html';
    const blob = new Blob([code], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `artifact-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getDeviceWidth = () => {
    switch (device) {
      case 'mobile': return '375px';
      case 'tablet': return '768px';
      case 'desktop':
      default: return '100%';
    }
  };

  return (
    <div className={`live-html-artifact-card ${inline ? 'inline' : 'standalone'}`}>
      {/* Header Bar */}
      <div className="artifact-toolbar">
        <div className="artifact-toolbar-left">
          <div className="artifact-badge html">
            <span className="badge-dot" />
            <span>{isSvg ? 'Interactive SVG' : 'Live Web App'}</span>
          </div>

          <div className="artifact-tab-group">
            <button
              className={`artifact-tab-btn ${viewMode === 'preview' ? 'active' : ''}`}
              onClick={() => setViewMode('preview')}
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
          {viewMode === 'preview' && (
            <div className="artifact-device-pills">
              <button
                className={`device-pill-btn ${device === 'desktop' ? 'active' : ''}`}
                onClick={() => setDevice('desktop')}
                title="Desktop (100%)"
              >
                <FiMonitor size={12} />
              </button>
              <button
                className={`device-pill-btn ${device === 'tablet' ? 'active' : ''}`}
                onClick={() => setDevice('tablet')}
                title="Tablet (768px)"
              >
                <FiTablet size={12} />
              </button>
              <button
                className={`device-pill-btn ${device === 'mobile' ? 'active' : ''}`}
                onClick={() => setDevice('mobile')}
                title="Mobile (375px)"
              >
                <FiSmartphone size={12} />
              </button>
            </div>
          )}

          <button onClick={handleRefresh} className="artifact-tool-btn" title="Reload / Rerun preview">
            <FiRefreshCw size={12} />
          </button>

          <button onClick={handleDownload} className="artifact-tool-btn" title="Download File">
            <FiDownload size={12} /> {isSvg ? 'SVG' : 'HTML'}
          </button>

          <button onClick={handleCopy} className="artifact-tool-btn" title="Copy Source Code">
            {copied ? <FiCheck size={12} color="var(--accent-emerald)" /> : <FiCopy size={12} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {onOpenCanvas && (
            <button
              onClick={() => onOpenCanvas(code, isSvg ? 'svg' : 'html')}
              className="artifact-canvas-btn"
              title="Open in split-screen Canvas Workbench"
            >
              <FiSidebar size={13} />
              <span>Canvas</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      {viewMode === 'preview' ? (
        <div className="live-preview-viewport-container">
          <div
            className={`live-preview-frame-wrapper ${device}`}
            style={{ width: getDeviceWidth() }}
          >
            <iframe
              key={key}
              ref={iframeRef}
              srcDoc={getDocumentSrcDoc()}
              title="Live App Sandbox"
              sandbox="allow-scripts allow-modals allow-forms allow-same-origin"
              className="live-preview-iframe"
            />
          </div>
        </div>
      ) : (
        <pre className="mermaid-code-view">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
