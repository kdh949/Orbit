from __future__ import annotations

from collections import Counter
from typing import Any

from app.ai.composition_library import CompiledComposition, compile_composition
from app.ai.deck_generation.design_pack_registry import SystemDesignPackRegistry
from app.ai.design_program import DeckDesignProgram, SlideCompositionDirection


LAYOUT_TO_COMPOSITION = {
    "editorial-cover-01": "cover-structured-report",
    "editorial-thesis-01": "statement-poster",
    "editorial-statement-01": "statement-poster",
    "editorial-split-01": "editorial-split",
    "editorial-evidence-01": "editorial-split",
    "editorial-trend-01": "feature-comparison",
    "editorial-implication-01": "statement-poster",
    "editorial-quote-01": "cover-classic-corporate",
    "editorial-closing-01": "cta-closing",
}


def select_editorial_insight_layouts(
    slides: list[dict[str, Any]],
    registry: SystemDesignPackRegistry,
) -> list[str]:
    layouts = {layout.layout_id: layout for layout in registry.layouts}
    selected: list[str] = []
    usage: Counter[str] = Counter()
    previous_silhouette = ""
    for index, slide in enumerate(slides):
        compatible = [
            layout_id
            for layout_id in editorial_candidates(slide, index, len(slides))
            if layout_id in layouts and content_fits(slide, layout_id, layouts)
        ]
        if not compatible:
            compatible = ["editorial-statement-01"]
        layout_id = min(
            compatible,
            key=lambda candidate: (
                layouts[candidate].silhouette_id == previous_silhouette,
                usage[candidate],
                candidate,
            ),
        )
        selected.append(layout_id)
        usage[layout_id] += 1
        previous_silhouette = layouts[layout_id].silhouette_id
    return selected


def editorial_candidates(
    slide: dict[str, Any], index: int, slide_count: int
) -> tuple[str, ...]:
    slide_type = str(slide.get("slideType", "content"))
    text = " ".join(
        [str(slide.get("title", "")), str(slide.get("message", ""))]
    ).casefold()
    if index == 0 or slide_type == "cover":
        return ("editorial-cover-01",)
    if index == slide_count - 1 or slide_type == "summary":
        return ("editorial-closing-01", "editorial-implication-01")
    if slide_type == "quote":
        return ("editorial-quote-01", "editorial-statement-01")
    if any(token in text for token in ("implication", "시사점", "의미")):
        return ("editorial-implication-01", "editorial-statement-01")
    if any(token in text for token in ("trend", "동향", "트렌드")):
        return ("editorial-trend-01", "editorial-evidence-01")
    if slide_type in {"data", "chart"}:
        return ("editorial-evidence-01", "editorial-split-01")
    if slide_type == "comparison":
        return ("editorial-trend-01", "editorial-split-01")
    if slide_type in {"problem", "solution"} and len(
        slide.get("contentItems", [])
    ) <= 2:
        return (
            "editorial-thesis-01",
            "editorial-statement-01",
            "editorial-implication-01",
        )
    return ("editorial-split-01", "editorial-evidence-01")


def content_fits(
    slide: dict[str, Any],
    layout_id: str,
    layouts: dict[str, Any],
) -> bool:
    if layout_id in {"editorial-cover-01", "editorial-closing-01"}:
        return True
    capacity = layouts[layout_id].content_capacity
    item_count = len(slide.get("contentItems", []))
    return bool(capacity.item_min <= item_count <= capacity.item_max)


def compile_editorial_insight_layout(
    layout_id: str,
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    program: DeckDesignProgram,
) -> CompiledComposition:
    composition_id = LAYOUT_TO_COMPOSITION.get(layout_id)
    if composition_id is None:
        raise ValueError(f"unknown Editorial Insight layout: {layout_id}")
    if composition_id in {"metric-poster", "kpi-strip-evidence"} and not slide.get(
        "typedMetrics"
    ):
        raise ValueError("Editorial metric layouts require grounded typed metrics")
    mapped = direction.model_copy(update={"composition_id": composition_id})
    compiled = compile_composition(mapped, slide, program)
    if not compiled.primary_focal_element_id:
        raise ValueError("Editorial layout requires exactly one primary claim")
    return compiled
