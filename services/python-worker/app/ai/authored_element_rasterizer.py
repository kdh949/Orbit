from __future__ import annotations

import base64
import html
import importlib
import math
import re
from dataclasses import dataclass
from typing import Any, cast
from urllib.parse import unquote_to_bytes
from xml.etree import ElementTree


AUTHORED_RASTER_ELEMENT_TYPES = frozenset(
    {
        "ellipse",
        "line",
        "arrow",
        "polygon",
        "star",
        "ring",
        "svg",
        "customShape",
        "chart",
    }
)
MAX_RASTER_DIMENSION = 4096
MAX_RASTER_PIXELS = 16_000_000
DEFAULT_RASTER_SCALE = 2.0
DEFAULT_CHART_COLORS = (
    "#2563EB",
    "#7C3AED",
    "#06B6D4",
    "#F59E0B",
    "#10B981",
    "#EF4444",
)


class AuthoredElementRasterizationError(ValueError):
    pass


@dataclass(frozen=True)
class RasterizedAuthoredElement:
    png_bytes: bytes
    x: float
    y: float
    width: float
    height: float
    rotation: float
    pixel_width: int
    pixel_height: int


def rasterize_authored_element(
    element: dict[str, Any],
    theme: dict[str, Any],
) -> RasterizedAuthoredElement:
    element_type = _required_string(element, "type")
    if element_type not in AUTHORED_RASTER_ELEMENT_TYPES:
        raise AuthoredElementRasterizationError(
            f"ELEMENT_TYPE_NOT_RASTERIZABLE:{element_type}"
        )
    x = _finite_number(element, "x")
    y = _finite_number(element, "y")
    width = _positive_number(element, "width")
    height = _positive_number(element, "height")
    rotation = _optional_number(element, "rotation", 0.0)
    opacity = min(1.0, max(0.0, _optional_number(element, "opacity", 1.0)))
    if element.get("visible", True) is False:
        opacity = 0.0
    props = _required_mapping(element, "props")
    padding = _raster_padding(element_type, props)
    raster_width = width + padding * 2
    raster_height = height + padding * 2
    svg = _element_svg(
        element_type=element_type,
        props=props,
        theme=theme,
        width=width,
        height=height,
        padding=padding,
        opacity=opacity,
    )
    target_width, target_height = _bounded_pixel_size(
        raster_width,
        raster_height,
    )
    png_bytes, pixel_width, pixel_height = _render_svg(
        svg,
        target_width,
        target_height,
    )
    return RasterizedAuthoredElement(
        png_bytes=png_bytes,
        x=x - padding,
        y=y - padding,
        width=raster_width,
        height=raster_height,
        rotation=rotation,
        pixel_width=pixel_width,
        pixel_height=pixel_height,
    )


def _element_svg(
    *,
    element_type: str,
    props: dict[str, Any],
    theme: dict[str, Any],
    width: float,
    height: float,
    padding: float,
    opacity: float,
) -> str:
    defs: list[str] = []
    content = _element_markup(element_type, props, theme, width, height, defs)
    total_width = width + padding * 2
    total_height = height + padding * 2
    defs_markup = f"<defs>{''.join(defs)}</defs>" if defs else ""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        'xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'width="{_number(total_width)}" height="{_number(total_height)}" '
        f'viewBox="0 0 {_number(total_width)} {_number(total_height)}">'
        f"{defs_markup}"
        f'<g transform="translate({_number(padding)} {_number(padding)})" '
        f'opacity="{_number(opacity)}">{content}</g></svg>'
    )


def _element_markup(
    element_type: str,
    props: dict[str, Any],
    theme: dict[str, Any],
    width: float,
    height: float,
    defs: list[str],
) -> str:
    if element_type == "chart":
        return _chart_markup(props, theme, width, height)
    if element_type == "svg":
        return _embedded_svg_markup(props, width, height)

    fill = _paint(props.get("fill", "transparent"), "fill", defs)
    stroke = _paint(props.get("stroke", "transparent"), "stroke", defs)
    stroke_width = _nonnegative_number(props.get("strokeWidth", 0), "strokeWidth")
    style = _shape_style(props, fill, stroke, stroke_width, defs)
    if element_type == "ellipse":
        return (
            f'<ellipse cx="{_number(width / 2)}" cy="{_number(height / 2)}" '
            f'rx="{_number(width / 2)}" ry="{_number(height / 2)}" {style}/>'
        )
    if element_type in {"line", "arrow"}:
        marker = ""
        marker_attr = ""
        if element_type == "arrow":
            marker = (
                '<marker id="arrow-head" markerWidth="10" markerHeight="8" '
                'refX="9" refY="4" orient="auto" markerUnits="strokeWidth">'
                f'<path d="M 0 0 L 10 4 L 0 8 Z" fill="{html.escape(stroke)}"/>'
                "</marker>"
            )
            defs.append(marker)
            marker_attr = ' marker-end="url(#arrow-head)"'
        return (
            f'<line x1="0" y1="0" x2="{_number(width)}" '
            f'y2="{_number(height)}" {style}{marker_attr}/>'
        )
    if element_type == "polygon":
        sides = int(_bounded_number(props.get("sides", 6), "sides", 3, 12))
        return f'<polygon points="{_regular_polygon(width, height, sides)}" {style}/>'
    if element_type == "star":
        return f'<polygon points="{_star_points(width, height)}" {style}/>'
    if element_type == "ring":
        ring_width = max(1.0, min(width, height) * 0.22)
        ring_style = _shape_style(props, "none", fill, ring_width, defs)
        return (
            f'<ellipse cx="{_number(width / 2)}" cy="{_number(height / 2)}" '
            f'rx="{_number(max(0.5, width / 2 - ring_width / 2))}" '
            f'ry="{_number(max(0.5, height / 2 - ring_width / 2))}" '
            f"{ring_style}/>"
        )
    if element_type == "customShape":
        path_data = _required_string(props, "pathData")
        view_width = _positive_value(props.get("viewBoxWidth"), "viewBoxWidth")
        view_height = _positive_value(props.get("viewBoxHeight"), "viewBoxHeight")
        return (
            f'<g transform="scale({_number(width / view_width)} '
            f'{_number(height / view_height)})">'
            f'<path d="{html.escape(path_data, quote=True)}" {style}/></g>'
        )
    raise AuthoredElementRasterizationError(
        f"ELEMENT_TYPE_NOT_RASTERIZABLE:{element_type}"
    )


def _shape_style(
    props: dict[str, Any],
    fill: str,
    stroke: str,
    stroke_width: float,
    defs: list[str],
) -> str:
    attributes = [
        f'fill="{html.escape(fill)}"',
        f'stroke="{html.escape(stroke)}"',
        f'stroke-width="{_number(stroke_width)}"',
        f'stroke-linecap="{_enum(props.get("lineCap"), {"butt", "round", "square"}, "butt")}"',
        f'stroke-linejoin="{_enum(props.get("lineJoin"), {"miter", "round", "bevel"}, "miter")}"',
    ]
    dash = props.get("dash")
    if isinstance(dash, list) and dash:
        values = [_positive_value(value, "dash") for value in dash]
        attributes.append(f'stroke-dasharray="{" ".join(_number(v) for v in values)}"')
    shadow = props.get("shadow")
    if isinstance(shadow, dict):
        color = _safe_color(shadow.get("color"), "#000000")
        blur = _nonnegative_number(shadow.get("blur", 0), "shadow.blur")
        dx = _finite_value(shadow.get("offsetX", 0), "shadow.offsetX")
        dy = _finite_value(shadow.get("offsetY", 0), "shadow.offsetY")
        opacity = _bounded_number(shadow.get("opacity", 0.25), "shadow.opacity", 0, 1)
        defs.append(
            '<filter id="element-shadow" x="-100%" y="-100%" '
            'width="300%" height="300%">'
            f'<feDropShadow dx="{_number(dx)}" dy="{_number(dy)}" '
            f'stdDeviation="{_number(blur / 2)}" flood-color="{color}" '
            f'flood-opacity="{_number(opacity)}"/></filter>'
        )
        attributes.append('filter="url(#element-shadow)"')
    return " ".join(attributes)


def _paint(value: Any, identifier: str, defs: list[str]) -> str:
    if isinstance(value, str):
        return "none" if value == "transparent" else _safe_color(value, "none")
    if not isinstance(value, dict):
        return "none"
    paint_type = value.get("type")
    if paint_type == "linear-gradient":
        angle = math.radians(_finite_value(value.get("angle", 0), "paint.angle"))
        x = math.cos(angle) * 50
        y = math.sin(angle) * 50
        stops = value.get("stops")
        if not isinstance(stops, list) or len(stops) < 2:
            raise AuthoredElementRasterizationError("PAINT_GRADIENT_STOPS_INVALID")
        stop_markup: list[str] = []
        for stop in stops:
            if not isinstance(stop, dict):
                raise AuthoredElementRasterizationError("PAINT_GRADIENT_STOP_INVALID")
            offset = _bounded_number(stop.get("offset"), "paint.offset", 0, 1)
            color = _safe_color(stop.get("color"), "#000000")
            opacity = _bounded_number(stop.get("opacity", 1), "paint.opacity", 0, 1)
            stop_markup.append(
                f'<stop offset="{_number(offset * 100)}%" stop-color="{color}" '
                f'stop-opacity="{_number(opacity)}"/>'
            )
        defs.append(
            f'<linearGradient id="{identifier}-gradient" x1="{_number(50 - x)}%" '
            f'y1="{_number(50 - y)}%" x2="{_number(50 + x)}%" '
            f'y2="{_number(50 + y)}%">{"".join(stop_markup)}</linearGradient>'
        )
        return f"url(#{identifier}-gradient)"
    if paint_type == "pattern":
        foreground = _safe_color(value.get("foreground"), "#000000")
        background = _safe_color(value.get("background"), "#FFFFFF")
        defs.append(
            f'<pattern id="{identifier}-pattern" width="8" height="8" '
            'patternUnits="userSpaceOnUse">'
            f'<rect width="8" height="8" fill="{background}"/>'
            f'<circle cx="2" cy="2" r="1.4" fill="{foreground}"/></pattern>'
        )
        return f"url(#{identifier}-pattern)"
    raise AuthoredElementRasterizationError("PAINT_TYPE_UNSUPPORTED")


def _embedded_svg_markup(props: dict[str, Any], width: float, height: float) -> str:
    source = _required_string(props, "src")
    sanitized = _sanitize_svg_data_url(source)
    encoded = base64.b64encode(sanitized).decode("ascii")
    fit = _enum(props.get("fit"), {"contain", "cover", "stretch"}, "contain")
    preserve = {
        "contain": "xMidYMid meet",
        "cover": "xMidYMid slice",
        "stretch": "none",
    }[fit]
    return (
        f'<image x="0" y="0" width="{_number(width)}" height="{_number(height)}" '
        f'preserveAspectRatio="{preserve}" '
        f'href="data:image/svg+xml;base64,{encoded}"/>'
    )


def _sanitize_svg_data_url(source: str) -> bytes:
    prefix, separator, payload = source.partition(",")
    if not separator or not prefix.lower().startswith("data:image/svg+xml"):
        raise AuthoredElementRasterizationError("SVG_SOURCE_INVALID")
    try:
        if ";base64" in prefix.lower():
            raw = base64.b64decode(payload, validate=True)
        else:
            raw = unquote_to_bytes(payload)
        root = ElementTree.fromstring(raw)
    except (ValueError, ElementTree.ParseError) as error:
        raise AuthoredElementRasterizationError("SVG_SOURCE_INVALID") from error
    for node in root.iter():
        tag = _local_name(node.tag).lower()
        if tag in {"script", "foreignobject", "iframe", "audio", "video"}:
            raise AuthoredElementRasterizationError("SVG_ACTIVE_CONTENT_UNSAFE")
        for raw_name, raw_value in node.attrib.items():
            name = _local_name(raw_name).lower()
            value = raw_value.strip().lower()
            if name.startswith("on"):
                raise AuthoredElementRasterizationError("SVG_ACTIVE_CONTENT_UNSAFE")
            if name in {"href", "src"} and not (
                value.startswith("#") or value.startswith("data:")
            ):
                raise AuthoredElementRasterizationError(
                    "SVG_EXTERNAL_REFERENCE_UNSAFE"
                )
            if re.search(r"(?:https?:|file:|//)", value) or (
                "url(" in value and "url(#" not in value
            ):
                raise AuthoredElementRasterizationError(
                    "SVG_EXTERNAL_REFERENCE_UNSAFE"
                )
    return cast(bytes, ElementTree.tostring(root, encoding="utf-8"))


def _chart_markup(
    props: dict[str, Any],
    theme: dict[str, Any],
    width: float,
    height: float,
) -> str:
    chart_type = _required_string(props, "type")
    if chart_type not in {"bar", "line", "pie", "doughnut", "scatter"}:
        raise AuthoredElementRasterizationError(f"CHART_TYPE_UNSUPPORTED:{chart_type}")
    raw_style = props.get("style")
    style = cast(dict[str, Any], raw_style) if isinstance(raw_style, dict) else {}
    raw_data = props.get("data")
    data: list[Any] = raw_data if isinstance(raw_data, list) else []
    colors = _chart_colors(style, theme)
    text_color = _safe_color(
        style.get("textColor"),
        _safe_color(theme.get("textColor"), "#111827"),
    )
    background = style.get("backgroundColor")
    font_family = html.escape(
        str(style.get("fontFamily") or theme.get("fontFamily") or "Inter"),
        quote=True,
    )
    title = html.escape(str(props.get("title") or ""))
    title_size = _positive_or_default(style.get("titleFontSize"), 18)
    label_size = _positive_or_default(style.get("axisLabelFontSize"), 11)
    top = 34.0 if title else 12.0
    markup: list[str] = []
    if background is not None:
        markup.append(
            f'<rect width="{_number(width)}" height="{_number(height)}" '
            f'fill="{_safe_color(background, "#FFFFFF")}"/>'
        )
    if title:
        markup.append(
            f'<text x="{_number(width / 2)}" y="{_number(title_size + 5)}" '
            f'text-anchor="middle" fill="{text_color}" '
            f'font-family="{font_family}" font-size="{_number(title_size)}" '
            f'font-weight="600">{title}</text>'
        )
    if chart_type in {"pie", "doughnut"}:
        markup.append(
            _radial_chart_markup(
                chart_type,
                data,
                style,
                colors,
                text_color,
                font_family,
                width,
                height,
                top,
                label_size,
            )
        )
    else:
        markup.append(
            _cartesian_chart_markup(
                chart_type,
                data,
                style,
                colors,
                text_color,
                font_family,
                width,
                height,
                top,
                label_size,
            )
        )
    return "".join(markup)


def _cartesian_chart_markup(
    chart_type: str,
    data: list[Any],
    style: dict[str, Any],
    colors: list[str],
    text_color: str,
    font_family: str,
    width: float,
    height: float,
    top: float,
    label_size: float,
) -> str:
    left, right, bottom = 44.0, 14.0, 32.0
    plot_width = max(1.0, width - left - right)
    plot_height = max(1.0, height - top - bottom)
    numeric: list[tuple[dict[str, Any], float, float]] = []
    for index, raw in enumerate(data):
        if not isinstance(raw, dict):
            continue
        if chart_type == "scatter":
            x_value = _finite_value(raw.get("x"), f"chart.data[{index}].x")
            y_value = _finite_value(raw.get("y"), f"chart.data[{index}].y")
        else:
            x_value = float(index)
            y_value = _finite_value(raw.get("value"), f"chart.data[{index}].value")
        numeric.append((raw, x_value, y_value))
    if not numeric:
        return _chart_axes(left, top, plot_width, plot_height, text_color, False)
    y_values = [item[2] for item in numeric]
    y_min = min(0.0, min(y_values))
    y_max = max(0.0, max(y_values))
    if math.isclose(y_min, y_max):
        y_max = y_min + 1
    if chart_type == "scatter":
        x_values = [item[1] for item in numeric]
        x_min, x_max = min(x_values), max(x_values)
        if math.isclose(x_min, x_max):
            x_max = x_min + 1
    else:
        x_min, x_max = 0.0, max(1.0, float(len(numeric) - 1))
    markup = [
        _chart_axes(
            left,
            top,
            plot_width,
            plot_height,
            text_color,
            bool(style.get("showGrid", True)),
        )
    ]

    def point(x_value: float, y_value: float) -> tuple[float, float]:
        px = left + (x_value - x_min) / (x_max - x_min) * plot_width
        py = top + (y_max - y_value) / (y_max - y_min) * plot_height
        return px, py

    if chart_type == "bar":
        band = plot_width / max(1, len(numeric))
        zero_y = point(0, 0)[1]
        for index, (raw, _, value) in enumerate(numeric):
            px = left + index * band + band * 0.15
            value_y = point(index, value)[1]
            bar_y = min(zero_y, value_y)
            bar_height = max(1.0, abs(zero_y - value_y))
            color = colors[index % len(colors)]
            markup.append(
                f'<rect x="{_number(px)}" y="{_number(bar_y)}" '
                f'width="{_number(band * 0.7)}" height="{_number(bar_height)}" '
                f'rx="2" fill="{color}"/>'
            )
            markup.append(
                _chart_label(
                    str(raw.get("label") or ""),
                    px + band * 0.35,
                    top + plot_height + label_size + 5,
                    text_color,
                    font_family,
                    label_size,
                )
            )
            if bool(style.get("showDataLabels", False)):
                markup.append(
                    _chart_label(
                        _number(value),
                        px + band * 0.35,
                        max(top + label_size, bar_y - 4),
                        text_color,
                        font_family,
                        label_size,
                    )
                )
    else:
        series: dict[str, list[tuple[dict[str, Any], float, float]]] = {}
        for raw, x_value, y_value in numeric:
            key = str(raw.get("series") or "series")
            series.setdefault(key, []).append((raw, x_value, y_value))
        for series_index, items in enumerate(series.values()):
            color = colors[series_index % len(colors)]
            points = [point(x_value, y_value) for _, x_value, y_value in items]
            if chart_type == "line":
                markup.append(
                    f'<polyline fill="none" stroke="{color}" stroke-width="3" '
                    f'points="{" ".join(f"{_number(x)},{_number(y)}" for x, y in points)}"/>'
                )
            for item_index, ((raw, _, value), (px, py)) in enumerate(
                zip(items, points, strict=True)
            ):
                markup.append(
                    f'<circle cx="{_number(px)}" cy="{_number(py)}" r="4" '
                    f'fill="{color}" stroke="#FFFFFF" stroke-width="1.5"/>'
                )
                if bool(style.get("showDataLabels", False)):
                    markup.append(
                        _chart_label(
                            str(raw.get("label") or _number(value)),
                            px,
                            py - 7 - item_index % 2,
                            text_color,
                            font_family,
                            label_size,
                        )
                    )
    return "".join(markup)


def _radial_chart_markup(
    chart_type: str,
    data: list[Any],
    style: dict[str, Any],
    colors: list[str],
    text_color: str,
    font_family: str,
    width: float,
    height: float,
    top: float,
    label_size: float,
) -> str:
    values: list[tuple[str, float]] = []
    for index, raw in enumerate(data):
        if not isinstance(raw, dict):
            continue
        value = _nonnegative_number(raw.get("value"), f"chart.data[{index}].value")
        values.append((str(raw.get("label") or ""), value))
    total = sum(value for _, value in values)
    if total <= 0:
        return ""
    show_legend = bool(style.get("showLegend", True))
    legend_width = min(140.0, width * 0.32) if show_legend else 0.0
    available_width = width - legend_width
    radius = max(1.0, min(available_width, height - top) * 0.42)
    center_x = available_width / 2
    center_y = top + (height - top) / 2
    angle = -math.pi / 2
    markup: list[str] = []
    for index, (label, value) in enumerate(values):
        sweep = value / total * math.tau
        next_angle = angle + sweep
        color = colors[index % len(colors)]
        markup.append(
            f'<path d="{_arc_path(center_x, center_y, radius, angle, next_angle)}" '
            f'fill="{color}" stroke="#FFFFFF" stroke-width="1"/>'
        )
        if bool(style.get("showDataLabels", False)):
            middle = angle + sweep / 2
            label_radius = radius * 0.65
            markup.append(
                _chart_label(
                    _number(value),
                    center_x + math.cos(middle) * label_radius,
                    center_y + math.sin(middle) * label_radius + label_size / 3,
                    "#FFFFFF",
                    font_family,
                    label_size,
                )
            )
        if show_legend:
            legend_x = available_width + 8
            legend_y = top + 12 + index * (label_size + 9)
            markup.append(
                f'<rect x="{_number(legend_x)}" y="{_number(legend_y - 9)}" '
                f'width="10" height="10" fill="{color}"/>'
                f'<text x="{_number(legend_x + 15)}" y="{_number(legend_y)}" '
                f'fill="{text_color}" font-family="{font_family}" '
                f'font-size="{_number(label_size)}">{html.escape(label)}</text>'
            )
        angle = next_angle
    if chart_type == "doughnut":
        markup.append(
            f'<circle cx="{_number(center_x)}" cy="{_number(center_y)}" '
            f'r="{_number(radius * 0.52)}" fill="#FFFFFF" fill-opacity="0.96"/>'
        )
    return "".join(markup)


def _chart_axes(
    left: float,
    top: float,
    width: float,
    height: float,
    color: str,
    show_grid: bool,
) -> str:
    markup: list[str] = []
    if show_grid:
        for index in range(5):
            y = top + height * index / 4
            markup.append(
                f'<line x1="{_number(left)}" y1="{_number(y)}" '
                f'x2="{_number(left + width)}" y2="{_number(y)}" '
                'stroke="#CBD5E1" stroke-width="1" opacity="0.7"/>'
            )
    markup.append(
        f'<path d="M {_number(left)} {_number(top)} V {_number(top + height)} '
        f'H {_number(left + width)}" fill="none" stroke="{color}" '
        'stroke-width="1.2" opacity="0.75"/>'
    )
    return "".join(markup)


def _chart_label(
    value: str,
    x: float,
    y: float,
    color: str,
    font_family: str,
    font_size: float,
) -> str:
    return (
        f'<text x="{_number(x)}" y="{_number(y)}" text-anchor="middle" '
        f'fill="{color}" font-family="{font_family}" '
        f'font-size="{_number(font_size)}">{html.escape(value)}</text>'
    )


def _chart_colors(style: dict[str, Any], theme: dict[str, Any]) -> list[str]:
    raw = style.get("colors")
    if isinstance(raw, list) and raw:
        return [_safe_color(value, DEFAULT_CHART_COLORS[0]) for value in raw]
    palette = theme.get("palette")
    if isinstance(palette, dict):
        candidates = [
            palette.get("primary"),
            palette.get("secondary"),
            theme.get("accentColor"),
        ]
        colors = [_safe_color(value, "") for value in candidates]
        colors = [color for color in colors if color]
        if colors:
            return colors
    return list(DEFAULT_CHART_COLORS)


def _arc_path(
    center_x: float,
    center_y: float,
    radius: float,
    start: float,
    end: float,
) -> str:
    start_x = center_x + math.cos(start) * radius
    start_y = center_y + math.sin(start) * radius
    end_x = center_x + math.cos(end) * radius
    end_y = center_y + math.sin(end) * radius
    large_arc = 1 if end - start > math.pi else 0
    return (
        f"M {_number(center_x)} {_number(center_y)} "
        f"L {_number(start_x)} {_number(start_y)} "
        f"A {_number(radius)} {_number(radius)} 0 {large_arc} 1 "
        f"{_number(end_x)} {_number(end_y)} Z"
    )


def _regular_polygon(width: float, height: float, sides: int) -> str:
    radius_x = width / 2
    radius_y = height / 2
    return " ".join(
        f"{_number(width / 2 + math.cos(-math.pi / 2 + index * math.tau / sides) * radius_x)},"
        f"{_number(height / 2 + math.sin(-math.pi / 2 + index * math.tau / sides) * radius_y)}"
        for index in range(sides)
    )


def _star_points(width: float, height: float) -> str:
    points: list[str] = []
    for index in range(10):
        radius = 0.5 if index % 2 == 0 else 0.22
        angle = -math.pi / 2 + index * math.pi / 5
        points.append(
            f"{_number(width / 2 + math.cos(angle) * width * radius)},"
            f"{_number(height / 2 + math.sin(angle) * height * radius)}"
        )
    return " ".join(points)


def _raster_padding(element_type: str, props: dict[str, Any]) -> float:
    stroke_width = _nonnegative_number(props.get("strokeWidth", 0), "strokeWidth")
    padding = max(2.0, stroke_width / 2 + 2)
    if element_type == "arrow":
        padding = max(padding, stroke_width * 5 + 2)
    shadow = props.get("shadow")
    if isinstance(shadow, dict):
        blur = _nonnegative_number(shadow.get("blur", 0), "shadow.blur")
        offset_x = abs(_finite_value(shadow.get("offsetX", 0), "shadow.offsetX"))
        offset_y = abs(_finite_value(shadow.get("offsetY", 0), "shadow.offsetY"))
        padding = max(padding, blur * 2 + offset_x, blur * 2 + offset_y)
    return math.ceil(padding)


def _bounded_pixel_size(width: float, height: float) -> tuple[int, int]:
    scale = min(
        DEFAULT_RASTER_SCALE,
        MAX_RASTER_DIMENSION / width,
        MAX_RASTER_DIMENSION / height,
        math.sqrt(MAX_RASTER_PIXELS / (width * height)),
    )
    return max(1, round(width * scale)), max(1, round(height * scale))


def _render_svg(svg: str, target_width: int, target_height: int) -> tuple[bytes, int, int]:
    try:
        fitz: Any = importlib.import_module("fitz")
        document = fitz.open(stream=svg.encode("utf-8"), filetype="svg")
        try:
            page = document[0]
            matrix = fitz.Matrix(
                target_width / page.rect.width,
                target_height / page.rect.height,
            )
            pixmap = page.get_pixmap(matrix=matrix, alpha=True)
            return pixmap.tobytes("png"), int(pixmap.width), int(pixmap.height)
        finally:
            document.close()
    except AuthoredElementRasterizationError:
        raise
    except Exception as error:
        raise AuthoredElementRasterizationError("SVG_RASTERIZATION_FAILED") from error


def _safe_color(value: Any, default: str) -> str:
    if isinstance(value, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        return value.upper()
    return default


def _enum(value: Any, allowed: set[str], default: str) -> str:
    return value if isinstance(value, str) and value in allowed else default


def _required_string(mapping: dict[str, Any], key: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str) or not value:
        raise AuthoredElementRasterizationError(f"FIELD_INVALID:{key}")
    return value


def _required_mapping(mapping: dict[str, Any], key: str) -> dict[str, Any]:
    value = mapping.get(key)
    if not isinstance(value, dict):
        raise AuthoredElementRasterizationError(f"FIELD_INVALID:{key}")
    return value


def _finite_number(mapping: dict[str, Any], key: str) -> float:
    return _finite_value(mapping.get(key), key)


def _positive_number(mapping: dict[str, Any], key: str) -> float:
    return _positive_value(mapping.get(key), key)


def _optional_number(mapping: dict[str, Any], key: str, default: float) -> float:
    value = mapping.get(key, default)
    return _finite_value(value, key)


def _finite_value(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AuthoredElementRasterizationError(f"FIELD_INVALID:{field}")
    result = float(value)
    if not math.isfinite(result):
        raise AuthoredElementRasterizationError(f"FIELD_INVALID:{field}")
    return result


def _positive_value(value: Any, field: str) -> float:
    result = _finite_value(value, field)
    if result <= 0:
        raise AuthoredElementRasterizationError(f"FIELD_INVALID:{field}")
    return result


def _nonnegative_number(value: Any, field: str) -> float:
    result = _finite_value(value, field)
    if result < 0:
        raise AuthoredElementRasterizationError(f"FIELD_INVALID:{field}")
    return result


def _bounded_number(
    value: Any,
    field: str,
    minimum: float,
    maximum: float,
) -> float:
    result = _finite_value(value, field)
    if result < minimum or result > maximum:
        raise AuthoredElementRasterizationError(f"FIELD_INVALID:{field}")
    return result


def _positive_or_default(value: Any, default: float) -> float:
    if value is None:
        return default
    return _positive_value(value, "chart.fontSize")


def _number(value: float) -> str:
    if math.isclose(value, round(value), abs_tol=1e-9):
        return str(round(value))
    return f"{value:.4f}".rstrip("0").rstrip(".")


def _local_name(value: str) -> str:
    return value.rsplit("}", 1)[-1]
