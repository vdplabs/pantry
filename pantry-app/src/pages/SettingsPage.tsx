import React, { useState, useCallback, useEffect } from 'react';
import {
  FiSave, FiRefreshCw, FiTrash2, FiActivity, FiServer,
  FiCpu, FiHardDrive, FiCheck, FiAlertCircle, FiSliders, FiZap
} from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import api from '@/services/api';
import type { HealthResponse, StorageInfo } from '@/types';

export default function SettingsPage() {
  const { state, setTemperature, setMaxTokens, setSystemPrompt, setPreferSpeculative, setApiUrl: setContextApiUrl } = useApp();
  const [apiUrl, setApiUrl] = useState(state.apiUrl || 'http://127.0.0.1:18787');
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [purgeSuccess, setPurgeSuccess] = useState(false);
  const [pruneResult, setPruneResult] = useState<any>(null);

  // Local config draft
  const [temp, setTemp] = useState(state.temperature);
  const [maxTok, setMaxTok] = useState(state.maxTokens);
  const [sysPrompt, setSysPrompt] = useState(state.systemPrompt);
  const [speculative, setSpeculative] = useState(state.preferSpeculative);

  useEffect(() => {
    setTemp(state.temperature);
    setMaxTok(state.maxTokens);
    setSysPrompt(state.systemPrompt);
    setSpeculative(state.preferSpeculative);
    if (state.apiUrl) {
      setApiUrl(state.apiUrl);
    }
  }, [state.temperature, state.maxTokens, state.systemPrompt, state.preferSpeculative, state.apiUrl]);

  const checkConnection = useCallback(async () => {
    setTestingConnection(true);
    const start = performance.now();
    try {
      const res = await api.health();
      const end = performance.now();
      setPingMs(Math.round(end - start));
      setHealth(res);
    } catch (err: any) {
      setHealth({ ok: false, name: 'pantry', version: '', packages: 0, loaded: [], home: '', data: '', memory: { pressure: 'error', active_bytes: 0, active_human: '0', peak_bytes: 0, cache_bytes: 0, metal_available: false } });
      setPingMs(null);
    } finally {
      setTestingConnection(false);
    }
  }, []);

  const checkStorage = useCallback(async () => {
    try {
      const res = await api.storage();
      setStorage(res);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    checkConnection();
    checkStorage();
  }, [checkConnection, checkStorage]);

  const handleClearMemory = useCallback(async () => {
    try {
      await api.clearMemory();
      setPurgeSuccess(true);
      setTimeout(() => setPurgeSuccess(false), 3000);
      await checkConnection();
    } catch (err: any) {
      alert(`Clear memory failed: ${err.message}`);
    }
  }, [checkConnection]);

  const handlePrune = useCallback(async (dryRun = false) => {
    try {
      const res: any = await api.prune(dryRun);
      setPruneResult(typeof res === 'object' && res !== null ? { dryRun, ...res } : { dryRun, result: res });
      await checkStorage();
    } catch (err: any) {
      alert(`Prune failed: ${err.message}`);
    }
  }, [checkStorage]);

  const handleSaveAll = useCallback(() => {
    setSaving(true);
    setTemperature(temp);
    setMaxTokens(maxTok);
    setSystemPrompt(sysPrompt);
    setPreferSpeculative(speculative);
    setContextApiUrl(apiUrl);
    localStorage.setItem('pantry_api_url', apiUrl);

    setTimeout(() => {
      setSaving(false);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    }, 400);
  }, [temp, maxTok, sysPrompt, speculative, apiUrl, setTemperature, setMaxTokens, setSystemPrompt, setPreferSpeculative, setContextApiUrl]);

  return (
    <div className="settings-page" style={{ padding: '24px 32px', maxWidth: 1080, margin: '0 auto' }}>
      {/* Page Title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Pantry Server & Environment Settings
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
            Configure client connection, inspect hardware memory pressure, and set default inference policies.
          </p>
        </div>
        <button
          onClick={handleSaveAll}
          disabled={saving}
          className="gen-submit"
          style={{ width: 'auto', padding: '8px 18px', margin: 0 }}
        >
          {saving ? <FiRefreshCw size={13} className="gen-spinner" /> : savedSuccess ? <FiCheck size={13} /> : <FiSave size={13} />}
          {savedSuccess ? 'Saved Preferences' : 'Save Changes'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: 20 }}>
        {/* Card 1: API Server Diagnostics */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 14,
            padding: 22,
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FiServer size={16} color="var(--accent-primary)" />
              <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Pantry API Server Connection
              </h2>
            </div>
            <button
              onClick={checkConnection}
              disabled={testingConnection}
              className="gen-canvas-action"
              style={{ fontSize: 11, padding: '4px 8px' }}
            >
              {testingConnection ? <FiRefreshCw size={10} className="gen-spinner" /> : <FiActivity size={10} />}
              Ping Test
            </button>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label className="gen-label" style={{ marginBottom: 4 }}>Backend Server Base URL</label>
            <input
              type="text"
              value={apiUrl}
              onChange={e => setApiUrl(e.target.value)}
              placeholder="http://127.0.0.1:18787"
              className="gen-select"
              style={{ padding: '8px 12px' }}
            />
          </div>

          {/* Connection Status Box */}
          <div
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-medium)',
              borderRadius: 10,
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: health?.ok ? '#22c55e' : '#ef4444',
                    boxShadow: health?.ok ? '0 0 8px #22c55e' : '0 0 8px #ef4444'
                  }}
                />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {health?.ok ? 'Connected & Healthy' : 'Disconnected / Server Unreachable'}
                </span>
              </div>
              {pingMs !== null && (
                <span style={{ fontSize: 11, color: 'var(--accent-primary)', fontWeight: 600 }}>
                  ⚡ {pingMs} ms latency
                </span>
              )}
            </div>

            {health?.ok && (
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
                <div>Server Name: <strong>{health.name}</strong></div>
                <div>Version: <strong>{health.version}</strong></div>
                <div>Packages: <strong>{health.packages}</strong></div>
                <div>Active Models: <strong>{health.loaded?.length || 0}</strong></div>
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Unified Memory & Metal GPU */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 14,
            padding: 22,
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FiCpu size={16} color="var(--accent-primary)" />
              <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Unified Memory & GPU Cache
              </h2>
            </div>
            <button
              onClick={handleClearMemory}
              className="gen-canvas-action"
              style={{ fontSize: 11, padding: '4px 8px', color: purgeSuccess ? '#22c55e' : 'var(--text-primary)' }}
            >
              {purgeSuccess ? <FiCheck size={10} /> : <FiTrash2 size={10} />}
              {purgeSuccess ? 'Purged' : 'Purge Cache'}
            </button>
          </div>

          <div
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-medium)',
              borderRadius: 10,
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Memory Pressure</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: health?.memory?.pressure === 'normal' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: health?.memory?.pressure === 'normal' ? '#22c55e' : '#ef4444'
                }}
              >
                {health?.memory?.pressure || 'Normal'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 11, color: 'var(--text-secondary)' }}>
              <div>Active Memory: <strong style={{ color: 'var(--text-primary)' }}>{health?.memory?.active_human || '0 B'}</strong></div>
              <div>Peak Memory: <strong style={{ color: 'var(--text-primary)' }}>{(health?.memory?.peak_bytes ? (health.memory.peak_bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB' : '0 B')}</strong></div>
              <div>Metal GPU Support: <strong style={{ color: health?.memory?.metal_available ? '#22c55e' : '#94a3b8' }}>{health?.memory?.metal_available ? '✅ Accelerated' : '❌ CPU Only'}</strong></div>
              <div>Cache Pool: <strong style={{ color: 'var(--text-primary)' }}>{(health?.memory?.cache_bytes ? (health.memory.cache_bytes / (1024 * 1024)).toFixed(1) + ' MB' : '0 MB')}</strong></div>
            </div>
          </div>
        </div>

        {/* Card 3: Storage & CAS Deduplication */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 14,
            padding: 22,
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FiHardDrive size={16} color="var(--accent-primary)" />
              <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Content-Addressed Storage (CAS)
              </h2>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => handlePrune(true)}
                className="gen-canvas-action"
                style={{ fontSize: 10, padding: '3px 6px' }}
              >
                Dry Run
              </button>
              <button
                onClick={() => handlePrune(false)}
                className="gen-canvas-action"
                style={{ fontSize: 10, padding: '3px 6px', color: '#ef4444' }}
              >
                Prune Now
              </button>
            </div>
          </div>

          <div
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-medium)',
              borderRadius: 10,
              padding: '14px 16px',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
              fontSize: 11,
              color: 'var(--text-secondary)'
            }}
          >
            <div>Apparent Size: <strong style={{ color: 'var(--text-primary)' }}>{storage?.apparent_human || '0 B'}</strong></div>
            <div>Physical Disk: <strong style={{ color: 'var(--text-primary)' }}>{storage?.physical_human || '0 B'}</strong></div>
            <div>CAS Saved: <strong style={{ color: '#22c55e' }}>{storage?.cas_saved_human || '0 B'}</strong></div>
            <div>Dedup Ratio: <strong style={{ color: 'var(--accent-primary)' }}>{storage?.dedup_ratio ? `${storage.dedup_ratio.toFixed(2)}x` : '1.0x'}</strong></div>
          </div>

          {pruneResult && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
              Prune result ({pruneResult.dryRun ? 'Dry Run' : 'Executed'}): {JSON.stringify(pruneResult)}
            </div>
          )}
        </div>

        {/* Card 4: Global Inference Defaults */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 14,
            padding: 22,
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <FiSliders size={16} color="var(--accent-primary)" />
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Global Inference Defaults
            </h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <label className="gen-label">Default Temperature</label>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-primary)' }}>{temp}</span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={temp}
                onChange={e => setTemp(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <label className="gen-label">Default Max Output Tokens</label>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-primary)' }}>{maxTok}</span>
              </div>
              <input
                type="number"
                min={64}
                max={32768}
                step={128}
                value={maxTok}
                onChange={e => setMaxTok(Number(e.target.value))}
                className="gen-select"
                style={{ padding: '6px 10px' }}
              />
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={speculative}
                  onChange={e => setSpeculative(e.target.checked)}
                  style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                />
                Prefer Speculative Decoding & Draft Models by default
              </label>
            </div>

            <div>
              <label className="gen-label" style={{ marginBottom: 4 }}>Default System Persona</label>
              <textarea
                value={sysPrompt}
                onChange={e => setSysPrompt(e.target.value)}
                placeholder="You are a helpful, brilliant AI assistant..."
                className="gen-textarea"
                rows={2}
                style={{ minHeight: 60 }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

