# Install

Requires Python 3.11+ on Apple Silicon.

## Homebrew (recommended on macOS)

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

## pip (from a clone)

One install covers inference **and** the menu bar that `pantry serve` opens by default:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[mac]"
# equivalent: pip install -e ".[mlx,menubar]"
```

With tests / lint:

```bash
pip install -e ".[mac,dev]"
```

From GitHub without cloning:

```bash
pip install "git+https://github.com/vdplabs/pantry.git#egg=pantry[mac]"
# or:
pip install "git+https://github.com/vdplabs/pantry.git#egg=pantry[mlx,menubar]"
```

If you omit `menubar` / `mac`, `pantry serve` still listens on HTTP but skips the menu bar and tells you to install the extra.

## uv

```bash
uv tool install --with mlx --with mlx-lm --with rumps \
  "git+https://github.com/vdplabs/pantry.git"
```

Or in a project:

```bash
uv add "pantry[mac] @ git+https://github.com/vdplabs/pantry.git"
```

## After install

```bash
pantry init
pantry pull vdplabs.qwen25-0.5b.compact.v1      # ~290 MB
pantry pull vdplabs.qwen25-1.5b.standard.v1     # ~870 MB (draft pair)
pantry serve                  # HTTP + menu bar
pantry serve --no-menubar     # HTTP only
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

