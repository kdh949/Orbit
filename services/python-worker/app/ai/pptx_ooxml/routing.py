from __future__ import annotations


import math


from io import BytesIO


from typing import Any

from xml.etree import ElementTree as ET

from PIL import Image


from typing import TYPE_CHECKING

from app.ai.pptx_ooxml.common import (
    A_BLIP,
    CONTENT_TYPES_NS,
    DML_NS,
    IMAGE_REL_TYPE,
    PKG_REL_NS,
    PML_NS,
    P_GRAPHIC_FRAME,
    P_PIC,
    P_SP,
    REL_NS,
)

if TYPE_CHECKING:
    from app.ai.pptx_ooxml.models import (
        PackageFrameScale,
    )


def slide_part_for_operation(
    operation: dict[str, Any],
    template_blueprint: dict[str, Any],
) -> str:
    explicit_slide_part = str(operation.get("sourceSlidePart", ""))
    if explicit_slide_part:
        return explicit_slide_part
    operation_slide_id = str(operation.get("slideId", ""))
    matches = [
        str(slide.get("sourceSlidePart", ""))
        for slide in template_blueprint.get("slides", [])
        if isinstance(slide, dict) and slide.get("slideId") == operation_slide_id
    ]
    return matches[0] if len(matches) == 1 else ""


def source_slide_part(slide: dict[str, Any]) -> str:
    explicit = str(slide.get("sourceSlidePart", ""))
    if is_safe_slide_part(explicit):
        return explicit
    candidates = {
        str(source.get("slidePart", ""))
        for source in slide.get("elementSources", [])
        if isinstance(source, dict)
        and bool(source.get("writable", False))
        and is_safe_slide_part(str(source.get("slidePart", "")))
    }
    return next(iter(candidates)) if len(candidates) == 1 else ""


def route_operations_to_source_parts(
    template_blueprint: dict[str, Any],
    operations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    from app.ai.pptx_ooxml.rendering import (
        int_value,
    )

    slides = [
        slide
        for slide in template_blueprint.get("slides", [])
        if isinstance(slide, dict)
    ]
    routed: list[dict[str, Any]] = []
    for operation in operations:
        if is_safe_slide_part(str(operation.get("sourceSlidePart", ""))):
            routed.append(operation)
            continue
        operation_slide_index = slide_index_from_id(str(operation.get("slideId", "")))
        slide = next(
            (
                candidate
                for candidate in slides
                if int_value(candidate.get("slideIndex"), 0) == operation_slide_index
            ),
            None,
        )
        if slide is None:
            slide = next(
                (
                    candidate
                    for candidate in slides
                    if int_value(candidate.get("sourceSlideIndex"), 0)
                    == operation_slide_index
                ),
                None,
            )
        slide_part = source_slide_part(slide) if slide is not None else ""
        routed.append(
            {**operation, **({"sourceSlidePart": slide_part} if slide_part else {})}
        )
    return routed


def is_safe_slide_part(value: str) -> bool:
    return (
        value.startswith("ppt/slides/slide")
        and value.endswith(".xml")
        and "/" not in value.removeprefix("ppt/slides/")
        and ".." not in value
    )


def is_safe_notes_part(value: str) -> bool:
    return (
        value.startswith("ppt/notesSlides/notesSlide")
        and value.endswith(".xml")
        and "/" not in value.removeprefix("ppt/notesSlides/")
        and ".." not in value
    )


def is_safe_notes_master_part(value: str) -> bool:
    return (
        value.startswith("ppt/notesMasters/notesMaster")
        and value.endswith(".xml")
        and "/" not in value.removeprefix("ppt/notesMasters/")
        and ".." not in value
    )


def is_safe_theme_part(value: str) -> bool:
    return (
        value.startswith("ppt/theme/theme")
        and value.endswith(".xml")
        and "/" not in value.removeprefix("ppt/theme/")
        and ".." not in value
    )


def slide_index_from_id(slide_id: str) -> int:
    from app.ai.pptx_ooxml.rendering import (
        int_value,
    )

    suffix = slide_id.rsplit("_", maxsplit=1)[-1]
    return max(1, int_value(suffix, 1))


def text_shape_element(
    shape_id: int,
    element: dict[str, Any],
    scale: PackageFrameScale,
) -> ET.Element[Any]:
    from app.ai.pptx_ooxml.text import (
        sync_text_shape,
    )

    shape = base_shape_element(shape_id, "Orbit text", element, scale)
    sync_text_shape(
        shape,
        dict_value(element, "props"),
        {
            "elementType": "text",
            "ooxmlOrigin": "authored",
            "ooxmlEditCapabilities": {"richText": "full"},
        },
        scale,
    )
    return shape


def rect_shape_element(
    shape_id: int,
    element: dict[str, Any],
    scale: PackageFrameScale,
) -> ET.Element[Any]:
    from app.ai.pptx_ooxml.shapes import (
        table_border_width_to_emu,
    )

    shape = base_shape_element(shape_id, "Orbit rect", element, scale)
    sp_pr = ensure_shape_properties(shape)
    props = dict_value(element, "props")
    border_radius = float(props.get("borderRadius", 0))
    geometry = ET.SubElement(
        sp_pr,
        f"{{{DML_NS}}}prstGeom",
        {"prst": "roundRect" if border_radius > 0 else "rect"},
    )
    adjustments = ET.SubElement(geometry, f"{{{DML_NS}}}avLst")
    if border_radius > 0:
        shortest_side = min(float(element["width"]), float(element["height"]))
        adjustment = round(min(0.5, border_radius / shortest_side) * 100000)
        ET.SubElement(
            adjustments,
            f"{{{DML_NS}}}gd",
            {"name": "adj", "fmla": f"val {adjustment}"},
        )
    fill = props.get("fill")
    if fill == "transparent":
        ET.SubElement(sp_pr, f"{{{DML_NS}}}noFill")
    elif isinstance(fill, str) and valid_hex_color(fill):
        solid_fill = ET.SubElement(sp_pr, f"{{{DML_NS}}}solidFill")
        ET.SubElement(solid_fill, f"{{{DML_NS}}}srgbClr", {"val": fill[1:]})
    stroke = props.get("stroke", "transparent")
    stroke_width = float(props.get("strokeWidth", 0))
    line = ET.SubElement(
        sp_pr,
        f"{{{DML_NS}}}ln",
        {"w": str(table_border_width_to_emu(stroke_width, scale))},
    )
    if stroke == "transparent" or stroke_width == 0:
        ET.SubElement(line, f"{{{DML_NS}}}noFill")
    elif isinstance(stroke, str) and valid_hex_color(stroke):
        line_fill = ET.SubElement(line, f"{{{DML_NS}}}solidFill")
        ET.SubElement(line_fill, f"{{{DML_NS}}}srgbClr", {"val": stroke[1:]})
    return shape


def update_authored_rect_props(
    shape: ET.Element[Any],
    props: dict[str, Any],
    scale: PackageFrameScale,
) -> bool:
    from app.ai.pptx_ooxml.rendering import (
        int_value,
    )
    from app.ai.pptx_ooxml.shapes import (
        table_border_width_to_emu,
    )

    sp_pr = first_local_child(shape, "spPr")
    if sp_pr is None:
        return False
    if "borderRadius" in props:
        geometry = first_local_child(sp_pr, "prstGeom")
        xfrm = first_local_child(sp_pr, "xfrm")
        ext = first_local_child(xfrm, "ext") if xfrm is not None else None
        if geometry is None or ext is None:
            return False
        border_radius = float(props["borderRadius"])
        geometry.set("prst", "roundRect" if border_radius > 0 else "rect")
        adjustments = first_local_child(geometry, "avLst")
        if adjustments is None:
            adjustments = ET.SubElement(geometry, f"{{{DML_NS}}}avLst")
        adjustments.clear()
        if border_radius > 0:
            width = (
                int_value(ext.get("cx"), 0) * scale.canvas_width / scale.slide_width_emu
            )
            height = (
                int_value(ext.get("cy"), 0)
                * scale.canvas_height
                / scale.slide_height_emu
            )
            if width <= 0 or height <= 0:
                return False
            adjustment = round(min(0.5, border_radius / min(width, height)) * 100000)
            ET.SubElement(
                adjustments,
                f"{{{DML_NS}}}gd",
                {"name": "adj", "fmla": f"val {adjustment}"},
            )
    if "fill" in props:
        for child in list(sp_pr):
            if local_name(child) in {
                "blipFill",
                "gradFill",
                "grpFill",
                "noFill",
                "pattFill",
                "solidFill",
            }:
                sp_pr.remove(child)
        fill = props["fill"]
        fill_node = ET.Element(
            f"{{{DML_NS}}}{'noFill' if fill == 'transparent' else 'solidFill'}"
        )
        if fill != "transparent":
            ET.SubElement(fill_node, f"{{{DML_NS}}}srgbClr", {"val": fill[1:]})
        line = first_local_child(sp_pr, "ln")
        sp_pr.insert(
            list(sp_pr).index(line) if line is not None else len(sp_pr), fill_node
        )
    if "stroke" in props or "strokeWidth" in props:
        line = first_local_child(sp_pr, "ln")
        if line is None:
            line = ET.SubElement(sp_pr, f"{{{DML_NS}}}ln")
        if "strokeWidth" in props:
            line.set(
                "w",
                str(table_border_width_to_emu(props["strokeWidth"], scale)),
            )
        if "stroke" in props:
            for child in list(line):
                if local_name(child) in {
                    "gradFill",
                    "noFill",
                    "pattFill",
                    "solidFill",
                }:
                    line.remove(child)
            stroke = props["stroke"]
            line_fill = ET.Element(
                f"{{{DML_NS}}}{'noFill' if stroke == 'transparent' else 'solidFill'}"
            )
            if stroke != "transparent":
                ET.SubElement(
                    line_fill,
                    f"{{{DML_NS}}}srgbClr",
                    {"val": stroke[1:]},
                )
            line.insert(0, line_fill)
    return True


def picture_shape_element(
    shape_id: int,
    element: dict[str, Any],
    relationship_id: str,
    scale: PackageFrameScale,
    image_size: tuple[int, int] | None,
) -> ET.Element[Any]:
    from app.ai.pptx_ooxml.shapes import (
        update_shape_frame,
    )
    from app.ai.pptx_ooxml.validation import (
        normalized_image_crop,
    )

    picture = ET.Element(P_PIC)
    nv_pic_pr = ET.SubElement(picture, f"{{{PML_NS}}}nvPicPr")
    ET.SubElement(
        nv_pic_pr,
        f"{{{PML_NS}}}cNvPr",
        {"id": str(shape_id), "name": "Orbit image"},
    )
    ET.SubElement(nv_pic_pr, f"{{{PML_NS}}}cNvPicPr")
    ET.SubElement(nv_pic_pr, f"{{{PML_NS}}}nvPr")
    blip_fill = ET.SubElement(picture, f"{{{PML_NS}}}blipFill")
    ET.SubElement(
        blip_fill,
        A_BLIP,
        {f"{{{REL_NS}}}embed": relationship_id},
    )
    stretch = ET.SubElement(blip_fill, f"{{{DML_NS}}}stretch")
    ET.SubElement(stretch, f"{{{DML_NS}}}fillRect")
    sp_pr = ET.SubElement(picture, f"{{{PML_NS}}}spPr")
    update_shape_frame(picture, element, scale)
    frame_size = picture_frame_size(picture)
    if image_size is not None and frame_size is not None:
        set_picture_contain_source_rect(picture, image_size, frame_size)
    crop = normalized_image_crop(dict_value(element, "props").get("crop"))
    if crop is not None:
        set_picture_crop_source_rect(picture, crop)
    ET.SubElement(
        ET.SubElement(sp_pr, f"{{{DML_NS}}}prstGeom", {"prst": "rect"}),
        f"{{{DML_NS}}}avLst",
    )
    return picture


def image_dimensions(image_blob: bytes) -> tuple[int, int] | None:
    try:
        with Image.open(BytesIO(image_blob)) as image:
            width, height = image.size
    except (OSError, SyntaxError, ValueError):
        return None
    if width <= 0 or height <= 0:
        return None
    return int(width), int(height)


def picture_frame_size(shape: ET.Element[Any]) -> tuple[int, int] | None:
    from app.ai.pptx_ooxml.rendering import (
        int_value,
    )

    xfrm = first_local_descendant(shape, "xfrm")
    if xfrm is None:
        return None
    ext = first_local_child(xfrm, "ext")
    if ext is None:
        return None
    width = int_value(ext.get("cx"), 0)
    height = int_value(ext.get("cy"), 0)
    if width <= 0 or height <= 0:
        return None
    return width, height


def set_picture_crop_source_rect(
    shape: ET.Element[Any],
    crop: dict[str, float] | None,
) -> bool:
    from app.ai.pptx_ooxml.media import (
        direct_image_blip_fill,
    )

    blip_fill = direct_image_blip_fill(shape)
    if blip_fill is None:
        return False
    children = list(blip_fill)
    blip_index = next(
        (index for index, child in enumerate(children) if local_name(child) == "blip"),
        -1,
    )
    if blip_index < 0:
        return False
    for child in children:
        if local_name(child) == "srcRect":
            blip_fill.remove(child)
    if crop is None:
        return True

    blip_fill.insert(
        blip_index + 1,
        ET.Element(
            f"{{{DML_NS}}}srcRect",
            crop_source_rect_attributes(crop),
        ),
    )
    return True


def crop_source_rect_attributes(crop: dict[str, float]) -> dict[str, str]:
    values = {
        edge: max(0, min(99_999, round(crop[name] * 100_000)))
        for edge, name in (
            ("l", "left"),
            ("t", "top"),
            ("r", "right"),
            ("b", "bottom"),
        )
    }
    for first, second in (("l", "r"), ("t", "b")):
        overflow = values[first] + values[second] - 99_999
        if overflow > 0:
            reduction = min(values[second], overflow)
            values[second] -= reduction
            values[first] -= overflow - reduction
    return {edge: str(values[edge]) for edge in ("l", "t", "r", "b")}


def set_picture_contain_source_rect(
    picture: ET.Element[Any],
    image_size: tuple[int, int],
    frame_size: tuple[int, int],
) -> None:
    from app.ai.pptx_ooxml.media import (
        direct_image_blip_fill,
    )

    blip_fill = direct_image_blip_fill(picture)
    if blip_fill is None:
        return

    image_width, image_height = image_size
    frame_width, frame_height = frame_size
    image_ratio = image_width / image_height
    frame_ratio = frame_width / frame_height
    attributes: dict[str, str] = {}
    if not math.isclose(image_ratio, frame_ratio, rel_tol=1e-6, abs_tol=1e-9):
        if image_ratio > frame_ratio:
            edge = -round((image_ratio / frame_ratio - 1) * 50_000)
            attributes = {"t": str(edge), "b": str(edge)}
        else:
            edge = -round((frame_ratio / image_ratio - 1) * 50_000)
            attributes = {"l": str(edge), "r": str(edge)}
    if not attributes:
        return

    children = list(blip_fill)
    blip_index = next(
        (index for index, child in enumerate(children) if local_name(child) == "blip"),
        -1,
    )
    blip_fill.insert(
        blip_index + 1,
        ET.Element(f"{{{DML_NS}}}srcRect", attributes),
    )


def valid_hex_color(value: str) -> bool:
    if len(value) != 7 or not value.startswith("#"):
        return False
    try:
        int(value[1:], 16)
    except ValueError:
        return False
    return True


def base_shape_element(
    shape_id: int,
    name: str,
    element: dict[str, Any],
    scale: PackageFrameScale,
) -> ET.Element[Any]:
    from app.ai.pptx_ooxml.shapes import (
        update_shape_frame,
    )

    shape = ET.Element(P_SP)
    nv_sp_pr = ET.SubElement(shape, f"{{{PML_NS}}}nvSpPr")
    ET.SubElement(
        nv_sp_pr,
        f"{{{PML_NS}}}cNvPr",
        {"id": str(shape_id), "name": name},
    )
    ET.SubElement(nv_sp_pr, f"{{{PML_NS}}}cNvSpPr")
    ET.SubElement(nv_sp_pr, f"{{{PML_NS}}}nvPr")
    update_shape_frame(shape, element, scale)
    return shape


def ensure_shape_properties(shape: ET.Element[Any]) -> ET.Element[Any]:
    sp_pr = first_local_child(shape, "spPr")
    if sp_pr is None:
        sp_pr = ET.SubElement(shape, f"{{{PML_NS}}}spPr")
    return sp_pr


def ensure_xfrm(shape: ET.Element[Any]) -> ET.Element[Any]:
    if shape.tag == P_GRAPHIC_FRAME:
        xfrm = first_local_child(shape, "xfrm")
        if xfrm is None:
            non_visual = first_local_child(shape, "nvGraphicFramePr")
            insert_at = (
                list(shape).index(non_visual) + 1 if non_visual is not None else 0
            )
            xfrm = ET.Element(f"{{{PML_NS}}}xfrm")
            shape.insert(insert_at, xfrm)
        return xfrm
    sp_pr = ensure_shape_properties(shape)
    xfrm = first_local_child(sp_pr, "xfrm")
    if xfrm is None:
        xfrm = ET.SubElement(sp_pr, f"{{{DML_NS}}}xfrm")
    return xfrm


def ensure_text_body(shape: ET.Element[Any]) -> ET.Element[Any]:
    tx_body = first_local_child(shape, "txBody")
    if tx_body is None:
        tx_body = ET.SubElement(shape, f"{{{PML_NS}}}txBody")
        ET.SubElement(tx_body, f"{{{DML_NS}}}bodyPr")
        ET.SubElement(tx_body, f"{{{DML_NS}}}lstStyle")
    return tx_body


def frame_to_emu(
    frame: dict[str, Any],
    scale: PackageFrameScale,
) -> tuple[int, int, int, int]:
    return (
        round(float(frame.get("x", 0)) * scale.slide_width_emu / scale.canvas_width),
        round(float(frame.get("y", 0)) * scale.slide_height_emu / scale.canvas_height),
        max(
            1,
            round(
                float(frame.get("width", 1))
                * scale.slide_width_emu
                / scale.canvas_width
            ),
        ),
        max(
            1,
            round(
                float(frame.get("height", 1))
                * scale.slide_height_emu
                / scale.canvas_height
            ),
        ),
    )


def next_c_nv_pr_id(root: ET.Element[Any]) -> int:
    ids = [
        int(node.get("id", "0"))
        for node in root.iter()
        if local_name(node) == "cNvPr" and str(node.get("id", "")).isdigit()
    ]
    return max(ids, default=0) + 1


def dict_value(value: dict[str, Any], key: str) -> dict[str, Any]:
    item = value.get(key)
    return item if isinstance(item, dict) else {}


def first_local_child(element: ET.Element[Any], name: str) -> ET.Element[Any] | None:
    for child in list(element):
        if local_name(child) == name:
            return child
    return None


def direct_local_children(element: ET.Element[Any], name: str) -> list[ET.Element[Any]]:
    return [child for child in list(element) if local_name(child) == name]


def first_local_descendant(
    element: ET.Element[Any], name: str
) -> ET.Element[Any] | None:
    for child in element.iter():
        if local_name(child) == name:
            return child
    return None


def local_name(element: Any) -> str:
    tag = getattr(element, "tag", element)
    return str(tag).rsplit("}", maxsplit=1)[-1]


def scale_slot_bounds(slot: dict[str, Any], scale_x: float, scale_y: float) -> None:
    bounds = slot.get("bounds")
    if not isinstance(bounds, dict):
        return
    bounds["x"] = round(float(bounds.get("x", 0)) * scale_x, 3)
    bounds["y"] = round(float(bounds.get("y", 0)) * scale_y, 3)
    bounds["width"] = max(1, round(float(bounds.get("width", 1)) * scale_x, 3))
    bounds["height"] = max(1, round(float(bounds.get("height", 1)) * scale_y, 3))


def rels_part_for_slide_part(slide_part: str) -> str:
    path, name = slide_part.rsplit("/", maxsplit=1)
    return f"{path}/_rels/{name}.rels"


def append_image_relationship(rels_xml: bytes, target: str) -> tuple[str, bytes]:
    from app.ai.pptx_ooxml.rendering import (
        xml_bytes,
    )

    root = ET.fromstring(rels_xml)
    ids = [
        int(str(child.get("Id", "")).removeprefix("rId"))
        for child in list(root)
        if str(child.get("Id", "")).startswith("rId")
        and str(child.get("Id", "")).removeprefix("rId").isdigit()
    ]
    relationship_id = f"rId{max(ids, default=0) + 1}"
    ET.SubElement(
        root,
        f"{{{PKG_REL_NS}}}Relationship",
        {"Id": relationship_id, "Type": IMAGE_REL_TYPE, "Target": target},
    )
    return relationship_id, xml_bytes(root)


def ensure_content_type_default(
    content_types_xml: bytes,
    extension: str,
    mime_type: str,
) -> bytes:
    from app.ai.pptx_ooxml.rendering import (
        xml_bytes,
    )

    root = ET.fromstring(content_types_xml)
    for child in list(root):
        if child.tag.endswith("Default") and child.get("Extension") == extension:
            return content_types_xml
    ET.SubElement(
        root,
        f"{{{CONTENT_TYPES_NS}}}Default",
        {"Extension": extension, "ContentType": mime_type},
    )
    return xml_bytes(root)
