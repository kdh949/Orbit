from __future__ import annotations


import math

import posixpath


import zipfile


from typing import Any

from xml.etree import ElementTree as ET


from app.ai.authored_element_rasterizer import (
    AUTHORED_RASTER_ELEMENT_TYPES,
    AuthoredElementRasterizationError,
    RasterizedAuthoredElement,
)


from typing import TYPE_CHECKING

from app.ai.pptx_ooxml.common import (
    PML_NS,
    P_GRAPHIC_FRAME,
    P_PIC,
    P_SP,
    PptxOoxmlUnsupportedReasonCode,
    REL_NS,
    SUPPORTED_TABLE_PROPS,
    SUPPORTED_TEXT_PROPS,
)

if TYPE_CHECKING:
    from app.ai.pptx_ooxml.models import (
        PackageFrameScale,
    )


def apply_sync_operation(
    operation: dict[str, Any],
    sources: dict[tuple[str, str], dict[str, Any]],
    package_entries: dict[str, bytes],
    added_entries: dict[str, bytes],
    updated_sources: dict[tuple[str, str], dict[str, Any]],
    scale: PackageFrameScale,
    warnings: list[str],
    source_package: zipfile.ZipFile,
    template_blueprint: dict[str, Any],
    fallback_theme: dict[str, Any],
    fallback_elements: dict[tuple[str, str], dict[str, Any]],
    raster_cache: dict[tuple[str, str], RasterizedAuthoredElement],
) -> PptxOoxmlUnsupportedReasonCode | None:
    from app.ai.pptx_ooxml.import_capabilities import (
        rasterized_fallback_candidate,
    )
    from app.ai.pptx_ooxml.media import (
        find_shape_by_id,
        has_group_shape_ancestor,
        set_picture_opacity,
        set_shape_visibility,
        update_shape_props,
    )
    from app.ai.pptx_ooxml.notes import (
        update_speaker_notes_body,
    )
    from app.ai.pptx_ooxml.rendering import (
        xml_bytes,
    )
    from app.ai.pptx_ooxml.routing import (
        dict_value,
        slide_part_for_operation,
    )
    from app.ai.pptx_ooxml.shapes import (
        add_authored_slide_to_package,
        add_element_to_slide_xml,
        add_rasterized_element_to_slide_xml,
        reorder_visual_shape,
        replace_rasterized_picture,
        resize_authored_table_tracks_to_frame,
        update_shape_frame,
    )
    from app.ai.pptx_ooxml.validation import (
        operation_element_id,
    )

    operation_type = str(operation.get("type", ""))
    if operation_type == "add_slide":
        added_sources, reason_code = add_authored_slide_to_package(
            operation,
            package_entries,
            added_entries,
            scale,
            warnings,
            source_package,
            template_blueprint,
            fallback_theme,
            fallback_elements,
            raster_cache,
        )
        if reason_code is not None:
            return reason_code
        for added_source in added_sources:
            added_key = (
                str(added_source["slidePart"]),
                str(added_source["elementId"]),
            )
            sources[added_key] = added_source
            updated_sources[added_key] = added_source
        return None
    if operation_type == "reorder_slides":
        return reorder_presentation_slides(
            operation,
            package_entries,
            source_package,
            template_blueprint,
        )
    if operation_type == "delete_slide":
        return delete_presentation_slide(
            operation,
            sources,
            updated_sources,
            package_entries,
            source_package,
            template_blueprint,
        )
    if operation_type == "update_speaker_notes":
        return update_speaker_notes_body(
            operation,
            package_entries,
            added_entries,
            template_blueprint,
            source_package,
        )
    element_id = operation_element_id(operation)
    operation_slide_part = slide_part_for_operation(
        operation,
        template_blueprint,
    )

    if operation_type == "add_element":
        element = operation.get("element")
        if not isinstance(element, dict):
            return "ADD_ELEMENT_FAILED"
        if not operation_slide_part or operation_slide_part not in package_entries:
            return "SLIDE_PART_MISSING"
        element_type = str(element.get("type", ""))
        if element_type in AUTHORED_RASTER_ELEMENT_TYPES:
            try:
                rendered = rasterized_fallback_candidate(
                    str(operation.get("slideId", "")),
                    str(element.get("elementId", "")),
                    fallback_theme,
                    fallback_elements,
                    raster_cache,
                )
            except AuthoredElementRasterizationError:
                return "AUTHORED_RASTER_FALLBACK_FAILED"
            if rendered is None:
                return "AUTHORED_RASTER_FALLBACK_FAILED"
            element_source = add_rasterized_element_to_slide_xml(
                operation_slide_part,
                element,
                rendered,
                package_entries,
                added_entries,
                scale,
                warnings,
            )
            if element_source is None:
                return "AUTHORED_RASTER_FALLBACK_FAILED"
            added_key = (
                str(element_source["slidePart"]),
                str(element_source["elementId"]),
            )
            sources[added_key] = element_source
            updated_sources[added_key] = element_source
            return None
        if element_type not in {"text", "rect", "image", "table"}:
            return "ADD_ELEMENT_TYPE_UNSUPPORTED"
        if add_element_has_unsupported_props(element):
            return "PROPS_FIELDS_UNSUPPORTED"
        element_source = add_element_to_slide_xml(
            operation_slide_part,
            element,
            package_entries,
            added_entries,
            scale,
            warnings,
        )
        if element_source is None:
            return "ADD_ELEMENT_FAILED"
        added_key = (
            str(element_source["slidePart"]),
            str(element_source["elementId"]),
        )
        sources[added_key] = element_source
        updated_sources[added_key] = element_source
        return None

    source_key = (operation_slide_part, element_id)
    source = sources.get(source_key)
    if not source:
        warnings.append(f"OOXML source missing for {element_id}.")
        return "SOURCE_MISSING"
    if not bool(source.get("writable", False)):
        warnings.append(f"OOXML source is locked for {element_id}.")
        return "SOURCE_NOT_WRITABLE"
    if source.get("ooxmlOrigin") not in {"imported", "authored"}:
        warnings.append(f"OOXML source provenance is unsafe for {element_id}.")
        return "SOURCE_PROVENANCE_UNSAFE"

    slide_part = str(source.get("slidePart", ""))
    slide_xml = package_entries.get(slide_part)
    if slide_xml is None:
        warnings.append(f"OOXML slide part missing for {element_id}.")
        return "SLIDE_PART_MISSING"

    root = ET.fromstring(slide_xml)
    shape, parent = find_shape_by_id(root, str(source.get("shapeId", "")))
    if shape is None:
        warnings.append(f"OOXML shape missing for {element_id}.")
        return "SHAPE_MISSING"

    shape_changed = False
    if source.get("fallbackMode") == "rasterized" and operation_type in {
        "update_element_props",
        "update_element_frame",
    }:
        try:
            rendered = rasterized_fallback_candidate(
                str(operation.get("slideId", "")),
                element_id,
                fallback_theme,
                fallback_elements,
                raster_cache,
            )
        except AuthoredElementRasterizationError:
            return "AUTHORED_RASTER_FALLBACK_FAILED"
        if rendered is None or not replace_rasterized_picture(
            shape,
            source,
            slide_part,
            rendered,
            package_entries,
            added_entries,
            source_package,
            scale,
        ):
            return "AUTHORED_RASTER_FALLBACK_FAILED"
        if parent is None or not reorder_visual_shape(
            parent,
            shape,
            fallback_elements[(str(operation.get("slideId", "")), element_id)].get(
                "zIndex",
                0,
            ),
        ):
            return "AUTHORED_RASTER_FALLBACK_FAILED"
        package_entries[slide_part] = xml_bytes(root)
        updated_sources[source_key] = dict(source)
        return None
    if operation_type == "update_element_props":
        props = operation.get("props")
        if not isinstance(props, dict) or not props:
            return "PROPS_FIELDS_UNSUPPORTED"
        source_shape_cohort_size = sum(
            1
            for candidate in sources.values()
            if str(candidate.get("slidePart", "")) == slide_part
            and str(candidate.get("shapeId", "")) == str(source.get("shapeId", ""))
        )
        props_reason = validate_source_props_update(
            source,
            shape,
            props,
            scale,
            source_package,
            source_shape_cohort_size,
        )
        if props_reason is not None:
            return props_reason
        shape_changed = update_shape_props(
            shape,
            props,
            source,
            scale,
            slide_part,
            package_entries,
            added_entries,
            updated_sources,
            source_key,
            warnings,
            element_id,
        )
        if not shape_changed:
            return "PROPS_UPDATE_FAILED"
    elif operation_type == "update_element_frame":
        frame = operation.get("frame")
        if not isinstance(frame, dict) or not frame:
            return "FRAME_FIELDS_UNSUPPORTED"
        if set(frame) - {
            "role",
            "x",
            "y",
            "width",
            "height",
            "rotation",
            "opacity",
            "zIndex",
            "locked",
            "visible",
        }:
            return "FRAME_FIELDS_UNSUPPORTED"
        opacity = frame.get("opacity", 1)
        if (
            isinstance(opacity, bool)
            or not isinstance(opacity, (int, float))
            or not math.isfinite(float(opacity))
            or not 0 <= float(opacity) <= 1
        ):
            return "FRAME_FIELDS_UNSUPPORTED"
        visible = frame.get("visible", True)
        if not isinstance(visible, bool):
            return "FRAME_FIELDS_UNSUPPORTED"
        geometry_fields = set(frame) & {"x", "y", "width", "height", "rotation"}
        if geometry_fields and has_group_shape_ancestor(root, shape):
            warnings.append(f"OOXML grouped frame sync skipped for {element_id}.")
            return "GROUPED_FRAME_UNSUPPORTED"
        capabilities = dict_value(source, "ooxmlEditCapabilities")
        source_shape_cohort_size = sum(
            1
            for candidate in sources.values()
            if str(candidate.get("slidePart", "")) == slide_part
            and str(candidate.get("shapeId", "")) == str(source.get("shapeId", ""))
        )
        safe_legacy_imported_frame = (
            source.get("ooxmlOrigin") == "imported"
            and source_shape_cohort_size == 1
            and source.get("elementType") != "table"
            and not has_group_shape_ancestor(root, shape)
        )
        if (
            source.get("ooxmlOrigin") == "imported"
            and not capabilities.get("frame")
            and not safe_legacy_imported_frame
        ):
            return "FRAME_FIELDS_UNSUPPORTED"
        if geometry_fields:
            update_shape_frame(shape, frame, scale)
            if (
                source.get("elementType") == "table"
                and source.get("ooxmlOrigin") == "authored"
                and not resize_authored_table_tracks_to_frame(shape)
            ):
                return "TABLE_STRUCTURE_UNSUPPORTED"
            shape_changed = True
        if "opacity" in frame and float(opacity) != 1:
            if source.get("elementType") != "image" or not set_picture_opacity(
                shape,
                source,
                float(opacity),
            ):
                return "FRAME_FIELDS_UNSUPPORTED"
            shape_changed = True
        elif "opacity" in frame and source.get("elementType") == "image":
            if not set_picture_opacity(shape, source, 1):
                return "FRAME_FIELDS_UNSUPPORTED"
            shape_changed = True
        if "visible" in frame:
            if not set_shape_visibility(shape, visible):
                return "FRAME_FIELDS_UNSUPPORTED"
            shape_changed = True
        if "zIndex" in frame:
            if parent is None or not reorder_visual_shape(
                parent,
                shape,
                frame["zIndex"],
            ):
                return "FRAME_FIELDS_UNSUPPORTED"
            shape_changed = True
    elif operation_type == "delete_element":
        if parent is not None:
            parent.remove(shape)
            remove_shape_sources(
                sources,
                updated_sources,
                slide_part,
                str(source.get("shapeId", "")),
            )
            shape_changed = True
    else:
        return "OPERATION_TYPE_UNSUPPORTED"

    if shape_changed:
        package_entries[slide_part] = xml_bytes(root)
    return None


def remove_shape_sources(
    sources: dict[tuple[str, str], dict[str, Any]],
    updated_sources: dict[tuple[str, str], dict[str, Any]],
    slide_part: str,
    shape_id: str,
) -> None:
    removed_keys = [
        source_key
        for source_key, candidate in sources.items()
        if str(candidate.get("slidePart", "")) == slide_part
        and str(candidate.get("shapeId", "")) == shape_id
    ]
    for source_key in removed_keys:
        sources.pop(source_key, None)
        updated_sources.pop(source_key, None)


def reorder_presentation_slides(
    operation: dict[str, Any],
    package_entries: dict[str, bytes],
    source_package: zipfile.ZipFile,
    template_blueprint: dict[str, Any],
) -> PptxOoxmlUnsupportedReasonCode | None:
    from app.ai.pptx_ooxml.rendering import (
        xml_bytes,
    )

    raw_slide_orders = operation.get("slideOrders")
    if not isinstance(raw_slide_orders, list) or not raw_slide_orders:
        return "SLIDE_REORDER_PERMUTATION_INVALID"

    blueprint_locators: dict[str, str] = {}
    blueprint_parts: set[str] = set()
    for raw_blueprint_slide in template_blueprint.get("slides", []):
        if not isinstance(raw_blueprint_slide, dict):
            return "SLIDE_REORDER_LOCATOR_UNSAFE"
        slide_id = raw_blueprint_slide.get("slideId")
        source_slide_part = raw_blueprint_slide.get("sourceSlidePart")
        if (
            not isinstance(slide_id, str)
            or not slide_id
            or not isinstance(source_slide_part, str)
            or not source_slide_part
        ):
            return "SLIDE_REORDER_LOCATOR_UNSAFE"
        if slide_id in blueprint_locators or source_slide_part in blueprint_parts:
            return "SLIDE_REORDER_LOCATOR_UNSAFE"
        blueprint_locators[slide_id] = source_slide_part
        blueprint_parts.add(source_slide_part)

    requested: list[tuple[int, str, str]] = []
    for raw_slide_order in raw_slide_orders:
        if not isinstance(raw_slide_order, dict):
            return "SLIDE_REORDER_PERMUTATION_INVALID"
        slide_id = raw_slide_order.get("slideId")
        order = raw_slide_order.get("order")
        source_slide_part = raw_slide_order.get("sourceSlidePart")
        if (
            not isinstance(slide_id, str)
            or not slide_id
            or not isinstance(order, int)
            or isinstance(order, bool)
        ):
            return "SLIDE_REORDER_PERMUTATION_INVALID"
        if not isinstance(source_slide_part, str) or not source_slide_part:
            return "SLIDE_REORDER_LOCATOR_UNSAFE"
        requested.append((order, slide_id, source_slide_part))

    requested_orders = [item[0] for item in requested]
    requested_ids = [item[1] for item in requested]
    expected_orders = set(range(1, len(requested) + 1))
    if (
        len(set(requested_ids)) != len(requested_ids)
        or set(requested_orders) != expected_orders
    ):
        return "SLIDE_REORDER_PERMUTATION_INVALID"
    if any(blueprint_locators.get(item[1]) != item[2] for item in requested):
        return "SLIDE_REORDER_LOCATOR_UNSAFE"

    presentation_xml = package_entries.get("ppt/presentation.xml")
    presentation_rels_xml = package_entries.get("ppt/_rels/presentation.xml.rels")
    if presentation_xml is None or presentation_rels_xml is None:
        return "SLIDE_REORDER_RELATIONSHIP_UNSAFE"

    try:
        presentation_root = ET.fromstring(presentation_xml)
        relationships_root = ET.fromstring(presentation_rels_xml)
    except ET.ParseError:
        return "SLIDE_REORDER_RELATIONSHIP_UNSAFE"

    slide_id_list = presentation_root.find(f"{{{PML_NS}}}sldIdLst")
    if slide_id_list is None:
        return "SLIDE_REORDER_RELATIONSHIP_UNSAFE"
    slide_id_nodes = list(slide_id_list)
    if not slide_id_nodes or any(
        node.tag != f"{{{PML_NS}}}sldId" for node in slide_id_nodes
    ):
        return "SLIDE_REORDER_RELATIONSHIP_UNSAFE"

    relationships_by_id: dict[str, ET.Element[Any]] = {}
    for relationship in relationships_root:
        relationship_id = str(relationship.get("Id", ""))
        if not relationship_id or relationship_id in relationships_by_id:
            return "SLIDE_REORDER_RELATIONSHIP_UNSAFE"
        relationships_by_id[relationship_id] = relationship

    slide_nodes_by_part: dict[str, ET.Element[Any]] = {}
    source_names = set(source_package.namelist())
    for slide_id_node in slide_id_nodes:
        relationship_id = str(slide_id_node.get(f"{{{REL_NS}}}id", ""))
        mapped_relationship = relationships_by_id.get(relationship_id)
        if mapped_relationship is None:
            return "SLIDE_REORDER_RELATIONSHIP_UNSAFE"
        target = str(mapped_relationship.get("Target", ""))
        slide_part = resolve_relationship_part("ppt/presentation.xml", target)
        if (
            not slide_part.startswith("ppt/slides/")
            or (slide_part not in source_names and slide_part not in package_entries)
            or slide_part in slide_nodes_by_part
        ):
            return "SLIDE_REORDER_RELATIONSHIP_UNSAFE"
        slide_nodes_by_part[slide_part] = slide_id_node

    requested_parts = [item[2] for item in sorted(requested)]
    if len(requested_parts) != len(slide_id_nodes):
        return "SLIDE_REORDER_PERMUTATION_INVALID"
    if len(set(requested_parts)) != len(requested_parts) or set(requested_parts) != set(
        slide_nodes_by_part
    ):
        return "SLIDE_REORDER_LOCATOR_UNSAFE"

    slide_id_list[:] = [slide_nodes_by_part[part] for part in requested_parts]
    package_entries["ppt/presentation.xml"] = xml_bytes(presentation_root)
    return None


def delete_presentation_slide(
    operation: dict[str, Any],
    sources: dict[tuple[str, str], dict[str, Any]],
    updated_sources: dict[tuple[str, str], dict[str, Any]],
    package_entries: dict[str, bytes],
    source_package: zipfile.ZipFile,
    template_blueprint: dict[str, Any],
) -> PptxOoxmlUnsupportedReasonCode | None:
    from app.ai.pptx_ooxml.rendering import (
        xml_bytes,
    )
    from app.ai.pptx_ooxml.routing import (
        is_safe_slide_part,
        slide_part_for_operation,
    )
    from app.ai.pptx_ooxml.validation import (
        operation_slide_id,
    )

    slide_id = operation_slide_id(operation)
    slide_part = slide_part_for_operation(operation, template_blueprint)
    if not slide_id or not is_safe_slide_part(slide_part):
        return "DELETE_SLIDE_LOCATOR_UNSAFE"
    matching_blueprint_parts = [
        str(slide.get("sourceSlidePart", ""))
        for slide in template_blueprint.get("slides", [])
        if isinstance(slide, dict) and slide.get("slideId") == slide_id
    ]
    if matching_blueprint_parts != [slide_part]:
        return "DELETE_SLIDE_LOCATOR_UNSAFE"

    presentation_xml = package_entries.get("ppt/presentation.xml")
    presentation_rels_xml = package_entries.get("ppt/_rels/presentation.xml.rels")
    content_types_xml = package_entries.get("[Content_Types].xml")
    if presentation_xml is None or presentation_rels_xml is None:
        return "DELETE_SLIDE_RELATIONSHIP_UNSAFE"
    try:
        presentation_root = ET.fromstring(presentation_xml)
        relationships_root = ET.fromstring(presentation_rels_xml)
        content_types_root = (
            ET.fromstring(content_types_xml) if content_types_xml is not None else None
        )
    except ET.ParseError:
        return "DELETE_SLIDE_RELATIONSHIP_UNSAFE"

    slide_id_list = presentation_root.find(f"{{{PML_NS}}}sldIdLst")
    if slide_id_list is None:
        return "DELETE_SLIDE_RELATIONSHIP_UNSAFE"
    slide_id_nodes = list(slide_id_list)
    if len(slide_id_nodes) <= 1:
        return "LAST_SLIDE_DELETE_FORBIDDEN"
    relationships_by_id = {
        str(relationship.get("Id", "")): relationship
        for relationship in relationships_root
        if relationship.get("Id")
    }
    matching_nodes: list[tuple[ET.Element[Any], ET.Element[Any]]] = []
    for slide_id_node in slide_id_nodes:
        relationship_id = str(slide_id_node.get(f"{{{REL_NS}}}id", ""))
        relationship = relationships_by_id.get(relationship_id)
        if relationship is None:
            return "DELETE_SLIDE_RELATIONSHIP_UNSAFE"
        target = str(relationship.get("Target", ""))
        if resolve_relationship_part("ppt/presentation.xml", target) == slide_part:
            matching_nodes.append((slide_id_node, relationship))
    if len(matching_nodes) != 1 or slide_part not in source_package.namelist():
        return "DELETE_SLIDE_RELATIONSHIP_UNSAFE"

    slide_id_node, relationship = matching_nodes[0]
    slide_id_list.remove(slide_id_node)
    relationships_root.remove(relationship)
    if content_types_root is not None:
        part_name = f"/{slide_part}"
        for child in list(content_types_root):
            if child.tag.endswith("Override") and child.get("PartName") == part_name:
                content_types_root.remove(child)

    removed_source_keys = [
        key
        for key, source in sources.items()
        if str(source.get("slidePart", "")) == slide_part
    ]
    for key in removed_source_keys:
        sources.pop(key, None)
        updated_sources.pop(key, None)
    package_entries["ppt/presentation.xml"] = xml_bytes(presentation_root)
    package_entries["ppt/_rels/presentation.xml.rels"] = xml_bytes(relationships_root)
    if content_types_root is not None:
        package_entries["[Content_Types].xml"] = xml_bytes(content_types_root)
    return None


def resolve_relationship_part(source_part: str, target: str) -> str:
    if target.startswith("/"):
        return posixpath.normpath(target).lstrip("/")
    return posixpath.normpath(posixpath.join(posixpath.dirname(source_part), target))


def add_element_has_unsupported_props(element: dict[str, Any]) -> bool:
    from app.ai.pptx_ooxml.routing import (
        dict_value,
    )
    from app.ai.pptx_ooxml.validation import (
        normalized_image_crop,
        valid_rect_props,
        valid_table_props,
        valid_text_props,
    )

    props = dict_value(element, "props")
    element_type = str(element.get("type", ""))
    if (
        float(element.get("opacity", 1)) != 1
        or bool(element.get("locked", False))
        or not bool(element.get("visible", True))
        or float(element.get("rotation", 0)) != 0
    ):
        return True
    if element_type == "text":
        return not valid_text_props(props)
    if element_type == "rect":
        return not valid_rect_props(props)
    if element_type == "image":
        crop = props.get("crop")
        return (
            set(props) - {"src", "alt", "fit", "focusX", "focusY", "crop"} != set()
            or ("crop" in props and normalized_image_crop(crop) is None)
            or props.get("fit", "contain") != "contain"
            or float(props.get("focusX", 0.5)) != 0.5
            or float(props.get("focusY", 0.5)) != 0.5
        )
    if element_type == "table":
        return not valid_table_props(props)
    return True


def validate_source_props_update(
    source: dict[str, Any],
    shape: ET.Element[Any],
    props: dict[str, Any],
    scale: PackageFrameScale,
    source_package: zipfile.ZipFile,
    source_shape_cohort_size: int,
) -> PptxOoxmlUnsupportedReasonCode | None:
    from app.ai.pptx_ooxml.import_capabilities import (
        rich_text_capability_for_shape,
        table_cell_text_capability_for_shape,
    )
    from app.ai.pptx_ooxml.media import (
        image_crop_capability_for_shape,
    )
    from app.ai.pptx_ooxml.routing import (
        dict_value,
        first_local_child,
    )
    from app.ai.pptx_ooxml.text import (
        style_only_paragraphs_match,
    )
    from app.ai.pptx_ooxml.validation import (
        canonical_text_paragraphs,
        canonical_text_value,
        normalized_image_crop,
        text_body_value,
        text_props_has_content_projection,
        valid_rect_props,
        valid_table_props,
        valid_text_props,
        validate_imported_table_props_update,
    )

    prop_names = set(props)
    element_type = str(source.get("elementType", ""))
    if prop_names and prop_names.issubset(
        {"fill", "stroke", "strokeWidth", "borderRadius"}
    ):
        if (
            element_type != "rect"
            or shape.tag != P_SP
            or source.get("ooxmlOrigin") != "authored"
        ):
            return "ELEMENT_TYPE_MISMATCH"
        return None if valid_rect_props(props) else "PROPS_FIELDS_UNSUPPORTED"
    if prop_names and prop_names.issubset(SUPPORTED_TABLE_PROPS):
        if element_type != "table" or shape.tag != P_GRAPHIC_FRAME:
            return "ELEMENT_TYPE_MISMATCH"
        declared_capability = dict_value(source, "ooxmlEditCapabilities").get(
            "tableCellText"
        )
        if (
            declared_capability is not True
            or source_shape_cohort_size != 1
            or not table_cell_text_capability_for_shape(shape, source)
        ):
            return "TABLE_CELL_CAPABILITY_UNSAFE"
        if not valid_table_props(props):
            return "TABLE_STRUCTURE_UNSUPPORTED"
        if source.get("ooxmlOrigin") == "authored":
            return None
        if source.get("ooxmlOrigin") != "imported":
            return "TABLE_CELL_CAPABILITY_UNSAFE"
        return validate_imported_table_props_update(
            shape,
            props,
            scale,
            source_package,
        )
    if prop_names and prop_names.issubset(SUPPORTED_TEXT_PROPS):
        if element_type != "text" or shape.tag != P_SP:
            return "ELEMENT_TYPE_MISMATCH"
        if not valid_text_props(props):
            return "PROPS_FIELDS_UNSUPPORTED"
        capability = dict_value(source, "ooxmlEditCapabilities").get("richText")
        actual_capability = rich_text_capability_for_shape(shape)
        if capability not in {"full", "style-only"} or capability != actual_capability:
            return "RICH_TEXT_CAPABILITY_UNSAFE"
        if capability == "style-only":
            if text_props_has_content_projection(props):
                target_text = canonical_text_value(props)
                if target_text is None or target_text != text_body_value(shape):
                    return "RICH_TEXT_CAPABILITY_UNSAFE"
            if set(props) != {"text"} and text_props_has_content_projection(props):
                target = canonical_text_paragraphs(props)
                body = first_local_child(shape, "txBody")
                if (
                    body is None
                    or target is None
                    or not style_only_paragraphs_match(body, target)
                ):
                    return "RICH_TEXT_CAPABILITY_UNSAFE"
        return None
    if prop_names and prop_names.issubset({"src", "alt", "crop"}):
        capabilities = dict_value(source, "ooxmlEditCapabilities")
        if element_type != "image":
            return "ELEMENT_TYPE_MISMATCH"
        if {"src", "alt"}.intersection(prop_names) and (
            shape.tag != P_PIC
            or source.get("ooxmlOrigin") == "imported"
            and not capabilities.get("imageSource")
        ):
            return "ELEMENT_TYPE_MISMATCH"
        if "crop" in props:
            crop = props.get("crop")
            if crop is not None and normalized_image_crop(crop) is None:
                return "PROPS_FIELDS_UNSUPPORTED"
            capability = capabilities.get("crop")
            expected_capability = image_crop_capability_for_shape(shape, source)
            if capability != expected_capability or capability == "none":
                return "CROP_CAPABILITY_UNSAFE"
        return None
    return "PROPS_FIELDS_UNSUPPORTED"
