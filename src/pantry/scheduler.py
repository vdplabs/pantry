from __future__ import annotations

import asyncio
import os
import time
import uuid
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, TypeVar

T = TypeVar("T")


@dataclass
class Scheduler:
    """Serialize operations per modality; prefer interactive over batch when both contend.
    
    Decoupled per modality (e.g. text/chat vs image vs audio vs video) so an image/video generation
    task doesn't starve or block concurrent chat reasoning / prompt completions.
    """

    _locks: dict[str, asyncio.Lock] = field(default_factory=dict)
    _active_jobs: dict[str, dict[str, Any]] = field(default_factory=dict)
    _queued_jobs: list[dict[str, Any]] = field(default_factory=list)
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

    def get_queue_stats(self) -> dict[str, Any]:
        now = time.time()
        return {
            "active": self.active_requests,
            "queued": self.queued_requests,
            "max_concurrency": self.max_concurrency,
            "active_jobs": [
                {
                    "job_id": j["job_id"],
                    "modality": j.get("modality", "text"),
                    "priority": j.get("priority", "interactive"),
                    "model": j.get("model", ""),
                    "description": j.get("description", ""),
                    "elapsed_seconds": round(now - j.get("started_at", now), 1),
                }
                for j in self._active_jobs.values()
            ],
            "queued_jobs": [
                {
                    "job_id": j["job_id"],
                    "modality": j.get("modality", "text"),
                    "priority": j.get("priority", "interactive"),
                    "model": j.get("model", ""),
                    "description": j.get("description", ""),
                    "wait_seconds": round(now - j.get("queued_at", now), 1),
                }
                for j in self._queued_jobs
            ],
        }

    async def run(
        self,
        priority: str,
        fn: Callable[[], Awaitable[T]],
        modality: str = "text",
        model: str = "",
        description: str = "",
    ) -> T:
        p = (priority or "interactive").lower()
        lock = self._get_lock(modality)
        job_id = f"job-{uuid.uuid4().hex[:6]}"
        job_info = {
            "job_id": job_id,
            "modality": modality,
            "priority": p,
            "model": model,
            "description": description,
            "queued_at": time.time(),
        }
        self._queued_jobs.append(job_info)
        self.queued_requests += 1
        lock_acquired = False
        try:
            async with lock:
                lock_acquired = True
                if job_info in self._queued_jobs:
                    self._queued_jobs.remove(job_info)
                self.queued_requests = max(0, self.queued_requests - 1)
                job_info["started_at"] = time.time()
                self._active_jobs[job_id] = job_info
                self.active_requests += 1
                try:
                    if p == "batch":
                        await asyncio.sleep(0)
                    return await fn()
                finally:
                    self._active_jobs.pop(job_id, None)
                    self.active_requests = max(0, self.active_requests - 1)
        finally:
            if not lock_acquired:
                if job_info in self._queued_jobs:
                    self._queued_jobs.remove(job_info)
                self.queued_requests = max(0, self.queued_requests - 1)

    @asynccontextmanager
    async def hold(
        self,
        priority: str = "interactive",
        modality: str = "text",
        model: str = "",
        description: str = "",
    ):
        """Hold the single-flight lock for a streaming response in the given modality."""
        p = (priority or "interactive").lower()
        lock = self._get_lock(modality)
        job_id = f"job-{uuid.uuid4().hex[:6]}"
        job_info = {
            "job_id": job_id,
            "modality": modality,
            "priority": p,
            "model": model,
            "description": description,
            "queued_at": time.time(),
        }
        self._queued_jobs.append(job_info)
        self.queued_requests += 1
        lock_acquired = False
        try:
            async with lock:
                lock_acquired = True
                if job_info in self._queued_jobs:
                    self._queued_jobs.remove(job_info)
                self.queued_requests = max(0, self.queued_requests - 1)
                job_info["started_at"] = time.time()
                self._active_jobs[job_id] = job_info
                self.active_requests += 1
                try:
                    if p == "batch":
                        await asyncio.sleep(0)
                    yield job_id
                finally:
                    self._active_jobs.pop(job_id, None)
                    self.active_requests = max(0, self.active_requests - 1)
        finally:
            if not lock_acquired:
                if job_info in self._queued_jobs:
                    self._queued_jobs.remove(job_info)
                self.queued_requests = max(0, self.queued_requests - 1)
