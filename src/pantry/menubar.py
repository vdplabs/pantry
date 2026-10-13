from __future__ import annotations

"""Mac menu bar popover for pantry (LlamaBarn-style dropdown).

Opened automatically by ``pantry serve`` when the menubar extra is installed
(``pip install 'pantry[menubar]'``). Pass ``--no-menubar`` for HTTP-only.

The dropdown is a native NSPopover hosting a WKWebView that renders
``static/menubar.html`` and talks to the daemon over HTTP — see
``pantry.menubar_cocoa``. Python owns the status item, the popover
lifecycle, and a small native bridge; all UI state lives in the page.
"""

import signal
import subprocess
from collections.abc import Callable
from typing import Any

import httpx


def _get(url: str, timeout: float = 4.5) -> dict | list | None:
    try:
        r = httpx.get(url, timeout=timeout)
        if r.status_code != 200:
            return None
        return r.json()
    except Exception:  # noqa: BLE001
        return None


def _health(host: str, port: int, timeout: float = 4.5) -> dict | None:
    body = _get(f"http://{host}:{port}/v1/health", timeout=timeout)
    return body if isinstance(body, dict) else None


def _pids_on_port(port: int) -> list[int]:
    try:
        out = subprocess.check_output(
            ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []
    pids: list[int] = []
    for line in out.splitlines():
        line = line.strip()
        if line.isdigit():
            pids.append(int(line))
    return pids


def _stop_serve(port: int) -> int:
    import os

    killed = 0
    for pid in _pids_on_port(port):
        try:
            os.kill(pid, signal.SIGTERM)
            killed += 1
        except OSError:
            continue
    return killed


def _total_ram_gb() -> float:
    """Total physical RAM in GiB. The menubar is macOS-only, so sysctl is fine."""
    try:
        out = subprocess.check_output(
            ["sysctl", "-n", "hw.memsize"], text=True, stderr=subprocess.DEVNULL
        )
        return int(out.strip()) / (1024**3)
    except Exception:  # noqa: BLE001
        return 0.0


def rumps_available() -> bool:
    """Whether the menubar UI can run (the ``pantry[menubar]`` extra)."""
    try:
        import rumps  # noqa: F401

        return True
    except ImportError:
        return False


def set_accessory_activation_policy() -> bool:
    """Configure Cocoa so pantry runs as an accessory app (menu bar only, no Dock icon).

    By default on macOS, running Python with a GUI event loop sets a regular activation
    policy, displaying the Python rocket icon in the Dock and Cmd+Tab switcher.
    Setting NSApplicationActivationPolicyAccessory hides the Dock icon while preserving
    the status bar item in the macOS menu bar.
    """
    try:
        import AppKit
        import Foundation

        Foundation.NSProcessInfo.processInfo().setProcessName_("pantry")
        app = AppKit.NSApplication.sharedApplication()
        return bool(
            app.setActivationPolicy_(AppKit.NSApplicationActivationPolicyAccessory)
        )
    except Exception:  # noqa: BLE001
        return False


def run_menubar(
    host: str = "127.0.0.1",
    port: int = 18787,
    *,
    embedded: bool = False,
    on_quit: Callable[[], None] | None = None,
    serve_cmd: str | None = None,
) -> None:
    """Run the status item + popover.

    *embedded*: serve is already running in this process (default path via
    ``pantry serve``). Quit stops serve via *on_quit*.
    """
    set_accessory_activation_policy()

    if not rumps_available():
        raise SystemExit(
            "Menu bar requires the menubar extra. Install with: pip install 'pantry[menubar]'"
        )

    import rumps

    from pantry.menubar_cocoa import run_popover

    def _notify(title: str, body: str) -> None:
        try:
            rumps.notification("pantry", title, body)
        except Exception:  # noqa: BLE001
            pass

    run_popover(
        host,
        port,
        embedded=embedded,
        on_quit=on_quit,
        serve_cmd=serve_cmd or "pantry",
        total_ram_gb=_total_ram_gb(),
        health_fn=lambda: _health(host, port, timeout=4.0),
        notify_fn=_notify,
    )
