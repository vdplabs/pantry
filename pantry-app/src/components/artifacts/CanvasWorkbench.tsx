import React, { useState, useEffect } from 'react';
import {
  FiX, FiMaximize2, FiMinimize2, FiDownload, FiCopy, FiCheck,
  FiPlay, FiCode, FiEye, FiSidebar, FiRefreshCw, FiEdit3
} from 'react-icons/fi';
import MermaidViewer from './MermaidViewer';
import LiveHtmlPreview from './LiveHtmlPreview';
import hljs from 'highlight.js';

export interface CanvasArtifact {
  id: string;
  title: string;
  type: 'mermaid' | 'html' | 'svg' | 'code' | string;
  code: string;
  language?: string;
}

interface Props {
  artifact: CanvasArtifact;
  onClose: () => void;
  onUpdateCode?: (updatedCode: string) => void;
}

export default function CanvasWorkbench({ artifact, onClose, onUpdateCode }: Props) {
  const [currentCode, setCurrentCode] = useState(artifact.code);
  const [activeTab, setActiveTab] = useState<'preview' | 'editor'>('preview');
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    setCurrentCode(artifact.code);
  }, [artifact.code]);

  const handleCodeChange = (newCode: string) => {
    setCurrentCode(newCode);
    onUpdateCode?.(newCode);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    let ext = 'txt';
    let mime = 'text/plain';
    if (artifact.type === 'mermaid') { ext = 'mermaid'; mime = 'text/plain'; }
    else if (artifact.type === 'html') { ext = 'html'; mime = 'text/html'; }
    else if (artifact.type === 'svg') { ext = 'svg'; mime = 'image/svg+xml'; }
    else if (artifact.language === 'python') { ext = 'py'; }
    else if (artifact.language === 'javascript' || artifact.language === 'js') { ext = 'js'; }
    else if (artifact.language === 'typescript' || artifact.language === 'ts') { ext = 'ts'; }

    const blob = new Blob([currentCode], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pantry-${artifact.type}-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const isPreviewable = artifact.type === 'mermaid' || artifact.type === 'html' || artifact.type === 'svg';

  return (
    <div className={`canvas-workbench-pane ${isExpanded ? 'fullscreen' : ''}`}>
      {/* Workbench Header */}
      <div className="canvas-header">
        <div className="canvas-title-group">
          <div className={`canvas-type-badge ${artifact.type}`}>
            <span className="badge-glow" />
            <span>{artifact.type.toUpperCase()} WORKBENCH</span>
          </div>
          <h3 className="canvas-title">{artifact.title || 'Live Interactive Canvas'}</h3>
        </div>

        <div className="canvas-actions">
          {isPreviewable && (
            <div className="artifact-tab-group">
              <button
                className={`artifact-tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
                onClick={() => setActiveTab('preview')}
              >
                <FiEye size={12} /> Preview
              </button>
              <button
                className={`artifact-tab-btn ${activeTab === 'editor' ? 'active' : ''}`}
                onClick={() => setActiveTab('editor')}
              >
                <FiEdit3 size={12} /> Live Editor
              </button>
            </div>
          )}

          <button onClick={handleCopy} className="artifact-tool-btn" title="Copy code">
            {copied ? <FiCheck size={13} color="var(--accent-emerald)" /> : <FiCopy size={13} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button onClick={handleDownload} className="artifact-tool-btn" title="Download Artifact">
            <FiDownload size={13} />
          </button>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="artifact-tool-btn"
            title={isExpanded ? 'Restore side panel' : 'Expand full width'}
          >
            {isExpanded ? <FiMinimize2 size={13} /> : <FiMaximize2 size={13} />}
          </button>

          <button onClick={onClose} className="canvas-close-btn" title="Close Canvas">
            <FiX size={15} />
          </button>
        </div>
      </div>

      {/* Workbench Content */}
      <div className="canvas-body">
        {activeTab === 'preview' && isPreviewable ? (
          <div className="canvas-preview-container">
            {artifact.type === 'mermaid' && (
              <MermaidViewer code={currentCode} inline={false} />
            )}
            {(artifact.type === 'html' || artifact.type === 'svg') && (
              <LiveHtmlPreview code={currentCode} language={artifact.type} inline={false} />
            )}
          </div>
        ) : (
          <div className="canvas-editor-container">
            <div className="editor-info-banner">
              <span>💡 Live Editor: Edit code below to test changes instantly in real-time.</span>
            </div>
            <textarea
              value={currentCode}
              onChange={e => handleCodeChange(e.target.value)}
              className="canvas-code-editor"
              spellCheck={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}
