from __future__ import annotations

"""Stop-string and light loop detection for streaming generation."""

from pantry.schemas import PackageManifest

# Always treat these as end-of-turn, regardless of package.
_COMMON_STOPS = (
    "<|im_end|>",
    "<|im_start|>",
    "<|eot_id|>",
    "<|end_of_text|>",
    "</s>",
)


def stop_strings(manifest: PackageManifest | None = None) -> list[str]:
    family = (manifest.template_family if manifest else "") or ""
    family = family.lower()
    stops = list(_COMMON_STOPS)
    if family in {"llama3", "llama"}:
        stops.extend(["<|start_header_id|>", "<|end_of_text|>"])
    # Preserve order, drop empties/dupes.
    seen: set[str] = set()
    out: list[str] = []
    for s in stops:
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def strip_at_stop(text: str, stops: list[str] | None = None) -> str:
    stops = stops if stops is not None else list(_COMMON_STOPS)
    out = text
    cut: int | None = None
    for s in stops:
        idx = out.find(s)
        if idx >= 0 and (cut is None or idx < cut):
            cut = idx
    if cut is not None:
        return out[:cut].rstrip()
    return out


def _heading_like(line: str) -> str | None:
    """Normalize markdown / section titles used by tiny R1 CoT loops."""
    s = line.strip()
    if not s or len(s) < 8 or len(s) > 120:
        return None
    if s.startswith("#"):
        key = s.lstrip("#").strip().lower()
        return key if len(key) >= 6 else None
    # "Practical Considerations", "Conclusion", "Final Answer:"
    if s.endswith(":") and 8 <= len(s) <= 80:
        return s.rstrip(":").strip().lower()
    letters = sum(1 for c in s if c.isalpha())
    if letters < 6:
        return None
    if s[0].isupper() and not s.startswith(("-", "*", "|", "<", "[")):
        # Avoid counting every bullet sentence — prefer short Title-ish lines.
        words = s.split()
        if 1 <= len(words) <= 8 and sum(1 for w in words if w[:1].isupper()) >= max(1, len(words) // 2):
            return s.lower()
    return None


def looks_like_repetition_loop(text: str) -> bool:
    """Cheap host-side guard when tiny models skip EOS and restate themselves."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) >= 6:
        for n in (3, 4, 5, 6, 8, 10, 12, 16):
            if len(lines) >= n * 2 and lines[-n:] == lines[-2 * n : -n]:
                return True
        if len(lines) >= 8:
            half = len(lines) // 2
            a = lines[:half]
            b = lines[half : half * 2]
            if len(a) >= 4 and a == b:
                return True

    # Same section heading restated (DeepSeek-R1 1.5B CoT loops).
    heading_counts: dict[str, int] = {}
    for ln in text.splitlines():
        key = _heading_like(ln)
        if key is None:
            continue
        heading_counts[key] = heading_counts.get(key, 0) + 1
        if heading_counts[key] >= 3:
            return True

    if len(text) < 160:
        return False

    # Long pasted block appearing twice in the recent window.
    window = text[-2_000:] if len(text) > 2_000 else text
    for blen in (120, 180, 240, 320, 400):
        if len(window) < blen * 2:
            continue
        block = window[-blen:]
        if not block.strip():
            continue
        earlier = window[:-blen]
        if block in earlier:
            return True

    needle = window[-100:].strip()
    if len(needle) < 48:
        return False
    earlier = window[:-100]
    if needle in earlier:
        return True
    head = needle[:64]
    return bool(len(head) >= 48 and head in earlier)


class StreamStopper:
    """Accumulate streamed text; truncate at stop strings / loops."""

    def __init__(self, manifest: PackageManifest | None = None) -> None:
        self.stops = stop_strings(manifest)
        self._buf = ""
        self.halted = False

    def push(self, chunk: str) -> str:
        """Return the portion of *chunk* that is safe to emit (may be empty)."""
        if self.halted or not chunk:
            return ""
        before = len(self._buf)
        self._buf += chunk
        for s in self.stops:
            idx = self._buf.find(s)
            if idx < 0:
                continue
            self.halted = True
            trimmed = self._buf[:idx].rstrip()
            self._buf = trimmed
            if len(trimmed) <= before:
                return ""
            return trimmed[before:]
        if looks_like_repetition_loop(self._buf):
            self.halted = True
            # Drop the chunk that tipped us into a loop when possible.
            self._buf = self._buf[:before].rstrip()
            return ""
        return chunk
