from __future__ import annotations

import base64
import math
import re
import textwrap
from copy import deepcopy
from dataclasses import dataclass
from io import BytesIO
from typing import Any, Literal

from app.ai.deck_generation.content_planning import (
    PRESENTATION_PROFILE_BEATS,
    action_title_requires_attention,
    count_speaker_note_chars,
    has_profile_closing_action,
    normalize_structural_content_text,
    repeated_speaker_notes_slide_order,
    speaker_notes_maximum_chars,
    speaker_notes_minimum_chars,
)
from app.ai.deck_generation.design_planning import (
    contrast_ratio,
    design_pack_forbidden_styles,
    text_color_for_background,
)
from app.ai.deck_generation.layout_compiler import (
    cap_elements,
    core_geometry_fingerprint,
    is_canvas_background_element,
)
from app.ai.deck_generation.models import (
    CANVAS,
    DesignConstraints,
    ImageReviewMode,
    PythonQualityInput,
    PythonQualityResult,
    RawInput,
    SlideTextOverlapReview,
    ValidationIssue,
    ValidationResult,
)
from app.ai.deck_generation.structural_policy import is_structural_slide_type


@dataclass(frozen=True)
class TextOverlapCandidate:
    slide_index: int
    slide_id: str
    first_element_index: int
    second_element_index: int
    first_element_id: str
    second_element_id: str
    overlap_ratio: float








GRID_COLUMN_COUNT = 12
GRID_GUTTER = 24
GRID_COLUMN_WIDTH = 118
GRID_STEP = GRID_COLUMN_WIDTH + GRID_GUTTER
GRID_SPACING = 8
GRID_TOLERANCE = 4
TEXT_OVERLAP_WARNING_RATIO = 0.15
MAX_IMAGE_REVIEW_SLIDES = 3











TEXT_OVERLAP_REVIEW_INSTRUCTIONS = """
You review one slide preview for text-on-text overlap only.
Return JSON only.

Rules:
- unreadable=true only when overlapping text would be hard for a human to read.
- Ignore decorative shapes, image placeholders, charts, and footer text.
- Do not evaluate layout taste, wording, contrast, or grammar.
""".strip()

TEXT_OVERLAP_REVIEW_RESPONSE_FORMAT: dict[str, Any] = {
    "format": {
        "type": "json_schema",
        "name": "slide_text_overlap_review",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "unreadable": {"type": "boolean"},
                "reason": {"type": "string"},
            },
            "required": ["unreadable", "reason"],
        },
    }
}


def enforce_design_pack_constraints(
    deck: dict[str, Any],
    raw_input: RawInput,
) -> dict[str, Any]:
    constraints = raw_input.design.constraints or DesignConstraints()
    color_intent = raw_input.design.color_intent
    wants_white = constraints.canvas_background == "white" or (
        color_intent is not None
        and color_intent.background_preference == "white"
    )
    forbidden_styles = design_pack_forbidden_styles(raw_input)

    if wants_white:
        enforce_white_canvas(deck)
    if "pastel" in forbidden_styles:
        neutralize_pastel_surfaces(deck)
    if "gradient" in forbidden_styles:
        remove_gradient_props(deck)

    return deck




def enforce_white_canvas(deck: dict[str, Any]) -> None:
    theme = deck.setdefault("theme", {})
    theme["backgroundColor"] = "#FFFFFF"
    if contrast_ratio("#FFFFFF", str(theme.get("textColor", "#111827"))) < 4.5:
        theme["textColor"] = "#111827"

    for slide in deck.get("slides", []):
        style = slide.setdefault("style", {})
        style["backgroundColor"] = "#FFFFFF"
        for element in slide.get("elements", []):
            if is_canvas_background_element(element):
                props = element.setdefault("props", {})
                props["fill"] = "#FFFFFF"
                props["stroke"] = "transparent"


def neutralize_pastel_surfaces(deck: dict[str, Any]) -> None:
    theme = deck.setdefault("theme", {})
    palette = theme.setdefault("palette", {})
    replacements: dict[str, str] = {}
    for key, replacement in (("muted", neutral_surface()), ("border", "#D1D5DB")):
        current = str(palette.get(key, ""))
        if is_pastel_hex(current):
            replacements[current.casefold()] = replacement
            palette[key] = replacement

    for slide in deck.get("slides", []):
        for element in slide.get("elements", []):
            props = element.get("props", {})
            for prop in ("fill", "stroke"):
                color = str(props.get(prop, ""))
                mapped_replacement = replacements.get(color.casefold())
                if mapped_replacement:
                    props[prop] = mapped_replacement


def remove_gradient_props(value: Any) -> None:
    if isinstance(value, list):
        for item in value:
            remove_gradient_props(item)
        return
    if not isinstance(value, dict):
        return

    for key in list(value.keys()):
        item = value[key]
        if "gradient" in key.lower():
            del value[key]
            continue
        if isinstance(item, str) and "gradient(" in item.lower():
            value[key] = neutral_surface()
            continue
        remove_gradient_props(item)






def is_pastel_hex(color: str) -> bool:
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        return False
    red = int(color[1:3], 16) / 255
    green = int(color[3:5], 16) / 255
    blue = int(color[5:7], 16) / 255
    high = max(red, green, blue)
    low = min(red, green, blue)
    lightness = (high + low) / 2
    saturation = 0 if high == low else (high - low) / (1 - abs(2 * lightness - 1))
    return lightness >= 0.82 and saturation >= 0.12 and color.upper() != "#FFFFFF"


def neutral_surface() -> str:
    return "#F3F4F6"










































def validate_and_patch(
    deck: dict[str, Any],
    *,
    include_design_in_passed: bool = False,
) -> tuple[dict[str, Any], ValidationResult]:
    layout_issues = validate_layout(deck)
    content_issues = validate_content(deck)
    design_issues = validate_design(deck)
    presentation_issues = validate_presentation(deck)
    issues = layout_issues + content_issues + presentation_issues
    if include_design_in_passed:
        issues += design_issues
    if issues:
        deck = patch_deck(deck)
        layout_issues = validate_layout(deck)
        content_issues = validate_content(deck)
        design_issues = validate_design(deck)
        presentation_issues = validate_presentation(deck)

    return deck, ValidationResult(
        passed=not (
            layout_issues
            or content_issues
            or (design_issues if include_design_in_passed else [])
            or presentation_issues
        ),
        layoutIssues=layout_issues,
        contentIssues=content_issues,
        designIssues=design_issues,
        presentationIssues=presentation_issues,
    )


def validate_layout(deck: dict[str, Any]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for slide_index, slide in enumerate(deck["slides"]):
        elements = slide["elements"]
        if len(elements) > element_limit_for_slide(slide):
            issues.append(
                ValidationIssue(
                    scope="slide",
                    path=f"slides.{slide_index}.elements",
                    message="슬라이드 요소가 너무 많습니다.",
                )
            )
        for element_index, element in enumerate(elements):
            if element["width"] <= 0 or element["height"] <= 0:
                issues.append(
                    ValidationIssue(
                        scope="element",
                        path=f"slides.{slide_index}.elements.{element_index}",
                        message="요소의 너비와 높이는 0보다 커야 합니다.",
                    )
                )
            if element["x"] + element["width"] > CANVAS.width:
                issues.append(
                    ValidationIssue(
                        scope="element",
                        path=f"slides.{slide_index}.elements.{element_index}.x",
                        message="요소가 캔버스 너비를 벗어났습니다.",
                    )
                )
            if element["y"] + element["height"] > CANVAS.height:
                issues.append(
                    ValidationIssue(
                        scope="element",
                        path=f"slides.{slide_index}.elements.{element_index}.y",
                        message="요소가 캔버스 높이를 벗어났습니다.",
                    )
                )
    return issues


def element_limit_for_slide(slide: dict[str, Any]) -> int:
    process_prefix = f"el_{slide.get('order')}_process_card_"
    if is_design_pack_slide(slide):
        return 48
    if any(
        str(element.get("elementId", "")).startswith(process_prefix)
        for element in slide.get("elements", [])
    ):
        return 64
    return 14


def is_design_pack_slide(slide: dict[str, Any]) -> bool:
    if isinstance(slide.get("aiNotes", {}).get("compositionPlan"), dict):
        return True
    return any(
        "_design_pack_" in str(element.get("elementId", ""))
        or "_program_v2_" in str(element.get("elementId", ""))
        for element in slide.get("elements", [])
    )


def detect_text_overlap_candidates(deck: dict[str, Any]) -> list[TextOverlapCandidate]:
    candidates: list[TextOverlapCandidate] = []
    for slide_index, slide in enumerate(deck.get("slides", [])):
        text_elements = [
            (element_index, element)
            for element_index, element in enumerate(slide.get("elements", []))
            if is_readable_text_element(element)
        ]
        for left_index, (first_index, first) in enumerate(text_elements):
            for second_index, second in text_elements[left_index + 1 :]:
                ratio = text_overlap_ratio(first, second)
                if ratio < TEXT_OVERLAP_WARNING_RATIO:
                    continue

                candidates.append(
                    TextOverlapCandidate(
                        slide_index=slide_index,
                        slide_id=str(slide.get("slideId", "")),
                        first_element_index=first_index,
                        second_element_index=second_index,
                        first_element_id=str(first.get("elementId", "")),
                        second_element_id=str(second.get("elementId", "")),
                        overlap_ratio=ratio,
                    )
                )

    return candidates


def is_readable_text_element(element: dict[str, Any]) -> bool:
    if element.get("type") != "text":
        return False
    if element.get("visible") is False:
        return False
    if element.get("role") == "footer":
        return False

    props = element.get("props", {})
    return bool(str(props.get("text", "")).strip())


def text_overlap_ratio(first: dict[str, Any], second: dict[str, Any]) -> float:
    first_area = element_area(first)
    second_area = element_area(second)
    if first_area <= 0 or second_area <= 0:
        return 0

    left = max(float(first.get("x", 0)), float(second.get("x", 0)))
    top = max(float(first.get("y", 0)), float(second.get("y", 0)))
    right = min(
        float(first.get("x", 0)) + float(first.get("width", 0)),
        float(second.get("x", 0)) + float(second.get("width", 0)),
    )
    bottom = min(
        float(first.get("y", 0)) + float(first.get("height", 0)),
        float(second.get("y", 0)) + float(second.get("height", 0)),
    )
    overlap_width = max(0.0, right - left)
    overlap_height = max(0.0, bottom - top)
    return (overlap_width * overlap_height) / min(first_area, second_area)


def element_area(element: dict[str, Any]) -> float:
    return max(0.0, float(element.get("width", 0))) * max(
        0.0,
        float(element.get("height", 0)),
    )


def text_overlap_candidate_issues(
    candidates: list[TextOverlapCandidate],
) -> list[ValidationIssue]:
    best_by_slide: dict[int, TextOverlapCandidate] = {}
    for candidate in candidates:
        current = best_by_slide.get(candidate.slide_index)
        if current is None or candidate.overlap_ratio > current.overlap_ratio:
            best_by_slide[candidate.slide_index] = candidate

    return [
        ValidationIssue(
            scope="slide",
            path=f"slides.{candidate.slide_index}.elements",
            message=(
                "텍스트 요소가 겹쳐 읽기 어려울 수 있습니다: "
                f"{candidate.first_element_id}, {candidate.second_element_id}"
            ),
        )
        for candidate in best_by_slide.values()
    ]


def review_text_overlap_candidates(
    deck: dict[str, Any],
    candidates: list[TextOverlapCandidate],
    *,
    client: Any | None = None,
    model: str | None = None,
    api_key: str | None = None,
    image_review_mode: ImageReviewMode = "auto",
) -> list[ValidationIssue]:
    if not candidates:
        return []

    fallback_issues = text_overlap_candidate_issues(candidates)
    if image_review_mode == "off" or (client is None and not api_key):
        return fallback_issues

    api_client = client
    if api_client is None:
        from openai import OpenAI

        api_client = OpenAI(api_key=api_key)

    groups = group_text_overlap_candidates(candidates)
    issues: list[ValidationIssue] = []
    for slide_index, slide_candidates in groups[:MAX_IMAGE_REVIEW_SLIDES]:
        try:
            slide = deck["slides"][slide_index]
            preview_png = render_slide_preview_png(deck, slide)
            review = review_slide_text_overlap(
                api_client,
                model=model,
                preview_png=preview_png,
                candidates=slide_candidates,
            )
        except Exception:
            return fallback_issues

        if review.unreadable:
            issues.append(text_overlap_review_issue(slide_candidates, review.reason))

    unreviewed_candidates = [
        candidate
        for _, slide_candidates in groups[MAX_IMAGE_REVIEW_SLIDES:]
        for candidate in slide_candidates
    ]
    issues.extend(text_overlap_candidate_issues(unreviewed_candidates))
    return issues


def group_text_overlap_candidates(
    candidates: list[TextOverlapCandidate],
) -> list[tuple[int, list[TextOverlapCandidate]]]:
    grouped: dict[int, list[TextOverlapCandidate]] = {}
    for candidate in candidates:
        grouped.setdefault(candidate.slide_index, []).append(candidate)
    return sorted(grouped.items())


def review_slide_text_overlap(
    client: Any,
    *,
    model: str | None,
    preview_png: bytes,
    candidates: list[TextOverlapCandidate],
) -> SlideTextOverlapReview:
    image_url = "data:image/png;base64," + base64.b64encode(preview_png).decode(
        "ascii"
    )
    response = client.responses.create(
        model=model or "gpt-4o-mini",
        instructions=TEXT_OVERLAP_REVIEW_INSTRUCTIONS,
        input=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": text_overlap_review_prompt(candidates),
                    },
                    {
                        "type": "input_image",
                        "image_url": image_url,
                    },
                ],
            }
        ],
        text=TEXT_OVERLAP_REVIEW_RESPONSE_FORMAT,
    )
    return SlideTextOverlapReview.model_validate_json(
        str(getattr(response, "output_text", "")).strip()
    )


def text_overlap_review_prompt(candidates: list[TextOverlapCandidate]) -> str:
    candidate_lines = [
        (
            f"- {candidate.first_element_id} vs {candidate.second_element_id}: "
            f"overlap_ratio={candidate.overlap_ratio:.2f}"
        )
        for candidate in candidates
    ]
    return "\n".join(
        [
            "Review whether these candidate text overlaps are actually unreadable.",
            "Candidates:",
            *candidate_lines,
        ]
    )


def text_overlap_review_issue(
    candidates: list[TextOverlapCandidate],
    reason: str,
) -> ValidationIssue:
    candidate = max(candidates, key=lambda item: item.overlap_ratio)
    message = "이미지 검증 결과 텍스트 겹침으로 읽기 어렵습니다."
    if reason.strip():
        message = f"{message} {reason.strip()[:160]}"
    return ValidationIssue(
        scope="slide",
        path=f"slides.{candidate.slide_index}.elements",
        message=message,
    )


def render_slide_preview_png(deck: dict[str, Any], slide: dict[str, Any]) -> bytes:
    from PIL import Image, ImageDraw

    canvas = deck.get("canvas", {})
    width = int(canvas.get("width") or CANVAS.width)
    height = int(canvas.get("height") or CANVAS.height)
    theme = deck.get("theme", {})
    slide_style = slide.get("style", {})
    background = preview_color(
        slide_style.get("backgroundColor") or theme.get("backgroundColor"),
        "#ffffff",
    ) or "#ffffff"
    image = Image.new("RGB", (width, height), background)
    draw = ImageDraw.Draw(image)

    for element in sorted(
        slide.get("elements", []),
        key=lambda item: int(item.get("zIndex", 0)),
    ):
        if element.get("visible") is False:
            continue

        render_preview_element(draw, element, theme)

    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def render_preview_element(
    draw: Any,
    element: dict[str, Any],
    theme: dict[str, Any],
) -> None:
    left = float(element.get("x", 0))
    top = float(element.get("y", 0))
    right = left + float(element.get("width", 0))
    bottom = top + float(element.get("height", 0))
    props = element.get("props", {})
    element_type = element.get("type")

    if element_type in {"rect", "ellipse", "polygon", "star", "ring", "customShape"}:
        fill = preview_color(props.get("fill"), "transparent")
        outline = preview_color(props.get("stroke"), "transparent")
        stroke_width = max(1, int(props.get("strokeWidth") or 1))
        if element_type == "ellipse":
            draw.ellipse(
                [left, top, right, bottom],
                fill=fill,
                outline=outline,
                width=stroke_width,
            )
        else:
            draw.rectangle(
                [left, top, right, bottom],
                fill=fill,
                outline=outline,
                width=stroke_width,
            )
        return

    if element_type in {"image", "chart"}:
        draw.rectangle([left, top, right, bottom], fill="#e5e7eb", outline="#94a3b8")
        return

    if element_type != "text":
        return

    font_size = max(8, int(props.get("fontSize") or 24))
    text = str(props.get("text", ""))
    if not text.strip():
        return

    font = preview_font(font_size)
    color = preview_color(
        props.get("color") or theme.get("textColor"),
        "#111827",
    ) or "#111827"
    draw.multiline_text(
        (left, top),
        wrap_preview_text(text, font_size, max(1.0, right - left)),
        fill=color,
        font=font,
        spacing=max(2, int(font_size * 0.18)),
    )


def preview_font(font_size: int) -> Any:
    from PIL import ImageFont

    for font_name in ("malgun.ttf", "DejaVuSans.ttf", "Arial.ttf"):
        try:
            return ImageFont.truetype(font_name, font_size)
        except OSError:
            continue
    return ImageFont.load_default()


def wrap_preview_text(text: str, font_size: int, width: float) -> str:
    max_chars = max(1, int(width / max(1.0, font_size * 0.55)))
    return "\n".join(textwrap.wrap(text, width=max_chars)[:8])


def preview_color(value: Any, fallback: str) -> str | None:
    from PIL import ImageColor

    color = value if isinstance(value, str) and value else fallback
    if color == "transparent":
        return None
    try:
        ImageColor.getrgb(color)
    except ValueError:
        color = fallback
    return None if color == "transparent" else color


def validate_content(deck: dict[str, Any]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    presentation_rules = bool(deck.get("metadata", {}).get("presentationProfile"))
    topic = deck["metadata"]["createdFrom"]["topic"]
    if topic not in deck["title"]:
        issues.append(
            ValidationIssue(
                scope="deck",
                path="title",
                message="덱 제목에는 생성 주제가 포함되어야 합니다.",
            )
        )
    for slide_index, slide in enumerate(deck["slides"]):
        if not slide["title"].strip():
            issues.append(
                ValidationIssue(
                    scope="slide",
                    path=f"slides.{slide_index}.title",
                    message="슬라이드 제목은 비어 있을 수 없습니다.",
                )
            )
        if not slide["speakerNotes"]:
            issues.append(
                ValidationIssue(
                    scope="slide",
                    path=f"slides.{slide_index}.speakerNotes",
                    message="발표자 노트가 필요합니다.",
                )
            )
        issues.extend(
            validate_slide_timing_plan(
                slide,
                slide_index,
                presentation_rules=presentation_rules,
            )
        )
        issues.extend(validate_slide_source_ledger(slide, slide_index))
        issues.extend(validate_slide_visual_slot(slide, slide_index))
    issues.extend(
        validate_deck_timing_summary(
            deck,
            presentation_rules=presentation_rules,
        )
    )
    if presentation_rules:
        issues.extend(validate_speaker_notes_repetition(deck))
    return issues


def validate_speaker_notes_repetition(
    deck: dict[str, Any],
) -> list[ValidationIssue]:
    repeated_order = repeated_speaker_notes_slide_order(
        [
            (index + 1, str(slide.get("speakerNotes", "")))
            for index, slide in enumerate(deck.get("slides", []))
        ]
    )
    if repeated_order is None:
        return []
    return [
        ValidationIssue(
            code="SPEAKER_NOTES_REPEATED",
            scope="slide",
            path=f"slides.{repeated_order - 1}.speakerNotes",
            message="발표자 메모에 동일하거나 매우 유사한 문장이 반복되어 있습니다.",
        )
    ]


def validate_slide_timing_plan(
    slide: dict[str, Any],
    slide_index: int,
    *,
    presentation_rules: bool = False,
) -> list[ValidationIssue]:
    timing_plan = slide.get("aiNotes", {}).get("timingPlan")
    if not isinstance(timing_plan, dict):
        return []
    target_chars = int(timing_plan.get("targetSpeakerNotesChars") or 0)
    actual_chars = count_speaker_note_chars(str(slide.get("speakerNotes", "")))
    if presentation_rules and target_chars > 0:
        if actual_chars < speaker_notes_minimum_chars(target_chars):
            return [
                ValidationIssue(
                    code="SPEAKER_NOTES_SHORT",
                    scope="slide",
                    path=f"slides.{slide_index}.speakerNotes",
                    message=(
                        "발표자 메모가 장표별 발화 목표의 90%보다 짧습니다. "
                        f"목표 {target_chars}자 대비 현재 {actual_chars}자입니다."
                    ),
                )
            ]
        if actual_chars > speaker_notes_maximum_chars(target_chars):
            return [
                ValidationIssue(
                    code="SPEAKER_NOTES_DENSE",
                    scope="slide",
                    path=f"slides.{slide_index}.speakerNotes",
                    message=(
                        "발표자 메모가 장표별 발화 목표의 110%를 초과합니다. "
                        f"목표 {target_chars}자 대비 현재 {actual_chars}자입니다."
                    ),
                )
            ]
        return []
    if target_chars > 0 and actual_chars < round(target_chars * 0.8):
        return [
            ValidationIssue(
                scope="slide",
                path=f"slides.{slide_index}.speakerNotes",
                message=(
                    "발표 시간 기준보다 발표자 노트가 짧습니다. "
                    f"목표 {target_chars}자 대비 현재 {actual_chars}자입니다."
                ),
            )
        ]
    return []


def validate_slide_source_ledger(
    slide: dict[str, Any],
    slide_index: int,
) -> list[ValidationIssue]:
    ai_notes = slide.get("aiNotes", {})
    if not isinstance(ai_notes, dict):
        return []
    visual_type = str(ai_notes.get("visualPlan", {}).get("visualType", ""))
    if is_structural_slide_type(visual_type):
        return []
    if "visualPlan" not in ai_notes and "timingPlan" not in ai_notes:
        return []
    source_ledger = ai_notes.get("sourceLedger")
    if not isinstance(source_ledger, list) or not source_ledger:
        return [
            ValidationIssue(
                scope="slide",
                path=f"slides.{slide_index}.aiNotes.sourceLedger",
                message="핵심 주장에 대한 sourceLedger가 필요합니다.",
            )
        ]
    if any(item.get("sourceType") == "none" for item in source_ledger if isinstance(item, dict)):
        return [
            ValidationIssue(
                scope="slide",
                path=f"slides.{slide_index}.aiNotes.sourceLedger",
                message="참고자료 우선/전용 정책인데 연결된 근거가 부족합니다.",
            )
        ]
    return []


def validate_slide_visual_slot(
    slide: dict[str, Any],
    slide_index: int,
) -> list[ValidationIssue]:
    visual_plan = slide.get("aiNotes", {}).get("visualPlan")
    if not isinstance(visual_plan, dict) or not visual_plan.get("imageNeeded"):
        return []
    has_visual_slot = any(
        element.get("type") == "image"
        or str(element.get("elementId", "")).endswith("_media_placeholder")
        for element in slide.get("elements", [])
    )
    if has_visual_slot:
        return []
    return [
        ValidationIssue(
            scope="slide",
            path=f"slides.{slide_index}.elements",
            message="이미지/시각 자료 정책이 선택됐지만 보이는 visual slot이 없습니다.",
        )
    ]


def validate_deck_timing_summary(
    deck: dict[str, Any],
    *,
    presentation_rules: bool = False,
) -> list[ValidationIssue]:
    slides = deck.get("slides", [])
    timing_plans = [
        slide.get("aiNotes", {}).get("timingPlan")
        for slide in slides
        if isinstance(slide.get("aiNotes", {}).get("timingPlan"), dict)
    ]
    if not timing_plans:
        return []
    target_total = sum(
        int(plan.get("targetSpeakerNotesChars") or 0)
        for plan in timing_plans
    )
    actual_total = sum(
        count_speaker_note_chars(str(slide.get("speakerNotes", "")))
        for slide in slides
    )
    issues: list[ValidationIssue] = []
    if presentation_rules:
        chars_per_minute = int(timing_plans[0].get("charsPerMinute") or 0)
        duration_minutes = int(deck.get("targetDurationMinutes") or 0)
        minimum_total = round(duration_minutes * chars_per_minute * 0.75)
        maximum_total = round(duration_minutes * chars_per_minute * 0.85)
        if minimum_total > 0 and actual_total < minimum_total:
            issues.append(
                ValidationIssue(
                    code="SPEAKER_NOTES_SHORT",
                    scope="deck",
                    path="slides",
                    message=(
                        "전체 실제 발화 시간이 발표 제한 시간의 75%보다 짧습니다. "
                        f"최소 {minimum_total}자 대비 현재 {actual_total}자입니다."
                    ),
                )
            )
        elif maximum_total > 0 and actual_total > maximum_total:
            issues.append(
                ValidationIssue(
                    code="SPEAKER_NOTES_DENSE",
                    scope="deck",
                    path="slides",
                    message=(
                        "전체 실제 발화 시간이 발표 제한 시간의 85%를 초과합니다. "
                        f"최대 {maximum_total}자 대비 현재 {actual_total}자입니다."
                    ),
                )
            )
    elif target_total > 0 and actual_total < round(target_total * 0.8):
        issues.append(
            ValidationIssue(
                scope="deck",
                path="slides",
                message=(
                    "전체 발표 시간 대비 발표자 노트 분량이 부족합니다. "
                    f"목표 {target_total}자 대비 현재 {actual_total}자입니다."
                ),
            )
        )
    target_duration_seconds = int(deck.get("targetDurationMinutes") or 0) * 60
    allocated_seconds = sum(
        int(plan.get("targetSeconds") or 0) for plan in timing_plans
    )
    if target_duration_seconds > 0 and allocated_seconds != target_duration_seconds:
        issues.append(
            ValidationIssue(
                scope="deck",
                path="slides",
                message=(
                    "슬라이드별 발표 시간 합계가 전체 발표 시간과 다릅니다. "
                    f"목표 {target_duration_seconds}초 대비 현재 {allocated_seconds}초입니다."
                ),
            )
        )
    return issues


def validate_design(deck: dict[str, Any]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for slide_index, slide in enumerate(deck["slides"]):
        elements = slide["elements"]
        background_color = slide.get("style", {}).get(
            "backgroundColor",
            deck.get("theme", {}).get("backgroundColor", "#ffffff"),
        )
        for element_index, element in enumerate(elements):
            element_id = element["elementId"]
            if element_id.endswith("_media_placeholder") and not is_expected_media_placeholder(slide):
                issues.append(
                    ValidationIssue(
                        scope="element",
                        path=f"slides.{slide_index}.elements.{element_index}",
                        message="이미지 소스가 없어 자리 표시자를 생성했습니다.",
                    )
                )
            if (
                element["type"] == "chart"
                and slide.get("style", {}).get("layout") != "chart-focus"
            ):
                issues.append(
                    ValidationIssue(
                        scope="element",
                        path=f"slides.{slide_index}.elements.{element_index}",
                        message="차트 슬라이드가 아닌 곳에 차트 요소가 있습니다.",
                    )
                )
            if element["type"] == "chart" and not element.get("props", {}).get("data"):
                issues.append(
                    ValidationIssue(
                        scope="element",
                        path=f"slides.{slide_index}.elements.{element_index}.props.data",
                        message="근거 데이터가 없어 빈 차트 자리 표시자를 생성했습니다. 에디터에서 데이터를 입력하세요.",
                    )
                )
            if element["type"] == "image" and not str(
                element.get("props", {}).get("alt", "")
            ).strip():
                issues.append(
                    ValidationIssue(
                        scope="element",
                        path=f"slides.{slide_index}.elements.{element_index}.props.alt",
                        message="Image element is missing alt text.",
                    )
                )
            if element["type"] == "text":
                if is_text_overflowing(element) or is_short_label_text_box_too_narrow(
                    element
                ):
                    issues.append(
                        ValidationIssue(
                            code="TEXT_OVERFLOW",
                            scope="element",
                            path=f"slides.{slide_index}.elements.{element_index}",
                            message="텍스트가 상자 높이를 넘을 수 있습니다.",
                        )
                    )
                if text_contrast_requires_attention(element, elements, slide, background_color):
                    issues.append(
                        ValidationIssue(
                            code=text_contrast_issue_code(element, elements, slide, background_color),
                            scope="element",
                            path=f"slides.{slide_index}.elements.{element_index}.props.color",
                            message="텍스트와 배경의 대비가 낮습니다.",
                        )
                    )
                if is_safe_area_text(element):
                    issues.append(
                        ValidationIssue(
                            scope="element",
                            path=f"slides.{slide_index}.elements.{element_index}",
                            message="텍스트가 안전 영역 밖에 배치되었습니다.",
                        )
                    )
        if len(elements) > element_limit_for_slide(slide):
            issues.append(
                ValidationIssue(
                    scope="slide",
                    path=f"slides.{slide_index}.elements",
                    message="슬라이드 요소 밀도가 높아 편집성과 가독성이 떨어질 수 있습니다.",
                )
            )
        for first, second in overlapping_design_pairs(elements):
            issues.append(
                ValidationIssue(
                    scope="slide",
                    path=f"slides.{slide_index}.elements",
                    message=f"{first}와 {second} 요소가 겹칠 수 있습니다.",
                )
            )
        backgrounds = [element for element in elements if element.get("role") == "background"]
        text_elements = [element for element in elements if element["type"] == "text"]
        if backgrounds and text_elements:
            max_background_z = max(element["zIndex"] for element in backgrounds)
            min_text_z = min(element["zIndex"] for element in text_elements)
            if max_background_z >= min_text_z:
                issues.append(
                    ValidationIssue(
                        scope="slide",
                        path=f"slides.{slide_index}.elements",
                        message="배경 요소가 텍스트보다 위에 있습니다.",
                    )
                )
    issues.extend(validate_design_pack_layout_diversity(deck))
    return issues


def validate_design_pack_layout_diversity(
    deck: dict[str, Any],
) -> list[ValidationIssue]:
    slides = deck.get("slides", [])
    if len(slides) < 3 or not all(is_design_pack_slide(slide) for slide in slides):
        return []

    body_slides = slides[1:-1]
    fingerprints = [core_geometry_fingerprint(slide) for slide in body_slides]
    issues: list[ValidationIssue] = []
    if any(
        current == previous
        for previous, current in zip(fingerprints, fingerprints[1:], strict=False)
    ):
        issues.append(
            ValidationIssue(
                code="LAYOUT_GEOMETRY_REPEATED",
                scope="deck",
                severity="warning",
                blocking=False,
                path="slides",
                message="본문 슬라이드에 같은 core geometry가 연속 배치되었습니다.",
            )
        )
    if any(fingerprints.count(fingerprint) > 2 for fingerprint in set(fingerprints)):
        issues.append(
            ValidationIssue(
                code="LAYOUT_GEOMETRY_OVERUSED",
                scope="deck",
                severity="warning",
                blocking=False,
                path="slides",
                message="같은 core geometry가 본문에서 2회를 초과해 사용되었습니다.",
            )
        )
    if len(body_slides) >= 5:
        required_unique = (len(body_slides) * 3 + 3) // 4
        if len(set(fingerprints)) < required_unique:
            issues.append(
                ValidationIssue(
                    code="LAYOUT_DIVERSITY_LOW",
                    scope="deck",
                    severity="warning",
                    blocking=False,
                    path="slides",
                    message=(
                        "본문 core geometry 다양성이 부족합니다. "
                        f"최소 {required_unique}개가 필요합니다."
                    ),
                )
            )
    return issues






def is_expected_media_placeholder(slide: dict[str, Any]) -> bool:
    visual_plan = slide.get("aiNotes", {}).get("visualPlan")
    if not isinstance(visual_plan, dict):
        return False
    return bool(visual_plan.get("imageNeeded")) and str(
        visual_plan.get("imageSourcePolicy", "")
    ) in {"ai-generated", "public-assets", "official-assets", "placeholder-ok"}


def estimated_text_content_height(
    element: dict[str, Any],
    *,
    width_padding: float = 0,
) -> float:
    props = element.get("props", {})
    text = str(props.get("text", ""))
    if not text:
        return 0

    font_size = float(props.get("fontSize", 24))
    line_height = float(props.get("lineHeight", 1.2))
    width = max(1.0, float(element.get("width", 1)) - width_padding)
    if element.get("role") == "title":
        width *= 0.88
    estimated_lines = sum(
        estimated_wrapped_line_count(element, line, width)
        for line in text.splitlines() or [text]
    )
    return estimated_lines * font_size * line_height


def estimated_wrapped_line_count(
    element: dict[str, Any],
    text: str,
    width: float,
) -> int:
    tokens = re.findall(r"\S+\s*", text)
    if not tokens:
        return 1
    lines = 0
    current_width = 0.0
    for token in tokens:
        token_width = estimated_single_line_text_width(element, token)
        if token and token[-1].isspace():
            token_width += float(element.get("props", {}).get("fontSize", 24)) * 0.33
        if token_width > width:
            if current_width > 0:
                lines += 1
                current_width = 0.0
            fragments = max(1, math.ceil(token_width / width))
            lines += fragments - 1
            current_width = token_width - width * (fragments - 1)
            continue
        if current_width > 0 and current_width + token_width > width:
            lines += 1
            current_width = token_width
        else:
            current_width += token_width
    return lines + int(current_width > 0)


def is_text_overflowing(element: dict[str, Any]) -> bool:
    height = float(element.get("height", 1))
    return estimated_text_content_height(element) > height * 1.08


def is_text_editor_overflow_risk(element: dict[str, Any]) -> bool:
    height = float(element.get("height", 1))
    return estimated_text_content_height(element, width_padding=8) > max(1, height - 8)


def estimated_single_line_text_width(
    element: dict[str, Any],
    text: str | None = None,
) -> float:
    props = element.get("props", {})
    normalized_text = re.sub(
        r"\s+",
        " ",
        str(props.get("text", "") if text is None else text),
    ).strip()
    font_size = float(props.get("fontSize", 24))
    width_factor = font_width_factor_from_element(element)
    width = 0.0
    for character in normalized_text:
        if character.isspace():
            width += font_size * 0.33
        elif re.match(r"[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af]", character):
            width += font_size
        else:
            width += font_size * 0.55
    return width * width_factor


def is_short_label_text_box_too_narrow(element: dict[str, Any]) -> bool:
    if element.get("type") != "text" or element.get("role") not in {
        "caption",
        "highlight",
    }:
        return False
    raw_text = str(element.get("props", {}).get("text", ""))
    text = re.sub(r"\s+", " ", raw_text).strip()
    if not text or len(text) > 36 or len(text.split()) > 5:
        return False
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()] or [text]
    return max(estimated_single_line_text_width(element, line) for line in lines) + 8 > float(
        element.get("width", 1)
    )


def font_width_factor_from_element(element: dict[str, Any]) -> float:
    font_family = str(element.get("props", {}).get("fontFamily", "")).casefold()
    if "gmarket" in font_family:
        return 1.18
    if "nanumsquareround" in font_family or "gowun" in font_family:
        return 1.1
    if "noto sans kr" in font_family:
        return 1.04
    return 1.0


def is_low_contrast_text(element: dict[str, Any], background_color: str) -> bool:
    color = element.get("props", {}).get("color")
    if not is_hex_color(color) or not is_hex_color(background_color):
        return False
    return contrast_ratio(color, background_color) < 4.5


def text_contrast_requires_attention(
    element: dict[str, Any],
    elements: list[dict[str, Any]],
    slide: dict[str, Any],
    slide_background_color: str,
) -> bool:
    kind, background_color = effective_text_background(
        element,
        elements,
        slide_background_color,
        has_slide_background_image=bool(
            slide.get("style", {}).get("backgroundImage")
        ),
    )
    return kind == "unverifiable" or is_low_contrast_text(
        element,
        background_color or "",
    )


def text_contrast_issue_code(
    element: dict[str, Any],
    elements: list[dict[str, Any]],
    slide: dict[str, Any],
    slide_background_color: str,
) -> str:
    kind, _ = effective_text_background(
        element,
        elements,
        slide_background_color,
        has_slide_background_image=bool(
            slide.get("style", {}).get("backgroundImage")
        ),
    )
    return (
        "TEXT_CONTRAST_UNVERIFIABLE"
        if kind == "unverifiable"
        else "TEXT_CONTRAST_LOW"
    )


def effective_text_background(
    text_element: dict[str, Any],
    elements: list[dict[str, Any]],
    slide_background_color: str,
    *,
    has_slide_background_image: bool = False,
) -> tuple[Literal["solid", "unverifiable"], str | None]:
    supported_shape_types = {
        "rect",
        "ellipse",
        "polygon",
        "star",
        "ring",
        "customShape",
    }
    candidates = sorted(
        (
            candidate
            for candidate in elements
            if candidate is not text_element
            and candidate.get("visible", True)
            and int(candidate.get("zIndex", 0))
            < int(text_element.get("zIndex", 0))
            and candidate.get("type") in {*supported_shape_types, "image", "svg"}
            and text_background_coverage(text_element, candidate) >= 0.5
        ),
        key=lambda candidate: int(candidate.get("zIndex", 0)),
        reverse=True,
    )
    for candidate in candidates:
        if candidate.get("type") in {"image", "svg"}:
            return "unverifiable", None
        fill = candidate.get("props", {}).get("fill", "transparent")
        if fill == "transparent":
            continue
        opacity = float(candidate.get("opacity", 1))
        if opacity < 1:
            verified_background = guaranteed_contrast_overlay_background(
                text_element,
                fill,
                opacity,
            )
            if verified_background:
                return "solid", verified_background
            return "unverifiable", None
        if is_hex_color(fill):
            return "solid", str(fill)
        return "unverifiable", None
    if has_slide_background_image:
        return "unverifiable", None
    if is_hex_color(slide_background_color):
        return "solid", slide_background_color
    return "unverifiable", None


def guaranteed_contrast_overlay_background(
    text_element: dict[str, Any],
    overlay_fill: Any,
    opacity: float,
) -> str | None:
    text_color = text_element.get("props", {}).get("color")
    if not is_hex_color(text_color) or not is_hex_color(overlay_fill):
        return None
    if not 0 < opacity < 1:
        return None

    backgrounds = (
        composite_hex_color(str(overlay_fill), "#000000", opacity),
        composite_hex_color(str(overlay_fill), "#FFFFFF", opacity),
    )
    ratios = [contrast_ratio(str(text_color), background) for background in backgrounds]
    if min(ratios) < 4.5:
        return None
    return backgrounds[ratios.index(min(ratios))]


def composite_hex_color(foreground: str, background: str, opacity: float) -> str:
    foreground_rgb = tuple(
        int(foreground[index : index + 2], 16) for index in (1, 3, 5)
    )
    background_rgb = tuple(
        int(background[index : index + 2], 16) for index in (1, 3, 5)
    )
    channels = (
        round(foreground_channel * opacity + background_channel * (1 - opacity))
        for foreground_channel, background_channel in zip(
            foreground_rgb,
            background_rgb,
            strict=True,
        )
    )
    return "#" + "".join(f"{channel:02X}" for channel in channels)


def text_background_coverage(
    text_element: dict[str, Any],
    background_element: dict[str, Any],
) -> float:
    text_left = float(text_element.get("x", 0))
    text_top = float(text_element.get("y", 0))
    text_width = max(1.0, float(text_element.get("width", 1)))
    text_height = max(1.0, float(text_element.get("height", 1)))
    background_left = float(background_element.get("x", 0))
    background_top = float(background_element.get("y", 0))
    intersection_width = max(
        0.0,
        min(
            text_left + text_width,
            background_left + float(background_element.get("width", 1)),
        )
        - max(text_left, background_left),
    )
    intersection_height = max(
        0.0,
        min(
            text_top + text_height,
            background_top + float(background_element.get("height", 1)),
        )
        - max(text_top, background_top),
    )
    return intersection_width * intersection_height / (text_width * text_height)


def is_hex_color(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", value) is not None


def is_safe_area_text(element: dict[str, Any]) -> bool:
    if element.get("role") == "footer":
        return False
    x = float(element.get("x", 0))
    y = float(element.get("y", 0))
    width = float(element.get("width", 1))
    height = float(element.get("height", 1))
    return (
        x < CANVAS.safe_x
        or y < CANVAS.safe_y
        or x + width > CANVAS.safe_x + CANVAS.safe_width
        or y + height > CANVAS.safe_y + CANVAS.safe_height
    )


def overlapping_design_pairs(elements: list[dict[str, Any]]) -> list[tuple[str, str]]:
    visible = [
        element
        for element in elements
        if element.get("visible", True)
        and element.get("role") != "background"
        and element.get("type") in {"text", "image", "chart"}
    ]
    pairs: list[tuple[str, str]] = []
    for index, first in enumerate(visible):
        for second in visible[index + 1 :]:
            if overlap_ratio(first, second) > 0.18:
                pairs.append((first["elementId"], second["elementId"]))
    return pairs[:3]


def overlap_ratio(first: dict[str, Any], second: dict[str, Any]) -> float:
    first_x = float(first.get("x", 0))
    first_y = float(first.get("y", 0))
    first_width = float(first.get("width", 1))
    first_height = float(first.get("height", 1))
    second_x = float(second.get("x", 0))
    second_y = float(second.get("y", 0))
    second_width = float(second.get("width", 1))
    second_height = float(second.get("height", 1))
    left = max(first_x, second_x)
    top = max(first_y, second_y)
    right = min(first_x + first_width, second_x + second_width)
    bottom = min(first_y + first_height, second_y + second_height)
    if right <= left or bottom <= top:
        return 0.0

    intersection = (right - left) * (bottom - top)
    smaller_area = min(first_width * first_height, second_width * second_height)
    return intersection / max(1, smaller_area)


def validate_presentation(deck: dict[str, Any]) -> list[ValidationIssue]:
    if len(deck["slides"]) < 1:
        return [
            ValidationIssue(
                scope="deck",
                path="slides",
                message="덱에는 슬라이드가 최소 1장 필요합니다.",
            )
        ]
    profile = deck.get("metadata", {}).get("presentationProfile")
    if profile not in PRESENTATION_PROFILE_BEATS:
        return []

    issues: list[ValidationIssue] = []
    for slide_index, slide in enumerate(deck["slides"]):
        visual_type = str(
            slide.get("aiNotes", {}).get("visualPlan", {}).get("visualType", "")
        )
        if (
            slide_index > 0
            and not is_structural_slide_type(visual_type)
            and visual_type not in {"quote", "summary"}
        ):
            if action_title_requires_attention(str(slide.get("title", ""))):
                issues.append(
                    ValidationIssue(
                        code="ACTION_TITLE_WEAK",
                        scope="slide",
                        path=f"slides.{slide_index}.title",
                        message="본문 슬라이드 제목은 40자 이내의 결론형 문장이어야 합니다.",
                    )
                )
        issues.extend(validate_slide_content_density(slide, slide_index, visual_type))
        issues.extend(validate_slide_content_duplication(slide, slide_index))
        hierarchy_issues = validate_slide_visual_hierarchy(
            slide,
            slide_index,
            visual_type,
        )
        issues.extend(hierarchy_issues)
        if not hierarchy_issues:
            issues.extend(
                validate_slide_visual_occupancy(slide, slide_index, visual_type)
            )
        issues.extend(validate_slide_typography(slide, slide_index))
        issues.extend(validate_slide_grid_alignment(slide, slide_index))

    font_families = {
        str(element.get("props", {}).get("fontFamily", "")).strip().casefold()
        for slide in deck["slides"]
        for element in slide.get("elements", [])
        if element.get("visible", True)
        and element.get("type") == "text"
        and str(element.get("props", {}).get("fontFamily", "")).strip()
    }
    if len(font_families) > 2:
        issues.append(
            ValidationIssue(
                code="FONT_FAMILY_OVERUSED",
                scope="deck",
                path="slides",
                message="발표 자료에는 최대 두 개의 글꼴 패밀리만 사용할 수 있습니다.",
            )
        )

    if profile in {"proposal", "product-launch", "executive-report"}:
        closing = deck["slides"][-1]
        has_thank_you_closing = is_thank_you_closing(closing)
        closing_text = visible_slide_text(closing)
        if not has_thank_you_closing and not has_profile_closing_action(
            closing_text.casefold(),
            profile,
        ):
            issues.append(
                ValidationIssue(
                    code="CTA_MISSING",
                    scope="slide",
                    path=f"slides.{len(deck['slides']) - 1}",
                    message=(
                        "마지막 슬라이드에 결정 또는 승인 요청이 필요합니다."
                        if profile == "executive-report"
                        else "마지막 슬라이드에 구체적인 다음 행동이 필요합니다."
                    ),
                )
            )
    return issues






def validate_slide_content_duplication(
    slide: dict[str, Any],
    slide_index: int,
) -> list[ValidationIssue]:
    candidates = [
        element
        for element in slide.get("elements", [])
        if element.get("visible", True)
        and element.get("type") == "text"
        and element.get("role") in {"subtitle", "body", "highlight"}
        and len(
            normalize_structural_content_text(
                str(element.get("props", {}).get("text", ""))
            )
        )
        >= 6
    ]
    keys = {
        str(element.get("elementId", "")): normalize_structural_content_text(
            str(element.get("props", {}).get("text", ""))
        )
        for element in candidates
    }
    duplicate_ids: set[str] = set()
    grouped: dict[str, list[str]] = {}
    for element_id, key in keys.items():
        grouped.setdefault(key, []).append(element_id)
    for element_ids in grouped.values():
        if len(element_ids) > 1:
            duplicate_ids.update(element_ids)

    for primary_id, primary_key in keys.items():
        supporting = [
            (element_id, key)
            for element_id, key in keys.items()
            if element_id != primary_id and key in primary_key
        ]
        if len(supporting) < 2 or sum(len(key) for _, key in supporting) < len(
            primary_key
        ) * 0.8:
            continue
        duplicate_ids.add(primary_id)
        duplicate_ids.update(element_id for element_id, _ in supporting)

    if not duplicate_ids:
        return []
    return [
        ValidationIssue(
            code="CONTENT_DUPLICATED",
            scope="slide",
            path=f"slides.{slide_index}.elements",
            message="같은 핵심 내용이 본문 요소에 구조적으로 반복되어 있습니다.",
        )
    ]


def validate_slide_content_density(
    slide: dict[str, Any],
    slide_index: int,
    visual_type: str,
) -> list[ValidationIssue]:
    if visual_type in {"cover", "quote"} or slide.get("style", {}).get("layout") in {
        "chart-focus",
        "quote",
    }:
        return []
    body_elements = visible_text_elements_for_roles(slide, {"body", "highlight"})
    too_many_lines = any(estimated_text_line_count(element) > 6 for element in body_elements)
    if not too_many_lines:
        return []
    return [
        ValidationIssue(
            code="BODY_CONTENT_DENSE",
            scope="slide",
            path=f"slides.{slide_index}.elements",
            message="본문 텍스트 박스는 실제 렌더링 기준 6줄 이내여야 합니다.",
        )
    ]


def validate_slide_visual_hierarchy(
    slide: dict[str, Any],
    slide_index: int,
    visual_type: str,
) -> list[ValidationIssue]:
    if visual_type in {"cover", "quote"} or is_cover_composition_slide(slide):
        return []
    visible_elements = [
        element for element in slide.get("elements", []) if element.get("visible", True)
    ]
    content_elements = [
        element
        for element in visible_elements
        if (
            element.get("type") == "text"
            and element.get("role") in {"body", "highlight"}
            and str(element.get("props", {}).get("text", "")).strip()
        )
        or element.get("type") in {"image", "chart"}
        or element.get("role") == "media"
    ]
    primary_visuals = [
        element
        for element in visible_elements
        if element.get("type") in {"image", "chart"} or element.get("role") == "media"
    ]
    if content_elements and len(primary_visuals) <= 1:
        return []
    return [
        ValidationIssue(
            code="VISUAL_HIERARCHY_WEAK",
            scope="slide",
            path=f"slides.{slide_index}.elements",
            message="본문 슬라이드에는 하나의 명확한 시각적 중심 요소가 필요합니다.",
        )
    ]


def validate_slide_visual_occupancy(
    slide: dict[str, Any],
    slide_index: int,
    visual_type: str,
) -> list[ValidationIssue]:
    if is_cover_composition_slide(slide):
        return []
    visible = [
        element
        for element in slide.get("elements", [])
        if element.get("visible", True)
    ]
    media = [
        element
        for element in visible
        if element.get("role") == "media"
        or element.get("type") in {"image", "chart"}
    ]
    has_planned_media = bool(
        slide.get("aiNotes", {}).get("visualPlan", {}).get("imageNeeded")
    )
    composition_id = str(
        slide.get("aiNotes", {}).get("compositionPlan", {}).get("compositionId", "")
    )
    minimum_media_height = 272 if composition_id == "editorial-media-band" else 420
    core = [
        element
        for element in visible
        if is_visual_quality_core_element(element)
    ]
    reasons: list[str] = []
    if has_planned_media:
        if not media or any(
            float(element.get("width", 0)) < 686
            or float(element.get("height", 0)) < minimum_media_height
            for element in media
        ):
            reasons.append(
                f"이미지 영역은 최소 5열 너비와 {minimum_media_height}px 높이가 필요합니다."
            )
    if core and (has_planned_media or visual_type not in {"cover", "quote"}):
        left = min(float(element.get("x", 0)) for element in core)
        top = min(float(element.get("y", 0)) for element in core)
        right = max(
            float(element.get("x", 0)) + float(element.get("width", 0))
            for element in core
        )
        bottom = max(
            float(element.get("y", 0)) + float(element.get("height", 0))
            for element in core
        )
        minimum_width_ratio = 0.85 if has_planned_media else 0.7
        minimum_height_ratio = 0.55 if has_planned_media else 0.4
        if (
            right - left < CANVAS.safe_width * minimum_width_ratio - GRID_TOLERANCE
            or bottom - top
            < CANVAS.safe_height * minimum_height_ratio - GRID_TOLERANCE
        ):
            reasons.append("핵심 콘텐츠가 안전 영역을 충분히 점유하지 않습니다.")
    if any(is_meaningless_large_decoration(element, visible) for element in visible):
        reasons.append("의미 없는 대형 장식 요소가 콘텐츠보다 큰 비중을 차지합니다.")
    if not reasons:
        return []
    return [
        ValidationIssue(
            code="VISUAL_HIERARCHY_WEAK",
            scope="slide",
            path=f"slides.{slide_index}.elements",
            message=" ".join(reasons),
        )
    ]


def is_visual_quality_core_element(element: dict[str, Any]) -> bool:
    role = str(element.get("role", ""))
    if role in {"body", "highlight", "media"}:
        return True
    return element.get("type") in {"image", "chart"}


def is_meaningless_large_decoration(
    element: dict[str, Any],
    elements: list[dict[str, Any]],
) -> bool:
    if element.get("role") != "decoration" or is_full_bleed_element(element):
        return False
    if element_area(element) <= CANVAS.safe_width * CANVAS.safe_height * 0.12:
        return False
    return not any(
        candidate is not element
        and candidate.get("type") == "text"
        and candidate.get("visible", True)
        and text_background_coverage(candidate, element) >= 0.75
        for candidate in elements
    )


def visible_text_elements_for_roles(
    slide: dict[str, Any],
    roles: set[str],
) -> list[dict[str, Any]]:
    return [
        element
        for element in slide.get("elements", [])
        if element.get("visible", True)
        and element.get("type") == "text"
        and element.get("role") in roles
        and str(element.get("props", {}).get("text", "")).strip()
    ]


def validate_slide_typography(
    slide: dict[str, Any],
    slide_index: int,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for element_index, element in enumerate(slide.get("elements", [])):
        if not element.get("visible", True) or element.get("type") != "text":
            continue
        role = str(element.get("role", ""))
        props = element.get("props", {})
        font_size = float(props.get("fontSize", 24))
        minimum_size = design_pack_minimum_font_size(slide_index, role)
        if font_size < minimum_size:
            issues.append(
                ValidationIssue(
                    code="FONT_SIZE_BELOW_MINIMUM",
                    scope="element",
                    path=f"slides.{slide_index}.elements.{element_index}.props.fontSize",
                    message=f"{role or 'text'} 텍스트는 최소 {minimum_size}pt가 필요합니다.",
                )
            )
        line_height = float(props.get("lineHeight", 1.2))
        if role == "title":
            valid_line_height = 1.05 <= line_height <= 1.2
        elif role in {"body", "highlight", "subtitle"}:
            valid_line_height = 1.2 <= line_height <= 1.3
        else:
            valid_line_height = True
        if not valid_line_height:
            issues.append(
                ValidationIssue(
                    code="LINE_HEIGHT_OUT_OF_RANGE",
                    scope="element",
                    path=f"slides.{slide_index}.elements.{element_index}.props.lineHeight",
                    message="제목과 본문의 역할별 권장 행간 범위를 벗어났습니다.",
                )
            )
    return issues


def estimated_text_line_count(element: dict[str, Any]) -> int:
    props = element.get("props", {})
    line_height = max(0.1, float(props.get("lineHeight", 1.2)))
    font_size = max(1.0, float(props.get("fontSize", 24)))
    return max(
        1,
        math.ceil(estimated_text_content_height(element) / (font_size * line_height)),
    )


def visible_slide_text(slide: dict[str, Any]) -> str:
    parts = [str(slide.get("title", ""))]
    parts.extend(
        str(element.get("props", {}).get("text", ""))
        for element in slide.get("elements", [])
        if element.get("visible", True)
        and element.get("type") == "text"
        and element.get("role") not in {"caption", "footer"}
    )
    return " ".join(part for part in parts if part.strip())


def is_thank_you_closing(slide: dict[str, Any]) -> bool:
    visual_type = str(
        slide.get("aiNotes", {}).get("visualPlan", {}).get("visualType", "")
    )
    if visual_type != "closing":
        return False
    if not is_short_closing_copy(str(slide.get("title", ""))):
        return False

    visible_copy = [
        str(element.get("props", {}).get("text", ""))
        for element in slide.get("elements", [])
        if element.get("visible", True)
        and element.get("type") == "text"
        and element.get("role") not in {"caption", "footer"}
        and str(element.get("props", {}).get("text", "")).strip()
    ]
    return all(is_short_closing_copy(text) for text in visible_copy)


def is_short_closing_copy(value: str) -> bool:
    normalized = normalize_structural_content_text(value)
    if not normalized or len(normalized) > 60:
        return False
    exact_copy = {
        "thankyou",
        "thanks",
        "마무리",
        "끝",
        "이상입니다",
    }
    closing_suffixes = (
        "감사합니다",
        "고맙습니다",
        "마치겠습니다",
        "마칩니다",
        "마무리하겠습니다",
    )
    return normalized in exact_copy or normalized.endswith(closing_suffixes)


def is_design_pack_grid_element(
    element: dict[str, Any],
    elements: list[dict[str, Any]],
) -> bool:
    if not element.get("visible", True) or is_full_bleed_element(element):
        return False
    role = str(element.get("role", ""))
    element_id = str(element.get("elementId", ""))
    if role in {"background", "footer"}:
        return False
    if any(
        token in element_id
        for token in ("_card_", "_accent", "_divider", "_number", "_label")
    ):
        return False
    if role in {"title", "media"} or element.get("type") == "chart":
        return True
    if role in {"body", "subtitle"}:
        return not is_contained_by_grid_panel(element, elements)
    return (
        role == "highlight"
        and element.get("type") != "text"
        and float(element.get("width", 0)) >= 400
        and float(element.get("height", 0)) >= 120
        and any(token in element_id for token in ("_panel", "_block"))
    )


def is_full_bleed_element(element: dict[str, Any]) -> bool:
    return (
        float(element.get("x", 0)) <= 0
        and float(element.get("y", 0)) <= 0
        and float(element.get("width", 0)) >= CANVAS.width
        and float(element.get("height", 0)) >= CANVAS.height
    )


def is_contained_by_grid_panel(
    element: dict[str, Any],
    elements: list[dict[str, Any]],
) -> bool:
    return any(
        candidate is not element
        and candidate.get("visible", True)
        and candidate.get("type") != "text"
        and (
            candidate.get("role") == "highlight"
            or (
                candidate.get("role") == "decoration"
                and "_program_v2_" in str(candidate.get("elementId", ""))
                and str(candidate.get("elementId", "")).endswith("_field")
            )
        )
        and text_background_coverage(element, candidate) >= 0.9
        for candidate in elements
    )


def validate_slide_grid_alignment(
    slide: dict[str, Any],
    slide_index: int,
) -> list[ValidationIssue]:
    if is_cover_composition_slide(slide):
        return []
    elements = slide.get("elements", [])
    for element_index, element in enumerate(elements):
        if not is_design_pack_grid_element(element, elements):
            continue
        if is_grid_aligned(element):
            continue
        return [
            ValidationIssue(
                code="GRID_ALIGNMENT_INCONSISTENT",
                scope="element",
                path=f"slides.{slide_index}.elements.{element_index}",
                message="핵심 레이아웃 요소가 12열 grid와 8px 간격 기준에서 벗어났습니다.",
            )
        ]
    return []


def is_cover_composition_slide(slide: dict[str, Any]) -> bool:
    composition_id = str(
        slide.get("aiNotes", {}).get("compositionPlan", {}).get("compositionId", "")
    )
    return composition_id.startswith(("cover-", "agenda-", "closing-"))


def is_grid_aligned(element: dict[str, Any]) -> bool:
    x = float(element.get("x", 0))
    width = float(element.get("width", 1))
    horizontal = any(
        abs(candidate_x - x) <= GRID_TOLERANCE
        and abs(candidate_width - width) <= GRID_TOLERANCE
        for candidate_x, candidate_width in (
            (
                CANVAS.safe_x + column * GRID_STEP,
                span * GRID_COLUMN_WIDTH + (span - 1) * GRID_GUTTER,
            )
            for column in range(GRID_COLUMN_COUNT)
            for span in range(1, GRID_COLUMN_COUNT - column + 1)
        )
    )
    y = float(element.get("y", 0))
    height = float(element.get("height", 1))
    vertical = (
        distance_to_spacing(y, GRID_SPACING) <= GRID_TOLERANCE
        and distance_to_spacing(height, GRID_SPACING) <= GRID_TOLERANCE
    )
    return horizontal and vertical


def distance_to_spacing(value: float, spacing: int) -> float:
    return abs(value - round(value / spacing) * spacing)


def patch_deck(deck: dict[str, Any]) -> dict[str, Any]:
    for slide in deck["slides"]:
        slide["elements"] = cap_elements(
            slide["elements"],
            limit=element_limit_for_slide(slide),
        )
        for element in slide["elements"]:
            element["x"] = max(0, min(element["x"], CANVAS.width - 1))
            element["y"] = max(0, min(element["y"], CANVAS.height - 1))
            element["width"] = max(1, min(element["width"], CANVAS.width - element["x"]))
            element["height"] = max(1, min(element["height"], CANVAS.height - element["y"]))
    return deck


def repair_program_v2_deck(deck: dict[str, Any]) -> dict[str, Any]:
    for slide in deck["slides"]:
        if not isinstance(slide.get("aiNotes", {}).get("compositionPlan"), dict):
            continue
        for element in slide["elements"]:
            if element.get("type") == "text":
                repair_program_v2_text_element(element)
    return patch_deck(deck)


def repair_program_v2_text_element(element: dict[str, Any]) -> None:
    props = element.get("props", {})
    if not str(props.get("text", "")).strip():
        return
    minimum_font_size = design_pack_minimum_font_size_for_element(element)
    minimum_line_height = design_pack_minimum_line_height(
        str(element.get("role", ""))
    )
    for _ in range(16):
        if not (
            is_text_editor_overflow_risk(element)
            or is_short_label_text_box_too_narrow(element)
        ):
            return
        font_size = float(props.get("fontSize", 24))
        if font_size <= minimum_font_size:
            return
        props["fontSize"] = max(minimum_font_size, round(font_size * 0.9))
        props["lineHeight"] = max(
            minimum_line_height,
            round(float(props.get("lineHeight", 1.2)) - 0.03, 2),
        )


def refine_design_issues(
    deck: dict[str, Any],
    design_issues: list[ValidationIssue],
) -> dict[str, Any]:
    if not design_issues:
        return deck

    element_paths = design_issue_element_paths(design_issues)
    if not element_paths:
        return deck

    refined = deepcopy(deck)
    for slide_index, element_index in element_paths:
        if slide_index >= len(refined["slides"]):
            continue
        slide = refined["slides"][slide_index]
        if element_index >= len(slide["elements"]):
            continue
        element = slide["elements"][element_index]
        if element["type"] != "text":
            continue
        slide_background_color = slide.get("style", {}).get(
            "backgroundColor",
            refined.get("theme", {}).get("backgroundColor", "#ffffff"),
        )
        if refined.get("metadata", {}).get("presentationProfile"):
            shrink_text_to_fit(
                element,
                minimum_font_size=design_pack_minimum_font_size(
                    slide_index,
                    str(element.get("role", "")),
                ),
                minimum_line_height=design_pack_minimum_line_height(
                    str(element.get("role", ""))
                ),
            )
        else:
            shrink_text_to_fit(element)
        if should_clamp_text_to_safe_area(element):
            clamp_text_to_safe_area(element)
        contrast_kind, effective_background = effective_text_background(
            element,
            slide["elements"],
            slide_background_color,
            has_slide_background_image=bool(
                slide.get("style", {}).get("backgroundImage")
            ),
        )
        if contrast_kind == "solid" and effective_background:
            correct_text_contrast(element, effective_background)
    return refined


def design_issue_element_paths(
    design_issues: list[ValidationIssue],
) -> set[tuple[int, int]]:
    paths: set[tuple[int, int]] = set()
    for issue in design_issues:
        match = re.search(r"slides\.(\d+)\.elements\.(\d+)", issue.path)
        if match:
            paths.add((int(match.group(1)), int(match.group(2))))
    return paths


def shrink_text_to_fit(
    element: dict[str, Any],
    *,
    minimum_font_size: float = 12,
    minimum_line_height: float = 1.0,
) -> None:
    props = element.get("props", {})
    for _ in range(8):
        if not is_text_overflowing(element):
            return
        font_size = float(props.get("fontSize", 24))
        if font_size <= minimum_font_size:
            return
        props["fontSize"] = max(minimum_font_size, round(font_size * 0.9))
        props["lineHeight"] = max(
            minimum_line_height,
            round(float(props.get("lineHeight", 1.2)) - 0.05, 2),
        )


def design_pack_minimum_font_size(slide_index: int, role: str) -> int:
    if role == "title":
        return 44 if slide_index == 0 else 32
    if role in {"body", "highlight", "subtitle"}:
        return 18
    if role == "caption":
        return 14
    if role == "footer":
        return 12
    return 12


def design_pack_minimum_font_size_for_element(element: dict[str, Any]) -> int:
    element_id = str(element.get("elementId", ""))
    slide_index = 0 if element_id.startswith("el_1_") else 1
    return design_pack_minimum_font_size(slide_index, str(element.get("role", "")))


def design_pack_minimum_line_height(role: str) -> float:
    if role == "title":
        return 1.05
    if role in {"body", "highlight", "subtitle"}:
        return 1.2
    return 1.0


def clamp_text_to_safe_area(element: dict[str, Any]) -> None:
    element["width"] = min(element["width"], CANVAS.safe_width)
    element["height"] = min(element["height"], CANVAS.safe_height)
    element["x"] = min(
        max(element["x"], CANVAS.safe_x),
        CANVAS.safe_x + CANVAS.safe_width - element["width"],
    )
    element["y"] = min(
        max(element["y"], CANVAS.safe_y),
        CANVAS.safe_y + CANVAS.safe_height - element["height"],
    )


def should_clamp_text_to_safe_area(element: dict[str, Any]) -> bool:
    return element.get("role") not in {"caption", "footer"}


def correct_text_contrast(element: dict[str, Any], background_color: str) -> None:
    props = element.get("props", {})
    color = props.get("color")
    if not is_hex_color(color) or not is_hex_color(background_color):
        return
    if contrast_ratio(color, background_color) < 4.5:
        props["color"] = text_color_for_background(background_color)


def review_python_quality(stage_input: PythonQualityInput) -> PythonQualityResult:
    deck = stage_input.deck
    validation = ValidationResult(
        passed=not (
            validate_layout(deck)
            or validate_content(deck)
            or validate_presentation(deck)
        ),
        layoutIssues=validate_layout(deck),
        contentIssues=validate_content(deck),
        designIssues=validate_design(deck),
        presentationIssues=validate_presentation(deck),
    )
    return PythonQualityResult(deck=deck, validation=validation)


def refine_python_quality(
    stage_input: PythonQualityInput,
    *,
    client: Any | None = None,
    model: str | None = None,
    api_key: str | None = None,
    image_review_mode: ImageReviewMode = "auto",
) -> PythonQualityResult:
    reviewer_validation = stage_input.reviewer_validation
    if reviewer_validation is None:
        raise ValueError("reviewerValidation is required for quality refinement")
    deck = stage_input.deck
    refined_deck = refine_design_issues(deck, reviewer_validation.design_issues)
    refined_deck, validation = validate_and_patch(refined_deck)
    text_overlap_candidates = detect_text_overlap_candidates(refined_deck)
    overlap_issues = review_text_overlap_candidates(
        refined_deck,
        text_overlap_candidates,
        client=client,
        model=model,
        api_key=api_key,
        image_review_mode=image_review_mode,
    )
    validation.layout_issues.extend(overlap_issues)
    validation.passed = not (
        validation.layout_issues
        or validation.content_issues
        or validation.presentation_issues
    )
    return PythonQualityResult(deck=refined_deck, validation=validation)


def finalize_python_quality(stage_input: PythonQualityInput) -> PythonQualityResult:
    deck = stage_input.deck
    raw_input = stage_input.raw_input
    finalized_deck = enforce_design_pack_constraints(deck, raw_input)
    finalized_deck = repair_program_v2_deck(finalized_deck)
    finalized_deck, validation = validate_and_patch(
        finalized_deck,
        include_design_in_passed=True,
    )
    return PythonQualityResult(deck=finalized_deck, validation=validation)
