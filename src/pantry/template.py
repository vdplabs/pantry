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
    has_sys = any(m.role in ("system", "developer") for m in msgs)

    if not has_sys:
        combined = (preamble + tools_prompt).strip()
        if combined:
            msgs = [ChatMessage(role="system", content=combined), *msgs]
    elif tools_prompt:
        # Append tools prompt to existing system message
        new_msgs: list[ChatMessage] = []
        appended = False
        for m in msgs:
            if m.role in ("system", "developer") and not appended:
                new_msgs.append(ChatMessage(role=m.role, content=m.text() + tools_prompt))
                appended = True
            else:
                new_msgs.append(m)
        msgs = new_msgs

    if family in {"chatml", "qwen", "chatml-v1"}:
        return _chatml(msgs)
    if family in {"llama3", "llama"}:
        return _llama3(msgs)
    return _chatml(msgs)


def _format_message_content(m: ChatMessage) -> str:
    content = m.text()
    if m.tool_calls:
        tc_blocks = []
        for tc in m.tool_calls:
            fn = tc.get("function", tc) if isinstance(tc, dict) else {}
            name = fn.get("name") or tc.get("name", "")
            raw_args = fn.get("arguments", tc.get("arguments", {}))
            if isinstance(raw_args, str):
                try:
                    parsed_args = json.loads(raw_args)
                except Exception:
                    parsed_args = raw_args
            else:
                parsed_args = raw_args
            tc_blocks.append(
                f"<tool_call>\n{json.dumps({'name': name, 'arguments': parsed_args})}\n</tool_call>"
            )
        tc_str = "\n".join(tc_blocks)
        if content:
            content = f"{content}\n{tc_str}"
        else:
            content = tc_str

    if m.role in ("tool", "function"):
        if not content.startswith("<tool_response>"):
            content = f"<tool_response>\n{content}\n</tool_response>"

    return content


def _chatml(messages: list[ChatMessage]) -> str:
    parts: list[str] = []
    for m in messages:
        role = "system" if m.role == "developer" else ("user" if m.role in ("tool", "function") else m.role)
        parts.append(f"<|im_start|>{role}\n{_format_message_content(m)}<|im_end|>")
    parts.append("<|im_start|>assistant\n")
    return "\n".join(parts)


def _llama3(messages: list[ChatMessage]) -> str:
    parts = ["<|begin_of_text|>"]
    for m in messages:
        role = "system" if m.role == "developer" else ("ipython" if m.role in ("tool", "function") else m.role)
        parts.append(
            f"<|start_header_id|>{role}<|end_header_id|>\n\n{_format_message_content(m)}<|eot_id|>"
        )
    parts.append("<|start_header_id|>assistant<|end_header_id|>\n\n")
    return "".join(parts)


def strip_stop_tokens(text: str, manifest: PackageManifest, extra_stops: list[str] | None = None) -> str:
    from pantry.stop import stop_strings, strip_at_stop

    stops = stop_strings(manifest)
    if extra_stops:
        for s in extra_stops:
            if s and s not in stops:
                stops.append(s)
    return strip_at_stop(text, stops)
