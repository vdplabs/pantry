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
