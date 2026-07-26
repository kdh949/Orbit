from __future__ import annotations


import math

import posixpath


import zipfile


from pathlib import Path


from typing import Any, cast

from xml.etree import ElementTree as ET


from app.ai.authored_element_rasterizer import (
    AUTHORED_RASTER_ELEMENT_TYPES,
    AuthoredElementRasterizationError,
    RasterizedAuthoredElement,
)


from app.ai.pptx_ooxml_vector_importer import (
    direct_graphic_frame_table,
)


from typing import TYPE_CHECKING

from app.ai.pptx_ooxml.common import (
    A_T,
    CONTENT_TYPES_NS,
    DML_NS,
    IMAGE_REL_TYPE,
    PKG_REL_NS,
    PML_NS,
    P_GRAPHIC_FRAME,
    P_PIC,
    PptxOoxmlUnsupportedReasonCode,
    REL_NS,
    SLIDE_CONTENT_TYPE,
    SLIDE_LAYOUT_REL_TYPE,
    SLIDE_REL_TYPE,
    TABLE_GRAPHIC_DATA_URI,
    VISUAL_SHAPE_NAMES,
)

if TYPE_CHECKING:
    from app.ai.pptx_ooxml.models import (
        PackageFrameScale,
    )


def update_shape_frame(
    shape: ET.Element[Any],
    frame: dict[str, Any],
    scale: PackageFrameScale,
) -> None:
    from app.ai.pptx_ooxml.routing import (
        ensure_xfrm,
        first_local_child,
    )

    xfrm = ensure_xfrm(shape)
    off = first_local_child(xfrm, "off")
    if off is None:
        off = ET.SubElement(xfrm, f"{{{DML_NS}}}off")
    ext = first_local_child(xfrm, "ext")
    if ext is None:
        ext = ET.SubElement(xfrm, f"{{{DML_NS}}}ext")
    if "x" in frame:
        off.set(
            "x",
            str(round(float(frame["x"]) * scale.slide_width_emu / scale.canvas_width)),
        )
    if "y" in frame:
        off.set(
            "y",
            str(
                round(float(frame["y"]) * scale.slide_height_emu / scale.canvas_height)
            ),
        )
    if "width" in frame:
        ext.set(
            "cx",
            str(
                max(
                    1,
                    round(
                        float(frame["width"])
                        * scale.slide_width_emu
                        / scale.canvas_width
                    ),
                )
            ),
        )
    if "height" in frame:
        ext.set(
            "cy",
            str(
                max(
                    1,
                    round(
                        float(frame["height"])
                        * scale.slide_height_emu
                        / scale.canvas_height
                    ),
                )
            ),
        )
    if "rotation" in frame:
        xfrm.set("rot", str(round(float(frame["rotation"]) * 60000)))


def table_graphic_frame_element(
    shape_id: int,
    element: dict[str, Any],
    scale: PackageFrameScale,
) -> ET.Element[Any]:
    from app.ai.pptx_ooxml.routing import (
        dict_value,
        frame_to_emu,
    )

    frame = ET.Element(P_GRAPHIC_FRAME)
    non_visual = ET.SubElement(frame, f"{{{PML_NS}}}nvGraphicFramePr")
    ET.SubElement(
        non_visual,
        f"{{{PML_NS}}}cNvPr",
        {"id": str(shape_id), "name": "Orbit table"},
    )
    ET.SubElement(non_visual, f"{{{PML_NS}}}cNvGraphicFramePr")
    ET.SubElement(non_visual, f"{{{PML_NS}}}nvPr")
    update_shape_frame(frame, element, scale)
    graphic = ET.SubElement(frame, f"{{{DML_NS}}}graphic")
    graphic_data = ET.SubElement(
        graphic,
        f"{{{DML_NS}}}graphicData",
        {"uri": TABLE_GRAPHIC_DATA_URI},
    )
    _x, _y, width, height = frame_to_emu(element, scale)
    graphic_data.append(
        table_subtree_element(dict_value(element, "props"), width, height, scale)
    )
    return frame


def replace_authored_table_subtree(
    shape: ET.Element[Any],
    props: dict[str, Any],
    scale: PackageFrameScale,
) -> bool:
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
    )

    if shape.tag != P_GRAPHIC_FRAME:
        return False
    graphic = first_local_child(shape, "graphic")
    graphic_data = (
        first_local_child(graphic, "graphicData") if graphic is not None else None
    )
    table = direct_graphic_frame_table(shape)
    frame_size = graphic_frame_size_emu(shape)
    if graphic_data is None or table is None or frame_size is None:
        return False
    width, height = frame_size
    rows = props.get("rows")
    if not isinstance(rows, list) or not rows or not isinstance(rows[0], list):
        return False
    column_count = len(rows[0])
    row_count = len(rows)
    preserved_column_widths = (
        table_column_tracks_emu(table, column_count)
        if "columnWidths" not in props
        else None
    )
    preserved_row_heights = (
        table_row_tracks_emu(table, row_count) if "rowHeights" not in props else None
    )
    if ("columnWidths" not in props and preserved_column_widths is None) or (
        "rowHeights" not in props and preserved_row_heights is None
    ):
        return False
    replacement = table_subtree_element(
        props,
        width,
        height,
        scale,
        column_widths_emu=preserved_column_widths,
        row_heights_emu=preserved_row_heights,
    )
    table_index = list(graphic_data).index(table)
    graphic_data.remove(table)
    graphic_data.insert(table_index, replacement)
    return True


def graphic_frame_size_emu(shape: ET.Element[Any]) -> tuple[int, int] | None:
    from app.ai.pptx_ooxml.rendering import (
        int_value,
    )
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
    )

    xfrm = first_local_child(shape, "xfrm")
    ext = first_local_child(xfrm, "ext") if xfrm is not None else None
    if ext is None:
        return None
    width = int_value(ext.get("cx"), 0)
    height = int_value(ext.get("cy"), 0)
    return (width, height) if width > 0 and height > 0 else None


def resize_authored_table_tracks_to_frame(shape: ET.Element[Any]) -> bool:
    from app.ai.pptx_ooxml.rendering import (
        int_value,
    )
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
        first_local_child,
    )

    table = direct_graphic_frame_table(shape)
    frame_size = graphic_frame_size_emu(shape)
    if table is None or frame_size is None:
        return False
    grid = first_local_child(table, "tblGrid")
    columns = direct_local_children(grid, "gridCol") if grid is not None else []
    rows = direct_local_children(table, "tr")
    if not columns or not rows:
        return False
    column_weights = [int_value(column.get("w"), 0) for column in columns]
    row_weights = [int_value(row.get("h"), 0) for row in rows]
    if any(value <= 0 for value in column_weights + row_weights):
        return False
    widths = normalized_table_tracks_emu(
        column_weights,
        total=frame_size[0],
        count=len(columns),
    )
    heights = normalized_table_tracks_emu(
        row_weights,
        total=frame_size[1],
        count=len(rows),
    )
    for column, width in zip(columns, widths, strict=True):
        column.set("w", str(width))
    for row, height in zip(rows, heights, strict=True):
        row.set("h", str(height))
    return True


def table_subtree_element(
    props: dict[str, Any],
    frame_width_emu: int,
    frame_height_emu: int,
    scale: PackageFrameScale,
    *,
    column_widths_emu: list[int] | None = None,
    row_heights_emu: list[int] | None = None,
) -> ET.Element[Any]:
    rows = cast(list[list[dict[str, Any]]], props["rows"])
    row_count = len(rows)
    column_count = len(rows[0])
    table = ET.Element(f"{{{DML_NS}}}tbl")
    ET.SubElement(table, f"{{{DML_NS}}}tblPr")
    grid = ET.SubElement(table, f"{{{DML_NS}}}tblGrid")
    column_widths = column_widths_emu or normalized_table_tracks_emu(
        props.get("columnWidths"),
        total=max(column_count, frame_width_emu),
        count=column_count,
    )
    row_heights = row_heights_emu or normalized_table_tracks_emu(
        props.get("rowHeights"),
        total=max(row_count, frame_height_emu),
        count=row_count,
    )
    for width in column_widths:
        ET.SubElement(grid, f"{{{DML_NS}}}gridCol", {"w": str(width)})
    for row_index, (row_payload, height) in enumerate(
        zip(rows, row_heights, strict=True)
    ):
        row = ET.SubElement(table, f"{{{DML_NS}}}tr", {"h": str(height)})
        for cell_payload in row_payload:
            row.append(table_cell_element(cell_payload, props, row_index, scale))
    return table


def table_column_tracks_emu(
    table: ET.Element[Any],
    expected_count: int,
) -> list[int] | None:
    from app.ai.pptx_ooxml.rendering import (
        int_value,
    )
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
        first_local_child,
    )

    grid = first_local_child(table, "tblGrid")
    if grid is None:
        return None
    tracks = [
        int_value(column.get("w"), 0)
        for column in direct_local_children(grid, "gridCol")
    ]
    return tracks if len(tracks) == expected_count and all(tracks) else None


def table_row_tracks_emu(
    table: ET.Element[Any],
    expected_count: int,
) -> list[int] | None:
    from app.ai.pptx_ooxml.rendering import (
        int_value,
    )
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
    )

    tracks = [int_value(row.get("h"), 0) for row in direct_local_children(table, "tr")]
    return tracks if len(tracks) == expected_count and all(tracks) else None


def normalized_table_tracks_emu(
    tracks: Any,
    *,
    total: int,
    count: int,
) -> list[int]:
    weights = (
        [float(value) for value in tracks]
        if isinstance(tracks, list) and tracks
        else [1.0] * count
    )
    maximum = max(weights)
    scaled = [weight / maximum for weight in weights]
    distributable = max(0, total - count)
    exact_extras = [distributable * weight / sum(scaled) for weight in scaled]
    floor_extras = [math.floor(value) for value in exact_extras]
    normalized = [1 + value for value in floor_extras]
    remainder = distributable - sum(floor_extras)
    order = sorted(
        range(count),
        key=lambda index: (-(exact_extras[index] - floor_extras[index]), index),
    )
    for index in order[:remainder]:
        normalized[index] += 1
    return normalized


def table_cell_element(
    cell_payload: dict[str, Any],
    table_props: dict[str, Any],
    row_index: int,
    scale: PackageFrameScale,
) -> ET.Element[Any]:
    from app.ai.pptx_ooxml.text import (
        font_size_to_ooxml,
        is_bold_text_weight,
        set_text_node_value,
    )

    del row_index
    cell = ET.Element(f"{{{DML_NS}}}tc")
    body = ET.SubElement(cell, f"{{{DML_NS}}}txBody")
    ET.SubElement(body, f"{{{DML_NS}}}bodyPr")
    ET.SubElement(body, f"{{{DML_NS}}}lstStyle")
    text = str(cell_payload.get("text", ""))
    for paragraph_text in text.split("\n"):
        paragraph = ET.SubElement(body, f"{{{DML_NS}}}p")
        align = {
            "center": "ctr",
            "right": "r",
            "justify": "just",
        }.get(str(cell_payload.get("align", "left")), "l")
        ET.SubElement(paragraph, f"{{{DML_NS}}}pPr", {"algn": align})
        run = ET.SubElement(paragraph, f"{{{DML_NS}}}r")
        run_properties = ET.SubElement(
            run,
            f"{{{DML_NS}}}rPr",
            {
                "lang": "ko-KR",
                "sz": str(font_size_to_ooxml(cell_payload.get("fontSize", 18), scale)),
                "b": "1"
                if is_bold_text_weight(cell_payload.get("fontWeight", "normal"))
                else "0",
            },
        )
        text_color = str(cell_payload.get("textColor") or "#000000")
        text_fill = ET.SubElement(run_properties, f"{{{DML_NS}}}solidFill")
        ET.SubElement(
            text_fill,
            f"{{{DML_NS}}}srgbClr",
            {"val": text_color[1:].upper()},
        )
        font_family = cell_payload.get("fontFamily")
        if isinstance(font_family, str) and font_family:
            ET.SubElement(
                run_properties,
                f"{{{DML_NS}}}latin",
                {"typeface": font_family},
            )
            ET.SubElement(
                run_properties,
                f"{{{DML_NS}}}ea",
                {"typeface": font_family},
            )
        text_node = ET.SubElement(run, A_T)
        set_text_node_value(text_node, paragraph_text)

    anchor = {
        "top": "t",
        "bottom": "b",
    }.get(str(cell_payload.get("verticalAlign", "middle")), "ctr")
    cell_properties = ET.SubElement(
        cell,
        f"{{{DML_NS}}}tcPr",
        {"anchor": anchor},
    )
    border_color = str(
        cell_payload.get("borderColor") or table_props.get("borderColor") or "#CBD5E1"
    )
    border_width = cell_payload.get(
        "borderWidth",
        table_props.get("borderWidth", 1),
    )
    for border_name in ("lnL", "lnR", "lnT", "lnB"):
        line = ET.SubElement(
            cell_properties,
            f"{{{DML_NS}}}{border_name}",
            {"w": str(table_border_width_to_emu(border_width, scale))},
        )
        if float(border_width) <= 0:
            ET.SubElement(line, f"{{{DML_NS}}}noFill")
        else:
            line_fill = ET.SubElement(line, f"{{{DML_NS}}}solidFill")
            ET.SubElement(
                line_fill,
                f"{{{DML_NS}}}srgbClr",
                {"val": border_color[1:].upper()},
            )
    fill = str(cell_payload.get("fill", "transparent"))
    if fill == "transparent":
        ET.SubElement(cell_properties, f"{{{DML_NS}}}noFill")
    else:
        solid_fill = ET.SubElement(cell_properties, f"{{{DML_NS}}}solidFill")
        ET.SubElement(
            solid_fill,
            f"{{{DML_NS}}}srgbClr",
            {"val": fill[1:].upper()},
        )
    return cell


def table_border_width_to_emu(value: Any, scale: PackageFrameScale) -> int:
    from app.ai.pptx_ooxml.text import (
        canvas_average_scale,
    )

    return max(0, round(float(value) / canvas_average_scale(scale)))


def reorder_visual_shape(
    parent: ET.Element[Any],
    shape: ET.Element[Any],
    z_index_value: Any,
) -> bool:
    from app.ai.pptx_ooxml.routing import (
        local_name,
    )

    visual_children = [
        child for child in list(parent) if local_name(child) in VISUAL_SHAPE_NAMES
    ]
    if shape not in visual_children:
        return False
    target_index = normalized_z_index(z_index_value, len(visual_children))
    if target_index is None:
        return False
    current_index = visual_children.index(shape)
    if current_index == target_index:
        return True

    parent.remove(shape)
    remaining = [child for child in visual_children if child is not shape]
    if target_index >= len(remaining):
        insert_at = visual_insert_end_index(parent)
    else:
        insert_at = list(parent).index(remaining[target_index])
    parent.insert(insert_at, shape)
    return True


def normalized_z_index(value: Any, item_count: int) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(numeric) or not numeric.is_integer():
        return None
    return max(0, min(int(numeric), max(0, item_count - 1)))


def visual_insert_end_index(parent: ET.Element[Any]) -> int:
    from app.ai.pptx_ooxml.routing import (
        local_name,
    )

    children = list(parent)
    visual_indexes = [
        index
        for index, child in enumerate(children)
        if local_name(child) in VISUAL_SHAPE_NAMES
    ]
    if visual_indexes:
        return visual_indexes[-1] + 1
    for index, child in enumerate(children):
        if local_name(child) == "extLst":
            return index
    return len(children)


def add_authored_slide_to_package(
    operation: dict[str, Any],
    package_entries: dict[str, bytes],
    added_entries: dict[str, bytes],
    scale: PackageFrameScale,
    warnings: list[str],
    source_package: zipfile.ZipFile,
    template_blueprint: dict[str, Any],
    fallback_theme: dict[str, Any],
    fallback_elements: dict[tuple[str, str], dict[str, Any]],
    raster_cache: dict[tuple[str, str], RasterizedAuthoredElement],
) -> tuple[list[dict[str, Any]], PptxOoxmlUnsupportedReasonCode | None]:
    from app.ai.pptx_ooxml.import_capabilities import (
        rasterized_fallback_candidate,
    )
    from app.ai.pptx_ooxml.rendering import (
        xml_bytes,
    )
    from app.ai.pptx_ooxml.routing import (
        rels_part_for_slide_part,
        slide_part_for_operation,
    )

    slide = operation.get("slide")
    slide_part = slide_part_for_operation(operation, template_blueprint)
    if not isinstance(slide, dict) or not slide_part:
        return [], "ADD_SLIDE_FAILED"
    if (
        slide_part in source_package.namelist()
        or slide_part in package_entries
        or not slide_part.startswith("ppt/slides/")
        or not slide_part.endswith(".xml")
    ):
        return [], "ADD_SLIDE_FAILED"

    layout_target = authored_slide_layout_target(
        package_entries,
        template_blueprint,
    )
    if not layout_target:
        return [], "ADD_SLIDE_LAYOUT_UNSAFE"
    presentation_xml = package_entries.get("ppt/presentation.xml")
    presentation_rels_xml = package_entries.get("ppt/_rels/presentation.xml.rels")
    content_types_xml = package_entries.get("[Content_Types].xml")
    if (
        presentation_xml is None
        or presentation_rels_xml is None
        or content_types_xml is None
    ):
        return [], "ADD_SLIDE_FAILED"

    try:
        presentation_root = ET.fromstring(presentation_xml)
        presentation_rels_root = ET.fromstring(presentation_rels_xml)
        content_types_root = ET.fromstring(content_types_xml)
    except ET.ParseError:
        return [], "ADD_SLIDE_FAILED"
    slide_id_list = presentation_root.find(f"{{{PML_NS}}}sldIdLst")
    if slide_id_list is None:
        return [], "ADD_SLIDE_FAILED"

    relationship_id = next_relationship_id(presentation_rels_root)
    ET.SubElement(
        presentation_rels_root,
        f"{{{PKG_REL_NS}}}Relationship",
        {
            "Id": relationship_id,
            "Type": SLIDE_REL_TYPE,
            "Target": posixpath.relpath(slide_part, "ppt"),
        },
    )
    current_slide_ids = [
        int(str(node.get("id", "0")))
        for node in list(slide_id_list)
        if str(node.get("id", "")).isdigit()
    ]
    slide_id_node = ET.Element(
        f"{{{PML_NS}}}sldId",
        {
            "id": str(max(current_slide_ids, default=255) + 1),
            f"{{{REL_NS}}}id": relationship_id,
        },
    )
    requested_order = slide.get("order")
    if not isinstance(requested_order, int) or isinstance(requested_order, bool):
        return [], "ADD_SLIDE_FAILED"
    insert_index = max(0, min(requested_order - 1, len(slide_id_list)))
    slide_id_list.insert(insert_index, slide_id_node)

    part_name = f"/{slide_part}"
    if not any(
        child.tag.endswith("Override") and child.get("PartName") == part_name
        for child in list(content_types_root)
    ):
        ET.SubElement(
            content_types_root,
            f"{{{CONTENT_TYPES_NS}}}Override",
            {"PartName": part_name, "ContentType": SLIDE_CONTENT_TYPE},
        )

    rels_part = rels_part_for_slide_part(slide_part)
    package_entries[slide_part] = empty_slide_xml()
    package_entries[rels_part] = slide_layout_relationships_xml(layout_target)
    package_entries["ppt/presentation.xml"] = xml_bytes(presentation_root)
    package_entries["ppt/_rels/presentation.xml.rels"] = xml_bytes(
        presentation_rels_root
    )
    package_entries["[Content_Types].xml"] = xml_bytes(content_types_root)

    added_sources: list[dict[str, Any]] = []
    elements = slide.get("elements", [])
    if not isinstance(elements, list):
        return [], "ADD_SLIDE_FAILED"
    for element in elements:
        if not isinstance(element, dict):
            return [], "ADD_SLIDE_FAILED"
        element_type = str(element.get("type", ""))
        if element_type in AUTHORED_RASTER_ELEMENT_TYPES:
            try:
                rendered = rasterized_fallback_candidate(
                    str(slide.get("slideId", operation.get("slideId", ""))),
                    str(element.get("elementId", "")),
                    fallback_theme,
                    fallback_elements,
                    raster_cache,
                )
            except AuthoredElementRasterizationError:
                return [], "AUTHORED_RASTER_FALLBACK_FAILED"
            if rendered is None:
                return [], "AUTHORED_RASTER_FALLBACK_FAILED"
            added_source = add_rasterized_element_to_slide_xml(
                slide_part,
                element,
                rendered,
                package_entries,
                added_entries,
                scale,
                warnings,
            )
        elif element_type in {"text", "rect", "image", "table"}:
            added_source = add_element_to_slide_xml(
                slide_part,
                element,
                package_entries,
                added_entries,
                scale,
                warnings,
            )
        else:
            return [], "ADD_SLIDE_FAILED"
        if added_source is None:
            return [], "ADD_SLIDE_FAILED"
        added_sources.append(added_source)
    return added_sources, None


def authored_slide_layout_target(
    package_entries: dict[str, bytes],
    template_blueprint: dict[str, Any],
) -> str:
    from app.ai.pptx_ooxml.routing import (
        rels_part_for_slide_part,
    )

    for raw_slide in template_blueprint.get("slides", []):
        if (
            not isinstance(raw_slide, dict)
            or raw_slide.get("ooxmlOrigin") == "authored"
        ):
            continue
        slide_part = str(raw_slide.get("sourceSlidePart", ""))
        if not slide_part:
            continue
        rels_xml = package_entries.get(rels_part_for_slide_part(slide_part))
        if rels_xml is None:
            continue
        try:
            relationships_root = ET.fromstring(rels_xml)
        except ET.ParseError:
            continue
        for relationship in list(relationships_root):
            if relationship.get("Type") == SLIDE_LAYOUT_REL_TYPE:
                target = str(relationship.get("Target", ""))
                if target:
                    return target
    return ""


def next_relationship_id(root: ET.Element[Any]) -> str:
    ids = [
        int(str(child.get("Id", "")).removeprefix("rId"))
        for child in list(root)
        if str(child.get("Id", "")).startswith("rId")
        and str(child.get("Id", "")).removeprefix("rId").isdigit()
    ]
    return f"rId{max(ids, default=0) + 1}"


def empty_slide_xml() -> bytes:
    from app.ai.pptx_ooxml.rendering import (
        xml_bytes,
    )

    slide = ET.Element(f"{{{PML_NS}}}sld")
    common = ET.SubElement(slide, f"{{{PML_NS}}}cSld")
    shape_tree = ET.SubElement(common, f"{{{PML_NS}}}spTree")
    non_visual = ET.SubElement(shape_tree, f"{{{PML_NS}}}nvGrpSpPr")
    ET.SubElement(
        non_visual,
        f"{{{PML_NS}}}cNvPr",
        {"id": "1", "name": ""},
    )
    ET.SubElement(non_visual, f"{{{PML_NS}}}cNvGrpSpPr")
    ET.SubElement(non_visual, f"{{{PML_NS}}}nvPr")
    group_properties = ET.SubElement(shape_tree, f"{{{PML_NS}}}grpSpPr")
    transform = ET.SubElement(group_properties, f"{{{DML_NS}}}xfrm")
    for name in ("off", "chOff"):
        ET.SubElement(transform, f"{{{DML_NS}}}{name}", {"x": "0", "y": "0"})
    for name in ("ext", "chExt"):
        ET.SubElement(transform, f"{{{DML_NS}}}{name}", {"cx": "0", "cy": "0"})
    color_map = ET.SubElement(slide, f"{{{PML_NS}}}clrMapOvr")
    ET.SubElement(color_map, f"{{{DML_NS}}}masterClrMapping")
    return xml_bytes(slide)


def slide_layout_relationships_xml(target: str) -> bytes:
    from app.ai.pptx_ooxml.rendering import (
        xml_bytes,
    )

    root = ET.Element(f"{{{PKG_REL_NS}}}Relationships")
    ET.SubElement(
        root,
        f"{{{PKG_REL_NS}}}Relationship",
        {"Id": "rId1", "Type": SLIDE_LAYOUT_REL_TYPE, "Target": target},
    )
    return xml_bytes(root)


def add_rasterized_element_to_slide_xml(
    slide_part: str,
    element: dict[str, Any],
    rendered: RasterizedAuthoredElement,
    package_entries: dict[str, bytes],
    added_entries: dict[str, bytes],
    scale: PackageFrameScale,
    warnings: list[str],
) -> dict[str, Any] | None:
    from app.ai.pptx_ooxml.media import (
        safe_package_token,
    )
    from app.ai.pptx_ooxml.rendering import (
        empty_relationships_xml,
        xml_bytes,
    )
    from app.ai.pptx_ooxml.routing import (
        append_image_relationship,
        ensure_content_type_default,
        first_local_descendant,
        next_c_nv_pr_id,
        picture_shape_element,
        rels_part_for_slide_part,
    )

    slide_xml = package_entries.get(slide_part)
    content_types_xml = package_entries.get("[Content_Types].xml")
    if slide_xml is None or content_types_xml is None:
        return None
    try:
        root = ET.fromstring(slide_xml)
        shape_tree = first_local_descendant(root, "spTree")
        if shape_tree is None:
            return None
        next_shape_id = next_c_nv_pr_id(root)
        rels_part = rels_part_for_slide_part(slide_part)
        rels_xml = package_entries.get(rels_part, empty_relationships_xml())
        media_token = safe_package_token(
            f"{Path(slide_part).stem}_{next_shape_id}_{element.get('elementId', '')}"
        )
        media_name = f"orbit_raster_{media_token}.png"
        media_part = f"ppt/media/{media_name}"
        relationship_id, next_rels_xml = append_image_relationship(
            rels_xml,
            f"../media/{media_name}",
        )
        next_content_types_xml = ensure_content_type_default(
            content_types_xml,
            "png",
            "image/png",
        )
        frame = rasterized_picture_frame(element, rendered)
        shape = picture_shape_element(
            next_shape_id,
            frame,
            relationship_id,
            scale,
            (rendered.pixel_width, rendered.pixel_height),
        )
    except (ET.ParseError, ValueError):
        warnings.append(
            f"OOXML raster relationship invalid for {element.get('elementId')}."
        )
        return None
    shape_tree.append(shape)
    package_entries[slide_part] = xml_bytes(root)
    package_entries[rels_part] = next_rels_xml
    package_entries["[Content_Types].xml"] = next_content_types_xml
    added_entries[media_part] = rendered.png_bytes
    return {
        "elementId": str(element.get("elementId", "")),
        "elementType": str(element.get("type", "")),
        "ooxmlOrigin": "authored",
        "ooxmlEditCapabilities": {
            "richText": "none",
            "crop": "none",
            "tableCellText": False,
            "frame": True,
            "delete": True,
            "imageSource": False,
        },
        "slidePart": slide_part,
        "shapeId": str(next_shape_id),
        "relationshipId": relationship_id,
        "sourceType": "image",
        "writable": True,
        "fallbackMode": "rasterized",
        "fallbackReason": "AUTHORED_ELEMENT_TYPE_RASTERIZED",
    }


def rasterized_picture_frame(
    element: dict[str, Any],
    rendered: RasterizedAuthoredElement,
) -> dict[str, Any]:
    return {
        **element,
        "x": rendered.x,
        "y": rendered.y,
        "width": rendered.width,
        "height": rendered.height,
        "rotation": rendered.rotation,
        "opacity": 1,
        "visible": True,
    }


def replace_rasterized_picture(
    shape: ET.Element[Any],
    source: dict[str, Any],
    slide_part: str,
    rendered: RasterizedAuthoredElement,
    package_entries: dict[str, bytes],
    added_entries: dict[str, bytes],
    source_package: zipfile.ZipFile,
    scale: PackageFrameScale,
) -> bool:
    from app.ai.pptx_ooxml.media import (
        direct_image_blip,
        set_picture_opacity,
        set_shape_visibility,
    )
    from app.ai.pptx_ooxml.operations import (
        resolve_relationship_part,
    )
    from app.ai.pptx_ooxml.routing import (
        rels_part_for_slide_part,
    )

    if shape.tag != P_PIC:
        return False
    relationship_id = str(source.get("relationshipId", ""))
    rels_part = rels_part_for_slide_part(slide_part)
    rels_xml = package_entries.get(rels_part)
    if not relationship_id or rels_xml is None:
        return False
    try:
        relationships_root = ET.fromstring(rels_xml)
    except ET.ParseError:
        return False
    matches = [
        relationship
        for relationship in list(relationships_root)
        if relationship.get("Id") == relationship_id
        and relationship.get("Type") == IMAGE_REL_TYPE
    ]
    if len(matches) != 1:
        return False
    target = str(matches[0].get("Target", ""))
    media_part = resolve_relationship_part(slide_part, target)
    if not media_part.startswith("ppt/media/") or ".." in media_part:
        return False
    if media_part not in source_package.namelist() and media_part not in added_entries:
        return False
    if (
        package_image_relationship_reference_count(
            source_package,
            package_entries,
            media_part,
        )
        != 1
    ):
        return False
    if direct_image_blip(shape, source) is None:
        return False
    update_shape_frame(shape, rasterized_picture_frame({}, rendered), scale)
    if not set_picture_opacity(shape, source, 1):
        return False
    if not set_shape_visibility(shape, True):
        return False
    added_entries[media_part] = rendered.png_bytes
    return True


def package_image_relationship_reference_count(
    source_package: zipfile.ZipFile,
    package_entries: dict[str, bytes],
    media_part: str,
) -> int | None:
    from app.ai.pptx_ooxml.operations import (
        resolve_relationship_part,
    )

    relationship_parts = {
        name for name in source_package.namelist() if name.endswith(".rels")
    }
    relationship_parts.update(
        name for name in package_entries if name.endswith(".rels")
    )
    count = 0
    for rels_part in relationship_parts:
        content = package_entries.get(rels_part)
        if content is None:
            content = source_package.read(rels_part)
        try:
            root = ET.fromstring(content)
        except ET.ParseError:
            return None
        source_part = source_part_for_relationships_part(rels_part)
        if source_part is None:
            continue
        for relationship in list(root):
            if relationship.get("Type") != IMAGE_REL_TYPE:
                continue
            target = str(relationship.get("Target", ""))
            if resolve_relationship_part(source_part, target) == media_part:
                count += 1
    return count


def source_part_for_relationships_part(rels_part: str) -> str | None:
    marker = "/_rels/"
    if marker not in rels_part or not rels_part.endswith(".rels"):
        return None
    prefix, name = rels_part.split(marker, maxsplit=1)
    return f"{prefix}/{name.removesuffix('.rels')}"


def add_element_to_slide_xml(
    slide_part: str,
    element: dict[str, Any],
    package_entries: dict[str, bytes],
    added_entries: dict[str, bytes],
    scale: PackageFrameScale,
    warnings: list[str],
) -> dict[str, Any] | None:
    from app.ai.pptx_ooxml.media import (
        decode_image_data_url,
        refresh_table_source_locators,
    )
    from app.ai.pptx_ooxml.rendering import (
        empty_relationships_xml,
        extension_for_mime_type,
        xml_bytes,
    )
    from app.ai.pptx_ooxml.routing import (
        append_image_relationship,
        dict_value,
        ensure_content_type_default,
        first_local_descendant,
        image_dimensions,
        next_c_nv_pr_id,
        picture_shape_element,
        rect_shape_element,
        rels_part_for_slide_part,
        text_shape_element,
    )

    slide_xml = package_entries.get(slide_part)
    if slide_xml is None:
        warnings.append(
            f"OOXML slide part missing for added element {element.get('elementId')}."
        )
        return None

    root = ET.fromstring(slide_xml)
    shape_tree = first_local_descendant(root, "spTree")
    if shape_tree is None:
        warnings.append(
            f"OOXML shape tree missing for added element {element.get('elementId')}."
        )
        return None

    next_shape_id = next_c_nv_pr_id(root)
    element_id = str(element.get("elementId", ""))
    element_type = str(element.get("type", ""))
    if element_type == "text":
        shape = text_shape_element(next_shape_id, element, scale)
        source_type = "slide"
        relationship_id = None
    elif element_type == "rect":
        shape = rect_shape_element(next_shape_id, element, scale)
        source_type = "slide"
        relationship_id = None
    elif element_type == "image":
        replacement = decode_image_data_url(dict_value(element, "props").get("src"))
        if isinstance(replacement, str):
            warnings.append(
                f"OOXML add_element image skipped for {element_id}: {replacement}."
            )
            return None
        content_types_xml = package_entries.get("[Content_Types].xml")
        if content_types_xml is None:
            warnings.append(f"OOXML content types missing for {element_id}.")
            return None
        mime_type, image_blob = replacement
        extension = extension_for_mime_type(mime_type)
        rels_part = rels_part_for_slide_part(slide_part)
        rels_xml = package_entries.get(rels_part, empty_relationships_xml())
        media_name = f"orbit_sync_{Path(slide_part).stem}_{next_shape_id}.{extension}"
        media_part = f"ppt/media/{media_name}"
        try:
            relationship_id, next_rels_xml = append_image_relationship(
                rels_xml,
                f"../media/{media_name}",
            )
            next_content_types_xml = ensure_content_type_default(
                content_types_xml,
                extension,
                mime_type,
            )
        except (ET.ParseError, ValueError):
            warnings.append(f"OOXML image relationship invalid for {element_id}.")
            return None
        shape = picture_shape_element(
            next_shape_id,
            element,
            relationship_id,
            scale,
            image_dimensions(image_blob),
        )
        source_type = "image"
    elif element_type == "table":
        shape = table_graphic_frame_element(next_shape_id, element, scale)
        source_type = "table"
        relationship_id = None
    else:
        warnings.append(f"OOXML add_element skipped for {element_type}.")
        return None

    shape_tree.append(shape)
    package_entries[slide_part] = xml_bytes(root)
    if element_type == "image":
        package_entries[rels_part] = next_rels_xml
        package_entries["[Content_Types].xml"] = next_content_types_xml
        added_entries[media_part] = image_blob

    source: dict[str, Any] = {
        "elementId": element_id,
        "elementType": element_type,
        "ooxmlOrigin": "authored",
        "ooxmlEditCapabilities": {
            "richText": "full" if element_type == "text" else "none",
            "crop": "picture" if element_type == "image" else "none",
            "tableCellText": element_type == "table",
            "frame": True,
            "delete": True,
            "imageSource": element_type == "image",
        },
        "slidePart": slide_part,
        "shapeId": str(next_shape_id),
        "sourceType": source_type,
        "writable": True,
    }
    if relationship_id is not None:
        source["relationshipId"] = relationship_id
    if element_type == "table" and not refresh_table_source_locators(shape, source):
        warnings.append(
            f"OOXML authored table locator creation failed for {element_id}."
        )
        return None
    return source
