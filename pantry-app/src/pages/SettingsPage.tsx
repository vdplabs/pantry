import React, { useState, useCallback } from 'react';
import { FiSave, FiRefreshCw, FiTrash2, FiDownload } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import api from '@/services/api';

export default function SettingsPage() {
  const { state } = useApp();
  const [apiUrl, setApiUrl] = useState(state.apiUrl);
  const [saving, setSaving] = useState(false);
  const [health, setHealth] = useState<any>(null);
  const [storage, setStorage] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const checkHealth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.health();
      setHealth(res);
    } catch (err: any) {
      setHealth({ ok: false, error: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  const checkStorage = useCallback(async () => {
    try {
      const res = await api.storage();
      setStorage(res);
    } catch (err: any) {
      // ignore
    }
  }, []);

  const handleClearMemory = useCallback(async () => {
    try {
      await api.clearMemory();
      checkHealth();
    } catch (err: any) {
      alert(`Clear memory failed: ${err.message}`);
    }
  }, [checkHealth]);

  const handlePrune = useCallback(async (dryRun = false) => {
    try {
      await api.prune(dryRun);
      checkStorage();
    } catch (err: any) {
      alert(`Prune failed: ${err.message}`);
    }
  }, [checkStorage]);

  const handleSave = useCallback(() => {
    setSaving(true);
    setTimeout(() => setSaving(false), 800);
  }, []);

  return (
    <div className="settings-page">
      <h1 className="settings-title">Settings</h1>

      {/* API Connection */}
      <div className="settings-card">
        <h2 className="settings-card-title">API Connection</h2>
        <div className="settings-api-row">
          <input
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="http://127.0.0.1:18787"
            className="settings-api-input"
          />
          <button
            onClick={() => {
              setApiUrl(apiUrl.trim());
              handleSave();
            }}
            disabled={saving}
            className="settings-save-btn"
          >
            <FiSave size={12} /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Health & Status */}
      <div className="settings-card">
        <div className="settings-health-header">
          <h2 className="settings-card-title">Health & Status</h2>
          <button
            onClick={() => { checkHealth(); checkStorage(); }}
            disabled={loading}
            className="settings-check-btn"
          >
            <FiRefreshCw size={11} /> Check
          </button>
        </div>

        {health && (
          <div className={`settings-health-card ${health.ok ? 'healthy' : 'unhealthy'}`}>
            <div className="settings-health-row">
              <span className={`settings-health-dot ${health.ok ? 'healthy' : 'unhealthy'}`} />
              <span className="settings-health-status">
                {health.ok ? 'Healthy' : 'Unhealthy'}
              </span>
              <span className="settings-health-version">
                {health.version || ''}
              </span>
            </div>
            {health.ok && (
              <div className="settings-health-details">
                <div>Packages: {health.packages} | Loaded: {health.loaded?.length || 0}</div>
                <div>Memory: {health.memory?.active_human || '?'} / Pressure: {health.memory?.pressure || '?'}</div>
                <div>Metal Available: {health.memory?.metal_available ? '✅' : '❌'}</div>
              </div>
            )}
            {health.error && <div className="settings-health-error">{health.error}</div>}
          </div>
        )}

        {storage && (
          <div className="settings-storage-card">
            <div className="settings-storage-title">CAS Storage</div>
            <div className="settings-storage-grid">
              {Object.entries(storage).map(([k, v]) => (
                <div key={k} className="settings-storage-row">
                  <span className="settings-storage-key">{k.replace(/_/g, ' ')}:</span>
                  <span className="settings-storage-value">{typeof v === 'number' ? v.toLocaleString() : String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="settings-card">
        <h2 className="settings-card-title">Actions</h2>
        <div className="settings-actions">
          <button
            onClick={() => handlePrune(true)}
            className="settings-action-btn"
          >
            <FiTrash2 size={12} /> Prune (dry-run)
          </button>
          <button
            onClick={() => handlePrune(false)}
            className="settings-action-btn"
          >
            <FiTrash2 size={12} /> Prune Now
          </button>
          <button
            onClick={handleClearMemory}
            className="settings-action-btn"
          >
            <FiRefreshCw size={12} /> Clear Cache
          </button>
        </div>
      </div>

      {/* Current Config */}
      <div className="settings-card">
        <h2 className="settings-card-title">Current Config</h2>
        <pre className="settings-config-pre">
          {JSON.stringify({
            model: state.model,
            modality: state.modality,
            temperature: state.temperature,
            max_tokens: state.maxTokens,
            top_p: state.topP,
            system_prompt: state.systemPrompt,
            stream: state.streamEnabled,
            prefer_speculative: state.preferSpeculative,
            api_url: state.apiUrl,
          }, null, 2)}
        </pre>
      </div>
    </div>
  );
}
