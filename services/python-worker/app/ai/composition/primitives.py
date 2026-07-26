from __future__ import annotations

import textwrap

from app.ai.composition.models import (
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    GRID_COLUMN_WIDTH,
    GRID_GUTTER,
    GRID_STEP,
    SAFE_WIDTH,
    SAFE_X,
    SAFE_Y,
    Element,
    Style,
)

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
