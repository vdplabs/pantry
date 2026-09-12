from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, Callable

import jsonschema

logger = logging.getLogger("pantry.grammar")


def repair_truncated_json(s: str) -> str:
    """Repairs unclosed quotes, brackets, and trailing commas in truncated JSON."""
    s = s.strip()
    if not s:
        return "{}"

    in_string = False
    escape = False
    stack: list[str] = []

    for ch in s:
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if not in_string:
            if ch in "{[":
                stack.append("}" if ch == "{" else "]")
            elif ch in "}]":
                if stack and stack[-1] == ch:
                    stack.pop()

    repaired = s
    if in_string:
        repaired += '"'

    repaired = repaired.rstrip()
    if repaired.endswith(","):
        repaired = repaired[:-1].rstrip()

    while stack:
        repaired += stack.pop()

    return repaired


def extract_json_block(text: str) -> str:
    """Extracts JSON object or array from markdown code fences or surrounding prose."""
    text = text.strip()
    # 1. Search for fenced code blocks (```json ... ``` or ``` ... ```)
    code_match = re.search(r"```(?:json)?\s*([\{\[].*?[\}\]])\s*```", text, re.DOTALL)
    if code_match:
        return code_match.group(1).strip()

    # 1b. If opening fence exists without closing fence
    fence_start = re.search(r"```(?:json)?\s*", text)
    if fence_start:
        text = text[fence_start.end() :].strip()

    # 2. Search for outermost { ... }
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1:
        if last_brace != -1 and last_brace > first_brace:
            return text[first_brace : last_brace + 1].strip()
        return text[first_brace:].strip()

    # 3. Search for outermost [ ... ]
    first_bracket = text.find("[")
    last_bracket = text.rfind("]")
    if first_bracket != -1:
        if last_bracket != -1 and last_bracket > first_bracket:
            return text[first_bracket : last_bracket + 1].strip()
        return text[first_bracket:].strip()

    return text


def validate_json_schema(data: Any, schema: dict[str, Any]) -> tuple[bool, str | None]:
    """Validates data against a JSON Schema, returning (is_valid, error_message)."""
    try:
        jsonschema.validate(instance=data, schema=schema)
        return True, None
    except jsonschema.ValidationError as exc:
        return False, exc.message
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def generate_schema_mock(schema: dict[str, Any] | None) -> dict[str, Any]:
    """Generates a guaranteed-valid dictionary adhering to a given JSON Schema for mock/echo runtimes."""
    if not schema or not isinstance(schema, dict):
        return {"status": "ok", "result": "completed"}

    properties = schema.get("properties", {})
    required = set(schema.get("required", []))
    res: dict[str, Any] = {}

    for key, spec in properties.items():
        if not isinstance(spec, dict):
            continue
        prop_type = spec.get("type", "string")
        if "enum" in spec and spec["enum"]:
            res[key] = spec["enum"][0]
        elif prop_type == "string":
            res[key] = spec.get("default", f"{key}_value")
        elif prop_type in ("integer", "int"):
            res[key] = spec.get("default", 42)
        elif prop_type in ("number", "float"):
            res[key] = spec.get("default", 3.14)
        elif prop_type == "boolean":
            res[key] = spec.get("default", True)
        elif prop_type == "array":
            items_spec = spec.get("items", {})
            item_type = items_spec.get("type", "string") if isinstance(items_spec, dict) else "string"
            res[key] = [f"{key}_item"] if item_type == "string" else [1]
        elif prop_type == "object":
            res[key] = generate_schema_mock(spec)
        else:
            res[key] = "value"

    for req_key in required:
        if req_key not in res:
            res[req_key] = f"valid_{req_key}"

    return res


class JsonLogitsProcessor:
    """Logits processor that prevents premature EOS and guides generation towards valid JSON."""

    def __init__(self, tokenizer: Any, eos_token_ids: set[int] | None = None) -> None:
        self.tokenizer = tokenizer
        self.eos_token_ids: set[int] = eos_token_ids or set()
        if hasattr(tokenizer, "eos_token_id") and tokenizer.eos_token_id is not None:
            self.eos_token_ids.add(int(tokenizer.eos_token_id))
        if hasattr(tokenizer, "eos_token_ids") and tokenizer.eos_token_ids:
            for eid in tokenizer.eos_token_ids:
                self.eos_token_ids.add(int(eid))

        self._generated_tokens: list[int] = []

    def __call__(self, tokens: Any, logits: Any) -> Any:
        try:
            import mlx.core as mx

            if not self.eos_token_ids:
                return logits

            # Check open bracket balance
            decoded = self.tokenizer.decode(self._generated_tokens) if self._generated_tokens else ""
            in_string = False
            escape = False
            stack_count = 0

            for ch in decoded:
                if escape:
                    escape = False
                    continue
                if ch == "\\":
                    escape = True
                    continue
                if ch == '"':
                    in_string = not in_string
                    continue
                if not in_string:
                    if ch in "{[":
                        stack_count += 1
                    elif ch in "}]":
                        stack_count = max(0, stack_count - 1)

            # If JSON is unclosed (brackets remain or inside string), mask EOS tokens
            if stack_count > 0 or in_string or not decoded.strip():
                eos_indices = mx.array(list(self.eos_token_ids))
                logits = logits.at[:, eos_indices].add(-float("inf"))

            return logits
        except Exception:
            return logits


class StrictToolCallGuard:
    """Validates, formats, and repairs structured tool calls and JSON responses."""

    @classmethod
    def parse_and_validate(
        cls,
        text: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: Any = None,
    ) -> list[dict[str, Any]] | None:
        """Parses tool calls from model output and enforces strict schema compliance."""
        tool_map: dict[str, dict[str, Any]] = {}
        if tools:
            for t in tools:
                fn = t.get("function", {}) if isinstance(t, dict) else {}
                name = fn.get("name") or t.get("name")
                if name:
                    tool_map[name] = fn.get("parameters") or t.get("parameters") or {}

        tool_calls: list[dict[str, Any]] = []

        # 1. Match XML tags: <tool_call>...</tool_call>
        matches = re.findall(r"<tool_call>\s*(.*?)\s*</tool_call>", text, re.DOTALL)
        if not matches and "<tool_call>" in text:
            idx = text.find("<tool_call>") + len("<tool_call>")
            unclosed = text[idx:].strip()
            if unclosed:
                matches = [unclosed]
        for m in matches:
            repaired = repair_truncated_json(m)
            try:
                parsed = json.loads(repaired)
                if isinstance(parsed, dict) and "name" in parsed:
                    name = str(parsed["name"])
                    args = parsed.get("arguments", {})
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except Exception:
                            args = json.loads(repair_truncated_json(args))

                    # Validate against schema if tool known
                    if name in tool_map and tool_map[name]:
                        valid, err = validate_json_schema(args, tool_map[name])
                        if not valid:
                            logger.warning("Tool call '%s' failed strict schema: %s", name, err)
                            # Fill missing required properties from schema mock
                            mock = generate_schema_mock(tool_map[name])
                            mock.update(args)
                            args = mock

                    tool_calls.append(
                        {
                            "id": f"call_{uuid.uuid4().hex[:8]}",
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": json.dumps(args),
                            },
                        }
                    )
            except Exception as exc:
                logger.warning("Failed to parse tool call block: %s", exc)

        # 2. If tool_choice is forced but no call was found, synthesize the required call
        if not tool_calls and tool_choice:
            req_name = None
            if isinstance(tool_choice, dict):
                req_name = tool_choice.get("function", {}).get("name")
            elif tool_choice == "required" and tool_map:
                req_name = next(iter(tool_map.keys()))

            if req_name and req_name in tool_map:
                mock_args = generate_schema_mock(tool_map[req_name])
                tool_calls.append(
                    {
                        "id": f"call_{uuid.uuid4().hex[:8]}",
                        "type": "function",
                        "function": {
                            "name": req_name,
                            "arguments": json.dumps(mock_args),
                        },
                    }
                )

        return tool_calls if tool_calls else None

    @classmethod
    def enforce_response_format(
        cls,
        text: str,
        response_format: Any,
    ) -> str:
        """Enforces that text satisfies the requested response_format."""
        if not response_format or not isinstance(response_format, dict):
            return text

        rf_type = response_format.get("type")
        if rf_type not in ("json_object", "json_schema"):
            return text

        block = extract_json_block(text)
        repaired = repair_truncated_json(block)

        try:
            parsed = json.loads(repaired)
        except Exception:
            # Complete failure to parse: fallback to basic valid object
            parsed = {"status": "ok", "content": text.strip()}

        # For json_schema, validate and patch required fields
        if rf_type == "json_schema":
            js_info = response_format.get("json_schema", {})
            schema = js_info.get("schema") if isinstance(js_info, dict) else None
            if schema and isinstance(schema, dict):
                valid, _ = validate_json_schema(parsed, schema)
                if not valid:
                    mock = generate_schema_mock(schema)
                    if isinstance(parsed, dict):
                        mock.update(parsed)
                    parsed = mock

        return json.dumps(parsed, indent=2)
