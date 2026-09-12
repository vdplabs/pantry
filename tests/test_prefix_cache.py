from __future__ import annotations

import asyncio
import json
import pytest
from pantry.prefix_cache import PrefixCacheManager, RadixNode, RadixTree
from pantry.runtime import EchoRuntime
from pantry.schemas import ChatMessage, PackageManifest


def test_radix_tree_basic_insertion_and_search():
    tree = RadixTree("test-model")
    assert tree.total_nodes == 0
    assert tree.total_entries == 0

    tokens1 = [101, 102, 103, 104]
    tree.insert(tokens1, "kv-state-1", nbytes=1024)
    assert tree.total_nodes == 1
    assert tree.total_entries == 1
    assert tree.total_bytes == 1024
    assert tree.total_cached_tokens == 4

    # Exact search
    node, matched_len = tree.search_prefix(tokens1)
    assert node is not None
    assert matched_len == 4
    assert node.value == "kv-state-1"

    # Longer prompt sharing exact prefix
    tokens2 = [101, 102, 103, 104, 201, 202]
    node, matched_len = tree.search_prefix(tokens2)
    assert node is not None
    assert matched_len == 4
    assert node.value == "kv-state-1"

    # Completely disjoint prompt
    tokens3 = [999, 888]
    node, matched_len = tree.search_prefix(tokens3)
    assert node is None
    assert matched_len == 0


def test_radix_tree_branching_and_splitting():
    tree = RadixTree("test-model")
    # Preamble + Branch A
    seq_a = [1, 2, 3, 4, 5]
    tree.insert(seq_a, "state-a", nbytes=2048)

    # Preamble + Branch B (shares 1, 2, 3)
    seq_b = [1, 2, 3, 6, 7]
    tree.insert(seq_b, "state-b", nbytes=2048)

    # Root should have split: intermediate [1, 2, 3], child 1 [4, 5], child 2 [6, 7]
    node_a, len_a = tree.search_prefix([1, 2, 3, 4, 5, 100])
    assert node_a is not None
    assert len_a == 5
    assert node_a.value == "state-a"

    node_b, len_b = tree.search_prefix([1, 2, 3, 6, 7, 200])
    assert node_b is not None
    assert len_b == 5
    assert node_b.value == "state-b"

    # Querying only preamble
    node_pre, len_pre = tree.search_prefix([1, 2, 3])
    # Preamble is intermediate non-terminal so far
    assert len_pre == 0

    # Insert preamble as terminal as well
    tree.insert([1, 2, 3], "state-preamble", nbytes=1024)
    node_pre, len_pre = tree.search_prefix([1, 2, 3])
    assert node_pre is not None
    assert len_pre == 3
    assert node_pre.value == "state-preamble"


def test_radix_tree_lru_eviction():
    tree = RadixTree("test-model")
    tree.insert([1, 2, 3], "state-1", nbytes=1000)
    tree.insert([4, 5, 6], "state-2", nbytes=1000)
    tree.insert([7, 8, 9], "state-3", nbytes=1000)

    assert tree.total_bytes == 3000
    assert tree.total_entries == 3

    # Evict 1500 bytes (should evict state-1 and state-2)
    reclaimed = tree.evict_lru(1500)
    assert reclaimed >= 1500
    assert tree.total_bytes <= 1500

    # state-3 should still be in cache
    node, matched_len = tree.search_prefix([7, 8, 9])
    assert node is not None
    assert matched_len == 3
    assert node.value == "state-3"


def test_prefix_cache_manager_lookup_and_exact_trim():
    pcm = PrefixCacheManager(max_memory_bytes=100000)
    pcm.reset_metrics()
    pcm.clear()

    # Insert sequence of 5 tokens
    tokens = [10, 20, 30, 40, 50]
    pcm.insert("model-a", tokens, "cached-kv-5", nbytes=2048)

    # 1. Exact match lookup: should trim 1 token for generation step
    val, rem, cached_count = pcm.lookup("model-a", tokens)
    assert val is not None
    assert cached_count == 4
    assert rem == [50]
    assert pcm.hits == 1

    # 2. Longer prompt: should match all 5 tokens
    val2, rem2, cached_count2 = pcm.lookup("model-a", [10, 20, 30, 40, 50, 60, 70])
    assert val2 is not None
    assert cached_count2 == 5
    assert rem2 == [60, 70]
    assert pcm.hits == 2

    # 3. Miss lookup
    val3, rem3, cached_count3 = pcm.lookup("model-a", [999, 888])
    assert val3 is None
    assert cached_count3 == 0
    assert rem3 == [999, 888]
    assert pcm.misses == 1

    stats = pcm.stats("model-a")
    assert stats.hit_count == 2
    assert stats.miss_count == 1
    assert stats.hit_rate_percent == 66.7


def test_prefix_cache_manager_clear():
    pcm = PrefixCacheManager()
    pcm.insert("model-1", [1, 2, 3], "kv1", nbytes=500)
    pcm.insert("model-2", [4, 5, 6], "kv2", nbytes=700)

    # Clear specific model
    res = pcm.clear("model-1")
    assert res.ok is True
    assert res.reclaimed_bytes == 500
    assert pcm.stats("model-1").total_entries == 0
    assert pcm.stats("model-2").total_entries == 1

    # Clear all
    res_all = pcm.clear()
    assert res_all.ok is True
    assert res_all.reclaimed_bytes == 700
    assert pcm.stats().total_entries == 0


def test_echo_runtime_multi_turn_caching():
    async def _run():
        pcm = PrefixCacheManager.get()
        pcm.clear()
        pcm.reset_metrics()

        manifest = PackageManifest(id="test.echo.chat", family="demo", template_family="chatml")
        runtime = EchoRuntime()

        # Turn 1: First user message
        messages1 = [
            ChatMessage(role="system", content="You are a helpful AI assistant running on Apple Silicon."),
            ChatMessage(role="user", content="Explain quantum computing simply."),
        ]
        u1: dict = {}
        out1 = await runtime.complete(manifest, messages1, max_tokens=100, temperature=0.0, usage=u1)
        assert out1
        assert "prompt_tokens_details" in u1
        assert u1["prompt_tokens_details"]["cached_tokens"] == 0

        # Turn 2: Follow-up message sharing system prompt + previous turn
        messages2 = [
            ChatMessage(role="system", content="You are a helpful AI assistant running on Apple Silicon."),
            ChatMessage(role="user", content="Explain quantum computing simply."),
            ChatMessage(role="assistant", content=out1),
            ChatMessage(role="user", content="Now explain it with an analogy."),
        ]
        u2: dict = {}
        out2 = await runtime.complete(manifest, messages2, max_tokens=100, temperature=0.0, usage=u2)
        assert out2
        assert "prompt_tokens_details" in u2
        # Second turn should have reused prompt tokens from turn 1
        assert u2["prompt_tokens_details"]["cached_tokens"] > 0
        assert u2["total_tokens"] > u2["prompt_tokens_details"]["cached_tokens"]

        # Turn 3 with prefer_prefix_cache=False should bypass cache
        u3: dict = {}
        out3 = await runtime.complete(
            manifest,
            messages2,
            max_tokens=100,
            temperature=0.0,
            prefer_prefix_cache=False,
            usage=u3,
        )
        assert out3
        assert u3["prompt_tokens_details"]["cached_tokens"] == 0

    asyncio.run(_run())


def test_server_prefix_cache_endpoints(client):
    # 1. Query stats endpoint
    r_stats = client.get("/v1/cache/prefix/stats")
    assert r_stats.status_code == 200
    data = r_stats.json()
    assert "total_nodes" in data
    assert "hit_rate_percent" in data

    # 2. Clear cache endpoint
    r_clear = client.post("/v1/cache/prefix/clear")
    assert r_clear.status_code == 200
    assert r_clear.json()["ok"] is True

    # 3. Non-streaming chat completion returns prompt_tokens_details
    r_chat = client.post(
        "/v1/chat/completions",
        json={
            "model": "demo-standard",
            "messages": [
                {"role": "system", "content": "You are a local model."},
                {"role": "user", "content": "Hello!"},
            ],
            "stream": False,
        },
    )
    assert r_chat.status_code == 200
    res = r_chat.json()
    assert "usage" in res
    assert "prompt_tokens_details" in res["usage"]
    assert "cached_tokens" in res["usage"]["prompt_tokens_details"]

    # 4. Multi-turn follow-up produces cached_tokens > 0
    r_chat2 = client.post(
        "/v1/chat/completions",
        json={
            "model": "demo-standard",
            "messages": [
                {"role": "system", "content": "You are a local model."},
                {"role": "user", "content": "Hello!"},
                {"role": "assistant", "content": res["choices"][0]["message"]["content"]},
                {"role": "user", "content": "Tell me more!"},
            ],
            "stream": False,
        },
    )
    assert r_chat2.status_code == 200
    res2 = r_chat2.json()
    assert res2["usage"]["prompt_tokens_details"]["cached_tokens"] > 0

    # 5. Streaming chat completion returns prompt_tokens_details in final chunk
    r_stream = client.post(
        "/v1/chat/completions",
        json={
            "model": "demo-standard",
            "messages": [
                {"role": "user", "content": "Streaming test."},
            ],
            "stream": True,
        },
    )
    assert r_stream.status_code == 200
    chunks = [line for line in r_stream.text.split("\n") if line.startswith("data: ") and line != "data: [DONE]"]
    assert len(chunks) > 0
    last_chunk = json.loads(chunks[-1][6:])
    assert "usage" in last_chunk
    assert "prompt_tokens_details" in last_chunk["usage"]

    # 6. Telemetry monitor stats includes prefix_cache
    r_mon = client.get("/v1/monitor/stats")
    assert r_mon.status_code == 200
    mon_data = r_mon.json()
    assert "inference" in mon_data
    assert "prefix_cache" in mon_data["inference"]
    assert "cached_prompt_tokens" in mon_data["inference"]["prefix_cache"]
    assert "hit_rate_percent" in mon_data["inference"]["prefix_cache"]
