from __future__ import annotations

"""Audio transcription (Speech-to-Text) runtimes for Apple Silicon and mock testing."""

import datetime
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from pantry.schemas import PackageManifest
from pantry.store import PackageStore


def _format_timestamp_vtt(seconds: float) -> str:
    td = datetime.timedelta(seconds=max(0.0, seconds))
    total_seconds = int(td.total_seconds())
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    millis = int(td.microseconds / 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def _format_timestamp_srt(seconds: float) -> str:
    td = datetime.timedelta(seconds=max(0.0, seconds))
    total_seconds = int(td.total_seconds())
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    millis = int(td.microseconds / 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def format_vtt(segments: list[dict[str, Any]]) -> str:
    """Format segments into WebVTT (.vtt) caption format."""
    lines = ["WEBVTT", ""]
    for seg in segments:
        start_str = _format_timestamp_vtt(seg.get("start", 0.0))
        end_str = _format_timestamp_vtt(seg.get("end", 0.0))
        text = str(seg.get("text", "")).strip()
        lines.append(f"{start_str} --> {end_str}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)


def format_srt(segments: list[dict[str, Any]]) -> str:
    """Format segments into SubRip (.srt) subtitle format."""
    lines = []
    for idx, seg in enumerate(segments, start=1):
        start_str = _format_timestamp_srt(seg.get("start", 0.0))
        end_str = _format_timestamp_srt(seg.get("end", 0.0))
        text = str(seg.get("text", "")).strip()
        lines.append(str(idx))
        lines.append(f"{start_str} --> {end_str}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)


class AudioTranscriptionRuntime(ABC):
    @abstractmethod
    def transcribe(
        self,
        manifest: PackageManifest,
        *,
        audio_path: str | Path,
        language: str | None = None,
        prompt: str | None = None,
        temperature: float | None = None,
        word_timestamps: bool = False,
        original_filename: str | None = None,
    ) -> dict[str, Any]:
        """Transcribe an audio file into text and segment timestamps."""
        raise NotImplementedError


class EchoAudioTranscriptionRuntime(AudioTranscriptionRuntime):
    """Deterministic offline STT backend for fast smoke tests and CI without MLX."""

    def __init__(self, store: PackageStore | None = None) -> None:
        self.store = store

    def transcribe(
        self,
        manifest: PackageManifest,
        *,
        audio_path: str | Path,
        language: str | None = None,
        prompt: str | None = None,
        temperature: float | None = None,
        word_timestamps: bool = False,
        original_filename: str | None = None,
    ) -> dict[str, Any]:
        path = Path(audio_path)
        if not path.exists():
            raise FileNotFoundError(f"audio file not found: {audio_path}")

        name = original_filename or path.name
        text = f"[pantry echo_stt · {manifest.id}] Transcribed audio from {name}."
        words: list[dict[str, Any]] = [
            {"word": "Transcribed", "start": 0.0, "end": 0.5},
            {"word": "audio", "start": 0.5, "end": 1.0},
            {"word": "from", "start": 1.0, "end": 1.3},
            {"word": f"{name}.", "start": 1.3, "end": 2.0},
        ]
        segment = {
            "id": 0,
            "seek": 0,
            "start": 0.0,
            "end": 2.0,
            "text": text,
            "tokens": [50364, 1234, 50464],
            "temperature": temperature or 0.0,
            "avg_logprob": -0.2,
            "compression_ratio": 1.1,
            "no_speech_prob": 0.01,
            "words": words if word_timestamps else None,
        }
        return {
            "task": "transcribe",
            "language": language or "english",
            "duration": 2.0,
            "text": text,
            "words": words if word_timestamps else None,
            "segments": [segment],
        }


class MLXWhisperRuntime(AudioTranscriptionRuntime):
    """Real on-device Whisper STT backend powered by mlx-whisper on Apple Silicon."""

    def __init__(self, store: PackageStore | None = None) -> None:
        self.store = store

    def transcribe(
        self,
        manifest: PackageManifest,
        *,
        audio_path: str | Path,
        language: str | None = None,
        prompt: str | None = None,
        temperature: float | None = None,
        word_timestamps: bool = False,
        original_filename: str | None = None,
    ) -> dict[str, Any]:
        try:
            import mlx_whisper
        except ImportError as exc:
            raise RuntimeError(
                "mlx-whisper is required for local speech-to-text. "
                "Install it with: pip install mlx-whisper"
            ) from exc

        path = Path(audio_path)
        if not path.exists():
            raise FileNotFoundError(f"audio file not found: {audio_path}")

        # Choose model path: local pulled weights dir if ready, or HF repo
        model_target: str = "mlx-community/whisper-tiny"
        if self.store and self.store.weights_ready(manifest):
            weights_dir = self.store.weights_dir(manifest.id)
            if weights_dir.is_dir():
                model_target = str(weights_dir)
        elif manifest.runtime.hf_repo:
            model_target = manifest.runtime.hf_repo

        kwargs: dict[str, Any] = {
            "path_or_hf_repo": model_target,
            "word_timestamps": word_timestamps,
        }
        if language:
            kwargs["language"] = language
        if temperature is not None:
            kwargs["temperature"] = temperature
        if prompt:
            kwargs["initial_prompt"] = prompt

        result = mlx_whisper.transcribe(str(path), **kwargs)

        text = result.get("text", "").strip()
        segments = result.get("segments", [])
        lang = result.get("language") or language or "english"

        # Calculate duration from segments if available
        duration = 0.0
        if segments:
            duration = float(segments[-1].get("end", 0.0))

        return {
            "task": "transcribe",
            "language": lang,
            "duration": duration,
            "text": text,
            "segments": segments,
        }


def audio_transcription_runtime_for(
    manifest: PackageManifest, store: PackageStore
) -> AudioTranscriptionRuntime:
    primary = (manifest.runtime.primary or "").lower()
    if primary in {"echo_stt", "echo-stt", "echo", "echo_audio"}:
        return EchoAudioTranscriptionRuntime(store)
    if primary in {"mlx_whisper", "mlx-whisper", "whisper", "mlx"}:
        return MLXWhisperRuntime(store)
    raise RuntimeError(
        f"audio transcription runtime {manifest.runtime.primary!r} is not implemented yet "
        f"(package {manifest.id})"
    )
