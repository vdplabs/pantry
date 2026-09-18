import React, { useState, useRef, useCallback, useMemo } from 'react';
import { FiCode, FiPlay, FiCopy, FiCheck, FiSliders, FiZap, FiRefreshCw } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { streamTextCompletion } from '@/services/streaming';
import api from '@/services/api';
import hljs from 'highlight.js';

const CODE_PRESETS = [
  {
    language: 'python',
    label: 'Python: Binary Search',
    prefix: `def binary_search(arr: list[int], target: int) -> int:
    """Find target index in sorted array using binary search."""
    low = 0
    high = len(arr) - 1
    `,
    suffix: `
    return -1
`,
  },
  {
    language: 'typescript',
    label: 'TypeScript: LRU Cache',
    prefix: `class LRUCache<K, V> {
  private capacity: number;
  private cache: Map<K, V> = new Map();

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get(key: K): V | undefined {
    `,
    suffix: `
  }
}
`,
  },
  {
    language: 'go',
    label: 'Go: HTTP Worker Pool',
    prefix: `package main

import (
	"context"
	"sync"
)

type Job struct {
	ID   int
	Data string
}

func worker(ctx context.Context, id int, jobs <-chan Job, wg *sync.WaitGroup) {
	defer wg.Done()
	`,
    suffix: `
}
`,
  },
];

const CODE_LANGUAGES = [
  { id: 'python', label: 'Python' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'cpp', label: 'C++' },
  { id: 'json', label: 'JSON' },
  { id: 'sql', label: 'SQL' },
  { id: 'bash', label: 'Bash' },
];

function highlightCodeSnippet(code: string, lang: string): string {
  if (!code) return '';
  const cleanLang = (lang || '').trim().toLowerCase();
  const validLang = cleanLang && hljs.getLanguage(cleanLang) ? cleanLang : null;
  try {
    if (validLang) {
      return hljs.highlight(code, { language: validLang, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(code).value || code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  } catch {
    return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

export default function GeneratePage() {
  const { state } = useApp();
  const [mode, setMode] = useState<'fim' | 'raw'>('fim');
  const [language, setLanguage] = useState<string>('python');
  const [prefix, setPrefix] = useState(CODE_PRESETS[0].prefix);
  const [suffix, setSuffix] = useState(CODE_PRESETS[0].suffix);
  const [rawPrompt, setRawPrompt] = useState('def quicksort(arr):\n    if len(arr) <= 1:\n        return arr\n');
  const [generatedText, setGeneratedText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedModel, setSelectedModel] = useState(state.model || 'chat-compact');
  const [temperature, setTemperature] = useState(0.2);
  const [maxTokens, setMaxTokens] = useState(256);
  const [stopTokens, setStopTokens] = useState('\n\n');
  const [copied, setCopied] = useState(false);
  const [tps, setTps] = useState<number | null>(null);

  const codeModels = state.models.filter(m =>
    (m.modalities || []).some(mod => mod.toLowerCase().includes('text') || mod.toLowerCase().includes('chat')) ||
    (m.role || '').toLowerCase().includes('code') ||
    (m.role || '').toLowerCase().includes('chat')
  );

  const handleApplyPreset = (preset: typeof CODE_PRESETS[0]) => {
    setLanguage(preset.language);
    setPrefix(preset.prefix);
    setSuffix(preset.suffix);
    setGeneratedText('');
  };

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setGeneratedText('');
    setTps(null);
    const t0 = performance.now();
    let tokenCount = 0;

    const stops = stopTokens.split(',').map(s => s.trim()).filter(Boolean);

    try {
      const res = await api.complete({
        model: selectedModel,
        prompt: mode === 'fim' ? prefix : rawPrompt,
        suffix: mode === 'fim' ? suffix : undefined,
        max_tokens: maxTokens,
        temperature,
        stop: stops.length > 0 ? stops : undefined,
        stream: true,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || errJson.error?.message || `Failed to generate (${res.status})`);
      }

      let accumulated = '';
      streamTextCompletion(
        res,
        (chunk) => {
          tokenCount++;
          accumulated += chunk;
          setGeneratedText(accumulated);
        },
        () => {
          const duration_s = Math.max(0.01, (performance.now() - t0) / 1000);
          setTps(tokenCount > 0 ? tokenCount / duration_s : null);
          setIsGenerating(false);
        },
        (err) => {
          setIsGenerating(false);
          setGeneratedText(prev => prev + `\n\n[Error: ${err.message}]`);
        }
      );
    } catch (err: any) {
      setIsGenerating(false);
      setGeneratedText(`[Error: ${err.message || String(err)}]`);
    }
  }, [mode, prefix, suffix, rawPrompt, selectedModel, maxTokens, temperature, stopTokens]);

  const fullCode = mode === 'fim' ? `${prefix}${generatedText}${suffix}` : `${rawPrompt}${generatedText}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(fullCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const highlightedPrefix = useMemo(() => highlightCodeSnippet(prefix, language), [prefix, language]);
  const highlightedSuffix = useMemo(() => highlightCodeSnippet(suffix, language), [suffix, language]);
  const highlightedGenerated = useMemo(() => highlightCodeSnippet(generatedText, language), [generatedText, language]);
  const highlightedRaw = useMemo(() => highlightCodeSnippet(rawPrompt, language), [rawPrompt, language]);

  return (
    <div className="studio-layout">
      <div className="studio-header">
        <div className="studio-title-group">
          <h2>Code & FIM Completion Workbench</h2>
          <p>Test Fill-In-The-Middle (FIM) prefix/suffix code completions and raw token continuation via /v1/completions</p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className="topmenu-nav-pill">
            <button
              className={`topmenu-nav-item ${mode === 'fim' ? 'active' : ''}`}
              onClick={() => setMode('fim')}
            >
              Fill-In-The-Middle (FIM)
            </button>
            <button
              className={`topmenu-nav-item ${mode === 'raw' ? 'active' : ''}`}
              onClick={() => setMode('raw')}
            >
              Raw Continuation
            </button>
          </div>
        </div>
      </div>

      <div className="studio-grid">
        {/* Configuration Sidebar */}
        <div className="studio-panel">
          <div className="studio-panel-title">
            <FiSliders size={16} color="var(--accent-primary)" />
            <span>Inference Settings</span>
          </div>

          <div className="form-field">
            <label className="form-label">Target Model</label>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className="form-select"
            >
              {codeModels.map(m => (
                <option key={m.id} value={m.id}>
                  {m.id} ({m.quality_tier || 'compact'})
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label className="form-label">Programming Language</label>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value)}
              className="form-select"
            >
              {CODE_LANGUAGES.map(lang => (
                <option key={lang.id} value={lang.id}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label className="form-label">Temperature ({temperature})</label>
            <input
              type="range"
              min="0"
              max="1.2"
              step="0.05"
              value={temperature}
              onChange={e => setTemperature(parseFloat(e.target.value))}
              style={{ accentColor: 'var(--accent-primary)' }}
            />
          </div>

          <div className="form-field">
            <label className="form-label">Max Tokens ({maxTokens})</label>
            <input
              type="number"
              min="16"
              max="4096"
              step="32"
              value={maxTokens}
              onChange={e => setMaxTokens(parseInt(e.target.value) || 128)}
              className="form-input"
            />
          </div>

          <div className="form-field">
            <label className="form-label">Stop Sequences (comma separated)</label>
            <input
              type="text"
              value={stopTokens}
              onChange={e => setStopTokens(e.target.value)}
              placeholder="\n\n, def , class "
              className="form-input"
              style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}
            />
          </div>

          {mode === 'fim' && (
            <div className="form-field">
              <label className="form-label">Code Presets</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {CODE_PRESETS.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className="chat-control-pill"
                    style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                  >
                    <FiCode size={12} />
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="primary-action-btn"
          >
            {isGenerating ? <FiRefreshCw className="spinning" size={15} /> : <FiPlay size={15} />}
            <span>{isGenerating ? 'Generating...' : 'Complete Code'}</span>
          </button>
        </div>

        {/* Code Editor & Output Workbench */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {mode === 'fim' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="studio-panel" style={{ padding: '16px' }}>
                <span className="studio-panel-title" style={{ fontSize: '12px', color: 'var(--accent-primary)' }}>
                  Prefix Code (Prompt)
                </span>
                <textarea
                  rows={8}
                  value={prefix}
                  onChange={e => setPrefix(e.target.value)}
                  className="form-textarea"
                  style={{ fontFamily: 'var(--mono)', fontSize: '12px', lineHeight: 1.5 }}
                />
              </div>

              <div className="studio-panel" style={{ padding: '16px' }}>
                <span className="studio-panel-title" style={{ fontSize: '12px', color: 'var(--accent-cyan)' }}>
                  Suffix Code (Anchor)
                </span>
                <textarea
                  rows={8}
                  value={suffix}
                  onChange={e => setSuffix(e.target.value)}
                  className="form-textarea"
                  style={{ fontFamily: 'var(--mono)', fontSize: '12px', lineHeight: 1.5 }}
                />
              </div>
            </div>
          ) : (
            <div className="studio-panel" style={{ padding: '16px' }}>
              <span className="studio-panel-title" style={{ fontSize: '12px', color: 'var(--accent-primary)' }}>
                Prompt Continuation
              </span>
              <textarea
                rows={6}
                value={rawPrompt}
                onChange={e => setRawPrompt(e.target.value)}
                className="form-textarea"
                style={{ fontFamily: 'var(--mono)', fontSize: '12px', lineHeight: 1.5 }}
              />
            </div>
          )}

          {/* Result Output Terminal */}
          <div className="studio-panel" style={{ padding: '0', overflow: 'hidden' }}>
            <div className="code-block-header" style={{ padding: '10px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontWeight: 700, color: 'var(--text-title)' }}>Generated Code Output</span>
                <span className="code-lang">{language}</span>
                {tps && (
                  <span className="chat-tps-badge">
                    ⚡ {tps.toFixed(1)} tok/s
                  </span>
                )}
              </div>
              <button onClick={handleCopy} className="code-copy-btn" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {copied ? <FiCheck size={12} color="#10b981" /> : <FiCopy size={12} />}
                <span>{copied ? 'Copied!' : 'Copy Complete Code'}</span>
              </button>
            </div>

            <pre style={{ margin: 0, padding: '16px', background: '#090e18', overflowX: 'auto', fontFamily: 'var(--mono)', fontSize: '13px', lineHeight: 1.6, minHeight: '180px' }}>
              <code className={`hljs language-${language}`} style={{ background: 'transparent' }}>
                {mode === 'fim' ? (
                  <>
                    <span dangerouslySetInnerHTML={{ __html: highlightedPrefix }} />
                    {generatedText ? (
                      <span className="fim-insertion">
                        <span dangerouslySetInnerHTML={{ __html: highlightedGenerated }} />
                      </span>
                    ) : isGenerating ? (
                      <span className="fim-cursor" />
                    ) : null}
                    <span dangerouslySetInnerHTML={{ __html: highlightedSuffix }} />
                  </>
                ) : (
                  <>
                    <span dangerouslySetInnerHTML={{ __html: highlightedRaw }} />
                    {generatedText ? (
                      <span className="fim-insertion">
                        <span dangerouslySetInnerHTML={{ __html: highlightedGenerated }} />
                      </span>
                    ) : isGenerating ? (
                      <span className="fim-cursor" />
                    ) : null}
                  </>
                )}
              </code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
