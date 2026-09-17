import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  FiMusic, FiTrash2, FiDownload, FiLoader, FiPlay,
  FiZap, FiRefreshCw, FiCopy, FiPlus, FiMinus, FiMaximize2, FiSliders, FiChevronDown, FiInfo
} from 'react-icons/fi';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import api from '@/services/api';
import type { Generation } from '@/types';

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

export default function MusicPage() {
  const { generations, addGeneration, deleteGeneration, state } = useApp();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();

  // Audio / Music generation
  const [audioPrompt, setAudioPrompt] = useState('');
  const [audioResult, setAudioResult] = useState<string | null>(null);
  const [selectedAudioModel, setSelectedAudioModel] = useState(
    state.models.filter(m => (m.modalities || []).some(mod => mod.toLowerCase().includes('audio') || mod.toLowerCase().includes('music')))[0]?.id || 'music-compact'
  );
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingPercent, setGeneratingPercent] = useState(0);
  const [showGallery, setShowGallery] = useState(true);
  const [viewingGen, setViewingGen] = useState<string | null>(null);

  const audioModels = state.models.filter(m => (m.modalities || []).some(mod => mod.toLowerCase().includes('audio') || mod.toLowerCase().includes('music')));

  const audioRef = useRef<HTMLAudioElement>(null);

  const viewing = generations.find(g => g.id === viewingGen) || null;

  useEffect(() => {
    if (!viewingGen) return;
    const gen = generations.find(g => g.id === viewingGen);
    if (!gen) return;
    if (gen.type === 'audio') {
      setAudioPrompt(gen.prompt);
      setAudioResult(gen.result);
      setSelectedAudioModel(gen.model);
    }
  }, [viewingGen, generations]);

  useEffect(() => {
    if (!params.id || params.id === viewingGen) return;
    const gen = generations.find(g => g.id === params.id);
    if (gen && gen.type === 'audio') {
      setViewingGen(gen.id);
    }
  }, [params.id, viewingGen, generations]);

  const loadIntoEditor = (gen: Generation) => {
    setViewingGen(gen.id);
    navigate(`/music/${gen.id}`, { replace: true });
  };

  const clearEditor = () => {
    setViewingGen(null);
    setAudioPrompt('');
    setAudioResult(null);
    setAudioError(null);
    setGeneratingPercent(0);
    navigate('/music', { replace: true });
  };

  const handleGenerateAudio = useCallback(async () => {
    if (!audioPrompt.trim()) return;
    setIsGenerating(true);
    setAudioResult(null);
    setAudioError(null);
    setGeneratingPercent(0);
    const interval = setInterval(() => setGeneratingPercent(p => Math.min(p + Math.random() * 15, 90)), 500);

    try {
      const res = await api.generateAudio(audioPrompt, selectedAudioModel, 3);
      clearInterval(interval);
      setGeneratingPercent(100);
      const b64 = res.data?.[0]?.b64_json;
      if (b64) {
        const url = `data:audio/wav;base64,${b64}`;
        setAudioResult(url);
        addGeneration({
          id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
          type: 'audio',
          prompt: audioPrompt,
          result: url,
          createdAt: new Date().toISOString(),
          model: selectedAudioModel,
        });
      }
    } catch (err: any) {
      clearInterval(interval);
      setAudioError(err.detail || err.message || 'Audio generation failed');
    } finally {
      setIsGenerating(false);
      setTimeout(() => setGeneratingPercent(0), 1000);
    }
  }, [audioPrompt, selectedAudioModel, addGeneration]);

  return (
    <div className="gen-page">
      <div className={`gen-layout ${showGallery ? '' : 'gallery-hidden'}`}>
        <aside className="gen-config">
          <div className="gen-config-top">
            <div>
              <div className="gen-eyebrow">Audio generation</div>
              {viewing && <div style={{ color: '#596473', fontSize: 8, marginTop: 4 }}>Editing {viewing.id.slice(0, 8)}</div>}
            </div>
            {viewing && (
              <button className="gen-clear" onClick={clearEditor}><FiTrash2 size={11} /> New</button>
            )}
          </div>

          <div className="gen-prompt-label"><label className="gen-label">Prompt</label></div>
          <textarea value={audioPrompt} onChange={e => setAudioPrompt(e.target.value)} placeholder="Describe the music you want to generate..." className="gen-textarea" />
          <div className="gen-section">
            <div className="gen-section-head"><div className="gen-section-title"><FiSliders size={11} /> Model</div></div>
            <select value={selectedAudioModel} onChange={e => setSelectedAudioModel(e.target.value)} className="gen-select">
              {audioModels.map(m => <option key={m.id} value={m.id}>{m.alias || m.id}</option>)}
              {audioModels.length === 0 && <option value={selectedAudioModel}>{selectedAudioModel}</option>}
            </select>
          </div>
          <button className="gen-submit" onClick={handleGenerateAudio} disabled={isGenerating || !audioPrompt.trim()}>
            {isGenerating ? <FiLoader size={13} className="gen-spinner" style={{ margin: 0 }} /> : <FiMusic size={13} />}
            {isGenerating ? `Generating · ${Math.round(generatingPercent)}%` : 'Generate Audio'}
          </button>
          {audioError && <div className="gen-error">{audioError}</div>}
        </aside>

        <main className="gen-canvas">
          <div className="gen-canvas-toolbar">
            <div className="gen-canvas-meta">
              <span className={`gen-status-dot ${isGenerating ? 'live' : ''}`} />
              {isGenerating ? 'Generating' : viewing ? `Audio · ${formatTime(viewing.createdAt)}` : 'Preview'}
            </div>
            <div className="gen-canvas-actions">
              <button className="gen-canvas-action" onClick={() => setShowGallery(v => !v)}><FiPlay size={10} /> Gallery</button>
            </div>
          </div>

          <div className="gen-workspace">
            {isGenerating && (
              <div className="gen-generating">
                <FiLoader size={28} className="gen-spinner" />
                <div>Creating your audio</div>
                <div style={{ color: '#56616e', fontSize: 9, marginTop: 5 }}>{Math.round(generatingPercent)}% · {selectedAudioModel}</div>
                <div className="gen-progress"><div style={{ width: `${generatingPercent}%` }} /></div>
              </div>
            )}

            {!isGenerating && viewing?.type === 'audio' && (
              <div className="gen-result-wrap">
                <audio ref={audioRef} src={viewing.result} controls className="gen-audio-player" />
                <div className="gen-viewing-prompt">{viewing.prompt}</div>
              </div>
            )}

            {!isGenerating && !viewing && (
              <div className="gen-empty">
                <div className="gen-empty-icon"><FiMusic size={22} /></div>
                <div className="gen-empty-title">Ready when you are</div>
                <div className="gen-empty-copy">Write a prompt, pick a model, and generate your next track.</div>
              </div>
            )}
          </div>
        </main>

        {showGallery && (
          <aside className="gen-gallery">
            <div className="gen-gallery-title">
              <strong>Gallery</strong>
              <span>{generations.filter(g => g.type === 'audio').length}</span>
            </div>

            {generations.filter(g => g.type === 'audio').length === 0 ? (
              <div style={{ color: '#596473', fontSize: 10, lineHeight: 1.5, padding: '15px 4px' }}>
                Your generated audio will appear here.
              </div>
            ) : (
              <div className="gen-gallery-grid">
                {generations.filter(g => g.type === 'audio').map(gen => {
                  const isSelected = gen.id === viewingGen;
                  return (
                    <div key={gen.id} onClick={() => loadIntoEditor(gen)} className={`gen-card ${isSelected ? 'selected' : ''}`}>
                      <div className="gen-card-meta">
                        <div className="gen-card-type">
                          <FiMusic size={9} />
                          Audio
                          <span>·</span>{formatTime(gen.createdAt)}
                        </div>
                        <button
                          className="gen-card-delete"
                          title="Delete"
                          onClick={e => { e.stopPropagation(); deleteGeneration(gen.id); if (viewingGen === gen.id) clearEditor(); }}
                        >
                          <FiTrash2 size={9} />
                        </button>
                      </div>
                      <div className="gen-card-audio"><FiPlay size={10} /> Audio generation</div>
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}