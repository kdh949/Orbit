from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image

from app.ai.authored_element_rasterizer import (
    AuthoredElementRasterizationError,
    rasterize_authored_element,
)


THEME = {
    "name": "Orbit",
    "fontFamily": "Inter",
    "backgroundColor": "#FFFFFF",
    "textColor": "#111827",
    "accentColor": "#2563EB",
    "palette": {
        "primary": "#2563EB",
        "secondary": "#7C3AED",
        "surface": "#FFFFFF",
        "muted": "#F3F4F6",
        "border": "#E5E7EB",
    },
}


def element(element_type: str, props: dict[str, object]) -> dict[str, object]:
    return {
        "elementId": f"el_{element_type}_1",
        "type": element_type,
        "x": 120,
        "y": 80,
        "width": 320,
        "height": 180,
        "rotation": 12,
        "opacity": 0.8,
        "visible": True,
        "props": props,
    }


def test_rasterizes_line_with_transparent_padding_and_stable_placement() -> None:
    rendered = rasterize_authored_element(
        element(
            "line",
            {
                "stroke": "#2563EB",
                "strokeWidth": 8,
                "lineCap": "round",
                "shadow": {
                    "color": "#000000",
                    "blur": 8,
                    "offsetX": 4,
                    "offsetY": 6,
                    "opacity": 0.25,
                },
            },
        ),
        THEME,
    )

    image = Image.open(BytesIO(rendered.png_bytes)).convert("RGBA")
    assert image.width == rendered.pixel_width
    assert image.height == rendered.pixel_height
    assert image.getpixel((0, 0))[3] == 0
    assert image.getbbox() is not None
    assert rendered.x < 120
    assert rendered.y < 80
    assert rendered.width > 320
    assert rendered.height > 180
    assert rendered.rotation == 12


@pytest.mark.parametrize(
    ("element_type", "props"),
    [
        ("ellipse", {"fill": "#2563EB", "stroke": "#111827"}),
        ("arrow", {"stroke": "#2563EB", "strokeWidth": 5}),
        ("polygon", {"fill": "#7C3AED", "sides": 6}),
        ("star", {"fill": "#F59E0B"}),
        ("ring", {"fill": "#06B6D4"}),
        (
            "customShape",
            {
                "pathData": "M 0 0 C 80 20 240 160 320 180 L 0 180 Z",
                "viewBoxWidth": 320,
                "viewBoxHeight": 180,
                "fill": "#10B981",
                "stroke": "#064E3B",
                "strokeWidth": 3,
            },
        ),
    ],
)
def test_rasterizes_authored_shape_types(
    element_type: str,
    props: dict[str, object],
) -> None:
    rendered = rasterize_authored_element(element(element_type, props), THEME)
    image = Image.open(BytesIO(rendered.png_bytes)).convert("RGBA")
    assert image.getbbox() is not None
    assert image.getextrema()[3][1] > 0


@pytest.mark.parametrize("chart_type", ["bar", "line", "pie", "doughnut", "scatter"])
def test_rasterizes_all_chart_types(chart_type: str) -> None:
    if chart_type in {"pie", "doughnut"}:
        data: list[dict[str, object]] = [
            {"label": "A", "value": 30},
            {"label": "B", "value": 70},
        ]
    elif chart_type == "scatter":
        data = [
            {"label": "A", "x": 1, "y": 3},
            {"label": "B", "x": 4, "y": 7},
        ]
    else:
        data = [
            {"label": "Q1", "series": "2025", "value": 20},
            {"label": "Q2", "series": "2025", "value": 45},
            {"label": "Q1", "series": "2026", "value": 35},
            {"label": "Q2", "series": "2026", "value": 60},
        ]
    rendered = rasterize_authored_element(
        element(
            "chart",
            {
                "type": chart_type,
                "title": f"{chart_type} chart",
                "data": data,
                "style": {
                    "colors": ["#2563EB", "#7C3AED"],
                    "showLegend": True,
                    "showDataLabels": True,
                    "showGrid": True,
                },
            },
        ),
        THEME,
    )
    assert Image.open(BytesIO(rendered.png_bytes)).getbbox() is not None


def test_raster_size_is_bounded_for_oversized_elements() -> None:
    oversized = element("ellipse", {"fill": "#2563EB"})
    oversized["width"] = 10_000
    oversized["height"] = 8_000
    rendered = rasterize_authored_element(oversized, THEME)
    assert rendered.pixel_width <= 4096
    assert rendered.pixel_height <= 4096
    assert rendered.pixel_width * rendered.pixel_height <= 16_000_000


def test_rejects_svg_with_external_references() -> None:
    unsafe_svg = (
        "data:image/svg+xml," +
        "%3Csvg xmlns='http://www.w3.org/2000/svg'%3E"
        "%3Cimage href='https://example.com/tracker.png'/%3E%3C/svg%3E"
    )
    with pytest.raises(
        AuthoredElementRasterizationError,
        match="SVG_EXTERNAL_REFERENCE_UNSAFE",
    ):
        rasterize_authored_element(
            element("svg", {"src": unsafe_svg, "alt": "unsafe", "fit": "contain"}),
            THEME,
        )
