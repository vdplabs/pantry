from __future__ import annotations

from pantry.schemas import ChatMessage, PackageManifest


def apply_chat_template(manifest: PackageManifest, messages: list[ChatMessage]) -> str:
    """Host-owned templating so capability resolve cannot strand clients on raw tokens."""
    family = (manifest.template_family or "chatml").lower()
    preamble = manifest.system_preamble.strip()
    msgs = list(messages)
    if preamble and not any(m.role == "system" for m in msgs):
        msgs = [ChatMessage(role="system", content=preamble), *msgs]

    if family in {"chatml", "qwen", "chatml-v1"}:
        return _chatml(msgs)
    if family in {"llama3", "llama"}:
        return _llama3(msgs)
    return _chatml(msgs)


def _chatml(messages: list[ChatMessage]) -> str:
    parts: list[str] = []
    for m in messages:
        parts.append(f"<|im_start|>{m.role}\n{m.text()}<|im_end|>")
    parts.append("<|im_start|>assistant\n")
    return "\n".join(parts)


def _llama3(messages: list[ChatMessage]) -> str:
    parts = ["<|begin_of_text|>"]
    for m in messages:
        parts.append(
            f"<|start_header_id|>{m.role}<|end_header_id|>\n\n{m.text()}<|eot_id|>"
        )
    parts.append("<|start_header_id|>assistant<|end_header_id|>\n\n")
    return "".join(parts)


def strip_stop_tokens(text: str, manifest: PackageManifest) -> str:
    from pantry.stop import stop_strings, strip_at_stop

    return strip_at_stop(text, stop_strings(manifest))
