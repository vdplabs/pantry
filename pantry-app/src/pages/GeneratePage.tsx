import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  FiImage, FiMusic, FiMic, FiTrash2, FiDownload, FiLoader, FiPlay,
  FiGrid, FiX, FiChevronDown, FiSliders, FiZap, FiRefreshCw, FiCopy,
  FiPlus, FiMinus, FiMaximize2, FiInfo
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

type LoraAdapter = {
  id: string;
  name: string;
  weight?: number;
};

const FALLBACK_LORAS: LoraAdapter[] = [];

export default function GeneratePage() {
  const { generations, addGeneration, deleteGeneration, state } = useApp();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();

  const [activeSubTab, setActiveSubTab] = useState<'image' | 'audio' | 'stt'>('image');

  // Image generation
  const [imagePrompt, setImagePrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [imageResult, setImageResult] = useState<string | null>(null);
  const [selectedImageModel, setSelectedImageModel] = useState('image-standard');
  const [imageSize, setImageSize] = useState('1024x1024');
  const [imageCount, setImageCount] = useState(1);
  const [steps, setSteps] = useState(28);
  const [cfg, setCfg] = useState(7);
  const [seed, setSeed] = useState(-1);
  const [sampler, setSampler] = useState('DPM++ 2M Karras');
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [selectedLoras, setSelectedLoras] = useState<LoraAdapter[]>([]);

  // Audio / STT
  const [audioPrompt, setAudioPrompt] = useState('');
  const [audioResult, setAudioResult] = useState<string | null>(null);
  const [selectedAudioModel, setSelectedAudioModel] = useState(
    state.models.filter(m => (m.modalities || []).some(mod => mod.toLowerCase().includes('audio') || mod.toLowerCase().includes('music')))[0]?.id || 'music-compact'
  );
  const [transcriptionFile, setTranscriptionFile] = useState<File | null>(null);
  const [transcriptionResult, setTranscriptionResult] = useState<string | null>(null);
  const [selectedSttModel, setSelectedSttModel] = useState('whisper-tiny');

  const [imageError, setImageError] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [sttError, setSttError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingPercent, setGeneratingPercent] = useState(0);
  const [showGallery, setShowGallery] = useState(true);
  const [viewingGen, setViewingGen] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);

  const imageModels = state.models.filter(m => (m.modalities || []).some(mod => mod.toLowerCase().includes('image')));
  const audioModels = state.models.filter(m => (m.modalities || []).some(mod => mod.toLowerCase().includes('audio') || mod.toLowerCase().includes('music')));
  const sttModels = state.models.filter(m => (m.modalities || []).some(mod => mod.toLowerCase().includes('stt') || mod.toLowerCase().includes('speech')));

  // If AppContext exposes LoRAs, use them. The fallback is intentionally empty rather
  // than inventing adapters that may not exist on the user's local model host.
  const loraAdapters: LoraAdapter[] =
    ((state as any).loraAdapters || (state as any).loras || FALLBACK_LORAS) as LoraAdapter[];

  const viewing = generations.find(g => g.id === viewingGen) || null;

  useEffect(() => {
    if (!viewingGen) return;
    const gen = generations.find(g => g.id === viewingGen);
    if (!gen) return;
    if (gen.type === 'image') {
      setImagePrompt(gen.prompt);
      setImageResult(gen.result);
      setSelectedImageModel(gen.model);
    }
    if (gen.type === 'audio') {
      setAudioPrompt(gen.prompt);
      setAudioResult(gen.result);
      setSelectedAudioModel(gen.model);
    }
    if (gen.type === 'text') {
      setTranscriptionResult(gen.result);
      setSelectedSttModel(gen.model);
    }
  }, [viewingGen, generations]);

  useEffect(() => {
    if (!params.id || params.id === viewingGen) return;
    const gen = generations.find(g => g.id === params.id);
    if (gen) {
      setViewingGen(gen.id);
      setActiveSubTab(gen.type === 'audio' ? 'audio' : gen.type === 'image' ? 'image' : 'stt');
    }
  }, [params.id, viewingGen, generations]);

  const loadIntoEditor = (gen: Generation) => {
    setViewingGen(gen.id);
    setActiveSubTab(gen.type === 'audio' ? 'audio' : gen.type === 'image' ? 'image' : 'stt');
    navigate(`/generate/${gen.id}`, { replace: true });
  };

  const clearEditor = () => {
    setViewingGen(null);
    setImagePrompt('');
    setNegativePrompt('');
    setImageResult(null);
    setAudioPrompt('');
    setAudioResult(null);
    setTranscriptionResult(null);
    setImageError(null);
    setAudioError(null);
    setSttError(null);
    setGeneratingPercent(0);
    navigate('/generate', { replace: true });
  };

  const randomizeSeed = () => setSeed(Math.floor(Math.random() * 2147483647));

  const toggleLora = (lora: LoraAdapter) => {
    setSelectedLoras(current =>
      current.some(x => x.id === lora.id)
        ? current.filter(x => x.id !== lora.id)
        : [...current, { ...lora, weight: lora.weight ?? 1 }]
    );
  };

  const updateLoraWeight = (id: string, weight: number) => {
    setSelectedLoras(current => current.map(x => x.id === id ? { ...x, weight } : x));
  };

  const handleGenerateImage = useCallback(async () => {
    if (!imagePrompt.trim()) return;

    setIsGenerating(true);
    setImageResult(null);
    setImageError(null);
    setGeneratingPercent(0);

    const interval = setInterval(
      () => setGeneratingPercent(p => Math.min(p + Math.random() * 12, 90)),
      500
    );

    try {
      // The extra generation settings are collected here so the page is ready for
      // an extended backend contract. The current API call remains backward compatible.
      const generationOptions = {
        negative_prompt: negativePrompt,
        steps,
        cfg_scale: cfg,
        seed,
        sampler,
        loras: selectedLoras.map(l => ({ id: l.id, weight: l.weight ?? 1 })),
      };

      // Keep compatibility with the existing 4-argument API while making the options
      // available to an extended implementation.
      const generate = api.generateImage as any;
      const res = await generate(
        imagePrompt,
        selectedImageModel,
        imageSize,
        imageCount,
        generationOptions
      );

      clearInterval(interval);
      setGeneratingPercent(100);

      const b64 = res.data?.[0]?.b64_json;
      if (b64) {
        const dataUrl = `data:image/png;base64,${b64}`;
        setImageResult(dataUrl);
        addGeneration({
          id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
          type: 'image',
          prompt: imagePrompt,
          result: dataUrl,
          createdAt: new Date().toISOString(),
          model: selectedImageModel,
        });
        setTimeout(() => setGeneratingPercent(0), 500);
      }
    } catch (err: any) {
      clearInterval(interval);
      setImageError(err.detail || err.message || 'Image generation failed');
    } finally {
      setIsGenerating(false);
      setTimeout(() => setGeneratingPercent(0), 1000);
    }
  }, [
    imagePrompt, negativePrompt, selectedImageModel, imageSize, imageCount,
    steps, cfg, seed, sampler, selectedLoras, addGeneration
  ]);

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

  const getTypeIcon = (type: Generation['type']) => {
    if (type === 'image') return FiImage;
    if (type === 'audio') return FiMusic;
    return FiMic;
  };

  const promptLength = imagePrompt.length;
  const selectedModelLabel =
    imageModels.find(m => m.id === selectedImageModel)?.alias || selectedImageModel;

  return (
    <div className="gen-page">
    
      <div className={`gen-layout ${showGallery ? '' : 'gallery-hidden'}`}>
        <aside className="gen-config">
          <div className="gen-config-top">
            <div>
              <div className="gen-eyebrow">
                {activeSubTab === 'image' ? 'Image generation' : activeSubTab === 'audio' ? 'Audio generation' : 'Speech to text'}
              </div>
              {viewing && <div style={{ color: '#596473', fontSize: 8, marginTop: 4 }}>Editing {viewing.id.slice(0, 8)}</div>}
            </div>
            {viewing && (
              <button className="gen-clear" onClick={clearEditor}><FiX size={11} /> New</button>
            )}
          </div>

          <div className="gen-subtabs">
            {[
              { id: 'image' as const, icon: FiImage, label: 'Image' },
              { id: 'audio' as const, icon: FiMusic, label: 'Audio' },
              { id: 'stt' as const, icon: FiMic, label: 'STT' },
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={`gen-subtab ${activeSubTab === tab.id ? 'active' : ''}`}
                  onClick={() => { setActiveSubTab(tab.id); clearEditor(); }}
                >
                  <Icon size={10} /> {tab.label}
                </button>
              );
            })}
          </div>

          {activeSubTab === 'image' && (
            <>
              <div className="gen-prompt-label">
                <label className="gen-label">Prompt</label>
                <span className="gen-char">{promptLength.toLocaleString()} chars</span>
              </div>
              <textarea
                value={imagePrompt}
                onChange={e => setImagePrompt(e.target.value)}
                placeholder="Describe the image you want to create..."
                className="gen-textarea"
              />

              <div className="gen-section">
                <div className="gen-section-head">
                  <div className="gen-section-title"><FiSliders size={11} /> Model</div>
                </div>
                <div className="gen-field">
                  <select value={selectedImageModel} onChange={e => setSelectedImageModel(e.target.value)} className="gen-select">
                    {imageModels.map(m => (
                      <option key={m.id} value={m.id}>{m.alias || m.id}</option>
                    ))}
                    {imageModels.length === 0 && <option value={selectedImageModel}>{selectedImageModel}</option>}
                  </select>
                </div>
              </div>

              <div className="gen-section">
                <div className="gen-section-head">
                  <div className="gen-section-title">Canvas</div>
                </div>
                <div className="gen-field">
                  <span className="gen-field-title">Aspect / resolution</span>
                  <div className="gen-size-row">
                    {[
                      ['256x256', '1:1 · 256'],
                      ['512x512', '1:1 · 512'],
                      ['1024x1024', '1:1 · 1024'],
                      ['1024x1536', '2:3 · Portrait'],
                      ['1536x1024', '3:2 · Landscape'],
                      ['768x768', '1:1 · 768'],
                    ].map(([value, label]) => (
                      <button key={value} className={`gen-size ${imageSize === value ? 'active' : ''}`} onClick={() => setImageSize(value)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="gen-grid-2">
                  <div>
                    <span className="gen-field-title">Images</span>
                    <div className="gen-count-control">
                      <button onClick={() => setImageCount(Math.max(1, imageCount - 1))}><FiMinus size={11} /></button>
                      <span>{imageCount}</span>
                      <button onClick={() => setImageCount(Math.min(4, imageCount + 1))}><FiPlus size={11} /></button>
                    </div>
                  </div>
                  <div>
                    <span className="gen-field-title">Seed</span>
                    <div className="gen-seed-row">
                      <input className="gen-input" type="number" value={seed} onChange={e => setSeed(Number(e.target.value))} />
                      <button className="gen-seed-btn" title="Random seed" onClick={randomizeSeed}><FiRefreshCw size={11} /></button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="gen-section">
                <div className="gen-section-head">
                  <div className="gen-section-title">LoRA adapters</div>
                  {selectedLoras.length > 0 && <span className="gen-count">{selectedLoras.length} selected</span>}
                </div>
                {loraAdapters.length === 0 ? (
                  <div className="gen-lora-empty">
                    No LoRA adapters are exposed by the current app context. Once your adapter registry is connected, selected adapters and weights will appear here.
                  </div>
                ) : (
                  <div className="gen-lora-list">
                    {loraAdapters.map(lora => {
                      const selected = selectedLoras.find(x => x.id === lora.id);
                      return (
                        <div className="gen-lora" key={lora.id}>
                          <div className="gen-lora-top">
                            <input className="gen-check" type="checkbox" checked={!!selected} onChange={() => toggleLora(lora)} />
                            <span className="gen-lora-name">{lora.name}</span>
                            {selected && <span className="gen-lora-weight">{(selected.weight ?? 1).toFixed(2)}</span>}
                          </div>
                          {selected && (
                            <input
                              className="gen-lora-range"
                              type="range"
                              min="0"
                              max="1.5"
                              step="0.05"
                              value={selected.weight ?? 1}
                              onChange={e => updateLoraWeight(lora.id, Number(e.target.value))}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <details className="gen-advanced" open={showAdvanced} onToggle={e => setShowAdvanced((e.currentTarget as HTMLDetailsElement).open)}>
                <summary>
                  <span>Advanced parameters</span>
                  <FiChevronDown size={12} />
                </summary>
                <div className="gen-advanced-body">
                  <div className="gen-field">
                    <div className="gen-prompt-label">
                      <label className="gen-label">Negative prompt</label>
                      <span className="gen-char">{negativePrompt.length}</span>
                    </div>
                    <textarea
                      value={negativePrompt}
                      onChange={e => setNegativePrompt(e.target.value)}
                      placeholder="Things to avoid..."
                      className="gen-textarea"
                      style={{ minHeight: 76 }}
                    />
                  </div>

                  <div className="gen-grid-2">
                    <div>
                      <span className="gen-field-title">Steps</span>
                      <div className="gen-range-row">
                        <input className="gen-range" type="range" min="1" max="80" value={steps} onChange={e => setSteps(Number(e.target.value))} />
                        <span className="gen-range-value">{steps}</span>
                      </div>
                    </div>
                    <div>
                      <span className="gen-field-title">CFG scale</span>
                      <div className="gen-range-row">
                        <input className="gen-range" type="range" min="1" max="20" step=".5" value={cfg} onChange={e => setCfg(Number(e.target.value))} />
                        <span className="gen-range-value">{cfg.toFixed(1)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="gen-field" style={{ marginTop: 13 }}>
                    <span className="gen-field-title">Sampler</span>
                    <select className="gen-select" value={sampler} onChange={e => setSampler(e.target.value)}>
                      <option>DPM++ 2M Karras</option>
                      <option>DPM++ SDE Karras</option>
                      <option>Euler a</option>
                      <option>Euler</option>
                      <option>DDIM</option>
                    </select>
                  </div>
                </div>
              </details>

              <button className="gen-submit" onClick={handleGenerateImage} disabled={isGenerating || !imagePrompt.trim()}>
                {isGenerating ? <FiLoader size={13} className="gen-spinner" style={{ margin: 0 }} /> : <FiZap size={13} />}
                {isGenerating ? `Generating · ${Math.round(generatingPercent)}%` : `Generate · ${selectedModelLabel}`}
              </button>

              {imageError && <div className="gen-error">{imageError}</div>}
            </>
          )}

          {activeSubTab === 'audio' && (
            <>
              <div className="gen-prompt-label"><label className="gen-label">Prompt</label></div>
              <textarea value={audioPrompt} onChange={e => setAudioPrompt(e.target.value)} placeholder="Describe the music you want to generate..." className="gen-textarea" />
              <div className="gen-section">
                <div className="gen-section-head"><div className="gen-section-title"><FiSliders size={11} /> Model</div></div>
                <select value={selectedAudioModel} onChange={e => setSelectedAudioModel(e.target.value)} className="gen-select">
                  {audioModels.map(m => <option key={m.id} value={m.id}>{m.alias || m.id}</option>)}
                </select>
              </div>
              <button className="gen-submit" onClick={handleGenerateAudio} disabled={isGenerating || !audioPrompt.trim()}>
                {isGenerating ? <FiLoader size={13} className="gen-spinner" style={{ margin: 0 }} /> : <FiMusic size={13} />}
                {isGenerating ? `Generating · ${Math.round(generatingPercent)}%` : 'Generate Audio'}
              </button>
              {audioError && <div className="gen-error">{audioError}</div>}
            </>
          )}

          {activeSubTab === 'stt' && (
            <>
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
                </select>
              </div>
              <button className="gen-submit" onClick={handleTranscribe} disabled={isGenerating || !transcriptionFile}>
                {isGenerating ? <FiLoader size={13} className="gen-spinner" style={{ margin: 0 }} /> : <FiMic size={13} />}
                {isGenerating ? `Transcribing · ${Math.round(generatingPercent)}%` : 'Transcribe'}
              </button>
              {sttError && <div className="gen-error">{sttError}</div>}
            </>
          )}
        </aside>

        <main className="gen-canvas">
          <div className="gen-canvas-toolbar">
            <div className="gen-canvas-meta">
              <span className={`gen-status-dot ${isGenerating ? 'live' : ''}`} />
              {isGenerating ? 'Generating' : viewing ? `${viewing.type} · ${formatTime(viewing.createdAt)}` : 'Preview'}
            </div>
            <div className="gen-canvas-actions">
              {viewing?.type === 'image' && (
                <a href={viewing.result} download="pantry-image.png" className="gen-canvas-action"><FiDownload size={10} /> Download</a>
              )}
              <button className="gen-canvas-action" onClick={() => setShowGallery(v => !v)}><FiGrid size={10} /> Gallery</button>
            </div>
          </div>

          <div className="gen-workspace">
            {isGenerating && (
              <div className="gen-generating">
                <FiLoader size={28} className="gen-spinner" />
                <div>Creating your {activeSubTab === 'image' ? 'image' : activeSubTab === 'audio' ? 'audio' : 'transcript'}</div>
                <div style={{ color: '#56616e', fontSize: 9, marginTop: 5 }}>{Math.round(generatingPercent)}% · {selectedModelLabel}</div>
                <div className="gen-progress"><div style={{ width: `${generatingPercent}%` }} /></div>
              </div>
            )}

            {!isGenerating && viewing?.type === 'image' && (
              <div className="gen-result-wrap">
                <div className="gen-image-frame">
                  <img src={viewing.result} alt="Generated" />
                  <div className="gen-image-overlay">
                    <button className="gen-icon-btn" title="Download" onClick={() => {
                      const a = document.createElement('a'); a.href = viewing.result; a.download = 'pantry-image.png'; a.click();
                    }}><FiDownload size={12} /></button>
                    <button className="gen-icon-btn" title="Copy prompt" onClick={() => navigator.clipboard?.writeText(viewing.prompt)}><FiCopy size={12} /></button>
                    <button className="gen-icon-btn" title="Maximize" onClick={() => window.open(viewing.result, '_blank')}><FiMaximize2 size={12} /></button>
                  </div>
                </div>
                <div className="gen-info">
                  <div className="gen-info-left">
                    <span className="gen-pill">{selectedImageModel}</span>
                    <span className="gen-pill">{imageSize}</span>
                    <span className="gen-pill">seed {seed}</span>
                  </div>
                  <span className="gen-prompt-preview">{viewing.prompt}</span>
                </div>
              </div>
            )}

            {!isGenerating && viewing?.type === 'audio' && (
              <div className="gen-result-wrap">
                <audio ref={audioRef} src={viewing.result} controls className="gen-audio-player" />
                <div className="gen-viewing-prompt">{viewing.prompt}</div>
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
                <div className="gen-empty-icon"><FiImage size={22} /></div>
                <div className="gen-empty-title">Ready when you are</div>
                <div className="gen-empty-copy">Write a prompt, tune the generation parameters, and create your next image.</div>
              </div>
            )}
          </div>
        </main>

        {showGallery && (
          <aside className="gen-gallery">
            <div className="gen-gallery-title">
              <strong>Gallery</strong>
              <span>{generations.length}</span>
            </div>

            {generations.length === 0 ? (
              <div style={{ color: '#596473', fontSize: 10, lineHeight: 1.5, padding: '15px 4px' }}>
                Your generated images, audio, and transcripts will appear here.
              </div>
            ) : (
              <div className="gen-gallery-grid">
                {generations.map(gen => {
                  const TypeIcon = getTypeIcon(gen.type);
                  const isSelected = gen.id === viewingGen;
                  return (
                    <div key={gen.id} onClick={() => loadIntoEditor(gen)} className={`gen-card ${isSelected ? 'selected' : ''}`}>
                      <div className="gen-card-meta">
                        <div className="gen-card-type">
                          <TypeIcon size={9} />
                          {gen.type === 'image' ? 'Image' : gen.type === 'audio' ? 'Audio' : 'Text'}
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

                      {gen.type === 'image' && <img src={gen.result} alt="" className="gen-card-image" />}
                      {gen.type === 'audio' && <div className="gen-card-audio"><FiPlay size={10} /> Audio generation</div>}
                      {gen.type === 'text' && <div className="gen-card-text">{gen.result}</div>}
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
