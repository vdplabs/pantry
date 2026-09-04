from __future__ import annotations

"""Embeddings generation runtimes (deterministic Echo scaffold + MLX)."""

import hashlib
import math
from abc import ABC, abstractmethod

from pantry.schemas import PackageManifest
from pantry.store import PackageStore


class EmbedRuntime(ABC):
    @abstractmethod
    def embed(
        self,
        manifest: PackageManifest,
        texts: list[str],
    ) -> tuple[list[list[float]], dict[str, int]]:
        raise NotImplementedError


class EchoEmbedRuntime(EmbedRuntime):
    """Deterministic embedding vector generator for smoke tests and offline development."""

    def __init__(self, store: PackageStore | None = None, dim: int = 384) -> None:
        self.store = store
        self.dim = dim

    def _vector_for_text(self, text: str) -> list[float]:
        # Generate pseudo-random deterministic floats from sha256 chunks
        vec: list[float] = []
        seed = text.encode("utf-8")
        counter = 0
        while len(vec) < self.dim:
            h = hashlib.sha256(seed + counter.to_bytes(4, "little")).digest()
            for i in range(0, len(h) - 3, 4):
                val = int.from_bytes(h[i : i + 4], "little", signed=True) / 2147483648.0
                vec.append(val)
                if len(vec) >= self.dim:
                    break
            counter += 1

        # L2 normalize
        norm = math.sqrt(sum(x * x for x in vec)) or 1.0
        return [round(x / norm, 6) for x in vec]

    def embed(
        self,
        manifest: PackageManifest,
        texts: list[str],
    ) -> tuple[list[list[float]], dict[str, int]]:
        embeddings: list[list[float]] = []
        total_tokens = 0
        for t in texts:
            embeddings.append(self._vector_for_text(t))
            total_tokens += max(1, len(t.split()))

        usage = {
            "prompt_tokens": total_tokens,
            "total_tokens": total_tokens,
        }
        return embeddings, usage


class MLXEmbedRuntime(EmbedRuntime):
    """MLX embedding runtime. Deferred imports for environments without [mlx]."""

    def __init__(self, store: PackageStore | None = None) -> None:
        self.store = store
        self._models: dict[str, tuple[object, object]] = {}

    def embed(
        self,
        manifest: PackageManifest,
        texts: list[str],
    ) -> tuple[list[list[float]], dict[str, int]]:
        try:
            import mlx.core as mx  # type: ignore
            from mlx_lm import load  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "MLX embed runtime requested but mlx / mlx-lm is not installed. "
                "pip install 'pantry[mlx]' then retry."
            ) from e

        weights_path = (
            str(self.store.weights_dir(manifest.id))
            if self.store
            else (manifest.runtime.hf_repo or "")
        )
        if weights_path not in self._models:
            model, tokenizer = load(weights_path)
            self._models[weights_path] = (model, tokenizer)
        else:
            model, tokenizer = self._models[weights_path]

        embeddings: list[list[float]] = []
        total_tokens = 0

        for t in texts:
            tokens = tokenizer.encode(t)
            total_tokens += len(tokens)
            # Forward pass to obtain hidden states and mean pooling
            tok_arr = mx.array([tokens])
            if hasattr(model, "model") and hasattr(model.model, "embed_tokens"):
                hidden = model.model(tok_arr)
            else:
                hidden = model(tok_arr)

            # Mean pool over sequence length
            if hasattr(hidden, "last_hidden_state"):
                h = hidden.last_hidden_state
            else:
                h = hidden
            pooled = mx.mean(h, axis=1)
            # L2 normalize
            norm = mx.linalg.norm(pooled, axis=-1, keepdims=True)
            normed = (pooled / (norm + 1e-9)).tolist()[0]
            embeddings.append([round(float(x), 6) for x in normed])

        usage = {
            "prompt_tokens": total_tokens,
            "total_tokens": total_tokens,
        }
        return embeddings, usage


def embed_runtime_for(manifest: PackageManifest, store: PackageStore | None = None) -> EmbedRuntime:
    primary = (manifest.runtime.primary or "echo_embed").lower()
    if primary in {"echo", "echo_embed", "echo-embed"}:
        return EchoEmbedRuntime(store)
    if primary in {"mlx", "mlx_lm", "mlx-lm"}:
        return MLXEmbedRuntime(store)
    return EchoEmbedRuntime(store)
