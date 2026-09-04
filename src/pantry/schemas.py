from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class QualityTier(str, Enum):
    standard = "standard"
    compact = "compact"
    extreme = "extreme"


class LatencyClass(str, Enum):
    balanced = "balanced"
    fast = "fast"


class BlobRef(BaseModel):
    path: str
    sha256: str
    size: int = 0


class EvalInfo(BaseModel):
    suite_id: str = ""
    score: float | None = None
    notes: str = ""


class RuntimeInfo(BaseModel):
    primary: str = "echo"  # echo | mlx | llama_cpp | bitnet
    adapters: list[str] = Field(default_factory=list)
    draft_package_id: str | None = None
    ane_prefill: bool = False
    mlc_artifact: str | None = None
    # Hugging Face repo for `pantry pull` (MLX safetensors trees).
    hf_repo: str | None = None
    hf_revision: str | None = None


class PackageManifest(BaseModel):
    id: str
    family: str
    role: str = "chat"
    params_b: float = 0
    quality_tier: QualityTier = QualityTier.standard
    quant_method: str = "none"
    bits_approx: float | None = None
    ram_gb_min: float = 1
    ram_gb_comfortable: float = 2
    modalities: list[str] = Field(default_factory=lambda: ["text"])
    context_max: int = 4096
    license: str = "unknown"
    chat_template_id: str = "chatml-v1"
    template_family: str = "chatml"
    tool_protocol: str | None = None
    aliases: list[str] = Field(default_factory=list)
    runtime: RuntimeInfo = Field(default_factory=RuntimeInfo)
    eval: EvalInfo = Field(default_factory=EvalInfo)
    blobs: list[BlobRef] = Field(default_factory=list)
    # Demo / echo packages may embed a short system preamble applied by the host.
    system_preamble: str = ""
    # When false, omitted from GET /v1/models unless demos=1 (still usable by id).
    listable: bool = True

    @field_validator("id")
    @classmethod
    def id_nonempty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("package id required")
        return v.strip()


class CapabilityRequest(BaseModel):
    modality: str = "chat"
    ram_gb_max: float | None = None
    context_min: int | None = None
    quality_tier: QualityTier | None = None
    latency_class: LatencyClass = LatencyClass.balanced
    family_prefer: str | None = None
    license_allow: list[str] | None = None
    template_family: str | None = None
    tool_protocol: str | None = None
    prefer_speculative: bool = False
    # When set, resolve will not cross this family.
    pin_family: str | None = None


class ResolveResult(BaseModel):
    package_id: str
    alias: str | None = None
    reason: str = ""
    plan: dict[str, Any] = Field(default_factory=dict)


class ChatMessage(BaseModel):
    role: str
    # OpenAI clients may send null (tool turns) or content-part arrays.
    content: str | list[Any] | None = ""
    name: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None

    def text(self) -> str:
        return normalize_message_content(self.content)


def normalize_message_content(content: str | list[Any] | None) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and "text" in part:
                parts.append(str(part.get("text") or ""))
        return "".join(parts)
    return str(content)


class CompleteRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    stream: bool = False
    temperature: float | None = None
    max_tokens: int | None = None
    # Newer OpenAI SDKs prefer this name; merged into max_tokens when unset.
    max_completion_tokens: int | None = None
    priority: str = "interactive"  # interactive | batch
    # When true (or model alias chat-fast), use draft_package_id if weights are ready.
    prefer_speculative: bool = False
    tools: list[dict[str, Any]] | None = None
    tool_choice: str | dict[str, Any] | None = None

    def effective_max_tokens(self) -> int | None:
        if self.max_tokens is not None:
            return self.max_tokens
        return self.max_completion_tokens


class PullBody(BaseModel):
    package_id: str = Field(..., min_length=1)


class LoadBody(BaseModel):
    package_id: str = Field(..., min_length=1)
    pin: bool = False


class UnloadBody(BaseModel):
    package_id: str | None = None


class ImageGenerateRequest(BaseModel):
    model: str
    prompt: str = Field(..., min_length=1)
    n: int = Field(default=1, ge=1, le=4)
    size: str | None = "256x256"
    response_format: str = "b64_json"  # b64_json | url
    priority: str = "interactive"


class AudioGenerateRequest(BaseModel):
    model: str
    prompt: str = Field(..., min_length=1)
    duration_seconds: float = Field(default=2.0, ge=0.25, le=30.0)
    response_format: str = "b64_json"  # b64_json | url
    priority: str = "interactive"


class EmbeddingRequest(BaseModel):
    model: str
    input: str | list[str]
    encoding_format: str = "float"
    user: str | None = None
    priority: str = "interactive"


class EmbeddingData(BaseModel):
    object: str = "embedding"
    index: int
    embedding: list[float]


class EmbeddingResponse(BaseModel):
    object: str = "list"
    data: list[EmbeddingData]
    model: str
    usage: dict[str, int]


class TranscriptionResponse(BaseModel):
    text: str


class TranscriptionWord(BaseModel):
    word: str
    start: float
    end: float


class TranscriptionSegment(BaseModel):
    id: int = 0
    seek: int = 0
    start: float = 0.0
    end: float = 0.0
    text: str
    tokens: list[int] = Field(default_factory=list)
    temperature: float = 0.0
    avg_logprob: float = 0.0
    compression_ratio: float = 0.0
    no_speech_prob: float = 0.0
    words: list[TranscriptionWord] | None = None


class TranscriptionVerboseResponse(BaseModel):
    task: str = "transcribe"
    language: str = "english"
    duration: float = 0.0
    text: str
    words: list[TranscriptionWord] | None = None
    segments: list[TranscriptionSegment] = Field(default_factory=list)

