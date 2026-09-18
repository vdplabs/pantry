import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  FiImage, FiTrash2, FiDownload, FiRefreshCw, FiCopy, FiCheck,
  FiSliders, FiMaximize2, FiX, FiLayers, FiZap, FiSquare
} from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { streamImage, ImageStepEvent, ImageDoneEvent } from '@/services/streaming';
import type { Generation } from '@/types';

const ASPECT_RATIOS = [
  { id: '1:1', label: '1:1 Square', size: '1024x1024', icon: '■' },
  { id: '16:9', label: '16:9 Landscape', size: '1024x576', icon: '▬' },
  { id: '9:16', label: '9:16 Story/Portrait', size: '576x1024', icon: '▮' },
  { id: '4:3', label: '4:3 Standard', size: '1024x768', icon: '▭' },
];

const PROMPT_INSPIRATIONS = [
  'Hyperrealistic neon cyberpunk alleyway in rain, volumetric lighting, 8k octane render',
  'Minimalist serene Scandinavian living room with morning sunlight and monstera plant',
  'Studio portrait photograph of an astronaut in a floral helmet, soft studio lighting',
  'Isometric 3D diorama of a cozy Japanese coffee shop with cherry blossoms',
];

export default function ImagePage() {
  const { generations, addGeneration, deleteGeneration, state } = useApp();
  const [prompt, setPrompt] = useState(PROMPT_INSPIRATIONS[0]);
  const [negativePrompt, setNegativePrompt] = useState('blurry, low quality, distorted, extra limbs, watermark');
  const [selectedRatio, setSelectedRatio] = useState(ASPECT_RATIOS[0]);
  const [steps, setSteps] = useState(4);
  const [guidance, setGuidance] = useState(0.0);
  const [seed, setSeed] = useState(-1);
  const [selectedModel, setSelectedModel] = useState('image-standard');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(4);
  const [progressPercent, setProgressPercent] = useState(0);
  const [stepPreview, setStepPreview] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [currentResult, setCurrentResult] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const imageModels = state.models.filter(m =>
    (m.modalities || []).some(mod => mod.toLowerCase().includes('image') || mod.toLowerCase().includes('diffusion')) ||
    (m.role || '').toLowerCase().includes('image')
  );

  const imageGenerations = generations.filter(g => g.type === 'image');

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsGenerating(false);
    setStatusMessage('Generation cancelled');
  };

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;

    if (abortRef.current) {
      abortRef.current.abort();
    }

    setIsGenerating(true);
    setCurrentStep(0);
    setTotalSteps(steps);
    setProgressPercent(0);
    setStepPreview(null);
    setErrorMsg(null);
    setStatusMessage('Initializing diffusion pipeline & encoding prompt...');

    const controller = streamImage(
      {
        prompt: prompt.trim(),
        model: selectedModel,
        size: selectedRatio.size,
        n: 1,
        steps,
        guidance,
        negative_prompt: negativePrompt || undefined,
      },
      {
        onStep: (stepEvt: ImageStepEvent) => {
          setCurrentStep(stepEvt.step);
          setTotalSteps(stepEvt.total);
          const pct = Math.round((stepEvt.step / stepEvt.total) * 100);
          setProgressPercent(pct);
          setStatusMessage(`Denoising step ${stepEvt.step} / ${stepEvt.total} (${pct}%)`);
          if (stepEvt.previewUrl) {
            setStepPreview(stepEvt.previewUrl);
          }
        },
        onDone: (doneEvt: ImageDoneEvent) => {
          setProgressPercent(100);
          setStatusMessage('Rendering finalized');
          const b64 = doneEvt.data?.[0]?.b64_json;
          if (b64) {
            const dataUrl = `data:image/png;base64,${b64}`;
            setCurrentResult(dataUrl);
            setStepPreview(null);
            addGeneration({
              id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
              type: 'image',
              prompt: prompt.trim(),
              result: dataUrl,
              createdAt: new Date().toISOString(),
              model: selectedModel,
            });
          }
          setIsGenerating(false);
        },
        onError: (err: Error) => {
          setIsGenerating(false);
          setStepPreview(null);
          setErrorMsg(err.message || String(err));
        },
      }
    );

    abortRef.current = controller;
  }, [prompt, selectedModel, selectedRatio, steps, guidance, negativePrompt, addGeneration]);

  const handleDownload = (imgUrl: string) => {
    const a = document.createElement('a');
    a.href = imgUrl;
    a.download = `pantry-image-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="studio-layout">
      <div className="studio-header">
        <div className="studio-title-group">
          <h2>Neural Diffusion Image Studio</h2>
          <p>Generate high-fidelity imagery with FLUX.1 / Z-Image Turbo on Apple Silicon</p>
        </div>
      </div>

      <div className="studio-grid">
        {/* Controls Sidebar */}
        <div className="studio-panel">
          <div className="studio-panel-title">
            <FiSliders size={16} color="var(--accent-primary)" />
            <span>Generation Parameters</span>
          </div>

          <div className="form-field">
            <label className="form-label">Diffusion Model</label>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className="form-select"
            >
              {imageModels.length > 0 ? (
                imageModels.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))
              ) : (
                <option value="image-standard">image-standard (FLUX.1 Schnell)</option>
              )}
            </select>
          </div>

          <div className="form-field">
            <label className="form-label">Aspect Ratio</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
              {ASPECT_RATIOS.map(ratio => (
                <button
                  key={ratio.id}
                  type="button"
                  onClick={() => setSelectedRatio(ratio)}
                  className={`chat-control-pill ${selectedRatio.id === ratio.id ? 'active' : ''}`}
                  style={{ justifyContent: 'center' }}
                >
                  <span style={{ fontSize: '14px' }}>{ratio.icon}</span>
                  <span>{ratio.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Inference Steps ({steps})</label>
            <input
              type="range"
              min="2"
              max="50"
              step="1"
              value={steps}
              onChange={e => setSteps(parseInt(e.target.value))}
              style={{ accentColor: 'var(--accent-primary)' }}
            />
          </div>

          <div className="form-field">
            <label className="form-label">Guidance Scale ({guidance})</label>
            <input
              type="range"
              min="0.0"
              max="10.0"
              step="0.5"
              value={guidance}
              onChange={e => setGuidance(parseFloat(e.target.value))}
              style={{ accentColor: 'var(--accent-primary)' }}
            />
          </div>

          {isGenerating ? (
            <button
              onClick={handleStop}
              className="primary-action-btn"
              style={{ background: 'var(--accent-rose)', borderColor: 'var(--accent-rose)' }}
            >
              <FiSquare size={15} />
              <span>Stop Rendering</span>
            </button>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              className="primary-action-btn"
            >
              <FiZap size={15} />
              <span>Generate Image</span>
            </button>
          )}
        </div>

        {/* Studio Center Workspace */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Prompt Composer Box */}
          <div className="studio-panel" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span className="form-label">Image Prompt</span>
              <button
                type="button"
                onClick={() => setPrompt(PROMPT_INSPIRATIONS[Math.floor(Math.random() * PROMPT_INSPIRATIONS.length)])}
                className="code-copy-btn"
              >
                Inspiration ✨
              </button>
            </div>
            <textarea
              rows={3}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Describe the scene, style, lighting, camera angle..."
              className="form-textarea"
            />
          </div>

          {/* Canvas Preview Box */}
          <div className="studio-panel" style={{ padding: '20px', minHeight: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            {errorMsg && (
              <div style={{ padding: '12px 16px', borderRadius: '8px', background: 'var(--accent-rose-subtle)', color: 'var(--accent-rose)', fontSize: '13px', textAlign: 'center' }}>
                ⚠️ {errorMsg}
              </div>
            )}

            {isGenerating && stepPreview && (
              <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '520px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ position: 'relative', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.35)' }}>
                  <img
                    src={stepPreview}
                    alt="Step preview"
                    style={{ maxWidth: '100%', maxHeight: '420px', objectFit: 'contain', display: 'block' }}
                  />
                  <div style={{
                    position: 'absolute',
                    top: '12px',
                    left: '12px',
                    padding: '6px 14px',
                    borderRadius: '20px',
                    background: 'rgba(10, 14, 26, 0.85)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--accent-primary)',
                  }}>
                    <span className="pulsing-dot" />
                    <span>Step {currentStep} / {totalSteps} ({progressPercent}%)</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', marginTop: '14px', width: '100%', maxWidth: '360px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '12px', color: 'var(--text-muted)' }}>
                    <span>{statusMessage || `Denoising step ${currentStep} of ${totalSteps}...`}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{progressPercent}%</span>
                  </div>
                  <div style={{ width: '100%', height: '6px', background: 'var(--border-card)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${progressPercent}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-purple))', transition: 'width 0.4s ease' }} />
                  </div>
                  <button onClick={handleStop} className="chat-control-pill" style={{ marginTop: '4px' }}>
                    <FiSquare size={12} /> Stop Rendering
                  </button>
                </div>
              </div>
            )}

            {isGenerating && !stepPreview && (
              <div style={{ display: 'flex', flexDirection: 'column', alignContent: 'center', alignItems: 'center', gap: '14px' }}>
                <FiRefreshCw className="spinning" size={36} color="var(--accent-primary)" />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '4px' }}>
                    {statusMessage || 'Initializing neural diffusion model...'}
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {currentStep > 0 ? `Step ${currentStep} of ${totalSteps} (${progressPercent}%)` : 'Encoding text prompt & allocating latent tensors on Apple Silicon'}
                  </span>
                </div>
                <div style={{ width: '240px', height: '6px', background: 'var(--border-card)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(5, progressPercent)}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-purple))', transition: 'width 0.4s ease' }} />
                </div>
                <button onClick={handleStop} className="chat-control-pill" style={{ marginTop: '6px' }}>
                  <FiSquare size={12} /> Stop Rendering
                </button>
              </div>
            )}

            {!isGenerating && currentResult && (
              <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '520px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <img
                  src={currentResult}
                  alt="Generated"
                  style={{ maxWidth: '100%', maxHeight: '480px', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', objectFit: 'contain' }}
                />
                <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                  <button onClick={() => setLightboxOpen(true)} className="chat-control-pill" title="Enlarge">
                    <FiMaximize2 size={13} /> Fullscreen
                  </button>
                  <button onClick={() => handleDownload(currentResult)} className="chat-control-pill active" title="Download">
                    <FiDownload size={13} /> Download PNG
                  </button>
                  <button onClick={handleCopyPrompt} className="chat-control-pill" title="Copy Prompt">
                    {copied ? <FiCheck size={13} /> : <FiCopy size={13} />}
                    {copied ? 'Copied' : 'Copy Prompt'}
                  </button>
                </div>
              </div>
            )}

            {!isGenerating && !currentResult && !errorMsg && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-dim)', gap: '10px' }}>
                <FiImage size={42} />
                <span>Ready to generate. Enter a prompt above and click Generate.</span>
              </div>
            )}
          </div>

          {/* History Gallery Strip */}
          {imageGenerations.length > 0 && (
            <div className="studio-panel" style={{ padding: '16px' }}>
              <span className="studio-panel-title" style={{ fontSize: '13px' }}>Recent Generations ({imageGenerations.length})</span>
              <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', padding: '10px 0' }}>
                {imageGenerations.map(gen => (
                  <div
                    key={gen.id}
                    onClick={() => { setCurrentResult(gen.result); setPrompt(gen.prompt); }}
                    style={{
                      position: 'relative',
                      width: '90px',
                      height: '90px',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      border: currentResult === gen.result ? '2px solid var(--accent-primary)' : '1px solid var(--border-card)',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    <img src={gen.result} alt="Thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxOpen && currentResult && (
        <div
          onClick={() => setLightboxOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '24px',
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <img src={currentResult} alt="Enlarged" style={{ maxWidth: '100%', maxHeight: '85vh', borderRadius: '12px' }} />
            <button
              onClick={() => setLightboxOpen(false)}
              style={{
                position: 'absolute',
                top: '-12px',
                right: '-12px',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                border: 'none',
                background: 'white',
                color: 'black',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FiX size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
