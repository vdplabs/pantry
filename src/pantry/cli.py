from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

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


def _store(home: Optional[Path], data: Optional[Path] = None) -> PackageStore:
    root = Path(home).expanduser().resolve() if home else default_home()
    data_root = Path(data).expanduser().resolve() if data else default_data(root)
    store = PackageStore(root, data_root=data_root)
    store.ensure()
    return store


def _daemon_base(host: str, port: int) -> str:
    return f"http://{host}:{port}"


def _daemon_post(
    path: str,
    payload: dict,
    *,
    host: str = "127.0.0.1",
    port: int = 18787,
) -> dict | None:
    """POST to a running pantry serve; return JSON or None if unreachable."""
    import httpx

    url = f"{_daemon_base(host, port)}{path}"
    try:
        r = httpx.post(url, json=payload, timeout=5.0)
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
    home: Optional[Path] = typer.Option(None, help="Override PANTRY_HOME (metadata)"),
    data: Optional[Path] = typer.Option(
        None,
        "--data",
        help="Override PANTRY_DATA (blobs + weights; e.g. external SSD)",
    ),
    catalog: Optional[Path] = typer.Option(None, help="Catalog directory of package manifests"),
) -> None:
    """Create library dirs and seed bundled catalog manifests."""
    store = _store(home, data)
    cat = Path(catalog) if catalog else bundled_catalog_dir()
    installed = store.seed_from_catalog(cat)
    typer.echo(f"home={store.root}")
    typer.echo(f"data={store.data_root}")
    typer.echo(f"seeded {len(installed)} package(s) from {cat}")
    for pid in installed:
        typer.echo(f"  - {pid}")


@app.command("resolve")
def resolve_cmd(
    modality: str = typer.Option("chat", "--modality"),
    ram_gb_max: Optional[float] = typer.Option(None, "--ram-gb-max"),
    quality: Optional[str] = typer.Option(None, "--quality", help="standard|compact|extreme"),
    latency: str = typer.Option("balanced", "--latency", help="balanced|fast"),
    family_prefer: Optional[str] = typer.Option(None, "--family"),
    template_family: Optional[str] = typer.Option(None, "--template-family"),
    tool_protocol: Optional[str] = typer.Option(None, "--tool-protocol"),
    prefer_speculative: bool = typer.Option(False, "--speculative"),
    home: Optional[Path] = typer.Option(None, help="Override PANTRY_HOME"),
) -> None:
    """Resolve a package from capabilities (installed catalog only)."""
    store = _store(home)
    tier = QualityTier(quality) if quality else None
    req = CapabilityRequest(
        modality=modality,
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
    home: Optional[Path] = typer.Option(None, help="Override PANTRY_HOME"),
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
    home: Optional[Path] = typer.Option(None, help="Override PANTRY_HOME"),
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
    home: Optional[Path] = typer.Option(None, help="Override PANTRY_HOME"),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
) -> None:
    """Mark package loaded (warm) — prefers the running daemon when available."""
    store = _store(home)
    if store.load_manifest(package_id) is None:
        typer.secho(f"unknown package: {package_id}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)
    remote = _daemon_post(
        "/v1/load",
        {"package_id": package_id, "pin": pin},
        host=host,
        port=port,
    )
    if remote is not None:
        typer.echo(json.dumps(remote, indent=2))
        return
    store.mark_loaded(package_id, pin=pin)
    typer.echo(
        json.dumps(
            {
                "ok": True,
                "loaded": store.read_state().get("loaded", []),
                "via": "local-state",
                "note": "no pantry serve on "
                f"{host}:{port}; marked state only (weights warm on first chat)",
            },
            indent=2,
        )
    )


@app.command()
def unload(
    package_id: Optional[str] = typer.Argument(
        None, help="Package id (omit to unload all warm runtimes)"
    ),
    home: Optional[Path] = typer.Option(None, help="Override PANTRY_HOME"),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
) -> None:
    """Unload runtime weights from the running daemon (falls back to local state)."""
    store = _store(home)
    remote = _daemon_post(
        "/v1/unload",
        {"package_id": package_id},
        host=host,
        port=port,
    )
    if remote is not None:
        typer.echo(json.dumps(remote, indent=2))
        return
    if package_id:
        store.mark_unloaded(package_id)
    else:
        state = store.read_state()
        for pid in list(state.get("loaded", [])):
            store.mark_unloaded(pid)
    typer.secho(
        f"no pantry serve on {host}:{port}; cleared local state only "
        "(Metal weights in another process are unchanged)",
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
    home: Optional[Path] = typer.Option(None, help="Override PANTRY_HOME (metadata)"),
    data: Optional[Path] = typer.Option(
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
) -> None:
    """HTTP health check against a running pantry serve."""
    import httpx

    url = f"http://{host}:{port}/v1/health"
    try:
        r = httpx.get(url, timeout=5.0)
        r.raise_for_status()
    except Exception as e:
        typer.secho(f"health failed: {e}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1) from e
    typer.echo(r.text)


@app.command()
def serve(
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(18787, "--port"),
    home: Optional[Path] = typer.Option(None, help="Override PANTRY_HOME (metadata)"),
    data: Optional[Path] = typer.Option(
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
) -> None:
    """Run localhost OpenAI-compatible HTTP server (menu bar on by default)."""
    import threading
    import time

    store = _store(home, data)
    if not store.list_manifests():
        cat = bundled_catalog_dir()
        if cat.is_dir():
            store.seed_from_catalog(cat)
            typer.echo(f"auto-seeded catalog from {cat}")
    fastapi_app = create_app(store)
    typer.echo(
        f"pantry serve http://{host}:{port}  home={store.root}  data={store.data_root}"
    )

    want_menubar = bool(menubar) and not reload
    if want_menubar:
        from pantry.menubar import rumps_available, run_menubar

        if not rumps_available():
            typer.secho(
                "menubar skipped — install with: pip install -e '.[mac]' "
                "(or '.[menubar]'), or pass --no-menubar",
                fg=typer.colors.YELLOW,
                err=True,
            )
            want_menubar = False

    if not want_menubar:
        uvicorn.run(
            fastapi_app, host=host, port=port, reload=reload, log_level="info"
        )
        return

    config = uvicorn.Config(
        fastapi_app, host=host, port=port, log_level="info", reload=False
    )
    server = uvicorn.Server(config)

    def _run_server() -> None:
        server.run()

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
