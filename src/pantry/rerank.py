from __future__ import annotations

"""Semantic Cross-Encoder Reranking Runtimes (Deterministic Echo scaffold + MLX / PyTorch)."""

import math
import re
from abc import ABC, abstractmethod
from typing import Any

from pantry.schemas import PackageManifest
from pantry.store import PackageStore


def _tokenize(text: str) -> list[str]:
    return [w for w in re.findall(r"\w+", text.lower()) if len(w) > 1]


class RerankRuntime(ABC):
    @abstractmethod
    def rank(
        self,
        manifest: PackageManifest,
        query: str,
        documents: list[str],
    ) -> tuple[list[tuple[int, float]], dict[str, int]]:
        """Ranks documents against a query.

        Returns:
            A tuple of (sorted_results, usage_dict) where sorted_results is a list
            of (original_index, relevance_score) sorted in descending order of relevance.
        """
        raise NotImplementedError


class EchoRerankRuntime(RerankRuntime):
    """Deterministic semantic cross-encoder scorer for smoke testing and offline verification."""

    def __init__(self, store: PackageStore | None = None) -> None:
        self.store = store

    def _score_pair(self, query: str, doc: str) -> float:
        q_clean = query.strip().lower()
        d_clean = doc.strip().lower()

        if not q_clean or not d_clean:
            return 0.0

        # Exact substring match bonus
        exact_bonus = 0.4 if q_clean in d_clean else 0.0

        q_tokens = _tokenize(query)
        d_tokens = _tokenize(doc)

        if not q_tokens or not d_tokens:
            return round(exact_bonus, 4)

        q_set = set(q_tokens)
        d_set = set(d_tokens)

        # 1. Jaccard token overlap
        intersection = q_set & d_set
        union = q_set | d_set
        jaccard = len(intersection) / max(1, len(union))

        # 2. Query recall (what fraction of query terms appear in document)
        recall = len(intersection) / len(q_set)

        # 3. Position weighting (earlier appearances score higher)
        pos_scores: list[float] = []
        for term in q_set:
            if term in d_tokens:
                idx = d_tokens.index(term)
                # Decay factor based on token index
                pos_scores.append(1.0 / (1.0 + math.log1p(idx)))
            else:
                pos_scores.append(0.0)
        avg_pos = sum(pos_scores) / len(pos_scores) if pos_scores else 0.0

        raw_score = (0.35 * recall) + (0.25 * jaccard) + (0.2 * avg_pos) + exact_bonus

        # Map to logistic sigmoid between 0.01 and 0.99
        score = 1.0 / (1.0 + math.exp(-4.0 * (raw_score - 0.4)))
        return round(float(min(0.9999, max(0.0001, score))), 4)

    def rank(
        self,
        manifest: PackageManifest,
        query: str,
        documents: list[str],
    ) -> tuple[list[tuple[int, float]], dict[str, int]]:
        scored: list[tuple[int, float]] = []
        q_tokens_cnt = max(1, len(query.split()))
        d_tokens_cnt = 0

        for i, doc in enumerate(documents):
            score = self._score_pair(query, doc)
            scored.append((i, score))
            d_tokens_cnt += max(1, len(doc.split()))

        # Sort descending by relevance score
        scored.sort(key=lambda x: x[1], reverse=True)

        total_tokens = q_tokens_cnt * len(documents) + d_tokens_cnt
        usage = {
            "input_tokens": total_tokens,
            "output_tokens": 0,
            "total_tokens": total_tokens,
        }
        return scored, usage


class MLXRerankRuntime(RerankRuntime):
    """MLX-based Cross-Encoder Reranking Runtime."""

    def __init__(self, store: PackageStore | None = None) -> None:
        self.store = store
        self._models: dict[str, tuple[object, object]] = {}

    def rank(
        self,
        manifest: PackageManifest,
        query: str,
        documents: list[str],
    ) -> tuple[list[tuple[int, float]], dict[str, int]]:
        try:
            import mlx.core as mx  # type: ignore
            from mlx_lm import load  # type: ignore
        except ImportError:
            # Fallback to EchoRerankRuntime if MLX not available
            return EchoRerankRuntime(self.store).rank(manifest, query, documents)

        weights_path = (
            str(self.store.weights_dir(manifest.id))
            if self.store
            else (manifest.runtime.hf_repo or "")
        )
        if not weights_path:
            return EchoRerankRuntime(self.store).rank(manifest, query, documents)

        if weights_path not in self._models:
            model, tokenizer = load(weights_path)
            self._models[weights_path] = (model, tokenizer)
        else:
            model, tokenizer = self._models[weights_path]

        scored: list[tuple[int, float]] = []
        total_tokens = 0

        for i, doc in enumerate(documents):
            prompt = f"Query: {query}\nDocument: {doc}\nRelevance:"
            tokens = tokenizer.encode(prompt)
            total_tokens += len(tokens)
            tok_arr = mx.array([tokens])
            logits = model(tok_arr)
            # Classification logit sigmoid
            val = float(logits[0, -1, 0].item()) if hasattr(logits, "shape") else 0.5
            prob = round(1.0 / (1.0 + math.exp(-val)), 4)
            scored.append((i, prob))

        scored.sort(key=lambda x: x[1], reverse=True)
        usage = {
            "input_tokens": total_tokens,
            "output_tokens": 0,
            "total_tokens": total_tokens,
        }
        return scored, usage


class TransformersRerankRuntime(RerankRuntime):
    """PyTorch / Hugging Face Transformers Cross-Encoder Reranking Runtime."""

    def __init__(self, store: PackageStore | None = None) -> None:
        self.store = store
        self._models: dict[str, tuple[object, object]] = {}

    def rank(
        self,
        manifest: PackageManifest,
        query: str,
        documents: list[str],
    ) -> tuple[list[tuple[int, float]], dict[str, int]]:
        try:
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer  # type: ignore
        except ImportError:
            return EchoRerankRuntime(self.store).rank(manifest, query, documents)

        model_ref = (
            str(self.store.weights_dir(manifest.id))
            if self.store
            else (manifest.runtime.hf_repo or "")
        )
        if not model_ref:
            return EchoRerankRuntime(self.store).rank(manifest, query, documents)

        if model_ref not in self._models:
            device = "cuda" if torch.cuda.is_available() else "cpu"
            tokenizer = AutoTokenizer.from_pretrained(model_ref)
            model = AutoModelForSequenceClassification.from_pretrained(model_ref).to(device)
            model.eval()
            self._models[model_ref] = (model, tokenizer)
        else:
            model, tokenizer = self._models[model_ref]

        device = next(model.parameters()).device
        pairs = [[query, doc] for doc in documents]
        inputs = tokenizer(pairs, padding=True, truncation=True, return_tensors="pt").to(device)

        with torch.no_grad():
            outputs = model(**inputs)
            logits = outputs.logits
            if logits.shape[1] == 1:
                scores = torch.sigmoid(logits.squeeze(-1)).cpu().tolist()
            else:
                scores = torch.softmax(logits, dim=-1)[:, 1].cpu().tolist()

        total_tokens = int(inputs["input_ids"].numel())
        scored = [(i, round(float(s), 4)) for i, s in enumerate(scores)]
        scored.sort(key=lambda x: x[1], reverse=True)

        usage = {
            "input_tokens": total_tokens,
            "output_tokens": 0,
            "total_tokens": total_tokens,
        }
        return scored, usage


def rerank_runtime_for(manifest: PackageManifest, store: PackageStore | None = None) -> RerankRuntime:
    primary = (manifest.runtime.primary or "echo_rerank").lower()
    if primary in {"echo", "echo_rerank", "echo-rerank"}:
        return EchoRerankRuntime(store)
    if primary in {"mlx", "mlx_lm", "mlx-lm"}:
        return MLXRerankRuntime(store)
    if primary in {"cuda", "transformers", "pytorch"}:
        return TransformersRerankRuntime(store)
    return EchoRerankRuntime(store)
