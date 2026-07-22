from __future__ import annotations

import math
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class KoreanTypographyMetrics:
    font_family: str
    pptx_font_family: str
    fallback_family: str
    width_factor: float
    line_height: float


FONT_METRICS: tuple[tuple[str, float, float], ...] = (
    ("gmarket", 1.18, 1.18),
    ("nanumsquareround", 1.10, 1.20),
    ("gowun", 1.08, 1.22),
    ("noto sans kr", 1.04, 1.18),
    ("pretendard", 1.00, 1.15),
)


def resolve_korean_typography(
    font_family: str,
    *,
    fallback_family: str = "Arial",
    width_factor: float | None = None,
    line_height: float | None = None,
) -> KoreanTypographyMetrics:
    requested = " ".join(font_family.split()) or "Pretendard"
    normalized = requested.casefold()
    catalog_width = 1.0
    catalog_line_height = 1.15
    for marker, candidate_width, candidate_line_height in FONT_METRICS:
        if marker in normalized:
            catalog_width = candidate_width
            catalog_line_height = candidate_line_height
            break
    return KoreanTypographyMetrics(
        font_family=requested,
        pptx_font_family=requested,
        fallback_family=" ".join(fallback_family.split()) or "Arial",
        width_factor=max(0.8, min(1.4, width_factor or catalog_width)),
        line_height=max(1.0, min(1.6, line_height or catalog_line_height)),
    )


def estimate_korean_line_count(
    text: str,
    *,
    width: float,
    font_size: float,
    font_family: str,
    width_factor: float | None = None,
) -> int:
    metrics = resolve_korean_typography(
        font_family,
        width_factor=width_factor,
    )
    line_width = 0.0
    lines = 1
    for character in text:
        if character == "\n":
            lines += 1
            line_width = 0.0
            continue
        if character.isspace():
            character_width = font_size * 0.33
        elif re.match(r"[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af]", character):
            character_width = font_size
        else:
            character_width = font_size * 0.55
        character_width *= metrics.width_factor
        if line_width and line_width + character_width > width:
            lines += 1
            line_width = character_width
        else:
            line_width += character_width
    return max(1, math.ceil(lines))
