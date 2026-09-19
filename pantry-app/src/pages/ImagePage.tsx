import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  FiImage, FiTrash2, FiDownload, FiRefreshCw, FiCopy, FiCheck,
  FiSliders, FiMaximize2, FiX, FiLayers, FiZap, FiSquare,
  FiEye, FiCpu, FiHash, FiRotateCcw, FiChevronDown, FiChevronUp, FiPlus,
  FiStar, FiLayout, FiGrid, FiInfo, FiLock, FiUnlock
} from 'react-icons/fi';
import { useApp } from '@/context/AppContext';
import { streamImage, ImageStepEvent, ImageDoneEvent } from '@/services/streaming';
import api from '@/services/api';
import type { Generation, AdapterInfo } from '@/types';

interface AspectRatioOption {
  id: string;
  label: string;
  size: string;
  icon: string;
  width: number;
  height: number;
  category: string;
}

const ASPECT_RATIOS: AspectRatioOption[] = [
  { id: '1:1:1024', label: '1:1 Square (HD)', size: '1024x1024', icon: '■', width: 1024, height: 1024, category: 'Square' },
  { id: '1:1:512', label: '1:1 Square (Fast)', size: '512x512', icon: '■', width: 512, height: 512, category: 'Square' },
  { id: '16:9:1024', label: '16:9 Landscape', size: '1024x576', icon: '▬', width: 1024, height: 576, category: 'Landscape' },
  { id: '16:9:1280', label: '16:9 Landscape HD', size: '1280x720', icon: '▬', width: 1280, height: 720, category: 'Landscape' },
  { id: '9:16:1024', label: '9:16 Portrait / Story', size: '576x1024', icon: '▮', width: 576, height: 1024, category: 'Portrait' },
  { id: '9:16:1280', label: '9:16 Portrait HD', size: '720x1280', icon: '▮', width: 720, height: 1280, category: 'Portrait' },
  { id: '4:3:1024', label: '4:3 Standard Photo', size: '1024x768', icon: '▭', width: 1024, height: 768, category: 'Standard' },
  { id: '3:4:1024', label: '3:4 Classic Portrait', size: '768x1024', icon: '▯', width: 768, height: 1024, category: 'Standard' },
  { id: '21:9:1344', label: '21:9 Ultrawide Cinema', size: '1344x576', icon: '▭', width: 1344, height: 576, category: 'Cinematic' },
  { id: 'custom', label: 'Custom Dimensions', size: 'custom', icon: '⚙', width: 1024, height: 1024, category: 'Custom' },
];

const STYLE_PRESETS = [
  { id: 'photo', label: '📸 Photorealism', modifier: ', 8k resolution, raw photo, highly detailed, photorealistic, cinematic lighting, 35mm lens, sharp focus' },
  { id: 'anime', label: '🎨 Anime & Manga', modifier: ', modern anime aesthetic, highly detailed lineart, Makoto Shinkai style, vibrant colors, studio ghibli lighting' },
  { id: 'cyberpunk', label: '🌆 Cyberpunk Neon', modifier: ', cyberpunk neon lighting, volumetric fog, rainy reflections, futuristic cityscape, octane render 8k' },
  { id: 'architecture', label: '🏛️ Architecture', modifier: ', architectural digest photography, minimalist modern interior, sunlight rays, brutalist concrete, ultra detailed' },
  { id: 'octane', label: '🕹️ 3D Octane Render', modifier: ', isometric 3D render, smooth clay render, unreal engine 5, octane shading, vivid raytracing, pop colors' },
  { id: 'oil', label: '🏺 Classical Oil Art', modifier: ', masterwork classical oil painting, expressive impasto brushstrokes, dramatic chiaroscuro lighting, canvas texture' },
  { id: 'cinema', label: '🎬 Cinematic Shot', modifier: ', movie still from 70mm IMAX film, anamorphic lens flare, moody color grading, dramatic depth of field' },
  { id: 'fantasy', label: '✨ Fantasy Epic', modifier: ', epic fantasy illustration, mystical magical glow, highly detailed digital painting, artstation trending' },
];

const PROMPT_INSPIRATIONS = [
  'Hyperrealistic neon cyberpunk alleyway in rain, volumetric lighting, 8k octane render',
  'Minimalist serene Scandinavian living room with morning sunlight and monstera plant',
  'Studio portrait photograph of an astronaut in a floral helmet, soft studio lighting',
  'Isometric 3D diorama of a cozy Japanese coffee shop with cherry blossoms',
  'Majestic snow leopard resting on Himalayan mountain peak under starry milky way sky',
  'Ancient steampunk airship sailing through glowing clouds during golden sunset',
  'Macro shot of a mechanical cybernetic dragonfly with iridescent glass wings',
  'Lush bioluminescent fantasy forest with glowing mushroom lanterns and sparkling stream',
];

const DEFAULT_NEGATIVE_PROMPT = 'blurry, low quality, distorted, bad anatomy, extra limbs, watermark, artifacts, grainy, oversaturated, deformed eyes';

export default function ImagePage() {
  const { generations, addGeneration, deleteGeneration, state } = useApp();
  
  // Prompt & Parameters
  const [prompt, setPrompt] = useState(PROMPT_INSPIRATIONS[0]);
  const [negativePrompt, setNegativePrompt] = useState(DEFAULT_NEGATIVE_PROMPT);
  const [showNegativePrompt, setShowNegativePrompt] = useState(false);
  const [selectedRatio, setSelectedRatio] = useState<AspectRatioOption>(ASPECT_RATIOS[0]);
  const [customWidth, setCustomWidth] = useState(1024);
  const [customHeight, setCustomHeight] = useState(1024);
  
  const [steps, setSteps] = useState(4);
  const [guidance, setGuidance] = useState(1.0);
  const [seed, setSeed] = useState(-1);
  const [seedLocked, setSeedLocked] = useState(false);
  const [batchCount, setBatchCount] = useState(1);
  const [streamStepsEnabled, setStreamStepsEnabled] = useState(true);
  
  // Models & LoRA Adapters
  const [selectedModel, setSelectedModel] = useState('image-standard');
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [selectedAdapterId, setSelectedAdapterId] = useState<string>('');
  const [adapterScale, setAdapterScale] = useState<number>(1.0);
  const [loadingAdapters, setLoadingAdapters] = useState(false);

  // Runtime State
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(4);
  const [progressPercent, setProgressPercent] = useState(0);
  const [stepPreview, setStepPreview] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [currentResult, setCurrentResult] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<string[]>([]);
  const [currentMetadata, setCurrentMetadata] = useState<any>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Filter image models
  const imageModels = state.models.filter(m =>
    (m.modalities || []).some(mod => mod.toLowerCase().includes('image') || mod.toLowerCase().includes('diffusion')) ||
    (m.role || '').toLowerCase().includes('image') ||
    m.id.toLowerCase().includes('flux') ||
    m.id.toLowerCase().includes('z-image') ||
    m.id.toLowerCase().includes('diffusion')
  );

  const imageGenerations = generations.filter(g => g.type === 'image');

  // Load available LoRA adapters from backend
  const fetchAdapters = useCallback(async () => {
    setLoadingAdapters(true);
    try {
      const res = await api.listAdapters();
      if (res && res.adapters) {
        setAdapters(res.adapters);
      }
    } catch (err) {
      console.warn('Could not fetch LoRA adapters:', err);
    } finally {
      setLoadingAdapters(false);
    }
  }, []);

  useEffect(() => {
    fetchAdapters();
  }, [fetchAdapters]);

  // Image-specific LoRA adapters (or all)
  const imageAdapters = adapters.filter(a => 
    !a.modality || a.modality === 'image' || a.id.toLowerCase().includes('flux') || a.id.toLowerCase().includes('image') || a.base_family?.toLowerCase().includes('flux')
  );
  const availableAdapters = imageAdapters.length > 0 ? imageAdapters : adapters;

  const currentLoRA = adapters.find(a => a.id === selectedAdapterId);

  const effectiveSize = selectedRatio.id === 'custom' 
    ? `${customWidth}x${customHeight}` 
    : selectedRatio.size;

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsGenerating(false);
    setStatusMessage('Generation stopped');
  };

  const handleApplyStylePreset = (preset: typeof STYLE_PRESETS[0]) => {
    // Check if modifier already exists
    if (!prompt.includes(preset.label)) {
      setPrompt(prev => prev.trim() + preset.modifier);
    }
  };

  const handleRandomizeSeed = () => {
    const newSeed = Math.floor(Math.random() * 2147483647);
    setSeed(newSeed);
  };

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;

    if (abortRef.current) {
      abortRef.current.abort();
    }

    // Determine seed for this run
    let activeSeed = seed;
    if (!seedLocked && seed < 0) {
      activeSeed = Math.floor(Math.random() * 2147483647);
    }

    setIsGenerating(true);
    setCurrentStep(0);
    setTotalSteps(steps);
    setProgressPercent(0);
    setStepPreview(null);
    setErrorMsg(null);
    setBatchResults([]);
    setStatusMessage(`Encoding prompt & preparing diffusion pipeline (${effectiveSize})...`);

    const runMeta = {
      model: selectedModel,
      prompt: prompt.trim(),
      negative_prompt: showNegativePrompt && negativePrompt ? negativePrompt.trim() : undefined,
      size: effectiveSize,
      steps,
      guidance,
      seed: activeSeed >= 0 ? activeSeed : undefined,
      adapter: selectedAdapterId || undefined,
      scale: selectedAdapterId ? adapterScale : undefined,
      createdAt: new Date().toISOString(),
    };

    if (streamStepsEnabled) {
      const controller = streamImage(
        {
          prompt: prompt.trim(),
          model: selectedModel,
          size: effectiveSize,
          n: batchCount,
          steps,
          guidance,
          negative_prompt: showNegativePrompt && negativePrompt ? negativePrompt.trim() : undefined,
          seed: activeSeed >= 0 ? activeSeed : undefined,
          adapter: selectedAdapterId || undefined,
          scale: selectedAdapterId ? adapterScale : undefined,
        },
        {
          onStep: (stepEvt: ImageStepEvent) => {
            setCurrentStep(stepEvt.step);
            setTotalSteps(stepEvt.total);
            const pct = Math.round((stepEvt.step / stepEvt.total) * 100);
            setProgressPercent(pct);
            setStatusMessage(`Denoising step ${stepEvt.step} of ${stepEvt.total} (${pct}%)`);
            if (stepEvt.previewUrl) {
              setStepPreview(stepEvt.previewUrl);
            }
          },
          onDone: (doneEvt: ImageDoneEvent) => {
            setProgressPercent(100);
            setStatusMessage('Diffusion rendered successfully');
            const dataItems = doneEvt.data || [];
            const results: string[] = [];

            for (const item of dataItems) {
              if (item.b64_json) {
                const dataUrl = `data:image/png;base64,${item.b64_json}`;
                results.push(dataUrl);
                addGeneration({
                  id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString() + Math.random(),
                  type: 'image',
                  prompt: prompt.trim(),
                  result: dataUrl,
                  createdAt: new Date().toISOString(),
                  model: selectedModel,
                });
              } else if (item.url) {
                results.push(item.url);
              }
            }

            if (results.length > 0) {
              setCurrentResult(results[0]);
              setBatchResults(results);
              setCurrentMetadata(runMeta);
              setStepPreview(null);
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
    } else {
      // Non-streaming fallback
      try {
        const res = await api.generateImage(
          prompt.trim(),
          selectedModel,
          effectiveSize,
          batchCount,
          steps,
          guidance,
          showNegativePrompt && negativePrompt ? negativePrompt.trim() : undefined,
          activeSeed >= 0 ? activeSeed : undefined,
          selectedAdapterId ? [selectedAdapterId] : undefined,
          selectedAdapterId ? [adapterScale] : undefined
        );

        const dataItems = res.data || [];
        const results: string[] = [];
        for (const item of dataItems) {
          if (item.b64_json) {
            const dataUrl = `data:image/png;base64,${item.b64_json}`;
            results.push(dataUrl);
            addGeneration({
              id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
              type: 'image',
              prompt: prompt.trim(),
              result: dataUrl,
              createdAt: new Date().toISOString(),
              model: selectedModel,
            });
          } else if (item.url) {
            results.push(item.url);
          }
        }

        if (results.length > 0) {
          setCurrentResult(results[0]);
          setBatchResults(results);
          setCurrentMetadata(runMeta);
        }
      } catch (err: any) {
        setErrorMsg(err.message || 'Image generation failed');
      } finally {
        setIsGenerating(false);
      }
    }
  }, [
    prompt,
    selectedModel,
    effectiveSize,
    batchCount,
    steps,
    guidance,
    seed,
    seedLocked,
    showNegativePrompt,
    negativePrompt,
    selectedAdapterId,
    adapterScale,
    streamStepsEnabled,
    addGeneration,
  ]);

  const handleDownload = (imgUrl: string) => {
    const a = document.createElement('a');
    a.href = imgUrl;
    const cleanPrompt = prompt.slice(0, 30).replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `pantry-${selectedModel}-${cleanPrompt}-${Date.now()}.png`;
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
    <div className="studio-layout" style={{ maxWidth: '1600px', margin: '0 auto', padding: '20px 28px' }}>
      {/* Studio Header */}
      <div className="studio-header" style={{ marginBottom: '18px' }}>
        <div className="studio-title-group">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              boxShadow: '0 0 16px rgba(99, 102, 241, 0.4)'
            }}>
              <FiImage size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 800, margin: 0, letterSpacing: '-0.4px' }}>
                Neural Diffusion Image Studio
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                Ultra high-fidelity text-to-image synthesis with FLUX.1 & Z-Image Turbo on Apple Silicon Metal GPU
              </p>
            </div>
          </div>
        </div>

        {/* Top Quick Status Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '5px 12px',
            borderRadius: 'var(--radius-full)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            fontSize: '11px',
            color: 'var(--text-secondary)'
          }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
            <span>Metal GPU Pipeline Ready</span>
          </div>
        </div>
      </div>

      <div className="studio-grid" style={{ gridTemplateColumns: '380px minmax(0, 1fr)', gap: '20px', alignItems: 'start' }}>
        {/* Controls Sidebar */}
        <div className="studio-panel" style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="studio-panel-title" style={{ fontSize: '13px', fontWeight: 700 }}>
              <FiSliders size={15} color="var(--accent-primary)" />
              <span>Generation Parameters</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSteps(4);
                setGuidance(1.0);
                setSelectedRatio(ASPECT_RATIOS[0]);
                setSelectedAdapterId('');
                setAdapterScale(1.0);
                setSeed(-1);
                setBatchCount(1);
              }}
              className="chat-control-pill"
              style={{ fontSize: '10px', padding: '3px 8px', height: 'auto' }}
              title="Reset parameters to recommended defaults"
            >
              <FiRotateCcw size={10} /> Reset
            </button>
          </div>

          {/* 1. Diffusion Model Selector */}
          <div className="form-field">
            <label className="form-label" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Base Diffusion Model
            </label>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className="form-select"
              style={{ padding: '8px 12px', fontSize: '12px' }}
            >
              {imageModels.length > 0 ? (
                imageModels.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.id} {m.quality_tier ? `(${m.quality_tier})` : ''}
                  </option>
                ))
              ) : (
                <>
                  <option value="image-standard">image-standard (FLUX.1 Schnell)</option>
                  <option value="image-compact">image-compact (Z-Image Turbo)</option>
                </>
              )}
            </select>
          </div>

          {/* 2. LoRA Adapter Support */}
          <div className="form-field" style={{ background: 'var(--bg-tertiary)', padding: '12px', borderRadius: '10px', border: '1px solid var(--border-medium)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label className="form-label" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FiZap size={12} color="var(--accent-primary)" />
                <span>LoRA Adapter Hook</span>
              </label>
              <button
                type="button"
                onClick={fetchAdapters}
                disabled={loadingAdapters}
                className="chat-control-pill"
                style={{ fontSize: '10px', padding: '2px 6px', height: 'auto' }}
                title="Refresh adapters list"
              >
                <FiRefreshCw size={9} className={loadingAdapters ? 'spinning' : ''} />
              </button>
            </div>

            <select
              value={selectedAdapterId}
              onChange={e => setSelectedAdapterId(e.target.value)}
              className="form-select"
              style={{ padding: '6px 10px', fontSize: '12px', marginBottom: selectedAdapterId ? '10px' : '0' }}
            >
              <option value="">None (Pure Base Model)</option>
              {availableAdapters.map(ad => (
                <option key={ad.id} value={ad.id}>
                  ⚡ {ad.name || ad.id} {ad.base_family ? `[${ad.base_family.toUpperCase()}]` : ''}
                </option>
              ))}
            </select>

            {selectedAdapterId && (
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-card-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Adapter Scale / Strength:</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'var(--mono)' }}>
                    {adapterScale.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="2.0"
                  step="0.05"
                  value={adapterScale}
                  onChange={e => setAdapterScale(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                />
                {currentLoRA && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px', fontSize: '10px', color: 'var(--text-muted)' }}>
                    <span>Rank: {currentLoRA.rank || 16}</span>
                    <span>·</span>
                    <span>Alpha: {currentLoRA.alpha || 32}</span>
                    {currentLoRA.base_family && (
                      <>
                        <span>·</span>
                        <span>Arch: {currentLoRA.base_family}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. Aspect Ratio & Dimensions */}
          <div className="form-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
              <label className="form-label" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Aspect Ratio & Resolution
              </label>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                {effectiveSize}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
              {ASPECT_RATIOS.map(ratio => (
                <button
                  key={ratio.id}
                  type="button"
                  onClick={() => setSelectedRatio(ratio)}
                  className={`chat-control-pill ${selectedRatio.id === ratio.id ? 'active' : ''}`}
                  style={{ justifyContent: 'flex-start', padding: '6px 10px', height: 'auto', fontSize: '11px' }}
                >
                  <span style={{ fontSize: '13px', width: '16px', textAlign: 'center' }}>{ratio.icon}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ratio.label}</span>
                </button>
              ))}
            </div>

            {selectedRatio.id === 'custom' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px', padding: '10px', background: 'var(--bg-tertiary)', borderRadius: '8px' }}>
                <div>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Width (px)</span>
                  <input
                    type="number"
                    min="256"
                    max="1536"
                    step="64"
                    value={customWidth}
                    onChange={e => setCustomWidth(parseInt(e.target.value) || 512)}
                    className="gen-select"
                    style={{ padding: '4px 8px', fontSize: '11px', marginTop: '3px' }}
                  />
                </div>
                <div>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Height (px)</span>
                  <input
                    type="number"
                    min="256"
                    max="1536"
                    step="64"
                    value={customHeight}
                    onChange={e => setCustomHeight(parseInt(e.target.value) || 512)}
                    className="gen-select"
                    style={{ padding: '4px 8px', fontSize: '11px', marginTop: '3px' }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 4. Inference Steps Slider + Quick Presets */}
          <div className="form-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
              <label className="form-label" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Inference Steps ({steps})
              </label>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[4, 8, 20, 30].map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSteps(s)}
                    className={`chat-control-pill ${steps === s ? 'active' : ''}`}
                    style={{ fontSize: '9px', padding: '1px 5px', height: 'auto' }}
                  >
                    {s === 4 ? '⚡4' : s === 8 ? '8' : s === 20 ? '✨20' : '💎30'}
                  </button>
                ))}
              </div>
            </div>
            <input
              type="range"
              min="1"
              max="50"
              step="1"
              value={steps}
              onChange={e => setSteps(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-dim)' }}>
              <span>1 (Draft)</span>
              <span>4 (Turbo/Schnell)</span>
              <span>20 (Detailed)</span>
              <span>50 (Max)</span>
            </div>
          </div>

          {/* 5. Guidance Scale (CFG) */}
          <div className="form-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
              <label className="form-label" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Guidance Scale / CFG ({guidance.toFixed(1)})
              </label>
              <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
                {guidance <= 1.0 ? '⚡ Distilled / Schnell' : guidance <= 4.0 ? 'Balanced' : 'Strict Prompt adherence'}
              </span>
            </div>
            <input
              type="range"
              min="0.0"
              max="15.0"
              step="0.5"
              value={guidance}
              onChange={e => setGuidance(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
            />
          </div>

          {/* 6. Seed & Reproducibility */}
          <div className="form-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
              <label className="form-label" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Random Seed
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={handleRandomizeSeed}
                  className="chat-control-pill"
                  style={{ fontSize: '10px', padding: '2px 6px', height: 'auto' }}
                  title="Generate a random seed"
                >
                  🎲 Roll
                </button>
                <button
                  type="button"
                  onClick={() => setSeedLocked(prev => !prev)}
                  className={`chat-control-pill ${seedLocked ? 'active' : ''}`}
                  style={{ fontSize: '10px', padding: '2px 6px', height: 'auto' }}
                  title={seedLocked ? 'Seed locked (reproducible noise)' : 'Seed unlocked (random per run)'}
                >
                  {seedLocked ? <FiLock size={10} /> : <FiUnlock size={10} />}
                  {seedLocked ? 'Locked' : 'Random'}
                </button>
              </div>
            </div>
            <input
              type="number"
              value={seed < 0 ? '' : seed}
              placeholder="Random (-1 or leave blank)"
              onChange={e => setSeed(e.target.value === '' ? -1 : parseInt(e.target.value))}
              className="gen-select"
              style={{ padding: '6px 10px', fontSize: '11px' }}
            />
          </div>

          {/* 7. Batch Size (n) & Stream Options */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', paddingTop: '4px' }}>
            <div>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Batch Count:</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[1, 2, 4].map(num => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setBatchCount(num)}
                    className={`chat-control-pill ${batchCount === num ? 'active' : ''}`}
                    style={{ flex: 1, justifyContent: 'center', padding: '4px 0', fontSize: '11px' }}
                  >
                    {num}×
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer', marginTop: '16px' }}>
                <input
                  type="checkbox"
                  checked={streamStepsEnabled}
                  onChange={e => setStreamStepsEnabled(e.target.checked)}
                  style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                />
                Live Step Preview
              </label>
            </div>
          </div>

          {/* Generate / Stop Action Button */}
          <div style={{ marginTop: '8px' }}>
            {isGenerating ? (
              <button
                type="button"
                onClick={handleStop}
                className="primary-action-btn"
                style={{ background: 'var(--accent-rose)', borderColor: 'var(--accent-rose)', width: '100%' }}
              >
                <FiX size={16} />
                <span>Cancel Generation</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating || !prompt.trim()}
                className="primary-action-btn"
                style={{ width: '100%', padding: '12px 18px', fontSize: '14px', fontWeight: 700 }}
              >
                <FiZap size={16} />
                <span>Generate Image ({batchCount > 1 ? `${batchCount} Variations` : '1 Image'})</span>
              </button>
            )}
          </div>
        </div>

        {/* Studio Center Workspace */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0, width: '100%', overflow: 'hidden' }}>
          {/* Prompt Composer & Style Presets Box */}
          <div className="studio-panel" style={{ padding: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="form-label" style={{ fontSize: '12px', fontWeight: 700, margin: 0 }}>Image Prompt</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({prompt.length} chars)</span>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setPrompt(PROMPT_INSPIRATIONS[Math.floor(Math.random() * PROMPT_INSPIRATIONS.length)])}
                  className="code-copy-btn"
                  title="Load a creative prompt idea"
                  style={{ fontSize: '11px', padding: '4px 10px' }}
                >
                  <FiStar size={12} /> Inspiration ✨
                </button>
                <button
                  type="button"
                  onClick={() => setPrompt('')}
                  className="code-copy-btn"
                  title="Clear prompt text"
                  style={{ fontSize: '11px', padding: '4px 8px' }}
                >
                  Clear
                </button>
              </div>
            </div>

            <textarea
              rows={3}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Describe the subject, atmosphere, lighting, camera angle, textures, and artistic medium..."
              className="form-textarea"
              style={{ minHeight: '80px', fontSize: '13px', lineHeight: '1.5' }}
            />

            {/* Visual Style Preset Badges */}
            <div style={{ marginTop: '10px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                Click Style Modifiers to Enhance Prompt:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {STYLE_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleApplyStylePreset(preset)}
                    className="chat-control-pill"
                    style={{ fontSize: '11px', padding: '3px 8px', height: 'auto' }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Collapsible Negative Prompt Section */}
            <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border-card-subtle)' }}>
              <div
                onClick={() => setShowNegativePrompt(prev => !prev)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🚫 Negative Prompt (What to Avoid)</span>
                  {showNegativePrompt && <span className="spec-badge" style={{ fontSize: '9px' }}>Active</span>}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                  {showNegativePrompt ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
                </span>
              </div>

              {showNegativePrompt && (
                <div style={{ marginTop: '8px' }}>
                  <textarea
                    rows={2}
                    value={negativePrompt}
                    onChange={e => setNegativePrompt(e.target.value)}
                    placeholder="blurry, low quality, distorted, extra limbs, watermark, bad anatomy..."
                    className="form-textarea"
                    style={{ minHeight: '50px', fontSize: '12px' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                    <button
                      type="button"
                      onClick={() => setNegativePrompt(DEFAULT_NEGATIVE_PROMPT)}
                      className="chat-control-pill"
                      style={{ fontSize: '10px', padding: '2px 6px', height: 'auto' }}
                    >
                      Reset Default Negative
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Canvas Preview Box */}
          <div
            className="studio-panel"
            style={{
              padding: '24px',
              minHeight: '440px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              background: 'radial-gradient(circle at center, rgba(30, 41, 59, 0.4) 0%, var(--bg-card) 100%)',
            }}
          >
            {errorMsg && (
              <div style={{ padding: '14px 20px', borderRadius: '10px', background: 'rgba(244, 63, 94, 0.15)', border: '1px solid rgba(244, 63, 94, 0.3)', color: 'var(--accent-rose)', fontSize: '13px', textAlign: 'center', maxWidth: '600px' }}>
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>⚠️ Image Generation Error</div>
                <div>{errorMsg}</div>
              </div>
            )}

            {/* Denoising Progress / Live Streaming Latents Canvas */}
            {isGenerating && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', maxWidth: '520px', width: '100%' }}>
                {stepPreview ? (
                  <div style={{ position: 'relative', width: '280px', height: '280px', borderRadius: '14px', overflow: 'hidden', border: '2px solid var(--accent-primary)', boxShadow: '0 0 24px rgba(99, 102, 241, 0.3)' }}>
                    <img src={stepPreview} alt="Denoising Step Preview" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(0.5px)' }} />
                    <div style={{
                      position: 'absolute',
                      bottom: '8px',
                      left: '8px',
                      right: '8px',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      background: 'rgba(15, 23, 42, 0.85)',
                      backdropFilter: 'blur(4px)',
                      color: 'white',
                      fontSize: '10px',
                      textAlign: 'center',
                      fontFamily: 'var(--mono)'
                    }}>
                      Step {currentStep} / {totalSteps}
                    </div>
                  </div>
                ) : (
                  <div style={{
                    width: '80px',
                    height: '80px',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(99, 102, 241, 0.2) 0%, transparent 70%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <FiRefreshCw className="spinning" size={36} color="var(--accent-primary)" />
                  </div>
                )}

                <div style={{ textAlign: 'center', width: '100%' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                    {statusMessage}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                    Using {selectedModel} · {effectiveSize} {selectedAdapterId ? `· LoRA: ${selectedAdapterId}` : ''}
                  </div>
                  <div style={{ width: '100%', height: '6px', background: 'var(--border-card)', borderRadius: '6px', overflow: 'hidden' }}>
                    <div style={{ width: `${progressPercent}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent-primary), #a855f7)', transition: 'width 0.25s ease' }} />
                  </div>
                </div>
              </div>
            )}

            {/* Generated Output Preview & Batch Strip */}
            {!isGenerating && currentResult && (
              <div style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {/* Batch Selection Strip if n > 1 */}
                {batchResults.length > 1 && (
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', padding: '6px', background: 'var(--bg-tertiary)', borderRadius: '10px' }}>
                    {batchResults.map((url, idx) => (
                      <div
                        key={idx}
                        onClick={() => setCurrentResult(url)}
                        style={{
                          width: '54px',
                          height: '54px',
                          borderRadius: '6px',
                          overflow: 'hidden',
                          border: currentResult === url ? '2px solid var(--accent-primary)' : '1px solid var(--border-card)',
                          cursor: 'pointer',
                          opacity: currentResult === url ? 1 : 0.6,
                        }}
                      >
                        <img src={url} alt={`Batch ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '540px', display: 'flex', justifyContent: 'center' }}>
                  <img
                    src={currentResult}
                    alt="Generated Diffusion Render"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '500px',
                      borderRadius: 'var(--radius-lg)',
                      boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
                      objectFit: 'contain',
                      border: '1px solid var(--border-card)',
                    }}
                  />
                </div>

                {/* Primary Action Toolbar */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button onClick={() => setLightboxOpen(true)} className="chat-control-pill" title="Enlarge full screen">
                    <FiMaximize2 size={13} /> Fullscreen Zoom
                  </button>
                  <button onClick={() => handleDownload(currentResult)} className="chat-control-pill active" title="Download PNG">
                    <FiDownload size={13} /> Download High-Res PNG
                  </button>
                  <button onClick={handleCopyPrompt} className="chat-control-pill" title="Copy Prompt">
                    {copied ? <FiCheck size={13} /> : <FiCopy size={13} />}
                    {copied ? 'Copied Prompt' : 'Copy Prompt'}
                  </button>
                  <button onClick={handleGenerate} className="chat-control-pill" title="Generate another variation with these settings">
                    <FiZap size={13} /> Re-roll Variation
                  </button>
                  <button
                    onClick={() => {
                      const matchGen = imageGenerations.find(g => g.result === currentResult);
                      if (matchGen) {
                        deleteGeneration(matchGen.id);
                      }
                      setCurrentResult(null);
                    }}
                    className="chat-control-pill"
                    title="Delete Image"
                    style={{ color: 'var(--accent-rose)', borderColor: 'rgba(244, 63, 94, 0.3)' }}
                  >
                    <FiTrash2 size={13} /> Delete
                  </button>
                </div>

                {/* Generation Metadata Inspector Card */}
                {currentMetadata && (
                  <div
                    style={{
                      marginTop: '16px',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-card-subtle)',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '12px',
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      maxWidth: '100%',
                      justifyContent: 'center',
                    }}
                  >
                    <div>Model: <strong style={{ color: 'var(--text-primary)' }}>{currentMetadata.model}</strong></div>
                    <div>Dimensions: <strong style={{ color: 'var(--text-primary)' }}>{currentMetadata.size}</strong></div>
                    <div>Steps: <strong style={{ color: 'var(--text-primary)' }}>{currentMetadata.steps}</strong></div>
                    <div>Guidance: <strong style={{ color: 'var(--text-primary)' }}>{currentMetadata.guidance}</strong></div>
                    {currentMetadata.seed !== undefined && (
                      <div>Seed: <strong style={{ color: 'var(--text-primary)' }}>{currentMetadata.seed}</strong></div>
                    )}
                    {currentMetadata.adapter && (
                      <div>LoRA: <strong style={{ color: 'var(--accent-primary)' }}>{currentMetadata.adapter} ({currentMetadata.scale}x)</strong></div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!isGenerating && !currentResult && !errorMsg && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-dim)', gap: '12px', textAlign: 'center' }}>
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  background: 'var(--bg-tertiary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)'
                }}>
                  <FiImage size={32} />
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                    Canvas Ready for Generation
                  </div>
                  <div style={{ fontSize: '12px', maxWidth: '400px' }}>
                    Configure model, LoRA adapter, resolution, and inference parameters on the left, then click Generate.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* History Gallery Strip */}
          {imageGenerations.length > 0 && (
            <div className="studio-panel" style={{ padding: '16px', minWidth: 0, width: '100%', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FiGrid size={14} color="var(--accent-primary)" />
                  <span className="studio-panel-title" style={{ fontSize: '13px' }}>
                    Generation History ({imageGenerations.length})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Clear all image history?')) {
                      imageGenerations.forEach(g => deleteGeneration(g.id));
                      setCurrentResult(null);
                    }
                  }}
                  className="chat-control-pill"
                  style={{ fontSize: '10px', padding: '3px 8px', height: 'auto', color: 'var(--accent-rose)' }}
                >
                  <FiTrash2 size={10} /> Clear All
                </button>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  padding: '6px 2px 10px 2px',
                  width: '100%',
                  minWidth: 0,
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {imageGenerations.map(gen => (
                  <div
                    key={gen.id}
                    onClick={() => { setCurrentResult(gen.result); setPrompt(gen.prompt); }}
                    style={{
                      position: 'relative',
                      width: '92px',
                      height: '92px',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      border: currentResult === gen.result ? '2px solid var(--accent-primary)' : '1px solid var(--border-card)',
                      cursor: 'pointer',
                      flexShrink: 0,
                      boxShadow: currentResult === gen.result ? '0 0 10px rgba(99, 102, 241, 0.4)' : 'none',
                    }}
                  >
                    <img src={gen.result} alt="Thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button
                      type="button"
                      title="Delete this image"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteGeneration(gen.id);
                        if (currentResult === gen.result) {
                          setCurrentResult(null);
                        }
                      }}
                      style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        background: 'rgba(15, 23, 42, 0.85)',
                        backdropFilter: 'blur(4px)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        color: 'var(--accent-rose)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        padding: 0,
                        zIndex: 2,
                      }}
                    >
                      <FiTrash2 size={11} />
                    </button>
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
            background: 'rgba(0, 0, 0, 0.9)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '24px',
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <img
              src={currentResult}
              alt="Enlarged Fullscreen"
              style={{ maxWidth: '100%', maxHeight: '85vh', borderRadius: '12px', boxShadow: '0 20px 60px rgba(0,0,0,0.8)' }}
            />
            <button
              onClick={() => setLightboxOpen(false)}
              style={{
                position: 'absolute',
                top: '-14px',
                right: '-14px',
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                border: 'none',
                background: 'white',
                color: 'black',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
            >
              <FiX size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
