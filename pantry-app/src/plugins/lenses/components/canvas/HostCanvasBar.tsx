import React, { useState } from 'react';
import { FiZap } from 'react-icons/fi';

interface Props {
  onApplyTopologyEdit: (prompt: string) => void;
  isLoading?: boolean;
  theme?: 'dark' | 'light';
}

export default function HostCanvasBar({ onApplyTopologyEdit, isLoading = false, theme = 'dark' }: Props) {
  const [prompt, setPrompt] = useState('');
  const isDark = theme === 'dark';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isLoading) return;
    onApplyTopologyEdit(prompt.trim());
    setPrompt('');
  };

  return (
    <div
      className="lens-host-canvas-bar"
      style={{
        position: 'absolute',
        bottom: '14px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        width: '100%',
        maxWidth: '620px',
        padding: '0 16px',
        boxSizing: 'border-box',
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="lens-host-canvas-form"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '5px 6px 5px 12px',
          borderRadius: '9999px',
          background: isDark ? 'rgba(18, 24, 36, 0.96)' : 'rgba(255, 255, 255, 0.98)',
          border: `1px solid ${isDark ? '#23324c' : '#cbd5e1'}`,
          boxShadow: isDark ? '0 10px 28px rgba(0, 0, 0, 0.4)' : '0 8px 24px rgba(0, 0, 0, 0.12)',
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* HOST CANVAS Pill Badge matching Screenshot 1 */}
        <div
          className="lens-host-canvas-pill"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            padding: '4px 10px',
            borderRadius: '9999px',
            backgroundColor: '#2563eb',
            color: '#ffffff',
            fontSize: '10px',
            fontWeight: 800,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            userSelect: 'none',
            flexShrink: 0,
          }}
        >
          <FiZap size={11} />
          <span>HOST CANVAS</span>
        </div>

        {/* Input */}
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Edit canvas topology (e.g. 'Add Redis Cache between API and DB')..."
          disabled={isLoading}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: '12px',
            color: isDark ? '#f8fafc' : '#0f172a',
            padding: '4px 6px',
          }}
        />

        {/* Apply Edit Action Button */}
        <button
          type="submit"
          disabled={!prompt.trim() || isLoading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            padding: '6px 14px',
            borderRadius: '9999px',
            backgroundColor: prompt.trim() && !isLoading ? '#2563eb' : (isDark ? '#162032' : '#f1f5f9'),
            border: '1px solid',
            borderColor: prompt.trim() && !isLoading ? '#1d4ed8' : (isDark ? '#23324c' : '#e2e8f0'),
            color: prompt.trim() && !isLoading ? '#ffffff' : (isDark ? '#64748b' : '#94a3b8'),
            fontSize: '11px',
            fontWeight: 600,
            cursor: prompt.trim() && !isLoading ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s ease',
            flexShrink: 0,
          }}
        >
          {isLoading ? (
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.6)', borderTopColor: '#fff' }} />
          ) : (
            <FiPlus size={13} />
          )}
          <span>Apply Edit</span>
        </button>
      </form>
    </div>
  );
}

function FiPlus({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
