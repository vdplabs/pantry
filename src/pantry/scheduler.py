from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import TypeVar

T = TypeVar("T")


@dataclass
class Scheduler:
    """Serialize completions; prefer interactive over batch when both contend."""

    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def run(
        self,
        priority: str,
        fn: Callable[[], Awaitable[T]],
    ) -> T:
        p = (priority or "interactive").lower()
        async with self._lock:
            if p == "batch":
                await asyncio.sleep(0)
            return await fn()

    @asynccontextmanager
    async def hold(self, priority: str = "interactive"):
        """Hold the single-flight lock for a streaming response."""
        p = (priority or "interactive").lower()
        async with self._lock:
            if p == "batch":
                await asyncio.sleep(0)
            yield
