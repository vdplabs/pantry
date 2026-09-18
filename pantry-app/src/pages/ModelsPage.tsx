import React, { useState, useCallback } from 'react';
import {
  FiDownload, FiSearch, FiPackage, FiCheck, FiX, FiLoader,
  FiRefreshCw, FiPlay, FiPower, FiCpu, FiHardDrive, FiActivity,
  FiArrowRight, FiZap, FiLayers, FiSliders
} from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import api from '@/services/api';
import type { ModelInfo, ResolveResponse } from '@/types';

const MODALITY_FILTERS = [
  { id: 'all', label: 'All Models' },
  { id: 'chat', label: 'Chat & LLM' },
  { id: 'code', label: 'Code & FIM' },
  { id: 'image', label: 'Image & Diffusion' },
  { id: 'audio', label: 'Music & Audio' },
  { id: 'stt', label: 'STT & Speech' },
  { id: 'embedding', label: 'Embeddings' },
];

export default function ModelsPage() {
  const { state, setModels } = useApp();
  const { models } = state;
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [activeModality, setActiveModality] = useState('all');
  const [pulling, setPulling] = useState<string | null>(null);
  const [loadingModel, setLoadingModel] = useState<string | null>(null);
  const [unloadingModel, setUnloadingModel] = useState<string | null>(null);

  // Capability Resolver Form
  const [resolveModality, setResolveModality] = useState('chat');
  const [resolveRam, setResolveRam] = useState(8);
  const [resolveQuality, setResolveQuality] = useState('standard');
  const [resolveSpeculative, setResolveSpeculative] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveResult, setResolveResult] = useState<ResolveResponse | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const refreshModels = useCallback(async () => {
    try {
      const res = await api.listModelsAll();
      setModels((res.data || res) as ModelInfo[]);
    } catch {
      // ignore
    }
  }, [setModels]);

  const handlePull = useCallback(async (pkgId: string) => {
    setPulling(pkgId);
    try {
      await api.pullModel(pkgId);
      await refreshModels();
    } catch (err: any) {
      alert(`Pull failed: ${err.message}`);
    } finally {
      setPulling(null);
    }
  }, [refreshModels]);

  const handleLoad = useCallback(async (pkgId: string) => {
    setLoadingModel(pkgId);
    try {
      await api.loadModel({ package_id: pkgId });
      await refreshModels();
    } catch (err: any) {
      alert(`Load failed: ${err.message}`);
    } finally {
      setLoadingModel(null);
    }
  }, [refreshModels]);

  const handleUnload = useCallback(async (pkgId: string) => {
    setUnloadingModel(pkgId);
    try {
      await api.unloadModel({ package_id: pkgId });
      await refreshModels();
    } catch (err: any) {
      alert(`Unload failed: ${err.message}`);
    } finally {
      setUnloadingModel(null);
    }
  }, [refreshModels]);

  const handleResolve = useCallback(async () => {
    setResolving(true);
    setResolveResult(null);
    setResolveError(null);
    try {
      const res = await api.resolve({
        modality: resolveModality,
        ram_gb_max: resolveRam,
        quality_tier: resolveQuality,
        prefer_speculative: resolveSpeculative,
      });
      setResolveResult(res);
    } catch (err: any) {
      setResolveError(err.message || 'Capability resolution failed');
    } finally {
      setResolving(false);
    }
  }, [resolveModality, resolveRam, resolveQuality, resolveSpeculative]);

  const filteredModels = models.filter((m: ModelInfo) => {
    const matchesSearch =
      m.id.toLowerCase().includes(search.toLowerCase()) ||
      (m.alias && m.alias.toLowerCase().includes(search.toLowerCase())) ||
      (m.family && m.family.toLowerCase().includes(search.toLowerCase())) ||
      (m.aliases && m.aliases.some(a => a.toLowerCase().includes(search.toLowerCase())));

    if (!matchesSearch) return false;
    if (activeModality === 'all') return true;

    const mods = (m.modalities || []).map(x => x.toLowerCase());
    if (activeModality === 'chat') return mods.some(x => x.includes('chat') || x.includes('text') || x.includes('llm'));
    if (activeModality === 'code') return mods.some(x => x.includes('code') || x.includes('fim') || x.includes('text'));
    if (activeModality === 'image') return mods.some(x => x.includes('image') || x.includes('diffusion'));
    if (activeModality === 'audio') return mods.some(x => x.includes('audio') || x.includes('music') || x.includes('sound'));
    if (activeModality === 'stt') return mods.some(x => x.includes('stt') || x.includes('speech') || x.includes('whisper'));
    if (activeModality === 'embedding') return mods.some(x => x.includes('embed'));
    return true;
  });

  const getPlaygroundRoute = (model: ModelInfo) => {
    const mods = (model.modalities || []).map(x => x.toLowerCase());
    if (mods.some(x => x.includes('image') || x.includes('diffusion'))) return '/image';
    if (mods.some(x => x.includes('audio') || x.includes('music'))) return '/music';
    if (mods.some(x => x.includes('stt') || x.includes('speech'))) return '/stt';
    if (mods.some(x => x.includes('code') || x.includes('fim'))) return '/generate';
    return '/chat';
  };

  return (
    <div className="models-page" style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Model Registry & Execution Planner
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
            Inspect local model packages, load weights into unified memory, and test hardware execution plans.
          </p>
        </div>
        <button
          onClick={refreshModels}
          className="gen-canvas-action"
          style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12 }}
        >
          <FiRefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Capability Resolution Planner Box */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 14,
          padding: 20,
          marginBottom: 28,
          boxShadow: 'var(--shadow-sm)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <FiZap size={16} color="var(--accent-primary)" />
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Capability Resolution & Intent Matcher
          </h2>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
          Pantry matches high-level intent tuples `(modality, ram_budget, quality)` into optimal execution plans with speculative decoding & prefix caching.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div>
            <label className="gen-label" style={{ marginBottom: 4 }}>Modality</label>
            <select
              value={resolveModality}
              onChange={e => setResolveModality(e.target.value)}
              className="gen-select"
            >
              <option value="chat">Chat / Dialogue</option>
              <option value="code">Code Completion / FIM</option>
              <option value="text">General Text</option>
              <option value="image_gen">Image Generation</option>
              <option value="music">Music & Audio</option>
              <option value="stt">Speech-to-Text</option>
              <option value="embedding">Vector Embeddings</option>
            </select>
          </div>

          <div>
            <label className="gen-label" style={{ marginBottom: 4 }}>Max RAM Budget</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                min={2}
                max={128}
                value={resolveRam}
                onChange={e => setResolveRam(Number(e.target.value))}
                className="gen-select"
                style={{ padding: '7px 10px' }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>GB</span>
            </div>
          </div>

          <div>
            <label className="gen-label" style={{ marginBottom: 4 }}>Quality Tier</label>
            <select
              value={resolveQuality}
              onChange={e => setResolveQuality(e.target.value)}
              className="gen-select"
            >
              <option value="compact">Compact (Ultra Fast)</option>
              <option value="standard">Standard (Balanced)</option>
              <option value="high">High Quality (Max Depth)</option>
            </select>
          </div>

          <div>
            <label className="gen-label" style={{ marginBottom: 4 }}>Speculative Acceleration</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', height: 36 }}>
              <input
                type="checkbox"
                checked={resolveSpeculative}
                onChange={e => setResolveSpeculative(e.target.checked)}
                style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
              />
              Enable Draft Model
            </label>
          </div>

          <div>
            <button
              onClick={handleResolve}
              disabled={resolving}
              className="gen-submit"
              style={{ width: '100%', height: 38, margin: 0 }}
            >
              {resolving ? <FiLoader size={12} className="gen-spinner" style={{ margin: 0 }} /> : <FiSearch size={12} />}
              Resolve Plan
            </button>
          </div>
        </div>

        {/* Resolved Plan Result */}
        {resolveResult && (
          <div
            style={{
              marginTop: 16,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-medium)',
              borderRadius: 10,
              padding: '14px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FiCheck color="var(--accent-primary)" size={16} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  Matched Package: <code style={{ color: 'var(--accent-primary)' }}>{resolveResult.package_id}</code>
                </span>
                {resolveResult.alias && (
                  <span className="chip" style={{ fontSize: 10 }}>{resolveResult.alias}</span>
                )}
              </div>
              {resolveResult.plan?.runtime && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Runtime: <strong>{resolveResult.plan.runtime}</strong>
                </span>
              )}
            </div>

            {resolveResult.plan && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                {resolveResult.plan.estimated_tps && (
                  <div>⚡ Est. Speed: <strong style={{ color: 'var(--accent-primary)' }}>{resolveResult.plan.estimated_tps} tok/s</strong></div>
                )}
                {resolveResult.plan.context_max && (
                  <div>📏 Context Max: <strong>{resolveResult.plan.context_max.toLocaleString()} tokens</strong></div>
                )}
                <div>
                  🚀 Speculative: <strong>{resolveResult.plan.speculative ? 'Enabled' : 'Disabled'}</strong>
                  {resolveResult.plan.draft_package_id && ` (${resolveResult.plan.draft_package_id})`}
                </div>
              </div>
            )}
          </div>
        )}

        {resolveError && (
          <div className="gen-error" style={{ marginTop: 12 }}>
            {resolveError}
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        {/* Modality Filter Pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MODALITY_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setActiveModality(f.id)}
              style={{
                padding: '6px 12px',
                borderRadius: 20,
                border: '1px solid var(--border-subtle)',
                background: activeModality === f.id ? 'var(--accent-primary)' : 'var(--bg-card)',
                color: activeModality === f.id ? '#ffffff' : 'var(--text-secondary)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', minWidth: 260 }}>
          <FiSearch
            size={13}
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
          />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search models, families, aliases..."
            className="gen-select"
            style={{ paddingLeft: 32, width: '100%', height: 36 }}
          />
        </div>
      </div>

      {/* Models Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
        {filteredModels.map((model: ModelInfo) => {
          const isResident = !!model.resident;
          const isWeightsReady = !!model.weights_ready;
          const isPullingThis = pulling === model.id;
          const isLoadingThis = loadingModel === model.id;
          const isUnloadingThis = unloadingModel === model.id;

          return (
            <div
              key={model.id}
              style={{
                background: 'var(--bg-card)',
                border: `1px solid ${isResident ? 'rgba(34, 197, 94, 0.4)' : 'var(--border-subtle)'}`,
                borderRadius: 14,
                padding: 18,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: isResident ? '0 0 16px rgba(34, 197, 94, 0.08)' : 'var(--shadow-sm)',
                transition: 'all 0.2s ease'
              }}
            >
              <div>
                {/* Header Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: isResident ? '#22c55e' : isWeightsReady ? '#3b82f6' : '#94a3b8',
                          boxShadow: isResident ? '0 0 8px #22c55e' : 'none'
                        }}
                      />
                      <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                        {model.id}
                      </h3>
                    </div>
                    {model.alias && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        Alias: <code style={{ color: 'var(--accent-primary)' }}>{model.alias}</code>
                      </div>
                    )}
                  </div>

                  {/* Modality Badges */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {(model.modalities || []).map(mod => (
                      <span
                        key={mod}
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'var(--accent-subtle)',
                          color: 'var(--accent-primary)'
                        }}
                      >
                        {mod}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Meta details */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11, color: 'var(--text-secondary)', margin: '10px 0 14px 0' }}>
                  {model.size_gb && <div>💾 <strong>{model.size_gb} GB</strong> RAM</div>}
                  {model.runtime && <div>⚙️ <strong>{model.runtime}</strong></div>}
                  {model.family && <div>🏷️ <strong>{model.family}</strong></div>}
                  {model.quality_tier && <div>✨ Tier: <strong>{model.quality_tier}</strong></div>}
                  {model.context_max && <div>📜 <strong>{model.context_max.toLocaleString()}</strong> ctx</div>}
                </div>

                {/* Aliases */}
                {model.aliases && model.aliases.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
                    {model.aliases.map(al => (
                      <span
                        key={al}
                        style={{
                          fontSize: 10,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: 'var(--bg-tertiary)',
                          color: 'var(--text-muted)',
                          border: '1px solid var(--border-subtle)'
                        }}
                      >
                        {al}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Buttons Footer */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: 14,
                  borderTop: '1px solid var(--border-subtle)',
                  marginTop: 8
                }}
              >
                <div>
                  {isResident ? (
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <FiCheck size={12} /> Resident in Memory
                    </span>
                  ) : isWeightsReady ? (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Weights Ready</span>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Not Downloaded</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  {!isWeightsReady && (
                    <button
                      onClick={() => handlePull(model.id)}
                      disabled={isPullingThis}
                      className="gen-canvas-action"
                      style={{ fontSize: 11, padding: '5px 10px' }}
                    >
                      {isPullingThis ? <FiLoader size={11} className="gen-spinner" /> : <FiDownload size={11} />}
                      {isPullingThis ? 'Pulling...' : 'Pull Weights'}
                    </button>
                  )}

                  {isWeightsReady && !isResident && (
                    <button
                      onClick={() => handleLoad(model.id)}
                      disabled={isLoadingThis}
                      className="gen-canvas-action"
                      style={{ fontSize: 11, padding: '5px 10px', color: 'var(--accent-primary)', borderColor: 'var(--accent-subtle)' }}
                    >
                      {isLoadingThis ? <FiLoader size={11} className="gen-spinner" /> : <FiPlay size={11} />}
                      {isLoadingThis ? 'Loading...' : 'Load to RAM'}
                    </button>
                  )}

                  {isResident && (
                    <button
                      onClick={() => handleUnload(model.id)}
                      disabled={isUnloadingThis}
                      className="gen-canvas-action"
                      style={{ fontSize: 11, padding: '5px 10px', color: '#ef4444' }}
                    >
                      {isUnloadingThis ? <FiLoader size={11} className="gen-spinner" /> : <FiPower size={11} />}
                      Unload
                    </button>
                  )}

                  {/* Playground test button */}
                  <button
                    onClick={() => navigate(getPlaygroundRoute(model))}
                    className="gen-canvas-action"
                    style={{ fontSize: 11, padding: '5px 10px' }}
                    title="Open in Studio"
                  >
                    Playground <FiArrowRight size={10} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredModels.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <FiPackage size={36} style={{ marginBottom: 12, opacity: 0.5 }} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>No models match your criteria</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Try clearing your search query or selecting another modality filter.</div>
        </div>
      )}
    </div>
  );
}

