from __future__ import annotations

from collections import Counter
from typing import Any

from app.ai.composition_library import CompiledComposition, compile_composition
from app.ai.deck_generation.design_pack_registry import SystemDesignPackRegistry
from app.ai.design_program import DeckDesignProgram, SlideCompositionDirection


LAYOUT_TO_COMPOSITION = {
    "kickoff-cover-01": "cover-classic-corporate",
    "kickoff-agenda-01": "process-horizontal",
    "kickoff-goals-01": "editorial-split",
    "kickoff-process-01": "process-horizontal",
    "kickoff-timeline-01": "timeline",
    "kickoff-roadmap-01": "process-horizontal",
    "kickoff-closing-01": "cta-closing",
}


def select_kickoff_alignment_layouts(
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
            for layout_id in kickoff_candidates(slide, index, len(slides))
            if layout_id in layouts and content_fits(slide, layout_id, layouts)
        ]
        if not compatible:
            compatible = ["kickoff-goals-01"]
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


def kickoff_candidates(
    slide: dict[str, Any], index: int, slide_count: int
) -> tuple[str, ...]:
    slide_type = str(slide.get("slideType", "content"))
    text = " ".join(
        [str(slide.get("title", "")), str(slide.get("message", ""))]
    ).casefold()
    if index == 0 or slide_type == "cover":
        return ("kickoff-cover-01",)
    if index == slide_count - 1 or slide_type == "summary":
        return ("kickoff-closing-01", "kickoff-goals-01")
    if any(token in text for token in ("role", "owner", "raci", "담당", "역할")):
        return ("kickoff-roles-01", "kickoff-goals-01")
    if any(token in text for token in ("schedule", "gantt", "일정", "주차")):
        return ("kickoff-schedule-01", "kickoff-timeline-01")
    if any(token in text for token in ("roadmap", "로드맵")):
        return ("kickoff-roadmap-01", "kickoff-timeline-01")
    if any(token in text for token in ("agenda", "아젠다", "목차")):
        return ("kickoff-agenda-01", "kickoff-process-01")
    if slide_type == "process":
        return (
            "kickoff-process-01",
            "kickoff-timeline-01",
            "kickoff-roadmap-01",
            "kickoff-schedule-01",
        )
    if slide_type == "comparison":
        return ("kickoff-roles-01", "kickoff-goals-01")
    return ("kickoff-goals-01", "kickoff-agenda-01", "kickoff-roles-01")


def content_fits(
    slide: dict[str, Any],
    layout_id: str,
    layouts: dict[str, Any],
) -> bool:
    if layout_id in {"kickoff-cover-01", "kickoff-closing-01"}:
        return True
    capacity = layouts[layout_id].content_capacity
    item_count = len(slide.get("contentItems", []))
    return bool(capacity.item_min <= item_count <= capacity.item_max)


def compile_kickoff_alignment_layout(
    layout_id: str,
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    program: DeckDesignProgram,
) -> CompiledComposition:
    if layout_id == "kickoff-roles-01":
        return compile_role_grid(direction, slide, program)
    if layout_id == "kickoff-schedule-01":
        return compile_schedule(direction, slide, program)
    composition_id = LAYOUT_TO_COMPOSITION.get(layout_id)
    if composition_id is None:
        raise ValueError(f"unknown Kickoff & Alignment layout: {layout_id}")
    mapped = direction.model_copy(update={"composition_id": composition_id})
    return compile_composition(mapped, slide, program)


def compile_role_grid(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    program: DeckDesignProgram,
) -> CompiledComposition:
    items = require_capacity(slide, "role", 3, 6)
    base = compile_base(direction, slide, program)
    width = 520 if len(items) <= 3 else 800
    columns = 3 if len(items) <= 3 else 2
    elements = keep_chrome(base)
    for index, item in enumerate(items):
        column = index % columns
        row = index // columns
        elements.append(
            editable_text(
                direction.order,
                f"role_{index + 1}",
                str(item.get("text", "")),
                120 + column * (width + 40),
                300 + row * 280,
                width,
                220,
                program.palette_roles.surface,
                program.palette_roles.text,
            )
        )
    return compiled(base, elements, str(elements[-1]["elementId"]), "role-grid")


def compile_schedule(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    program: DeckDesignProgram,
) -> CompiledComposition:
    items = require_capacity(slide, "milestone", 3, 6)
    base = compile_base(direction, slide, program)
    elements = keep_chrome(base)
    row_height = 92
    for index, item in enumerate(items):
        y = 280 + index * row_height
        elements.extend(
            [
                editable_text(
                    direction.order,
                    f"schedule_label_{index + 1}",
                    str(item.get("text", "")),
                    120,
                    y,
                    500,
                    64,
                    program.palette_roles.surface,
                    program.palette_roles.text,
                ),
                editable_bar(
                    direction.order,
                    index,
                    690 + (index % 3) * 130,
                    y + 8,
                    420 + (index % 2) * 180,
                    48,
                    program.palette_roles.focal
                    if index % 2 == 0
                    else program.palette_roles.secondary,
                ),
            ]
        )
    return compiled(base, elements, str(elements[-1]["elementId"]), "schedule")


def require_capacity(
    slide: dict[str, Any], label: str, minimum: int, maximum: int
) -> list[dict[str, Any]]:
    items = list(slide.get("contentItems", []))
    if not minimum <= len(items) <= maximum:
        raise ValueError(f"Kickoff {label} layout supports {minimum} to {maximum} items")
    return items


def compile_base(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    program: DeckDesignProgram,
) -> CompiledComposition:
    base_slide = dict(slide)
    base_slide["contentItems"] = list(slide.get("contentItems", []))[:4]
    mapped = direction.model_copy(update={"composition_id": "editorial-split"})
    return compile_composition(mapped, base_slide, program)


def keep_chrome(base: CompiledComposition) -> list[dict[str, Any]]:
    return [
        element
        for element in base.elements
        if element.get("role") in {"background", "title"}
    ]


def compiled(
    base: CompiledComposition,
    elements: list[dict[str, Any]],
    focal_id: str,
    layout: str,
) -> CompiledComposition:
    return CompiledComposition(
        elements=elements,
        primary_focal_element_id=focal_id,
        layout=layout,
        background_color=base.background_color,
    )


def editable_text(
    order: int,
    name: str,
    text: str,
    x: int,
    y: int,
    width: int,
    height: int,
    fill: str,
    text_color: str,
) -> dict[str, Any]:
    return {
        "elementId": f"el_{order}_kickoff_{name}",
        "type": "text",
        "role": "body",
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "rotation": 0,
        "opacity": 1,
        "zIndex": 5,
        "locked": False,
        "visible": True,
        "props": {
            "text": text,
            "fill": fill,
            "color": text_color,
            "fontFamily": "Pretendard",
            "fontSize": 26,
            "fontWeight": "semibold",
            "align": "left",
            "verticalAlign": "middle",
            "padding": 24,
        },
    }


def editable_bar(
    order: int,
    index: int,
    x: int,
    y: int,
    width: int,
    height: int,
    fill: str,
) -> dict[str, Any]:
    return {
        "elementId": f"el_{order}_kickoff_schedule_bar_{index + 1}",
        "type": "shape",
        "role": "decoration",
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "rotation": 0,
        "opacity": 1,
        "zIndex": 4,
        "locked": False,
        "visible": True,
        "props": {"shape": "roundRect", "fill": fill, "radius": 16},
    }
