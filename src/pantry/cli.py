from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

import typer
import uvicorn

from pantry import __version__
from pantry.config import bundled_catalog_dir, default_data, default_home
from pantry.resolve import ResolveError, resolve
from pantry.schemas import CapabilityRequest, LatencyClass, QualityTier
from pantry.server import create_app
from pantry.store import PackageStore

app = typer.Typer(
    name="pantry",
    help="Mac model host — shared packages, capability resolve, localhost OpenAI API.",
    no_args_is_help=True,
)


def _store(home: Path | None, data: Path | None = None) -> PackageStore:
    root = Path(home).expanduser().resolve() if home else default_home()
    data_root = Path(data).expanduser().resolve() if data else default_data(root)
    store = PackageStore(root, data_root=data_root)
    store.ensure()
    return store


def _daemon_base(host: str, port: int) -> str:
    return f"http://{host}:{port}"


def _get_daemon_client(
    host: str = "127.0.0.1",
    port: int = 18787,
    socket_path: Path | None = None,
) -> tuple[Any, str]:
    """Return an httpx.Client and base_url, preferring Unix domain socket if available."""
    import os
    import httpx

    sock = socket_path
    if not sock:
        env = os.environ.get("PANTRY_SOCKET")
        if env:
            sock = Path(env).expanduser().resolve()
        else:
            default_sock = default_home() / "pantry.sock"
            if default_sock.is_socket():
                sock = default_sock

    if sock and sock.is_socket():
        try:
            transport = httpx.HTTPTransport(uds=str(sock))
            client = httpx.Client(transport=transport, timeout=5.0)
            return client, "http://localhost"
        except Exception:
            pass

    return httpx.Client(timeout=5.0), f"http://{host}:{port}"


def _daemon_post(
    path: str,
    payload: dict,
    *,
    host: str = "127.0.0.1",
    port: int = 18787,
    socket_path: Path | None = None,
) -> dict | None:
    """POST to a running pantry serve; return JSON or None if unreachable."""
    client, base_url = _get_daemon_client(host=host, port=port, socket_path=socket_path)
    url = f"{base_url}{path}"
    try:
        with client:
            r = client.post(url, json=payload)
    except Exception:  # noqa: BLE001
        return None
    if r.status_code >= 400:
        typer.secho(
            f"daemon {path} -> HTTP {r.status_code}: {r.text[:300]}",
            fg=typer.colors.RED,
            err=True,
        )
        return None
    try:
        body = r.json()
    except Exception:  # noqa: BLE001
        return {"ok": True, "raw": r.text}
    return body if isinstance(body, dict) else {"ok": True, "body": body}


@app.command()
def version() -> None:
    """Print version."""
    typer.echo(__version__)


@app.command("init")
def init_cmd(
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME (metadata)"),
    data: Path | None = typer.Option(
        None,
        "--data",
        help="Override PANTRY_DATA (blobs + weights; e.g. external SSD)",
    ),
    catalog: Path | None = typer.Option(None, help="Catalog directory of package manifests"),
) -> None:
    """Create library dirs and seed bundled catalog manifests."""
    store = _store(home, data)
    cat = Path(catalog) if catalog else bundled_catalog_dir()
    installed = store.seed_from_catalog(cat, overwrite=True)
    typer.echo(f"home={store.root}")
    typer.echo(f"data={store.data_root}")
    typer.echo(f"seeded {len(installed)} package(s) from {cat}")
    for pid in installed:
        typer.echo(f"  - {pid}")


@app.command("resolve")
def resolve_cmd(
    modality: str = typer.Option("chat", "--modality"),
    task: str | None = typer.Option(None, "--task", help="coding|reasoning|chat|general|embed"),
    ram_gb_max: float | None = typer.Option(None, "--ram-gb-max"),
    quality: str | None = typer.Option(None, "--quality", help="standard|compact|extreme"),
    latency: str = typer.Option("balanced", "--latency", help="balanced|fast"),
    family_prefer: str | None = typer.Option(None, "--family"),
    template_family: str | None = typer.Option(None, "--template-family"),
    tool_protocol: str | None = typer.Option(None, "--tool-protocol"),
    prefer_speculative: bool = typer.Option(False, "--speculative"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
) -> None:
    """Resolve a package from capabilities (installed catalog only)."""
    store = _store(home)
    tier = QualityTier(quality) if quality else None
    req = CapabilityRequest(
        modality=modality,
        task_intent=task,
        ram_gb_max=ram_gb_max,
        quality_tier=tier,
        latency_class=LatencyClass(latency),
        family_prefer=family_prefer,
        template_family=template_family,
        tool_protocol=tool_protocol,
        prefer_speculative=prefer_speculative,
    )
    try:
        result = resolve(req, store.list_manifests(), is_ready=store.weights_ready)
    except ResolveError as e:
        typer.secho(e.message, fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from e
    typer.echo(result.model_dump_json(indent=2))


@app.command()
def pull(
    package_id: str = typer.Argument(..., help="Package id to pull / register"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
) -> None:
    """Download package weights (HF) into the local pantry library."""
    from pantry.pull import PullError, pull_package

    store = _store(home)
    try:
        result = pull_package(store, package_id)
    except PullError as e:
        typer.secho(e.message, fg=typer.colors.RED, err=True)
        raise typer.Exit(1) from e
    store.mark_loaded(result["package_id"], pin=False)
    typer.echo(json.dumps(result, indent=2))


@app.command("list")
def list_cmd(
    loaded: bool = typer.Option(False, "--loaded"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
) -> None:
    """List installed (or loaded) packages."""
    store = _store(home)
    if loaded:
        state = store.read_state()
        for pid in state.get("loaded", []):
            typer.echo(pid)
        return
    for p in store.list_manifests():
        aliases = ",".join(p.aliases) if p.aliases else "-"
        ready = "ready" if store.weights_ready(p) else "need-pull"
        typer.echo(
            f"{p.id}\ttier={p.quality_tier.value}\tfamily={p.family}\t"
            f"runtime={p.runtime.primary}\t{ready}\taliases={aliases}"
        )


@app.command()
def load(
    package_id: str = typer.Argument(...),
    pin: bool = typer.Option(False, "--pin"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
) -> None:
    """Mark package loaded (warm) — prefers the running daemon when available."""
    store = _store(home)
    manifest = store.load_manifest(package_id)
    if manifest is None:
        from pantry.resolve import find_by_model_string

        manifest = find_by_model_string(package_id, store.list_manifests())
    if manifest is None:
        manifest = store.install_from_bundled_catalog(package_id)
    if manifest is None:
        typer.secho(f"unknown package: {package_id}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)
    target_id = manifest.id
    remote = _daemon_post(
        "/v1/load",
        {"package_id": target_id, "pin": pin},
        host=host,
        port=port,
    )
    if remote is not None:
        typer.echo(json.dumps(remote, indent=2))
        return
    store.mark_loaded(target_id, pin=pin)
    typer.echo(
        json.dumps(
            {
                "ok": True,
                "loaded": store.read_state().get("loaded", []),
                "package_id": target_id,
                "via": "local-state",
                "note": "no pantry serve on "
                f"{host}:{port}; marked state only (weights warm on first chat)",
            },
            indent=2,
        )
    )


@app.command()
def unload(
    package_id: str | None = typer.Argument(
        None, help="Package id (omit to unload all warm runtimes)"
    ),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
) -> None:
    """Unload runtime weights from the running daemon (falls back to local state)."""
    target_id = package_id
    store = _store(home)
    if target_id:
        manifest = store.load_manifest(target_id)
        if manifest is None:
            from pantry.resolve import find_by_model_string

            manifest = find_by_model_string(target_id, store.list_manifests())
        if manifest is not None:
            target_id = manifest.id
    remote = _daemon_post(
        "/v1/unload",
        {"package_id": target_id},
        host=host,
        port=port,
    )
    if remote is not None:
        typer.echo(json.dumps(remote, indent=2))
        return
    if target_id:
        store.mark_unloaded(target_id)
    else:
        state = store.read_state()
        for pid in list(state.get("loaded", [])):
            store.mark_unloaded(pid)
    typer.secho(
        f"no pantry serve on {host}:{port}; cleared local state only "
        f"({'all' if not target_id else target_id})",
        fg=typer.colors.YELLOW,
        err=True,
    )
    typer.echo(
        json.dumps(
            {
                "ok": True,
                "unloaded": package_id or "all",
                "loaded": store.read_state().get("loaded", []),
                "via": "local-state",
            },
            indent=2,
        )
    )


@app.command()
def status(
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME (metadata)"),
    data: Path | None = typer.Option(
        None,
        "--data",
        help="Override PANTRY_DATA (blobs + weights)",
    ),
) -> None:
    """Show library + loaded state + Metal/unified-memory watchdog snapshot."""
    from pantry.memory import snapshot as memory_snapshot

    store = _store(home, data)
    state = store.read_state()
    payload = {
        "version": __version__,
        "home": str(store.root),
        "data": str(store.data_root),
        "packages": [
            {
                "id": p.id,
                "runtime": p.runtime.primary,
                "weights_ready": store.weights_ready(p),
                "hf_repo": p.runtime.hf_repo,
            }
            for p in store.list_manifests()
        ],
        "loaded": state.get("loaded", []),
        "pinned": state.get("pinned", []),
        "memory": memory_snapshot(apply_limits=False),
    }
    typer.echo(json.dumps(payload, indent=2))


@app.command()
def health(
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
    socket_path: Path | None = typer.Option(None, "--uds", "--socket", help="Override socket path"),
) -> None:
    """HTTP / UDS health check against a running pantry serve."""
    client, base_url = _get_daemon_client(host=host, port=port, socket_path=socket_path)
    url = f"{base_url}/v1/health"
    try:
        with client:
            r = client.get(url, timeout=5.0)
            r.raise_for_status()
    except Exception as e:
        typer.secho(f"health failed: {e}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1) from e
    typer.echo(r.text)


@app.command()
def storage(
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME (metadata)"),
    data: Path | None = typer.Option(None, "--data", help="Override PANTRY_DATA (blobs + weights)"),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
    as_json: bool = typer.Option(False, "--json", help="Output raw JSON"),
) -> None:
    """Inspect Content-Addressed Storage (CAS) deduplication telemetry and disk savings."""
    client, base_url = _get_daemon_client(host=host, port=port)
    try:
        with client:
            r = client.get(f"{base_url}/v1/storage", timeout=2.0)
            if r.status_code == 200:
                stats = r.json()
            else:
                store = _store(home, data)
                stats = store.cas.get_stats()
    except Exception:
        store = _store(home, data)
        stats = store.cas.get_stats()

    if as_json:
        typer.echo(json.dumps(stats, indent=2))
        return

    def _fmt(b: int) -> str:
        val = float(b)
        for unit in ["B", "KB", "MB", "GB", "TB"]:
            if val < 1024 or unit == "TB":
                return f"{val:.1f} {unit}" if unit != "B" else f"{int(val)} B"
            val /= 1024
        return f"{val:.1f} B"

    typer.echo(f"CAS Root:       {stats.get('data_root')}")
    typer.echo(f"Total Packages: {stats.get('total_packages')}")
    typer.echo(f"Total Chunks:   {stats.get('total_chunks')}")
    typer.echo(f"Apparent Size:  {_fmt(stats.get('apparent_size_bytes', 0))}")
    typer.echo(f"Physical Size:  {_fmt(stats.get('physical_size_bytes', 0))}")
    typer.echo(f"Deduplication:  {stats.get('dedup_ratio', 1.0)}x")
    typer.echo(f"Disk Saved:     {_fmt(stats.get('dedup_saved_bytes', 0))}")


@app.command()
def prune(
    dry_run: bool = typer.Option(False, "--dry-run", help="Preview reclaimable chunks without deleting"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME (metadata)"),
    data: Path | None = typer.Option(None, "--data", help="Override PANTRY_DATA (blobs + weights)"),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
) -> None:
    """Reclaim unreferenced model weight chunks (refcount == 0)."""
    client, base_url = _get_daemon_client(host=host, port=port)
    try:
        with client:
            r = client.post(f"{base_url}/v1/storage/prune", json={"dry_run": dry_run}, timeout=10.0)
            if r.status_code == 200:
                res = r.json()
            else:
                store = _store(home, data)
                count, bytes_rec = store.cas.prune(dry_run=dry_run)
                res = {"ok": True, "dry_run": dry_run, "chunks_pruned": count, "bytes_reclaimed": bytes_rec}
    except Exception:
        store = _store(home, data)
        count, bytes_rec = store.cas.prune(dry_run=dry_run)
        res = {"ok": True, "dry_run": dry_run, "chunks_pruned": count, "bytes_reclaimed": bytes_rec}

    def _fmt(b: int) -> str:
        val = float(b)
        for unit in ["B", "KB", "MB", "GB", "TB"]:
            if val < 1024 or unit == "TB":
                return f"{val:.1f} {unit}" if unit != "B" else f"{int(val)} B"
            val /= 1024
        return f"{val:.1f} B"

    action = "reclaimable" if dry_run else "reclaimed"
    typer.echo(f"{res.get('chunks_pruned', 0)} chunks {action} ({_fmt(res.get('bytes_reclaimed', 0))})")


def _patent_impl(
    as_json: bool = False,
    home: Path | None = None,
    data: Path | None = None,
    host: str = "127.0.0.1",
    port: int = 18787,
) -> None:
    from pantry.hardware import estimate_generation_tps, get_apple_silicon_device_info
    from pantry.memory import get_available_unified_dram

    device_info = get_apple_silicon_device_info()
    avail_bytes = get_available_unified_dram()

    # Query CAS stats
    client, base_url = _get_daemon_client(host=host, port=port)
    stats: dict = {}
    try:
        with client:
            r = client.get(f"{base_url}/v1/storage", timeout=2.0)
            if r.status_code == 200:
                stats = r.json()
            else:
                store = _store(home, data)
                stats = store.cas.get_stats()
    except Exception:
        store = _store(home, data)
        stats = store.cas.get_stats()

    def _fmt(b: int) -> str:
        val = float(b)
        for unit in ["B", "KB", "MB", "GB", "TB"]:
            if val < 1024 or unit == "TB":
                return f"{val:.1f} {unit}" if unit != "B" else f"{int(val)} B"
            val /= 1024
        return f"{val:.1f} B"

    chip_name = device_info.get("device_name", "Unknown Host")
    bw = device_info.get("bandwidth_gbps", 0.0)
    sample_tps = round(estimate_generation_tps(870 * 1024 * 1024, chip_name), 1)

    patent_data = {
        "patent": {
            "title": "System and Method for Host-Managed Multi-Client Model Capability Routing, Shared Unified Memory Storage, and Coordinated Speculative Decoding",
            "application_number": "64/148,883",
            "jurisdiction": "United States Patent and Trademark Office (USPTO)",
            "assignee": "VDP Labs",
            "formal_docs": [
                "Docs/Patent/Pantry Patent Specification.pdf",
                "Docs/Patent/Pantry Patent Drawings.pdf",
            ],
            "license": "MIT License (Open Source Reference Implementation)",
            "specification_doc": "Docs/Patent-Claims.md",
        },
        "claims": [
            {
                "claim": 1,
                "title": "Dynamic Hardware Telemetry & Multi-Constraint Capability Resolution",
                "diagram": "FIG. 2 (Steps 202-218)",
                "description": "Closed-loop arbitration mapping abstract intent tuples to execution plans via real-time memory headroom and roofline throughput estimation.",
                "operational_steps": [
                    "202: Abstract capability request tuple (modality, task_intent, quality_tier, ram_gb_max, prefer_speculative, allow_fallback)",
                    "204: Hardware telemetry interrogation for dynamic memory headroom ceiling C_dynamic = min(R_budget, D_available)",
                    "206: Multi-constraint manifest filtering by modality, template family, tool protocol, and license",
                    "208: Task-intent alignment scoring and memory bus roofline TPS estimation: TPS = (Bandwidth / ModelSize) * 0.55",
                    "210: Candidate model selection along Pareto frontier",
                    "212: Speculative decoding candidate pair evaluation (target + draft composite memory footprint)",
                    "214: Dynamic memory ceiling verification: Composite_Footprint <= C_dynamic",
                    "216: Automated fallback cascade (disable speculative -> downgrade quality tier -> clamp context ceiling)",
                    "218: Formal ExecutionPlan output (runtime, quant_scheme, context_window, estimated_tps, footprint_bytes, ceiling_bytes)",
                ],
            },
            {
                "claim": 2,
                "title": "Content-Addressable Storage (CAS) & Cross-Quantization Tensor Deduplication",
                "standard": "RFC-0006",
                "description": "Chunked cryptographic storage (SHA-256) with tensor-aware boundary alignment, cross-quantization deduplication (shared embeddings, normalization layers, vision towers), and zero-copy APFS clonefile extent sharing.",
                "components": [
                    "cas/chunks/<sha256[:2]>/<sha256>.chunk: Two-character prefix sharded immutable chunk store",
                    "index.db: SQLite WAL catalog with transactional refcounting and automated pruning",
                    "APFS clonefile (copyfile COPYFILE_CLONE): Zero-copy filesystem extent sharing eliminating duplicate disk bytes without runtime read overhead",
                    "recipes: Reconstitution manifest mapping chunks to standard safetensors/gguf weight trees",
                ],
            },
            {
                "claim": 3,
                "title": "Zero-Retention Ephemeral Execution & Subprocess Worker Isolation",
                "description": "Transient memory execution guaranteeing that prompts and completions are maintained exclusively in memory pages without unencrypted persistence, paired with worker process isolation for deterministic OS memory reclamation.",
                "mechanisms": [
                    "Ephemeral unified DRAM / VRAM execution with zero secondary disk spooling of prompts or KV-cache activations",
                    "Subprocess worker isolation (--worker-isolation): Child process termination immediately frees 100% of Metal/CUDA allocations",
                    "Hardware watchdog enforcing cache caps and reclaim timers",
                ],
            },
        ],
        "telemetry": {
            "device": chip_name,
            "bandwidth_gbps": bw,
            "available_dram_gb": round(avail_bytes / (1024**3), 2),
            "sample_1b5_roofline_tps": sample_tps,
            "cas_root": stats.get("data_root"),
            "cas_dedup_ratio": f"{stats.get('dedup_ratio', 1.0)}x",
            "cas_saved_bytes": stats.get("dedup_saved_bytes", 0),
            "cas_saved_human": _fmt(stats.get("dedup_saved_bytes", 0)),
            "cas_total_chunks": stats.get("total_chunks", 0),
        },
    }

    if as_json:
        typer.echo(json.dumps(patent_data, indent=2))
        return

    typer.secho("==================================================================", fg=typer.colors.CYAN, bold=True)
    typer.secho("  PANTRY: PATENT CLAIMS & ARCHITECTURE SPECIFICATION", fg=typer.colors.CYAN, bold=True)
    typer.secho("  U.S. Provisional Patent Application # 64/148,883", fg=typer.colors.YELLOW, bold=True)
    typer.secho("  Assignee: VDP Labs  |  License: MIT (Open Source Reference)", fg=typer.colors.WHITE)
    typer.secho("==================================================================", fg=typer.colors.CYAN, bold=True)
    typer.echo()

    typer.secho("CLAIM 1: Dynamic Hardware Telemetry & Capability Resolution (FIG. 2)", fg=typer.colors.GREEN, bold=True)
    typer.echo("  Closed-loop multi-constraint capability arbitration based on real-time hardware telemetry:")
    typer.echo("  • Step 202: Abstract Capability Intent Tuple (modality, quality tier, RAM budget, intent)")
    typer.echo(f"  • Step 204: Telemetry Interrogation (Current Unpaged Headroom: {round(avail_bytes / (1024**3), 2)} GB)")
    typer.echo("  • Step 206: Multi-Constraint Manifest Filtering (modality, template, tool protocol, license)")
    typer.echo(f"  • Step 208: Roofline TPS Estimation ({chip_name} @ {bw} GB/s -> ~{sample_tps} tok/s for 1.5B)")
    typer.echo("  • Step 212: Speculative Candidate Pair Feasibility (Target + Draft composite footprint)")
    typer.echo("  • Step 214: Dynamic Memory Ceiling Verification (Footprint <= min(RAM_budget, Available_DRAM))")
    typer.echo("  • Step 216: Automated Fallback Cascade (disable speculative -> downgrade tier -> clamp context)")
    typer.echo("  • Step 218: Resolved Execution Plan synthesis with roofline TPS and context ceiling")
    typer.echo()

    typer.secho("CLAIM 2: Content-Addressable Storage (CAS) & Tensor Deduplication (RFC-0006)", fg=typer.colors.GREEN, bold=True)
    typer.echo("  Cryptographic chunking and cross-quantization deduplication across model weights:")
    typer.echo("  • SHA-256 Content-Addressed Sharded Store under $PANTRY_DATA/cas/chunks/")
    typer.echo("  • Cross-Quantization Deduplication: 100% sharing of token embeddings (embed_tokens), norms, & vision towers")
    typer.echo("  • Zero-Copy APFS Materialization: copyfile(COPYFILE_CLONE) provides contiguous files with 0 read overhead")
    typer.echo(f"  • Active CAS Status: {stats.get('total_chunks', 0)} chunks | {stats.get('dedup_ratio', 1.0)}x deduplication ({_fmt(stats.get('dedup_saved_bytes', 0))} disk saved)")
    typer.echo()

    typer.secho("CLAIM 3: Zero-Retention Ephemeral Execution & Hardware Isolation", fg=typer.colors.GREEN, bold=True)
    typer.echo("  Privacy-first in-memory inference and deterministic OS-level memory reclamation:")
    typer.echo("  • Ephemeral virtual memory execution: zero unencrypted disk caching of user prompts or tokens")
    typer.echo("  • Worker Process Isolation (--worker-isolation): subprocess exit reclaims 100% of Metal/CUDA allocations")
    typer.echo("  • Dynamic memory watchdog with proactive cache caps and reclaim timers")
    typer.echo()

    typer.secho("Detailed Specification: Docs/Patent-Claims.md", fg=typer.colors.MAGENTA)
    typer.secho("API Contract: POST /v1/resolve | GET /v1/storage", fg=typer.colors.MAGENTA)
    typer.echo()


@app.command("patent")
def patent_command(
    as_json: bool = typer.Option(False, "--json", help="Output raw JSON specification"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
    data: Path | None = typer.Option(None, "--data", help="Override PANTRY_DATA"),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
) -> None:
    """Display Provisional Patent # 64/148,883 specifications and live hardware/CAS claims telemetry."""
    _patent_impl(as_json=as_json, home=home, data=data, host=host, port=port)


@app.command("claims")
def claims_command(
    as_json: bool = typer.Option(False, "--json", help="Output raw JSON specification"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
    data: Path | None = typer.Option(None, "--data", help="Override PANTRY_DATA"),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
) -> None:
    """Alias for 'pantry patent'."""
    _patent_impl(as_json=as_json, home=home, data=data, host=host, port=port)


@app.command()
def serve(
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
    uds: Path | None = typer.Option(
        None,
        "--uds",
        "--socket",
        help="Unix domain socket path (default: <PANTRY_HOME>/pantry.sock; pass 'none' to disable)",
    ),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME (metadata)"),
    data: Path | None = typer.Option(
        None,
        "--data",
        help="Override PANTRY_DATA (blobs + weights; e.g. external SSD)",
    ),
    reload: bool = typer.Option(False, "--reload"),
    menubar: bool = typer.Option(
        True,
        "--menubar/--no-menubar",
        help="Open the Mac menu bar monitor (default on; needs pantry[menubar])",
    ),
    worker_isolation: bool = typer.Option(
        False,
        "--worker-isolation",
        help="Run MLX in an isolated worker subprocess so unload can reclaim that process's Metal allocations",
    ),
) -> None:
    """Run localhost OpenAI-compatible HTTP server with dual TCP and UDS listeners."""
    import threading
    import time

    store = _store(home, data)
    cat = bundled_catalog_dir()
    if cat.is_dir():
        seeded = store.seed_from_catalog(cat, overwrite=False)
        if seeded:
            typer.echo(f"auto-seeded {len(seeded)} new package(s) from catalog: {', '.join(seeded)}")
    fastapi_app = create_app(store, worker_isolation=worker_isolation)
    typer.echo(
        f"pantry serve http://{host}:{port}  home={store.root}  data={store.data_root}"
    )

    import socket

    sockets: list[socket.socket] = []

    s_tcp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s_tcp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s_tcp.bind((host, port))
        s_tcp.listen(128)
        sockets.append(s_tcp)
    except OSError as e:
        typer.secho(
            f"Error: port {port} is already in use on {host}.\n"
            "A background pantry service or another server may already be running.\n"
            "Run 'pantry service status' to check, 'pantry service stop' to stop it, "
            "or pass '--port <number>' to use a different port.",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1) from e

    uds_path: Path | None = None
    if uds is None or str(uds).lower() not in {"none", "off", "0", "false"}:
        uds_path = Path(uds).resolve() if uds else store.socket_path
        uds_path.parent.mkdir(parents=True, exist_ok=True)
        if uds_path.is_socket() or uds_path.is_file():
            uds_path.unlink(missing_ok=True)
        try:
            s_uds = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s_uds.bind(str(uds_path))
            try:
                uds_path.chmod(0o600)
            except OSError:
                pass
            s_uds.listen(128)
            sockets.append(s_uds)
            typer.echo(f"pantry UDS socket bound at {uds_path}")
        except Exception as e:
            typer.secho(
                f"Warning: could not bind Unix domain socket at {uds_path}: {e}",
                fg=typer.colors.YELLOW,
                err=True,
            )
            uds_path = None

    if reload:
        for s in sockets:
            s.close()
        if uds_path and (uds_path.is_socket() or uds_path.is_file()):
            uds_path.unlink(missing_ok=True)
        uvicorn.run(
            fastapi_app, host=host, port=port, reload=True, log_level="info"
        )
        return

    config = uvicorn.Config(
        fastapi_app, log_level="info", reload=False
    )
    server = uvicorn.Server(config)

    want_menubar = bool(menubar)
    if want_menubar:
        from pantry.menubar import (
            rumps_available,
            run_menubar,
            set_accessory_activation_policy,
        )

        if not rumps_available():
            typer.secho(
                "menubar skipped — install with: pip install -e '.[mac]' "
                "(or '.[menubar]'), or pass --no-menubar",
                fg=typer.colors.YELLOW,
                err=True,
            )
            want_menubar = False
        else:
            set_accessory_activation_policy()

    if not want_menubar:
        try:
            server.run(sockets=sockets)
        finally:
            if uds_path and (uds_path.is_socket() or uds_path.is_file()):
                uds_path.unlink(missing_ok=True)
        return

    def _run_server() -> None:
        server.run(sockets=sockets)

    thread = threading.Thread(target=_run_server, daemon=True, name="pantry-uvicorn")
    thread.start()

    # Wait briefly so the menu bar's first refresh usually sees a live health.
    deadline = time.time() + 8.0
    while time.time() < deadline and not server.started:
        time.sleep(0.05)
    typer.echo("menu bar: open (Quit pantry stops the server)")

    def _stop() -> None:
        server.should_exit = True

    from pantry.menubar import run_menubar

    try:
        run_menubar(host=host, port=port, embedded=True, on_quit=_stop)
    except Exception as e:  # noqa: BLE001 — Cocoa / AppKit can fail under SSH/tmux
        typer.secho(
            f"menubar failed ({e}); continuing HTTP-only. "
            "Use --no-menubar to skip next time.",
            fg=typer.colors.YELLOW,
            err=True,
        )
        while thread.is_alive():
            time.sleep(0.5)
    finally:
        server.should_exit = True
        thread.join(timeout=5.0)
        if uds_path and (uds_path.is_socket() or uds_path.is_file()):
            uds_path.unlink(missing_ok=True)


service_app = typer.Typer(
    name="service",
    help="Manage macOS background service (launchd).",
    no_args_is_help=True,
)


@service_app.command("install")
def service_install_cmd(
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
    data: Path | None = typer.Option(None, help="Override PANTRY_DATA"),
    menubar: bool = typer.Option(
        True,
        "--menubar/--no-menubar",
        help="Open menu bar with background service (default true)",
    ),
    worker_isolation: bool = typer.Option(
        False,
        "--worker-isolation/--no-worker-isolation",
        help="Enable worker process isolation for Metal memory reclaim",
    ),
) -> None:
    """Install and load pantry as a macOS LaunchAgent (run at login)."""
    from pantry.service import install_service

    res = install_service(
        host=host,
        port=port,
        home=home,
        data=data,
        menubar=menubar,
        worker_isolation=worker_isolation,
    )
    typer.echo(json.dumps(res, indent=2))


@service_app.command("uninstall")
def service_uninstall_cmd() -> None:
    """Unload and remove the macOS LaunchAgent plist."""
    from pantry.service import uninstall_service

    res = uninstall_service()
    typer.echo(json.dumps(res, indent=2))


@service_app.command("start")
def service_start_cmd() -> None:
    """Start the installed pantry LaunchAgent service."""
    from pantry.service import start_service

    res = start_service()
    typer.echo(json.dumps(res, indent=2))


@service_app.command("stop")
def service_stop_cmd() -> None:
    """Stop the installed pantry LaunchAgent service."""
    from pantry.service import stop_service

    res = stop_service()
    typer.echo(json.dumps(res, indent=2))


@service_app.command("status")
def service_status_cmd(
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
) -> None:
    """Check status of the installed pantry LaunchAgent service."""
    from pantry.service import status_service

    res = status_service(host=host, port=port)
    typer.echo(json.dumps(res, indent=2))


app.add_typer(service_app, name="service")

catalog_app = typer.Typer(
    name="catalog",
    help="Inspect and synchronize model package catalog.",
    no_args_is_help=True,
)


@catalog_app.command("update")
def catalog_update_cmd(
    url: str | None = typer.Option(None, "--url", help="Override remote catalog URL"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
) -> None:
    """Synchronize package catalog manifests from a remote registry or GitHub."""
    from pantry.catalog_sync import CatalogSyncError, sync_remote_catalog

    store = _store(home)
    try:
        res = sync_remote_catalog(store, url=url)
        typer.echo(json.dumps(res, indent=2))
    except CatalogSyncError as e:
        typer.secho(e.message, fg=typer.colors.RED, err=True)
        raise typer.Exit(1) from e


@catalog_app.command("list")
def catalog_list_cmd(
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
) -> None:
    """List all manifests in the local catalog."""
    store = _store(home)
    for p in store.list_manifests():
        mods = ",".join(p.modalities)
        ready = "ready" if store.weights_ready(p) else "need-pull"
        typer.echo(f"{p.id}\tmodalities={mods}\ttier={p.quality_tier.value}\t{ready}")


app.add_typer(catalog_app, name="catalog")

hub_app = typer.Typer(
    name="hub",
    help="Discover and inspect models from Hugging Face Hub.",
    no_args_is_help=True,
)


@hub_app.command("search")
def hub_search_cmd(
    query: str = typer.Argument("", help="Search query (e.g. 'deepseek', 'qwen', 'llama')"),
    modality: str = typer.Option("all", "--modality", help="all|chat|reasoning|coder|image|video|audio"),
    limit: int = typer.Option(20, "--limit", help="Max results to return"),
    json_out: bool = typer.Option(False, "--json", help="Output raw JSON"),
) -> None:
    """Search Hugging Face Hub with local hardware fit evaluation."""
    from pantry.hub import search_hub

    results = search_hub(query=query, modality=modality, limit=limit)
    if json_out:
        typer.echo(json.dumps(results, indent=2))
        return

    if not results:
        typer.echo("No matching models found.")
        return

    for m in results:
        fit = m.get("fit", {})
        badge = fit.get("fit_label", "Unknown")
        color = (
            typer.colors.GREEN
            if badge == "Runs Great"
            else typer.colors.BLUE
            if badge == "Good Fit"
            else typer.colors.YELLOW
            if badge == "Tight Fit"
            else typer.colors.RED
        )
        size_gb = round(m.get("approx_bytes", 0) / (1024**3), 2)
        typer.secho(f"• {m['title']} ({m['repo_id']})", bold=True)
        typer.echo(
            f"  Modality: {m.get('modality', 'text')} | Role: {m.get('role', 'chat')} | Params: {m.get('params_b', '?')}B | Size: ~{size_gb} GB"
        )
        typer.secho(
            f"  Hardware Fit: {badge} ({fit.get('total_working_gb', '?')} GB / {fit.get('working_set_gb', '?')} GB True MLX Budget) - {fit.get('fit_badge', '')}",
            fg=color,
        )
        typer.echo()


app.add_typer(hub_app, name="hub")

pack_app = typer.Typer(
    name="pack",
    help="Manage model packs, intent aliases, and local manifests.",
    no_args_is_help=True,
)


@pack_app.command("intents")
def pack_intents_cmd(
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
    json_out: bool = typer.Option(False, "--json", help="Output raw JSON"),
) -> None:
    """Inspect all active intent packages and their bindings."""
    from pantry.hub import get_intent_bindings

    store = _store(home)
    intents = get_intent_bindings(store)
    if json_out:
        typer.echo(json.dumps(intents, indent=2))
        return

    typer.secho("Active Intent Packages Overview:", bold=True)
    for it in intents:
        active = it.get("active_package")
        if active:
            ready_str = "● READY" if active["weights_ready"] else "○ NOT PULLED"
            disk_gb = round(active["bytes_on_disk"] / (1024**3), 2)
            typer.echo(f"  [{it['alias']}] -> {active['package_id']} ({ready_str}, {disk_gb} GB on disk)")
            typer.echo(f"     Title: {active['title']} | Repo: {active.get('hf_repo') or 'N/A'}")
        else:
            typer.secho(f"  [{it['alias']}] -> (Unbound)", fg=typer.colors.RED)
    typer.echo()


@pack_app.command("rebind")
def pack_rebind_cmd(
    alias: str = typer.Argument(..., help="Intent alias to rebind (e.g. 'chat-standard', 'coder')"),
    package_id: str = typer.Argument(..., help="Target package id to bind to this intent"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
) -> None:
    """Rebind an intent alias to a different package."""
    from pantry.hub import rebind_intent_alias

    store = _store(home)
    try:
        updated = rebind_intent_alias(store, alias, package_id)
        typer.secho(f"✔ Successfully rebound '{alias}' to '{updated.id}'", fg=typer.colors.GREEN)
        typer.echo(f"  Package aliases: {', '.join(updated.aliases)}")
    except Exception as e:
        typer.secho(f"Error rebinding intent: {e}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1) from e


@pack_app.command("create")
def pack_create_cmd(
    hf_repo: str = typer.Argument(..., help="Hugging Face repository ID"),
    package_id: str | None = typer.Option(None, "--id", help="Custom package ID (e.g. local.deepseek-r1-7b.v1)"),
    title: str | None = typer.Option(None, "--title", help="Human-readable title"),
    modality: str = typer.Option("text", "--modality", help="text|image_gen|video|stt"),
    role: str = typer.Option("chat", "--role", help="chat|reasoning|coder|image|video|audio"),
    tier: str = typer.Option("standard", "--tier", help="standard|compact|extreme"),
    alias: list[str] = typer.Option([], "--alias", help="Intent alias to bind (can be specified multiple times)"),
    pull_now: bool = typer.Option(False, "--pull", help="Immediately pull weights"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
) -> None:
    """Create and register a custom local model pack from Hugging Face."""
    from pantry.hub import create_custom_pack, generate_manifest_template
    from pantry.pull import pull_package

    store = _store(home)
    manifest = generate_manifest_template(
        repo_id=hf_repo,
        title=title,
        modality=modality,
        role=role,
        tier=tier,
        aliases=list(alias),
        custom_package_id=package_id,
    )
    created = create_custom_pack(store, manifest.model_dump())
    typer.secho(f"✔ Registered model pack: {created.id}", fg=typer.colors.GREEN)
    typer.echo(f"  Path: {store.package_dir(created.id) / 'manifest.json'}")
    typer.echo(f"  Aliases: {', '.join(created.aliases) if created.aliases else 'None'}")

    if pull_now:
        typer.echo(f"Pulling weights for {created.id}...")
        res = pull_package(store, created.id)
        typer.echo(f"✔ Pulled: {res.get('bytes_on_disk', 0)} bytes ready.")


@pack_app.command("delete")
def pack_delete_cmd(
    package_id: str = typer.Argument(..., help="Package ID to delete"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
) -> None:
    """Delete a custom local package from the library."""
    from pantry.hub import delete_custom_pack

    store = _store(home)
    delete_custom_pack(store, package_id)
    typer.secho(f"✔ Deleted package {package_id}", fg=typer.colors.GREEN)


app.add_typer(pack_app, name="pack")

speculative_app = typer.Typer(
    name="speculative",
    help="Speculative decoding candidate pair status, benchmarking, and management",
)


@speculative_app.command("list")
def spec_list_cmd(
    as_json: bool = typer.Option(False, "--json", "--as-json", help="Output JSON array"),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
    data: Path | None = typer.Option(None, help="Override PANTRY_DATA"),
) -> None:
    """List speculative candidate pairs, hardware feasibility, and speedups."""
    import httpx
    from pantry.hardware import get_apple_silicon_device_info
    from pantry.memory import get_available_unified_dram
    from pantry.resolve import discover_speculative_pairs

    pairs_data: list[dict] = []
    ceiling_gb: float = get_available_unified_dram() / (1024.0**3)
    chip: str = get_apple_silicon_device_info().get("device_name", "Apple Silicon")

    try:
        r = httpx.get(f"http://{host}:{port}/v1/speculative/pairs", timeout=3.0)
        if r.status_code == 200:
            resp = r.json()
            pairs_data = resp.get("data", [])
            ceiling_gb = resp.get("dynamic_ceiling_gb", ceiling_gb)
            chip = resp.get("chip_name", chip)
    except Exception:
        pairs_data = []

    if not pairs_data:
        store = _store(home, data)
        pairs = discover_speculative_pairs(
            store.list_manifests(),
            is_ready=store.weights_ready,
            dynamic_ceiling_gb=ceiling_gb,
            chip_name=chip,
        )
        pairs_data = [p.model_dump() for p in pairs]

    if as_json:
        typer.echo(json.dumps(pairs_data, indent=2))
        return

    if not pairs_data:
        typer.echo("No speculative candidate pairs detected.")
        return

    typer.secho(
        f"\n🚀 Speculative Candidate Pairs ({chip} · Ceiling: {ceiling_gb:.1f} GB)",
        fg=typer.colors.CYAN,
        bold=True,
    )
    header = f"{'TARGET MODEL':<24} {'DRAFT MODEL':<24} {'PAIR RAM':<10} {'FEASIBLE':<12} {'EST. SPEEDUP':<14} {'STATUS':<12}"
    typer.echo(header)
    typer.echo("─" * len(header))

    for p in pairs_data:
        target = p.get("target_title") or p.get("target_package_id", "")
        draft = p.get("draft_title") or p.get("draft_package_id", "")
        ram = f"{p.get('composite_ram_gb', 0):.1f} GB"
        feasible = "✔ Yes" if p.get("feasible_on_hardware") else "✖ Exceeds"
        speedup = f"{p.get('estimated_speedup', 1.0):.2f}x"
        ready = "✔ Ready" if p.get("ready") else "Weights Missing"

        color = typer.colors.GREEN if p.get("ready") else typer.colors.WHITE
        typer.secho(
            f"{target:<24} {draft:<24} {ram:<10} {feasible:<12} {speedup:<14} {ready:<12}",
            fg=color,
        )
    typer.echo()


@speculative_app.command("bench")
def spec_bench_cmd(
    target: str = typer.Argument("chat-standard", help="Target model package id or alias"),
    draft: str | None = typer.Option(None, "--draft", "-d", help="Draft model package id or alias"),
    prompt: str = typer.Option(
        "Explain quantum computing in simple terms with two analogies.",
        "--prompt",
        "-p",
        help="Benchmark prompt",
    ),
    tokens: int = typer.Option(64, "--tokens", "-n", help="Tokens to generate"),
    gamma: int = typer.Option(2, "--gamma", "-g", help="Draft tokens per step"),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
    as_json: bool = typer.Option(False, "--json", "--as-json", help="Output JSON"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
    data: Path | None = typer.Option(None, help="Override PANTRY_DATA"),
) -> None:
    """Benchmark standalone model generation against speculative decoding."""
    import httpx

    req_payload = {
        "target_model": target,
        "draft_model": draft,
        "prompt": prompt,
        "max_tokens": tokens,
        "num_draft_tokens": gamma,
        "temperature": 0.0,
    }

    resp_data = None
    try:
        r = httpx.post(
            f"http://{host}:{port}/v1/speculative/benchmark",
            json=req_payload,
            timeout=120.0,
        )
        if r.status_code == 200:
            resp_data = r.json()
        elif r.status_code in {400, 409}:
            err = r.json().get("detail", r.text)
            typer.secho(f"Benchmark error: {err}", fg=typer.colors.RED, err=True)
            raise typer.Exit(1)
    except httpx.RequestError:
        resp_data = None

    if resp_data is None:
        import asyncio
        from pantry.hardware import get_apple_silicon_device_info
        from pantry.memory import get_available_unified_dram
        from pantry.resolve import find_by_model_string
        from pantry.runtime import runtime_for
        from pantry.schemas import ChatMessage, QualityTier

        store = _store(home, data)
        target_pkg = store.load_manifest(target) or find_by_model_string(
            target, store.list_manifests(), is_ready=store.weights_ready
        )
        if target_pkg is None:
            typer.secho(f"Unknown target model: {target}", fg=typer.colors.RED, err=True)
            raise typer.Exit(1)
        if not store.weights_ready(target_pkg):
            typer.secho(
                f"Weights not pulled for target '{target_pkg.id}'. Run: pantry pull {target_pkg.id}",
                fg=typer.colors.RED,
                err=True,
            )
            raise typer.Exit(1)

        draft_pkg = None
        draft_str = draft or target_pkg.runtime.draft_package_id
        if draft_str:
            draft_pkg = store.load_manifest(draft_str) or find_by_model_string(
                draft_str, store.list_manifests(), is_ready=store.weights_ready
            )
        if draft_pkg is None:
            fam = (target_pkg.family or "").lower()
            candidates = [
                p
                for p in store.list_manifests()
                if p.id != target_pkg.id
                and "text" in p.modalities
                and (p.family or "").lower() == fam
                and (p.ram_gb_min or 0) < (target_pkg.ram_gb_min or 0)
                and store.weights_ready(p)
            ]
            if candidates:
                candidates.sort(
                    key=lambda p: (
                        0 if p.quality_tier == QualityTier.compact else 1,
                        p.ram_gb_min,
                    )
                )
                draft_pkg = candidates[0]

        if draft_pkg is None:
            typer.secho(
                f"No compatible ready draft model found for '{target_pkg.id}'",
                fg=typer.colors.RED,
                err=True,
            )
            raise typer.Exit(1)
        if not store.weights_ready(draft_pkg):
            typer.secho(
                f"Weights not ready for draft '{draft_pkg.id}'. Run: pantry pull {draft_pkg.id}",
                fg=typer.colors.RED,
                err=True,
            )
            raise typer.Exit(1)

        rt = runtime_for(target_pkg, store)
        messages = [ChatMessage(role="user", content=prompt)]

        u_std: dict[str, Any] = {}
        t0 = time.perf_counter()
        asyncio.run(
            rt.complete(
                target_pkg,
                messages,
                max_tokens=tokens,
                temperature=0.0,
                prefer_speculative=False,
                usage=u_std,
            )
        )
        d_std = max(0.001, time.perf_counter() - t0)
        c_std = u_std.get("completion_tokens", 0)
        tps_std = round(c_std / d_std, 2)

        u_sp: dict[str, Any] = {}
        t1 = time.perf_counter()
        asyncio.run(
            rt.complete(
                target_pkg,
                messages,
                max_tokens=tokens,
                temperature=0.0,
                prefer_speculative=True,
                draft_model=draft_pkg.id,
                num_draft_tokens=gamma,
                usage=u_sp,
            )
        )
        d_sp = max(0.001, time.perf_counter() - t1)
        c_sp = u_sp.get("completion_tokens", 0)
        tps_sp = round(c_sp / d_sp, 2)
        sp_data = u_sp.get("speculative") or {}

        resp_data = {
            "target_model": target,
            "draft_model": draft_pkg.id,
            "target_package_id": target_pkg.id,
            "draft_package_id": draft_pkg.id,
            "standalone_tokens": c_std,
            "standalone_duration_s": round(d_std, 3),
            "standalone_tps": tps_std,
            "speculative_tokens": c_sp,
            "speculative_duration_s": round(d_sp, 3),
            "speculative_tps": tps_sp,
            "speedup": round(tps_sp / tps_std if tps_std > 0 else 1.0, 2),
            "accepted_tokens": sp_data.get("accepted_tokens", 0),
            "draft_tokens": sp_data.get("draft_tokens", c_sp * gamma),
            "acceptance_rate": sp_data.get("acceptance_rate", 0.0),
            "hardware_chip": get_apple_silicon_device_info().get(
                "device_name", "Apple Silicon"
            ),
            "dynamic_ceiling_gb": round(get_available_unified_dram() / (1024.0**3), 2),
        }

    if as_json:
        typer.echo(json.dumps(resp_data, indent=2))
        return

    typer.secho("\n🚀 Speculative Decoding Benchmark Results", fg=typer.colors.CYAN, bold=True)
    typer.echo(f"  Target Model:      {resp_data['target_package_id']}")
    typer.echo(f"  Draft Model:       {resp_data['draft_package_id']}")
    typer.echo(
        f"  Hardware:          {resp_data['hardware_chip']} (Ceiling: {resp_data['dynamic_ceiling_gb']:.1f} GB)"
    )
    typer.echo("────────────────────────────────────────────────────────────")
    typer.echo(
        f"  Standalone Target: {resp_data['standalone_tps']:>6.1f} tok/s  ({resp_data['standalone_duration_s']:.2f}s for {resp_data['standalone_tokens']} tokens)"
    )
    typer.secho(
        f"  Speculative Pair:  {resp_data['speculative_tps']:>6.1f} tok/s  ({resp_data['speculative_duration_s']:.2f}s for {resp_data['speculative_tokens']} tokens)",
        fg=typer.colors.GREEN,
        bold=True,
    )
    speedup_val = resp_data["speedup"]
    s_color = typer.colors.GREEN if speedup_val >= 1.15 else typer.colors.YELLOW
    typer.secho(f"  Speedup Factor:    {speedup_val:.2f}x ⚡", fg=s_color, bold=True)
    acc = resp_data["accepted_tokens"]
    drf = resp_data["draft_tokens"]
    rate = round(resp_data["acceptance_rate"] * 100, 1)
    typer.echo(f"  Draft Acceptance:  {acc}/{drf} tokens ({rate}%)\n")


@speculative_app.command("pair")
def spec_pair_cmd(
    target: str = typer.Argument(..., help="Target model package id or alias"),
    draft: str = typer.Argument(..., help="Draft model package id or alias to bind"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
    data: Path | None = typer.Option(None, help="Override PANTRY_DATA"),
) -> None:
    """Bind a designated draft model to a target package manifest."""
    from pantry.resolve import find_by_model_string

    store = _store(home, data)
    target_pkg = store.load_manifest(target) or find_by_model_string(
        target, store.list_manifests(), is_ready=store.weights_ready
    )
    if target_pkg is None:
        typer.secho(f"Unknown target package: {target}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)

    draft_pkg = store.load_manifest(draft) or find_by_model_string(
        draft, store.list_manifests(), is_ready=store.weights_ready
    )
    if draft_pkg is None:
        typer.secho(f"Unknown draft package: {draft}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)

    target_pkg.runtime.draft_package_id = draft_pkg.id
    store.write_manifest(target_pkg)
    typer.secho(
        f"✔ Bound draft '{draft_pkg.id}' to target '{target_pkg.id}'",
        fg=typer.colors.GREEN,
        bold=True,
    )


app.add_typer(speculative_app, name="speculative")
app.add_typer(speculative_app, name="spec")



@app.command("transcribe")
def transcribe_cmd(
    audio_file: Path = typer.Argument(..., help="Path to audio file (wav, mp3, m4a, etc.)"),
    model: str = typer.Option("whisper-1", "--model", help="Model name, package id, or alias"),
    language: str | None = typer.Option(None, "--language", help="Optional BCP-47 / ISO language code (e.g. en)"),
    response_format: str = typer.Option("text", "--format", help="text|json|verbose_json|vtt|srt"),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
    data: Path | None = typer.Option(None, help="Override PANTRY_DATA"),
) -> None:
    """Transcribe an audio file to text using local speech-to-text (Whisper)."""
    import httpx

    file_path = Path(audio_file).expanduser().resolve()
    if not file_path.is_file():
        typer.secho(f"audio file not found: {file_path}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)

    url = f"{_daemon_base(host, port)}/v1/audio/transcriptions"
    daemon_ok = False
    try:
        with file_path.open("rb") as f:
            files = {"file": (file_path.name, f, "audio/wav")}
            data_map = {"model": model, "response_format": response_format}
            if language:
                data_map["language"] = language
            resp = httpx.post(url, files=files, data=data_map, timeout=60.0)
            if resp.status_code == 200:
                daemon_ok = True
                typer.echo(resp.text)
                return
    except Exception:  # noqa: BLE001
        daemon_ok = False

    if not daemon_ok:
        # Fall back to in-process execution via local store
        store = _store(home, data)
        pkg = store.load_manifest(model)
        if pkg is None:
            from pantry.resolve import find_by_model_string

            pkg = find_by_model_string(model, store.list_manifests())
        if pkg is None:
            typer.secho(f"unknown speech-to-text model: {model}", fg=typer.colors.RED, err=True)
            raise typer.Exit(1)

        from pantry.audio_runtime import (
            audio_transcription_runtime_for,
            format_srt,
            format_vtt,
        )

        runtime = audio_transcription_runtime_for(pkg, store)
        try:
            res = runtime.transcribe(pkg, audio_path=file_path, language=language)
        except Exception as e:
            typer.secho(f"transcription failed: {e}", fg=typer.colors.RED, err=True)
            raise typer.Exit(1) from e

        fmt = response_format.lower().strip()
        if fmt == "text":
            typer.echo(res.get("text", ""))
        elif fmt == "vtt":
            typer.echo(format_vtt(res.get("segments", [])))
        elif fmt == "srt":
            typer.echo(format_srt(res.get("segments", [])))
        elif fmt == "verbose_json":
            typer.echo(json.dumps(res, indent=2))
        else:
            typer.echo(json.dumps({"text": res.get("text", "")}, indent=2))


@app.command("image")
def image_cmd(
    prompt: str = typer.Argument(..., help="Text prompt describing the desired image"),
    model: str = typer.Option("image-compact", "--model", help="Model name, package id, or alias"),
    size: str = typer.Option("512x512", "--size", help="Image dimensions, e.g. 512x512 or 1024x1024"),
    output: Path | None = typer.Option(None, "--output", "-o", help="File to save the generated image to"),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
    data: Path | None = typer.Option(None, help="Override PANTRY_DATA"),
) -> None:
    """Generate an image from a text prompt using local image generation."""
    import base64

    import httpx

    url = f"{_daemon_base(host, port)}/v1/images/generations"
    payload = {"model": model, "prompt": prompt, "size": size, "response_format": "b64_json"}
    daemon_ok = False
    try:
        resp = httpx.post(url, json=payload, timeout=120.0)
        if resp.status_code == 200:
            daemon_ok = True
            data = resp.json().get("data", [])
            if data and "b64_json" in data[0]:
                raw = base64.b64decode(data[0]["b64_json"])
                out_path = Path(output) if output else Path(f"pantry-{int(time.time())}.png")
                out_path.write_bytes(raw)
                typer.echo(f"Image generated: {out_path.resolve()}")
                return
    except Exception:  # noqa: BLE001
        daemon_ok = False

    if not daemon_ok:
        store = _store(home, data)
        pkg = store.load_manifest(model)
        if pkg is None:
            from pantry.resolve import find_by_model_string

            pkg = find_by_model_string(model, store.list_manifests())
        if pkg is None:
            typer.secho(f"unknown image model: {model}", fg=typer.colors.RED, err=True)
            raise typer.Exit(1)

        from pantry.image_runtime import image_runtime_for

        runtime = image_runtime_for(pkg, store)
        try:
            items = runtime.generate(pkg, prompt=prompt, size=size, response_format="b64_json")
        except Exception as e:
            typer.secho(f"image generation failed: {e}", fg=typer.colors.RED, err=True)
            raise typer.Exit(1) from e

        if items and "b64_json" in items[0]:
            raw = base64.b64decode(items[0]["b64_json"])
            out_path = Path(output) if output else Path(f"pantry-{int(time.time())}.png")
            out_path.write_bytes(raw)
            typer.echo(f"Image generated: {out_path.resolve()}")


@app.command("music")
def music_cmd(
    prompt: str = typer.Argument(..., help="Text prompt describing the desired audio/music"),
    model: str = typer.Option("music-compact", "--model", help="Model name, package id, or alias"),
    duration: float = typer.Option(2.0, "--duration", "-d", help="Duration in seconds (0.25 to 30.0)"),
    output: Path | None = typer.Option(None, "--output", "-o", help="File to save the generated audio (.wav) to"),
    play: bool = typer.Option(False, "--play", help="Play the audio after generating (via afplay on macOS)"),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
    data: Path | None = typer.Option(None, help="Override PANTRY_DATA"),
) -> None:
    """Generate audio/music from a text prompt."""
    import base64
    import subprocess

    import httpx

    url = f"{_daemon_base(host, port)}/v1/audio/generations"
    payload = {
        "model": model,
        "prompt": prompt,
        "duration_seconds": duration,
        "response_format": "b64_json",
    }
    daemon_ok = False
    try:
        resp = httpx.post(url, json=payload, timeout=60.0)
        if resp.status_code == 200:
            daemon_ok = True
            data_resp = resp.json().get("data", [])
            if data_resp and "b64_json" in data_resp[0]:
                raw = base64.b64decode(data_resp[0]["b64_json"])
                out_path = Path(output) if output else Path(f"pantry-music-{int(time.time())}.wav")
                out_path.write_bytes(raw)
                typer.echo(f"Audio generated: {out_path.resolve()}")
                if play and shutil.which("afplay"):
                    subprocess.run(["afplay", str(out_path)], check=False)
                return
    except Exception:  # noqa: BLE001
        daemon_ok = False

    if not daemon_ok:
        store = _store(home, data)
        pkg = store.load_manifest(model)
        if pkg is None:
            from pantry.resolve import find_by_model_string

            pkg = find_by_model_string(model, store.list_manifests())
        if pkg is None:
            typer.secho(f"unknown music model: {model}", fg=typer.colors.RED, err=True)
            raise typer.Exit(1)

        from pantry.music_runtime import music_runtime_for

        runtime = music_runtime_for(pkg, store)
        try:
            items = runtime.generate(
                pkg, prompt=prompt, duration_seconds=duration, response_format="b64_json"
            )
        except Exception as e:
            typer.secho(f"audio generation failed: {e}", fg=typer.colors.RED, err=True)
            raise typer.Exit(1) from e

        if items and "b64_json" in items[0]:
            raw = base64.b64decode(items[0]["b64_json"])
            out_path = Path(output) if output else Path(f"pantry-music-{int(time.time())}.wav")
            out_path.write_bytes(raw)
            typer.echo(f"Audio generated: {out_path.resolve()}")
            if play and shutil.which("afplay"):
                subprocess.run(["afplay", str(out_path)], check=False)


@app.command("chat")
def chat_cmd(
    prompt: str = typer.Argument(..., help="Prompt or message to send"),
    model: str = typer.Option("chat-standard", "--model", help="Model name, package id, or alias (e.g. chat-fast, chat-standard, chat-compact)"),
    speculative: bool = typer.Option(False, "--speculative", help="Prefer curated speculative decoding"),
    draft_model: str | None = typer.Option(None, "--draft", "--draft-model", help="Draft model package id or alias for speculative decoding"),
    num_draft_tokens: int | None = typer.Option(None, "--num-draft-tokens", help="Lookahead tokens drafted per step (default: 2)"),
    show_speculative: bool = typer.Option(False, "--show-speculative", help="Display speculative decoding telemetry"),
    max_tokens: int = typer.Option(256, "--max-tokens"),
    temperature: float = typer.Option(0.7, "--temperature"),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
    data: Path | None = typer.Option(None, help="Override PANTRY_DATA"),
) -> None:
    """Generate a chat completion using local models (intent-based or explicit)."""
    import httpx
    from pantry.schemas import ChatMessage

    daemon_ok = False
    url = f"http://{host}:{port}/v1/chat/completions"
    want_spec = speculative or model.strip() in {"chat-fast", "chat-speculative"} or draft_model is not None
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
        "prefer_speculative": want_spec,
    }
    if draft_model:
        payload["draft_model"] = draft_model
    if num_draft_tokens is not None:
        payload["num_draft_tokens"] = num_draft_tokens

    try:
        resp = httpx.post(url, json=payload, timeout=60.0)
        if resp.status_code == 200:
            daemon_ok = True
            resp_json = resp.json()
            choices = resp_json.get("choices", [])
            if choices:
                content = choices[0].get("message", {}).get("content", "")
                typer.echo(content)
                spec_dt = resp_json.get("speculative_details")
                if (speculative or show_speculative or draft_model) and spec_dt:
                    d_id = spec_dt.get("draft_package_id", "draft")
                    acc = spec_dt.get("accepted_tokens", 0)
                    drafted = spec_dt.get("draft_tokens", 0)
                    rate = round(spec_dt.get("acceptance_rate", 0.0) * 100, 1)
                    speedup = spec_dt.get("speedup_factor", 1.0)
                    typer.secho(
                        f"\n[Speculative: draft={d_id} · {acc}/{drafted} accepted ({rate}%) · {speedup}x speedup]",
                        fg=typer.colors.CYAN,
                    )
                return
    except Exception:
        daemon_ok = False

    if not daemon_ok:
        import asyncio
        from pantry.resolve import find_by_model_string
        from pantry.runtime import runtime_for

        store = _store(home, data)
        pkg = store.load_manifest(model)
        if pkg is None:
            pkg = find_by_model_string(model, store.list_manifests(), is_ready=store.weights_ready)
        if pkg is None:
            typer.secho(f"unknown chat model: {model}", fg=typer.colors.RED, err=True)
            raise typer.Exit(1)

        rt = runtime_for(pkg, store)
        messages = [ChatMessage(role="user", content=prompt)]
        usage_res: dict[str, Any] = {}

        async def _run() -> str:
            return await rt.complete(
                pkg,
                messages,
                max_tokens=max_tokens,
                temperature=temperature,
                prefer_speculative=want_spec,
                draft_model=draft_model,
                num_draft_tokens=num_draft_tokens,
                usage=usage_res,
            )

        try:
            result = asyncio.run(_run())
            typer.echo(result)
            spec_dt = usage_res.get("speculative")
            if (speculative or show_speculative or draft_model) and spec_dt:
                d_id = spec_dt.get("draft_package_id", "draft")
                acc = spec_dt.get("accepted_tokens", 0)
                drafted = spec_dt.get("draft_tokens", 0)
                rate = round(spec_dt.get("acceptance_rate", 0.0) * 100, 1)
                speedup = spec_dt.get("speedup_factor", 1.0)
                typer.secho(
                    f"\n[Speculative: draft={d_id} · {acc}/{drafted} accepted ({rate}%) · {speedup}x speedup]",
                    fg=typer.colors.CYAN,
                )
        except Exception as e:
            typer.secho(f"chat generation failed: {e}", fg=typer.colors.RED, err=True)
            raise typer.Exit(1) from e


@app.command()
def dashboard(
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
    launch: bool = typer.Option(True, "--open/--no-open", help="Open in default web browser"),
) -> None:
    """Open or print URL to the Pantry Web System Monitor Dashboard."""
    url = f"http://{host}:{port}/dashboard"
    typer.echo(f"Pantry System Monitor: {url}")
    if launch:
        import webbrowser

        try:
            webbrowser.open(url)
        except Exception:
            pass


if __name__ == "__main__":
    app()



