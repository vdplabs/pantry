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
    installed = store.seed_from_catalog(cat)
    typer.echo(f"home={store.root}")
    typer.echo(f"data={store.data_root}")
    typer.echo(f"seeded {len(installed)} package(s) from {cat}")
    for pid in installed:
        typer.echo(f"  - {pid}")


@app.command("resolve")
def resolve_cmd(
    modality: str = typer.Option("chat", "--modality"),
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
    package_id: str | None = typer.Argument(
        None, help="Package id (omit to unload all warm runtimes)"
    ),
    home: Path | None = typer.Option(None, help="Override PANTRY_HOME"),
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
    """Run localhost OpenAI-compatible HTTP server (menu bar on by default)."""
    import threading
    import time

    store = _store(home, data)
    if not store.list_manifests():
        cat = bundled_catalog_dir()
        if cat.is_dir():
            store.seed_from_catalog(cat)
            typer.echo(f"auto-seeded catalog from {cat}")
    fastapi_app = create_app(store, worker_isolation=worker_isolation)
    typer.echo(
        f"pantry serve http://{host}:{port}  home={store.root}  data={store.data_root}"
    )

    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        if s.connect_ex((host, port)) == 0:
            typer.secho(
                f"Error: port {port} is already in use on {host}.\n"
                "A background pantry service or another server may already be running.\n"
                "Run 'pantry service status' to check, 'pantry service stop' to stop it, "
                "or pass '--port <number>' to use a different port.",
                fg=typer.colors.RED,
                err=True,
            )
            raise typer.Exit(code=1)

    want_menubar = bool(menubar) and not reload
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
    want_spec = speculative or model.strip() in {"chat-fast"}
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
        "prefer_speculative": want_spec,
    }
    try:
        resp = httpx.post(url, json=payload, timeout=60.0)
        if resp.status_code == 200:
            daemon_ok = True
            choices = resp.json().get("choices", [])
            if choices:
                content = choices[0].get("message", {}).get("content", "")
                typer.echo(content)
                return
    except Exception:
        daemon_ok = False

    if not daemon_ok:
        import asyncio
        from pantry.runtime import runtime_for
        from pantry.resolve import find_by_model_string

        store = _store(home, data)
        pkg = store.load_manifest(model)
        if pkg is None:
            pkg = find_by_model_string(model, store.list_manifests(), is_ready=store.weights_ready)
        if pkg is None:
            typer.secho(f"unknown chat model: {model}", fg=typer.colors.RED, err=True)
            raise typer.Exit(1)

        rt = runtime_for(pkg, store)
        messages = [ChatMessage(role="user", content=prompt)]

        async def _run() -> str:
            return await rt.complete(
                pkg,
                messages,
                max_tokens=max_tokens,
                temperature=temperature,
                prefer_speculative=want_spec,
            )

        try:
            result = asyncio.run(_run())
            typer.echo(result)
        except Exception as e:
            typer.secho(f"chat generation failed: {e}", fg=typer.colors.RED, err=True)
            raise typer.Exit(1) from e


if __name__ == "__main__":
    app()



