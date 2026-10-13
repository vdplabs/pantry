"""Native macOS status-item + popover for pantry (PyObjC, no rumps UI).

The dropdown is an NSPopover hosting a WKWebView that renders
``static/menubar.html`` and talks to the pantry daemon over HTTP.
Python owns the status item, the popover lifecycle, and a small native
bridge (quit, open URLs, notifications, serve start/stop); all UI state
lives in the page.

This module is imported lazily by ``pantry.menubar`` so importing that
module never requires macOS-only frameworks.
"""

from __future__ import annotations

import json
import subprocess
import threading
from pathlib import Path
from typing import Any, Callable

import objc
from AppKit import (
    NSApplication,
    NSApplicationDidResignActiveNotification,
    NSMakeRect,
    NSMakeSize,
    NSMaxYEdge,
    NSNotificationCenter,
    NSStatusBar,
    NSVariableStatusItemLength,
    NSView,
    NSViewController,
    NSViewHeightSizable,
    NSViewWidthSizable,
    NSPopover,
    NSPopoverBehaviorApplicationDefined,
)
from Foundation import NSObject, NSURL
from WebKit import WKWebView, WKWebViewConfiguration

from pantry.menubar import _pids_on_port, _stop_serve

POPOVER_W, POPOVER_H = 380, 560


class _Bridge(NSObject):
    """WKScriptMessageHandler: receives {action, ...} dicts from the page."""

    def initWithBar_(self, bar: "PantryBar") -> "_Bridge":
        self = objc.super(_Bridge, self).init()
        self._bar = bar
        return self

    def userContentController_didReceiveScriptMessage_(self, controller, message) -> None:
        try:
            body = message.body()
        except Exception:  # noqa: BLE001
            return
        if isinstance(body, dict):
            try:
                self._bar.handleBridgeMessage_(dict(body))
            except Exception:  # noqa: BLE001
                pass


class _NavDelegate(NSObject):
    """Injects window.PANTRY once the page finishes loading."""

    def initWithBar_(self, bar: "PantryBar") -> "_NavDelegate":
        self = objc.super(_NavDelegate, self).init()
        self._bar = bar
        return self

    def webView_didFinishNavigation_(self, webview, navigation) -> None:
        payload = {
            "host": self._bar.host,
            "port": self._bar.port,
            "totalRamGb": self._bar.total_ram_gb,
            "embedded": self._bar.embedded,
        }
        js = "window.PANTRY=%s;window.dispatchEvent(new Event('pantry:ready'));" % json.dumps(
            payload
        )
        webview.evaluateJavaScript_completionHandler_(js, None)


def _title_for_body(body: Any) -> str:
    if not isinstance(body, dict):
        return "P·"
    mem = body.get("memory") if isinstance(body.get("memory"), dict) else {}
    pressure = str(mem.get("pressure") or "ok")
    if body.get("loading") or body.get("status") == "loading":
        return "P…"
    if pressure == "critical":
        return "P!!"
    if pressure == "elevated":
        return "P!"
    return "P"


class PantryBar(NSObject):
    """Owns the NSStatusItem, the NSPopover, and the native bridge."""

    def configure(
        self,
        host: str,
        port: int,
        embedded: bool,
        on_quit: Callable[[], None] | None,
        serve_cmd: str,
        total_ram_gb: float,
        health_fn: Callable[[], dict | None],
        notify_fn: Callable[[str, str], None],
    ) -> "PantryBar":
        self.host = host
        self.port = port
        self.embedded = embedded
        self._on_quit = on_quit
        self._serve_cmd = serve_cmd
        self.total_ram_gb = total_ram_gb
        self._health_fn = health_fn
        self._notify_fn = notify_fn
        self._serve_proc: subprocess.Popen[bytes] | None = None

        # --- status item -------------------------------------------------
        self.statusItem = NSStatusBar.systemStatusBar().statusItemWithLength_(
            NSVariableStatusItemLength
        )
        button = self.statusItem.button()
        if button is not None:
            button.setTitle_("P")
            button.setTarget_(self)
            button.setAction_("togglePopover:")

        # --- popover ------------------------------------------------------
        self.popover = NSPopover.alloc().init()
        self.popover.setContentSize_(NSMakeSize(POPOVER_W, POPOVER_H))
        self.popover.setBehavior_(NSPopoverBehaviorApplicationDefined)
        self.popover.setAnimates_(True)

        vc = NSViewController.alloc().init()
        view = NSView.alloc().initWithFrame_(NSMakeRect(0, 0, POPOVER_W, POPOVER_H))

        config = WKWebViewConfiguration.alloc().init()
        self._bridge = _Bridge.alloc().initWithBar_(self)
        config.userContentController().addScriptMessageHandler_name_(self._bridge, "pantry")

        self.webview = WKWebView.alloc().initWithFrame_configuration_(
            view.bounds(), config
        )
        self.webview.setAutoresizingMask_(NSViewWidthSizable | NSViewHeightSizable)
        self._nav = _NavDelegate.alloc().initWithBar_(self)
        self.webview.setNavigationDelegate_(self._nav)
        view.addSubview_(self.webview)
        vc.setView_(view)
        self.popover.setContentViewController_(vc)

        html = Path(__file__).parent / "static" / "menubar.html"
        url = NSURL.fileURLWithPath_(str(html))
        self.webview.loadFileURL_allowingReadAccessToURL_(
            url, url.URLByDeletingLastPathComponent()
        )

        # Dismiss when the app loses focus (manual: behavior is app-defined).
        NSNotificationCenter.defaultCenter().addObserver_selector_name_object_(
            self,
            "appDeactivated:",
            NSApplicationDidResignActiveNotification,
            None,
        )

        self._stop = threading.Event()
        threading.Thread(target=self._titleLoop, daemon=True, name="pantry-bar-title").start()
        return self

    # -- selectors --------------------------------------------------------

    def togglePopover_(self, sender) -> None:
        if self.popover.isShown():
            self.popover.close()
            return
        button = self.statusItem.button()
        if button is None:
            return
        self.popover.showRelativeToRect_ofView_preferredEdge_(
            button.bounds(), button, NSMaxYEdge
        )
        NSApplication.sharedApplication().activateIgnoringOtherApps_(True)

    def appDeactivated_(self, note) -> None:
        if self.popover.isShown():
            self.popover.close()

    def handleBridgeMessage_(self, msg: dict) -> None:
        action = msg.get("action")
        if action == "quit":
            self._doQuit()
        elif action == "open":
            url = str(msg.get("url") or "")
            if url.startswith(("http://", "https://")):
                subprocess.Popen(["open", url])
        elif action == "notify":
            try:
                self._notify_fn(str(msg.get("title") or "pantry"), str(msg.get("body") or ""))
            except Exception:  # noqa: BLE001
                pass
        elif action == "serve-start":
            self._serveStart()
        elif action == "serve-stop":
            self._serveStop()

    # -- internals --------------------------------------------------------

    def _applyTitle_(self, title: str) -> None:
        try:
            button = self.statusItem.button()
            if button is not None:
                button.setTitle_(title)
        except Exception:  # noqa: BLE001
            pass

    def _titleLoop(self) -> None:
        from PyObjCTools.AppHelper import callAfter

        while not self._stop.is_set():
            try:
                body = self._health_fn()
            except Exception:  # noqa: BLE001
                body = None
            title = _title_for_body(body)
            try:
                callAfter(self._applyTitle_, title)
            except Exception:  # noqa: BLE001
                pass
            self._stop.wait(5.0)

    def _serveStart(self) -> None:
        if self.embedded:
            return
        try:
            self._serve_proc = subprocess.Popen(
                [self._serve_cmd, "serve", "--host", self.host, "--port", str(self.port), "--no-menubar"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            self._notify_fn("pantry", f"Starting serve on {self.host}:{self.port}")
        except Exception as e:  # noqa: BLE001
            self._notify_fn("pantry", f"Could not start serve: {e}")

    def _serveStop(self) -> None:
        if self.embedded:
            return
        n = _stop_serve(self.port)
        if self._serve_proc is not None and self._serve_proc.poll() is None:
            try:
                self._serve_proc.terminate()
            except OSError:
                pass
        self._serve_proc = None
        self._notify_fn("pantry", f"Stopped serve (signaled {n or 'listener'} on :{self.port})")

    def _doQuit(self) -> None:
        if self._on_quit is not None:
            try:
                self._on_quit()
            except Exception:  # noqa: BLE001
                pass
        self._stop.set()
        NSApplication.sharedApplication().terminate_(None)


def run_popover(
    host: str,
    port: int,
    *,
    embedded: bool,
    on_quit: Callable[[], None] | None,
    serve_cmd: str,
    total_ram_gb: float,
    health_fn: Callable[[], dict | None],
    notify_fn: Callable[[str, str], None],
) -> None:
    """Create the status item + popover and run the Cocoa event loop."""
    app = NSApplication.sharedApplication()
    bar = PantryBar.alloc().init()
    bar.configure(
        host=host,
        port=port,
        embedded=embedded,
        on_quit=on_quit,
        serve_cmd=serve_cmd,
        total_ram_gb=total_ram_gb,
        health_fn=health_fn,
        notify_fn=notify_fn,
    )
    app.run()
