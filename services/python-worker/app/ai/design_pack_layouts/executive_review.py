from __future__ import annotations

import re
from collections import Counter
from typing import Any

from app.ai.composition_library import CompiledComposition, compile_composition
from app.ai.deck_generation.design_pack_registry import SystemDesignPackRegistry
from app.ai.design_program import DeckDesignProgram, SlideCompositionDirection


LAYOUT_TO_COMPOSITION = {
    "executive-cover-01": "cover-structured-report",
    "executive-summary-01": "statement-poster",
    "executive-kpi-01": "kpi-strip-evidence",
    "executive-decision-01": "feature-comparison",
    "executive-evidence-01": "editorial-split",
    "executive-closing-01": "cta-closing",
}


def select_executive_review_layouts(
    slides: list[dict[str, Any]],
    registry: SystemDesignPackRegistry,
) -> list[str]:
    known = {layout.layout_id: layout for layout in registry.layouts}
    selected: list[str] = []
    usage: Counter[str] = Counter()
    for index, slide in enumerate(slides):
        candidates = executive_candidates(slide, index, len(slides))
        compatible = [
            candidate
            for candidate in candidates
            if candidate in known
            and known[candidate].content_capacity.item_min
            <= len(slide.get("contentItems", []))
            <= known[candidate].content_capacity.item_max
        ]
        layout_id = min(
            compatible or [candidate for candidate in candidates if candidate in known],
            key=lambda candidate: (usage[candidate], candidate),
        )
        selected.append(layout_id)
        usage[layout_id] += 1
    return selected


def executive_candidates(
    slide: dict[str, Any],
    index: int,
    slide_count: int,
) -> tuple[str, ...]:
    slide_type = str(slide.get("slideType", "content"))
    typed_metrics = slide.get("typedMetrics", [])
    if index == 0 or slide_type == "cover":
        return ("executive-cover-01",)
    if index == slide_count - 1 or slide_type == "summary":
        return ("executive-closing-01", "executive-summary-01")
    if slide_type == "chart" and len(typed_metrics) >= 2:
        return ("executive-chart-01", "executive-kpi-01")
    if slide_type == "data" and len(typed_metrics) >= 2:
        return ("executive-kpi-01", "executive-chart-01")
    if slide_type == "data":
        return ("executive-table-01", "executive-evidence-01")
    if slide_type == "comparison":
        return ("executive-decision-01",)
    return ("executive-evidence-01", "executive-summary-01")


def compile_executive_review_layout(
    layout_id: str,
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    program: DeckDesignProgram,
) -> CompiledComposition:
    if layout_id == "executive-table-01":
        return compile_executive_table(direction, slide, program)
    if layout_id == "executive-chart-01":
        return compile_executive_chart(direction, slide, program)
    composition_id = LAYOUT_TO_COMPOSITION.get(layout_id)
    if composition_id is None:
        raise ValueError(f"unknown Executive Review layout: {layout_id}")
    mapped = direction.model_copy(update={"composition_id": composition_id})
    return compile_composition(mapped, slide, program)


def compile_executive_table(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    program: DeckDesignProgram,
) -> CompiledComposition:
    item_count = len(slide.get("contentItems", []))
    if not 2 <= item_count <= 5:
        raise ValueError("Executive table supports two to five rows")
    base = compile_base(direction, slide, program)
    rows = [
        [table_cell("항목", True), table_cell("내용", True)],
        *[
            [table_cell(f"{index:02d}"), table_cell(str(item.get("text", "")))]
            for index, item in enumerate(slide.get("contentItems", [])[:5], start=1)
        ],
    ]
    table = editable_element(
        direction.order,
        "table",
        "table",
        120,
        300,
        1680,
        580,
        {
            "rows": rows,
            "columnWidths": [280, 1400],
            "borderColor": "#CBD5E1",
            "borderWidth": 1,
        },
    )
    return replace_body(base, table, "table")


def compile_executive_chart(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    program: DeckDesignProgram,
) -> CompiledComposition:
    metrics = slide.get("typedMetrics", [])
    if not 2 <= len(metrics) <= 4:
        raise ValueError("Executive chart requires two to four grounded typed metrics")
    data = [
        {
            "label": str(metric["label"]),
            "value": numeric_value(str(metric["value"])),
        }
        for metric in metrics[:4]
    ]
    base = compile_base(direction, slide, program)
    chart = editable_element(
        direction.order,
        "chart",
        "chart",
        120,
        280,
        1680,
        610,
        {
            "type": "bar",
            "title": str(slide.get("title", "")),
            "data": data,
            "style": {
                "colors": [program.palette_roles.focal, program.palette_roles.secondary],
                "showLegend": False,
                "showDataLabels": True,
                "showGrid": True,
                "unit": str(metrics[0]["unit"]),
            },
        },
    )
    return replace_body(base, chart, "chart")


def compile_base(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    program: DeckDesignProgram,
) -> CompiledComposition:
    base_slide = dict(slide)
    items = list(slide.get("contentItems", []))[:4]
    while len(items) < 2:
        items.append(
            {
                "contentItemId": f"executive-support-{len(items) + 1}",
                "text": str(slide.get("message", "Executive review")),
            }
        )
    base_slide["contentItems"] = items
    mapped = direction.model_copy(update={"composition_id": "editorial-split"})
    return compile_composition(mapped, base_slide, program)


def replace_body(
    base: CompiledComposition,
    focal: dict[str, Any],
    layout: str,
) -> CompiledComposition:
    elements = [
        element
        for element in base.elements
        if element.get("role") in {"background", "title"}
    ]
    elements.append(focal)
    return CompiledComposition(
        elements=elements,
        primary_focal_element_id=str(focal["elementId"]),
        layout=layout,
        background_color=base.background_color,
    )


def editable_element(
    order: int,
    name: str,
    element_type: str,
    x: int,
    y: int,
    width: int,
    height: int,
    props: dict[str, Any],
) -> dict[str, Any]:
    return {
        "elementId": f"el_{order}_executive_{name}",
        "type": element_type,
        "role": name,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "rotation": 0,
        "opacity": 1,
        "zIndex": 5,
        "locked": False,
        "visible": True,
        "props": props,
    }


def table_cell(text: str, header: bool = False) -> dict[str, Any]:
    return {
        "text": text,
        "fill": "#E2E8F0" if header else "#FFFFFF",
        "textColor": "#111827",
        "fontFamily": "Pretendard",
        "fontSize": 24,
        "fontWeight": "bold" if header else "normal",
        "align": "left",
        "verticalAlign": "middle",
        "borderColor": "#CBD5E1",
        "borderWidth": 1,
        "colSpan": 1,
        "rowSpan": 1,
    }


def numeric_value(value: str) -> float:
    match = re.search(r"-?\d+(?:[,.]\d+)*", value)
    if match is None:
        raise ValueError("Executive chart metric value must be numeric")
    return float(match.group(0).replace(",", ""))
