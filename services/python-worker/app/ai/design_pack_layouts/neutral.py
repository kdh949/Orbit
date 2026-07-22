from __future__ import annotations

from collections import Counter
from typing import Any

from app.ai.composition_library import CompiledComposition, compile_composition
from app.ai.deck_generation.design_pack_registry import SystemDesignPackRegistry
from app.ai.design_program import DeckDesignProgram, SlideCompositionDirection


LAYOUT_TO_COMPOSITION = {
    "neutral-cover-01": "cover-classic-corporate",
    "neutral-section-01": "statement-poster",
    "neutral-content-01": "editorial-split",
    "neutral-two-column-01": "feature-comparison",
    "neutral-media-split-01": "editorial-split",
    "neutral-comparison-01": "feature-comparison",
    "neutral-timeline-01": "timeline",
    "neutral-metric-01": "metric-poster",
    "neutral-closing-01": "cta-closing",
}


def select_neutral_layouts(
    slides: list[dict[str, Any]],
    registry: SystemDesignPackRegistry,
) -> list[str]:
    layouts = {layout.layout_id: layout for layout in registry.layouts}
    selected: list[str] = []
    usage: Counter[str] = Counter()
    previous_silhouette = ""
    for index, slide in enumerate(slides):
        candidates = candidate_layouts(slide, index, len(slides))
        compatible = [
            layout_id
            for layout_id in candidates
            if layout_id in layouts
            and content_fits(slide, layouts[layout_id].content_capacity.item_min,
                             layouts[layout_id].content_capacity.item_max)
        ]
        if not compatible:
            compatible = ["neutral-content-01"]
        layout_id = min(
            compatible,
            key=lambda candidate: (
                layouts[candidate].silhouette_id == previous_silhouette,
                usage[candidate] >= 2,
                usage[candidate],
                candidate,
            ),
        )
        selected.append(layout_id)
        usage[layout_id] += 1
        previous_silhouette = layouts[layout_id].silhouette_id
    return selected


def candidate_layouts(
    slide: dict[str, Any], index: int, slide_count: int
) -> tuple[str, ...]:
    slide_type = str(slide.get("slideType", "content"))
    if index == 0 or slide_type == "cover":
        return ("neutral-cover-01",)
    if index == slide_count - 1 or slide_type == "summary":
        return ("neutral-closing-01", "neutral-section-01")
    if slide_type in {"title", "quote"}:
        return ("neutral-section-01", "neutral-content-01")
    if slide_type == "comparison":
        return ("neutral-comparison-01", "neutral-two-column-01")
    if slide_type == "process":
        return ("neutral-timeline-01", "neutral-content-01")
    if slide_type in {"data", "chart"} and slide.get("typedMetrics"):
        return ("neutral-metric-01", "neutral-content-01")
    if slide.get("mediaIntent", {}).get("needed"):
        return ("neutral-media-split-01", "neutral-content-01")
    return (
        "neutral-content-01",
        "neutral-two-column-01",
        "neutral-section-01",
    )


def content_fits(slide: dict[str, Any], item_min: int, item_max: int) -> bool:
    items = [item for item in slide.get("contentItems", []) if item]
    return item_min <= len(items) <= item_max


def compile_neutral_layout(
    layout_id: str,
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    program: DeckDesignProgram,
) -> CompiledComposition:
    composition_id = LAYOUT_TO_COMPOSITION.get(layout_id)
    if composition_id is None:
        raise ValueError(f"unknown Neutral layout: {layout_id}")
    mapped_direction = direction.model_copy(
        update={"composition_id": composition_id}
    )
    return compile_composition(mapped_direction, slide, program)
