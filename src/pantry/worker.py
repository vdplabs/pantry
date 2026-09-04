from __future__ import annotations

"""Subprocess worker isolation for MLX inference.

Spawning MLX in a child process lets macOS reclaim that worker's Metal driver
allocations when the process exits. The host FastAPI daemon stays lightweight;
this is best-effort OS reclaim, not a guarantee that system memory drops to zero.
"""

import asyncio
import multiprocessing as mp
from collections.abc import AsyncIterator
from typing import Any

from pantry.runtime import MLXRuntime, Runtime
from pantry.schemas import ChatMessage, PackageManifest
from pantry.store import PackageStore


def _worker_entry(
    req_q: mp.Queue,
    res_q: mp.Queue,
    home_dir: str,
    data_dir: str,
) -> None:
    from pathlib import Path

    store = PackageStore(Path(home_dir), data_root=Path(data_dir))
    runtime = MLXRuntime(store)

    while True:
        try:
            req = req_q.get()
        except Exception:  # noqa: BLE001
            break

        if not isinstance(req, dict):
            continue

        action = req.get("action")
        if action == "shutdown":
            break

        if action == "unload":
            pid = req.get("package_id")
            runtime.unload(pid)
            res_q.put({"status": "ok"})
            continue

        manifest_data = req.get("manifest")
        messages_data = req.get("messages", [])
        max_tokens = req.get("max_tokens")
        temperature = req.get("temperature")
        prefer_speculative = req.get("prefer_speculative", False)
        tools = req.get("tools")

        manifest = PackageManifest.model_validate(manifest_data)
        messages = [ChatMessage.model_validate(m) for m in messages_data]

        if action == "complete":
            try:
                usage: dict[str, int] = {}
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                text = loop.run_until_complete(
                    runtime.complete(
                        manifest,
                        messages,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        prefer_speculative=prefer_speculative,
                        usage=usage,
                        tools=tools,
                    )
                )
                loop.close()
                res_q.put({"status": "ok", "text": text, "usage": usage})
            except Exception as exc:  # noqa: BLE001
                res_q.put({"status": "error", "error": str(exc)})

        elif action == "stream":
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                usage = {}

                async def _consume_stream(
                    m=manifest,
                    msgs=messages,
                    mt=max_tokens,
                    t=temperature,
                    ps=prefer_speculative,
                    u=usage,
                    tls=tools,
                ):
                    async for chunk in runtime.stream(
                        m,
                        msgs,
                        max_tokens=mt,
                        temperature=t,
                        prefer_speculative=ps,
                        usage=u,
                        tools=tls,
                    ):
                        res_q.put({"status": "chunk", "text": chunk})

                loop.run_until_complete(_consume_stream())
                loop.close()
                res_q.put({"status": "done", "usage": usage})
            except Exception as exc:  # noqa: BLE001
                res_q.put({"status": "error", "error": str(exc)})


class IsolatedMLXRuntime(Runtime):
    """MLX runtime hosted inside a separate worker process."""

    def __init__(self, store: PackageStore) -> None:
        self.store = store
        self._ctx = mp.get_context("spawn")
        self._process: mp.Process | None = None
        self._req_q: mp.Queue | None = None
        self._res_q: mp.Queue | None = None

    def _ensure_worker(self) -> None:
        if self._process is not None and self._process.is_alive():
            return

        self._req_q = self._ctx.Queue()
        self._res_q = self._ctx.Queue()
        self._process = self._ctx.Process(
            target=_worker_entry,
            args=(
                self._req_q,
                self._res_q,
                str(self.store.root),
                str(self.store.data_root),
            ),
            daemon=True,
        )
        self._process.start()

    def unload(self, package_id: str | None = None) -> None:
        if package_id is None:
            # Terminate the worker entirely to release all Metal allocations
            if self._process is not None:
                try:
                    if self._req_q is not None and self._process.is_alive():
                        self._req_q.put({"action": "shutdown"})
                        self._process.join(timeout=1.0)
                except Exception:  # noqa: BLE001, S110
                    pass
                if self._process.is_alive():
                    self._process.terminate()
                self._process = None
                self._req_q = None
                self._res_q = None
        else:
            if self._process is not None and self._process.is_alive() and self._req_q is not None:
                self._req_q.put({"action": "unload", "package_id": package_id})
                if self._res_q is not None:
                    try:
                        self._res_q.get(timeout=2.0)
                    except Exception:  # noqa: BLE001, S110
                        pass

    async def complete(
        self,
        manifest: PackageManifest,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None,
        temperature: float | None,
        prefer_speculative: bool = False,
        usage: dict[str, int] | None = None,
        tools: list[dict] | None = None,
    ) -> str:
        self._ensure_worker()
        assert self._req_q is not None and self._res_q is not None

        payload: dict[str, Any] = {
            "action": "complete",
            "manifest": manifest.model_dump(),
            "messages": [m.model_dump() for m in messages],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "prefer_speculative": prefer_speculative,
            "tools": tools,
        }
        self._req_q.put(payload)

        res = await asyncio.to_thread(self._res_q.get)
        if res.get("status") == "error":
            raise RuntimeError(res.get("error", "worker complete error"))

        if usage is not None and "usage" in res:
            usage.update(res["usage"])
        return res.get("text", "")

    async def stream(
        self,
        manifest: PackageManifest,
        messages: list[ChatMessage],
        *,
        max_tokens: int | None,
        temperature: float | None,
        prefer_speculative: bool = False,
        usage: dict[str, int] | None = None,
        tools: list[dict] | None = None,
    ) -> AsyncIterator[str]:
        self._ensure_worker()
        assert self._req_q is not None and self._res_q is not None

        payload: dict[str, Any] = {
            "action": "stream",
            "manifest": manifest.model_dump(),
            "messages": [m.model_dump() for m in messages],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "prefer_speculative": prefer_speculative,
            "tools": tools,
        }
        self._req_q.put(payload)

        while True:
            res = await asyncio.to_thread(self._res_q.get)
            status = res.get("status")
            if status == "chunk":
                yield res.get("text", "")
            elif status == "done":
                if usage is not None and "usage" in res:
                    usage.update(res["usage"])
                break
            elif status == "error":
                raise RuntimeError(res.get("error", "worker stream error"))
            else:
                break
