from __future__ import annotations

"""Mac menu bar status item for pantry.

Opened automatically by ``pantry serve`` when rumps is installed
(``pip install 'pantry[menubar]'``). Pass ``--no-menubar`` for HTTP-only.
"""

import signal
import subprocess
from collections.abc import Callable
from typing import Any

import httpx


def _get(url: str, timeout: float = 1.5) -> dict | list | None:
    try:
        r = httpx.get(url, timeout=timeout)
        if r.status_code != 200:
            return None
        return r.json()
    except Exception:  # noqa: BLE001
        return None


def _health(host: str, port: int) -> dict | None:
    body = _get(f"http://{host}:{port}/v1/health")
    return body if isinstance(body, dict) else None


def _models(host: str, port: int) -> list[dict[str, Any]]:
    body = _get(f"http://{host}:{port}/v1/models?ready_only=1")
    if not isinstance(body, dict):
        return []
    data = body.get("data") or []
    return [m for m in data if isinstance(m, dict)]


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


def _copy(text: str) -> None:
    try:
        subprocess.run(
            ["pbcopy"],
            input=text.encode("utf-8"),
            check=False,
        )
    except OSError:
        pass


def rumps_available() -> bool:
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
    """Run the status item.

    *embedded*: serve is already running in this process (default path via
    ``pantry serve``). Quit stops serve via *on_quit*.
    """
    set_accessory_activation_policy()

    try:
        import rumps
    except ImportError as e:
        raise SystemExit(
            "Menu bar requires rumps. Install with: pip install 'pantry[menubar]'"
        ) from e

    class PantryMenuApp(rumps.App):
        def __init__(self) -> None:
            set_accessory_activation_policy()
            super().__init__("pantry", title="P", quit_button=None)
            self._host = host
            self._port = port
            self._embedded = embedded
            self._on_quit = on_quit
            self._serve_cmd = serve_cmd or "pantry"
            self._online = False
            self._serve_proc: subprocess.Popen[bytes] | None = None
            self._loaded: set[str] = set()

            self.status_item = rumps.MenuItem("Status: …")
            self.memory_item = rumps.MenuItem("Memory: …")
            self.memory_menu = rumps.MenuItem("Unified memory")
            self.models_menu = rumps.MenuItem("Models")
            self.loaded_menu = rumps.MenuItem("Loaded")
            self.open_health = rumps.MenuItem(
                "Open /v1/health", callback=self.on_open_health
            )
            self.open_memory = rumps.MenuItem(
                "Open /v1/memory", callback=self.on_open_memory
            )

            if embedded:
                self.serve_item = rumps.MenuItem(
                    f"Serving on {host}:{port}", callback=None
                )
                self.quit_item = rumps.MenuItem(
                    "Quit pantry", callback=self.on_quit
                )
            else:
                self.serve_item = rumps.MenuItem(
                    "Start pantry serve", callback=self.on_serve_toggle
                )
                self.quit_item = rumps.MenuItem(
                    "Quit Pantry Menu", callback=self.on_quit
                )

            self.models_menu.add(rumps.MenuItem("(loading…)"))
            self.loaded_menu.add(rumps.MenuItem("(loading…)"))
            self.memory_menu.add(rumps.MenuItem("(loading…)"))

            self.menu = [
                self.status_item,
                self.memory_item,
                self.memory_menu,
                self.models_menu,
                self.loaded_menu,
                None,
                self.open_health,
                self.open_memory,
                self.serve_item,
                None,
                self.quit_item,
            ]
            self.refresh()

        @staticmethod
        def _clear_submenu(menu: rumps.MenuItem) -> None:
            if getattr(menu, "_menu", None) is None:
                return
            menu.clear()

        def _placeholder(self, menu: rumps.MenuItem, title: str) -> None:
            self._clear_submenu(menu)
            item = rumps.MenuItem(title)
            item.set_callback(None)
            menu.add(item)

        def _copy_id(self, text: str, label: str) -> None:
            _copy(text)
            rumps.notification("pantry", "Copied", f"{label}: {text}")

        def _unload(self, package_id: str | None) -> None:
            try:
                r = httpx.post(
                    f"http://{self._host}:{self._port}/v1/unload",
                    json={"package_id": package_id},
                    timeout=3.0,
                )
                r.raise_for_status()
            except Exception as e:  # noqa: BLE001
                rumps.notification(
                    "pantry",
                    "Unload failed",
                    f"{package_id or 'all'}: {e}",
                )
                return
            rumps.notification(
                "pantry",
                "Unloaded",
                package_id or "all loaded packages",
            )
            self.refresh()

        def _clear_memory(self) -> None:
            try:
                httpx.post(
                    f"http://{self._host}:{self._port}/v1/memory/clear",
                    timeout=5.0,
                )
            except Exception:  # noqa: BLE001
                rumps.notification("pantry", "Clear failed", "Metal cache")
                return
            rumps.notification("pantry", "Cleared", "Metal / MLX free cache")
            self.refresh()

        def _model_submenu(
            self, *, alias: str, package_id: str, loaded: bool
        ) -> rumps.MenuItem:
            title = f"{alias} ●" if loaded else alias
            root = rumps.MenuItem(title)

            copy_alias = rumps.MenuItem(f"Copy “{alias}”")

            def on_copy_alias(_: rumps.MenuItem, value: str = alias) -> None:
                self._copy_id(value, "model")

            copy_alias.set_callback(on_copy_alias)
            root.add(copy_alias)

            if package_id and package_id != alias:
                copy_pkg = rumps.MenuItem("Copy package id")

                def on_copy_pkg(_: rumps.MenuItem, value: str = package_id) -> None:
                    self._copy_id(value, "package")

                copy_pkg.set_callback(on_copy_pkg)
                root.add(copy_pkg)

            if loaded:
                unload = rumps.MenuItem("Unload")

                def on_unload(_: rumps.MenuItem, value: str = package_id) -> None:
                    self._unload(value)

                unload.set_callback(on_unload)
                root.add(unload)

            return root

        def _refresh_memory(self, body: dict) -> None:
            mem = body.get("memory") if isinstance(body.get("memory"), dict) else {}
            pressure = str(mem.get("pressure") or "unknown")
            active = mem.get("active_human") or "—"
            cache = mem.get("cache_human") or "—"
            self.memory_item.title = f"Memory: {pressure} · {active} active"

            self._clear_submenu(self.memory_menu)
            lines = [
                f"Pressure: {pressure}",
                f"Active heap: {active}",
                f"Peak heap: {mem.get('peak_human') or '—'}",
                f"Free cache: {cache}",
            ]
            limits = mem.get("limits") if isinstance(mem.get("limits"), dict) else {}
            if limits.get("cache_limit_human"):
                lines.append(f"Cache cap: {limits['cache_limit_human']}")
            if limits.get("memory_limit_human"):
                lines.append(f"Memory guideline: {limits['memory_limit_human']}")
            if mem.get("message"):
                lines.append(str(mem["message"])[:80])

            for line in lines:
                row = rumps.MenuItem(line)
                row.set_callback(None)
                self.memory_menu.add(row)

            clear = rumps.MenuItem("Clear Metal cache…")

            def on_clear(_: rumps.MenuItem) -> None:
                self._clear_memory()

            clear.set_callback(on_clear)
            self.memory_menu.add(clear)

        def refresh(self, *_: object) -> None:
            body = _health(self._host, self._port)
            if body is None:
                self._online = False
                self._loaded = set()
                self.title = "P·"
                self.status_item.title = f"Status: offline ({self._host}:{self._port})"
                self.memory_item.title = "Memory: —"
                self._placeholder(self.memory_menu, "(offline)")
                if not self._embedded:
                    self.serve_item.title = "Start pantry serve"
                self._placeholder(self.models_menu, "(offline)")
                self._placeholder(self.loaded_menu, "(offline)")
                return

            self._online = True
            loaded_list = [str(x) for x in (body.get("loaded") or [])]
            self._loaded = set(loaded_list)
            pressure = "ok"
            mem = body.get("memory")
            if isinstance(mem, dict) and mem.get("pressure"):
                pressure = str(mem["pressure"])
            # Title hint: P / P! / P!! for ok / elevated / critical
            if pressure == "critical":
                self.title = "P!!"
            elif pressure == "elevated":
                self.title = "P!"
            else:
                self.title = "P"
            self.status_item.title = (
                f"Status: ok · v{body.get('version', '?')} · "
                f"{body.get('packages', 0)} packages"
            )
            self._refresh_memory(body)
            if self._embedded:
                self.serve_item.title = f"Serving on {self._host}:{self._port}"
            else:
                self.serve_item.title = "Stop pantry serve"

            models = _models(self._host, self._port)
            self._clear_submenu(self.models_menu)
            if not models:
                self._placeholder(self.models_menu, "(none ready)")
            else:
                for m in models:
                    alias = str(m.get("id") or "?")
                    package_id = str(m.get("package_id") or m.get("owned_by") or alias)
                    is_loaded = package_id in self._loaded
                    self.models_menu.add(
                        self._model_submenu(
                            alias=alias, package_id=package_id, loaded=is_loaded
                        )
                    )

            self._clear_submenu(self.loaded_menu)
            if not loaded_list:
                self._placeholder(self.loaded_menu, "(none)")
            else:
                for pid in loaded_list:
                    row = rumps.MenuItem(pid)

                    copy_item = rumps.MenuItem("Copy package id")

                    def on_copy(_: rumps.MenuItem, value: str = pid) -> None:
                        self._copy_id(value, "package")

                    copy_item.set_callback(on_copy)
                    row.add(copy_item)

                    unload = rumps.MenuItem("Unload")

                    def on_unload(_: rumps.MenuItem, value: str = pid) -> None:
                        self._unload(value)

                    unload.set_callback(on_unload)
                    row.add(unload)

                    self.loaded_menu.add(row)

                self.loaded_menu.add(
                    rumps.MenuItem("Unload all…", callback=self.on_unload_all)
                )

        @rumps.timer(5)
        def on_tick(self, _: rumps.Timer) -> None:
            self.refresh()

        def on_open_health(self, _: rumps.MenuItem) -> None:
            subprocess.Popen(
                ["open", f"http://{self._host}:{self._port}/v1/health"]
            )

        def on_open_memory(self, _: rumps.MenuItem) -> None:
            subprocess.Popen(
                ["open", f"http://{self._host}:{self._port}/v1/memory"]
            )

        def on_unload_all(self, _: rumps.MenuItem) -> None:
            self._unload(None)

        def on_serve_toggle(self, _: rumps.MenuItem) -> None:
            if self._embedded:
                return
            if self._online or _pids_on_port(self._port):
                n = _stop_serve(self._port)
                if self._serve_proc is not None and self._serve_proc.poll() is None:
                    try:
                        self._serve_proc.terminate()
                    except OSError:
                        pass
                self._serve_proc = None
                rumps.notification(
                    "pantry",
                    "Stopped",
                    f"signaled {n or 'listener'} on :{self._port}",
                )
                self.refresh()
                return

            self._serve_proc = subprocess.Popen(
                [
                    self._serve_cmd,
                    "serve",
                    "--host",
                    self._host,
                    "--port",
                    str(self._port),
                    "--no-menubar",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            rumps.notification(
                "pantry", "Starting", f"serve on {self._host}:{self._port}"
            )

        def on_quit(self, _: rumps.MenuItem) -> None:
            if self._on_quit is not None:
                try:
                    self._on_quit()
                except Exception:  # noqa: BLE001, S110
                    pass
            rumps.quit_application()

    PantryMenuApp().run()
