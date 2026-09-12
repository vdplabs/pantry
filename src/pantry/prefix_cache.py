from __future__ import annotations

import copy
import logging
import threading
import time
from collections import OrderedDict
from typing import Any

from pantry.memory import get_available_unified_dram
from pantry.schemas import PrefixCacheClearResponse, PrefixCacheStats

logger = logging.getLogger("pantry.prefix_cache")

# Default memory headroom budget: up to 2 GB or 20% of unified memory for prefix KV cache
DEFAULT_PREFIX_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB


def _calc_kv_nbytes(kv_cache: Any, num_tokens: int) -> int:
    """Calculates or estimates the memory footprint in bytes of a KV cache object."""
    if kv_cache is None:
        return 0
    # 1. Direct nbytes attribute on MLX cache entry or list of layer caches
    if hasattr(kv_cache, "nbytes") and isinstance(kv_cache.nbytes, int):
        return kv_cache.nbytes
    if isinstance(kv_cache, (list, tuple)):
        total = 0
        for item in kv_cache:
            if hasattr(item, "nbytes") and isinstance(item.nbytes, int):
                total += item.nbytes
        if total > 0:
            return total
    # 2. Heuristic fallback: ~8 KB - 16 KB per token for typical 3B-7B models
    return max(128, num_tokens * 4096)


class RadixNode:
    """Node in a compressed Radix prefix tree storing token sequence chunks and KV cache states."""

    def __init__(self, tokens: tuple[int, ...] = ()) -> None:
        self.tokens: tuple[int, ...] = tuple(tokens)
        self.children: dict[int, RadixNode] = {}  # Keyed by child's first token
        self.value: Any = None  # KV cache payload or reference
        self.nbytes: int = 0  # Memory occupied by cached KV buffers at this terminal node
        self.token_count: int = 0  # Total cumulative tokens from root to this node
        self.last_accessed: float = time.time()
        self.ref_count: int = 0
        self.is_terminal: bool = False

    @property
    def is_leaf(self) -> bool:
        return len(self.children) == 0


class RadixTree:
    """Thread-safe compressed Radix Tree for zero-cost prefix caching (Patent Claim 7)."""

    def __init__(self, model_id: str) -> None:
        self.model_id = model_id
        self.root = RadixNode()
        self.total_nodes: int = 0
        self.total_entries: int = 0
        self.total_cached_tokens: int = 0
        self.total_bytes: int = 0
        self._lru_order: OrderedDict[tuple[int, ...], RadixNode] = OrderedDict()

    def insert(
        self,
        tokens: list[int] | tuple[int, ...],
        value: Any,
        nbytes: int = 0,
    ) -> None:
        """Inserts a token sequence and its compiled KV cache state into the Radix tree."""
        tok_tuple = tuple(tokens)
        if not tok_tuple:
            return

        if nbytes <= 0:
            nbytes = _calc_kv_nbytes(value, len(tok_tuple))

        curr = self.root
        i = 0
        while i < len(tok_tuple):
            first_tok = tok_tuple[i]
            if first_tok not in curr.children:
                # Add child with remainder of tokens
                new_node = RadixNode(tok_tuple[i:])
                new_node.value = value
                new_node.nbytes = nbytes
                new_node.is_terminal = True
                new_node.token_count = len(tok_tuple)
                new_node.last_accessed = time.time()
                curr.children[first_tok] = new_node
                self.total_nodes += 1
                self.total_entries += 1
                self.total_cached_tokens += len(tok_tuple)
                self.total_bytes += nbytes
                self._lru_order[tok_tuple] = new_node
                return

            child = curr.children[first_tok]
            # Match common prefix between child.tokens and tok_tuple[i:]
            cp_len = 0
            while (
                cp_len < len(child.tokens)
                and (i + cp_len) < len(tok_tuple)
                and child.tokens[cp_len] == tok_tuple[i + cp_len]
            ):
                cp_len += 1

            if cp_len == len(child.tokens):
                # Complete edge match; traverse down
                i += cp_len
                curr = child
                if i == len(tok_tuple):
                    # Exact match on this existing node: update terminal state
                    if not child.is_terminal:
                        self.total_entries += 1
                        self.total_cached_tokens += len(tok_tuple)
                    self.total_bytes -= child.nbytes
                    child.value = value
                    child.nbytes = nbytes
                    child.is_terminal = True
                    child.token_count = len(tok_tuple)
                    child.last_accessed = time.time()
                    self.total_bytes += nbytes
                    self._lru_order[tok_tuple] = child
                    self._lru_order.move_to_end(tok_tuple)
                    return
            else:
                # Partial match on child edge: split child into intermediate node
                split_node = RadixNode(child.tokens[:cp_len])
                split_node.token_count = curr.token_count + cp_len
                child.tokens = child.tokens[cp_len:]
                split_node.children[child.tokens[0]] = child

                rem_tokens = tok_tuple[i + cp_len :]
                if rem_tokens:
                    # New branch for incoming remainder
                    new_child = RadixNode(rem_tokens)
                    new_child.value = value
                    new_child.nbytes = nbytes
                    new_child.is_terminal = True
                    new_child.token_count = len(tok_tuple)
                    new_child.last_accessed = time.time()
                    split_node.children[rem_tokens[0]] = new_child
                    self.total_nodes += 2
                    self.total_entries += 1
                    self.total_cached_tokens += len(tok_tuple)
                    self.total_bytes += nbytes
                    self._lru_order[tok_tuple] = new_child
                else:
                    # The incoming sequence ends at the split point
                    split_node.value = value
                    split_node.nbytes = nbytes
                    split_node.is_terminal = True
                    split_node.last_accessed = time.time()
                    self.total_nodes += 1
                    self.total_entries += 1
                    self.total_cached_tokens += len(tok_tuple)
                    self.total_bytes += nbytes
                    self._lru_order[tok_tuple] = split_node

                curr.children[first_tok] = split_node
                return

    def search_prefix(
        self,
        tokens: list[int] | tuple[int, ...],
    ) -> tuple[RadixNode | None, int]:
        """Finds the deepest terminal node that forms a prefix of the given tokens."""
        tok_tuple = tuple(tokens)
        curr = self.root
        deepest_node: RadixNode | None = self.root if self.root.is_terminal else None
        deepest_len = 0
        i = 0

        while i < len(tok_tuple):
            first_tok = tok_tuple[i]
            if first_tok not in curr.children:
                break
            child = curr.children[first_tok]
            cp_len = 0
            while (
                cp_len < len(child.tokens)
                and (i + cp_len) < len(tok_tuple)
                and child.tokens[cp_len] == tok_tuple[i + cp_len]
            ):
                cp_len += 1

            if cp_len == len(child.tokens):
                i += cp_len
                curr = child
                if child.is_terminal and child.value is not None:
                    deepest_node = child
                    deepest_len = i
            else:
                break

        return deepest_node, deepest_len

    def evict_lru(self, target_bytes: int) -> int:
        """Evicts least recently used unpinned terminal nodes until target bytes are freed."""
        reclaimed = 0
        keys_to_evict = []

        for seq, node in list(self._lru_order.items()):
            if node.ref_count > 0:
                continue
            reclaimed += node.nbytes
            self.total_bytes -= node.nbytes
            self.total_entries = max(0, self.total_entries - 1)
            self.total_cached_tokens = max(0, self.total_cached_tokens - node.token_count)
            node.value = None
            node.is_terminal = False
            node.nbytes = 0
            keys_to_evict.append(seq)
            if reclaimed >= target_bytes:
                break

        for k in keys_to_evict:
            self._lru_order.pop(k, None)

        return reclaimed

    def clear(self) -> tuple[int, int]:
        """Clears all cached nodes, returning (cleared_entries, reclaimed_bytes)."""
        entries = self.total_entries
        reclaimed = self.total_bytes
        self.root = RadixNode()
        self.total_nodes = 0
        self.total_entries = 0
        self.total_cached_tokens = 0
        self.total_bytes = 0
        self._lru_order.clear()
        return entries, reclaimed

    def stats(self) -> dict[str, Any]:
        return {
            "model_id": self.model_id,
            "total_nodes": self.total_nodes,
            "total_entries": self.total_entries,
            "cached_tokens": self.total_cached_tokens,
            "memory_bytes": self.total_bytes,
        }


class PrefixCacheManager:
    """Thread-safe unified Radix Prefix KV-Cache Manager for Pantry.
    
    Coordinates zero-cost prompt reuse across multi-turn chats, dynamic DRAM ceilings,
    and LRU pruning.
    """

    _instance: PrefixCacheManager | None = None
    _lock = threading.RLock()

    def __init__(self, max_memory_bytes: int = DEFAULT_PREFIX_CACHE_MAX_BYTES) -> None:
        self.max_memory_bytes = max_memory_bytes
        self._trees: dict[str, RadixTree] = {}
        self.hits: int = 0
        self.misses: int = 0
        self.total_cached_tokens: int = 0
        self.saved_prefill_ms: float = 0.0

    @classmethod
    def get(cls) -> PrefixCacheManager:
        with cls._lock:
            if cls._instance is None:
                cls._instance = PrefixCacheManager()
            return cls._instance

    def _get_tree(self, model_key: str) -> RadixTree:
        if model_key not in self._trees:
            self._trees[model_key] = RadixTree(model_key)
        return self._trees[model_key]

    def lookup(
        self,
        model_key: str,
        tokens: list[int],
    ) -> tuple[Any | None, list[int], int]:
        """Queries the Radix tree for the longest reusable KV-cache prefix.
        
        Returns:
            (cached_kv_or_None, remaining_tokens_to_compute, cached_tokens_count)
        """
        if not tokens:
            return None, tokens, 0

        with self._lock:
            tree = self._get_tree(model_key)
            node, matched_len = tree.search_prefix(tokens)

            if node is None or matched_len == 0 or node.value is None:
                self.misses += 1
                return None, tokens, 0

            node.last_accessed = time.time()
            tree._lru_order.move_to_end(tuple(tokens[:matched_len]), last=True)

            cached_state = node.value
            cached_count = matched_len

            # In MLX generation, at least 1 token must be fed to compute logits.
            # If the entire prompt matched exactly, trim 1 token from KV-cache.
            if matched_len == len(tokens):
                if len(tokens) > 1:
                    cached_count = len(tokens) - 1
                    remaining = tokens[-1:]
                    # Check if MLX cache can be trimmed
                    try:
                        from mlx_lm.models.cache import can_trim_prompt_cache, trim_prompt_cache

                        kv_copy = copy.deepcopy(cached_state)
                        if (
                            isinstance(kv_copy, list)
                            and all(hasattr(c, "is_trimmable") for c in kv_copy)
                            and can_trim_prompt_cache(kv_copy)
                        ):
                            trim_prompt_cache(kv_copy, 1)
                            cached_state = kv_copy
                        else:
                            cached_state = kv_copy
                    except (ImportError, Exception):
                        cached_state = copy.deepcopy(cached_state)
                else:
                    # Single-token prompt: can't trim, execute full prefill
                    self.misses += 1
                    return None, tokens, 0
            else:
                remaining = tokens[matched_len:]
                try:
                    cached_state = copy.deepcopy(cached_state)
                except Exception:
                    pass

            self.hits += 1
            self.total_cached_tokens += cached_count
            return cached_state, remaining, cached_count

    def insert(
        self,
        model_key: str,
        tokens: list[int],
        kv_cache: Any,
        nbytes: int = 0,
    ) -> None:
        """Stores completed KV-cache state and trims LRU entries if memory pressure rises."""
        if not tokens or kv_cache is None:
            return

        with self._lock:
            # Check dynamic DRAM headroom before insertion (Patent Claim 7)
            avail_bytes = get_available_unified_dram()
            if avail_bytes < 1_000_000_000:  # Under 1 GB available
                self.prune(512 * 1024 * 1024)

            tree = self._get_tree(model_key)
            tree.insert(tokens, kv_cache, nbytes=nbytes)

            # Enforce cache memory budget
            total_bytes = sum(t.total_bytes for t in self._trees.values())
            if total_bytes > self.max_memory_bytes:
                self.prune(total_bytes - self.max_memory_bytes)

    def prune(self, target_bytes: int) -> int:
        """Evicts oldest entries across all models to reclaim target_bytes."""
        with self._lock:
            reclaimed = 0
            for tree in self._trees.values():
                reclaimed += tree.evict_lru(target_bytes - reclaimed)
                if reclaimed >= target_bytes:
                    break
            return reclaimed

    def clear(self, model_key: str | None = None) -> PrefixCacheClearResponse:
        """Clears prefix KV-cache for a specific model or all models."""
        with self._lock:
            cleared_entries = 0
            reclaimed_bytes = 0
            if model_key:
                if model_key in self._trees:
                    entries, freed = self._trees[model_key].clear()
                    cleared_entries += entries
                    reclaimed_bytes += freed
            else:
                for tree in self._trees.values():
                    entries, freed = tree.clear()
                    cleared_entries += entries
                    reclaimed_bytes += freed
                self._trees.clear()

            return PrefixCacheClearResponse(
                ok=True,
                cleared_entries=cleared_entries,
                reclaimed_bytes=reclaimed_bytes,
            )

    def stats(self, model_key: str | None = None) -> PrefixCacheStats:
        """Returns overall or model-specific prefix cache statistics."""
        with self._lock:
            total_nodes = 0
            total_entries = 0
            cached_tokens = 0
            memory_bytes = 0

            if model_key and model_key in self._trees:
                t = self._trees[model_key]
                total_nodes = t.total_nodes
                total_entries = t.total_entries
                cached_tokens = t.total_cached_tokens
                memory_bytes = t.total_bytes
            else:
                for t in self._trees.values():
                    total_nodes += t.total_nodes
                    total_entries += t.total_entries
                    cached_tokens += t.total_cached_tokens
                    memory_bytes += t.total_bytes

            total_reqs = self.hits + self.misses
            hit_rate = round((self.hits / max(1, total_reqs)) * 100.0, 1) if total_reqs > 0 else 0.0

            return PrefixCacheStats(
                total_nodes=total_nodes,
                total_entries=total_entries,
                cached_tokens=cached_tokens,
                memory_bytes=memory_bytes,
                hit_count=self.hits,
                miss_count=self.misses,
                hit_rate_percent=hit_rate,
            )

    def reset_metrics(self) -> None:
        """Resets telemetry hit/miss counters."""
        with self._lock:
            self.hits = 0
            self.misses = 0
            self.total_cached_tokens = 0
            self.saved_prefill_ms = 0.0
