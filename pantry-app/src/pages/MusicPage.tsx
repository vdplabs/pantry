import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  FiMusic, FiTrash2, FiDownload, FiLoader, FiPlay, FiPause,
  FiZap, FiRefreshCw, FiCopy, FiCheck, FiSliders, FiClock, FiVolume2, FiRepeat
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

const MUSIC_PRESETS = [
  { label: '☕ Lo-Fi Study', prompt: 'Chill lo-fi hip hop beat with smooth rhodes chords, soft jazz drums, and relaxing vinyl crackle' },
  { label: '🌌 Cyberpunk Synth', prompt: 'Dark synthwave track with driving 80s bassline, punchy snare, and futuristic neon arpeggios' },
  { label: '⚔️ Epic Cinematic', prompt: 'Dynamic cinematic film score with soaring strings, thunderous taiko drums, and brass swells' },
  { label: '🎸 Acoustic Folk', prompt: 'Warm acoustic guitar fingerpicking ballad with gentle rhythmic accompaniment and campfire vibe' },
  { label: '🕹️ 8-Bit Chiptune', prompt: 'Upbeat retro arcade video game background music with energetic square waves and catchy melody' },
  { label: '🧘 Ambient Meditation', prompt: 'Deep meditative ambient drone with peaceful Tibetan singing bowls and gentle ocean breeze' },
];

export default function MusicPage() {
  const { generations, addGeneration, deleteGeneration, state } = useApp();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();

  const [audioPrompt, setAudioPrompt] = useState('');
  const [duration, setDuration] = useState(5);
  const [audioResult, setAudioResult] = useState<string | null>(null);
  const [selectedAudioModel, setSelectedAudioModel] = useState(
    state.models.filter(m => (m.modalities || []).some(mod => mod.toLowerCase().includes('audio') || mod.toLowerCase().includes('music')))[0]?.id || 'music-compact'
  );
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingPercent, setGeneratingPercent] = useState(0);
  const [showGallery, setShowGallery] = useState(true);
  const [viewingGen, setViewingGen] = useState<string | null>(null);

  // Custom player states
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);

  const audioModels = state.models.filter(m =>
    (m.modalities || []).some(mod =>
      mod.toLowerCase().includes('audio') ||
      mod.toLowerCase().includes('music') ||
      mod.toLowerCase().includes('sound')
    )
  );

  const audioRef = useRef<HTMLAudioElement>(null);
  const viewing = generations.find(g => g.id === viewingGen) || null;

  useEffect(() => {
    if (!viewingGen) return;
    const gen = generations.find(g => g.id === viewingGen);
    if (!gen) return;
    if (gen.type === 'audio') {
      setAudioPrompt(gen.prompt);
      setAudioResult(gen.result);
      setSelectedAudioModel(gen.model || 'music-compact');
      setIsPlaying(false);
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
    setAudioResult(gen.result);
    setAudioPrompt(gen.prompt);
    navigate(`/music/${gen.id}`, { replace: true });
  };

  const clearEditor = () => {
    setViewingGen(null);
    setAudioPrompt('');
    setAudioResult(null);
    setAudioError(null);
    setGeneratingPercent(0);
    setIsPlaying(false);
    navigate('/music', { replace: true });
  };

  const handleGenerateAudio = useCallback(async () => {
    if (!audioPrompt.trim()) return;
    setIsGenerating(true);
    setAudioResult(null);
    setAudioError(null);
    setGeneratingPercent(10);
    setIsPlaying(false);

    const interval = setInterval(() => {
      setGeneratingPercent(p => Math.min(p + Math.random() * 12, 90));
    }, 400);

    try {
      const res = await api.generateAudio(audioPrompt, selectedAudioModel, duration);
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
      } else if (res.data?.[0]?.url) {
        setAudioResult(res.data[0].url);
        addGeneration({
          id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
          type: 'audio',
          prompt: audioPrompt,
          result: res.data[0].url,
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
  }, [audioPrompt, selectedAudioModel, duration, addGeneration]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleDownload = () => {
    const src = audioResult || viewing?.result;
    if (!src) return;
    const a = document.createElement('a');
    a.href = src;
    a.download = `music-gen-${Date.now()}.wav`;
    a.click();
  };

  const activeAudioSrc = audioResult || viewing?.result;

  return (
    <div className="gen-page">
      <div className={`gen-layout ${showGallery ? '' : 'gallery-hidden'}`}>
        {/* Left Config Panel */}
        <aside className="gen-config">
          <div className="gen-config-top">
            <div>
              <div className="gen-eyebrow">Audio & Music Studio</div>
              <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Synthesize Audio
              </h2>
            </div>
            {(viewing || audioResult || audioPrompt) && (
              <button className="gen-clear" onClick={clearEditor}>
                <FiTrash2 size={11} /> Reset
              </button>
            )}
          </div>

          <div className="gen-prompt-label">
            <label className="gen-label">Music Prompt</label>
          </div>
          <textarea
            value={audioPrompt}
            onChange={e => setAudioPrompt(e.target.value)}
            placeholder="Describe the mood, instruments, rhythm, and genre..."
            className="gen-textarea"
            rows={4}
          />

          {/* Preset Chips */}
          <div style={{ marginTop: 8, marginBottom: 12 }}>
            <div className="gen-label" style={{ marginBottom: 6 }}>Inspiration Presets</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {MUSIC_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  onClick={() => setAudioPrompt(preset.prompt)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)',
                    fontSize: 10,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Model Selection */}
          <div className="gen-section">
            <div className="gen-section-head">
              <div className="gen-section-title"><FiSliders size={11} /> Model</div>
            </div>
            <select
              value={selectedAudioModel}
              onChange={e => setSelectedAudioModel(e.target.value)}
              className="gen-select"
            >
              {audioModels.map(m => (
                <option key={m.id} value={m.id}>
                  {m.alias || m.id} {m.size_gb ? `(${m.size_gb}GB)` : ''}
                </option>
              ))}
              <option value="music-compact">music-compact</option>
              <option value="audio-standard">audio-standard</option>
              {audioModels.length === 0 && <option value={selectedAudioModel}>{selectedAudioModel}</option>}
            </select>
          </div>

          {/* Duration Slider */}
          <div className="gen-section" style={{ marginTop: 8 }}>
            <div className="gen-section-head" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div className="gen-section-title"><FiClock size={11} /> Duration</div>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-primary)' }}>{duration}s</span>
            </div>
            <input
              type="range"
              min={2}
              max={30}
              step={1}
              value={duration}
              onChange={e => setDuration(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
            />
          </div>

          <button
            className="gen-submit"
            onClick={handleGenerateAudio}
            disabled={isGenerating || !audioPrompt.trim()}
            style={{ marginTop: 14 }}
          >
            {isGenerating ? <FiLoader size={13} className="gen-spinner" style={{ margin: 0 }} /> : <FiMusic size={13} />}
            {isGenerating ? `Generating · ${Math.round(generatingPercent)}%` : 'Generate Audio'}
          </button>

          {audioError && <div className="gen-error" style={{ marginTop: 10 }}>{audioError}</div>}
        </aside>

        {/* Center Main Canvas */}
        <main className="gen-canvas">
          <div className="gen-canvas-toolbar">
            <div className="gen-canvas-meta">
              <span className={`gen-status-dot ${isGenerating ? 'live' : ''}`} />
              {isGenerating
                ? 'Synthesizing audio track...'
                : viewing
                  ? `Saved Audio · ${formatTime(viewing.createdAt)}`
                  : activeAudioSrc
                    ? 'Generated Audio Track'
                    : 'Audio Studio Canvas'}
            </div>

            <div className="gen-canvas-actions">
              {activeAudioSrc && (
                <button
                  className="gen-canvas-action"
                  onClick={handleDownload}
                  title="Download WAV file"
                >
                  <FiDownload size={11} /> Download WAV
                </button>
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
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 12 }}>Creating audio waveform</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4 }}>
                  {Math.round(generatingPercent)}% · Model: {selectedAudioModel}
                </div>
                <div className="gen-progress" style={{ width: 220, marginTop: 12 }}>
                  <div style={{ width: `${generatingPercent}%` }} />
                </div>
              </div>
            )}

            {!isGenerating && activeAudioSrc && (
              <div
                style={{
                  maxWidth: 640,
                  margin: '0 auto',
                  width: '100%',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 16,
                  padding: 24,
                  boxShadow: 'var(--shadow-md)',
                  textAlign: 'center'
                }}
              >
                {/* Audio Icon & Wave Graphic */}
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: '50%',
                    background: 'var(--accent-subtle)',
                    color: 'var(--accent-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px auto',
                    boxShadow: '0 0 20px rgba(59, 130, 246, 0.2)'
                  }}
                >
                  <FiMusic size={32} />
                </div>

                {/* Prompt Info */}
                <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                  {viewing?.prompt || audioPrompt || 'Generated Music Track'}
                </h3>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20 }}>
                  Model: {viewing?.model || selectedAudioModel}
                </div>

                {/* Audio Player Controls */}
                <audio
                  ref={audioRef}
                  src={activeAudioSrc}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onTimeUpdate={() => {
                    if (audioRef.current) {
                      setCurrentTime(audioRef.current.currentTime);
                      setTotalDuration(audioRef.current.duration || 0);
                    }
                  }}
                  onEnded={() => setIsPlaying(false)}
                  style={{ display: 'none' }}
                />

                {/* Visual Progress Bar */}
                <div style={{ marginBottom: 16 }}>
                  <input
                    type="range"
                    min={0}
                    max={totalDuration || 100}
                    step={0.1}
                    value={currentTime}
                    onChange={e => {
                      const val = Number(e.target.value);
                      setCurrentTime(val);
                      if (audioRef.current) audioRef.current.currentTime = val;
                    }}
                    style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                    <span>{currentTime.toFixed(1)}s</span>
                    <span>{totalDuration ? `${totalDuration.toFixed(1)}s` : `${duration}s`}</span>
                  </div>
                </div>

                {/* Playback Buttons */}
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16 }}>
                  <button
                    onClick={togglePlay}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      background: 'var(--accent-primary)',
                      color: '#ffffff',
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
                      transition: 'transform 0.15s ease'
                    }}
                    onMouseDown={e => e.currentTarget.style.transform = 'scale(0.95)'}
                    onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    {isPlaying ? <FiPause size={18} /> : <FiPlay size={18} style={{ marginLeft: 2 }} />}
                  </button>

                  <button
                    onClick={handleDownload}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                  >
                    <FiDownload size={13} /> Save WAV
                  </button>
                </div>
              </div>
            )}

            {!isGenerating && !activeAudioSrc && (
              <div className="gen-empty">
                <div className="gen-empty-icon"><FiMusic size={24} /></div>
                <div className="gen-empty-title">Music & Sound Studio</div>
                <div className="gen-empty-copy">
                  Enter a musical description or select an inspiration preset to synthesize realistic music loops and soundscapes.
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Right Gallery Panel */}
        {showGallery && (
          <aside className="gen-gallery">
            <div className="gen-gallery-title">
              <strong>Audio Gallery</strong>
              <span>{generations.filter(g => g.type === 'audio').length}</span>
            </div>

            {generations.filter(g => g.type === 'audio').length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.5, padding: '16px 8px' }}>
                Your generated audio tracks will be cataloged here.
              </div>
            ) : (
              <div className="gen-gallery-grid">
                {generations.filter(g => g.type === 'audio').map(gen => {
                  const isSelected = gen.id === viewingGen;
                  return (
                    <div
                      key={gen.id}
                      onClick={() => loadIntoEditor(gen)}
                      className={`gen-card ${isSelected ? 'selected' : ''}`}
                    >
                      <div className="gen-card-meta">
                        <div className="gen-card-type">
                          <FiMusic size={9} />
                          Audio
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
                      <div className="gen-card-text" style={{ fontSize: 11, WebkitLineClamp: 2 }}>
                        {gen.prompt}
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