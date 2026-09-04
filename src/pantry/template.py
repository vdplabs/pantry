from __future__ import annotations

import json

from pantry.schemas import ChatMessage, PackageManifest


def _format_tools_prompt(tools: list[dict]) -> str:
    return (
        "\n\n# Tools\n"
        "You may call one or more functions to assist with the user query.\n"
        "You are provided with function signatures within <tools></tools> XML tags:\n"
        "<tools>\n"
        f"{json.dumps(tools, indent=2)}\n"
        "</tools>\n\n"
        "For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:\n"
        "<tool_call>\n"
        '{"name": "<function-name>", "arguments": <args-dict>}\n'
        "</tool_call>"
    )


def apply_chat_template(
    manifest: PackageManifest,
    messages: list[ChatMessage],
    tools: list[dict] | None = None,
) -> str:
    """Host-owned templating so capability resolve cannot strand clients on raw tokens."""
    family = (manifest.template_family or "chatml").lower()
    preamble = manifest.system_preamble.strip()
    tools_prompt = _format_tools_prompt(tools) if tools else ""

    msgs = list(messages)
    has_sys = any(m.role == "system" for m in msgs)

    if not has_sys:
        combined = (preamble + tools_prompt).strip()
        if combined:
            msgs = [ChatMessage(role="system", content=combined), *msgs]
    elif tools_prompt:
        # Append tools prompt to existing system message
        new_msgs: list[ChatMessage] = []
        appended = False
        for m in msgs:
            if m.role == "system" and not appended:
                new_msgs.append(ChatMessage(role="system", content=m.text() + tools_prompt))
                appended = True
            else:
                new_msgs.append(m)
        msgs = new_msgs

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
