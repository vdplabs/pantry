import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  FiMic, FiTrash2, FiDownload, FiLoader, FiPlay,
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

export default function STTPage() {
  const { generations, addGeneration, deleteGeneration, state } = useApp();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();

  // STT / Transcription
  const [transcriptionFile, setTranscriptionFile] = useState<File | null>(null);
  const [transcriptionResult, setTranscriptionResult] = useState<string | null>(null);
  const [selectedSttModel, setSelectedSttModel] = useState('whisper-tiny');
  const [sttError, setSttError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingPercent, setGeneratingPercent] = useState(0);
  const [showGallery, setShowGallery] = useState(true);
  const [viewingGen, setViewingGen] = useState<string | null>(null);

  const sttModels = state.models.filter(m => (m.modalities || []).some(mod => mod.toLowerCase().includes('stt') || mod.toLowerCase().includes('speech')));

  const viewing = generations.find(g => g.id === viewingGen) || null;

  useEffect(() => {
    if (!viewingGen) return;
    const gen = generations.find(g => g.id === viewingGen);
    if (!gen) return;
    if (gen.type === 'text') {
      setTranscriptionResult(gen.result);
      setSelectedSttModel(gen.model);
    }
  }, [viewingGen, generations]);

  useEffect(() => {
    if (!params.id || params.id === viewingGen) return;
    const gen = generations.find(g => g.id === params.id);
    if (gen && gen.type === 'text') {
      setViewingGen(gen.id);
    }
  }, [params.id, viewingGen, generations]);

  const loadIntoEditor = (gen: Generation) => {
    setViewingGen(gen.id);
    navigate(`/stt/${gen.id}`, { replace: true });
  };

  const clearEditor = () => {
    setViewingGen(null);
    setTranscriptionFile(null);
    setTranscriptionResult(null);
    setSttError(null);
    setGeneratingPercent(0);
    navigate('/stt', { replace: true });
  };

  const handleTranscribe = useCallback(async () => {
    if (!transcriptionFile) return;
    setIsGenerating(true);
    setTranscriptionResult(null);
    setSttError(null);
    setGeneratingPercent(0);
    const interval = setInterval(() => setGeneratingPercent(p => Math.min(p + Math.random() * 15, 90)), 500);

    try {
      const res = await api.transcribe(transcriptionFile, selectedSttModel);
      clearInterval(interval);
      setGeneratingPercent(100);
      setTranscriptionResult(res.text);
      addGeneration({
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
        type: 'text',
        prompt: transcriptionFile.name,
        result: res.text,
        createdAt: new Date().toISOString(),
        model: selectedSttModel,
      });
    } catch (err: any) {
      clearInterval(interval);
      setSttError(err.detail || err.message || 'Transcription failed');
    } finally {
      setIsGenerating(false);
      setTimeout(() => setGeneratingPercent(0), 1000);
    }
  }, [transcriptionFile, selectedSttModel, addGeneration]);

  return (
    <div className="gen-page">
      <div className={`gen-layout ${showGallery ? '' : 'gallery-hidden'}`}>
        <aside className="gen-config">
          <div className="gen-config-top">
            <div>
              <div className="gen-eyebrow">Speech to text</div>
              {viewing && <div style={{ color: '#596473', fontSize: 8, marginTop: 4 }}>Editing {viewing.id.slice(0, 8)}</div>}
            </div>
            {viewing && (
              <button className="gen-clear" onClick={clearEditor}><FiTrash2 size={11} /> New</button>
            )}
          </div>

          <div className="gen-prompt-label"><label className="gen-label">Audio file</label></div>
          <label className="gen-upload">
            <input type="file" accept="audio/*" onChange={e => setTranscriptionFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
            <FiMic size={18} style={{ marginBottom: 8 }} />
            <div>{transcriptionFile ? transcriptionFile.name : 'Choose an audio file'}</div>
          </label>
          <div className="gen-section">
            <div className="gen-section-head"><div className="gen-section-title"><FiSliders size={11} /> Model</div></div>
            <select value={selectedSttModel} onChange={e => setSelectedSttModel(e.target.value)} className="gen-select">
              {sttModels.map(m => <option key={m.id} value={m.id}>{m.alias || m.id}</option>)}
              <option value="whisper-tiny">whisper-tiny</option>
              {sttModels.length === 0 && <option value={selectedSttModel}>{selectedSttModel}</option>}
            </select>
          </div>
          <button className="gen-submit" onClick={handleTranscribe} disabled={isGenerating || !transcriptionFile}>
            {isGenerating ? <FiLoader size={13} className="gen-spinner" style={{ margin: 0 }} /> : <FiMic size={13} />}
            {isGenerating ? `Transcribing · ${Math.round(generatingPercent)}%` : 'Transcribe'}
          </button>
          {sttError && <div className="gen-error">{sttError}</div>}
        </aside>

        <main className="gen-canvas">
          <div className="gen-canvas-toolbar">
            <div className="gen-canvas-meta">
              <span className={`gen-status-dot ${isGenerating ? 'live' : ''}`} />
              {isGenerating ? 'Transcribing' : viewing ? `Transcript · ${formatTime(viewing.createdAt)}` : 'Preview'}
            </div>
            <div className="gen-canvas-actions">
              <button className="gen-canvas-action" onClick={() => setShowGallery(v => !v)}><FiPlay size={10} /> Gallery</button>
            </div>
          </div>

          <div className="gen-workspace">
            {isGenerating && (
              <div className="gen-generating">
                <FiLoader size={28} className="gen-spinner" />
                <div>Transcribing your audio</div>
                <div style={{ color: '#56616e', fontSize: 9, marginTop: 5 }}>{Math.round(generatingPercent)}% · {selectedSttModel}</div>
                <div className="gen-progress"><div style={{ width: `${generatingPercent}%` }} /></div>
              </div>
            )}

            {!isGenerating && viewing?.type === 'text' && (
              <div className="gen-result-wrap">
                <div className="gen-transcript">{viewing.result}</div>
                <div className="gen-viewing-prompt">{viewing.prompt}</div>
              </div>
            )}

            {!isGenerating && !viewing && (
              <div className="gen-empty">
                <div className="gen-empty-icon"><FiMic size={22} /></div>
                <div className="gen-empty-title">Ready when you are</div>
                <div className="gen-empty-copy">Upload an audio file and transcribe it to text.</div>
              </div>
            )}
          </div>
        </main>

        {showGallery && (
          <aside className="gen-gallery">
            <div className="gen-gallery-title">
              <strong>Gallery</strong>
              <span>{generations.filter(g => g.type === 'text').length}</span>
            </div>

            {generations.filter(g => g.type === 'text').length === 0 ? (
              <div style={{ color: '#596473', fontSize: 10, lineHeight: 1.5, padding: '15px 4px' }}>
                Your transcripts will appear here.
              </div>
            ) : (
              <div className="gen-gallery-grid">
                {generations.filter(g => g.type === 'text').map(gen => {
                  const isSelected = gen.id === viewingGen;
                  return (
                    <div key={gen.id} onClick={() => loadIntoEditor(gen)} className={`gen-card ${isSelected ? 'selected' : ''}`}>
                      <div className="gen-card-meta">
                        <div className="gen-card-type">
                          <FiMic size={9} />
                          Text
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
                      <div className="gen-card-text">{gen.result}</div>
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