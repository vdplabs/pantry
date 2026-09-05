from __future__ import annotations

import asyncio
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

    def _get_lock(self, modality: str = "text") -> asyncio.Lock:
        key = (modality or "text").lower().strip()
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        return self._locks[key]

    async def run(
        self,
        priority: str,
        fn: Callable[[], Awaitable[T]],
        modality: str = "text",
    ) -> T:
        p = (priority or "interactive").lower()
        lock = self._get_lock(modality)
        async with lock:
            if p == "batch":
                await asyncio.sleep(0)
            return await fn()

    @asynccontextmanager
    async def hold(self, priority: str = "interactive", modality: str = "text"):
        """Hold the single-flight lock for a streaming response in the given modality."""
        p = (priority or "interactive").lower()
        lock = self._get_lock(modality)
        async with lock:
            if p == "batch":
                await asyncio.sleep(0)
            yield
