from __future__ import annotations

import zipfile
from typing import Any
from xml.etree import ElementTree as ET

from app.ai.pptx_vector_import.constants import (
    FALLBACK_SCHEME_COLORS,
    REL_NS,
    SCHEME_COLOR_ALIASES,
    SLIDE_REL_TYPE,
    THEME_REL_TYPE,
)
from app.ai.pptx_vector_import.models import OoxmlScale, OoxmlThemeFonts, OoxmlThemeStyles

def presentation_slide_parts(package: zipfile.ZipFile) -> list[str]:
    presentation = read_xml(package, "ppt/presentation.xml")
    if presentation is None:
        raise ValueError("PPTX presentation.xml is missing.")
    rels = relationships_for_part(package, "ppt/presentation.xml")
    slide_parts: list[str] = []
    for slide_id in presentation.iter():
        if local_name(slide_id) != "sldId":
            continue
        rel_id = slide_id.get(f"{{{REL_NS}}}id")
        if not rel_id:
            continue
        rel = rels.get(rel_id)
        if (
            rel
            and rel.get("Type") == SLIDE_REL_TYPE
            and not relationship_is_external(rel)
        ):
            slide_parts.append(
                resolve_part_path(
                    "ppt/presentation.xml",
                    rel.get("Target", ""),
                )
            )
    return slide_parts


def presentation_size_emu(package: zipfile.ZipFile) -> tuple[int, int]:
    presentation = read_xml(package, "ppt/presentation.xml")
    size = first_local_descendant(presentation, "sldSz")
    return (
        max(1, int_attr(size, "cx", 12192000)),
        max(1, int_attr(size, "cy", 6858000)),
    )


def slide_shows_master_shapes(slide: ET.Element[Any]) -> bool:
    common_slide_data = first_local_child(slide, "cSld")
    return common_slide_data is None or common_slide_data.get("showMasterSp") != "0"


def theme_color_map(package: zipfile.ZipFile) -> dict[str, str]:
    theme_part = presentation_theme_part(package) or first_theme_part(package)
    theme = read_xml(package, theme_part)
    color_scheme = first_local_descendant(theme, "clrScheme") if theme is not None else None
    if color_scheme is None:
        return FALLBACK_SCHEME_COLORS

    colors: dict[str, str] = {}
    for item in list(color_scheme):
        key = local_name(item)
        color = theme_color_value(item)
        if color:
            colors[key] = color
    for alias, target in SCHEME_COLOR_ALIASES.items():
        if target in colors:
            colors[alias] = colors[target]
    return {**FALLBACK_SCHEME_COLORS, **colors}


def theme_font_scheme(package: zipfile.ZipFile) -> OoxmlThemeFonts:
    theme_part = presentation_theme_part(package) or first_theme_part(package)
    theme = read_xml(package, theme_part)
    font_scheme = first_local_descendant(theme, "fontScheme") if theme is not None else None
    major = first_local_child(font_scheme, "majorFont")
    minor = first_local_child(font_scheme, "minorFont")
    major_latin = theme_font_value(major, "latin", "Calibri")
    minor_latin = theme_font_value(minor, "latin", "Calibri")
    return OoxmlThemeFonts(
        major_latin=major_latin,
        major_east_asian=theme_font_value(major, "ea", major_latin),
        major_complex_script=theme_font_value(major, "cs", major_latin),
        minor_latin=minor_latin,
        minor_east_asian=theme_font_value(minor, "ea", minor_latin),
        minor_complex_script=theme_font_value(minor, "cs", minor_latin),
    )


def theme_font_value(
    font_group: ET.Element[Any] | None,
    script: str,
    fallback: str,
) -> str:
    font = first_local_child(font_group, script)
    typeface = str(font.get("typeface", "")).strip() if font is not None else ""
    return typeface or fallback


def theme_style_matrix(package: zipfile.ZipFile) -> OoxmlThemeStyles:
    theme_part = presentation_theme_part(package) or first_theme_part(package)
    theme = read_xml(package, theme_part)
    if theme is None:
        return OoxmlThemeStyles()
    format_scheme = first_local_descendant(theme, "fmtScheme")
    line_style_list = first_local_child(format_scheme, "lnStyleLst")
    effect_style_list = first_local_child(format_scheme, "effectStyleLst")
    return OoxmlThemeStyles(
        line_styles=(
            tuple(direct_local_children(line_style_list, "ln"))
            if line_style_list is not None
            else ()
        ),
        effect_styles=(
            tuple(direct_local_children(effect_style_list, "effectStyle"))
            if effect_style_list is not None
            else ()
        ),
    )


def presentation_theme_part(package: zipfile.ZipFile) -> str | None:
    rels = relationships_for_part(package, "ppt/presentation.xml")
    return relationship_target_by_type("ppt/presentation.xml", rels, THEME_REL_TYPE)


def first_theme_part(package: zipfile.ZipFile) -> str | None:
    return next(
        (
            name
            for name in package.namelist()
            if name.startswith("ppt/theme/theme") and name.endswith(".xml")
        ),
        None,
    )


def theme_color_value(item: ET.Element[Any]) -> str | None:
    srgb = first_local_child(item, "srgbClr")
    if srgb is not None and srgb.get("val"):
        return f"#{str(srgb.get('val')).upper()}"
    sys = first_local_child(item, "sysClr")
    if sys is not None and sys.get("lastClr"):
        return f"#{str(sys.get('lastClr')).upper()}"
    scheme = first_local_child(item, "schemeClr")
    if scheme is not None:
        return FALLBACK_SCHEME_COLORS.get(str(scheme.get("val", "")))
    return None


def apply_color_transforms(color: str, color_node: ET.Element[Any]) -> str:
    red = int(color[1:3], 16)
    green = int(color[3:5], 16)
    blue = int(color[5:7], 16)

    for transform in list(color_node):
        name = local_name(transform)
        value = int_attr(transform, "val", 100000) / 100000
        if name == "lumMod":
            red, green, blue = (
                round(red * value),
                round(green * value),
                round(blue * value),
            )
        elif name == "lumOff":
            red, green, blue = (
                round(red + 255 * value),
                round(green + 255 * value),
                round(blue + 255 * value),
            )
        elif name == "tint":
            red, green, blue = (
                round(red + (255 - red) * value),
                round(green + (255 - green) * value),
                round(blue + (255 - blue) * value),
            )
        elif name == "shade":
            red, green, blue = (
                round(red * value),
                round(green * value),
                round(blue * value),
            )

    return f"#{clamp_rgb(red):02X}{clamp_rgb(green):02X}{clamp_rgb(blue):02X}"


def clamp_rgb(value: int) -> int:
    return max(0, min(255, value))

def relationships_for_part(
    package: zipfile.ZipFile,
    part_path: str | None,
) -> dict[str, dict[str, str]]:
    if not part_path:
        return {}
    rels_path = rels_path_for_part(part_path)
    if rels_path not in package.namelist():
        return {}
    root = ET.fromstring(package.read(rels_path))
    return {
        str(relationship.get("Id")): {
            key: str(value) for key, value in relationship.attrib.items()
        }
        for relationship in root
        if local_name(relationship) == "Relationship" and relationship.get("Id")
    }


def relationship_target_by_type(
    part_path: str | None,
    rels: dict[str, dict[str, str]],
    rel_type: str,
) -> str | None:
    if not part_path:
        return None
    for rel in rels.values():
        if (
            rel.get("Type") == rel_type
            and rel.get("Target")
            and not relationship_is_external(rel)
        ):
            return resolve_part_path(part_path, rel["Target"])
    return None


def relationship_is_external(relationship: dict[str, str]) -> bool:
    return relationship.get("TargetMode", "").lower() == "external"


def rels_path_for_part(part_path: str) -> str:
    directory, _, filename = part_path.rpartition("/")
    return f"{directory}/_rels/{filename}.rels" if directory else f"_rels/{filename}.rels"


def resolve_part_path(part_path: str, target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    base_parts = part_path.split("/")[:-1]
    for piece in target.split("/"):
        if piece in {"", "."}:
            continue
        if piece == "..":
            if base_parts:
                base_parts.pop()
        else:
            base_parts.append(piece)
    return "/".join(base_parts)


def read_xml(package: zipfile.ZipFile, part_path: str | None) -> ET.Element[Any] | None:
    if not part_path or part_path not in package.namelist():
        return None
    return ET.fromstring(package.read(part_path))


def content_type_map(package: zipfile.ZipFile) -> dict[str, str]:
    if "[Content_Types].xml" not in package.namelist():
        return {}
    root = ET.fromstring(package.read("[Content_Types].xml"))
    mapping: dict[str, str] = {}
    for item in root:
        name = local_name(item)
        if name == "Default" and item.get("Extension") and item.get("ContentType"):
            mapping[f".{str(item.get('Extension')).lower()}"] = str(item.get("ContentType"))
        elif name == "Override" and item.get("PartName") and item.get("ContentType"):
            mapping[str(item.get("PartName")).lstrip("/")] = str(item.get("ContentType"))
    return mapping


def mime_type_for_part(content_types: dict[str, str], part_path: str) -> str:
    if part_path in content_types:
        return content_types[part_path]
    suffix = f".{part_path.rsplit('.', maxsplit=1)[-1].lower()}"
    return content_types.get(suffix, "image/png")


def extension_for_mime_type(mime_type: str) -> str:
    subtype = mime_type.rsplit("/", maxsplit=1)[-1].lower()
    if subtype == "jpeg":
        return "jpg"
    if subtype in {"svg", "svg+xml"}:
        return "svg"
    return subtype if subtype in {"png", "jpg", "gif", "webp"} else "png"


def is_svg_mime_type(mime_type: str) -> bool:
    return mime_type.lower() in {"image/svg+xml", "image/svg"}


def is_full_canvas_frame(frame: dict[str, int], scale: OoxmlScale) -> bool:
    return (
        frame["x"] <= 4
        and frame["y"] <= 4
        and frame["width"] >= scale.canvas_width - 8
        and frame["height"] >= scale.canvas_height - 8
    )


def first_local_descendant(
    element: ET.Element[Any] | None,
    name: str,
) -> ET.Element[Any] | None:
    if element is None:
        return None
    for candidate in element.iter():
        if local_name(candidate) == name:
            return candidate
    return None


def first_local_child(
    element: ET.Element[Any] | None,
    name: str,
) -> ET.Element[Any] | None:
    if element is None:
        return None
    for candidate in list(element):
        if local_name(candidate) == name:
            return candidate
    return None


def direct_local_children(
    element: ET.Element[Any],
    name: str,
) -> list[ET.Element[Any]]:
    return [child for child in list(element) if local_name(child) == name]


def local_name(element: ET.Element[Any] | str) -> str:
    tag = element.tag if isinstance(element, ET.Element) else element
    return str(tag).rsplit("}", maxsplit=1)[-1]


def int_attr(element: ET.Element[Any] | None, name: str, fallback: int) -> int:
    if element is None:
        return fallback
    try:
        return int(str(element.get(name)))
    except Exception:
        return fallback


def int_value(value: object, fallback: int) -> int:
    try:
        return int(str(value))
    except Exception:
        return fallback


def attr_by_local_name(element: ET.Element[Any] | None, name: str) -> str | None:
    if element is None:
        return None
    for key, value in element.attrib.items():
        if local_name(key) == name:
            return str(value)
    return None


def safe_id(value: str) -> str:
    return (
        "".join(
            char if char.isascii() and (char.isalnum() or char in "_-") else "_"
            for char in value
        )
        or "ooxml"
    )
