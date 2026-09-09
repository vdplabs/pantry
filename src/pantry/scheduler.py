from __future__ import annotations

import asyncio
import os
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import TypeVar

T = TypeVar("T")


@dataclass
class Scheduler:
    """Serialize operations per modality; prefer interactive over batch when both contend.
    
    Decoupled per modality (e.g. text/chat vs image vs audio) so an image generation
    task doesn't starve or block concurrent chat reasoning / prompt completions.
    """

    _locks: dict[str, asyncio.Lock] = field(default_factory=dict)
    active_requests: int = 0
    queued_requests: int = 0
    max_concurrency: int = field(
        default_factory=lambda: int(os.environ.get("PANTRY_MAX_CONCURRENCY", "4"))
    )

    def _get_lock(self, modality: str = "text") -> asyncio.Lock:
        key = (modality or "text").lower().strip()
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        return self._locks[key]

    def get_queue_stats(self) -> dict[str, int]:
        return {
            "active": self.active_requests,
            "queued": self.queued_requests,
            "max_concurrency": self.max_concurrency,
        }

    async def run(
        self,
        priority: str,
        fn: Callable[[], Awaitable[T]],
        modality: str = "text",
    ) -> T:
        p = (priority or "interactive").lower()
        lock = self._get_lock(modality)
        self.queued_requests += 1
        lock_acquired = False
        try:
            async with lock:
                lock_acquired = True
                self.queued_requests = max(0, self.queued_requests - 1)
                self.active_requests += 1
                try:
                    if p == "batch":
                        await asyncio.sleep(0)
                    return await fn()
                finally:
                    self.active_requests = max(0, self.active_requests - 1)
        finally:
            if not lock_acquired:
                self.queued_requests = max(0, self.queued_requests - 1)

    @asynccontextmanager
    async def hold(self, priority: str = "interactive", modality: str = "text"):
        """Hold the single-flight lock for a streaming response in the given modality."""
        p = (priority or "interactive").lower()
        lock = self._get_lock(modality)
        self.queued_requests += 1
        lock_acquired = False
        try:
            async with lock:
                lock_acquired = True
                self.queued_requests = max(0, self.queued_requests - 1)
                self.active_requests += 1
                try:
                    if p == "batch":
                        await asyncio.sleep(0)
                    yield
                finally:
                    self.active_requests = max(0, self.active_requests - 1)
        finally:
            if not lock_acquired:
                self.queued_requests = max(0, self.queued_requests - 1)
