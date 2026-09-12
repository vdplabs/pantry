from __future__ import annotations

import base64
import io
import json
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image
from typer.testing import CliRunner

from pantry.cli import app as cli_app
from pantry.schemas import ChatMessage
from pantry.vision import EchoVisionRuntime, parse_image_input, vision_runtime_for


def _create_sample_b64_image(width: int = 100, height: int = 60, color: str = "blue") -> str:
    img = Image.new("RGB", (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    raw = buf.getvalue()
    return f"data:image/png;base64,{base64.b64encode(raw).decode('utf-8')}"


def test_parse_image_input(tmp_path: Path) -> None:
    # 1. Base64 data URI
    b64_uri = _create_sample_b64_image(120, 80)
    info1 = parse_image_input(b64_uri)
    assert info1["format"] == "png"
    assert info1["width"] == 120
    assert info1["height"] == 80
    assert info1["size_bytes"] > 0

    # 2. Local file
    file_p = tmp_path / "test.jpg"
    img = Image.new("RGB", (64, 64), color="green")
    img.save(file_p, format="JPEG")
    info2 = parse_image_input(f"file://{file_p}")
    assert info2["format"] == "jpeg"
    assert info2["width"] == 64
    assert info2["height"] == 64


def test_chat_message_multimodal_extraction() -> None:
    b64_img = _create_sample_b64_image(50, 50)
    msg = ChatMessage(
        role="user",
        content=[
            {"type": "text", "text": "What is in this image?"},
            {"type": "image_url", "image_url": {"url": b64_img}},
        ],
    )
    assert msg.text() == "What is in this image?"
    assert len(msg.images()) == 1
    assert msg.images()[0] == b64_img


def test_echo_vision_runtime() -> None:
    import asyncio

    manifest_data = {
        "id": "vdplabs.demo-vision.compact.v1",
        "family": "demo-vision",
        "role": "vision",
        "quality_tier": "compact",
        "modalities": ["text", "vision"],
        "runtime": {"primary": "echo_vlm"},
    }
    from pantry.schemas import PackageManifest
    manifest = PackageManifest.model_validate(manifest_data)
    runtime = vision_runtime_for(manifest)
    assert isinstance(runtime, EchoVisionRuntime)

    b64_img = _create_sample_b64_image(200, 150)
    messages = [
        ChatMessage(
            role="user",
            content=[
                {"type": "text", "text": "Analyze the diagram"},
                {"type": "image_url", "image_url": {"url": b64_img}},
            ],
        )
    ]

    async def _run() -> None:
        usage: dict = {}
        out = await runtime.complete(manifest, messages, usage=usage)
        assert "Parsed 1 image(s)" in out
        assert "200x150" in out
        assert usage["total_tokens"] > 0

        # Structured response format on VLM
        rf = {"type": "json_object"}
        out_json = await runtime.complete(manifest, messages, response_format=rf)
        data = json.loads(out_json)
        assert data.get("images_parsed") == 1

    asyncio.run(_run())


def test_api_chat_completions_multimodal(client: TestClient) -> None:
    b64_img = _create_sample_b64_image(140, 90)

    # 1. Non-streaming multimodal completion
    res1 = client.post(
        "/v1/chat/completions",
        json={
            "model": "vision-standard",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Examine this chart"},
                        {"type": "image_url", "image_url": {"url": b64_img}},
                    ],
                }
            ],
        },
    )
    assert res1.status_code == 200
    d1 = res1.json()
    assert "choices" in d1
    reply = d1["choices"][0]["message"]["content"]
    assert "Parsed 1 image(s)" in reply
    assert "140x90" in reply

    # 2. Streaming multimodal completion
    res2 = client.post(
        "/v1/chat/completions",
        json={
            "model": "vision-standard",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Stream vision analysis"},
                        {"type": "image_url", "image_url": {"url": b64_img}},
                    ],
                }
            ],
            "stream": True,
        },
    )
    assert res2.status_code == 200
    lines = [line for line in res2.text.split("\n") if line.startswith("data: ")]
    assert len(lines) > 0


def test_cli_vision_command(tmp_path: Path) -> None:
    img_p = tmp_path / "cli_test.png"
    im = Image.new("RGB", (80, 80), color="purple")
    im.save(img_p)

    runner = CliRunner()
    res = runner.invoke(
        cli_app,
        ["vision", str(img_p), "What is shown here?", "--port", "59999"],
    )
    assert res.exit_code == 0
    assert "Parsed 1 image(s)" in res.output
    assert "80x80" in res.output
