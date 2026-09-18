import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  FiMic, FiTrash2, FiDownload, FiLoader, FiPlay,
  FiZap, FiRefreshCw, FiCopy, FiCheck, FiSliders, FiGlobe, FiFileText, FiClock, FiUploadCloud
} from 'react-icons/fi';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import api from '@/services/api';
import type { Generation, TranscriptionResponse } from '@/types';

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

function formatSeconds(sec: number): string {
  const mins = Math.floor(sec / 60);
  const secs = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function formatSrtTime(sec: number): string {
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

export default function STTPage() {
  const { generations, addGeneration, deleteGeneration, state } = useApp();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();

  // Mode: transcribe vs translate
  const [mode, setMode] = useState<'transcribe' | 'translate'>('transcribe');
  const [transcriptionFile, setTranscriptionFile] = useState<File | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [transcriptionResult, setTranscriptionResult] = useState<string | null>(null);
  const [fullResponse, setFullResponse] = useState<TranscriptionResponse | null>(null);
  const [language, setLanguage] = useState('');
  const [selectedSttModel, setSelectedSttModel] = useState('whisper-tiny');
  const [sttError, setSttError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingPercent, setGeneratingPercent] = useState(0);
  const [showGallery, setShowGallery] = useState(true);
  const [viewingGen, setViewingGen] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'text' | 'segments'>('text');
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const sttModels = state.models.filter(m =>
    (m.modalities || []).some(mod =>
      mod.toLowerCase().includes('stt') ||
      mod.toLowerCase().includes('speech') ||
      mod.toLowerCase().includes('audio') ||
      mod.toLowerCase().includes('whisper')
    )
  );

  const viewing = generations.find(g => g.id === viewingGen) || null;

  useEffect(() => {
    if (transcriptionFile) {
      const url = URL.createObjectURL(transcriptionFile);
      setAudioPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setAudioPreviewUrl(null);
    }
  }, [transcriptionFile]);

  useEffect(() => {
    if (!viewingGen) return;
    const gen = generations.find(g => g.id === viewingGen);
    if (!gen) return;
    if (gen.type === 'text') {
      setTranscriptionResult(gen.result);
      setSelectedSttModel(gen.model || 'whisper-tiny');
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
    setTranscriptionResult(gen.result);
    setFullResponse(null);
    navigate(`/stt/${gen.id}`, { replace: true });
  };

  const clearEditor = () => {
    setViewingGen(null);
    setTranscriptionFile(null);
    setTranscriptionResult(null);
    setFullResponse(null);
    setSttError(null);
    setGeneratingPercent(0);
    navigate('/stt', { replace: true });
  };

  const handleProcessAudio = useCallback(async () => {
    if (!transcriptionFile) return;
    setIsGenerating(true);
    setTranscriptionResult(null);
    setFullResponse(null);
    setSttError(null);
    setGeneratingPercent(10);

    const interval = setInterval(() => {
      setGeneratingPercent(p => Math.min(p + Math.random() * 12, 90));
    }, 400);

    try {
      let res: TranscriptionResponse;
      if (mode === 'translate') {
        res = await api.translate(transcriptionFile, selectedSttModel);
      } else {
        res = await api.transcribe(transcriptionFile, selectedSttModel, language || undefined);
      }

      clearInterval(interval);
      setGeneratingPercent(100);
      setTranscriptionResult(res.text);
      setFullResponse(res);

      addGeneration({
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
        type: 'text',
        prompt: `[${mode.toUpperCase()}] ${transcriptionFile.name}`,
        result: res.text,
        createdAt: new Date().toISOString(),
        model: selectedSttModel,
      });
    } catch (err: any) {
      clearInterval(interval);
      setSttError(err.detail || err.message || `${mode === 'translate' ? 'Translation' : 'Transcription'} failed`);
    } finally {
      setIsGenerating(false);
      setTimeout(() => setGeneratingPercent(0), 1000);
    }
  }, [transcriptionFile, selectedSttModel, language, mode, addGeneration]);

  const handleCopy = () => {
    if (!transcriptionResult) return;
    navigator.clipboard.writeText(transcriptionResult);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportTxt = () => {
    if (!transcriptionResult) return;
    const blob = new Blob([transcriptionResult], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportSrt = () => {
    if (!fullResponse?.segments?.length) {
      handleExportTxt();
      return;
    }
    const srtContent = fullResponse.segments.map((seg, idx) => {
      return `${idx + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${seg.text.trim()}\n`;
    }).join('\n');

    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `subtitles-${Date.now()}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportVtt = () => {
    if (!fullResponse?.segments?.length) {
      handleExportTxt();
      return;
    }
    let vttContent = 'WEBVTT\n\n';
    vttContent += fullResponse.segments.map((seg, idx) => {
      return `${idx + 1}\n${formatSeconds(seg.start)} --> ${formatSeconds(seg.end)}\n${seg.text.trim()}\n`;
    }).join('\n');

    const blob = new Blob([vttContent], { type: 'text/vtt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `subtitles-${Date.now()}.vtt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    if (!fullResponse && !transcriptionResult) return;
    const payload = fullResponse || { text: transcriptionResult, model: selectedSttModel };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-data-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeResultText = transcriptionResult || viewing?.result;

  return (
    <div className="gen-page">
      <div className={`gen-layout ${showGallery ? '' : 'gallery-hidden'}`}>
        {/* Left Config Panel */}
        <aside className="gen-config">
          <div className="gen-config-top">
            <div>
              <div className="gen-eyebrow">Speech Studio</div>
              <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                {mode === 'transcribe' ? 'Audio Transcription' : 'Audio Translation'}
              </h2>
            </div>
            {(viewing || transcriptionResult) && (
              <button className="gen-clear" onClick={clearEditor}>
                <FiTrash2 size={11} /> Reset
              </button>
            )}
          </div>

          {/* Mode Switcher */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
            <button
              className={`stt-mode-tab ${mode === 'transcribe' ? 'active' : ''}`}
              onClick={() => setMode('transcribe')}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: mode === 'transcribe' ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
                color: mode === 'transcribe' ? 'var(--accent-primary)' : 'var(--text-muted)',
                fontWeight: 600,
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6
              }}
            >
              <FiMic size={12} /> Transcribe
            </button>
            <button
              className={`stt-mode-tab ${mode === 'translate' ? 'active' : ''}`}
              onClick={() => setMode('translate')}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: mode === 'translate' ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
                color: mode === 'translate' ? 'var(--accent-primary)' : 'var(--text-muted)',
                fontWeight: 600,
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6
              }}
            >
              <FiGlobe size={12} /> To English
            </button>
          </div>

          {/* Audio Upload Box */}
          <div className="gen-prompt-label">
            <label className="gen-label">Source Audio File</label>
          </div>
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '16px 12px',
              border: '1px dashed var(--border-medium)',
              borderRadius: 10,
              textAlign: 'center',
              cursor: 'pointer',
              background: 'var(--bg-tertiary)',
              transition: 'all 0.2s ease',
              marginBottom: 12,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/mp4,video/webm"
              onChange={e => setTranscriptionFile(e.target.files?.[0] || null)}
              style={{ display: 'none' }}
            />
            <FiUploadCloud size={24} style={{ color: 'var(--accent-primary)', marginBottom: 6 }} />
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', wordBreak: 'break-all' }}>
              {transcriptionFile ? transcriptionFile.name : 'Upload MP3, WAV, M4A, or OGG'}
            </div>
            {transcriptionFile && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                {(transcriptionFile.size / (1024 * 1024)).toFixed(2)} MB
              </div>
            )}
          </div>

          {/* Audio Preview if uploaded */}
          {audioPreviewUrl && (
            <div style={{ marginBottom: 12 }}>
              <div className="gen-label" style={{ marginBottom: 4 }}>Audio Preview</div>
              <audio src={audioPreviewUrl} controls style={{ width: '100%', height: 32 }} />
            </div>
          )}

          {/* Model Selection */}
          <div className="gen-section">
            <div className="gen-section-head">
              <div className="gen-section-title"><FiSliders size={11} /> Model</div>
            </div>
            <select
              value={selectedSttModel}
              onChange={e => setSelectedSttModel(e.target.value)}
              className="gen-select"
            >
              {sttModels.map(m => (
                <option key={m.id} value={m.id}>
                  {m.alias || m.id} {m.size_gb ? `(${m.size_gb}GB)` : ''}
                </option>
              ))}
              <option value="whisper-tiny">whisper-tiny (Fastest)</option>
              <option value="transcribe-compact">transcribe-compact</option>
              {sttModels.length === 0 && <option value={selectedSttModel}>{selectedSttModel}</option>}
            </select>
          </div>

          {/* Language selection (only for transcription) */}
          {mode === 'transcribe' && (
            <div className="gen-section" style={{ marginTop: 8 }}>
              <div className="gen-section-head">
                <div className="gen-section-title"><FiGlobe size={11} /> Language</div>
              </div>
              <input
                type="text"
                value={language}
                onChange={e => setLanguage(e.target.value)}
                placeholder="Auto-detect (or en, es, fr, ja...)"
                className="gen-select"
                style={{ padding: '7px 10px' }}
              />
            </div>
          )}

          <button
            className="gen-submit"
            onClick={handleProcessAudio}
            disabled={isGenerating || !transcriptionFile}
            style={{ marginTop: 14 }}
          >
            {isGenerating ? <FiLoader size={13} className="gen-spinner" style={{ margin: 0 }} /> : <FiMic size={13} />}
            {isGenerating
              ? `${mode === 'translate' ? 'Translating' : 'Transcribing'} · ${Math.round(generatingPercent)}%`
              : mode === 'translate' ? 'Translate Audio to English' : 'Transcribe Audio'}
          </button>

          {sttError && <div className="gen-error" style={{ marginTop: 10 }}>{sttError}</div>}
        </aside>

        {/* Center Main Canvas */}
        <main className="gen-canvas">
          <div className="gen-canvas-toolbar">
            <div className="gen-canvas-meta">
              <span className={`gen-status-dot ${isGenerating ? 'live' : ''}`} />
              {isGenerating
                ? `${mode === 'translate' ? 'Translating speech' : 'Transcribing audio'}...`
                : viewing
                  ? `Saved Transcript · ${formatTime(viewing.createdAt)}`
                  : activeResultText
                    ? 'Transcription Result'
                    : 'Speech Studio Canvas'}
            </div>

            <div className="gen-canvas-actions">
              {activeResultText && (
                <>
                  <button
                    className="gen-canvas-action"
                    onClick={handleCopy}
                    title="Copy full text"
                  >
                    {copied ? <FiCheck size={11} color="var(--accent-primary)" /> : <FiCopy size={11} />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    className="gen-canvas-action"
                    onClick={handleExportTxt}
                    title="Download Plain Text"
                  >
                    <FiDownload size={11} /> TXT
                  </button>
                  {fullResponse?.segments && (
                    <>
                      <button
                        className="gen-canvas-action"
                        onClick={handleExportSrt}
                        title="Download Subtitles (.srt)"
                      >
                        <FiDownload size={11} /> SRT
                      </button>
                      <button
                        className="gen-canvas-action"
                        onClick={handleExportVtt}
                        title="Download WebVTT (.vtt)"
                      >
                        <FiDownload size={11} /> VTT
                      </button>
                    </>
                  )}
                  <button
                    className="gen-canvas-action"
                    onClick={handleExportJson}
                    title="Download JSON Metadata"
                  >
                    <FiDownload size={11} /> JSON
                  </button>
                </>
              )}
              <button className="gen-canvas-action" onClick={() => setShowGallery(v => !v)}>
                <FiPlay size={10} /> History
              </button>
            </div>
          </div>

          <div className="gen-workspace" style={{ padding: 24, overflowY: 'auto' }}>
            {isGenerating && (
              <div className="gen-generating">
                <FiLoader size={32} className="gen-spinner" />
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 12 }}>
                  {mode === 'translate' ? 'Translating audio into English' : 'Transcribing speech to text'}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4 }}>
                  {Math.round(generatingPercent)}% · Model: {selectedSttModel}
                </div>
                <div className="gen-progress" style={{ width: 220, marginTop: 12 }}>
                  <div style={{ width: `${generatingPercent}%` }} />
                </div>
              </div>
            )}

            {!isGenerating && activeResultText && (
              <div style={{ maxWidth: 840, margin: '0 auto', width: '100%' }}>
                {fullResponse?.segments && fullResponse.segments.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    <button
                      onClick={() => setActiveTab('text')}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: '1px solid var(--border-subtle)',
                        background: activeTab === 'text' ? 'var(--bg-card)' : 'transparent',
                        color: activeTab === 'text' ? 'var(--accent-primary)' : 'var(--text-muted)',
                        fontWeight: 600,
                        fontSize: 11,
                        cursor: 'pointer'
                      }}
                    >
                      <FiFileText size={11} style={{ marginRight: 4 }} /> Full Transcript
                    </button>
                    <button
                      onClick={() => setActiveTab('segments')}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: '1px solid var(--border-subtle)',
                        background: activeTab === 'segments' ? 'var(--bg-card)' : 'transparent',
                        color: activeTab === 'segments' ? 'var(--accent-primary)' : 'var(--text-muted)',
                        fontWeight: 600,
                        fontSize: 11,
                        cursor: 'pointer'
                      }}
                    >
                      <FiClock size={11} style={{ marginRight: 4 }} /> Timestamps ({fullResponse.segments.length})
                    </button>
                  </div>
                )}

                {activeTab === 'text' || !fullResponse?.segments?.length ? (
                  <div
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 12,
                      padding: 24,
                      fontSize: 14,
                      lineHeight: 1.7,
                      color: 'var(--text-primary)',
                      whiteSpace: 'pre-wrap',
                      boxShadow: 'var(--shadow-sm)'
                    }}
                  >
                    {activeResultText}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {fullResponse.segments.map(seg => (
                      <div
                        key={seg.id}
                        style={{
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 8,
                          padding: '10px 14px',
                          display: 'flex',
                          gap: 16,
                          alignItems: 'baseline'
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontFamily: 'monospace',
                            color: 'var(--accent-primary)',
                            background: 'var(--accent-subtle)',
                            padding: '2px 6px',
                            borderRadius: 4,
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {formatSeconds(seg.start)} - {formatSeconds(seg.end)}
                        </span>
                        <span style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                          {seg.text.trim()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {viewing?.prompt && (
                  <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                    Source: {viewing.prompt}
                  </div>
                )}
              </div>
            )}

            {!isGenerating && !activeResultText && (
              <div className="gen-empty">
                <div className="gen-empty-icon"><FiMic size={24} /></div>
                <div className="gen-empty-title">Speech-to-Text Studio</div>
                <div className="gen-empty-copy">
                  Upload an audio file (speech, podcast, interview) to transcribe in original language or translate directly to English.
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Right Gallery Panel */}
        {showGallery && (
          <aside className="gen-gallery">
            <div className="gen-gallery-title">
              <strong>Transcript History</strong>
              <span>{generations.filter(g => g.type === 'text').length}</span>
            </div>

            {generations.filter(g => g.type === 'text').length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.5, padding: '16px 8px' }}>
                Your transcriptions and audio translations will be cataloged here.
              </div>
            ) : (
              <div className="gen-gallery-grid">
                {generations.filter(g => g.type === 'text').map(gen => {
                  const isSelected = gen.id === viewingGen;
                  return (
                    <div
                      key={gen.id}
                      onClick={() => loadIntoEditor(gen)}
                      className={`gen-card ${isSelected ? 'selected' : ''}`}
                    >
                      <div className="gen-card-meta">
                        <div className="gen-card-type">
                          <FiMic size={9} />
                          Text
                          <span>·</span>{formatTime(gen.createdAt)}
                        </div>
                        <button
                          className="gen-card-delete"
                          title="Delete"
                          onClick={e => {
                            e.stopPropagation();
                            deleteGeneration(gen.id);
                            if (viewingGen === gen.id) clearEditor();
                          }}
                        >
                          <FiTrash2 size={9} />
                        </button>
                      </div>
                      <div className="gen-card-text" style={{ fontSize: 11, WebkitLineClamp: 3 }}>
                        {gen.result}
                      </div>
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