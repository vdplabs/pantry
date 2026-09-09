# Install

Requires Python 3.11+. Supported on **macOS (Apple Silicon)** and **Linux (NVIDIA DGX, CUDA GPUs, or CPU)**.

## macOS (Apple Silicon)

### Homebrew (recommended on macOS)

```bash
brew tap vdplabs/tap
brew install pantry
```

Then:

```bash
pantry init
pantry pull vdplabs.qwen25-0.5b.compact.v1
pantry serve                  # HTTP + menu bar
```

The formula lives in the separate tap: [vdplabs/homebrew-tap](https://github.com/vdplabs/homebrew-tap) (`brew tap vdplabs/tap`).

### pip (macOS Apple Silicon)

Installs native Apple Silicon MLX inference and the macOS menu bar:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[mac]"
# equivalent: pip install -e ".[mlx,menubar]"
```

With developer tools and test suites:

```bash
pip install -e ".[mac,dev]"
```

---

## Linux & NVIDIA DGX (CUDA)

For NVIDIA DGX clusters, GPU workstations, and Linux hosts, Pantry utilizes PyTorch, Hugging Face `transformers`, `accelerate`, and NVML (`pynvml`).

### pip (Linux / NVIDIA CUDA)

```bash
python3.12 -m venv .venv
source .venv/bin/activate

# Install with CUDA acceleration & hardware telemetry
pip install -e ".[cuda]"

# With developer tools and tests
pip install -e ".[cuda,dev]"
```

### pip (Linux / Headless CPU or vLLM)

```bash
# Standard Linux (psutil + huggingface-hub)
pip install -e ".[linux]"

# vLLM inference engine extra
pip install -e ".[vllm]"
```

---

## uv

```bash
# On macOS (Apple Silicon):
uv tool install --with mlx --with mlx-lm --with rumps \
  "git+https://github.com/vdplabs/pantry.git"

# On Linux (NVIDIA CUDA):
uv tool install --with torch --with transformers --with accelerate --with pynvml \
  "git+https://github.com/vdplabs/pantry.git"
```

---

## After install

```bash
pantry init
pantry pull vdplabs.qwen25-0.5b.compact.v1      # ~290 MB
pantry pull vdplabs.qwen25-1.5b.standard.v1     # ~870 MB (draft pair)
pantry serve                  # HTTP + menu bar (on macOS)
pantry serve --no-menubar     # HTTP only (default on headless/Linux)
pantry dashboard              # Opens the Web System Monitor in your browser
```

### External SSD (optional)

Keep small metadata on the internal drive; put weights on an external APFS volume:

```bash
export PANTRY_HOME="$HOME/Library/Application Support/VDPPantry"
export PANTRY_DATA="/Volumes/Models/VDPPantry"   # alias: PANTRY_BLOBS
pantry init
pantry serve --data "$PANTRY_DATA"
```

See the README [Configuration](../README.md#configuration) section.

## Troubleshooting

### Apple Silicon `Namespace CODESIGNING, Code 2, Invalid Page`

If macOS terminates `pantry` with `Namespace CODESIGNING, Code 2, Invalid Page` (often after Homebrew installation or copying environments across Macs), a compiled C-extension (`.so` / `.dylib`) has an invalid page hash.

**1. Homebrew installation:**
Update your tap and run `brew postinstall`:
```bash
brew update
brew postinstall vdplabs/tap/pantry
```
Or manually re-sign native libraries with Apple's `codesign`:
```bash
find "$(brew --prefix pantry)/libexec" -type f \( -name "*.so" -o -name "*.dylib" \) -exec codesign --force --sign - {} +
```

**2. Virtual environment (pip / git clone):**
Re-sign the `.so` files in your `.venv`:
```bash
find .venv -type f \( -name "*.so" -o -name "*.dylib" \) -exec codesign --force --sign - {} +
```
*(Never copy a `.venv` directory directly between different Mac computers; always create a fresh virtual environment natively).*

