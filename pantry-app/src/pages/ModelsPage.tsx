import React, { useState, useCallback } from 'react';
import { FiDownload, FiSearch, FiPackage, FiCheck, FiX, FiLoader, FiRefreshCw, FiPlay, FiPower } from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import api from '@/services/api';
import type { ModelInfo } from '@/types';

export default function ModelsPage() {
  const { state, setModels } = useApp();
  const { models } = state;
  const [search, setSearch] = useState('');
  const [pulling, setPulling] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveResult, setResolveResult] = useState<any>(null);

  const handlePull = useCallback(async (pkgId: string) => {
    setPulling(pkgId);
    try {
      await api.pullModel(pkgId);
      const res = await api.listModelsAll();
      setModels((res.data || res) as ModelInfo[]);
    } catch (err: any) {
      alert(`Pull failed: ${err.message}`);
    } finally {
      setPulling(null);
    }
  }, [setModels]);

  const handleLoad = useCallback(async (pkgId: string) => {
    setLoading(true);
    try {
      await api.loadModel({ package_id: pkgId });
    } catch (err: any) {
      alert(`Load failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleUnload = useCallback(async (pkgId: string) => {
    try {
      await api.unloadModel({ package_id: pkgId });
    } catch (err: any) {
      alert(`Unload failed: ${err.message}`);
    }
  }, []);

  const handleResolve = useCallback(async (modality = 'chat', ramMax = 8, quality = 'standard') => {
    setResolving(true);
    try {
      const res = await api.resolve({ modality, ram_gb_max: ramMax, quality_tier: quality });
      setResolveResult(res);
    } catch (err: any) {
      setResolveResult({ error: err.message });
    } finally {
      setResolving(false);
    }
  }, []);

  const filteredModels = models.filter((m: ModelInfo) =>
    m.id.toLowerCase().includes(search.toLowerCase()) ||
    m.alias?.toLowerCase().includes(search.toLowerCase())
  );

  const getModalityClass = (mod: string) => {
    switch (mod) {
      case 'text': return 'modality-text';
      case 'image_gen': return 'modality-image_gen';
      case 'music': return 'modality-music';
      case 'audio': return 'modality-audio';
      case 'embedding': return 'modality-embedding';
      case 'stt': return 'modality-stt';
      default: return 'modality-default';
    }
  };

  return (
    <div className="models-page">
      <h1 className="models-title">Model Management</h1>

      {/* Resolve Section */}
      <div className="models-card">
        <h2 className="models-card-title">
          🔬 Capability Resolution
        </h2>
        <p className="models-card-desc">
          Submit intent tuple → receive ExecutionPlan
        </p>
        <div className="models-resolve-row">
          <div className="models-form-group">
            <label className="models-label">Modality</label>
            <select id="resolve-modality" className="models-select">
              <option value="chat">chat</option>
              <option value="text">text</option>
              <option value="image_gen">image_gen</option>
              <option value="music">music</option>
              <option value="audio">audio</option>
              <option value="embedding">embedding</option>
              <option value="stt">stt</option>
            </select>
          </div>
          <div className="models-form-group">
            <label className="models-label">RAM Max (GB)</label>
            <input type="number" defaultValue="8" className="models-input models-input-small" />
          </div>
          <div className="models-form-group">
            <label className="models-label">Quality</label>
            <select id="resolve-quality" className="models-select">
              <option value="compact">compact</option>
              <option value="standard">standard</option>
              <option value="high">high</option>
            </select>
          </div>
          <button
            onClick={() => {
              const modality = (document.getElementById('resolve-modality') as HTMLSelectElement).value;
              const ram = parseInt((document.getElementById('resolve-modality') as HTMLSelectElement).value);
              handleResolve(modality, 8, 'compact');
            }}
            disabled={resolving}
            className="models-resolve-btn"
          >
            {resolving ? <FiLoader size={12} className="spin mr-4" /> : <FiSearch size={12} className="mr-4" />}
            Resolve
          </button>
        </div>

        {resolveResult && (
          <div className="models-result">
            {resolveResult.error ? (
              <span className="models-result-error">Error: {resolveResult.error}</span>
            ) : (
              <div>
                <div className="models-result-package">
                  ✅ <strong>Package:</strong> {resolveResult.package_id}
                </div>
                {resolveResult.alias && <div className="models-result-alias">Alias: {resolveResult.alias}</div>}
                {resolveResult.plan && (
                  <div className="models-result-plan">
                    <div>Runtime: {resolveResult.plan.runtime || 'auto'}</div>
                    <div>Speculative: {resolveResult.plan.speculative ? '✅ Enabled' : '❌ Disabled'}</div>
                    {resolveResult.plan.context_max && <div>Context: {resolveResult.plan.context_max.toLocaleString()} tokens</div>}
                    {resolveResult.plan.estimated_tps && <div>Est. TPS: {resolveResult.plan.estimated_tps}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Model List */}
      <div className="models-list-header">
        <h2 className="models-card-title models-list-title">
          <FiPackage size={16} className="models-list-icon" />
          Installed Models ({filteredModels.length})
        </h2>
        <div className="models-search">
          <FiSearch size={12} color="#8b949e" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter models..."
            className="models-search-input"
          />
        </div>
      </div>

      <div className="models-list">
        {filteredModels.map((model: ModelInfo) => (
          <div key={model.id} className="models-model-card">
            <div className="models-model-info">
              <div className={`models-status-dot ${model.resident ? 'resident' : 'not-resident'}`} />
              <div className="models-model-details">
                <div className="models-model-name-row">
                  <span className="models-model-name">{model.id}</span>
                  {model.alias && <span className="models-model-alias">({model.alias})</span>}
                  <span className={`models-modality-badge ${getModalityClass(model.modalities?.[0] || '')}`}>
                    {(model.modalities || []).join(', ')}
                  </span>
                </div>
                <div className="models-model-meta">
                  {model.runtime} {model.size_gb && `· ${model.size_gb} GB`}
                  {model.context_max && ` · ${model.context_max.toLocaleString()} ctx`}
                  {model.quant_label && ` · ${model.quant_label}`}
                </div>
              </div>
            </div>
            <div className="models-model-actions">
              {!model.weights_ready && (
                <button
                  onClick={() => handlePull(model.id)}
                  disabled={pulling === model.id}
                  className="models-action-btn models-action-btn-pull"
                >
                  {pulling === model.id ? <FiLoader size={10} className="spin" /> : <FiDownload size={10} />}
                  {model.weights_ready ? 'Ready' : 'Pull'}
                </button>
              )}
              {model.weights_ready && !model.resident && (
                <button
                  onClick={() => handleLoad(model.id)}
                  disabled={loading}
                  className="models-action-btn models-action-btn-load"
                >
                  <FiPlay size={10} /> Load
                </button>
              )}
              {model.resident && (
                <button
                  onClick={() => handleUnload(model.id)}
                  className="models-action-btn models-action-btn-unload"
                >
                  <FiPower size={10} /> Unload
                </button>
              )}
              {model.resident && (
                <span className="models-resident-badge">
                  <FiCheck size={10} /> Resident
                </span>
              )}
            </div>
          </div>
        ))}
        {filteredModels.length === 0 && (
          <div className="models-empty">No models found. Pull a model first.</div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
