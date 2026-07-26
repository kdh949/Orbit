from __future__ import annotations

import base64

import binascii

import copy


from io import BytesIO

from pathlib import Path


from typing import Any

from xml.etree import ElementTree as ET

from PIL import Image


from app.ai.pptx_ooxml_vector_importer import (
    direct_graphic_frame_table,
    table_cell_locators,
)


from typing import TYPE_CHECKING

from app.ai.pptx_ooxml.common import (
    A_BLIP,
    A_T,
    DML_NS,
    IMAGE_REL_TYPE,
    P_GRAPHIC_FRAME,
    P_PIC,
    P_SP,
    REL_NS,
)

if TYPE_CHECKING:
    from app.ai.pptx_ooxml.models import (
        PackageFrameScale,
        PptxOoxmlUnsupportedOperation,
    )


def motion_reference_failure(
    operations: list[dict[str, Any]],
    template_blueprint: dict[str, Any],
    slide_motion: list[dict[str, Any]],
) -> PptxOoxmlUnsupportedOperation | None:
    from app.ai.pptx_ooxml.routing import (
        dict_value,
        slide_part_for_operation,
        source_slide_part,
    )
    from app.ai.pptx_ooxml.validation import (
        unsupported_operation,
    )

    coverage_by_slide_part = {
        source_slide_part(slide): str(
            dict_value(slide, "ooxmlMotionCapabilities").get(
                "importedMainSequenceCoverage",
                "unknown",
            )
        )
        for slide in template_blueprint.get("slides", [])
        if isinstance(slide, dict) and source_slide_part(slide)
    }
    animation_replacement_parts = {
        str(item.get("sourceSlidePart", ""))
        for item in slide_motion
        if isinstance(item, dict)
        and isinstance(item.get("touched"), dict)
        and item["touched"].get("animations") is True
    }
    for operation in operations:
        if operation.get("type") != "delete_element":
            continue
        slide_part = slide_part_for_operation(operation, template_blueprint)
        if slide_part in animation_replacement_parts:
            continue
        if coverage_by_slide_part.get(slide_part, "unknown") != "absent":
            return unsupported_operation(
                operation,
                "MOTION_REFERENCE_COVERAGE_UNSAFE",
            )
    return None


def find_shape_by_id(
    root: ET.Element[Any], shape_id: str
) -> tuple[ET.Element[Any] | None, ET.Element[Any] | None]:
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
    )

    for parent in root.iter():
        for child in list(parent):
            if child.tag not in {P_SP, P_PIC, P_GRAPHIC_FRAME}:
                continue
            non_visual_name = {
                P_SP: "nvSpPr",
                P_PIC: "nvPicPr",
                P_GRAPHIC_FRAME: "nvGraphicFramePr",
            }[child.tag]
            non_visual = first_local_child(child, non_visual_name)
            c_nv_pr = (
                first_local_child(non_visual, "cNvPr")
                if non_visual is not None
                else None
            )
            if c_nv_pr is not None and c_nv_pr.get("id") == shape_id:
                return child, parent
    return None, None


def direct_image_blip_fill(shape: ET.Element[Any] | None) -> ET.Element[Any] | None:
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
    )

    if shape is None:
        return None
    if shape.tag == P_PIC:
        return first_local_child(shape, "blipFill")
    if shape.tag == P_SP:
        shape_properties = first_local_child(shape, "spPr")
        if shape_properties is not None:
            return first_local_child(shape_properties, "blipFill")
    return None


def direct_image_blip(
    shape: ET.Element[Any] | None,
    source: dict[str, Any],
) -> ET.Element[Any] | None:
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
    )

    blip_fill = direct_image_blip_fill(shape)
    if blip_fill is None:
        return None
    blip = first_local_child(blip_fill, "blip")
    expected_relationship_id = str(source.get("relationshipId", ""))
    current_relationship_id = (
        str(blip.get(f"{{{REL_NS}}}embed", "")) if blip is not None else ""
    )
    if (
        not expected_relationship_id
        or current_relationship_id != expected_relationship_id
    ):
        return None
    return blip


def set_picture_opacity(
    shape: ET.Element[Any],
    source: dict[str, Any],
    opacity: float,
) -> bool:
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
        local_name,
    )

    blip = direct_image_blip(shape, source)
    if blip is None:
        return False
    for child in list(blip):
        if local_name(child) == "alphaModFix":
            blip.remove(child)
    if opacity < 1:
        alpha = ET.Element(
            f"{{{DML_NS}}}alphaModFix",
            {"amt": str(round(opacity * 100000))},
        )
        extension_list = first_local_child(blip, "extLst")
        if extension_list is None:
            blip.append(alpha)
        else:
            blip.insert(list(blip).index(extension_list), alpha)
    return True


def set_shape_visibility(shape: ET.Element[Any], visible: bool) -> bool:
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
    )

    non_visual_name = {
        P_SP: "nvSpPr",
        P_PIC: "nvPicPr",
        P_GRAPHIC_FRAME: "nvGraphicFramePr",
    }.get(shape.tag)
    if non_visual_name is None:
        return False
    non_visual = first_local_child(shape, non_visual_name)
    c_nv_pr = first_local_child(non_visual, "cNvPr") if non_visual is not None else None
    if c_nv_pr is None:
        return False
    if visible:
        c_nv_pr.attrib.pop("hidden", None)
    else:
        c_nv_pr.set("hidden", "1")
    return True


def image_crop_capability_for_shape(
    shape: ET.Element[Any],
    source: dict[str, Any],
) -> str:
    if direct_image_blip(shape, source) is None:
        return "none"
    if shape.tag == P_PIC:
        return "picture"
    if shape.tag == P_SP:
        return "picture-fill"
    return "none"


def has_group_shape_ancestor(root: ET.Element[Any], shape: ET.Element[Any]) -> bool:
    from app.ai.pptx_ooxml.routing import (
        local_name,
    )

    parents = {child: parent for parent in root.iter() for child in list(parent)}
    parent = parents.get(shape)
    while parent is not None:
        if local_name(parent) == "grpSp":
            return True
        parent = parents.get(parent)
    return False


def update_shape_props(
    shape: ET.Element[Any],
    props: dict[str, Any],
    source: dict[str, Any],
    scale: PackageFrameScale,
    slide_part: str,
    package_entries: dict[str, bytes],
    added_entries: dict[str, bytes],
    updated_sources: dict[tuple[str, str], dict[str, Any]],
    source_key: tuple[str, str],
    warnings: list[str],
    element_id: str,
) -> bool:
    from app.ai.pptx_ooxml.routing import (
        set_picture_crop_source_rect,
        update_authored_rect_props,
    )
    from app.ai.pptx_ooxml.shapes import (
        replace_authored_table_subtree,
    )
    from app.ai.pptx_ooxml.text import (
        sync_text_shape,
    )
    from app.ai.pptx_ooxml.validation import (
        normalized_image_crop,
    )

    changed = False
    if source.get("elementType") == "rect":
        return update_authored_rect_props(shape, props, scale)
    if source.get("elementType") == "table":
        if source.get("ooxmlOrigin") == "imported":
            changed = sync_imported_table_cell_text(shape, props)
        else:
            changed = replace_authored_table_subtree(shape, props, scale)
        if not changed or not refresh_table_source_locators(shape, source):
            warnings.append(f"OOXML table sync skipped for {element_id}.")
            return False
        updated_sources[source_key] = dict(source)
        return True
    if source.get("elementType") == "text":
        return sync_text_shape(shape, props, source, scale)
    if "src" in props:
        if source.get("fallbackReason"):
            warnings.append(f"OOXML fallback source preserved for {element_id}.")
            return False
        replacement = decode_image_data_url(props.get("src"))
        if isinstance(replacement, str):
            warnings.append(
                f"OOXML image sync skipped for {element_id}: {replacement}."
            )
            return False
        mime_type, image_blob = replacement
        relationship_id = replace_picture_media_relationship(
            shape,
            source,
            slide_part,
            mime_type,
            image_blob,
            package_entries,
            added_entries,
            warnings,
            element_id,
        )
        if relationship_id is None:
            return False
        source["relationshipId"] = relationship_id
        updated_sources[source_key] = dict(source)
        changed = True
    if "crop" in props:
        crop_value = props.get("crop")
        crop = normalized_image_crop(crop_value) if crop_value is not None else None
        if not set_picture_crop_source_rect(shape, crop):
            warnings.append(f"OOXML image crop target missing for {element_id}.")
            return False
        changed = True
    if changed:
        return True
    warnings.append(f"OOXML prop sync skipped for {element_id}.")
    return False


def sync_imported_table_cell_text(
    shape: ET.Element[Any],
    props: dict[str, Any],
) -> bool:
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
    )

    table = direct_graphic_frame_table(shape)
    target_rows = props.get("rows")
    if table is None or not isinstance(target_rows, list):
        return False
    changed_cell: tuple[ET.Element[Any], str] | None = None
    rows = direct_local_children(table, "tr")
    for row_index, row in enumerate(rows):
        cells = direct_local_children(row, "tc")
        if row_index >= len(target_rows) or not isinstance(
            target_rows[row_index], list
        ):
            return False
        for column_index, cell in enumerate(cells):
            target_cell = target_rows[row_index][column_index]
            if not isinstance(target_cell, dict):
                return False
            target_text = str(target_cell.get("text", ""))
            if target_text == table_cell_text_value(cell):
                continue
            if changed_cell is not None or not table_cell_text_can_set(
                cell, target_text
            ):
                return False
            changed_cell = (cell, target_text)
    if changed_cell is None:
        return False
    cell, target_text = changed_cell
    return set_table_cell_text_value(cell, target_text)


def table_cell_text_value(cell: ET.Element[Any]) -> str:
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
        first_local_child,
    )
    from app.ai.pptx_ooxml.text import (
        text_run_value,
    )

    body = first_local_child(cell, "txBody")
    if body is None:
        return ""
    return "\n".join(
        "".join(text_run_value(run) for run in direct_local_children(paragraph, "r"))
        for paragraph in direct_local_children(body, "p")
    )


def table_cell_text_can_set(cell: ET.Element[Any], value: str) -> bool:
    from app.ai.pptx_ooxml.import_capabilities import (
        table_cell_text_body_is_safe,
    )
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
        first_local_child,
    )

    body = first_local_child(cell, "txBody")
    return (
        body is not None
        and table_cell_text_body_is_safe(cell)
        and len(value.split("\n")) == len(direct_local_children(body, "p"))
    )


def set_table_cell_text_value(cell: ET.Element[Any], value: str) -> bool:
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
        first_local_child,
    )
    from app.ai.pptx_ooxml.text import (
        set_text_node_value,
    )

    if not table_cell_text_can_set(cell, value):
        return False
    body = first_local_child(cell, "txBody")
    if body is None:
        return False
    for paragraph, paragraph_text in zip(
        direct_local_children(body, "p"),
        value.split("\n"),
        strict=True,
    ):
        runs = direct_local_children(paragraph, "r")
        if runs:
            text_node = first_local_child(runs[0], "t")
            if text_node is None:
                return False
            set_text_node_value(text_node, paragraph_text)
            continue
        if not paragraph_text:
            continue
        run = ET.Element(f"{{{DML_NS}}}r")
        end_properties = first_local_child(paragraph, "endParaRPr")
        if end_properties is not None:
            run_properties = copy.deepcopy(end_properties)
            run_properties.tag = f"{{{DML_NS}}}rPr"
            run.append(run_properties)
        ET.SubElement(run, A_T)
        text_node = first_local_child(run, "t")
        if text_node is None:
            return False
        set_text_node_value(text_node, paragraph_text)
        insert_at = (
            list(paragraph).index(end_properties)
            if end_properties is not None
            else len(paragraph)
        )
        paragraph.insert(insert_at, run)
    return True


def refresh_table_source_locators(
    shape: ET.Element[Any],
    source: dict[str, Any],
) -> bool:
    from app.ai.pptx_ooxml.import_capabilities import (
        table_cell_text_capability_for_shape,
    )
    from app.ai.pptx_ooxml.routing import (
        dict_value,
    )

    locators, diagnostics = table_cell_locators(
        shape,
        slide_index=0,
        shape_id=str(source.get("shapeId", "")),
    )
    if diagnostics or not locators:
        return False
    source["tableCellLocators"] = locators
    capabilities = dict_value(source, "ooxmlEditCapabilities")
    capabilities["tableCellText"] = table_cell_text_capability_for_shape(shape, source)
    source["ooxmlEditCapabilities"] = capabilities
    return capabilities["tableCellText"] is True


def decode_image_data_url(value: Any) -> tuple[str, bytes] | str:
    if not isinstance(value, str):
        return "invalid data URL"
    header, separator, payload = value.partition(",")
    if not separator or not header.lower().startswith("data:"):
        return "invalid data URL"
    if not header.lower().endswith(";base64"):
        return "invalid data URL"

    mime_type = header[5:-7].lower()
    expected_format = {
        "image/png": "PNG",
        "image/jpeg": "JPEG",
        "image/gif": "GIF",
        "image/webp": "WEBP",
    }.get(mime_type)
    if expected_format is None:
        return f"unsupported MIME type {mime_type or 'unknown'}"

    try:
        image_blob = base64.b64decode(payload, validate=True)
        with Image.open(BytesIO(image_blob)) as image:
            image.verify()
            actual_format = str(image.format or "").upper()
    except (binascii.Error, OSError, SyntaxError, ValueError):
        return "invalid image data"
    if actual_format != expected_format:
        return f"image data does not match {mime_type}"
    return mime_type, image_blob


def replace_picture_media_relationship(
    shape: ET.Element[Any],
    source: dict[str, Any],
    slide_part: str,
    mime_type: str,
    image_blob: bytes,
    package_entries: dict[str, bytes],
    added_entries: dict[str, bytes],
    warnings: list[str],
    element_id: str,
) -> str | None:
    from app.ai.pptx_ooxml.rendering import (
        extension_for_mime_type,
    )
    from app.ai.pptx_ooxml.routing import (
        append_image_relationship,
        ensure_content_type_default,
        rels_part_for_slide_part,
    )

    if shape.tag != P_PIC:
        warnings.append(f"OOXML image source is not a picture for {element_id}.")
        return None

    blip = next(shape.iter(A_BLIP), None)
    expected_relationship_id = str(source.get("relationshipId", ""))
    current_relationship_id = (
        str(blip.get(f"{{{REL_NS}}}embed", "")) if blip is not None else ""
    )
    if (
        blip is None
        or not expected_relationship_id
        or current_relationship_id != expected_relationship_id
    ):
        warnings.append(f"OOXML image relationship mismatch for {element_id}.")
        return None

    rels_part = rels_part_for_slide_part(slide_part)
    rels_xml = package_entries.get(rels_part)
    content_types_xml = package_entries.get("[Content_Types].xml")
    if rels_xml is None or not is_image_relationship(
        rels_xml, expected_relationship_id
    ):
        warnings.append(f"OOXML image relationship missing for {element_id}.")
        return None
    if content_types_xml is None:
        warnings.append(f"OOXML content types missing for {element_id}.")
        return None

    extension = extension_for_mime_type(mime_type)
    media_token = safe_package_token(
        f"{Path(slide_part).stem}_{source.get('shapeId', 'image')}"
    )
    media_name = f"orbit_sync_{media_token}.{extension}"
    media_part = f"ppt/media/{media_name}"
    relationship_id, next_rels_xml = append_image_relationship(
        rels_xml,
        f"../media/{media_name}",
    )

    blip.set(f"{{{REL_NS}}}embed", relationship_id)
    package_entries[rels_part] = next_rels_xml
    package_entries["[Content_Types].xml"] = ensure_content_type_default(
        content_types_xml,
        extension,
        mime_type,
    )
    added_entries[media_part] = image_blob
    return relationship_id


def is_image_relationship(rels_xml: bytes, relationship_id: str) -> bool:
    root = ET.fromstring(rels_xml)
    return any(
        child.get("Id") == relationship_id and child.get("Type") == IMAGE_REL_TYPE
        for child in list(root)
    )


def safe_package_token(value: str) -> str:
    token = "".join(
        char if char.isascii() and (char.isalnum() or char in "_-") else "_"
        for char in value
    )
    return token or "image"
