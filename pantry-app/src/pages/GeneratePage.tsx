import React, { useState, useCallback, useRef, useEffect } from 'react';
import { FiImage, FiMusic, FiMic, FiTrash2, FiDownload, FiLoader, FiPlay, FiGrid, FiX } from 'react-icons/fi';
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

export default function GeneratePage() {
  const { generations, addGeneration, deleteGeneration, state } = useApp();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const [activeSubTab, setActiveSubTab] = useState<'image' | 'audio' | 'stt'>('image');

  const [imagePrompt, setImagePrompt] = useState('');
  const [imageResult, setImageResult] = useState<string | null>(null);
  const [selectedImageModel, setSelectedImageModel] = useState('image-standard');
  const [imageSize, setImageSize] = useState('1024x1024');
  const [imageCount, setImageCount] = useState(1);

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
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (progressRef.current) {
      progressRef.current.style.width = `${generatingPercent}%`;
    }
  }, [generatingPercent]);

  const imageModels = state.models.filter(m => (m.modalities || []).some(mod => mod.toLowerCase().includes('image')));
  const audioModels = state.models.filter(m => (m.modalities || []).some(mod => mod.toLowerCase().includes('audio') || mod.toLowerCase().includes('music')));
  const sttModels = state.models.filter(m => (m.modalities || []).some(mod => mod.toLowerCase().includes('stt') || mod.toLowerCase().includes('speech')));

  const viewing = generations.find(g => g.id === viewingGen) || null;

  useEffect(() => {
    if (!viewingGen) return;
    const gen = generations.find(g => g.id === viewingGen);
    if (!gen) return;
    if (gen.type === 'image') { setImagePrompt(gen.prompt); setImageResult(gen.result); setSelectedImageModel(gen.model); }
    if (gen.type === 'audio') { setAudioPrompt(gen.prompt); setAudioResult(gen.result); setSelectedAudioModel(gen.model); }
    if (gen.type === 'text') { setTranscriptionResult(gen.result); setSelectedSttModel(gen.model); }
  }, [viewingGen, generations]);

  useEffect(() => {
    if (!params.id) return;
    if (params.id === viewingGen) return;
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

  const handleGenerateImage = useCallback(async () => {
    if (!imagePrompt.trim()) return;
    setIsGenerating(true);
    setImageResult(null);
    setImageError(null);
    setGeneratingPercent(0);
    try {
      const interval = setInterval(() => setGeneratingPercent(p => Math.min(p + Math.random() * 15, 90)), 500);
      const res = await api.generateImage(imagePrompt, selectedImageModel, imageSize, imageCount);
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
      setImageError(err.detail || err.message || 'Image generation failed');
    } finally {
      setIsGenerating(false);
      setTimeout(() => setGeneratingPercent(0), 1000);
    }
  }, [imagePrompt, selectedImageModel, imageSize, imageCount, addGeneration]);

  const handleGenerateAudio = useCallback(async () => {
    if (!audioPrompt.trim()) return;
    setIsGenerating(true);
    setAudioResult(null);
    setAudioError(null);
    setGeneratingPercent(0);
    try {
      const interval = setInterval(() => setGeneratingPercent(p => Math.min(p + Math.random() * 15, 90)), 500);
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
        setTimeout(() => setGeneratingPercent(0), 500);
      }
    } catch (err: any) {
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
    try {
      const interval = setInterval(() => setGeneratingPercent(p => Math.min(p + Math.random() * 15, 90)), 500);
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
      setTimeout(() => setGeneratingPercent(0), 500);
    } catch (err: any) {
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

  return (
    <div className="generate-page">
      {/* Tab bar */}
      <div className="generate-tabs-bar">
        <div className="generate-tabs">
          {[
            { id: 'image' as const, icon: FiImage, label: 'Image' },
            { id: 'audio' as const, icon: FiMusic, label: 'Audio' },
            { id: 'stt' as const, icon: FiMic, label: 'Transcript' },
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveSubTab(tab.id); clearEditor(); }}
                className={`generate-tab-btn ${activeSubTab === tab.id ? 'active' : ''}`}
              >
                <Icon size={12} /> {tab.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setShowGallery(!showGallery)}
          className={`generate-gallery-toggle ${showGallery ? 'active' : ''}`}
        >
          <FiGrid size={12} /> {showGallery ? 'Hide Gallery' : 'Show Gallery'} ({generations.length})
        </button>
      </div>

      {/* Main 3-pane layout */}
      <div className="generate-main">
        {/* Left: Configuration */}
        <div className="generate-config">
          {viewing && (
            <div className="generate-editing">
              <span className="generate-editing-label">Editing: {viewing.id.slice(0, 8)}</span>
              <button
                onClick={clearEditor}
                className="generate-clear-btn"
              >
                <FiX size={12} />
              </button>
            </div>
          )}

          <div className="generate-config-group">
            {activeSubTab === 'image' && (
              <>
                <label className="generate-label">Prompt</label>
                <textarea
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder="A serene mountain landscape at sunset..."
                  rows={5}
                  className="generate-input generate-textarea"
                />
                {imageModels.length > 0 && (
                  <div>
                    <label className="generate-label">Model</label>
                    <select
                      value={selectedImageModel}
                      onChange={(e) => setSelectedImageModel(e.target.value)}
                      className="generate-select"
                    >
                      {imageModels.map(m => (
                        <option key={m.id} value={m.id}>{m.id}{m.alias ? ` (${m.alias})` : ''}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="generate-label">Size</label>
                  <select
                    value={imageSize}
                    onChange={(e) => setImageSize(e.target.value)}
                    className="generate-select"
                  >
                    <option value="256x256">256×256</option>
                    <option value="512x512">512×512</option>
                    <option value="768x768">768×768</option>
                    <option value="1024x1024">1024×1024</option>
                    <option value="1024x1536">1024×1536 (portrait)</option>
                    <option value="1536x1024">1536×1024 (landscape)</option>
                  </select>
                </div>
                <div>
                  <label className="generate-label">Count</label>
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={imageCount}
                    onChange={(e) => setImageCount(Math.max(1, Math.min(4, parseInt(e.target.value) || 1)))}
                    className="generate-input"
                  />
                </div>
                <button
                  onClick={handleGenerateImage}
                  disabled={isGenerating || !imagePrompt.trim()}
                  className="generate-submit-btn"
                >
                  {isGenerating ? <FiLoader size={14} className="chat-spinner" /> : <FiImage size={14} />}
                  Generate Image
                </button>
              </>
            )}

            {activeSubTab === 'audio' && (
              <>
                <label className="generate-label">Prompt</label>
                <textarea
                  value={audioPrompt}
                  onChange={(e) => setAudioPrompt(e.target.value)}
                  placeholder="Describe the music you want to generate..."
                  rows={5}
                  className="generate-input generate-textarea"
                />
                {audioModels.length > 0 && (
                  <div>
                    <label className="generate-label">Model</label>
                    <select
                      value={selectedAudioModel}
                      onChange={(e) => setSelectedAudioModel(e.target.value)}
                      className="generate-select"
                    >
                      {audioModels.map(m => (
                        <option key={m.id} value={m.id}>{m.id}{m.alias ? ` (${m.alias})` : ''}</option>
                      ))}
                    </select>
                  </div>
                )}
                <button
                  onClick={handleGenerateAudio}
                  disabled={isGenerating || !audioPrompt.trim()}
                  className="generate-submit-btn"
                >
                  {isGenerating ? <FiLoader size={14} className="chat-spinner" /> : <FiMusic size={14} />}
                  Generate Audio
                </button>
              </>
            )}

            {activeSubTab === 'stt' && (
              <>
                <label className="generate-label">Audio File</label>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => setTranscriptionFile(e.target.files?.[0] || null)}
                  className="generate-file-input"
                />
                <div>
                  <label className="generate-label">Model</label>
                  <select
                    value={selectedSttModel}
                    onChange={(e) => setSelectedSttModel(e.target.value)}
                    className="generate-select"
                  >
                    {sttModels.map(m => (
                      <option key={m.id} value={m.id}>{m.id}{m.alias ? ` (${m.alias})` : ''}</option>
                    ))}
                    <option value="whisper-tiny">whisper-tiny</option>
                  </select>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Middle: Preview with progress */}
        <div className="generate-preview">
          {isGenerating && (
            <div className="generate-progress-bar-bg">
              <div
                ref={progressRef}
                className="generate-progress-bar-fill"
              />
            </div>
          )}

          {viewing && !isGenerating && (
            <div className="generate-viewing">
              <div className="generate-viewing-type">
                <span>
                  {viewing.type === 'image' ? 'Image' : viewing.type === 'audio' ? 'Audio' : 'Transcription'} · {formatTime(viewing.createdAt)}
                </span>
              </div>
              <div className="generate-viewing-card">
                {viewing.type === 'image' && (
                  <img src={viewing.result} alt="Generated" className="generate-viewing-image" />
                )}
                {viewing.type === 'audio' && (
                  <audio ref={audioRef} src={viewing.result} controls className="generate-viewing-audio" />
                )}
                {viewing.type === 'text' && (
                  <div className="generate-viewing-text">
                    {viewing.result}
                  </div>
                )}
                <div className="generate-viewing-prompt">
                  <strong>Prompt:</strong> {viewing.prompt}
                </div>
              </div>
              <div className="generate-viewing-actions">
                {viewing.type === 'image' && (
                  <a href={viewing.result} download="pantry-image.png" className="generate-download-link">
                    <FiDownload size={11} /> Download
                  </a>
                )}
                <button
                  onClick={() => { deleteGeneration(viewing.id); clearEditor(); }}
                  className="generate-delete-btn"
                >
                  <FiTrash2 size={11} /> Delete
                </button>
              </div>
            </div>
          )}

          {!viewing && !isGenerating && (
            <div className="generate-empty">
              <FiGrid size={32} className="generate-empty-icon" />
              <div>Select a generation from gallery or create a new one</div>
            </div>
          )}

          {isGenerating && (
            <div className="generate-generating">
              <FiLoader size={32} className="chat-spinner" />
              <div>Generating...</div>
              <div>{Math.round(generatingPercent)}%</div>
            </div>
          )}
        </div>

        {/* Right: Gallery */}
        {showGallery && (
          <div className="generate-gallery">
            <div className="generate-gallery-header">
              Gallery ({generations.length})
            </div>
            {generations.length === 0 && (
              <div className="generate-gallery-empty">
                <div>No generations yet</div>
              </div>
            )}
            {generations.map(gen => {
              const TypeIcon = getTypeIcon(gen.type);
              const isSelected = gen.id === viewingGen;
              return (
                <div
                  key={gen.id}
                  onClick={() => loadIntoEditor(gen)}
                  className={`generate-gen-card ${isSelected ? 'selected' : ''}`}
                >
                  <div className="generate-gen-meta">
                    <div className="generate-gen-meta-left">
                      <TypeIcon size={10} />
                      {gen.type === 'image' ? 'Image' : gen.type === 'audio' ? 'Audio' : 'Text'}
                      <span className="generate-gen-meta-sep">·</span>
                      {formatTime(gen.createdAt)}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteGeneration(gen.id); if (viewingGen === gen.id) clearEditor(); }}
                      className="generate-gen-delete"
                      title="Delete"
                    >
                      <FiTrash2 size={9} />
                    </button>
                  </div>
                  <div className="generate-gen-prompt">
                    {gen.prompt}
                  </div>
                  {gen.type === 'image' && (
                    <img src={gen.result} alt="" className="generate-gen-image" />
                  )}
                  {gen.type === 'audio' && (
                    <div className="generate-gen-audio">
                      <FiPlay size={8} /> Audio
                    </div>
                  )}
                  {gen.type === 'text' && (
                    <div className="generate-gen-text">
                      {gen.result}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        select option { background: #161b22; color: #e8e8e8; }
        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type="number"] { -moz-appearance: textfield; }
      `}</style>
    </div>
  );
}
