# Pantry App

A ChatGPT-like React application that leverages the Pantry local AI model hosting API.

## Features

### 💬 Chat
- Multi-turn conversation with streaming responses (SSE)
- Selectable models with real-time capability resolution
- Speculative decoding support (draft/target model pairs)
- LoRA adapter support for fine-tuned models
- System prompt configuration
- Quick prompt suggestions
- Enter to send, Shift+Enter for newline

### 📦 Model Management
- Browse all available and installed models
- Search and filter by name/alias
- Pull model weights into local store
- Load/unload models with resident status
- View model metadata (size, context, quantization, modality)

### 🎨 Generate
- **Image Generation**: FLUX diffusion via Metal acceleration
- **Audio Generation**: Music generation via mlx-audio
- **Speech-to-Text**: Whisper transcription with language support

### ⚙️ Settings
- API connection configuration
- Health check & status monitoring
- CAS storage inspection & pruning
- Metal memory cache management
- Current configuration preview

### 📊 System Monitor
- Real-time telemetry (CPU, Memory, GPU, Disk)
- Model performance metrics (p50/p95 TPS, TTFT, energy efficiency)
- KV-cache and inference pipeline stats
- Expandable model detail rows

## Development

```bash
cd pantry-app
npm install
npm run dev
```

The app runs on http://localhost:3000 and proxies API calls to http://127.0.0.1:18787 (Pantry daemon).

## Build

```bash
npm run build
```

## Architecture

```
pantry-app/
├── src/
│   ├── context/        # AppContext (global state management)
│   ├── services/       # API & streaming clients
│   ├── components/     # Reusable UI components
│   ├── pages/          # Route-level views
│   └── types/          # TypeScript type definitions
├── dist/               # Production build output
├── vite.config.ts      # Vite configuration (proxy to pantry daemon)
└── package.json
```

## API Integration

All endpoints connect to the Pantry daemon at `http://127.0.0.1:18787`:

- `/v1/chat/completions` - Chat with SSE streaming
- `/v1/images/generations` - Image generation
- `/v1/audio/generations` - Audio generation
- `/v1/audio/transcriptions` - Speech-to-text
- `/v1/embeddings` - Vector embeddings
- `/v1/resolve` - Capability arbitration
- `/v1/models` - Model listing
- `/v1/pull`, `/v1/load`, `/v1/unload` - Model lifecycle
- `/v1/monitor/stats` - System telemetry
- `/v1/storage`, `/v1/storage/prune` - CAS storage
- `/v1/health`, `/v1/memory`, `/v1/memory/clear` - System management
