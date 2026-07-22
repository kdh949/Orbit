from __future__ import annotations

import json
from typing import Any

from app.ai.composition_library import CompiledComposition
from app.ai.design_program import DeckDesignProgram, SlideCompositionDirection
from app.ai.deck_generation.content_planning import (
    count_speaker_note_chars,
    target_speaker_notes_chars_for_slide,
)
from app.ai.deck_generation.design_planning import (
    program_v2_slide_summary,
)
from app.ai.deck_generation.design_pack_rollout import (
    compile_with_design_pack_rollout,
)
from app.ai.deck_generation.models import (
    CANVAS,
    DeckContentGenerationError,
    DesignPlan,
    LayoutCompileResult,
    RawInput,
    SlidePlan,
)
from app.ai.deck_generation.source_grounding import (
    design_pack_source_ledgers,
)


def is_canvas_background_element(element: dict[str, Any]) -> bool:
    return (
        element.get("role") == "background"
        and float(element.get("x", 0)) <= 0
        and float(element.get("y", 0)) <= 0
        and float(element.get("width", 0)) >= CANVAS.width
        and float(element.get("height", 0)) >= CANVAS.height
    )


def without_canvas_background_elements(
    elements: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    return [
        element for element in elements if not is_canvas_background_element(element)
    ]


def assemble_program_v2_slide(
    raw_input: RawInput,
    slide_plan: SlidePlan,
    theme: dict[str, Any],
    program: DeckDesignProgram,
    direction: SlideCompositionDirection,
) -> dict[str, Any]:
    summary = program_v2_slide_summary(slide_plan)
    compiled: CompiledComposition = compile_with_design_pack_rollout(
        direction,
        summary,
        program,
    )
    elements = cap_elements(
        without_canvas_background_elements(compiled.elements),
        limit=48,
    )
    if slide_plan.order != 1:
        build_design_pack_content_manifest(slide_plan, elements)
    for element in elements:
        element.pop("_contentItemIds", None)
    title_element = next(element for element in elements if element["role"] == "title")
    slide_id = f"slide_{slide_plan.order}"
    return {
        "slideId": slide_id,
        "order": slide_plan.order,
        "title": slide_plan.title,
        "thumbnailUrl": "",
        "style": {
            "layout": compiled.layout,
            "backgroundColor": compiled.background_color,
            "textColor": str(
                next(
                    element["props"]["color"]
                    for element in elements
                    if element["elementId"] == title_element["elementId"]
                )
            ),
            "accentColor": program.palette_roles.focal,
        },
        "estimatedSeconds": (
            slide_plan.target_seconds or raw_input.timing_plan.target_seconds_per_slide
        ),
        "speakerNotes": slide_plan.speaker_notes,
        "elements": elements,
        "keywords": [
            {
                "keywordId": f"kw_{slide_plan.order}_{index}",
                "text": keyword,
                "synonyms": [],
                "abbreviations": [],
            }
            for index, keyword in enumerate(slide_plan.keywords, start=1)
        ],
        "animations": [],
        "aiNotes": program_v2_ai_notes(
            raw_input,
            slide_plan,
            direction,
            compiled,
        ),
    }


def program_v2_ai_notes(
    raw_input: RawInput,
    slide_plan: SlidePlan,
    direction: SlideCompositionDirection,
    compiled: CompiledComposition,
) -> dict[str, Any]:
    return {
        "emphasisPoints": [slide_plan.message],
        "sourceEvidence": [
            evidence.model_dump(by_alias=True) for evidence in slide_plan.evidence
        ],
        "sourceLedger": design_pack_source_ledgers(
            raw_input,
            slide_plan,
            include_official_web=(
                raw_input.design.media_policy == "hybrid"
                and direction.asset_role == "evidence"
            ),
        ),
        "typedMetrics": [
            metric.model_dump(by_alias=True) for metric in slide_plan.typed_metrics
        ],
        "timingPlan": design_pack_timing_plan(raw_input, slide_plan),
        "compositionPlan": {
            "compositionId": direction.composition_id,
            "variant": direction.variant,
            "backgroundMode": direction.background_mode,
            "focalType": direction.focal_type,
            "primaryFocalElementId": compiled.primary_focal_element_id,
            "assetRole": direction.asset_role,
            "requiredAsset": direction.required_asset,
        },
    }


def design_pack_timing_plan(
    raw_input: RawInput,
    slide_plan: SlidePlan,
) -> dict[str, Any]:
    return {
        "charsPerMinute": raw_input.timing_plan.chars_per_minute,
        "speakingTimeRatio": raw_input.timing_plan.speaking_time_ratio,
        "targetTotalChars": raw_input.timing_plan.target_total_chars,
        "targetSlideCount": raw_input.timing_plan.target_slide_count,
        "targetSecondsPerSlide": raw_input.timing_plan.target_seconds_per_slide,
        "targetSpeakerNotesCharsPerSlide": (
            raw_input.timing_plan.target_speaker_notes_chars_per_slide
        ),
        "targetSeconds": (
            slide_plan.target_seconds or raw_input.timing_plan.target_seconds_per_slide
        ),
        "targetSpokenSeconds": (
            slide_plan.target_spoken_seconds
            or raw_input.timing_plan.target_spoken_seconds
        ),
        "targetSpeakerNotesChars": target_speaker_notes_chars_for_slide(
            raw_input,
            slide_plan,
        ),
        "actualSpeakerNotesChars": count_speaker_note_chars(slide_plan.speaker_notes),
    }


def build_design_pack_content_manifest(
    slide_plan: SlidePlan,
    elements: list[dict[str, Any]],
) -> dict[str, list[str]]:
    manifest: dict[str, list[str]] = {
        item.content_item_id: [] for item in slide_plan.content_items
    }
    for element in elements:
        element_id = str(element.get("elementId", ""))
        for content_item_id in element.get("_contentItemIds", []):
            if content_item_id in manifest and element_id:
                manifest[content_item_id].append(element_id)

    missing = [content_item_id for content_item_id, ids in manifest.items() if not ids]
    if missing:
        raise DeckContentGenerationError(
            f"slide {slide_plan.order}: content items were not rendered: "
            + ", ".join(missing)
        )
    return manifest


def cap_elements(
    elements: list[dict[str, Any]], limit: int = 14
) -> list[dict[str, Any]]:
    if len(elements) <= limit:
        return elements
    required = [element for element in elements if is_required_element(element)]
    priority = [
        element
        for element in elements
        if not is_required_element(element) and is_priority_element(element)
    ]
    optional = [
        element
        for element in elements
        if not is_required_element(element) and not is_priority_element(element)
    ]
    return [*required, *priority, *optional][:limit]


def is_required_element(element: dict[str, Any]) -> bool:
    return (
        element.get("role")
        in {
            "background",
            "title",
            "subtitle",
            "body",
            "footer",
            "media",
            "chart",
        }
        or element.get("type") == "chart"
    )


def is_priority_element(element: dict[str, Any]) -> bool:
    element_id = str(element.get("elementId", ""))
    return element.get("role") == "highlight" or any(
        token in element_id
        for token in (
            "keyword_chip",
            "process_step",
            "radial_",
            "bubble_",
            "metric_card",
            "simple_basic_",
            "top_stripe",
        )
    )


def core_geometry_fingerprint(slide: dict[str, Any]) -> str:
    geometry: list[tuple[str, str, int, int, int, int]] = []
    for element in slide.get("elements", []):
        if exclude_from_core_geometry(element):
            continue
        geometry.append(
            (
                str(element.get("type", "")),
                str(element.get("role", "")),
                round(float(element.get("x", 0))),
                round(float(element.get("y", 0))),
                round(float(element.get("width", 0))),
                round(float(element.get("height", 0))),
            )
        )
    return json.dumps(sorted(geometry), separators=(",", ":"))


def exclude_from_core_geometry(element: dict[str, Any]) -> bool:
    role = str(element.get("role", ""))
    element_id = str(element.get("elementId", ""))
    if role in {"background", "footer", "media"}:
        return True
    return any(
        token in element_id
        for token in (
            "_media_placeholder",
            "_media_caption",
        )
    )


def compile_layout(
    raw_input: RawInput,
    design_plan: DesignPlan,
) -> LayoutCompileResult:
    slides = [
        assemble_program_v2_slide(
            raw_input,
            slide_plan,
            design_plan.theme,
            design_plan.design_program,
            design_plan.design_program.slides[slide_plan.order - 1],
        )
        for slide_plan in design_plan.slide_plans
    ]
    return LayoutCompileResult(slides=slides)
