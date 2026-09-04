from __future__ import annotations

import io
from unittest.mock import MagicMock, patch

import pytest
from typer.testing import CliRunner

from pantry.audio_runtime import (
    EchoAudioTranscriptionRuntime,
    MLXWhisperRuntime,
    audio_transcription_runtime_for,
    format_srt,
    format_vtt,
)
from pantry.cli import app
from pantry.schemas import PackageManifest


def _dummy_wav_bytes() -> bytes:
    """Minimal valid RIFF WAV header + 8 bytes of audio data."""
    return (
        b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00"
        b"\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x08\x00\x00\x00"
        b"\x00\x00\x00\x00\x00\x00\x00\x00"
    )


def test_models_includes_stt(client):
    r = client.get("/v1/models")
    assert r.status_code == 200
    rows = {m["id"]: m for m in r.json()["data"]}
    assert "transcribe-compact" not in rows  # Demo hidden by default

    r_demos = client.get("/v1/models", params={"demos": "true"})
    assert r_demos.status_code == 200
    rows_demos = {m["id"]: m for m in r_demos.json()["data"]}
    assert "transcribe-compact" in rows_demos or "whisper-demo" in rows_demos
    match = rows_demos.get("transcribe-compact") or rows_demos.get("whisper-demo")
    assert "stt" in match["modalities"]


def test_resolve_stt_http(client):
    r = client.post("/v1/resolve", json={"modality": "stt"})
    assert r.status_code == 200
    body = r.json()
    assert "whisper" in body["package_id"] or "transcribe" in body["package_id"]


def test_audio_transcriptions_json(client):
    audio_file = io.BytesIO(_dummy_wav_bytes())
    r = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("test.wav", audio_file, "audio/wav")},
        data={"model": "transcribe-compact", "response_format": "json"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "text" in body
    assert "Transcribed audio from test.wav" in body["text"]


def test_audio_transcriptions_whisper1_alias_unpulled(client):
    audio_file = io.BytesIO(_dummy_wav_bytes())
    r = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("meeting.wav", audio_file, "audio/wav")},
        data={"model": "whisper-1", "response_format": "json"},
    )
    assert r.status_code == 409
    assert "weights not pulled for vdplabs.whisper-tiny.compact.v1" in r.text


def test_audio_transcriptions_whisper_demo_alias(client):
    audio_file = io.BytesIO(_dummy_wav_bytes())
    r = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("meeting.wav", audio_file, "audio/wav")},
        data={"model": "whisper-demo", "response_format": "json"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "Transcribed audio from meeting.wav" in body["text"]


def test_audio_transcriptions_verbose_json(client):
    audio_file = io.BytesIO(_dummy_wav_bytes())
    r = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("voice.wav", audio_file, "audio/wav")},
        data={
            "model": "transcribe-compact",
            "response_format": "verbose_json",
            "timestamp_granularities[]": ["word"],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["task"] == "transcribe"
    assert body["duration"] > 0
    assert "segments" in body
    assert len(body["segments"]) >= 1
    assert "words" in body["segments"][0]


def test_audio_transcriptions_text_format(client):
    audio_file = io.BytesIO(_dummy_wav_bytes())
    r = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("voice.wav", audio_file, "audio/wav")},
        data={"model": "transcribe-compact", "response_format": "text"},
    )
    assert r.status_code == 200, r.text
    assert "Transcribed audio from voice.wav" in r.text


def test_audio_transcriptions_vtt_and_srt(client):
    # Test VTT
    audio_file = io.BytesIO(_dummy_wav_bytes())
    r = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("voice.wav", audio_file, "audio/wav")},
        data={"model": "transcribe-compact", "response_format": "vtt"},
    )
    assert r.status_code == 200, r.text
    assert "WEBVTT" in r.text
    assert "-->" in r.text

    # Test SRT
    audio_file_srt = io.BytesIO(_dummy_wav_bytes())
    r_srt = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("voice.wav", audio_file_srt, "audio/wav")},
        data={"model": "transcribe-compact", "response_format": "srt"},
    )
    assert r_srt.status_code == 200, r_srt.text
    assert "1" in r_srt.text
    assert "-->" in r_srt.text


def test_audio_transcriptions_rejects_chat_model(client):
    audio_file = io.BytesIO(_dummy_wav_bytes())
    r = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("test.wav", audio_file, "audio/wav")},
        data={"model": "demo-compact"},
    )
    assert r.status_code == 400
    assert "not a speech-to-text model" in r.text


def test_format_vtt_and_srt_helpers():
    segments = [
        {"start": 0.0, "end": 2.5, "text": "Hello world."},
        {"start": 2.5, "end": 5.0, "text": "Welcome to Pantry."},
    ]
    vtt = format_vtt(segments)
    assert vtt.startswith("WEBVTT")
    assert "00:00:00.000 --> 00:00:02.500" in vtt
    assert "Hello world." in vtt

    srt = format_srt(segments)
    assert "1\n00:00:00,000 --> 00:00:02,500\nHello world." in srt
    assert "2\n00:00:02,500 --> 00:00:05,000\nWelcome to Pantry." in srt


def test_audio_runtime_for_routing(tmp_path):
    echo_man = PackageManifest(
        id="test-echo-stt",
        family="whisper",
        modalities=["stt"],
        runtime={"primary": "echo_stt"},
    )
    whisper_man = PackageManifest(
        id="test-whisper",
        family="whisper",
        modalities=["stt"],
        runtime={"primary": "mlx_whisper"},
    )
    bad_man = PackageManifest(
        id="test-bad",
        family="whisper",
        modalities=["stt"],
        runtime={"primary": "unsupported"},
    )

    rt_echo = audio_transcription_runtime_for(echo_man, None)
    assert isinstance(rt_echo, EchoAudioTranscriptionRuntime)

    rt_whisper = audio_transcription_runtime_for(whisper_man, None)
    assert isinstance(rt_whisper, MLXWhisperRuntime)

    with pytest.raises(RuntimeError, match="not implemented yet"):
        audio_transcription_runtime_for(bad_man, None)


def test_mlx_whisper_runtime_mocked(tmp_path):
    wav = tmp_path / "sample.wav"
    wav.write_bytes(_dummy_wav_bytes())

    whisper_man = PackageManifest(
        id="test-whisper",
        family="whisper",
        modalities=["stt"],
        runtime={"primary": "mlx_whisper", "hf_repo": "mlx-community/whisper-tiny"},
    )

    rt = MLXWhisperRuntime()
    mock_mlx = MagicMock()
    mock_mlx.transcribe.return_value = {
        "text": "Testing MLX whisper mocked transcription.",
        "language": "en",
        "segments": [{"start": 0.0, "end": 1.5, "text": "Testing MLX whisper mocked transcription."}],
    }

    with patch.dict("sys.modules", {"mlx_whisper": mock_mlx}):
        res = rt.transcribe(whisper_man, audio_path=wav)
        assert res["text"] == "Testing MLX whisper mocked transcription."
        assert res["duration"] == 1.5
        mock_mlx.transcribe.assert_called_once()


def test_cli_transcribe_local(tmp_path):
    from pantry.config import bundled_catalog_dir
    from pantry.store import PackageStore

    home = tmp_path / "pantry-home"
    store = PackageStore(home)
    store.ensure()
    store.seed_from_catalog(bundled_catalog_dir())

    wav = tmp_path / "clip.wav"
    wav.write_bytes(_dummy_wav_bytes())

    runner = CliRunner()
    res = runner.invoke(
        app,
        [
            "transcribe",
            str(wav),
            "--model",
            "transcribe-compact",
            "--home",
            str(home),
            "--format",
            "text",
        ],
    )
    assert res.exit_code == 0
    assert "Transcribed audio from clip.wav" in res.stdout
