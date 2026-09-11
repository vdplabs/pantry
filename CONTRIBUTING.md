# Contributing to Pantry

Thank you for your interest in contributing to **Pantry**! Pantry is an open-source local and cluster AI model host built for Apple Silicon and Linux (NVIDIA CUDA).

Pantry is released under the [MIT License](LICENSE). We welcome contributions of all kinds: bug fixes, performance optimizations, new model manifests in the catalog, new inference runtime adapters, and documentation improvements.

---

## Code of Conduct

We are committed to providing a friendly, welcoming, and harassment-free environment for all contributors. Please be respectful, constructive, and collaborative in all issues, discussions, and pull requests.

---

## Getting Started

### Prerequisites
- macOS (Apple Silicon M1/M2/M3/M4) or Linux with NVIDIA GPU (CUDA 12+).
- Python 3.11 or higher.
- `uv` (recommended) or standard Python `venv`.
- `git`.

### Setting Up Your Development Environment

1. **Clone the repository**:
   ```bash
   git clone https://github.com/vdplabs/pantry.git
   cd pantry
   ```

2. **Create and activate a virtual environment**:
   ```bash
   # Using uv (fastest)
   uv venv
   source .venv/bin/activate

   # Or standard venv
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. **Install dependencies in editable mode**:
   ```bash
   # On macOS (with MLX, dev tools, and menu bar)
   pip install -e ".[dev,mac]"

   # On Linux (with CUDA PyTorch and dev tools)
   pip install -e ".[dev,cuda]"
   ```

4. **Verify your installation**:
   ```bash
   pantry --help
   pantry patent
   ```

---

## Running Tests & Quality Checks

We maintain 100% test pass rate across our test suite. Before submitting a pull request, ensure all tests pass and code conforms to our linting standards.

### Running Pytest
```bash
# Run all unit tests
pytest

# Run specifically the patent claims verification tests
pytest tests/test_patent_fig2_resolve.py tests/test_patent_claims.py -v

# Run with verbose output and coverage
pytest -v
```

### Code Formatting & Linting
We use [Ruff](https://astral.sh/ruff) for fast, consistent linting and code formatting:
```bash
# Check for lint issues
ruff check .

# Automatically apply safe fixes
ruff check --fix .

# Format code
ruff format .
```

---

## Repository Architecture & Core Components

Pantry implements the innovations specified in **U.S. Provisional Patent Application # 64/148,883** (*Shared Unified Memory Storage & Host Model Management*):

- **[`src/pantry/resolve.py`](src/pantry/resolve.py)**: **Patent Claim 1 (FIG. 2 Steps 202–218)**: Multi-constraint capability resolution engine that arbitrates model selection based on dynamic memory headroom, roofline TPS estimation, and automated fallback cascades.
- **[`src/pantry/cas.py`](src/pantry/cas.py)**: **Patent Claim 2 (RFC-0006)**: Content-Addressable Storage (CAS) engine with SHA-256 chunking, tensor deduplication across quantization levels, SQLite refcounting, and APFS clonefile extent sharing.
- **[`src/pantry/worker.py`](src/pantry/worker.py) & [`src/pantry/memory.py`](src/pantry/memory.py)**: **Patent Claim 3**: Zero-retention ephemeral memory execution, worker process isolation for deterministic Metal/CUDA driver reclamation, and unified memory watchdog.
- **[`src/pantry/hardware.py`](src/pantry/hardware.py)**: Apple Silicon & NVIDIA GPU discovery, bandwidth lookup, and mathematical roofline throughput estimation ($\text{TPS} = (\text{Bandwidth} / \text{Size}) \times 0.55$).
- **[`src/pantry/server.py`](src/pantry/server.py)**: FastAPI host application serving OpenAI-compatible endpoints (`/v1/chat/completions`, `/v1/images/generations`, `/v1/audio/transcriptions`, `/v1/models`, `/v1/resolve`, `/v1/storage`).
- **[`src/pantry/static/dashboard.html`](src/pantry/static/dashboard.html)**: Interactive Web System Monitor Dashboard (`/dashboard`) featuring real-time hardware telemetry, model performance benchmarking, token usage & cloud ROI analytics, and playground.
- **[`catalog/`](catalog/)**: Curated, versioned package manifests defining model weights, quality tiers, prompt templates, and speculative draft pairings.

See [Docs/Patent-Claims.md](Docs/Patent-Claims.md) and [Docs/Architecture.md](Docs/Architecture.md) for detailed technical specifications.

---

## Contributing a New Model to the Catalog

To add a new curated model package:
1. Create a new JSON manifest under `catalog/<package_id>.json` (or add to an existing family folder).
2. Follow the `PackageManifest` schema:
   ```json
   {
     "id": "vdplabs.my-model.standard.v1",
     "family": "my-family",
     "title": "My Model Name",
     "modality": "chat",
     "quality_tier": "standard",
     "ram_gb_min": 4.0,
     "ram_gb_comfortable": 6.0,
     "context_max": 32768,
     "runtime": {
       "primary": "mlx",
       "hf_repo": "mlx-community/My-Model-4bit"
     },
     "template_family": "chatml",
     "eval": {
       "score": 82.5
     }
   }
   ```
3. Run tests to ensure the manifest parses cleanly:
   ```bash
   pytest tests/test_resolve_store.py
   ```

---

## Pull Request Guidelines

1. **Create a topic branch**:
   ```bash
   git checkout -b feature/my-enhancement
   ```
2. **Keep commits focused and descriptive**:
   - Follow standard commit conventions: `feat(...)`, `fix(...)`, `docs(...)`, `test(...)`.
3. **Add automated tests**:
   - Any new feature, API endpoint, or bug fix must include corresponding tests in `tests/`.
4. **Update documentation**:
   - If your change modifies CLI arguments, HTTP endpoints, or schemas, update the relevant files in `Docs/` and `README.md`.
5. **Open a Pull Request**:
   - Provide a clear description of the problem solved and links to any related issues.
   - Verify that all GitHub Actions CI checks pass.

---

## Questions & Discussions

- **Issue Tracker**: [github.com/vdplabs/pantry/issues](https://github.com/vdplabs/pantry/issues)
- **Documentation**: [Docs/](Docs/)
