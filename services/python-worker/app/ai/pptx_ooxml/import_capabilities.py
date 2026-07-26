from __future__ import annotations


import copy


import json


import zipfile


from io import BytesIO

from pathlib import Path


from typing import Any, cast

from xml.etree import ElementTree as ET


from pptx import Presentation


from app.ai.authored_element_rasterizer import (
    AUTHORED_RASTER_ELEMENT_TYPES,
    AuthoredElementRasterizationError,
    RasterizedAuthoredElement,
    rasterize_authored_element,
)

from app.ai.pptx_design_importer import (
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
)

from app.ai.pptx_ooxml_vector_importer import (
    direct_graphic_frame_table,
    table_cell_locators,
)

from app.ai.pptx_motion import (
    parse_slide_motion,
)


from typing import TYPE_CHECKING

from app.ai.pptx_ooxml.common import (
    P_GRAPHIC_FRAME,
    P_SP,
    PptxOoxmlMotionCoverage,
)

if TYPE_CHECKING:
    from app.ai.pptx_ooxml.models import (
        CanvasSpec,
    )


def detect_canvas(path: Path) -> CanvasSpec:
    from app.ai.pptx_ooxml.models import (
        CanvasSpec,
        UnsupportedPptxAspectRatioError,
    )

    presentation = Presentation(str(path))
    width = max(1, int(presentation.slide_width or 1))
    height = max(1, int(presentation.slide_height or 1))
    ratio = width / height
    if abs(ratio - (16 / 9)) <= 0.02:
        return CanvasSpec("wide-16-9", 1920, 1080, "16:9")
    if abs(ratio - (4 / 3)) <= 0.02:
        return CanvasSpec("standard-4-3", 1024, 768, "4:3")
    raise UnsupportedPptxAspectRatioError(
        f"Unsupported PPTX aspect ratio {width}:{height}. Only 16:9 and 4:3 are supported."
    )


def prepare_template_blueprint(
    template_blueprint: dict[str, Any],
    canvas: CanvasSpec,
    *,
    source_file_id: str,
    source_canvas: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.ai.pptx_ooxml.rendering import (
        int_value,
        safe_id_component,
    )
    from app.ai.pptx_ooxml.routing import (
        scale_slot_bounds,
    )

    prepared = cast(dict[str, Any], json.loads(json.dumps(template_blueprint)))
    prepared["sourcePackageFileId"] = source_file_id
    prepared["currentPackageFileId"] = "asset:current_package"
    source_canvas = source_canvas or {}
    scale_x = canvas.width / int_value(source_canvas.get("width"), CANVAS_WIDTH)
    scale_y = canvas.height / int_value(source_canvas.get("height"), CANVAS_HEIGHT)

    for slide in prepared.get("slides", []):
        if not isinstance(slide, dict):
            continue
        slide_index = int_value(
            slide.get("sourceSlideIndex"),
            int_value(slide.get("slideIndex"), 1),
        )
        slide_part = str(slide.get("sourceSlidePart", ""))
        if not slide_part:
            continue
        slide.setdefault(
            "slideId",
            f"slide_ooxml_{safe_id_component(source_file_id)}_{slide_index}",
        )
        slide["renderAssetFileId"] = f"asset:slide_render_{slide_index}"
        for slot_index, slot in enumerate(slide.get("slots", []), start=1):
            if not isinstance(slot, dict):
                continue
            scale_slot_bounds(slot, scale_x, scale_y)
            if slot.get("usage") == "media-slot":
                slot["replaceMode"] = "replace"
                slot["confidence"] = max(0.65, float(slot.get("confidence", 0)))
            source = slot.setdefault("source", {})
            if isinstance(source, dict):
                source.setdefault("slidePart", slide_part)
                source.setdefault("shapeId", str(slot_index))
    return prepared


def add_imported_ooxml_capabilities(
    blueprint: dict[str, Any],
    template_blueprint: dict[str, Any],
    package_bytes: bytes,
) -> None:
    from app.ai.pptx_ooxml.rendering import (
        int_value,
    )
    from app.ai.pptx_ooxml.routing import (
        dict_value,
    )

    blueprint_slides = {
        int_value(slide.get("sourceSlideIndex"), index + 1): slide
        for index, slide in enumerate(blueprint.get("slides", []))
        if isinstance(slide, dict)
    }

    try:
        package = zipfile.ZipFile(BytesIO(package_bytes), "r")
    except (OSError, zipfile.BadZipFile):
        package = None

    try:
        for index, slide in enumerate(template_blueprint.get("slides", [])):
            if not isinstance(slide, dict):
                continue
            source_slide_index = int_value(
                slide.get("sourceSlideIndex"),
                int_value(slide.get("slideIndex"), index + 1),
            )
            slide_part = str(slide.get("sourceSlidePart", ""))
            if not slide_part:
                continue
            slide["ooxmlOrigin"] = "imported"
            existing_motion_capabilities = dict_value(
                slide,
                "ooxmlMotionCapabilities",
            )
            existing_coverage = str(
                existing_motion_capabilities.get(
                    "importedMainSequenceCoverage",
                    "",
                )
            )
            motion_coverage = (
                existing_coverage
                if existing_coverage in {"unknown", "absent", "partial", "complete"}
                else imported_main_sequence_coverage(package, slide_part)
            )
            slide["ooxmlMotionCapabilities"] = {
                "transitionWritable": imported_slide_root(package, slide_part)
                is not None,
                "importedMainSequenceCoverage": motion_coverage,
            }

            blueprint_slide = blueprint_slides.get(source_slide_index, {})
            if isinstance(blueprint_slide, dict):
                blueprint_slide["ooxmlOrigin"] = "imported"
                blueprint_slide["ooxmlSourceSlidePart"] = slide_part
                blueprint_slide["ooxmlMotionCapabilities"] = copy.deepcopy(
                    slide["ooxmlMotionCapabilities"]
                )

            element_types = {
                str(element.get("elementId", "")): str(element.get("type", ""))
                for element in blueprint_slide.get("elements", [])
                if isinstance(element, dict)
            }
            element_sources = [
                source
                for source in slide.get("elementSources", [])
                if isinstance(source, dict)
            ]
            shape_cohort_sizes: dict[tuple[str, str], int] = {}
            for source in element_sources:
                cohort_key = (
                    str(source.get("slidePart", "")),
                    str(source.get("shapeId", "")),
                )
                if all(cohort_key):
                    shape_cohort_sizes[cohort_key] = (
                        shape_cohort_sizes.get(cohort_key, 0) + 1
                    )

            slide_root = imported_slide_root(package, slide_part)
            for source in element_sources:
                element_type = element_types.get(str(source.get("elementId", "")), "")
                if element_type:
                    source["elementType"] = element_type
                source["ooxmlOrigin"] = "imported"
                source["ooxmlEditCapabilities"] = imported_element_capabilities(
                    element_type,
                    source,
                    slide_root,
                    shape_cohort_sizes.get(
                        (
                            str(source.get("slidePart", "")),
                            str(source.get("shapeId", "")),
                        ),
                        0,
                    ),
                )
    finally:
        if package is not None:
            package.close()


def imported_slide_root(
    package: zipfile.ZipFile | None,
    slide_part: str,
) -> ET.Element[Any] | None:
    if package is None or not slide_part:
        return None
    try:
        return ET.fromstring(package.read(slide_part))
    except (KeyError, ET.ParseError, OSError):
        return None


def imported_main_sequence_coverage(
    package: zipfile.ZipFile | None,
    slide_part: str,
) -> PptxOoxmlMotionCoverage:
    root = imported_slide_root(package, slide_part)
    if root is None:
        return "unknown"
    motion = parse_slide_motion(root, slide_index=1, shape_targets={})
    if motion.coverage == "absent":
        return "absent"
    return "partial" if motion.coverage == "complete" else motion.coverage


def imported_element_capabilities(
    element_type: str,
    source: dict[str, Any],
    slide_root: ET.Element[Any] | None,
    shape_cohort_size: int,
) -> dict[str, Any]:
    from app.ai.pptx_ooxml.media import (
        direct_image_blip,
        find_shape_by_id,
        has_group_shape_ancestor,
    )

    frame_writable = False
    image_source_writable = False
    delete_writable = False
    crop_capability = "none"
    rich_text_capability = "none"
    table_cell_text_writable = False
    if slide_root is not None and bool(source.get("writable", False)):
        shape, _parent = find_shape_by_id(
            slide_root,
            str(source.get("shapeId", "")),
        )
        frame_writable = (
            shape_cohort_size == 1
            and shape is not None
            and not has_group_shape_ancestor(slide_root, shape)
            and element_type != "table"
        )
        delete_writable = (
            shape_cohort_size == 1
            and shape is not None
            and not has_group_shape_ancestor(slide_root, shape)
            and not source.get("fallbackReason")
            and element_type != "table"
        )
        crop_capability = imported_image_crop_capability(
            element_type,
            source,
            shape,
        )
        image_source_writable = (
            crop_capability == "picture"
            and direct_image_blip(shape, source) is not None
        )
        if (
            element_type == "text"
            and shape is not None
            and not source.get("fallbackReason")
        ):
            rich_text_capability = rich_text_capability_for_shape(shape)
        table_cell_text_writable = (
            shape_cohort_size == 1
            and element_type == "table"
            and shape is not None
            and not source.get("fallbackReason")
            and table_cell_text_capability_for_shape(shape, source)
        )
    return {
        "richText": rich_text_capability,
        "crop": crop_capability,
        "tableCellText": table_cell_text_writable,
        "frame": frame_writable,
        "delete": delete_writable,
        "imageSource": image_source_writable,
    }


def table_cell_text_capability_for_shape(
    shape: ET.Element[Any],
    source: dict[str, Any],
) -> bool:
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
    )

    if (
        shape.tag != P_GRAPHIC_FRAME
        or str(source.get("sourceType", "")) != "table"
        or not bool(source.get("writable", False))
        or source.get("fallbackReason")
    ):
        return False
    locators, diagnostics = table_cell_locators(
        shape,
        slide_index=0,
        shape_id=str(source.get("shapeId", "")),
    )
    declared_locators = source.get("tableCellLocators")
    if diagnostics or not locators or declared_locators != locators:
        return False
    table = direct_graphic_frame_table(shape)
    return table is not None and all(
        table_cell_text_body_is_safe(cell)
        for row in direct_local_children(table, "tr")
        for cell in direct_local_children(row, "tc")
    )


def table_cell_text_body_is_safe(cell: ET.Element[Any]) -> bool:
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
        first_local_child,
        first_local_descendant,
        local_name,
    )

    body = first_local_child(cell, "txBody")
    if body is None:
        return False
    paragraphs = direct_local_children(body, "p")
    if not paragraphs:
        return False
    if any(
        local_name(child) not in {"bodyPr", "lstStyle", "p", "extLst"}
        for child in list(body)
    ):
        return False
    for paragraph in paragraphs:
        if any(
            local_name(child) not in {"pPr", "r", "endParaRPr"}
            for child in list(paragraph)
        ):
            return False
        runs = direct_local_children(paragraph, "r")
        if len(runs) > 1:
            return False
        if not runs:
            continue
        run = runs[0]
        if any(local_name(child) not in {"rPr", "t"} for child in list(run)):
            return False
        if len(direct_local_children(run, "t")) != 1:
            return False
        if (
            first_local_descendant(run, "hlinkClick") is not None
            or first_local_descendant(run, "hlinkMouseOver") is not None
        ):
            return False
    return True


def rich_text_capability_for_shape(shape: ET.Element[Any]) -> str:
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
        first_local_descendant,
        local_name,
    )

    if shape.tag != P_SP:
        return "none"
    body = first_local_child(shape, "txBody")
    if body is None:
        return "none"

    capability = "full"
    for child in list(body):
        child_name = local_name(child)
        if child_name in {"bodyPr", "lstStyle", "extLst"}:
            continue
        if child_name != "p":
            return "none"
        for paragraph_child in list(child):
            paragraph_child_name = local_name(paragraph_child)
            if paragraph_child_name == "fld":
                return "none"
            if paragraph_child_name not in {"pPr", "r", "br", "endParaRPr"}:
                return "none"
            if paragraph_child_name in {"r", "br"}:
                allowed = {"rPr", "t"} if paragraph_child_name == "r" else {"rPr"}
                if any(local_name(item) not in allowed for item in paragraph_child):
                    return "none"
                if (
                    paragraph_child_name == "r"
                    and sum(local_name(item) == "t" for item in paragraph_child) != 1
                ):
                    return "none"
            if first_local_descendant(paragraph_child, "hlinkClick") is not None:
                capability = "style-only"
            if first_local_descendant(paragraph_child, "hlinkMouseOver") is not None:
                capability = "style-only"
    return capability


def imported_image_crop_capability(
    element_type: str,
    source: dict[str, Any],
    shape: ET.Element[Any] | None,
) -> str:
    from app.ai.pptx_ooxml.media import (
        image_crop_capability_for_shape,
    )

    if (
        element_type != "image"
        or shape is None
        or not bool(source.get("writable", False))
        or source.get("fallbackReason")
    ):
        return "none"
    return image_crop_capability_for_shape(shape, source)


def authored_raster_fallback_map(
    payload: dict[str, Any],
) -> tuple[dict[str, Any], dict[tuple[str, str], dict[str, Any]]]:
    if not payload:
        return {}, {}
    theme = payload.get("theme")
    raw_elements = payload.get("elements")
    if not isinstance(theme, dict) or not isinstance(raw_elements, list):
        raise AuthoredElementRasterizationError("FALLBACK_PAYLOAD_INVALID")
    if len(raw_elements) > 500:
        raise AuthoredElementRasterizationError("FALLBACK_PAYLOAD_INVALID")
    elements: dict[tuple[str, str], dict[str, Any]] = {}
    for raw_candidate in raw_elements:
        if not isinstance(raw_candidate, dict):
            raise AuthoredElementRasterizationError("FALLBACK_PAYLOAD_INVALID")
        slide_id = raw_candidate.get("slideId")
        element = raw_candidate.get("element")
        if (
            not isinstance(slide_id, str)
            or not slide_id
            or not isinstance(element, dict)
            or str(element.get("type", "")) not in AUTHORED_RASTER_ELEMENT_TYPES
        ):
            raise AuthoredElementRasterizationError("FALLBACK_PAYLOAD_INVALID")
        element_id = element.get("elementId")
        if not isinstance(element_id, str) or not element_id:
            raise AuthoredElementRasterizationError("FALLBACK_PAYLOAD_INVALID")
        key = (slide_id, element_id)
        if key in elements:
            raise AuthoredElementRasterizationError("FALLBACK_PAYLOAD_INVALID")
        elements[key] = element
    return cast(dict[str, Any], theme), elements


def rasterized_fallback_candidate(
    slide_id: str,
    element_id: str,
    theme: dict[str, Any],
    elements: dict[tuple[str, str], dict[str, Any]],
    cache: dict[tuple[str, str], RasterizedAuthoredElement],
) -> RasterizedAuthoredElement | None:
    key = (slide_id, element_id)
    if key in cache:
        return cache[key]
    element = elements.get(key)
    if element is None:
        return None
    rendered = rasterize_authored_element(element, theme)
    cache[key] = rendered
    return rendered
