from __future__ import annotations

import asyncio
from pantry.scheduler import Scheduler


def test_scheduler_decouples_modalities_concurrently():
    async def _test():
        sched = Scheduler()
        events: list[str] = []

        async def slow_image():
            events.append("image_start")
            await asyncio.sleep(0.1)
            events.append("image_end")
            return "image_done"

        async def fast_text():
            events.append("text_start")
            await asyncio.sleep(0.01)
            events.append("text_end")
            return "text_done"

        t1 = asyncio.create_task(sched.run("interactive", slow_image, modality="image"))
        await asyncio.sleep(0.01)
        t2 = asyncio.create_task(sched.run("interactive", fast_text, modality="text"))

        r1, r2 = await asyncio.gather(t1, t2)
        assert r1 == "image_done"
        assert r2 == "text_done"
        assert events == ["image_start", "text_start", "text_end", "image_end"]

    asyncio.run(_test())


def test_scheduler_serializes_same_modality():
    async def _test():
        sched = Scheduler()
        events: list[str] = []

        async def task_a():
            events.append("a_start")
            await asyncio.sleep(0.05)
            events.append("a_end")

        async def task_b():
            events.append("b_start")
            await asyncio.sleep(0.01)
            events.append("b_end")

        t1 = asyncio.create_task(sched.run("interactive", task_a, modality="text"))
        await asyncio.sleep(0.005)
        t2 = asyncio.create_task(sched.run("interactive", task_b, modality="text"))

        await asyncio.gather(t1, t2)
        assert events == ["a_start", "a_end", "b_start", "b_end"]

    asyncio.run(_test())


def test_scheduler_queue_stats_with_job_tracking():
    async def _test():
        sched = Scheduler()

        started = asyncio.Event()
        finish = asyncio.Event()

        async def worker_a():
            started.set()
            await finish.wait()
            return "ok"

        async def worker_b():
            return "b_done"

        t1 = asyncio.create_task(
            sched.run("interactive", worker_a, modality="video", model="video-model-1", description="Rendering frames")
        )
        await started.wait()

        # Enqueue second video job while first holds lock
        t2 = asyncio.create_task(
            sched.run("batch", worker_b, modality="video", model="video-model-2", description="Queued video")
        )
        await asyncio.sleep(0.01)

        stats = sched.get_queue_stats()
        assert stats["active"] == 1
        assert stats["queued"] == 1
        assert len(stats["active_jobs"]) == 1
        assert stats["active_jobs"][0]["model"] == "video-model-1"
        assert stats["active_jobs"][0]["modality"] == "video"
        assert stats["active_jobs"][0]["description"] == "Rendering frames"
        assert stats["active_jobs"][0]["elapsed_seconds"] >= 0.0

        assert len(stats["queued_jobs"]) == 1
        assert stats["queued_jobs"][0]["model"] == "video-model-2"
        assert stats["queued_jobs"][0]["description"] == "Queued video"

        finish.set()
        await asyncio.gather(t1, t2)

        stats_after = sched.get_queue_stats()
        assert stats_after["active"] == 0
        assert stats_after["queued"] == 0
        assert stats_after["active_jobs"] == []
        assert stats_after["queued_jobs"] == []

    asyncio.run(_test())

