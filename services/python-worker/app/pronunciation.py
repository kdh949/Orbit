from __future__ import annotations

import unicodedata

from app.audio.transcribe import PronunciationContextTerm

_SEPARATORS = frozenset("./_+#-")
_KOREAN_PARTICLE_PREFIXES = frozenset("은는이가을를와과도만의에로서부터까지께")


def normalize_pronunciation_key(value: str) -> str:
    return "".join(
        character
        for character in unicodedata.normalize("NFKC", value).casefold()
        if not character.isspace() and character not in _SEPARATORS
    )


def find_canonical_term_keys(
    transcript: str,
    context: list[PronunciationContextTerm],
) -> set[str]:
    if not transcript or not context:
        return set()

    compact_text, compact_map = _normalize_with_map(transcript)
    alias_owners: dict[str, set[str]] = {}
    for term in context:
        canonical_key = normalize_pronunciation_key(term.source)
        if not canonical_key:
            continue
        for surface in [term.source, *term.aliases]:
            alias_key = normalize_pronunciation_key(surface)
            if alias_key:
                alias_owners.setdefault(alias_key, set()).add(canonical_key)

    matched: set[str] = set()
    for alias_key, owners in alias_owners.items():
        if len(owners) != 1:
            continue
        start = compact_text.find(alias_key)
        while start >= 0:
            end = start + len(alias_key)
            original_start = compact_map[start][0]
            original_end = compact_map[end - 1][1]
            if _has_safe_boundary(
                transcript,
                original_start,
                original_end,
                alias_key,
            ):
                matched.update(owners)
                break
            start = compact_text.find(alias_key, start + 1)
    return matched


def _normalize_with_map(value: str) -> tuple[str, list[tuple[int, int]]]:
    compact: list[str] = []
    compact_map: list[tuple[int, int]] = []
    for source_index, source_character in enumerate(value):
        normalized = unicodedata.normalize("NFKC", source_character).casefold()
        for character in normalized:
            if character.isspace() or character in _SEPARATORS:
                continue
            compact.append(character)
            compact_map.append((source_index, source_index + 1))
    return "".join(compact), compact_map


def _has_safe_boundary(
    original: str,
    start: int,
    end: int,
    alias_key: str,
) -> bool:
    before = original[start - 1] if start > 0 else ""
    after = original[end] if end < len(original) else ""
    if alias_key.isascii() and alias_key.isalnum():
        before_safe = not before or not (before.isascii() and before.isalnum())
        after_safe = not after or not (after.isascii() and after.isalnum())
        return before_safe and after_safe
    if not any("가" <= character <= "힣" for character in alias_key):
        return True
    safe_before = not before or _is_boundary_character(before)
    safe_after = (
        not after or _is_boundary_character(after) or after in _KOREAN_PARTICLE_PREFIXES
    )
    return safe_before and safe_after


def _is_boundary_character(character: str) -> bool:
    category = unicodedata.category(character)
    return character.isspace() or category.startswith("P") or category.startswith("S")
