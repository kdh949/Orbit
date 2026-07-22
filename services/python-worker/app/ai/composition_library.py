from __future__ import annotations

import colorsys
import re
import textwrap
from collections import Counter
from dataclasses import dataclass
from math import atan2, degrees, hypot
from typing import Any, Callable, Literal

from app.ai.design_program import (
    BackgroundMode,
    COVER_COMPOSITION_IDS,
    CompositionId,
    DeckDesignProgram,
    SlideCompositionDirection,
)
from app.ai.korean_typography import resolve_korean_typography


MediaRequirement = Literal["none", "optional", "required"]
Element = dict[str, Any]
Factory = Callable[[SlideCompositionDirection, dict[str, Any], "Style"], tuple[list[Element], str]]

CANVAS_WIDTH = 1920
CANVAS_HEIGHT = 1080
SAFE_X = 120
SAFE_Y = 88
SAFE_WIDTH = 1680
SAFE_HEIGHT = 904
GRID_COLUMN_WIDTH = 118
GRID_GUTTER = 24
GRID_STEP = GRID_COLUMN_WIDTH + GRID_GUTTER


@dataclass(frozen=True)
class CompositionSpec:
    composition_id: CompositionId
    purposes: tuple[str, ...]
    min_items: int
    max_items: int
    media_requirement: MediaRequirement
    variants: tuple[BackgroundMode, ...]
    silhouette: str
    focal_rule: str
    factory: Factory


@dataclass(frozen=True)
class Style:
    background: str
    surface: str
    text: str
    muted_text: str
    focal: str
    secondary: str
    heading_font: str
    body_font: str
    cover_size: int
    title_size: int
    body_size: int
    caption_size: int


@dataclass(frozen=True)
class CompiledComposition:
    elements: list[Element]
    primary_focal_element_id: str
    layout: str
    background_color: str


class CompositionCompileError(RuntimeError):
    pass


def _id(order: int, name: str) -> str:
    return f"el_{order}_program_v2_{name}"


def _grid_x(column: int) -> int:
    return SAFE_X + column * GRID_STEP


def _grid_width(span: int) -> int:
    return span * GRID_COLUMN_WIDTH + (span - 1) * GRID_GUTTER


def _rect(
    order: int,
    name: str,
    role: str,
    x: int,
    y: int,
    width: int,
    height: int,
    z_index: int,
    fill: str,
    *,
    stroke: str = "transparent",
    stroke_width: int = 0,
    radius: int = 0,
    opacity: float = 1,
    locked: bool = False,
) -> Element:
    return {
        "elementId": _id(order, name),
        "type": "rect",
        "role": role,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "rotation": 0,
        "opacity": opacity,
        "zIndex": z_index,
        "locked": locked,
        "visible": True,
        "props": {
            "fill": fill,
            "stroke": stroke,
            "strokeWidth": stroke_width,
            "borderRadius": radius,
        },
    }


def _text(
    order: int,
    name: str,
    role: str,
    value: str,
    x: int,
    y: int,
    width: int,
    height: int,
    z_index: int,
    color: str,
    size: int,
    weight: str,
    font: str,
    *,
    align: str = "left",
    vertical: str = "top",
    line_height: float = 1.2,
    content_item_ids: list[str] | None = None,
) -> Element:
    font_metrics = resolve_korean_typography(font)
    element: Element = {
        "elementId": _id(order, name),
        "type": "text",
        "role": role,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "rotation": 0,
        "opacity": 1,
        "zIndex": z_index,
        "locked": False,
        "visible": True,
        "props": {
            "text": value,
            "fontFamily": font,
            "fontWidthFactor": font_metrics.width_factor,
            "fontSize": size,
            "fontWeight": weight,
            "color": color,
            "align": align,
            "verticalAlign": vertical,
            "lineHeight": line_height,
        },
    }
    if content_item_ids:
        element["_contentItemIds"] = content_item_ids
    return element


def _media(
    order: int,
    x: int,
    y: int,
    width: int,
    height: int,
    z_index: int,
    style: Style,
    caption: str,
) -> list[Element]:
    caption_x = max(x + 24, SAFE_X)
    caption_y = max(y + 24, SAFE_Y)
    caption_right = min(x + width - 24, SAFE_X + SAFE_WIDTH)
    placeholder = _rect(
        order,
        "media_placeholder",
        "media",
        x,
        y,
        width,
        height,
        z_index,
        style.surface,
        stroke=style.focal,
        stroke_width=2,
        radius=8,
    )
    caption_element = _text(
        order,
        "media_caption",
        "caption",
        textwrap.shorten(caption or "Visual", width=80, placeholder="..."),
        caption_x,
        caption_y,
        max(120, caption_right - caption_x),
        64,
        z_index + 1,
        style.muted_text,
        style.caption_size,
        "medium",
        style.body_font,
    )
    return [placeholder, caption_element]


def _background(order: int, style: Style) -> Element:
    return _rect(
        order,
        "background",
        "background",
        0,
        0,
        CANVAS_WIDTH,
        CANVAS_HEIGHT,
        0,
        style.background,
        locked=True,
    )


def _items(slide: dict[str, Any]) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    for index, item in enumerate(slide.get("contentItems", []), start=1):
        if isinstance(item, dict):
            identifier = str(item.get("contentItemId") or f"item-{index}")
            value = str(item.get("text", ""))
        else:
            identifier = f"item-{index}"
            value = str(item)
        value = " ".join(value.split())
        if value:
            result.append((identifier, value))
    return result


def _normalized_text(value: str) -> str:
    return re.sub(r"\W+", "", value.casefold(), flags=re.UNICODE)


def _message_duplicates_items(
    slide: dict[str, Any],
    items: list[tuple[str, str]],
) -> bool:
    message = _normalized_text(str(slide.get("message", "")))
    item_values = [_normalized_text(value) for _, value in items]
    item_values = [value for value in item_values if value]
    if not message or not item_values:
        return False
    if message in item_values or message == "".join(item_values):
        return True
    return (
        all(value in message for value in item_values)
        and sum(len(value) for value in item_values) >= len(message) * 0.8
    )


def _supporting_items_without_message_duplicate(
    slide: dict[str, Any],
    items: list[tuple[str, str]],
) -> list[tuple[str, str]]:
    message = _normalized_text(str(slide.get("message", "")))
    if not message:
        return items
    filtered = [item for item in items if _normalized_text(item[1]) != message]
    if len(filtered) != len(items):
        return filtered
    return [] if _message_duplicates_items(slide, items) else items


def _message_backed_item_ids(
    slide: dict[str, Any],
    items: list[tuple[str, str]],
) -> list[str]:
    message = _normalized_text(str(slide.get("message", "")))
    if not message:
        return []
    exact = [identifier for identifier, value in items if _normalized_text(value) == message]
    if exact:
        return exact
    if _message_duplicates_items(slide, items) and not _supporting_items_without_message_duplicate(
        slide, items
    ):
        return [identifier for identifier, _ in items]
    return []


def _deduplicate_exact_visible_text(
    elements: list[Element],
) -> list[Element]:
    groups: dict[str, list[Element]] = {}
    for element in elements:
        if element.get("type") != "text" or element.get("role") not in {
            "subtitle",
            "body",
            "highlight",
        }:
            continue
        normalized = _normalized_text(str(element.get("props", {}).get("text", "")))
        if len(normalized) >= 6:
            groups.setdefault(normalized, []).append(element)

    removed_ids: set[str] = set()
    for group in groups.values():
        if len(group) < 2:
            continue
        keep = max(
            group,
            key=lambda element: (
                element.get("role") == "highlight",
                bool(element.get("_contentItemIds")),
                float(element.get("width", 0)) * float(element.get("height", 0)),
            ),
        )
        content_item_ids = list(
            dict.fromkeys(
                str(content_item_id)
                for element in group
                for content_item_id in element.get("_contentItemIds", [])
            )
        )
        if content_item_ids:
            keep["_contentItemIds"] = content_item_ids
        removed_ids.update(
            str(element.get("elementId")) for element in group if element is not keep
        )
    return [
        element
        for element in elements
        if str(element.get("elementId")) not in removed_ids
    ]


def _title(order: int, slide: dict[str, Any], style: Style) -> Element:
    return _text(
        order,
        "title",
        "title",
        str(slide.get("title", "")),
        SAFE_X,
        96,
        SAFE_WIDTH,
        120,
        10,
        style.text,
        style.title_size,
        "bold",
        style.heading_font,
        line_height=1.08,
    )


def _hero_split(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    style: Style,
) -> tuple[list[Element], str]:
    order = direction.order
    items = _items(slide)
    duplicates_items = _message_duplicates_items(slide, items)
    message_item_ids = _message_backed_item_ids(slide, items)
    content_columns = 6 if direction.asset_role != "none" else 7
    media_columns = 12 - content_columns
    title_text = str(slide.get("title", ""))
    title_size = _hero_title_font_size(
        title_text,
        style.cover_size,
        _grid_width(content_columns),
    )
    elements = [_background(order, style)]
    elements.append(
        _rect(order, "hero_accent", "decoration", 120, 164, 92, 14, 2, style.focal)
    )
    title = _text(
        order,
        "title",
        "title",
        title_text,
        _grid_x(0),
        232,
        _grid_width(content_columns),
        328,
        10,
        style.text,
        title_size,
        "bold",
        style.heading_font,
        line_height=1.05,
    )
    elements.append(title)
    elements.append(
        _text(
            order,
            "message",
            "highlight",
            str(slide.get("message", "")),
            _grid_x(0),
            592,
            _grid_width(content_columns),
            144,
            10,
            style.text,
            max(style.body_size + 4, 24),
            "semibold",
            style.body_font,
            vertical="middle",
            content_item_ids=message_item_ids or None,
        )
    )
    if items and not duplicates_items:
        elements.append(
            _text(
                order,
                "support",
                "body",
                "\n".join(f"• {value}" for _, value in items),
                _grid_x(0),
                768,
                _grid_width(content_columns),
                120,
                10,
                style.muted_text,
                style.body_size,
                "normal",
                style.body_font,
                content_item_ids=[identifier for identifier, _ in items],
            )
        )
    if direction.asset_role != "none":
        elements.extend(
            _media(
                order,
                _grid_x(content_columns),
                120,
                _grid_width(media_columns),
                840,
                5,
                style,
                _media_caption(slide),
            )
        )
        return elements, _id(order, "media_placeholder")
    elements.extend(
        [
            _rect(
                order,
                "hero_field_top",
                "decoration",
                _grid_x(7),
                160,
                _grid_width(5),
                176,
                3,
                style.focal,
                radius=8,
            ),
            _rect(
                order,
                "hero_field_middle",
                "decoration",
                _grid_x(7),
                376,
                _grid_width(3),
                216,
                3,
                style.secondary,
                radius=8,
            ),
            _rect(
                order,
                "hero_field_bottom",
                "decoration",
                _grid_x(10),
                632,
                _grid_width(2),
                256,
                3,
                style.focal,
                radius=8,
            ),
        ]
    )
    return elements, title["elementId"]


def _hero_title_font_size(value: str, base_size: int, width: int) -> int:
    normalized_length = len(_normalized_text(value))
    if width <= _grid_width(6):
        if normalized_length > 40:
            return min(base_size, 52)
        if normalized_length > 34:
            return min(base_size, 56)
        if normalized_length > 26:
            return min(base_size, 64)
    return base_size


def _hero_full_bleed(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    style: Style,
) -> tuple[list[Element], str]:
    if direction.asset_role == "none":
        raise CompositionCompileError("hero-full-bleed requires an asset")
    order = direction.order
    media_placeholder = _media(
        order,
        0,
        0,
        CANVAS_WIDTH,
        CANVAS_HEIGHT,
        1,
        style,
        _media_caption(slide),
    )[0]
    elements = [
        _background(order, style),
        media_placeholder,
        _rect(order, "image_overlay", "decoration", 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 3, "#000000", opacity=0.58),
        _text(order, "eyebrow", "caption", "PRODUCT REVEAL", 120, 150, 600, 50, 4, "#FFFFFF", 16, "bold", style.body_font),
        _text(
            order,
            "title",
            "title",
            str(slide.get("title", "")),
            _grid_x(0),
            304,
            _grid_width(9),
            256,
            4,
            "#FFFFFF",
            style.cover_size,
            "bold",
            style.heading_font,
            line_height=1.05,
        ),
        _text(
            order,
            "message",
            "highlight",
            str(slide.get("message", "")),
            _grid_x(0),
            608,
            _grid_width(8),
            152,
            4,
            "#FFFFFF",
            max(style.body_size + 4, 24),
            "semibold",
            style.body_font,
        ),
    ]
    items = _items(slide)
    if items:
        elements.append(
            _text(
                order,
                "support",
                "body",
                "  ·  ".join(value for _, value in items),
                _grid_x(0),
                808,
                _grid_width(11),
                80,
                4,
                "#FFFFFF",
                style.body_size,
                "normal",
                style.body_font,
                content_item_ids=[identifier for identifier, _ in items],
            )
        )
    return elements, _id(order, "media_placeholder")


def _minimal_cover(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    style: Style,
) -> tuple[list[Element], str]:
    order = direction.order
    title = _text(
        order,
        "title",
        "title",
        str(slide.get("title", "")),
        _grid_x(0),
        304,
        _grid_width(12),
        248,
        4,
        style.text,
        style.cover_size,
        "bold",
        style.heading_font,
        align="center",
        line_height=1.05,
    )
    elements = [
        _background(order, style),
        _rect(order, "cover_mark", "decoration", 870, 190, 180, 18, 2, style.focal),
        title,
        _text(order, "message", "highlight", str(slide.get("message", "")), _grid_x(1), 600, _grid_width(10), 128, 4, style.muted_text, style.body_size + 2, "medium", style.body_font, align="center"),
    ]
    items = _items(slide)
    if items:
        elements.append(
            _text(order, "support", "body", "  ·  ".join(value for _, value in items), _grid_x(0), 792, _grid_width(12), 80, 4, style.text, style.body_size, "normal", style.body_font, align="center", content_item_ids=[identifier for identifier, _ in items])
        )
    return elements, title["elementId"]


def _cover_content(slide: dict[str, Any]) -> dict[str, Any]:
    value = slide.get("coverContent")
    return value if isinstance(value, dict) else {}


def _cover_value(slide: dict[str, Any], key: str, fallback: str = "") -> str:
    value = _cover_content(slide).get(key)
    return " ".join(str(value or fallback).split())


def _cover_title_size(value: str, base: int, width: int) -> int:
    normalized_length = len(_normalized_text(value))
    if width <= 820 and normalized_length > 32:
        return max(52, min(base, 60))
    if normalized_length > 52:
        return max(54, min(base, 64))
    if normalized_length > 36:
        return max(60, min(base, 72))
    return min(base, 88)


def _cover_classic_corporate(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    style: Style,
) -> tuple[list[Element], str]:
    order = direction.order
    title_text = str(slide.get("title", ""))
    subtitle = _cover_value(slide, "subtitle", str(slide.get("message", "")))
    kicker = _cover_value(slide, "kicker")
    presenter = _cover_value(slide, "presenterName")
    organization = _cover_value(slide, "organization")
    byline = " · ".join(value for value in (presenter, organization) if value)
    title_y = 250 if kicker else 222
    title = _text(
        order, "title", "title", title_text, 250, title_y, 1420, 278, 5,
        style.text, _cover_title_size(title_text, style.cover_size, 1420),
        "bold", style.heading_font, align="center", vertical="middle", line_height=1.06,
    )
    elements = [_background(order, style)]
    if kicker:
        elements.append(_text(order, "kicker", "caption", kicker, 600, 126, 720, 48, 4, style.focal, style.caption_size, "bold", style.body_font, align="center"))
    elements.extend([
        title,
        _text(order, "subtitle", "subtitle", subtitle, 435, 548, 1050, 142, 5, style.muted_text, max(style.body_size, 32), "medium", style.body_font, align="center", vertical="middle"),
        _rect(order, "divider", "decoration", 900, 776, 120, 6, 3, style.focal, radius=3),
    ])
    if byline:
        elements.append(_text(order, "byline", "footer", byline, 600, 870, 720, 70, 5, style.text, style.caption_size, "medium", style.body_font, align="center", vertical="middle"))
    return elements, title["elementId"]


def _cover_visual_impact(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    style: Style,
) -> tuple[list[Element], str]:
    if direction.asset_role == "none":
        raise CompositionCompileError("cover-visual-impact requires an asset")
    order = direction.order
    title_text = str(slide.get("title", ""))
    kicker = _cover_value(slide, "kicker") or _cover_value(slide, "documentLabel")
    subtitle = _cover_value(slide, "subtitle", str(slide.get("message", "")))
    date_text = _cover_value(slide, "dateText")
    venue = _cover_value(slide, "venue")
    title = _text(order, "title", "title", title_text, 120, 250, 720, 350, 6, style.text, _cover_title_size(title_text, style.cover_size, 720), "bold", style.heading_font, vertical="middle", line_height=1.05)
    elements = [
        _background(order, style),
        *_media(order, 960, 0, 960, 1080, 2, style, _media_caption(slide)),
        _rect(order, "media_edge", "decoration", 946, 0, 14, 1080, 4, style.focal),
        title,
        _text(order, "subtitle", "subtitle", subtitle, 120, 648, 720, 150, 6, style.muted_text, style.body_size, "medium", style.body_font, vertical="middle"),
    ]
    if kicker:
        elements.append(_text(order, "kicker", "caption", kicker, 120, 150, 600, 64, 6, style.focal, style.caption_size, "bold", style.body_font))
    if date_text:
        elements.append(_text(order, "date", "footer", date_text, 120, 876, 560, 42, 6, style.text, style.caption_size, "medium", style.body_font))
    if venue:
        elements.append(_text(order, "venue", "footer", venue, 120, 928, 660, 42, 6, style.muted_text, style.caption_size, "normal", style.body_font))
    return elements, _id(order, "media_placeholder")


def _cover_immersive_background(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    style: Style,
) -> tuple[list[Element], str]:
    if direction.asset_role == "none":
        raise CompositionCompileError("cover-immersive-background requires an asset")
    order = direction.order
    title_text = str(slide.get("title", ""))
    subtitle = _cover_value(slide, "subtitle", str(slide.get("message", "")))
    kicker = _cover_value(slide, "kicker") or _cover_value(slide, "documentLabel")
    presenter = _cover_value(slide, "presenterName")
    organization = _cover_value(slide, "organization")
    byline = " · ".join(value for value in (presenter, organization) if value)
    title = _text(order, "title", "title", title_text, 360, 400, 1200, 210, 6, "#FFFFFF", _cover_title_size(title_text, style.cover_size, 1200), "bold", style.heading_font, align="center", vertical="middle", line_height=1.05)
    elements = [
        _background(order, style),
        _media(order, 0, 0, 1920, 1080, 1, style, _media_caption(slide))[0],
        _rect(order, "image_overlay", "decoration", 0, 0, 1920, 1080, 3, "#000000", opacity=0.58),
        title,
        _text(order, "subtitle", "subtitle", subtitle, 460, 635, 1000, 92, 6, "#E5E7EB", style.body_size, "medium", style.body_font, align="center", vertical="middle"),
    ]
    if kicker:
        elements.append(_text(order, "kicker", "caption", kicker, 650, 120, 620, 56, 6, "#FFFFFF", style.caption_size, "bold", style.body_font, align="center"))
    if byline:
        elements.append(_text(order, "byline", "footer", byline, 620, 918, 680, 48, 6, "#FFFFFF", style.caption_size, "medium", style.body_font, align="center"))
    return elements, _id(order, "media_placeholder")


def _cover_research_author(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    style: Style,
) -> tuple[list[Element], str]:
    if direction.asset_role == "none":
        raise CompositionCompileError("cover-research-author requires a verified profile asset")
    order = direction.order
    title_text = str(slide.get("title", ""))
    kicker = _cover_value(slide, "kicker") or _cover_value(slide, "documentLabel")
    subtitle = _cover_value(slide, "subtitle")
    presenter = _cover_value(slide, "presenterName")
    role = _cover_value(slide, "presenterRole")
    organization = _cover_value(slide, "organization")
    author_lines = [presenter, role, organization]
    title = _text(order, "title", "title", title_text, 810, 300, 1040, 330, 6, style.text, _cover_title_size(title_text, style.cover_size, 1040), "bold", style.heading_font, vertical="middle", line_height=1.05)
    elements = [
        _background(order, style),
        _rect(order, "portrait_frame", "decoration", 180, 262, 555, 555, 2, style.focal, radius=278),
        *_media(order, 195, 277, 525, 525, 3, style, presenter or _media_caption(slide)),
        title,
    ]
    if kicker:
        elements.append(_text(order, "kicker", "caption", kicker, 810, 245, 720, 42, 6, style.focal, style.caption_size, "bold", style.body_font))
    if subtitle:
        elements.append(_text(order, "subtitle", "subtitle", subtitle, 810, 620, 900, 88, 6, style.muted_text, style.body_size, "medium", style.body_font))
    if any(author_lines):
        elements.append(_text(order, "author", "footer", "\n".join(value for value in author_lines if value), 810, 735, 720, 150, 6, style.text, style.caption_size, "medium", style.body_font, line_height=1.35))
    return elements, _id(order, "media_placeholder")


def _cover_structured_report(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    style: Style,
) -> tuple[list[Element], str]:
    order = direction.order
    title_text = str(slide.get("title", ""))
    subtitle = _cover_value(slide, "subtitle", str(slide.get("message", "")))
    period = _cover_value(slide, "reportPeriod")
    label = _cover_value(slide, "documentLabel")
    rail_text = _contrasting_text_color(style.focal, "#FFFFFF")
    title = _text(order, "title", "title", title_text, 645, 235, 1155, 250, 6, style.text, _cover_title_size(title_text, style.cover_size, 1155), "bold", style.heading_font, vertical="middle", line_height=1.05)
    elements = [
        _background(order, style),
        _rect(order, "report_rail", "decoration", 0, 0, 525, 1080, 2, style.focal),
        _rect(order, "report_rule", "decoration", 645, 530, 1160, 6, 3, style.secondary),
        title,
        _text(order, "subtitle", "subtitle", subtitle, 645, 585, 1100, 160, 6, style.muted_text, style.body_size, "medium", style.body_font, vertical="middle"),
    ]
    if period:
        elements.append(_text(order, "period", "caption", period, 60, 90, 405, 80, 6, rail_text, max(style.caption_size, 28), "bold", style.body_font))
    if label:
        elements.append(_text(order, "document_label", "caption", label, 60, 184, 405, 90, 6, rail_text, style.caption_size, "medium", style.body_font))
    classification = _cover_value(slide, "kicker")
    if classification:
        elements.append(_text(order, "classification", "footer", classification, 60, 935, 405, 56, 6, rail_text, style.caption_size, "bold", style.body_font))
    return elements, title["elementId"]


def _cover_modern_high_tech(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    style: Style,
) -> tuple[list[Element], str]:
    order = direction.order
    background = style.background if _is_dark(style.background) else "#101828"
    title_text = str(slide.get("title", ""))
    subtitle = _cover_value(slide, "subtitle", str(slide.get("message", "")))
    kicker = _cover_value(slide, "kicker")
    label = _cover_value(slide, "documentLabel")
    date_text = _cover_value(slide, "dateText")
    title = _text(order, "title", "title", title_text, 150, 260, 1420, 390, 6, "#FFFFFF", _cover_title_size(title_text, style.cover_size, 1420), "bold", style.heading_font, vertical="middle", line_height=1.05)
    elements = [
        _rect(order, "background", "background", 0, 0, 1920, 1080, 0, background, locked=True),
        _rect(order, "tech_mark", "decoration", 150, 120, 90, 90, 2, style.focal, radius=12),
        _rect(order, "tech_mark_core", "decoration", 178, 148, 34, 34, 3, style.secondary, radius=17),
        title,
        _text(order, "subtitle", "subtitle", subtitle, 150, 690, 1120, 160, 6, "#D1D5DB", style.body_size, "medium", style.body_font, vertical="middle"),
        _rect(order, "footer_rule", "decoration", 150, 888, 1620, 4, 3, style.focal),
    ]
    if kicker:
        elements.append(_text(order, "kicker", "caption", kicker, 280, 140, 720, 48, 6, style.focal, style.caption_size, "bold", style.body_font))
    if label:
        elements.append(_text(order, "document_label", "footer", label, 150, 930, 720, 48, 6, "#FFFFFF", style.caption_size, "medium", style.body_font))
    if date_text:
        elements.append(_text(order, "date", "footer", date_text, 1250, 930, 520, 48, 6, "#D1D5DB", style.caption_size, "normal", style.body_font, align="right"))
    return elements, title["elementId"]


def _statement_poster(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    style: Style,
) -> tuple[list[Element], str]:
    order = direction.order
    items = _items(slide)
    support_items = _supporting_items_without_message_duplicate(slide, items)
    promotes_play_focal = _promotes_play_focal(slide)
    promotes_action_focal = _promotes_action_focal(slide)
    promotes_native_focal = promotes_play_focal or promotes_action_focal
    panel_fill = style.surface if _is_dark(style.background) else style.text
    panel_text = _contrasting_text_color(panel_fill, style.text)
    panel_y = 272
    panel_height = 584
    statement_text = str(slide.get("message", ""))
    statement_width = 1120 if promotes_native_focal else 1512
    statement_font_size = max(64, style.title_size + 8)
    if not support_items and len(statement_text) <= 55:
        statement_font_size = max(84, style.title_size + 20)
    statement = _text(
        order,
        "statement",
        "highlight",
        statement_text,
        184,
        328,
        statement_width,
        336 if support_items else 424,
        5,
        panel_text,
        statement_font_size,
        "bold",
        style.heading_font,
        line_height=1.2,
        vertical="top" if support_items else "middle",
        content_item_ids=(
            [identifier for identifier, _ in items]
            if items and not support_items
            else None
        ),
    )
    elements = [
        _background(order, style),
        _title(order, slide, style),
        _rect(
            order,
            "poster_block",
            "decoration",
            SAFE_X,
            panel_y,
            SAFE_WIDTH,
            panel_height,
            2,
            panel_fill,
            radius=8,
        ),
        _rect(
            order,
            "poster_accent",
            "decoration",
            SAFE_X,
            panel_y,
            20,
            panel_height,
            3,
            style.focal,
            radius=8,
        ),
        statement,
    ]
    if support_items:
        elements.extend(
            [
                _rect(
                    order,
                    "support_rule",
                    "decoration",
                    184,
                    718,
                    180,
                    12,
                    4,
                    style.secondary,
                    radius=6,
                ),
                _text(
                    order,
                    "support",
                    "body",
                    "  /  ".join(value for _, value in support_items),
                    184,
                    754,
                    1512,
                    72,
                    5,
                    panel_text,
                    style.body_size,
                    "semibold",
                    style.body_font,
                    vertical="middle",
                    content_item_ids=[
                        identifier for identifier, _ in support_items
                    ],
                ),
            ]
        )
    if promotes_native_focal:
        play_x = 1450
        play_y = 440
        play_size = 184
        marker_name = "statement_play" if promotes_play_focal else "statement_action"
        marker_icon = "▶" if promotes_play_focal else "→"
        marker_label = "TRAILER" if promotes_play_focal else "NEXT ACTION"
        elements.extend(
            [
                _rect(
                    order,
                    f"{marker_name}_field",
                    "highlight",
                    play_x,
                    play_y,
                    play_size,
                    play_size,
                    5,
                    style.focal,
                    radius=play_size // 2,
                ),
                _text(
                    order,
                    f"{marker_name}_icon",
                    "highlight",
                    marker_icon,
                    play_x + 18,
                    play_y + 24,
                    play_size - 36,
                    play_size - 48,
                    6,
                    _contrasting_text_color(style.focal, style.text),
                    76,
                    "bold",
                    style.heading_font,
                    align="center",
                    vertical="middle",
                ),
                _text(
                    order,
                    f"{marker_name}_label",
                    "caption",
                    marker_label,
                    play_x - 40,
                    play_y + play_size + 28,
                    play_size + 80,
                    56,
                    6,
                    panel_text,
                    max(26, style.caption_size),
                    "bold",
                    style.body_font,
                    align="center",
                ),
            ]
        )
    return elements, statement["elementId"]


def _promotes_play_focal(slide: dict[str, Any]) -> bool:
    text = " ".join(
        [
            str(slide.get("title", "")),
            str(slide.get("message", "")),
            *[value for _, value in _items(slide)],
        ]
    ).casefold()
    return any(
        keyword in text
        for keyword in ("trailer", "video", "트레일러", "영상", "demo", "데모")
    )


def _promotes_action_focal(slide: dict[str, Any]) -> bool:
    text = " ".join(
        [
            str(slide.get("title", "")),
            str(slide.get("message", "")),
            *[value for _, value in _items(slide)],
        ]
    ).casefold()
    return any(
        keyword in text
        for keyword in (
            "reserve",
            "order",
            "purchase",
            "buy",
            "register",
            "예약",
            "주문",
            "구매",
            "신청",
        )
    )


def _editorial_split(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    style: Style,
) -> tuple[list[Element], str]:
    order = direction.order
    items = _items(slide)
    duplicates_items = _message_duplicates_items(slide, items)
    elements = [_background(order, style), _title(order, slide, style)]
    if direction.asset_role != "none":
        content_span = 5 if direction.asset_role == "atmosphere" else 6
        media_span = 12 - content_span
        support_span = content_span - 1
        elements.extend(
            _media(
                order,
                _grid_x(content_span),
                248,
                _grid_width(media_span),
                640,
                4,
                style,
                _media_caption(slide),
            )
        )
        if duplicates_items and items:
            row_top = 288
            row_area_height = 584
            row_height = row_area_height // len(items)
            elements.append(
                _rect(
                    order,
                    "editorial_rule",
                    "decoration",
                    SAFE_X,
                    row_top,
                    12,
                    row_area_height,
                    3,
                    style.focal,
                    radius=6,
                )
            )
            for index, (identifier, value) in enumerate(items):
                y = row_top + index * row_height
                elements.extend(
                    [
                        _text(
                            order,
                            f"support_index_{index + 1}",
                            "highlight",
                            f"{index + 1:02d}",
                            _grid_x(0) + 36,
                            y + 12,
                            106,
                            row_height - 24,
                            5,
                            style.focal,
                            48,
                            "bold",
                            style.heading_font,
                            vertical="middle",
                        ),
                        _text(
                            order,
                            f"support_{index + 1}",
                            "body",
                            value,
                            _grid_x(1),
                            y + 12,
                            _grid_width(support_span),
                            row_height - 24,
                            5,
                            style.text,
                            max(34, style.body_size + 2),
                            "semibold",
                            style.body_font,
                            vertical="middle",
                            content_item_ids=[identifier],
                        ),
                    ]
                )
                if index < len(items) - 1:
                    elements.append(
                        _rect(
                            order,
                            f"support_divider_{index + 1}",
                            "decoration",
                            _grid_x(1),
                            y + row_height - 2,
                            _grid_width(support_span),
                            2,
                            3,
                            style.secondary,
                        )
                    )
        else:
            elements.append(
                _text(
                    order,
                    "message",
                    "highlight",
                    str(slide.get("message", "")),
                    _grid_x(0),
                    304,
                    _grid_width(content_span),
                    256,
                    5,
                    style.text,
                    max(44, style.body_size + 8),
                    "bold",
                    style.heading_font,
                    line_height=1.2,
                )
            )
            if items:
                elements.append(
                    _text(
                        order,
                        "support",
                        "body",
                        "\n".join(f"• {value}" for _, value in items),
                        _grid_x(0),
                        608,
                        _grid_width(content_span),
                        264,
                        5,
                        style.muted_text,
                        style.body_size,
                        "semibold",
                        style.body_font,
                        content_item_ids=[identifier for identifier, _ in items],
                    )
                )
        return elements, _id(order, "media_placeholder")

    if not duplicates_items:
        panel_fill = style.surface if _is_dark(style.background) else style.text
        panel_text = _contrasting_text_color(panel_fill, style.text)
        message = _text(
            order,
            "message",
            "highlight",
            str(slide.get("message", "")),
            _grid_x(0) + 48,
            344,
            _grid_width(7) - 96,
            456,
            5,
            panel_text,
            max(48, style.body_size + 12),
            "bold",
            style.heading_font,
            line_height=1.2,
            vertical="middle",
        )
        elements.extend(
            [
                _rect(
                    order,
                    "message_field",
                    "decoration",
                    _grid_x(0),
                    288,
                    _grid_width(7),
                    584,
                    3,
                    panel_fill,
                    radius=8,
                ),
                message,
            ]
        )
        row_height = (584 - 16 * max(0, len(items) - 1)) // max(1, len(items))
        colors = _editorial_field_colors(style)
        for index, (identifier, value) in enumerate(items):
            y = 288 + index * (row_height + 16)
            fill = colors[(index + 2) % len(colors)]
            elements.extend(
                [
                    _rect(
                        order,
                        f"item_{index + 1}_field",
                        "decoration",
                        _grid_x(7),
                        y,
                        _grid_width(5),
                        row_height,
                        3,
                        fill,
                        radius=8,
                    ),
                    _text(
                        order,
                        f"item_{index + 1}",
                        "body",
                        value,
                        _grid_x(7) + 32,
                        y + 24,
                        _grid_width(5) - 64,
                        row_height - 48,
                        5,
                        _contrasting_text_color(fill, style.text),
                        max(34, style.body_size + 2),
                        "semibold",
                        style.body_font,
                        vertical="middle",
                        content_item_ids=[identifier],
                    ),
                ]
            )
        return elements, message["elementId"]

    if len(items) >= 3:
        focal_x = _grid_x(0)
        focal_y = 288
        focal_width = _grid_width(5)
        focal_height = 584
        focal_text = _contrasting_text_color(style.focal, style.text)
        first_id, first_value = items[0]
        elements.extend(
            [
                _rect(order, "item_1_field", "decoration", focal_x, focal_y, focal_width, focal_height, 3, style.focal, radius=8),
                _text(order, "item_1_index", "highlight", "01", focal_x + 48, focal_y + 32, focal_width - 96, 72, 5, focal_text, 56, "bold", style.heading_font),
                _text(order, "item_1", "body", first_value, focal_x + 48, focal_y + 128, focal_width - 96, focal_height - 176, 5, focal_text, max(44, style.body_size + 10), "bold", style.body_font, vertical="middle", content_item_ids=[first_id]),
            ]
        )
        supporting = items[1:]
        row_height = focal_height // len(supporting)
        for index, (identifier, value) in enumerate(supporting, start=2):
            y = focal_y + (index - 2) * row_height
            elements.extend(
                [
                    _text(order, f"item_{index}_index", "highlight", f"{index:02d}", _grid_x(5) + 36, y + 16, 82, row_height - 32, 5, style.focal if index % 2 == 0 else style.secondary, 44, "bold", style.heading_font, vertical="middle"),
                    _text(order, f"item_{index}", "body", value, _grid_x(6), y + 16, _grid_width(6), row_height - 32, 5, style.text, max(36, style.body_size + 4), "semibold", style.body_font, vertical="middle", content_item_ids=[identifier]),
                ]
            )
            if index < len(items):
                elements.append(
                    _rect(order, f"item_{index}_divider", "decoration", _grid_x(6), y + row_height - 2, _grid_width(6), 2, 3, style.secondary)
                )
        return elements, _id(order, "item_1")

    if len(items) == 2:
        frames = [
            (_grid_x(0), 288, _grid_width(7), 584),
            (_grid_x(7), 288, _grid_width(5), 584),
        ]
    elif len(items) == 3:
        frames = [
            (_grid_x(0), 288, _grid_width(7), 584),
            (_grid_x(7), 288, _grid_width(5), 280),
            (_grid_x(7), 592, _grid_width(5), 280),
        ]
    else:
        frames = []
    colors = _editorial_field_colors(style)
    for index, ((identifier, value), (x, y, width, height)) in enumerate(
        zip(items, frames, strict=True)
    ):
        fill = colors[index % len(colors)]
        text_color = _contrasting_text_color(fill, style.text)
        elements.extend(
            [
                _rect(
                    order,
                    f"item_{index + 1}_field",
                    "decoration",
                    x,
                    y,
                    width,
                    height,
                    3,
                    fill,
                    radius=8,
                ),
                _text(
                    order,
                    f"item_{index + 1}_index",
                    "highlight",
                    f"{index + 1:02d}",
                    x + 36,
                    y + 28,
                    width - 72,
                    72,
                    5,
                    text_color,
                    52,
                    "bold",
                    style.heading_font,
                ),
                _text(
                    order,
                    f"item_{index + 1}",
                    "body",
                    value,
                    x + 36,
                    y + 112,
                    width - 72,
                    height - 148,
                    5,
                    text_color,
                    max(38, style.body_size + 4),
                    "semibold",
                    style.body_font,
                    vertical="middle",
                    content_item_ids=[identifier],
                ),
            ]
        )
    return elements, _id(order, "item_1") if items else _id(order, "title")


def _metric_poster(direction: SlideCompositionDirection, slide: dict[str, Any], style: Style) -> tuple[list[Element], str]:
    order = direction.order
    items = _items(slide)
    metric = _metric_value(slide, items)
    metric_font_size = 72 if len(metric) > 12 else 92
    metric_element = _text(order, "metric", "highlight", metric, _grid_x(0), 288, _grid_width(10), 248, 5, style.focal, metric_font_size, "bold", style.heading_font, line_height=1.2)
    duplicates_items = _message_duplicates_items(slide, items)
    elements = [
        _background(order, style),
        _title(order, slide, style),
        metric_element,
        _rect(order, "metric_rule", "decoration", _grid_x(0), 568, _grid_width(2), 12, 3, style.secondary, radius=6),
    ]
    if not duplicates_items:
        elements.append(_text(order, "message", "body", str(slide.get("message", "")), _grid_x(0), 632, _grid_width(10), 136, 5, style.text, max(26, style.body_size + 4), "semibold", style.body_font))
    if items:
        elements.append(_text(order, "support", "body", "  ·  ".join(value for _, value in items), _grid_x(0), 632 if duplicates_items else 800, _grid_width(11), 184 if duplicates_items else 104, 5, style.muted_text, max(22, style.body_size), "semibold" if duplicates_items else "normal", style.body_font, vertical="middle", content_item_ids=[identifier for identifier, _ in items]))
    return elements, metric_element["elementId"]


def _kpi_strip(direction: SlideCompositionDirection, slide: dict[str, Any], style: Style) -> tuple[list[Element], str]:
    order = direction.order
    items = _items(slide)
    duplicates_items = _message_duplicates_items(slide, items)
    elements = [_background(order, style), _title(order, slide, style)]
    if not duplicates_items:
        elements.append(_text(order, "message", "highlight", str(slide.get("message", "")), 120, 250, 1500, 120, 5, style.text, max(40, style.body_size + 6), "semibold", style.heading_font))
    count = max(1, len(items))
    gap = 24
    field_y = 330 if duplicates_items else 430
    field_height = 460 if duplicates_items else 360
    if count == 2:
        frames = [
            (_grid_x(0), field_y, _grid_width(7), field_height),
            (_grid_x(7), field_y + 64, _grid_width(5), field_height - 128),
        ]
    else:
        width = (SAFE_WIDTH - gap * (count - 1)) // count
        frames = [
            (SAFE_X + index * (width + gap), field_y, width, field_height)
            for index in range(count)
        ]
    colors = _editorial_field_colors(style)
    for index, ((identifier, value), (x, y, width, height)) in enumerate(
        zip(items, frames, strict=True)
    ):
        fill = colors[index % len(colors)]
        text_color = _contrasting_text_color(fill, style.text)
        elements.extend([
            _rect(order, f"kpi_{index + 1}_field", "decoration", x, y, width, height, 3, fill, radius=8),
            _text(order, f"kpi_{index + 1}", "highlight", value, x + 36, y + 36, width - 72, height - 72, 5, text_color, max(52, style.body_size + 12) if index == 0 else max(44, style.body_size + 8), "bold", style.heading_font, vertical="middle", content_item_ids=[identifier]),
        ])
    return elements, _id(order, "kpi_1")


def _image_evidence(direction: SlideCompositionDirection, slide: dict[str, Any], style: Style) -> tuple[list[Element], str]:
    if direction.asset_role == "none":
        raise CompositionCompileError("image-evidence requires an asset")
    order = direction.order
    items = _items(slide)
    elements = [_background(order, style), _title(order, slide, style), *_media(order, _grid_x(0), 272, _grid_width(6), 616, 4, style, _media_caption(slide)), _text(order, "message", "highlight", str(slide.get("message", "")), _grid_x(6), 304, _grid_width(6), 248, 5, style.text, max(44, style.body_size + 8), "bold", style.heading_font, line_height=1.2)]
    if items:
        elements.append(_text(order, "evidence", "body", "\n".join(f"• {value}" for _, value in items), _grid_x(6), 584, _grid_width(6), 288, 5, style.muted_text, style.body_size, "semibold", style.body_font, content_item_ids=[identifier for identifier, _ in items]))
    return elements, _id(order, "media_placeholder")


def _feature_comparison(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    style: Style,
) -> tuple[list[Element], str]:
    order = direction.order
    items = _items(slide)
    elements = [_background(order, style), _title(order, slide, style)]
    duplicates_items = _message_duplicates_items(slide, items)
    content_top = 288 if duplicates_items else 344
    content_height = 584 if duplicates_items else 528
    if not duplicates_items:
        elements.append(
            _text(
                order,
                "message",
                "highlight",
                str(slide.get("message", "")),
                SAFE_X,
                232,
                SAFE_WIDTH,
                80,
                5,
                style.muted_text,
                max(34, style.body_size),
                "semibold",
                style.body_font,
                vertical="middle",
            )
        )
    count = len(items)
    colors = _editorial_field_colors(style)
    if count == 4:
        focal_fill = colors[0]
        focal_text = _contrasting_text_color(focal_fill, style.text)
        first_id, first_value = items[0]
        focal_height = 216
        elements.extend(
            [
                _rect(order, "comparison_1_field", "decoration", SAFE_X, content_top, SAFE_WIDTH, focal_height, 3, focal_fill, radius=8),
                _text(order, "comparison_1_index", "highlight", "01", SAFE_X + 36, content_top + 24, 96, focal_height - 48, 5, focal_text, 52, "bold", style.heading_font, vertical="middle"),
                _text(order, "comparison_1", "body", first_value, SAFE_X + 160, content_top + 24, SAFE_WIDTH - 196, focal_height - 48, 5, focal_text, max(44, style.body_size + 10), "bold", style.body_font, vertical="middle", content_item_ids=[first_id]),
            ]
        )
        support_top = content_top + focal_height + 24
        support_height = content_height - focal_height - 24
        for index, (identifier, value) in enumerate(items[1:], start=2):
            column = index - 2
            x = _grid_x(column * 4)
            width = _grid_width(4)
            marker_color = style.focal if index % 2 == 0 else style.secondary
            elements.extend(
                [
                    _rect(order, f"comparison_{index}_rule", "decoration", x, support_top, width, 8, 3, marker_color, radius=4),
                    _text(order, f"comparison_{index}_index", "highlight", f"{index:02d}", x, support_top + 32, width, 64, 5, marker_color, 44, "bold", style.heading_font),
                    _text(order, f"comparison_{index}", "body", value, x, support_top + 112, width, support_height - 112, 5, style.text, max(34, style.body_size + 2), "semibold", style.body_font, vertical="middle", content_item_ids=[identifier]),
                ]
            )
        return elements, _id(order, "comparison_1")
    frames: list[tuple[int, int, int, int]]
    if count == 3:
        stacked_height = (content_height - 24) // 2
        dominant_left = order % 2 == 1
        dominant_frame = (
            _grid_x(0 if dominant_left else 5),
            content_top,
            _grid_width(7),
            content_height,
        )
        stack_x = _grid_x(7 if dominant_left else 0)
        stack_frames = [
            (stack_x, content_top, _grid_width(5), stacked_height),
            (
                stack_x,
                content_top + stacked_height + 24,
                _grid_width(5),
                stacked_height,
            ),
        ]
        frames = [dominant_frame, *stack_frames]
    elif count == 2 and order % 2 == 0:
        frames = [
            (_grid_x(0), content_top + 96, _grid_width(5), content_height - 192),
            (_grid_x(5), content_top, _grid_width(7), content_height),
        ]
    elif count == 2:
        frames = [
            (_grid_x(0), content_top, _grid_width(7), content_height),
            (_grid_x(7), content_top + 96, _grid_width(5), content_height - 192),
        ]
    else:
        columns = 2
        rows = (count + columns - 1) // columns
        gap = 24
        width = _grid_width(6)
        height = (content_height - gap * (rows - 1)) // max(1, rows)
        frames = [
            (
                _grid_x((index % columns) * 6),
                content_top + (index // columns) * (height + gap),
                width,
                height,
            )
            for index in range(count)
        ]
    for index, ((identifier, value), (x, y, width, height)) in enumerate(
        zip(items, frames, strict=True)
    ):
        field_fill = colors[index % len(colors)]
        field_text = _contrasting_text_color(field_fill, style.text)
        elements.extend(
            [
                _rect(
                    order,
                    f"comparison_{index + 1}_field",
                    "decoration",
                    x,
                    y,
                    width,
                    height,
                    3,
                    field_fill,
                    radius=8,
                ),
                _text(
                    order,
                    f"comparison_{index + 1}_index",
                    "highlight",
                    f"{index + 1:02d}",
                    x + 32,
                    y + 28,
                    width - 64,
                    72,
                    5,
                    field_text,
                    52,
                    "bold",
                    style.heading_font,
                ),
                _text(
                    order,
                    f"comparison_{index + 1}",
                    "body",
                    value,
                    x + 32,
                    y + 120,
                    width - 64,
                    height - 156,
                    5,
                    field_text,
                    max(38, style.body_size + 4),
                    "semibold",
                    style.body_font,
                    vertical="middle",
                    content_item_ids=[identifier],
                ),
            ]
        )
    focal = _id(order, "comparison_1") if items else _id(order, "title")
    return elements, focal


def _process_horizontal(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    style: Style,
) -> tuple[list[Element], str]:
    order = direction.order
    items = _items(slide)
    elements = [_background(order, style), _title(order, slide, style)]
    duplicates_items = _message_duplicates_items(slide, items)
    count = max(1, len(items))
    gap = 24
    field_y = 304
    field_height = 552 if duplicates_items else 496
    if count == 3:
        stacked_height = (field_height - gap) // 2
        frames = [
            (_grid_x(0), field_y, _grid_width(6), field_height),
            (_grid_x(6), field_y, _grid_width(6), stacked_height),
            (
                _grid_x(6),
                field_y + stacked_height + gap,
                _grid_width(6),
                stacked_height,
            ),
        ]
        elements.extend(
            [
                _rect(
                    order,
                    "step_connector_1",
                    "decoration",
                    _grid_x(0) + _grid_width(6),
                    field_y + stacked_height // 2 - 5,
                    gap,
                    10,
                    2,
                    style.secondary,
                    radius=5,
                ),
                _rect(
                    order,
                    "step_connector_2",
                    "decoration",
                    _grid_x(6) + _grid_width(6) // 2 - 5,
                    field_y + stacked_height,
                    10,
                    gap,
                    2,
                    style.secondary,
                    radius=5,
                ),
            ]
        )
    else:
        width = (SAFE_WIDTH - gap * (count - 1)) // count
        frames = [
            (SAFE_X + index * (width + gap), field_y, width, field_height)
            for index in range(count)
        ]
    colors = _editorial_field_colors(style)
    for index, ((identifier, value), (x, y, width, height)) in enumerate(
        zip(items, frames, strict=True)
    ):
        fill = colors[index % len(colors)]
        text_color = _contrasting_text_color(fill, style.text)
        if count != 3 and index > 0:
            elements.append(
                _rect(
                    order,
                    f"step_connector_{index}",
                    "decoration",
                    x - gap,
                    y + height // 2 - 5,
                    gap,
                    10,
                    2,
                    style.secondary,
                    radius=5,
                )
            )
        elements.extend(
            [
                _rect(
                    order,
                    f"step_{index + 1}_field",
                    "decoration",
                    x,
                    y,
                    width,
                    height,
                    3,
                    fill,
                    radius=8,
                ),
                _text(
                    order,
                    f"step_number_{index + 1}",
                    "highlight",
                    f"{index + 1:02d}",
                    x + 32,
                    y + 24,
                    width - 64,
                    72,
                    5,
                    text_color,
                    64 if count == 3 and index == 0 else 48 if count <= 4 else 44,
                    "bold",
                    style.heading_font,
                ),
                _text(
                    order,
                    f"step_{index + 1}",
                    "body",
                    value,
                    x + 32,
                    y + 112,
                    width - 64,
                    height - 144,
                    5,
                    text_color,
                    max(44, style.body_size + 10)
                    if count == 3 and index == 0
                    else max(36, style.body_size + (4 if count <= 4 else 0)),
                    "semibold",
                    style.body_font,
                    vertical="middle",
                    content_item_ids=[identifier],
                ),
            ]
        )
    if not duplicates_items:
        elements.append(
            _text(
                order,
                "process_message",
                "highlight",
                str(slide.get("message", "")),
                SAFE_X,
                832,
                SAFE_WIDTH,
                80,
                5,
                style.text,
                max(34, style.body_size),
                "bold",
                style.body_font,
                align="center",
                vertical="middle",
            )
        )
    return elements, _id(order, "step_1")


def _timeline(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    style: Style,
) -> tuple[list[Element], str]:
    order = direction.order
    items = _items(slide)
    count = max(1, len(items))
    duplicates_items = _message_duplicates_items(slide, items)
    frames = _timeline_column_frames(count)
    track_y = 584
    elements = [
        _background(order, style),
        _title(order, slide, style),
        _rect(
            order,
            "timeline_line",
            "decoration",
            SAFE_X,
            track_y - 5,
            SAFE_WIDTH,
            10,
            2,
            style.secondary,
            radius=5,
        ),
    ]
    for index, ((identifier, value), (x, width)) in enumerate(
        zip(items, frames, strict=True)
    ):
        above_track = index % 2 == 0
        index_y = 292 if above_track else 668
        body_y = 360 if above_track else 736
        stem_y = 536 if above_track else 616
        center = x + width // 2
        marker_color = style.focal if index % 2 == 0 else style.secondary
        marker_text = _contrasting_text_color(marker_color, style.text)
        elements.extend(
            [
                _text(
                    order,
                    f"timeline_{index + 1}_index",
                    "highlight",
                    f"{index + 1:02d}",
                    x,
                    index_y,
                    width,
                    64,
                    5,
                    marker_color,
                    52 if count <= 4 else 44,
                    "bold",
                    style.heading_font,
                    align="center",
                ),
                _text(
                    order,
                    f"timeline_{index + 1}",
                    "body",
                    value,
                    x,
                    body_y,
                    width,
                    168,
                    5,
                    style.text,
                    max(36, style.body_size + 4)
                    if count <= 4
                    else style.body_size,
                    "semibold",
                    style.body_font,
                    align="center",
                    vertical="middle",
                    content_item_ids=[identifier],
                ),
                _rect(
                    order,
                    f"timeline_stem_{index + 1}",
                    "decoration",
                    center - 4,
                    stem_y,
                    8,
                    32,
                    2,
                    marker_color,
                    radius=4,
                ),
                _rect(
                    order,
                    f"timeline_marker_{index + 1}",
                    "decoration",
                    center - 32,
                    track_y - 32,
                    64,
                    64,
                    4,
                    marker_color,
                    radius=32,
                ),
                _text(
                    order,
                    f"timeline_marker_label_{index + 1}",
                    "highlight",
                    str(index + 1),
                    center - 32,
                    track_y - 24,
                    64,
                    48,
                    5,
                    marker_text,
                    30,
                    "bold",
                    style.heading_font,
                    align="center",
                    vertical="middle",
                ),
            ]
        )
    if not duplicates_items:
        elements.append(
            _text(
                order,
                "timeline_message",
                "highlight",
                str(slide.get("message", "")),
                SAFE_X,
                920,
                SAFE_WIDTH,
                64,
                5,
                style.text,
                max(32, style.body_size),
                "bold",
                style.body_font,
                align="center",
                vertical="middle",
            )
        )
    return elements, _id(order, "timeline_1")


def _timeline_column_frames(count: int) -> list[tuple[int, int]]:
    base_span, remainder = divmod(12, count)
    spans = [base_span] * count
    for offset in range(remainder):
        index = round(offset * (count - 1) / max(1, remainder - 1))
        spans[index] += 1

    frames: list[tuple[int, int]] = []
    column = 0
    for span in spans:
        frames.append((_grid_x(column), _grid_width(span)))
        column += span
    return frames


def _diagram_hub(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    style: Style,
) -> tuple[list[Element], str]:
    order = direction.order
    items = _items(slide)
    hub_x = _grid_x(4)
    hub_width = _grid_width(4)
    hub_y = 336
    hub_height = 352
    hub = _rect(
        order,
        "hub_field",
        "highlight",
        hub_x,
        hub_y,
        hub_width,
        hub_height,
        4,
        style.focal,
        radius=8,
    )
    hub_copy = (
        f"{len(items)}가지\n핵심 축"
        if _message_duplicates_items(slide, items)
        else str(slide.get("message", ""))
    )
    hub_display = (
        hub_copy
        if len(hub_copy) <= 28
        else textwrap.shorten(hub_copy, width=80, placeholder="...")
    )
    hub_font_size = 56 if len(hub_copy) <= 16 else 44 if len(hub_copy) <= 28 else 36
    elements = [
        _background(order, style),
        _title(order, slide, style),
        hub,
        _text(
            order,
            "hub",
            "highlight",
            hub_display,
            hub_x + 36,
            hub_y + 48,
            hub_width - 72,
            hub_height - 96,
            5,
            _contrasting_text_color(style.focal, style.text),
            hub_font_size,
            "bold",
            style.heading_font,
            align="center",
            vertical="middle",
        ),
    ]
    if len(items) == 3:
        frames = [
            (_grid_x(0), 312, _grid_width(4), 400),
            (_grid_x(8), 312, _grid_width(4), 400),
            (_grid_x(4), 744, _grid_width(4), 184),
        ]
        elements.extend(
            [
                _rect(
                    order,
                    "connector_left",
                    "decoration",
                    _grid_x(0) + _grid_width(4),
                    508,
                    hub_x - (_grid_x(0) + _grid_width(4)),
                    8,
                    2,
                    style.secondary,
                    radius=4,
                ),
                _rect(
                    order,
                    "connector_right",
                    "decoration",
                    hub_x + hub_width,
                    508,
                    _grid_x(8) - (hub_x + hub_width),
                    8,
                    2,
                    style.secondary,
                    radius=4,
                ),
                _rect(
                    order,
                    "connector_bottom",
                    "decoration",
                    hub_x + hub_width // 2 - 4,
                    hub_y + hub_height,
                    8,
                    56,
                    2,
                    style.secondary,
                    radius=4,
                ),
            ]
        )
    elif len(items) == 4:
        frames = [
            (_grid_x(0), 288, _grid_width(3), 248),
            (_grid_x(9), 288, _grid_width(3), 248),
            (_grid_x(0), 664, _grid_width(3), 248),
            (_grid_x(9), 664, _grid_width(3), 248),
        ]
    else:
        frames = [
            (_grid_x(0), 288, _grid_width(3), 176),
            (_grid_x(9), 288, _grid_width(3), 176),
            (_grid_x(0), 512, _grid_width(3), 176),
            (_grid_x(9), 512, _grid_width(3), 176),
            (_grid_x(0), 736, _grid_width(3), 168),
            (_grid_x(9), 736, _grid_width(3), 168),
        ][: len(items)]
    if len(items) > 3:
        hub_center_x = hub_x + hub_width // 2
        hub_center_y = hub_y + hub_height // 2
        for index, (x, y, width, height) in enumerate(frames):
            target_x = x + width // 2
            target_y = y + height // 2
            delta_x = target_x - hub_center_x
            delta_y = target_y - hub_center_y
            connector = _rect(
                order,
                f"connector_{index + 1}",
                "decoration",
                hub_center_x,
                hub_center_y - 4,
                max(8, round(hypot(delta_x, delta_y))),
                8,
                2,
                style.secondary,
                radius=4,
            )
            connector["rotation"] = degrees(atan2(delta_y, delta_x))
            elements.append(connector)
    colors = _editorial_field_colors(style)
    for index, ((identifier, value), (x, y, width, height)) in enumerate(
        zip(items, frames, strict=True)
    ):
        fill = colors[(index + 1) % len(colors)]
        text_color = _contrasting_text_color(fill, style.text)
        elements.extend(
            [
                _rect(
                    order,
                    f"node_{index + 1}_field",
                    "decoration",
                    x,
                    y,
                    width,
                    height,
                    3,
                    fill,
                    radius=8,
                ),
                _text(
                    order,
                    f"node_{index + 1}_index",
                    "highlight",
                    f"{index + 1:02d}",
                    x + 32,
                    y + 20,
                    width - 64,
                    56,
                    5,
                    text_color,
                    48,
                    "bold",
                    style.heading_font,
                ),
                _text(
                    order,
                    f"node_{index + 1}",
                    "body",
                    value,
                    x + 32,
                    y + 80,
                    width - 64,
                    height - 104,
                    5,
                    text_color,
                    max(38, style.body_size + 4) if len(items) <= 4 else style.body_size,
                    "semibold",
                    style.body_font,
                    align="center",
                    vertical="middle",
                    content_item_ids=[identifier],
                ),
            ]
        )
    return elements, _id(order, "hub")


def _cta_closing(direction: SlideCompositionDirection, slide: dict[str, Any], style: Style) -> tuple[list[Element], str]:
    order = direction.order
    items = _items(slide)
    action_items = _supporting_items_without_message_duplicate(slide, items)
    message_item_ids = _message_backed_item_ids(slide, items)
    duplicates_items = bool(items) and not action_items
    if direction.asset_role != "none":
        content_width = _grid_width(6)
        title = _text(order, "title", "title", str(slide.get("title", "")), _grid_x(0), 224, content_width, 216, 5, style.text, max(style.cover_size - 4, 48), "bold", style.heading_font, line_height=1.05)
        message = _text(order, "message", "highlight", str(slide.get("message", "")), _grid_x(0), 496, content_width, 376 if duplicates_items else 176, 5, style.text, max(44, style.body_size + 8) if duplicates_items else max(42, style.body_size + 6), "bold" if duplicates_items else "semibold", style.body_font, vertical="middle" if duplicates_items else "top", content_item_ids=message_item_ids or None)
        elements = [_background(order, style), _rect(order, "closing_mark", "decoration", 120, 152, 180, 16, 2, style.focal), title, message]
        action = None
        if action_items:
            action = _text(order, "actions", "body", "  /  ".join(value for _, value in action_items), _grid_x(0), 736, content_width, 120, 5, style.text, max(36, style.body_size + 4), "bold", style.body_font, content_item_ids=[identifier for identifier, _ in action_items])
            elements.append(action)
        elements.extend(_media(order, _grid_x(6), 208, _grid_width(6), 624, 3, style, _media_caption(slide)))
        return elements, (action or message)["elementId"]

    title = _text(
        order, "title", "title", str(slide.get("title", "")),
        _grid_x(0), 216, _grid_width(12), 176, 5, style.text,
        max(style.cover_size - 4, 52), "bold", style.heading_font, line_height=1.05,
    )
    message_width = _grid_width(7) if action_items else _grid_width(12)
    message_y = 432 if action_items else 424
    message_height = 400 if action_items else 448
    message_text_y = message_y + 36
    message_text_height = message_height - 72
    message_field = _rect(
        order, "closing_message_field", "decoration", _grid_x(0), message_y,
        message_width, message_height, 3, style.focal, radius=8,
    )
    message = _text(
        order, "closing_message", "highlight", str(slide.get("message", "")),
        _grid_x(0) + 48, message_text_y, message_width - 96, message_text_height, 5,
        _contrasting_text_color(style.focal, style.text),
        max(52, style.body_size + 14), "bold", style.heading_font,
        vertical="middle",
        content_item_ids=message_item_ids or None,
    )
    elements = [
        _background(order, style),
        _rect(order, "closing_mark", "decoration", 120, 152, 180, 16, 2, style.focal),
        title,
        message_field,
        message,
    ]
    if action_items:
        action_x = _grid_x(7)
        action_width = _grid_width(5)
        action_y = message_y
        action_height = message_height
        row_height = action_height // len(action_items)
        elements.append(
            _rect(order, "closing_action_rule", "decoration", action_x, action_y, 10, action_height, 3, style.secondary, radius=5)
        )
        for index, (identifier, value) in enumerate(action_items):
            y = action_y + index * row_height
            elements.extend(
                [
                    _text(order, f"closing_action_index_{index + 1}", "highlight", f"{index + 1:02d}", _grid_x(7), y + 16, _grid_width(1), row_height - 32, 5, style.focal, 38, "bold", style.heading_font, vertical="middle"),
                    _text(order, f"closing_action_{index + 1}", "body", value, _grid_x(8), y + 16, _grid_width(4), row_height - 32, 5, style.text, max(36, style.body_size + 4), "semibold", style.body_font, vertical="middle", content_item_ids=[identifier]),
                ]
            )
            if index < len(action_items) - 1:
                elements.append(
                    _rect(order, f"closing_action_divider_{index + 1}", "decoration", action_x + 36, y + row_height - 2, action_width - 36, 2, 3, style.secondary)
                )
    return elements, message["elementId"]


COMPOSITION_SPECS: dict[CompositionId, CompositionSpec] = {
    "cover-classic-corporate": CompositionSpec("cover-classic-corporate", ("cover",), 0, 0, "none", ("light", "dark"), "cover-centered-corporate", "title", _cover_classic_corporate),
    "cover-visual-impact": CompositionSpec("cover-visual-impact", ("cover",), 0, 0, "required", ("light", "dark"), "cover-image-right", "cover-image", _cover_visual_impact),
    "cover-immersive-background": CompositionSpec("cover-immersive-background", ("cover",), 0, 0, "required", ("image",), "cover-full-bleed", "cover-image", _cover_immersive_background),
    "cover-research-author": CompositionSpec("cover-research-author", ("cover",), 0, 0, "required", ("light", "dark"), "cover-author", "cover-image", _cover_research_author),
    "cover-structured-report": CompositionSpec("cover-structured-report", ("cover",), 0, 0, "none", ("light", "dark"), "cover-report-split", "title", _cover_structured_report),
    "cover-modern-high-tech": CompositionSpec("cover-modern-high-tech", ("cover",), 0, 0, "none", ("dark",), "cover-high-tech", "title", _cover_modern_high_tech),
    "hero-split": CompositionSpec("hero-split", ("cover", "title", "solution", "feature-grid"), 1, 3, "optional", ("light", "dark"), "split-hero", "hero-image-or-title", _hero_split),
    "hero-full-bleed": CompositionSpec("hero-full-bleed", ("cover", "title"), 1, 2, "required", ("image",), "full-bleed", "hero-image", _hero_full_bleed),
    "minimal-cover": CompositionSpec("minimal-cover", ("cover", "title"), 0, 3, "none", ("light", "dark"), "minimal", "title", _minimal_cover),
    "statement-poster": CompositionSpec("statement-poster", ("problem", "solution", "quote", "summary"), 1, 2, "none", ("light", "dark"), "poster", "statement", _statement_poster),
    "editorial-split": CompositionSpec("editorial-split", ("problem", "solution", "feature-grid", "data", "comparison"), 2, 4, "optional", ("light", "dark"), "split-editorial", "message-or-image", _editorial_split),
    "metric-poster": CompositionSpec("metric-poster", ("data", "chart", "summary"), 1, 3, "none", ("light", "dark"), "poster-metric", "metric", _metric_poster),
    "kpi-strip-evidence": CompositionSpec("kpi-strip-evidence", ("data", "chart", "feature-grid", "solution"), 2, 4, "none", ("light", "dark"), "evidence-strip", "first-kpi", _kpi_strip),
    "image-evidence": CompositionSpec("image-evidence", ("data", "feature-grid", "solution", "quote"), 1, 3, "required", ("light", "dark"), "image-evidence", "evidence-image", _image_evidence),
    "feature-comparison": CompositionSpec("feature-comparison", ("comparison", "feature-grid"), 2, 4, "none", ("light", "dark"), "segmented-fields", "first-comparison", _feature_comparison),
    "process-horizontal": CompositionSpec("process-horizontal", ("process", "architecture"), 3, 6, "none", ("light", "dark"), "segmented-fields", "first-step", _process_horizontal),
    "timeline": CompositionSpec("timeline", ("process", "data", "summary"), 3, 6, "none", ("light", "dark"), "timeline", "first-milestone", _timeline),
    "diagram-hub": CompositionSpec("diagram-hub", ("architecture", "feature-grid", "solution"), 3, 6, "none", ("light", "dark"), "diagram", "hub", _diagram_hub),
    "cta-closing": CompositionSpec("cta-closing", ("summary",), 0, 3, "optional", ("light", "dark"), "closing", "cta", _cta_closing),
}


FALLBACK_COMPOSITIONS: dict[str, tuple[CompositionId, ...]] = {
    "cover": COVER_COMPOSITION_IDS,
    "title": ("hero-split", "minimal-cover"),
    "problem": ("statement-poster", "editorial-split"),
    "solution": ("editorial-split", "statement-poster", "diagram-hub"),
    "feature-grid": ("editorial-split", "feature-comparison", "kpi-strip-evidence", "diagram-hub"),
    "process": ("process-horizontal", "timeline"),
    "architecture": ("diagram-hub", "process-horizontal"),
    "data": ("metric-poster", "kpi-strip-evidence", "image-evidence", "editorial-split"),
    "chart": ("metric-poster", "kpi-strip-evidence"),
    "comparison": ("feature-comparison", "editorial-split"),
    "quote": ("statement-poster", "image-evidence"),
    "summary": ("cta-closing", "statement-poster"),
}


def normalize_design_program(
    program: DeckDesignProgram,
    slides: list[dict[str, Any]],
    *,
    force_light: bool = False,
    force_dark: bool = False,
    media_policy: str = "hybrid",
    media_budget: int = 4,
    preserve_slide_types: bool = False,
) -> DeckDesignProgram:
    if len(program.slides) != len(slides):
        raise CompositionCompileError("Design Program slide count mismatch")
    normalized = program.model_copy(deep=True)
    selected_ids = _select_composition_sequence(
        normalized,
        slides,
        force_light=force_light,
        force_dark=force_dark,
        media_policy=media_policy,
        media_budget=media_budget,
        preserve_slide_types=preserve_slide_types,
    )
    for index, (direction, selected) in enumerate(
        zip(normalized.slides, selected_ids, strict=True)
    ):
        selected_spec = COMPOSITION_SPECS[selected]
        direction.composition_id = selected
        if force_light:
            direction.variant = "light"
            direction.background_mode = "light"
        elif force_dark:
            direction.variant = "dark"
            direction.background_mode = "dark"
        elif direction.variant not in selected_spec.variants:
            direction.variant = (
                "image"
                if "image" in selected_spec.variants
                else "dark"
                if "dark" in selected_spec.variants
                else selected_spec.variants[0]
            )
            direction.background_mode = direction.variant
        official_source_available = slides[index].get("officialSourceAvailable")
        if selected_spec.media_requirement == "none" or media_policy in {"minimal", "avoid"}:
            direction.asset_role = "none"
            direction.required_asset = False
        elif selected_spec.media_requirement == "required":
            if selected == "cover-research-author":
                direction.asset_role = "evidence"
            elif direction.asset_role == "none":
                if media_policy == "hybrid":
                    direction.asset_role = (
                        "evidence"
                        if official_source_available is True
                        else "atmosphere"
                    )
                else:
                    direction.asset_role = "atmosphere" if index == 0 else "evidence"
            direction.required_asset = True
        if (
            media_policy == "hybrid"
            and direction.asset_role == "evidence"
            and official_source_available is False
        ):
            direction.asset_role = "none"
            direction.required_asset = False

    _enforce_media_budget(normalized, slides, media_policy, media_budget)
    if media_policy == "hybrid":
        _enforce_hybrid_media_mix(normalized, slides, media_budget)
    _replace_body_hero_splits_without_media(normalized, slides)
    _enforce_background_rhythm(normalized, force_light, force_dark)
    return DeckDesignProgram.model_validate(normalized.model_dump(by_alias=True))


def _select_composition_sequence(
    program: DeckDesignProgram,
    slides: list[dict[str, Any]],
    *,
    force_light: bool,
    force_dark: bool,
    media_policy: str,
    media_budget: int,
    preserve_slide_types: bool,
) -> list[CompositionId]:
    candidates_by_slide: list[tuple[CompositionId, ...]] = []
    for index, (direction, slide) in enumerate(zip(program.slides, slides, strict=True)):
        slide_type = _composition_slide_type(slide)
        if not preserve_slide_types:
            if index == 0:
                slide_type = "cover"
            elif index == len(slides) - 1:
                slide_type = "summary"
        item_count = 0 if index == 0 and slide_type == "cover" else len(_items(slide))
        preferred = (
            "cta-closing"
            if index == len(slides) - 1 and not preserve_slide_types
            else direction.composition_id
        )
        fallback_candidates = FALLBACK_COMPOSITIONS.get(
            slide_type,
            ("statement-poster",),
        )
        if index == 0 and slide_type == "cover":
            requested_eligible = slide.get("eligibleCompositionIds", [])
            eligible = tuple(
                candidate
                for candidate in requested_eligible
                if candidate in COVER_COMPOSITION_IDS
            )
            fallback_candidates = eligible or COVER_COMPOSITION_IDS
        candidates = tuple(
            candidate
            for candidate in dict.fromkeys(
                (preferred, *fallback_candidates)
            )
            if candidate in fallback_candidates or index != 0 or slide_type != "cover"
            if _supports(candidate, slide_type, item_count)
            and content_supports_composition(candidate, slide)
            and not unavailable_hybrid_evidence_candidate(
                candidate,
                direction,
                slide,
                index,
                media_policy,
            )
            and not (
                candidate == "hero-split"
                and index > 0
                and direction.asset_role == "none"
            )
            and not (
                force_light and "light" not in COMPOSITION_SPECS[candidate].variants
            )
            and not (
                force_dark and "dark" not in COMPOSITION_SPECS[candidate].variants
            )
            and not (
                media_policy in {"minimal", "avoid"}
                and COMPOSITION_SPECS[candidate].media_requirement == "required"
            )
        )
        if (
            media_policy == "hybrid"
            and slide.get("officialSourceAvailable") is False
            and direction.asset_role == "evidence"
        ):
            candidates = tuple(
                sorted(
                    candidates,
                    key=lambda candidate: (
                        COMPOSITION_SPECS[candidate].media_requirement != "optional"
                    ),
                )
            )
        if not candidates:
            raise CompositionCompileError(
                f"No composition supports {slide_type} with {item_count} content items"
            )
        candidates_by_slide.append(candidates)

    selected: list[CompositionId] = []
    usage: Counter[str] = Counter()
    body_slide_count = max(0, len(slides) - 2)
    validator_unique_target = (
        (body_slide_count * 3 + 3) // 4 if body_slide_count >= 5 else 0
    )
    supported_body_compositions = {
        composition_id
        for candidates in candidates_by_slide[1:-1]
        for composition_id in candidates
    }
    required_unique_body = min(
        validator_unique_target,
        len(supported_body_compositions),
    )

    def choose(
        index: int,
        previous_silhouette: str,
        required_assets: int,
        *,
        usage_limit: int,
        unique_target: int,
        allow_repeated_silhouette: bool = False,
    ) -> bool:
        if index == len(candidates_by_slide):
            return len(set(selected[1:-1])) >= unique_target
        selected_body = set(selected[1:])
        remaining_body = max(0, len(candidates_by_slide) - 1 - max(index, 1))
        if len(selected_body) + remaining_body < unique_target:
            return False
        candidates = candidates_by_slide[index]
        if 0 < index < len(candidates_by_slide) - 1:
            candidates = tuple(
                [candidate for candidate in candidates if candidate not in selected_body]
                + [candidate for candidate in candidates if candidate in selected_body]
            )
        for candidate in candidates:
            spec = COMPOSITION_SPECS[candidate]
            next_required_assets = required_assets + (spec.media_requirement == "required")
            if (
                usage[candidate] >= usage_limit
                or (
                    not allow_repeated_silhouette
                    and spec.silhouette == previous_silhouette
                )
                or next_required_assets > media_budget
            ):
                continue
            usage[candidate] += 1
            selected.append(candidate)
            if choose(
                index + 1,
                spec.silhouette,
                next_required_assets,
                usage_limit=usage_limit,
                unique_target=unique_target,
                allow_repeated_silhouette=allow_repeated_silhouette,
            ):
                return True
            selected.pop()
            usage[candidate] -= 1
        return False

    if not choose(
        0,
        "",
        0,
        usage_limit=2,
        unique_target=required_unique_body,
    ):
        selected.clear()
        usage.clear()
    if not selected and not choose(
        0,
        "",
        0,
        usage_limit=3,
        unique_target=required_unique_body,
    ):
        selected.clear()
        usage.clear()
    if not selected and not choose(
        0,
        "",
        0,
        usage_limit=3,
        unique_target=max(0, required_unique_body - 1),
    ):
        selected.clear()
        usage.clear()
    if not selected and not choose(
        0,
        "",
        0,
        usage_limit=len(slides),
        unique_target=0,
        allow_repeated_silhouette=True,
    ):
        raise CompositionCompileError("No composition sequence satisfies the deck constraints")
    return selected


def content_supports_composition(
    composition_id: CompositionId,
    slide: dict[str, Any],
) -> bool:
    typed_metrics = _typed_metrics(slide)
    if composition_id == "kpi-strip-evidence":
        return len(typed_metrics) >= 2
    if composition_id == "metric-poster":
        return bool(typed_metrics)
    if composition_id == "cover-research-author":
        cover = _cover_content(slide)
        return bool(cover.get("presenterName") and cover.get("profileImageAssetId"))
    return True


def unavailable_hybrid_evidence_candidate(
    composition_id: CompositionId,
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    index: int,
    media_policy: str,
) -> bool:
    if (
        media_policy != "hybrid"
        or slide.get("officialSourceAvailable") is not False
    ):
        return False
    spec = COMPOSITION_SPECS[composition_id]
    effective_role = direction.asset_role
    if spec.media_requirement == "required" and effective_role == "none":
        effective_role = "atmosphere" if index == 0 else "evidence"
    return spec.media_requirement == "required" and effective_role == "evidence"


def compile_composition(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    program: DeckDesignProgram,
) -> CompiledComposition:
    spec = COMPOSITION_SPECS[direction.composition_id]
    item_count = (
        0
        if direction.composition_id in COVER_COMPOSITION_IDS
        else len(_items(slide))
    )
    slide_type = str(slide.get("slideType", "summary"))
    if not spec.min_items <= item_count <= spec.max_items:
        raise CompositionCompileError(
            f"{direction.composition_id} does not support {item_count} content items"
        )
    if direction.composition_id in {
        "metric-poster",
        "kpi-strip-evidence",
    } and not content_supports_composition(direction.composition_id, slide):
        raise CompositionCompileError(
            f"{direction.composition_id} requires grounded typed content"
        )
    if direction.variant not in spec.variants:
        raise CompositionCompileError(
            f"{direction.composition_id} does not support {direction.variant}"
        )
    style = _style(program, direction.background_mode)
    elements, focal_id = spec.factory(direction, slide, style)
    elements = _deduplicate_exact_visible_text(elements)
    if focal_id not in {str(element.get("elementId")) for element in elements}:
        raise CompositionCompileError("Composition focal element is missing")
    return CompiledComposition(
        elements=elements,
        primary_focal_element_id=focal_id,
        layout=_deck_layout(direction.composition_id, slide_type),
        background_color=style.background,
    )


def design_program_snapshot(program: DeckDesignProgram) -> dict[str, Any]:
    snapshot: dict[str, Any] = {
        "version": program.version,
        "visualConcept": program.visual_concept,
        "paletteRoles": program.palette_roles.model_dump(),
        "typography": program.typography.model_dump(by_alias=True),
        "backgroundSequence": program.background_sequence,
        "imageStyle": program.image_style,
        "surfaceStyle": program.surface_style,
        "compositionIds": [slide.composition_id for slide in program.slides],
    }
    optional_fields = {
        "designPackId": program.design_pack_id,
        "designPackVersion": program.design_pack_version,
        "selectionMode": program.selection_mode,
        "selectionReason": program.selection_reason,
        "selectionFallbackUsed": program.selection_fallback_used,
        "layoutIds": program.layout_ids,
        "layoutCatalogVersion": program.layout_catalog_version,
    }
    snapshot.update(
        {key: value for key, value in optional_fields.items() if value is not None}
    )
    return snapshot


def reconcile_design_program_palette(
    program: DeckDesignProgram,
    slides: list[dict[str, Any]],
) -> DeckDesignProgram:
    allowed_accents = [program.palette_roles.focal, program.palette_roles.secondary]
    base_roles = {
        program.palette_roles.dominant.casefold(),
        program.palette_roles.surface.casefold(),
        program.palette_roles.text.casefold(),
    }
    used_colors = visible_element_colors(slides)
    extra_accents = sorted(
        color
        for color in used_colors
        if is_high_saturation_color(color)
        and color.casefold() not in base_roles
        and color.casefold() not in {value.casefold() for value in allowed_accents}
    )
    if extra_accents:
        replacements = {
            color.casefold(): min(
                allowed_accents,
                key=lambda allowed: color_distance(color, allowed),
            )
            for color in extra_accents
        }
        replace_element_colors(slides, replacements)
        used_colors = visible_element_colors(slides)

    updated = program.model_copy(deep=True)
    used_lookup = {color.casefold() for color in used_colors}
    used_accents = [
        color for color in allowed_accents if color.casefold() in used_lookup
    ]
    fallback_role = used_accents[0] if used_accents else program.palette_roles.text
    if (
        is_high_saturation_color(updated.palette_roles.focal)
        and updated.palette_roles.focal.casefold() not in used_lookup
    ):
        updated.palette_roles.focal = fallback_role
    if (
        is_high_saturation_color(updated.palette_roles.secondary)
        and updated.palette_roles.secondary.casefold() not in used_lookup
    ):
        updated.palette_roles.secondary = fallback_role
    return updated


def visible_element_colors(slides: list[dict[str, Any]]) -> set[str]:
    colors: set[str] = set()
    for slide in slides:
        for element in slide.get("elements", []):
            if not element.get("visible", True) or float(element.get("opacity", 1)) <= 0:
                continue
            collect_hex_colors(element.get("props", {}), colors)
    return colors


def collect_hex_colors(value: Any, colors: set[str]) -> None:
    if isinstance(value, dict):
        for item in value.values():
            collect_hex_colors(item, colors)
    elif isinstance(value, list):
        for item in value:
            collect_hex_colors(item, colors)
    elif isinstance(value, str) and re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
        colors.add(value.upper())


def replace_element_colors(value: Any, replacements: dict[str, str]) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, str) and item.casefold() in replacements:
                value[key] = replacements[item.casefold()]
            else:
                replace_element_colors(item, replacements)
    elif isinstance(value, list):
        for item in value:
            replace_element_colors(item, replacements)


def is_high_saturation_color(color: str) -> bool:
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", color):
        return False
    red, green, blue = (int(color[index : index + 2], 16) / 255 for index in (1, 3, 5))
    _, saturation, value = colorsys.rgb_to_hsv(red, green, blue)
    return saturation >= 0.45 and value >= 0.35


def color_distance(left: str, right: str) -> int:
    left_rgb = [int(left[index : index + 2], 16) for index in (1, 3, 5)]
    right_rgb = [int(right[index : index + 2], 16) for index in (1, 3, 5)]
    return sum(abs(a - b) for a, b in zip(left_rgb, right_rgb, strict=True))


def _supports(composition_id: CompositionId, slide_type: str, item_count: int) -> bool:
    spec = COMPOSITION_SPECS[composition_id]
    return slide_type in spec.purposes and spec.min_items <= item_count <= spec.max_items


def _first_supported(
    candidates: tuple[CompositionId, ...],
    slide_type: str,
    item_count: int,
    *,
    usage: Counter[CompositionId] | None = None,
    forbidden_silhouette: str = "",
    allow_missing: bool = False,
) -> CompositionId | None:
    for candidate in candidates:
        spec = COMPOSITION_SPECS[candidate]
        if not _supports(candidate, slide_type, item_count):
            continue
        if usage is not None and usage[candidate] >= 2:
            continue
        if forbidden_silhouette and spec.silhouette == forbidden_silhouette:
            continue
        return candidate
    if allow_missing:
        return None
    raise CompositionCompileError(
        f"No composition supports {slide_type} with {item_count} content items"
    )


def _enforce_media_budget(
    program: DeckDesignProgram,
    slides: list[dict[str, Any]],
    media_policy: str,
    media_budget: int,
) -> None:
    if media_policy in {"minimal", "avoid"}:
        return
    if media_policy == "hybrid" and not any(
        direction.asset_role == "evidence" for direction in program.slides
    ):
        _promote_official_evidence(program, slides)
    selected = sorted(
        (slide for slide in program.slides if slide.asset_role != "none"),
        key=lambda direction: direction.asset_role != "evidence",
    )
    for direction in selected[media_budget:]:
        if COMPOSITION_SPECS[direction.composition_id].media_requirement == "required":
            slide = slides[direction.order - 1]
            slide_type = (
                "cover" if direction.order == 1 else _composition_slide_type(slide)
            )
            item_count = len(_items(slide))
            alternatives = tuple(
                candidate
                for candidate in FALLBACK_COMPOSITIONS.get(slide_type, ())
                if COMPOSITION_SPECS[candidate].media_requirement != "required"
            )
            replacement = _first_supported(alternatives, slide_type, item_count, allow_missing=True)
            if replacement is None:
                continue
            direction.composition_id = replacement
        direction.asset_role = "none"
        direction.required_asset = False

    minimum = min(3, media_budget)
    current = sum(slide.asset_role != "none" for slide in program.slides)
    if current >= minimum:
        return
    for direction in program.slides:
        if current >= minimum:
            break
        if direction.asset_role != "none":
            continue
        index = direction.order - 1
        candidate = _media_candidate(program, slides, index)
        if candidate is None:
            continue
        direction.composition_id = candidate
        slide = slides[index]
        direction.asset_role = (
            "evidence" if slide.get("officialSourceAvailable") is True else "atmosphere"
        )
        direction.required_asset = False
        current += 1


def _promote_official_evidence(
    program: DeckDesignProgram,
    slides: list[dict[str, Any]],
) -> None:
    usage = Counter(direction.composition_id for direction in program.slides)
    for index, (direction, slide) in enumerate(
        zip(program.slides, slides, strict=True)
    ):
        if slide.get("officialSourceAvailable") is not True:
            continue
        candidate = _media_candidate(
            program,
            slides,
            index,
            usage=usage,
            allow_required=True,
        )
        if candidate is None:
            continue
        usage[direction.composition_id] -= 1
        direction.composition_id = candidate
        direction.asset_role = "evidence"
        direction.required_asset = (
            COMPOSITION_SPECS[candidate].media_requirement == "required"
        )
        return


def _enforce_hybrid_media_mix(
    program: DeckDesignProgram,
    slides: list[dict[str, Any]],
    media_budget: int,
) -> None:
    evidence = [
        direction
        for direction in program.slides
        if direction.asset_role == "evidence"
    ]
    if evidence:
        keeper = max(
            evidence,
            key=lambda direction: (
                direction.required_asset,
                direction.order not in {1, len(program.slides)},
                -direction.order,
            ),
        )
        for direction in evidence:
            if direction is keeper:
                continue
            spec = COMPOSITION_SPECS[direction.composition_id]
            if direction.order in {1, len(program.slides)} and spec.media_requirement == "optional":
                direction.asset_role = "atmosphere"
                direction.required_asset = False
            elif spec.media_requirement == "optional":
                direction.asset_role = "none"
                direction.required_asset = False

    target_atmosphere = min(2, max(1, media_budget - 1))
    preferred_indices = list(
        dict.fromkeys(
            [
                0,
                len(program.slides) - 1,
                *[
                    index
                    for index, slide in enumerate(slides)
                    if slide.get("officialSourceAvailable") is not True
                ],
                *range(len(program.slides)),
            ]
        )
    )
    for index in preferred_indices:
        if (
            sum(
                direction.asset_role == "atmosphere"
                for direction in program.slides
            )
            >= target_atmosphere
        ):
            break
        direction = program.slides[index]
        if direction.asset_role != "none":
            continue
        candidate = _media_candidate(program, slides, index)
        if candidate is None:
            continue
        direction.composition_id = candidate
        direction.asset_role = "atmosphere"
        direction.required_asset = False


def _replace_body_hero_splits_without_media(
    program: DeckDesignProgram,
    slides: list[dict[str, Any]],
) -> None:
    usage = Counter(direction.composition_id for direction in program.slides)
    for index, (direction, slide) in enumerate(
        zip(program.slides, slides, strict=True)
    ):
        if (
            index == 0
            or direction.composition_id != "hero-split"
            or direction.asset_role != "none"
        ):
            continue
        slide_type = _composition_slide_type(slide)
        item_count = len(_items(slide))
        candidates = [
            candidate
            for candidate in FALLBACK_COMPOSITIONS.get(slide_type, ())
            if candidate != "hero-split"
            and COMPOSITION_SPECS[candidate].media_requirement != "required"
            and _supports(candidate, slide_type, item_count)
            and content_supports_composition(candidate, slide)
        ]
        neighboring_silhouettes = {
            COMPOSITION_SPECS[program.slides[neighbor].composition_id].silhouette
            for neighbor in (index - 1, index + 1)
            if 0 <= neighbor < len(program.slides)
        }
        replacement = min(
            candidates,
            key=lambda candidate: (
                COMPOSITION_SPECS[candidate].silhouette in neighboring_silhouettes,
                usage[candidate],
            ),
            default=None,
        )
        if replacement is None:
            continue
        usage[direction.composition_id] -= 1
        direction.composition_id = replacement
        usage[replacement] += 1


def _media_candidate(
    program: DeckDesignProgram,
    slides: list[dict[str, Any]],
    index: int,
    *,
    usage: Counter[CompositionId] | None = None,
    allow_required: bool = False,
) -> CompositionId | None:
    direction = program.slides[index]
    slide = slides[index]
    slide_type = "cover" if index == 0 else _composition_slide_type(slide)
    item_count = len(_items(slide))
    composition_usage = usage or Counter(
        item.composition_id for item in program.slides
    )
    neighboring_silhouettes = {
        COMPOSITION_SPECS[program.slides[neighbor].composition_id].silhouette
        for neighbor in (index - 1, index + 1)
        if 0 <= neighbor < len(program.slides)
    }
    candidates = (
        direction.composition_id,
        *FALLBACK_COMPOSITIONS.get(slide_type, ()),
    )
    return next(
        (
            candidate
            for candidate in dict.fromkeys(candidates)
            if COMPOSITION_SPECS[candidate].media_requirement
            in ({"optional", "required"} if allow_required else {"optional"})
            and _supports(candidate, slide_type, item_count)
            and content_supports_composition(candidate, slide)
            and composition_usage[candidate]
            - int(candidate == direction.composition_id)
            < 2
            and COMPOSITION_SPECS[candidate].silhouette
            not in neighboring_silhouettes
        ),
        None,
    )


def _enforce_background_rhythm(
    program: DeckDesignProgram,
    force_light: bool,
    force_dark: bool,
) -> None:
    if force_light:
        for slide in program.slides:
            slide.background_mode = "light"
            slide.variant = "light"
        program.background_sequence = ["light"] * len(program.slides)
        return
    if force_dark:
        for slide in program.slides:
            slide.background_mode = "dark"
            slide.variant = "dark"
        program.background_sequence = ["dark"] * len(program.slides)
        return
    if len(program.slides) >= 6 and len({slide.background_mode for slide in program.slides}) < 2:
        for index, slide in enumerate(program.slides):
            variants = COMPOSITION_SPECS[slide.composition_id].variants
            if variants == ("image",):
                slide.background_mode = "image"
                slide.variant = "image"
            elif index in {0, len(program.slides) - 1} and "dark" in variants:
                slide.background_mode = "dark"
                slide.variant = "dark"
            elif "light" in variants:
                slide.background_mode = "light"
                slide.variant = "light"
    for slide in program.slides:
        variants = COMPOSITION_SPECS[slide.composition_id].variants
        if variants == ("image",):
            slide.background_mode = "image"
            slide.variant = "image"
        elif slide.background_mode not in variants:
            replacement: BackgroundMode = (
                "dark" if "dark" in variants else variants[0]
            )
            slide.background_mode = replacement
            slide.variant = replacement
    _break_long_background_runs(program)
    program.background_sequence = [slide.background_mode for slide in program.slides]


def _composition_slide_type(slide: dict[str, Any]) -> str:
    slide_type = str(slide.get("slideType", "summary"))
    if slide_type == "process":
        item_count = len(_items(slide))
        if item_count < 2:
            return "solution"
        if _looks_like_release_fact_set(slide) and not _looks_like_ordered_process(
            slide
        ):
            return "data"
        if not _looks_like_ordered_process(slide):
            return "feature-grid"
    if slide_type != "chart":
        return slide_type
    content = " ".join(
        [str(slide.get("message", "")), *[value for _, value in _items(slide)]]
    )
    return "chart" if re.search(r"\d", content) else "feature-grid"


def _semantic_slide_text(slide: dict[str, Any]) -> str:
    return " ".join(
        [
            str(slide.get("title", "")),
            str(slide.get("message", "")),
            *[value for _, value in _items(slide)],
        ]
    ).casefold()


def _looks_like_ordered_process(slide: dict[str, Any]) -> bool:
    text = _semantic_slide_text(slide)
    markers = (
        "process", "workflow", "step", "phase", "prepare", "execute",
        "verify", "discover", "craft", "raid", "then", "finally",
        "\ub2e8\uacc4", "\uc808\ucc28", "\uc21c\uc11c", "\ud750\ub984", "\uacfc\uc815",
        "\uc900\ube44", "\uc2e4\ud589", "\uac80\uc99d", "\ud0d0\ud5d8", "\uc81c\uc791",
        "\ub808\uc774\ub4dc", "\uc131\uc7a5", "\ub2e4\uc74c", "\uc774\ud6c4", "\ub9c8\uc9c0\ub9c9",
    )
    return any(marker in text for marker in markers)


def _looks_like_release_fact_set(slide: dict[str, Any]) -> bool:
    text = _semantic_slide_text(slide)
    release_markers = (
        "release", "launch", "availability", "\ucd9c\uc2dc", "\ubc1c\ub9e4",
    )
    commerce_markers = (
        "purchase", "preorder", "order", "store", "price", "package",
        "\uad6c\ub9e4", "\uc608\uc57d", "\uc2a4\ud1a0\uc5b4", "\uac00\uaca9", "\ud328\ud0a4\uc9c0", "\ud310\ub9e4",
    )
    has_release = any(marker in text for marker in release_markers)
    has_commerce = any(marker in text for marker in commerce_markers)
    has_date = bool(
        re.search(r"\b(?:19|20)\d{2}\b", text)
        or re.search(r"\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b", text)
    )
    return has_release and (has_date or has_commerce)


def _break_long_background_runs(program: DeckDesignProgram) -> None:
    index = 0
    while index < len(program.slides):
        mode = program.slides[index].background_mode
        run_end = index + 1
        while (
            run_end < len(program.slides)
            and program.slides[run_end].background_mode == mode
        ):
            run_end += 1
        run_length = run_end - index
        if mode in {"light", "dark"} and run_length > 4:
            pivot = index + run_length // 2
            replacement: BackgroundMode = "dark" if mode == "light" else "light"
            if replacement in COMPOSITION_SPECS[program.slides[pivot].composition_id].variants:
                program.slides[pivot].background_mode = replacement
                program.slides[pivot].variant = replacement
                index = pivot + 1
                continue
        index = run_end


def _style(program: DeckDesignProgram, mode: BackgroundMode) -> Style:
    roles = program.palette_roles
    scale = program.typography.type_scale
    if mode in {"dark", "image"}:
        background = (
            roles.dominant
            if _is_dark(roles.dominant)
            else roles.text
            if _is_dark(roles.text)
            else "#101828"
        )
        text = roles.text if not _is_dark(roles.text) else "#FFFFFF"
        surface = roles.surface if _is_dark(roles.surface) else "#1F2937"
        muted_text = "#D1D5DB"
    else:
        background = roles.dominant if not _is_dark(roles.dominant) else "#FFFFFF"
        text = roles.text if _is_dark(roles.text) else "#111827"
        surface = roles.surface if not _is_dark(roles.surface) else "#F3F4F6"
        muted_text = "#475569"
    if surface.casefold() == background.casefold():
        surface = "#1F2937" if mode in {"dark", "image"} else "#F3F4F6"
    return Style(
        background=background,
        surface=surface,
        text=text,
        muted_text=muted_text,
        focal=roles.focal,
        secondary=roles.secondary,
        heading_font=program.typography.heading_font,
        body_font=program.typography.body_font,
        cover_size=max(72, int(scale.get("cover", 60))),
        title_size=max(56, int(scale.get("title", 40))),
        body_size=max(32, int(scale.get("body", 22))),
        caption_size=max(24, int(scale.get("caption", 14))),
    )


def _is_dark(color: str) -> bool:
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", color):
        return False
    red, green, blue = (int(color[index : index + 2], 16) for index in (1, 3, 5))
    return (red * 299 + green * 587 + blue * 114) / 1000 < 128


def _contrasting_text_color(background: str, preferred: str) -> str:
    if _is_dark(background):
        return "#FFFFFF"
    return preferred if _is_dark(preferred) else "#111827"


def _editorial_field_colors(style: Style) -> tuple[str, str, str, str]:
    if _is_dark(style.background):
        return (style.focal, style.secondary, style.surface, "#F8FAFC")
    return (style.focal, style.text, style.secondary, style.surface)


def _metric_value(slide: dict[str, Any], items: list[tuple[str, str]]) -> str:
    del items
    metrics = _typed_metrics(slide)
    if not metrics:
        raise CompositionCompileError("metric-poster requires a grounded typed metric")
    metric = metrics[0]
    return f"{metric['value']} {metric['unit']}".strip()


def _typed_metrics(slide: dict[str, Any]) -> list[dict[str, str]]:
    metrics = slide.get("typedMetrics", [])
    if not isinstance(metrics, list):
        return []
    required = ("value", "unit", "label", "sourceRef")
    return [
        metric
        for metric in metrics
        if isinstance(metric, dict)
        and all(
            isinstance(metric.get(key), str) and metric[key].strip()
            for key in required
        )
    ]


def _media_caption(slide: dict[str, Any]) -> str:
    intent = slide.get("mediaIntent", {})
    return str(intent.get("alt") or intent.get("caption") or slide.get("title", "Visual"))


def _deck_layout(composition_id: CompositionId, slide_type: str) -> str:
    if composition_id in {"hero-split", "hero-full-bleed", "minimal-cover"}:
        return "title"
    if composition_id == "cta-closing" or slide_type == "summary":
        return "closing"
    if composition_id in {"editorial-split", "image-evidence", "feature-comparison"}:
        return "two-column"
    return "title-content"
