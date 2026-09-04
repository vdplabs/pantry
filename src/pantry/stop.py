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


def looks_like_repetition_loop(text: str) -> bool:
    """Cheap host-side guard when tiny models skip EOS and restate themselves."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) >= 6:
        for n in (3, 4, 5, 6, 8):
            if len(lines) >= n * 2 and lines[-n:] == lines[-2 * n : -n]:
                return True
        if len(lines) >= 8:
            half = len(lines) // 2
            a = lines[:half]
            b = lines[half : half * 2]
            if len(a) >= 4 and a == b:
                return True

    if len(text) < 160:
        return False
    window = text[-500:]
    needle = window[-100:].strip()
    if len(needle) < 48:
        return False
    earlier = window[:-100]
    if needle in earlier:
        return True
    head = needle[:64]
    if len(head) >= 48 and head in earlier:
        return True
    return False


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
