from __future__ import annotations

import base64
import copy
import hashlib
import math
import os
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from app.ai.pptx_design_importer import (
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    ImportedDesignAsset,
    ImportedDesignBlueprint,
    PptxDesignImportResult,
    apply_repeated_text_roles,
    attach_pptx_speaker_notes,
    assign_text_roles,
    average_image_color,
    build_quality_report,
    build_template_blueprint,
    imported_slide_style,
    imported_theme,
    import_pptx_design,
    preset_custom_shape_path,
)
from app.ai.pptx_motion import (
    main_sequence_node,
    parse_slide_motion,
    supported_main_sequence_shape_ids,
)
from app.ai.pptx_package_security import inspect_pptx_package

from app.ai.pptx_vector_import.models import (
    OoxmlImportState,
    OoxmlScale as OoxmlScale,
    OoxmlTextCascade,
    OoxmlTextStyleContext,
    OoxmlThemeFonts,
    OoxmlThemeStyles,
)

from app.ai.pptx_vector_import.constants import (
    PML_NS as PML_NS,
    DML_NS,
    REL_NS as REL_NS,
    PKG_REL_NS as PKG_REL_NS,
    CONTENT_TYPES_NS as CONTENT_TYPES_NS,
    ORBIT_OOXML_NS as ORBIT_OOXML_NS,
    TABLE_GRAPHIC_DATA_URI,
    SLIDE_REL_TYPE as SLIDE_REL_TYPE,
    SLIDE_LAYOUT_REL_TYPE,
    SLIDE_MASTER_REL_TYPE,
    IMAGE_REL_TYPE as IMAGE_REL_TYPE,
    THEME_REL_TYPE as THEME_REL_TYPE,
    VECTOR_IMPORT_FLAG,
    DEFAULT_TEXT_BODY_HORIZONTAL_INSET_EMU,
    DEFAULT_TEXT_BODY_VERTICAL_INSET_EMU,
    DEFAULT_PPTX_FONT_FAMILY,
    PPTX_FONT_BROWSER_FALLBACK,
    PPTX_FONT_FAMILY_ALIASES,
    PPTX_BROWSER_AVAILABLE_FONT_FAMILIES,
    RICH_TEXT_UNSUPPORTED_HYPERLINK,
    TABLE_STRUCTURE_UNSUPPORTED,
    TABLE_TRACK_MISMATCH,
    MAX_TABLE_CELL_LOCATORS,
    MAX_MOTION_DIAGNOSTIC_DETAILS,
    FALLBACK_SCHEME_COLORS,
    SCHEME_COLOR_ALIASES,
)

from app.ai.pptx_vector_import.xml_utils import (
    presentation_slide_parts,
    presentation_size_emu,
    slide_shows_master_shapes,
    theme_color_map as theme_color_map,
    theme_font_scheme,
    theme_font_value as theme_font_value,
    theme_style_matrix,
    presentation_theme_part as presentation_theme_part,
    first_theme_part as first_theme_part,
    theme_color_value as theme_color_value,
    apply_color_transforms,
    clamp_rgb as clamp_rgb,
    relationships_for_part,
    relationship_target_by_type,
    relationship_is_external,
    rels_path_for_part as rels_path_for_part,
    resolve_part_path,
    read_xml,
    content_type_map,
    mime_type_for_part,
    extension_for_mime_type,
    is_svg_mime_type,
    is_full_canvas_frame,
    first_local_descendant,
    first_local_child,
    direct_local_children,
    local_name,
    int_attr,
    int_value,
    attr_by_local_name,
    safe_id,
)

def import_pptx_design_with_optional_ooxml_vector(
    path: Path,
    file_id: str,
    *,
    canvas_width: int = CANVAS_WIDTH,
    canvas_height: int = CANVAS_HEIGHT,
) -> PptxDesignImportResult:
    inspect_pptx_package(path.read_bytes())
    if ooxml_vector_import_disabled():
        return import_pptx_design(
            path,
            file_id,
            canvas_width=canvas_width,
            canvas_height=canvas_height,
        )

    try:
        return import_pptx_ooxml_visual_tree(
            path,
            file_id,
            canvas_width=canvas_width,
            canvas_height=canvas_height,
        )
    except Exception as error:
        fallback = import_pptx_design(
            path,
            file_id,
            canvas_width=canvas_width,
            canvas_height=canvas_height,
        )
        warning = f"OOXML visual tree importer failed; python-pptx fallback used: {error}"
        fallback.warnings.insert(0, warning)
        fallback.blueprint.setdefault("warnings", fallback.warnings)
        if isinstance(fallback.blueprint["warnings"], list):
            fallback.blueprint["warnings"].insert(0, warning)
        return fallback


def ooxml_vector_import_disabled() -> bool:
    return os.getenv(VECTOR_IMPORT_FLAG, "true").strip().lower() in {
        "0",
        "false",
        "no",
        "off",
    }


@dataclass(frozen=True)
class OoxmlTransform:
    scale_x: float = 1
    scale_y: float = 1
    translate_x: float = 0
    translate_y: float = 0

    def rect(
        self,
        x: int,
        y: int,
        width: int,
        height: int,
    ) -> tuple[float, float, float, float]:
        return (
            self.scale_x * x + self.translate_x,
            self.scale_y * y + self.translate_y,
            self.scale_x * width,
            self.scale_y * height,
        )

    def for_group(self, group: ET.Element[Any]) -> OoxmlTransform:
        xfrm = first_local_descendant(group, "xfrm")
        if xfrm is None:
            return self

        off = first_local_child(xfrm, "off")
        ext = first_local_child(xfrm, "ext")
        child_off = first_local_child(xfrm, "chOff")
        child_ext = first_local_child(xfrm, "chExt")
        off_x = int_attr(off, "x", 0)
        off_y = int_attr(off, "y", 0)
        ext_x = int_attr(ext, "cx", 1)
        ext_y = int_attr(ext, "cy", 1)
        child_x = int_attr(child_off, "x", 0)
        child_y = int_attr(child_off, "y", 0)
        child_width = int_attr(child_ext, "cx", ext_x)
        child_height = int_attr(child_ext, "cy", ext_y)
        ratio_x = ext_x / max(1, child_width)
        ratio_y = ext_y / max(1, child_height)
        local = OoxmlTransform(
            scale_x=ratio_x,
            scale_y=ratio_y,
            translate_x=off_x - child_x * ratio_x,
            translate_y=off_y - child_y * ratio_y,
        )
        return OoxmlTransform(
            scale_x=self.scale_x * local.scale_x,
            scale_y=self.scale_y * local.scale_y,
            translate_x=self.scale_x * local.translate_x + self.translate_x,
            translate_y=self.scale_y * local.translate_y + self.translate_y,
        )


def import_pptx_ooxml_visual_tree(
    path: Path,
    file_id: str,
    *,
    canvas_width: int = CANVAS_WIDTH,
    canvas_height: int = CANVAS_HEIGHT,
) -> PptxDesignImportResult:
    canvas_width = max(1, int(canvas_width))
    canvas_height = max(1, int(canvas_height))

    with zipfile.ZipFile(path, "r") as package:
        slide_width, slide_height = presentation_size_emu(package)
        scale = OoxmlScale(
            canvas_width=canvas_width,
            canvas_height=canvas_height,
            slide_width_emu=slide_width,
            slide_height_emu=slide_height,
        )
        slide_parts = presentation_slide_parts(package)
        content_types = content_type_map(package)
        state = OoxmlImportState(
            assets=[],
            asset_ids_by_content_hash={},
            asset_colors={},
            theme_colors=theme_color_map(package),
            theme_fonts=theme_font_scheme(package),
            theme_styles=theme_style_matrix(package),
            warnings=[],
        )
        slides: list[dict[str, Any]] = []
        slot_sources_by_slide: list[dict[str, dict[str, Any]]] = []
        motion_diagnostics: list[dict[str, Any]] = []

        for slide_index, slide_part in enumerate(slide_parts, start=1):
            slide = read_xml(package, slide_part)
            if slide is None:
                state.warnings.append(f"OOXML slide part missing: {slide_part}")
                continue
            append_font_availability_diagnostics(
                slide,
                state.warnings,
                slide_index=slide_index,
            )
            slide_rels = relationships_for_part(package, slide_part)
            layout_part = relationship_target_by_type(
                slide_part,
                slide_rels,
                SLIDE_LAYOUT_REL_TYPE,
            )
            layout = read_xml(package, layout_part) if layout_part else None
            layout_rels = (
                relationships_for_part(package, layout_part) if layout_part else {}
            )
            master_part = (
                relationship_target_by_type(
                    layout_part,
                    layout_rels,
                    SLIDE_MASTER_REL_TYPE,
                )
                if layout_part
                else None
            )
            master = read_xml(package, master_part) if master_part else None
            state.text_style_context = OoxmlTextStyleContext(
                layout=layout,
                master=master,
                theme_fonts=state.theme_fonts,
            )
            placeholder_frames = placeholder_frame_map(layout, scale)
            elements: list[dict[str, Any]] = [
                background_element(slide_index, canvas_width, canvas_height)
            ]
            slot_sources: dict[str, dict[str, Any]] = {}

            for source_name, part, root in (
                ("master", master_part, master),
                ("layout", layout_part, layout),
                ("slide", slide_part, slide),
            ):
                if part is None or root is None:
                    continue
                if source_name == "master" and not slide_shows_master_shapes(slide):
                    continue
                append_visual_tree(
                    package=package,
                    content_types=content_types,
                    part_path=part,
                    root=root,
                    slide_index=slide_index,
                    source_name=source_name,
                    scale=scale,
                    transform=OoxmlTransform(),
                    state=state,
                    elements=elements,
                    slot_sources=slot_sources,
                    placeholder_frames=placeholder_frames,
                    locked=source_name != "slide",
                )

            shape_targets = animation_shape_targets(
                slide,
                slide_index=slide_index,
                slide_part=slide_part,
                elements=elements,
                slot_sources=slot_sources,
            )
            motion = parse_slide_motion(
                slide,
                slide_index=slide_index,
                shape_targets=shape_targets,
            )
            motion_diagnostics.extend(motion.diagnostics)

            assign_text_roles(
                elements,
                slot_sources,
                slide_index=slide_index,
                slide_count=len(slide_parts),
            )
            background = slide_background_color(slide, state.theme_colors) or "#FFFFFF"
            slide_payload: dict[str, Any] = {
                "sourceFileId": file_id,
                "sourceSlideIndex": slide_index,
                "sourceSlidePart": slide_part,
                "style": imported_slide_style(elements, background),
                "elements": elements,
                "animations": motion.animations,
                "ooxmlMotionCapabilities": {
                    "transitionWritable": True,
                    "importedMainSequenceCoverage": motion.coverage,
                },
                "motionDiagnostics": motion.diagnostics,
            }
            if motion.transition is not None:
                slide_payload["transition"] = motion.transition
            slides.append(slide_payload)
            slot_sources_by_slide.append(slot_sources)

        apply_repeated_text_roles(slides, slot_sources_by_slide)
        blueprint = ImportedDesignBlueprint.model_validate(
            {
                "sourceFileId": file_id,
                "canvas": {
                    "width": canvas_width,
                    "height": canvas_height,
                },
                "theme": imported_theme(slides),
                "slides": slides,
                "warnings": state.warnings,
            }
        )
        template_blueprint = build_template_blueprint(
            file_id,
            slides,
            slot_sources_by_slide,
        )
        copy_table_cell_locators_to_blueprint(
            template_blueprint,
            slot_sources_by_slide,
        )
        copy_animation_group_sources_to_blueprint(
            template_blueprint,
            slides,
            slot_sources_by_slide,
        )
        blueprint_payload = blueprint.model_dump(by_alias=True)
        for payload_slide, source_slide in zip(
            blueprint_payload.get("slides", []),
            slides,
            strict=True,
        ):
            for field in (
                "animations",
                "transition",
                "ooxmlMotionCapabilities",
                "motionDiagnostics",
            ):
                if field in source_slide:
                    payload_slide[field] = copy.deepcopy(source_slide[field])
        for template_slide, source_slide in zip(
            template_blueprint.get("slides", []),
            slides,
            strict=True,
        ):
            template_slide["ooxmlMotionCapabilities"] = copy.deepcopy(
                source_slide["ooxmlMotionCapabilities"]
            )
        quality_report = build_quality_report(slides, state.warnings)
        quality_report["motionDiagnostics"] = motion_diagnostic_summary(
            motion_diagnostics
        )
        attach_pptx_speaker_notes(
            path,
            blueprint_payload,
            template_blueprint,
            quality_report,
        )
        return PptxDesignImportResult(
            blueprint=blueprint_payload,
            templateBlueprint=template_blueprint,
            qualityReport=quality_report,
            assets=state.assets,
            warnings=state.warnings,
        )


def motion_diagnostic_summary(
    diagnostics: list[dict[str, Any]],
) -> dict[str, Any]:
    categorized: list[tuple[int, str, str]] = []
    for diagnostic in diagnostics:
        code = str(diagnostic.get("code", ""))
        slide_index = int(diagnostic.get("slideIndex", 0) or 0)
        if slide_index <= 0:
            continue
        if "UNSUPPORTED" in code:
            category = "unsupported"
        elif "DOWNGRADED" in code:
            category = "downgraded"
        elif "UNRESOLVED" in code or code.endswith("SOURCE_UNAVAILABLE"):
            category = "unresolved"
        elif "EXCLUDED" in code:
            category = "excluded"
        else:
            continue
        categorized.append((slide_index, code, category))

    counts = {
        category: sum(item_category == category for _, _, item_category in categorized)
        for category in ("unsupported", "downgraded", "unresolved", "excluded")
    }
    detail_counts: dict[tuple[int, str], int] = {}
    for slide_index, code, _ in categorized:
        key = (slide_index, code)
        detail_counts[key] = detail_counts.get(key, 0) + 1
    details = [
        {"slideIndex": slide_index, "code": code, "count": count}
        for (slide_index, code), count in sorted(detail_counts.items())
    ]
    return {
        "total": sum(counts.values()),
        **counts,
        "details": details if len(details) <= MAX_MOTION_DIAGNOSTIC_DETAILS else [],
    }


def animation_shape_targets(
    slide_root: ET.Element[Any],
    *,
    slide_index: int,
    slide_part: str,
    elements: list[dict[str, Any]],
    slot_sources: dict[str, dict[str, Any]],
) -> dict[str, str]:
    timing = first_local_child(slide_root, "timing")
    main_sequence = main_sequence_node(timing) if timing is not None else None
    if main_sequence is None:
        return {}
    referenced_shape_ids = supported_main_sequence_shape_ids(main_sequence)
    element_order = {
        str(element.get("elementId", "")): index
        for index, element in enumerate(elements)
    }
    targets: dict[str, str] = {}
    for shape_id in sorted(referenced_shape_ids):
        child_ids = sorted(
            (
                element_id_value
                for element_id_value, source in slot_sources.items()
                if str(source.get("slidePart", "")) == slide_part
                and str(source.get("shapeId", "")) == shape_id
                and bool(source.get("writable", False))
            ),
            key=lambda element_id_value: element_order.get(
                element_id_value,
                len(element_order),
            ),
        )
        if len(child_ids) == 1:
            targets[shape_id] = child_ids[0]
            continue
        if not child_ids:
            continue
        child_elements = [
            element
            for element in elements
            if str(element.get("elementId", "")) in child_ids
        ]
        frame = union_element_frame(child_elements)
        if frame is None:
            continue
        group_id = element_id(slide_index, "slide", shape_id, "animation_group")
        elements.append(
            {
                **element_base(
                    element_id=group_id,
                    role="decoration",
                    frame=frame,
                    z_index=max(
                        (int(element.get("zIndex", 0)) for element in child_elements),
                        default=0,
                    ),
                    locked=False,
                ),
                "type": "group",
                "props": {"childElementIds": child_ids},
            }
        )
        slot_sources[group_id] = {
            "type": "slide",
            "name": "animation-group",
            "slidePart": slide_part,
            "shapeId": shape_id,
            "writable": True,
            "animationSyntheticTarget": True,
        }
        targets[shape_id] = group_id
    return targets


def union_element_frame(
    elements: list[dict[str, Any]],
) -> dict[str, int] | None:
    if not elements:
        return None
    left = min(int(element.get("x", 0)) for element in elements)
    top = min(int(element.get("y", 0)) for element in elements)
    right = max(
        int(element.get("x", 0)) + max(1, int(element.get("width", 1)))
        for element in elements
    )
    bottom = max(
        int(element.get("y", 0)) + max(1, int(element.get("height", 1)))
        for element in elements
    )
    return {
        "x": left,
        "y": top,
        "width": max(1, right - left),
        "height": max(1, bottom - top),
    }


def copy_animation_group_sources_to_blueprint(
    template_blueprint: dict[str, Any],
    slides: list[dict[str, Any]],
    slot_sources_by_slide: list[dict[str, dict[str, Any]]],
) -> None:
    for slide_index, template_slide in enumerate(template_blueprint.get("slides", [])):
        if slide_index >= len(slides) or slide_index >= len(slot_sources_by_slide):
            break
        existing_ids = {
            str(source.get("elementId", ""))
            for source in template_slide.get("elementSources", [])
            if isinstance(source, dict)
        }
        for element in slides[slide_index].get("elements", []):
            if not isinstance(element, dict) or element.get("type") != "group":
                continue
            element_id_value = str(element.get("elementId", ""))
            source = slot_sources_by_slide[slide_index].get(element_id_value)
            if not source or element_id_value in existing_ids:
                continue
            slide_part = str(source.get("slidePart", ""))
            shape_id = str(source.get("shapeId", ""))
            if not slide_part or not shape_id:
                continue
            template_slide.setdefault("elementSources", []).append(
                {
                    "elementId": element_id_value,
                    "slidePart": slide_part,
                    "shapeId": shape_id,
                    "sourceType": str(source.get("type", "slide")),
                    "writable": bool(source.get("writable", False)),
                }
            )


def append_visual_tree(
    *,
    package: zipfile.ZipFile,
    content_types: dict[str, str],
    part_path: str,
    root: ET.Element[Any],
    slide_index: int,
    source_name: str,
    scale: OoxmlScale,
    transform: OoxmlTransform,
    state: OoxmlImportState,
    elements: list[dict[str, Any]],
    slot_sources: dict[str, dict[str, Any]],
    placeholder_frames: dict[tuple[str, str], dict[str, int]],
    locked: bool,
) -> None:
    shape_tree = first_local_descendant(root, "spTree")
    if shape_tree is None:
        return
    rels = relationships_for_part(package, part_path)

    for child_index, child in enumerate(list(shape_tree), start=1):
        tag = local_name(child)
        if tag == "grpSp":
            append_group_shape(
                package=package,
                content_types=content_types,
                part_path=part_path,
                group=child,
                slide_index=slide_index,
                source_name=source_name,
                child_index=child_index,
                scale=scale,
                transform=transform,
                state=state,
                elements=elements,
                slot_sources=slot_sources,
                placeholder_frames=placeholder_frames,
                locked=locked,
            )
            continue
        if tag == "graphicFrame":
            if locked and placeholder_key(child) is not None:
                continue
            append_graphic_frame(
                package=package,
                part_path=part_path,
                frame_element=child,
                slide_index=slide_index,
                source_name=source_name,
                child_index=child_index,
                scale=scale,
                transform=transform,
                state=state,
                elements=elements,
                slot_sources=slot_sources,
                placeholder_frames=placeholder_frames,
                locked=locked,
            )
            continue
        if tag not in {"sp", "pic", "cxnSp"}:
            if tag not in {"nvGrpSpPr", "grpSpPr"}:
                state.warnings.append(
                    f"Unsupported OOXML shape tree item on slide {slide_index}: {tag}"
                )
            continue

        if locked and placeholder_key(child) is not None:
            continue

        append_shape(
            package=package,
            content_types=content_types,
            rels=rels,
            part_path=part_path,
            shape=child,
            slide_index=slide_index,
            source_name=source_name,
            child_index=child_index,
            scale=scale,
            transform=transform,
            state=state,
            elements=elements,
            slot_sources=slot_sources,
            placeholder_frames=placeholder_frames,
            locked=locked,
        )


def append_graphic_frame(
    *,
    package: zipfile.ZipFile,
    part_path: str,
    frame_element: ET.Element[Any],
    slide_index: int,
    source_name: str,
    child_index: int,
    scale: OoxmlScale,
    transform: OoxmlTransform,
    state: OoxmlImportState,
    elements: list[dict[str, Any]],
    slot_sources: dict[str, dict[str, Any]],
    placeholder_frames: dict[tuple[str, str], dict[str, int]],
    locked: bool,
) -> None:
    shape_id = shape_identifier(frame_element, child_index)
    frame = shape_frame(frame_element, scale, transform, placeholder_frames)
    if frame is None:
        state.warnings.append(
            f"OOXML graphicFrame has no resolved transform on slide {slide_index}: {shape_id}"
        )
        return

    frame_kind = graphic_frame_kind(frame_element)
    source = shape_source(frame_element, part_path, shape_id, source_name, locked)
    if frame_kind == "table":
        element = table_element(
            frame_element=frame_element,
            slide_index=slide_index,
            source_name=source_name,
            shape_id=shape_id,
            frame=frame,
            scale=scale,
            z_index=state.next_z(),
            locked=locked,
            theme_colors=state.theme_colors,
        )
        if element:
            source["type"] = "table"
            locators, diagnostics = table_cell_locators(
                frame_element,
                slide_index=slide_index,
                shape_id=shape_id,
            )
            state.warnings.extend(diagnostics)
            if locators is not None:
                source["tableCellLocators"] = locators
            elements.append(element)
            slot_sources[str(element["elementId"])] = source
            return
    if frame_kind == "chart":
        element = chart_element(
            package=package,
            part_path=part_path,
            frame_element=frame_element,
            slide_index=slide_index,
            source_name=source_name,
            shape_id=shape_id,
            frame=frame,
            z_index=state.next_z(),
            locked=locked,
        )
        if element:
            source["type"] = "unknown"
            elements.append(element)
            slot_sources[str(element["elementId"])] = source
            return

    reason = f"unsupported {frame_kind} graphicFrame"
    source["type"] = "unknown"
    source["fallbackReason"] = reason
    fallback_element = shape_fallback_image_element(
        shape=frame_element,
        slide_index=slide_index,
        source_name=source_name,
        shape_id=shape_id,
        frame=frame,
        z_index=state.next_z(),
        locked=locked,
        reason=reason,
    )
    elements.append(fallback_element)
    slot_sources[str(fallback_element["elementId"])] = source
    state.warnings.append(
        f"OOXML graphicFrame rendered as image fallback on slide {slide_index}: {frame_kind}"
    )


def chart_element(
    *,
    package: zipfile.ZipFile,
    part_path: str,
    frame_element: ET.Element[Any],
    slide_index: int,
    source_name: str,
    shape_id: str,
    frame: dict[str, int],
    z_index: int,
    locked: bool,
) -> dict[str, Any] | None:
    chart_ref = first_local_descendant(frame_element, "chart")
    relationship_id = attr_by_local_name(chart_ref, "id")
    if not relationship_id:
        return None
    rel = relationships_for_part(package, part_path).get(relationship_id)
    if not rel or relationship_is_external(rel):
        return None
    chart_part = resolve_part_path(part_path, rel.get("Target", ""))
    chart = read_xml(package, chart_part)
    if chart is None:
        return None
    chart_type = chart_type_value(chart)
    data = chart_data(chart, chart_type)
    if not data:
        return None
    return {
        **element_base(
            element_id=element_id(slide_index, source_name, shape_id, "chart"),
            role="chart",
            frame=frame,
            z_index=z_index,
            locked=locked,
        ),
        "type": "chart",
        "props": {
            "type": chart_type,
            "title": chart_title(chart),
            "data": data,
            "style": {
                "colors": ["#4F81BD", "#C0504D", "#9BBB59", "#8064A2"],
                "showLegend": True,
                "legendPosition": "bottom",
                "showDataLabels": False,
                "showGrid": True,
                "xAxisTitle": "",
                "yAxisTitle": "",
                "unit": "",
            },
        },
    }


def chart_type_value(chart: ET.Element[Any]) -> str:
    if first_local_descendant(chart, "lineChart") is not None:
        return "line"
    if first_local_descendant(chart, "pieChart") is not None:
        return "pie"
    if first_local_descendant(chart, "doughnutChart") is not None:
        return "doughnut"
    return "bar"


def chart_title(chart: ET.Element[Any]) -> str:
    title = first_local_descendant(chart, "title")
    if title is None:
        return ""
    return "".join(node.text or "" for node in title.iter() if local_name(node) == "t")


def chart_data(chart: ET.Element[Any], chart_type: str) -> list[dict[str, Any]]:
    series = first_local_descendant(chart, "ser")
    if series is None:
        return []
    labels = chart_labels(series)
    values = chart_values(series)
    result: list[dict[str, Any]] = []
    for index, value in enumerate(values):
        label = labels[index] if index < len(labels) else f"Item {index + 1}"
        result.append({"label": label, "value": value})
    if chart_type in {"pie", "doughnut"}:
        return [{"label": item["label"], "value": max(0, item["value"])} for item in result]
    return result


def chart_labels(series: ET.Element[Any]) -> list[str]:
    category = first_local_child(series, "cat")
    cache = first_local_descendant(category, "strCache")
    if cache is None:
        cache = first_local_descendant(category, "numCache")
    return chart_cache_values(cache)


def chart_values(series: ET.Element[Any]) -> list[float]:
    values = first_local_child(series, "val")
    cache = first_local_descendant(values, "numCache")
    result: list[float] = []
    for value in chart_cache_values(cache):
        try:
            result.append(float(value))
        except ValueError:
            result.append(0)
    return result


def chart_cache_values(cache: ET.Element[Any] | None) -> list[str]:
    if cache is None:
        return []
    points: list[tuple[ET.Element[Any], ET.Element[Any]]] = []
    for point in direct_local_children(cache, "pt"):
        value = first_local_child(point, "v")
        if value is not None:
            points.append((point, value))
    points.sort(key=lambda item: int_attr(item[0], "idx", 0))
    return [str(value.text or "") for _, value in points]


def table_element(
    *,
    frame_element: ET.Element[Any],
    slide_index: int,
    source_name: str,
    shape_id: str,
    frame: dict[str, int],
    scale: OoxmlScale,
    z_index: int,
    locked: bool,
    theme_colors: dict[str, str],
) -> dict[str, Any] | None:
    table = first_local_descendant(frame_element, "tbl")
    if table is None:
        return None
    rows = table_rows(table, scale, theme_colors)
    if not rows:
        return None
    return {
        **element_base(
            element_id=element_id(slide_index, source_name, shape_id, "table"),
            role="table",
            frame=frame,
            z_index=z_index,
            locked=locked,
        ),
        "type": "table",
        "props": {
            "rows": rows,
            "columnWidths": table_column_widths(table, scale),
            "rowHeights": table_row_heights(table, scale),
            "borderColor": "#CBD5E1",
            "borderWidth": 1,
        },
    }


def table_rows(
    table: ET.Element[Any],
    scale: OoxmlScale,
    theme_colors: dict[str, str],
) -> list[list[dict[str, Any]]]:
    rows: list[list[dict[str, Any]]] = []
    for row_index, row in enumerate(direct_local_children(table, "tr")):
        cells = [
            table_cell(cell, row_index, scale, theme_colors)
            for cell in direct_local_children(row, "tc")
        ]
        if cells:
            rows.append(cells)
    return rows


def table_cell(
    cell: ET.Element[Any],
    row_index: int,
    scale: OoxmlScale,
    theme_colors: dict[str, str],
) -> dict[str, Any]:
    body = first_local_child(cell, "txBody")
    runs = text_runs(body, scale, theme_colors) if body is not None else []
    text = "".join(str(run.get("text", "")) for run in runs)
    tc_pr = first_local_child(cell, "tcPr")
    border_color, border_width = table_cell_border(tc_pr, scale, theme_colors)
    default_fill, default_text_color = default_table_cell_colors(row_index)
    props: dict[str, Any] = {
        "text": text,
        "fill": table_cell_fill(tc_pr, theme_colors, default_fill),
        "textColor": default_text_color,
        "fontSize": 32,
        "fontWeight": "normal",
        "align": paragraph_align(body) if body is not None else "left",
        "verticalAlign": table_cell_vertical_align(tc_pr, body),
        "borderColor": border_color,
        "borderWidth": border_width,
        "colSpan": max(1, int_attr(cell, "gridSpan", 1)),
        "rowSpan": max(1, int_attr(cell, "rowSpan", 1)),
    }
    first_run = next((run for run in runs if str(run.get("text", "")).strip()), None)
    if first_run is None and body is not None:
        first_run = table_cell_empty_text_style(body, scale, theme_colors)
    if first_run:
        if first_run.get("fontFamily"):
            props["fontFamily"] = first_run["fontFamily"]
        if first_run.get("fontSize"):
            props["fontSize"] = first_run["fontSize"]
        if first_run.get("fontWeight"):
            props["fontWeight"] = first_run["fontWeight"]
        if first_run.get("color"):
            props["textColor"] = first_run["color"]
    return props


def default_table_cell_colors(row_index: int) -> tuple[str, str]:
    if row_index == 0:
        return "#4F81BD", "#FFFFFF"
    if row_index % 2 == 1:
        return "#D0D8E8", "#000000"
    return "#E9EDF5", "#000000"


def table_column_widths(table: ET.Element[Any], scale: OoxmlScale) -> list[int]:
    grid = first_local_child(table, "tblGrid")
    return [
        max(1, round(int_attr(column, "w", 1) * scale.scale_x))
        for column in direct_local_children(grid, "gridCol")
    ] if grid is not None else []


def table_row_heights(table: ET.Element[Any], scale: OoxmlScale) -> list[int]:
    return [
        max(1, round(int_attr(row, "h", 1) * scale.scale_y))
        for row in direct_local_children(table, "tr")
    ]


def table_cell_locators(
    frame_element: ET.Element[Any],
    *,
    slide_index: int,
    shape_id: str,
) -> tuple[list[dict[str, Any]] | None, list[str]]:
    table = direct_graphic_frame_table(frame_element)
    location = f"slide={slide_index}; shape={shape_id}"
    if table is None:
        return None, [
            f"{TABLE_STRUCTURE_UNSUPPORTED}: {location}; reason=non-direct-table"
        ]

    grid = first_local_child(table, "tblGrid")
    columns = direct_local_children(grid, "gridCol") if grid is not None else []
    rows = direct_local_children(table, "tr")
    if not columns or not rows:
        return None, [
            f"{TABLE_TRACK_MISMATCH}: {location}; "
            "reason=column-track-mismatch"
        ]
    if len(columns) > 1000 or len(rows) > 1000:
        return None, [
            f"{TABLE_STRUCTURE_UNSUPPORTED}: {location}; reason=locator-limit"
        ]
    if any(not valid_integer_attribute(column, "w", minimum=1) for column in columns):
        return None, [
            f"{TABLE_TRACK_MISMATCH}: {location}; "
            "reason=column-track-mismatch"
        ]
    if any(not valid_integer_attribute(row, "h", minimum=0) for row in rows):
        return None, [
            f"{TABLE_TRACK_MISMATCH}: {location}; reason=row-track-mismatch"
        ]

    row_cells = [direct_local_children(row, "tc") for row in rows]
    row_lengths = {len(cells) for cells in row_cells}
    if len(row_lengths) != 1:
        return None, [
            f"{TABLE_STRUCTURE_UNSUPPORTED}: {location}; reason=jagged-grid"
        ]
    if next(iter(row_lengths), 0) != len(columns):
        return None, [
            f"{TABLE_TRACK_MISMATCH}: {location}; "
            "reason=column-track-mismatch"
        ]
    if len(rows) * len(columns) > MAX_TABLE_CELL_LOCATORS:
        return None, [
            f"{TABLE_STRUCTURE_UNSUPPORTED}: {location}; reason=locator-limit"
        ]
    if any(table_cell_has_merge(cell) for cells in row_cells for cell in cells):
        return None, [
            f"{TABLE_STRUCTURE_UNSUPPORTED}: {location}; reason=merged-cell"
        ]

    return [
        {
            "rowIndex": row_index,
            "columnIndex": column_index,
            "fingerprint": table_cell_fingerprint(cell),
        }
        for row_index, cells in enumerate(row_cells)
        for column_index, cell in enumerate(cells)
    ], []


def direct_graphic_frame_table(
    frame_element: ET.Element[Any],
) -> ET.Element[Any] | None:
    graphic = first_local_child(frame_element, "graphic")
    graphic_data = first_local_child(graphic, "graphicData")
    if (
        graphic_data is None
        or graphic_data.get("uri") != TABLE_GRAPHIC_DATA_URI
    ):
        return None
    return first_local_child(graphic_data, "tbl")


def valid_integer_attribute(
    element: ET.Element[Any],
    name: str,
    *,
    minimum: int,
) -> bool:
    raw_value = element.get(name)
    if raw_value is None:
        return False
    try:
        return int(raw_value) >= minimum
    except ValueError:
        return False


def table_cell_has_merge(cell: ET.Element[Any]) -> bool:
    for span_name in ("gridSpan", "rowSpan"):
        raw_span = cell.get(span_name)
        if raw_span is None:
            continue
        try:
            if int(raw_span) != 1:
                return True
        except ValueError:
            return True
    for merge_name in ("hMerge", "vMerge"):
        raw_merge = cell.get(merge_name)
        if raw_merge is None:
            continue
        if raw_merge.lower() in {"1", "true", "on"}:
            return True
        if raw_merge.lower() not in {"0", "false", "off"}:
            return True
    return False


def table_cell_fingerprint(cell: ET.Element[Any]) -> str:
    payload = copy.deepcopy(cell)
    for node in payload.iter():
        if node.tag == f"{{{DML_NS}}}t":
            node.text = ""
            node.attrib.pop(
                "{http://www.w3.org/XML/1998/namespace}space",
                None,
            )
    canonical = ET.canonicalize(
        ET.tostring(payload, encoding="unicode"),
        with_comments=False,
        rewrite_prefixes=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def copy_table_cell_locators_to_blueprint(
    template_blueprint: dict[str, Any],
    slot_sources_by_slide: list[dict[str, dict[str, Any]]],
) -> None:
    blueprint_slides = template_blueprint.get("slides", [])
    for slide_index, blueprint_slide in enumerate(blueprint_slides):
        if slide_index >= len(slot_sources_by_slide):
            break
        sources_by_element = slot_sources_by_slide[slide_index]
        for element_source in blueprint_slide.get("elementSources", []):
            element_id_value = str(element_source.get("elementId", ""))
            source = sources_by_element.get(element_id_value, {})
            locators = source.get("tableCellLocators")
            if isinstance(locators, list) and locators:
                element_source["tableCellLocators"] = locators


def table_cell_border(
    tc_pr: ET.Element[Any] | None,
    scale: OoxmlScale,
    theme_colors: dict[str, str],
) -> tuple[str, float]:
    for border_name in ("lnL", "lnR", "lnT", "lnB"):
        border = first_local_child(tc_pr, border_name)
        if border is None:
            continue
        return (
            solid_color(first_local_child(border, "solidFill"), theme_colors)
            or "#CBD5E1",
            round(max(0, int_attr(border, "w", 12700) * scale.average_scale), 2),
        )
    return "#FFFFFF", 1


def table_cell_fill(
    tc_pr: ET.Element[Any] | None,
    theme_colors: dict[str, str],
    fallback: str,
) -> str:
    if tc_pr is None:
        return fallback
    fill_names = {"noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"}
    fill = next(
        (child for child in list(tc_pr) if local_name(child) in fill_names),
        None,
    )
    if fill is None:
        return fallback
    if local_name(fill) == "solidFill":
        return solid_color(fill, theme_colors) or "transparent"
    return "transparent"


def table_cell_empty_text_style(
    body: ET.Element[Any],
    scale: OoxmlScale,
    theme_colors: dict[str, str],
) -> dict[str, Any] | None:
    for paragraph in direct_local_children(body, "p"):
        for run in direct_local_children(paragraph, "r"):
            run_properties = first_local_child(run, "rPr")
            if run_properties is not None:
                return run_properties_value(run_properties, scale, theme_colors)
        end_properties = first_local_child(paragraph, "endParaRPr")
        if end_properties is not None:
            return run_properties_value(end_properties, scale, theme_colors)
        paragraph_properties = first_local_child(paragraph, "pPr")
        default_properties = first_local_child(paragraph_properties, "defRPr")
        if default_properties is not None:
            return run_properties_value(default_properties, scale, theme_colors)
    return None


def table_cell_vertical_align(
    tc_pr: ET.Element[Any] | None,
    body: ET.Element[Any] | None,
) -> str:
    anchor = str(tc_pr.get("anchor", "")) if tc_pr is not None else ""
    if anchor:
        return {
            "ctr": "middle",
            "mid": "middle",
            "b": "bottom",
        }.get(anchor, "top")
    return text_vertical_align(body) if body is not None else "middle"


def append_group_shape(
    *,
    package: zipfile.ZipFile,
    content_types: dict[str, str],
    part_path: str,
    group: ET.Element[Any],
    slide_index: int,
    source_name: str,
    child_index: int,
    scale: OoxmlScale,
    transform: OoxmlTransform,
    state: OoxmlImportState,
    elements: list[dict[str, Any]],
    slot_sources: dict[str, dict[str, Any]],
    placeholder_frames: dict[tuple[str, str], dict[str, int]],
    locked: bool,
) -> list[str]:
    appended_start = len(elements)
    group_transform = transform.for_group(group)

    rels = relationships_for_part(package, part_path)
    child_element_ids: list[str] = []
    for nested_index, child in enumerate(list(group), start=1):
        tag = local_name(child)
        if tag == "grpSp":
            child_element_ids.extend(
                append_group_shape(
                    package=package,
                    content_types=content_types,
                    part_path=part_path,
                    group=child,
                    slide_index=slide_index,
                    source_name=source_name,
                    child_index=nested_index,
                    scale=scale,
                    transform=group_transform,
                    state=state,
                    elements=elements,
                    slot_sources=slot_sources,
                    placeholder_frames=placeholder_frames,
                    locked=locked,
                )
            )
        elif tag in {"sp", "pic", "cxnSp"}:
            child_element_ids.extend(
                append_shape(
                    package=package,
                    content_types=content_types,
                    rels=rels,
                    part_path=part_path,
                    shape=child,
                    slide_index=slide_index,
                    source_name=source_name,
                    child_index=nested_index,
                    scale=scale,
                    transform=group_transform,
                    state=state,
                    elements=elements,
                    slot_sources=slot_sources,
                    placeholder_frames=placeholder_frames,
                    locked=locked,
                )
            )

    frame = group_visual_frame(
        group,
        scale,
        group_transform,
        state.theme_colors,
        placeholder_frames,
    )
    if frame is None or not child_element_ids:
        return []

    child_z_indices = [
        int(element.get("zIndex", 0))
        for element in elements[appended_start:]
        if str(element.get("elementId", "")) in child_element_ids
    ]
    group_id = shape_identifier(group, child_index)
    group_element_id = element_id(slide_index, source_name, group_id, "group")
    elements.append(
        {
            **element_base(
                element_id=group_element_id,
                role="decoration",
                frame=frame,
                z_index=max(child_z_indices, default=0),
                locked=locked,
            ),
            "type": "group",
            "props": {
                "childElementIds": child_element_ids,
            },
        }
    )
    slot_sources[group_element_id] = shape_source(
        group,
        part_path,
        group_id,
        source_name,
        locked,
    )
    return [group_element_id]


def append_group_text_elements(
    *,
    part_path: str,
    group: ET.Element[Any],
    slide_index: int,
    source_name: str,
    scale: OoxmlScale,
    transform: OoxmlTransform,
    state: OoxmlImportState,
    elements: list[dict[str, Any]],
    slot_sources: dict[str, dict[str, Any]],
    placeholder_frames: dict[tuple[str, str], dict[str, int]],
    locked: bool,
) -> None:
    for child_index, child in enumerate(list(group), start=1):
        tag = local_name(child)
        if tag == "grpSp":
            append_group_text_elements(
                part_path=part_path,
                group=child,
                slide_index=slide_index,
                source_name=source_name,
                scale=scale,
                transform=transform.for_group(child),
                state=state,
                elements=elements,
                slot_sources=slot_sources,
                placeholder_frames=placeholder_frames,
                locked=locked,
            )
        elif tag in {"sp", "cxnSp"}:
            append_shape_text_only(
                part_path=part_path,
                shape=child,
                slide_index=slide_index,
                source_name=source_name,
                child_index=child_index,
                scale=scale,
                transform=transform,
                state=state,
                elements=elements,
                slot_sources=slot_sources,
                placeholder_frames=placeholder_frames,
                locked=locked,
            )


def append_shape_text_only(
    *,
    part_path: str,
    shape: ET.Element[Any],
    slide_index: int,
    source_name: str,
    child_index: int,
    scale: OoxmlScale,
    transform: OoxmlTransform,
    state: OoxmlImportState,
    elements: list[dict[str, Any]],
    slot_sources: dict[str, dict[str, Any]],
    placeholder_frames: dict[tuple[str, str], dict[str, int]],
    locked: bool,
) -> None:
    shape_id = shape_identifier(shape, child_index)
    frame = shape_frame(shape, scale, transform, placeholder_frames)
    if frame is None:
        return
    text_element_payload = text_element(
        shape=shape,
        slide_index=slide_index,
        source_name=source_name,
        shape_id=shape_id,
        frame=frame,
        scale=scale,
        z_index=state.next_z(),
        locked=locked,
        theme_colors=state.theme_colors,
        text_style_context=state.text_style_context,
        warnings=state.warnings,
    )
    if text_element_payload:
        elements.append(text_element_payload)
        slot_sources[str(text_element_payload["elementId"])] = shape_source(
            shape,
            part_path,
            shape_id,
            source_name,
            locked,
        )


def group_has_visual_content(
    group: ET.Element[Any],
    scale: OoxmlScale,
    transform: OoxmlTransform,
    theme_colors: dict[str, str],
    placeholder_frames: dict[tuple[str, str], dict[str, int]],
) -> bool:
    for child in list(group):
        tag = local_name(child)
        if tag == "grpSp":
            if group_has_visual_content(
                child,
                scale,
                transform.for_group(child),
                theme_colors,
                placeholder_frames,
            ):
                return True
        elif tag in {"sp", "pic", "cxnSp"} and shape_has_visual_content(
            child,
            scale,
            transform,
            theme_colors,
            placeholder_frames,
        ):
            return True
    return False


def group_visual_frame(
    group: ET.Element[Any],
    scale: OoxmlScale,
    transform: OoxmlTransform,
    theme_colors: dict[str, str],
    placeholder_frames: dict[tuple[str, str], dict[str, int]],
) -> dict[str, int] | None:
    frames: list[dict[str, int]] = []
    for child in list(group):
        tag = local_name(child)
        if tag == "grpSp":
            frame = group_visual_frame(
                child,
                scale,
                transform.for_group(child),
                theme_colors,
                placeholder_frames,
            )
        elif tag in {"sp", "pic", "cxnSp"} and shape_has_visual_content(
            child,
            scale,
            transform,
            theme_colors,
            placeholder_frames,
        ):
            frame = shape_frame(child, scale, transform, placeholder_frames)
        else:
            frame = None
        if frame is not None:
            frames.append(frame)

    if not frames:
        return None
    left = min(frame["x"] for frame in frames)
    top = min(frame["y"] for frame in frames)
    right = max(frame["x"] + frame["width"] for frame in frames)
    bottom = max(frame["y"] + frame["height"] for frame in frames)
    return {
        "x": left,
        "y": top,
        "width": max(1, right - left),
        "height": max(1, bottom - top),
        "rotation": 0,
    }


def shape_has_visual_content(
    shape: ET.Element[Any],
    scale: OoxmlScale,
    transform: OoxmlTransform,
    theme_colors: dict[str, str],
    placeholder_frames: dict[tuple[str, str], dict[str, int]],
) -> bool:
    if shape_frame(shape, scale, transform, placeholder_frames) is None:
        return False
    if local_name(shape) in {"pic", "cxnSp"}:
        return True
    if unsupported_geometry_reason(shape) or unsupported_effect_reason(shape):
        return True
    fill = shape_fill(shape, theme_colors)
    stroke, _, _ = shape_stroke(shape, scale, theme_colors)
    return bool(
        fill != "transparent"
        or stroke != "transparent"
        or shape_uses_default_visual_style(shape)
    )


def shape_uses_default_visual_style(shape: ET.Element[Any]) -> bool:
    body = first_local_child(shape, "txBody")
    return (
        local_name(shape) == "sp"
        and first_local_descendant(shape, "prstGeom") is not None
        and (body is None or not text_body_plain_text(body).strip())
    )


def text_body_plain_text(body: ET.Element[Any]) -> str:
    return "".join(node.text or "" for node in body.iter() if local_name(node) == "t")


def append_shape(
    *,
    package: zipfile.ZipFile,
    content_types: dict[str, str],
    rels: dict[str, dict[str, str]],
    part_path: str,
    shape: ET.Element[Any],
    slide_index: int,
    source_name: str,
    child_index: int,
    scale: OoxmlScale,
    transform: OoxmlTransform,
    state: OoxmlImportState,
    elements: list[dict[str, Any]],
    slot_sources: dict[str, dict[str, Any]],
    placeholder_frames: dict[tuple[str, str], dict[str, int]],
    locked: bool,
) -> list[str]:
    appended_start = len(elements)
    shape_id = shape_identifier(shape, child_index)
    frame = shape_frame(shape, scale, transform, placeholder_frames)
    if frame is None:
        state.warnings.append(
            f"OOXML shape has no resolved transform on slide {slide_index}: {shape_id}"
        )
        return []

    source = shape_source(shape, part_path, shape_id, source_name, locked)
    fallback_reason = shape_image_fallback_reason(shape)
    if fallback_reason:
        source["fallbackReason"] = fallback_reason
        fallback_element = shape_fallback_image_element(
            shape=shape,
            slide_index=slide_index,
            source_name=source_name,
            shape_id=shape_id,
            frame=frame,
            z_index=state.next_z(),
            locked=locked,
            reason=fallback_reason,
        )
        elements.append(fallback_element)
        slot_sources[str(fallback_element["elementId"])] = source
        state.warnings.append(
            f"OOXML shape rendered as image fallback on slide {slide_index}: "
            f"{fallback_reason}"
        )
        text_element_payload = text_element(
            shape=shape,
            slide_index=slide_index,
            source_name=source_name,
            shape_id=shape_id,
            frame=frame,
            scale=scale,
            z_index=state.next_z(),
            locked=locked,
            theme_colors=state.theme_colors,
            text_style_context=state.text_style_context,
            warnings=state.warnings,
        )
        if text_element_payload:
            elements.append(text_element_payload)
            slot_sources[str(text_element_payload["elementId"])] = shape_source(
                shape,
                part_path,
                shape_id,
                source_name,
                locked,
            )
        return [
            str(element.get("elementId", ""))
            for element in elements[appended_start:]
            if str(element.get("elementId", ""))
        ]

    if local_name(shape) == "pic":
        element = image_element(
            package=package,
            content_types=content_types,
            rels=rels,
            part_path=part_path,
            shape=shape,
            slide_index=slide_index,
            source_name=source_name,
            shape_id=shape_id,
            frame=frame,
            scale=scale,
            z_index=state.next_z(),
            locked=locked,
            state=state,
        )
        if element:
            elements.append(element)
            slot_sources[str(element["elementId"])] = source
        return [
            str(element.get("elementId", ""))
            for element in elements[appended_start:]
            if str(element.get("elementId", ""))
        ]

    picture_fill_element = shape_picture_fill_element(
        package=package,
        content_types=content_types,
        rels=rels,
        part_path=part_path,
        shape=shape,
        slide_index=slide_index,
        source_name=source_name,
        shape_id=shape_id,
        frame=frame,
        scale=scale,
        z_index=state.next_z(),
        locked=locked,
        state=state,
    )
    if picture_fill_element:
        elements.append(picture_fill_element)
        slot_sources[str(picture_fill_element["elementId"])] = source

    fill = shape_fill(shape, state.theme_colors)
    stroke, stroke_width, stroke_extras = shape_stroke(
        shape,
        scale,
        state.theme_colors,
        state.theme_styles,
    )
    shadow = shape_shadow(shape, scale, state.theme_colors, state.theme_styles)
    if fill != "transparent" or stroke != "transparent":
        shape_element_payload = visual_shape_element(
            shape=shape,
            slide_index=slide_index,
            source_name=source_name,
            shape_id=shape_id,
            frame=frame,
            z_index=state.next_z(),
            locked=locked,
            fill=fill,
            stroke=stroke,
            stroke_width=stroke_width,
            stroke_extras=stroke_extras,
            shadow=shadow,
            warnings=state.warnings,
        )
        elements.append(shape_element_payload)
        slot_sources[str(shape_element_payload["elementId"])] = source

    text_element_payload = text_element(
        shape=shape,
        slide_index=slide_index,
        source_name=source_name,
        shape_id=shape_id,
        frame=frame,
        scale=scale,
        z_index=state.next_z(),
        locked=locked,
        theme_colors=state.theme_colors,
        text_style_context=state.text_style_context,
        warnings=state.warnings,
    )
    if text_element_payload:
        elements.append(text_element_payload)
        slot_sources[str(text_element_payload["elementId"])] = source

    return [
        str(element.get("elementId", ""))
        for element in elements[appended_start:]
        if str(element.get("elementId", ""))
    ]


def image_element(
    *,
    package: zipfile.ZipFile,
    content_types: dict[str, str],
    rels: dict[str, dict[str, str]],
    part_path: str,
    shape: ET.Element[Any],
    slide_index: int,
    source_name: str,
    shape_id: str,
    frame: dict[str, int],
    scale: OoxmlScale,
    z_index: int,
    locked: bool,
    state: OoxmlImportState,
) -> dict[str, Any] | None:
    blip = first_local_descendant(shape, "blip")
    relationship_id = attr_by_local_name(blip, "embed")
    if not relationship_id:
        state.warnings.append(
            f"OOXML image has no relationship on slide {slide_index}: {shape_id}"
        )
        return None
    asset = image_asset_from_relationship(
        package=package,
        content_types=content_types,
        rels=rels,
        part_path=part_path,
        relationship_id=relationship_id,
        slide_index=slide_index,
        shape_id=shape_id,
        state=state,
    )
    if asset is None:
        return None
    asset_id, mime_type = asset

    props: dict[str, Any] = {
        "src": f"asset:{asset_id}",
        "alt": shape_name(shape)
        or ("Imported SVG" if is_svg_mime_type(mime_type) else "Imported image"),
        "fit": "stretch",
        "focusX": 0.5,
        "focusY": 0.5,
    }
    crop = image_crop(shape)
    if crop:
        props["crop"] = crop
    role = "background" if is_full_canvas_frame(frame, scale) else "media"
    return {
        **element_base(
            element_id=element_id(slide_index, source_name, shape_id, "image"),
            role=role,
            frame=frame,
            z_index=z_index,
            locked=locked or role == "background",
        ),
        "type": "svg" if is_svg_mime_type(mime_type) else "image",
        "props": props,
    }


def shape_picture_fill_element(
    *,
    package: zipfile.ZipFile,
    content_types: dict[str, str],
    rels: dict[str, dict[str, str]],
    part_path: str,
    shape: ET.Element[Any],
    slide_index: int,
    source_name: str,
    shape_id: str,
    frame: dict[str, int],
    scale: OoxmlScale,
    z_index: int,
    locked: bool,
    state: OoxmlImportState,
) -> dict[str, Any] | None:
    sp_pr = first_local_child(shape, "spPr")
    if first_local_child(sp_pr, "blipFill") is None:
        return None
    relationship_id = attr_by_local_name(first_local_descendant(shape, "blip"), "embed")
    if not relationship_id:
        return None
    asset = image_asset_from_relationship(
        package=package,
        content_types=content_types,
        rels=rels,
        part_path=part_path,
        relationship_id=relationship_id,
        slide_index=slide_index,
        shape_id=shape_id,
        state=state,
    )
    if asset is None:
        return None
    asset_id, mime_type = asset
    crop = image_crop(shape)
    role = "background" if is_full_canvas_frame(frame, scale) else "media"
    return {
        **element_base(
            element_id=element_id(slide_index, source_name, shape_id, "picture_fill"),
            role=role,
            frame=frame,
            z_index=z_index,
            locked=locked or role == "background",
        ),
        "type": "svg" if is_svg_mime_type(mime_type) else "image",
        "props": {
            "src": f"asset:{asset_id}",
            "alt": shape_name(shape) or "Shape picture fill",
            "fit": "stretch",
            "focusX": 0.5,
            "focusY": 0.5,
            **({"crop": crop} if crop else {}),
        },
    }


def image_asset_from_relationship(
    *,
    package: zipfile.ZipFile,
    content_types: dict[str, str],
    rels: dict[str, dict[str, str]],
    part_path: str,
    relationship_id: str,
    slide_index: int,
    shape_id: str,
    state: OoxmlImportState,
) -> tuple[str, str] | None:
    rel = rels.get(relationship_id)
    if not rel:
        state.warnings.append(
            f"OOXML image relationship missing on slide {slide_index}: {relationship_id}"
        )
        return None
    if relationship_is_external(rel):
        if "PPTX_EXTERNAL_RELATIONSHIP_BLOCKED" not in state.warnings:
            state.warnings.append("PPTX_EXTERNAL_RELATIONSHIP_BLOCKED")
        return None
    image_part = resolve_part_path(part_path, rel.get("Target", ""))
    if image_part not in package.namelist():
        state.warnings.append(
            f"OOXML image part missing on slide {slide_index}: {image_part}"
        )
        return None
    blob = package.read(image_part)
    content_hash = hashlib.sha256(blob).hexdigest()
    existing_asset_id = state.asset_ids_by_content_hash.get(content_hash)
    mime_type = mime_type_for_part(content_types, image_part)
    if existing_asset_id is not None:
        return existing_asset_id, mime_type
    asset_id = f"image_{len(state.assets) + 1}"
    state.assets.append(
        ImportedDesignAsset(
            assetId=asset_id,
            fileName=f"{asset_id}.{extension_for_mime_type(mime_type)}",
            mimeType=mime_type,
            contentBase64=base64.b64encode(blob).decode("ascii"),
        )
    )
    state.asset_ids_by_content_hash[content_hash] = asset_id
    color = average_image_color(blob)
    if color:
        state.asset_colors[asset_id] = color
    return asset_id, mime_type


def shape_fallback_image_element(
    *,
    shape: ET.Element[Any],
    slide_index: int,
    source_name: str,
    shape_id: str,
    frame: dict[str, int],
    z_index: int,
    locked: bool,
    reason: str,
) -> dict[str, Any]:
    asset_id = shape_fallback_asset_id(slide_index, source_name, shape_id)
    return {
        **element_base(
            element_id=element_id(slide_index, source_name, shape_id, "fallback_image"),
            role="decoration",
            frame=frame,
            z_index=z_index,
            locked=locked,
        ),
        "type": "image",
        "props": {
            "src": f"asset:{asset_id}",
            "alt": shape_name(shape) or reason,
            "fit": "stretch",
            "focusX": 0.5,
            "focusY": 0.5,
        },
    }


def shape_fallback_asset_id(slide_index: int, source_name: str, shape_id: str) -> str:
    return f"shape_render_{slide_index}_{safe_id(source_name)}_{safe_id(shape_id)}"


def shape_image_fallback_reason(shape: ET.Element[Any]) -> str | None:
    if local_name(shape) == "pic":
        return None

    geometry_reason = unsupported_geometry_reason(shape)
    if geometry_reason:
        return geometry_reason

    effect_reason = unsupported_effect_reason(shape)
    if effect_reason:
        return effect_reason

    return None


def unsupported_geometry_reason(shape: ET.Element[Any]) -> str | None:
    sp_pr = first_local_child(shape, "spPr")
    if sp_pr is None:
        return None
    if first_local_child(sp_pr, "custGeom") is not None and not custom_geometry_path(shape):
        return "unsupported custom geometry"
    token = preset_token(shape)
    if supported_preset_token(token, local_name(shape)):
        return None
    return f"unsupported preset {token}"


def supported_preset_token(token: str, tag: str) -> bool:
    return (
        tag == "cxnSp"
        or token in {"rect", "roundRect", "line", "straightConnector1", "ellipse", "oval"}
        or "donut" in token
        or "star" in token
        or preset_custom_shape_path(token) is not None
    )


def unsupported_effect_reason(shape: ET.Element[Any]) -> str | None:
    if first_local_descendant(shape, "effectDag") is not None:
        return "unsupported effect graph"
    if first_local_descendant(shape, "scene3d") is not None:
        return "unsupported 3D scene"
    if first_local_descendant(shape, "sp3d") is not None:
        return "unsupported 3D shape"

    effect_list = first_local_descendant(shape, "effectLst")
    if effect_list is None:
        return None
    unsupported = [
        local_name(child)
        for child in list(effect_list)
        if local_name(child) != "outerShdw"
    ]
    if unsupported:
        return f"unsupported effect {unsupported[0]}"
    return None


def unsupported_text_reason(body: ET.Element[Any]) -> str | None:
    body_pr = first_local_child(body, "bodyPr")
    text_direction = str(body_pr.get("vert", "")) if body_pr is not None else ""
    if text_direction and text_direction != "horz":
        return "unsupported vertical text"
    if first_local_descendant(body, "fld") is not None:
        return "unsupported text field"

    paragraphs = [
        paragraph
        for paragraph in direct_local_children(body, "p")
        if paragraph_plain_text(paragraph).strip()
    ]
    if len(paragraphs) > 1:
        return "multi-paragraph text layout"
    return None


def paragraph_plain_text(paragraph: ET.Element[Any]) -> str:
    return "".join(
        node.text or "" for node in paragraph.iter() if local_name(node) == "t"
    )


def visual_shape_element(
    *,
    shape: ET.Element[Any],
    slide_index: int,
    source_name: str,
    shape_id: str,
    frame: dict[str, int],
    z_index: int,
    locked: bool,
    fill: Any,
    stroke: Any,
    stroke_width: float,
    stroke_extras: dict[str, Any],
    shadow: dict[str, Any] | None,
    warnings: list[str],
) -> dict[str, Any]:
    token = preset_token(shape)
    custom_geometry = custom_geometry_path(shape)
    element_type = (
        "customShape"
        if custom_geometry
        else shape_type_for_preset(token, local_name(shape))
    )
    props: dict[str, Any] = {
        "fill": fill,
        "stroke": stroke,
        "strokeWidth": stroke_width,
        "borderRadius": 0,
        **stroke_extras,
    }
    if shadow:
        props["shadow"] = shadow
    if element_type == "customShape":
        path_data: str
        closed: bool
        view_box_width: int
        view_box_height: int
        nodes: list[dict[str, Any]]
        if custom_geometry:
            path_data = str(custom_geometry["pathData"])
            closed = bool(custom_geometry["closed"])
            view_box_width = int(custom_geometry["viewBoxWidth"])
            view_box_height = int(custom_geometry["viewBoxHeight"])
            nodes = list(custom_geometry["nodes"])
        else:
            custom_path = preset_custom_shape_path(token)
            if custom_path:
                path_data, closed = custom_path
                view_box_width = 100
                view_box_height = 100
                nodes = []
            else:
                warnings.append(
                    f"Unsupported OOXML preset converted to rect on slide {slide_index}: {token}"
                )
                element_type = "rect"
                path_data, closed = "", True
                view_box_width = frame["width"]
                view_box_height = frame["height"]
                nodes = []
        if element_type == "customShape":
            return {
                **element_base(
                    element_id=element_id(slide_index, source_name, shape_id, "shape"),
                    role="decoration",
                    frame=frame,
                    z_index=z_index,
                    locked=locked,
                ),
                "type": "customShape",
                "props": {
                    "pathData": path_data,
                    "viewBoxWidth": view_box_width,
                    "viewBoxHeight": view_box_height,
                    "fill": fill,
                    "stroke": stroke,
                    "strokeWidth": stroke_width,
                    "closed": closed,
                    "nodes": nodes,
                    **stroke_extras,
                    **({"shadow": shadow} if shadow else {}),
                },
            }
    if token == "roundRect":
        props["borderRadius"] = round(min(frame["width"], frame["height"]) * 0.16)
    return {
        **element_base(
            element_id=element_id(slide_index, source_name, shape_id, "shape"),
            role="decoration",
            frame=frame,
            z_index=z_index,
            locked=locked,
        ),
        "type": element_type,
        "props": props,
    }


def custom_geometry_path(shape: ET.Element[Any]) -> dict[str, Any] | None:
    cust_geom = first_local_descendant(shape, "custGeom")
    path = first_local_descendant(cust_geom, "path")
    if path is None:
        return None

    view_box_width = max(1, int_attr(path, "w", 1))
    view_box_height = max(1, int_attr(path, "h", 1))
    segments: list[str] = []
    nodes: list[dict[str, Any]] = []
    closed = False

    for command in list(path):
        command_name = local_name(command)
        if command_name == "moveTo":
            point = first_local_child(command, "pt")
            if point is None:
                return None
            x = int_attr(point, "x", 0)
            y = int_attr(point, "y", 0)
            segments.append(f"M {x} {y}")
            nodes.append({"x": x, "y": y, "mode": "corner"})
        elif command_name == "lnTo":
            point = first_local_child(command, "pt")
            if point is None:
                return None
            x = int_attr(point, "x", 0)
            y = int_attr(point, "y", 0)
            segments.append(f"L {x} {y}")
            nodes.append({"x": x, "y": y, "mode": "corner"})
        elif command_name == "quadBezTo":
            points = direct_local_children(command, "pt")
            if len(points) != 2:
                return None
            control_x = int_attr(points[0], "x", 0)
            control_y = int_attr(points[0], "y", 0)
            end_x = int_attr(points[1], "x", 0)
            end_y = int_attr(points[1], "y", 0)
            segments.append(f"Q {control_x} {control_y} {end_x} {end_y}")
            nodes.append(
                {
                    "x": end_x,
                    "y": end_y,
                    "inX": control_x,
                    "inY": control_y,
                    "mode": "smooth",
                }
            )
        elif command_name == "cubicBezTo":
            points = direct_local_children(command, "pt")
            if len(points) != 3:
                return None
            control_1_x = int_attr(points[0], "x", 0)
            control_1_y = int_attr(points[0], "y", 0)
            control_2_x = int_attr(points[1], "x", 0)
            control_2_y = int_attr(points[1], "y", 0)
            end_x = int_attr(points[2], "x", 0)
            end_y = int_attr(points[2], "y", 0)
            segments.append(
                "C "
                f"{control_1_x} {control_1_y} "
                f"{control_2_x} {control_2_y} "
                f"{end_x} {end_y}"
            )
            if nodes:
                nodes[-1]["outX"] = control_1_x
                nodes[-1]["outY"] = control_1_y
            nodes.append(
                {
                    "x": end_x,
                    "y": end_y,
                    "inX": control_2_x,
                    "inY": control_2_y,
                    "mode": "smooth",
                }
            )
        elif command_name == "close":
            segments.append("Z")
            closed = True
        else:
            return None

    if not segments:
        return None
    return {
        "pathData": " ".join(segments),
        "viewBoxWidth": view_box_width,
        "viewBoxHeight": view_box_height,
        "closed": closed,
        "nodes": nodes,
    }


def text_element(
    *,
    shape: ET.Element[Any],
    slide_index: int,
    source_name: str,
    shape_id: str,
    frame: dict[str, int],
    scale: OoxmlScale,
    z_index: int,
    locked: bool,
    theme_colors: dict[str, str],
    text_style_context: OoxmlTextStyleContext | None,
    warnings: list[str],
) -> dict[str, Any] | None:
    body = first_local_child(shape, "txBody")
    if body is None:
        return None
    append_rich_text_diagnostics(
        body,
        warnings,
        slide_index=slide_index,
        shape_id=shape_id,
    )
    cascade = text_cascade_for_shape(shape, source_name, text_style_context)
    paragraphs = text_paragraphs(body, scale, theme_colors, cascade)
    runs = flatten_paragraph_runs(paragraphs)
    text = "\n".join(str(paragraph.get("text", "")) for paragraph in paragraphs)
    if not text.strip():
        return None
    first_style = next(
        (
            paragraph
            for paragraph in paragraphs
            if str(paragraph.get("text", "")).strip()
        ),
        paragraphs[0],
    )
    props: dict[str, Any] = {
        "text": text,
        "runs": runs,
        "paragraphs": paragraphs,
        "bodyInset": text_body_inset(body, scale, cascade),
        "fontFamily": first_style.get("fontFamily", DEFAULT_PPTX_FONT_FAMILY),
        "fontSize": first_style.get("fontSize", 24),
        "fontWeight": first_style.get("fontWeight", "normal"),
        "color": first_style.get("color", "#111827"),
        "align": paragraphs[0].get("align", "left"),
        "verticalAlign": text_vertical_align(body, cascade),
        "writingMode": text_writing_mode(body, cascade),
        "lineHeight": paragraphs[0].get("lineHeight", 1.15),
    }
    for key in ("italic", "letterSpacing", "underline"):
        if key in first_style:
            props[key] = first_style[key]
    props.update(text_autofit_properties(body, cascade))
    bullet = paragraphs[0].get("bullet")
    if bullet:
        props["bullet"] = bullet
    return {
        **element_base(
            element_id=element_id(slide_index, source_name, shape_id, "text"),
            role="body",
            frame=frame,
            z_index=z_index,
            locked=locked,
        ),
        "type": "text",
        "props": props,
    }


def text_paragraphs(
    body: ET.Element[Any],
    scale: OoxmlScale,
    theme_colors: dict[str, str],
    cascade: OoxmlTextCascade,
) -> list[dict[str, Any]]:
    paragraphs: list[dict[str, Any]] = []
    for paragraph in direct_local_children(body, "p"):
        level = paragraph_level(paragraph)
        paragraph_layers = paragraph_property_layers(
            body,
            paragraph,
            cascade,
            level=level,
        )
        default_run_layers: list[ET.Element[Any]] = []
        for layer in paragraph_layers:
            run_defaults = default_run_properties(layer)
            if run_defaults is not None:
                default_run_layers.append(run_defaults)
        runs, effective_runs = paragraph_runs(
            paragraph,
            scale,
            theme_colors,
            cascade.theme_fonts,
            default_run_layers,
        )
        text = "".join(str(run.get("text", "")) for run in runs)
        props: dict[str, Any] = {
            "text": text,
            "runs": runs,
            "align": paragraph_align_from_layers(paragraph_layers),
            "lineHeight": paragraph_line_height_from_layers(paragraph_layers),
            "spaceBefore": paragraph_spacing_from_layers(
                paragraph_layers,
                "spcBef",
                scale,
            ),
            "spaceAfter": paragraph_spacing_from_layers(
                paragraph_layers,
                "spcAft",
                scale,
            ),
            "indent": paragraph_indent_from_layers(paragraph_layers, scale),
        }
        bullet = paragraph_bullet_from_layers(paragraph_layers, scale)
        if bullet:
            props["bullet"] = bullet
        if effective_runs:
            first_run = next(
                (run for run in effective_runs if str(run.get("text", "")).strip()),
                effective_runs[0],
            )
            for key in (
                "fontFamily",
                "fontSize",
                "fontWeight",
                "italic",
                "letterSpacing",
                "underline",
                "color",
            ):
                if key in first_run:
                    props[key] = first_run[key]
        paragraphs.append(props)
    if paragraphs:
        return paragraphs

    plain = "".join(node.text or "" for node in body.iter() if local_name(node) == "t")
    return [{"text": plain, "runs": [{"text": plain, "baseline": "normal"}]}] if plain else []


def paragraph_runs(
    paragraph: ET.Element[Any],
    scale: OoxmlScale,
    theme_colors: dict[str, str],
    theme_fonts: OoxmlThemeFonts | None = None,
    default_run_layers: list[ET.Element[Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    runs: list[dict[str, Any]] = []
    effective_runs: list[dict[str, Any]] = []
    for child in list(paragraph):
        name = local_name(child)
        if name == "r":
            text = "".join(node.text or "" for node in child.iter() if local_name(node) == "t")
            if text:
                resolved_theme_fonts = theme_fonts or OoxmlThemeFonts()
                direct_properties = run_properties_value(
                    first_local_child(child, "rPr"),
                    scale,
                    theme_colors,
                    resolved_theme_fonts,
                )
                runs.append({"text": text, **direct_properties})
                effective_runs.append(
                    {
                        "text": text,
                        **effective_run_properties(
                            child,
                            scale,
                            theme_colors,
                            resolved_theme_fonts,
                            default_run_layers or [],
                        ),
                    }
                )
        elif name == "br":
            runs.append({"text": "\n", "baseline": "normal"})
            effective_runs.append({"text": "\n", "baseline": "normal"})
    return runs, effective_runs


def append_rich_text_diagnostics(
    body: ET.Element[Any],
    warnings: list[str],
    *,
    slide_index: int,
    shape_id: str,
) -> None:
    for paragraph_index, paragraph in enumerate(direct_local_children(body, "p")):
        run_index = 0
        for child in list(paragraph):
            if local_name(child) != "r":
                continue
            r_pr = first_local_child(child, "rPr")
            if r_pr is None:
                run_index += 1
                continue
            location = (
                f"slide={slide_index}; shape={shape_id}; "
                f"paragraph={paragraph_index}; run={run_index}"
            )
            if (
                first_local_descendant(r_pr, "hlinkClick") is not None
                or first_local_descendant(r_pr, "hlinkMouseOver") is not None
            ):
                warnings.append(f"{RICH_TEXT_UNSUPPORTED_HYPERLINK}: {location}")
            run_index += 1


def flatten_paragraph_runs(paragraphs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    runs: list[dict[str, Any]] = []
    for paragraph_index, paragraph in enumerate(paragraphs):
        if paragraph_index > 0:
            runs.append({"text": "\n", "baseline": "normal"})
        runs.extend(paragraph.get("runs", []))
    return runs


def text_runs(
    body: ET.Element[Any],
    scale: OoxmlScale,
    theme_colors: dict[str, str],
) -> list[dict[str, Any]]:
    runs: list[dict[str, Any]] = []
    paragraphs = direct_local_children(body, "p")
    for paragraph_index, paragraph in enumerate(paragraphs):
        if paragraph_index > 0 and runs:
            runs.append({"text": "\n", "baseline": "normal"})
        for child in list(paragraph):
            name = local_name(child)
            if name == "r":
                text = "".join(node.text or "" for node in child.iter() if local_name(node) == "t")
                if text:
                    runs.append({"text": text, **run_props(child, scale, theme_colors)})
            elif name == "br":
                runs.append({"text": "\n", "baseline": "normal"})
    if not runs:
        plain = "".join(node.text or "" for node in body.iter() if local_name(node) == "t")
        if plain:
            runs.append({"text": plain, "baseline": "normal"})
    return runs


def run_props(
    run: ET.Element[Any],
    scale: OoxmlScale,
    theme_colors: dict[str, str],
) -> dict[str, Any]:
    r_pr = first_local_child(run, "rPr")
    return run_properties_value(r_pr, scale, theme_colors)


def effective_run_properties(
    run: ET.Element[Any],
    scale: OoxmlScale,
    theme_colors: dict[str, str],
    theme_fonts: OoxmlThemeFonts,
    default_run_layers: list[ET.Element[Any]],
) -> dict[str, Any]:
    props: dict[str, Any] = {"baseline": "normal"}
    for layer in default_run_layers:
        props.update(
            run_property_overrides(layer, scale, theme_colors, theme_fonts)
        )
    direct = first_local_child(run, "rPr")
    if direct is not None:
        props.update(
            run_property_overrides(direct, scale, theme_colors, theme_fonts)
        )
    return props


def run_properties_value(
    r_pr: ET.Element[Any] | None,
    scale: OoxmlScale,
    theme_colors: dict[str, str],
    theme_fonts: OoxmlThemeFonts | None = None,
) -> dict[str, Any]:
    props: dict[str, Any] = {"baseline": "normal"}
    if r_pr is None:
        return props
    props.update(
        run_property_overrides(
            r_pr,
            scale,
            theme_colors,
            theme_fonts or OoxmlThemeFonts(),
        )
    )
    return props


def run_property_overrides(
    r_pr: ET.Element[Any],
    scale: OoxmlScale,
    theme_colors: dict[str, str],
    theme_fonts: OoxmlThemeFonts,
) -> dict[str, Any]:
    props: dict[str, Any] = {}
    typeface = run_typeface(r_pr)
    alias_weight: int | None = None
    if typeface:
        typeface = resolve_theme_typeface(typeface, theme_fonts)
        font_family, alias_weight = normalize_pptx_font_family(typeface)
        if font_family:
            props["fontFamily"] = font_family
        if alias_weight is not None:
            props["fontWeight"] = alias_weight
    size = int_attr(r_pr, "sz", 0)
    if size > 0:
        props["fontSize"] = font_size_to_canvas_px(size / 100, scale)
    bold = r_pr.get("b")
    if bold is not None and alias_weight is None:
        props["fontWeight"] = "bold" if bold in {"1", "true"} else "normal"
    italic = r_pr.get("i")
    if italic is not None:
        props["italic"] = italic in {"1", "true"}
    underline = r_pr.get("u")
    if underline is not None:
        props["underline"] = underline not in {"0", "false", "none"}
    spacing = r_pr.get("spc")
    if spacing is not None:
        props["letterSpacing"] = text_point_value_to_canvas_px(
            int_value(spacing, 0),
            scale,
        )
    color = solid_color(first_local_child(r_pr, "solidFill"), theme_colors)
    if color:
        props["color"] = color
    baseline = int_attr(r_pr, "baseline", 0)
    if baseline > 0:
        props["baseline"] = "superscript"
    elif baseline < 0:
        props["baseline"] = "subscript"
    return props


def font_size_to_canvas_px(size_pt: float, scale: OoxmlScale) -> int:
    return max(8, round(size_pt * 12700 * scale.average_scale))


def text_point_value_to_canvas_px(value: int, scale: OoxmlScale) -> float:
    return round(value / 100 * 12700 * scale.average_scale, 3)


def run_typeface(r_pr: ET.Element[Any]) -> str | None:
    for child_name in ("latin", "ea", "cs"):
        child = first_local_child(r_pr, child_name)
        if child is not None and child.get("typeface"):
            return str(child.get("typeface"))
    return None


def resolve_theme_typeface(typeface: str, theme_fonts: OoxmlThemeFonts) -> str:
    mapping = {
        "+mj-lt": theme_fonts.major_latin,
        "+mj-ea": theme_fonts.major_east_asian,
        "+mj-cs": theme_fonts.major_complex_script,
        "+mn-lt": theme_fonts.minor_latin,
        "+mn-ea": theme_fonts.minor_east_asian,
        "+mn-cs": theme_fonts.minor_complex_script,
    }
    return mapping.get(typeface.casefold(), typeface)


def normalize_pptx_font_family(typeface: str) -> tuple[str, int | None]:
    original = typeface.strip()
    alias = PPTX_FONT_FAMILY_ALIASES.get(original.casefold())
    return alias if alias is not None else (original, None)


def append_font_availability_diagnostics(
    root: ET.Element[Any],
    warnings: list[str],
    *,
    slide_index: int,
) -> None:
    unavailable_families: set[str] = set()
    available_families = {
        family.casefold() for family in PPTX_BROWSER_AVAILABLE_FONT_FAMILIES
    }
    for node in root.iter():
        if local_name(node) != "rPr":
            continue
        typeface = run_typeface(node)
        if not typeface or typeface.startswith("+"):
            continue
        family, _weight = normalize_pptx_font_family(typeface)
        if family.casefold() not in available_families:
            unavailable_families.add(bounded_font_family_label(family))

    warnings.extend(
        f"{PPTX_FONT_BROWSER_FALLBACK}: slide={slide_index}; "
        f"family={family}; fallback=Arial"
        for family in sorted(unavailable_families, key=str.casefold)
    )


def bounded_font_family_label(family: str) -> str:
    normalized = " ".join(family.replace(";", " ").split())
    return normalized[:128] or "unknown"


def text_cascade_for_shape(
    shape: ET.Element[Any],
    source_name: str,
    context: OoxmlTextStyleContext | None,
) -> OoxmlTextCascade:
    theme_fonts = context.theme_fonts if context is not None else OoxmlThemeFonts()
    if context is None or source_name != "slide":
        return OoxmlTextCascade(None, None, None, theme_fonts)
    key = placeholder_key(shape)
    layout_shape = matching_placeholder_shape(context.layout, key)
    master_key = placeholder_key(layout_shape) if layout_shape is not None else key
    master_shape = matching_placeholder_shape(context.master, master_key)
    return OoxmlTextCascade(
        layout_shape=layout_shape,
        master_shape=master_shape,
        master_text_style=master_text_style(context.master, key),
        theme_fonts=theme_fonts,
    )


def matching_placeholder_shape(
    root: ET.Element[Any] | None,
    key: tuple[str, str] | None,
) -> ET.Element[Any] | None:
    if root is None or key is None:
        return None
    candidates = [
        node
        for node in root.iter()
        if local_name(node) in {"sp", "graphicFrame"}
        and placeholder_key(node) is not None
    ]
    exact = next((node for node in candidates if placeholder_key(node) == key), None)
    if exact is not None:
        return exact
    placeholder_type, placeholder_index = key
    if placeholder_index:
        for node in candidates:
            candidate_key = placeholder_key(node)
            if candidate_key is not None and candidate_key[1] == placeholder_index:
                return node
    normalized_type = normalized_placeholder_type(placeholder_type)
    for node in candidates:
        candidate_key = placeholder_key(node)
        if (
            candidate_key is not None
            and normalized_placeholder_type(candidate_key[0]) == normalized_type
        ):
            return node
    return None


def normalized_placeholder_type(placeholder_type: str) -> str:
    if placeholder_type in {"ctrTitle", "title"}:
        return "title"
    if placeholder_type in {"body", "obj", "subTitle"}:
        return "body"
    return placeholder_type


def master_text_style(
    master: ET.Element[Any] | None,
    key: tuple[str, str] | None,
) -> ET.Element[Any] | None:
    text_styles = first_local_descendant(master, "txStyles")
    if text_styles is None:
        return None
    placeholder_type = normalized_placeholder_type(key[0]) if key is not None else ""
    style_name = (
        "titleStyle"
        if placeholder_type == "title"
        else "bodyStyle"
        if placeholder_type == "body"
        else "otherStyle"
    )
    return first_local_child(text_styles, style_name)


def paragraph_level(paragraph: ET.Element[Any]) -> int:
    properties = first_local_child(paragraph, "pPr")
    return max(0, min(8, int_attr(properties, "lvl", 0)))


def paragraph_property_layers(
    body: ET.Element[Any],
    paragraph: ET.Element[Any],
    cascade: OoxmlTextCascade,
    *,
    level: int,
) -> list[ET.Element[Any]]:
    layers: list[ET.Element[Any]] = []
    for container in (
        cascade.master_text_style,
        text_body(cascade.master_shape),
        text_body(cascade.layout_shape),
        body,
    ):
        properties = level_paragraph_properties(container, level)
        if properties is not None:
            layers.append(properties)
    direct = first_local_child(paragraph, "pPr")
    if direct is not None:
        layers.append(direct)
    return layers


def text_body(shape: ET.Element[Any] | None) -> ET.Element[Any] | None:
    return first_local_child(shape, "txBody") if shape is not None else None


def level_paragraph_properties(
    container: ET.Element[Any] | None,
    level: int,
) -> ET.Element[Any] | None:
    if container is None:
        return None
    style = (
        first_local_child(container, "lstStyle")
        if local_name(container) == "txBody"
        else container
    )
    properties = first_local_child(style, f"lvl{level + 1}pPr")
    return properties if properties is not None else first_local_child(style, "lvl1pPr")


def default_run_properties(
    paragraph_properties: ET.Element[Any],
) -> ET.Element[Any] | None:
    return first_local_child(paragraph_properties, "defRPr")


def paragraph_align_from_layers(layers: list[ET.Element[Any]]) -> str:
    value = next(
        (str(layer.get("algn")) for layer in reversed(layers) if layer.get("algn")),
        "left",
    )
    return {"ctr": "center", "r": "right", "just": "justify"}.get(value, "left")


def paragraph_line_height_from_layers(layers: list[ET.Element[Any]]) -> float:
    for layer in reversed(layers):
        line_spacing = first_local_child(layer, "lnSpc")
        spacing_pct = first_local_child(line_spacing, "spcPct")
        if spacing_pct is not None:
            return max(
                0.5,
                min(4, int_attr(spacing_pct, "val", 115000) / 100000),
            )
    return 1.15


def paragraph_spacing_from_layers(
    layers: list[ET.Element[Any]],
    tag_name: str,
    scale: OoxmlScale,
) -> int:
    for layer in reversed(layers):
        spacing = first_local_child(layer, tag_name)
        if spacing is None:
            continue
        points = first_local_child(spacing, "spcPts")
        if points is not None:
            return round(
                int_attr(points, "val", 0) / 100 * 12700 * scale.average_scale
            )
        return 0
    return 0


def paragraph_indent_from_layers(
    layers: list[ET.Element[Any]],
    scale: OoxmlScale,
) -> int:
    value = next(
        (int_attr(layer, "marL", 0) for layer in reversed(layers) if layer.get("marL") is not None),
        0,
    )
    return round(value * scale.scale_x)


def paragraph_bullet_from_layers(
    layers: list[ET.Element[Any]],
    scale: OoxmlScale,
) -> dict[str, Any] | None:
    for layer in reversed(layers):
        if first_local_child(layer, "buNone") is not None:
            return None
        bullet = first_local_child(layer, "buChar")
        if bullet is not None:
            return {
                "enabled": True,
                "character": str(bullet.get("char", "\u2022")),
                "indent": max(0, round(int_attr(layer, "marL", 0) * scale.scale_x)),
            }
    return None


def body_property_layers(
    body: ET.Element[Any],
    cascade: OoxmlTextCascade | None,
) -> list[ET.Element[Any]]:
    layers: list[ET.Element[Any]] = []
    for source_body in (
        text_body(cascade.master_shape) if cascade is not None else None,
        text_body(cascade.layout_shape) if cascade is not None else None,
        body,
    ):
        body_properties = first_local_child(source_body, "bodyPr")
        if body_properties is not None:
            layers.append(body_properties)
    return layers


def body_attribute(
    layers: list[ET.Element[Any]],
    name: str,
    fallback: str,
) -> str:
    return next(
        (str(layer.get(name)) for layer in reversed(layers) if layer.get(name) is not None),
        fallback,
    )


def paragraph_align(body: ET.Element[Any]) -> str:
    first_paragraph = first_local_child(body, "p")
    return paragraph_align_value(first_paragraph) if first_paragraph is not None else "left"


def paragraph_align_value(paragraph: ET.Element[Any]) -> str:
    p_pr = first_local_child(paragraph, "pPr")
    align = str(p_pr.get("algn", "left")) if p_pr is not None else "left"
    return {
        "ctr": "center",
        "r": "right",
        "just": "justify",
    }.get(align, "left")


def text_vertical_align(
    body: ET.Element[Any],
    cascade: OoxmlTextCascade | None = None,
) -> str:
    anchor = body_attribute(body_property_layers(body, cascade), "anchor", "t")
    return {
        "ctr": "middle",
        "mid": "middle",
        "b": "bottom",
    }.get(anchor, "top")


def text_writing_mode(
    body: ET.Element[Any],
    cascade: OoxmlTextCascade | None = None,
) -> str:
    vertical = body_attribute(body_property_layers(body, cascade), "vert", "horz")
    return "vertical-270" if vertical == "vert270" else "horizontal"


def paragraph_line_height(body: ET.Element[Any]) -> float:
    first_paragraph = first_local_child(body, "p")
    return (
        paragraph_line_height_value(first_paragraph)
        if first_paragraph is not None
        else 1.15
    )


def paragraph_line_height_value(paragraph: ET.Element[Any]) -> float:
    p_pr = first_local_child(paragraph, "pPr")
    line_spacing = first_local_child(p_pr, "lnSpc") if p_pr is not None else None
    spacing_pct = first_local_child(line_spacing, "spcPct")
    if spacing_pct is None:
        return 1.15
    return max(0.5, min(4, int_attr(spacing_pct, "val", 115000) / 100000))


def text_body_inset(
    body: ET.Element[Any],
    scale: OoxmlScale,
    cascade: OoxmlTextCascade | None = None,
) -> dict[str, int]:
    layers = body_property_layers(body, cascade)
    return {
        "left": max(
            0,
            round(
                int_value(
                    body_attribute(
                        layers,
                        "lIns",
                        str(DEFAULT_TEXT_BODY_HORIZONTAL_INSET_EMU),
                    ),
                    DEFAULT_TEXT_BODY_HORIZONTAL_INSET_EMU,
                )
                * scale.scale_x
            ),
        ),
        "right": max(
            0,
            round(
                int_value(
                    body_attribute(
                        layers,
                        "rIns",
                        str(DEFAULT_TEXT_BODY_HORIZONTAL_INSET_EMU),
                    ),
                    DEFAULT_TEXT_BODY_HORIZONTAL_INSET_EMU,
                )
                * scale.scale_x
            ),
        ),
        "top": max(
            0,
            round(
                int_value(
                    body_attribute(
                        layers,
                        "tIns",
                        str(DEFAULT_TEXT_BODY_VERTICAL_INSET_EMU),
                    ),
                    DEFAULT_TEXT_BODY_VERTICAL_INSET_EMU,
                )
                * scale.scale_y
            ),
        ),
        "bottom": max(
            0,
            round(
                int_value(
                    body_attribute(
                        layers,
                        "bIns",
                        str(DEFAULT_TEXT_BODY_VERTICAL_INSET_EMU),
                    ),
                    DEFAULT_TEXT_BODY_VERTICAL_INSET_EMU,
                )
                * scale.scale_y
            ),
        ),
    }


def text_autofit_properties(
    body: ET.Element[Any],
    cascade: OoxmlTextCascade,
) -> dict[str, Any]:
    for body_properties in reversed(body_property_layers(body, cascade)):
        if first_local_child(body_properties, "noAutofit") is not None:
            return {"autoFit": "none"}
        if first_local_child(body_properties, "spAutoFit") is not None:
            return {"autoFit": "resize-shape"}
        normal = first_local_child(body_properties, "normAutofit")
        if normal is None:
            continue
        return {
            "autoFit": "shrink-text",
            "fontScale": max(
                0.01,
                min(1, int_attr(normal, "fontScale", 100000) / 100000),
            ),
            "lineSpaceReduction": max(
                0,
                min(1, int_attr(normal, "lnSpcReduction", 0) / 100000),
            ),
        }
    return {}


def paragraph_bullet(
    body: ET.Element[Any],
    scale: OoxmlScale,
) -> dict[str, Any] | None:
    first_paragraph = first_local_child(body, "p")
    return (
        paragraph_bullet_value(first_paragraph, scale)
        if first_paragraph is not None
        else None
    )


def paragraph_bullet_value(
    paragraph: ET.Element[Any],
    scale: OoxmlScale,
) -> dict[str, Any] | None:
    p_pr = first_local_child(paragraph, "pPr")
    if p_pr is None:
        return None
    bullet = first_local_child(p_pr, "buChar")
    if bullet is None:
        return None
    return {
        "enabled": True,
        "character": str(bullet.get("char", "\u2022")),
        "indent": max(0, round(int_attr(p_pr, "marL", 0) * scale.scale_x)),
    }


def paragraph_indent_px(paragraph: ET.Element[Any], scale: OoxmlScale) -> int:
    p_pr = first_local_child(paragraph, "pPr")
    return round(int_attr(p_pr, "marL", 0) * scale.scale_x) if p_pr is not None else 0


def paragraph_spacing_px(
    paragraph: ET.Element[Any],
    tag_name: str,
    scale: OoxmlScale,
) -> int:
    p_pr = first_local_child(paragraph, "pPr")
    spacing = first_local_child(p_pr, tag_name) if p_pr is not None else None
    points = first_local_child(spacing, "spcPts") if spacing is not None else None
    return round(int_attr(points, "val", 0) / 100 * 12700 * scale.average_scale)


def shape_fill(
    shape: ET.Element[Any],
    theme_colors: dict[str, str],
) -> Any:
    sp_pr = first_local_child(shape, "spPr")
    if sp_pr is None:
        return "transparent"
    if first_local_child(sp_pr, "noFill") is not None:
        return "transparent"
    grad = first_local_child(sp_pr, "gradFill")
    if grad is not None:
        paint = gradient_paint(grad, theme_colors)
        if paint:
            return paint
    pattern = pattern_paint(first_local_child(sp_pr, "pattFill"), theme_colors)
    if pattern:
        return pattern
    solid = solid_color(first_local_child(sp_pr, "solidFill"), theme_colors)
    return solid or "transparent"


def shape_stroke(
    shape: ET.Element[Any],
    scale: OoxmlScale,
    theme_colors: dict[str, str],
    theme_styles: OoxmlThemeStyles | None = None,
) -> tuple[Any, float, dict[str, Any]]:
    sp_pr = first_local_child(shape, "spPr")
    line = first_local_child(sp_pr, "ln") if sp_pr is not None else None
    placeholder_color: str | None = None
    if line is None:
        line = referenced_theme_line_style(shape, theme_styles)
        placeholder_color = style_reference_color(shape, "lnRef", theme_colors)
    if line is None or first_local_child(line, "noFill") is not None:
        return "transparent", 0, {}
    solid = solid_color_with_placeholder(
        first_local_child(line, "solidFill"),
        theme_colors,
        placeholder_color,
    )
    grad = gradient_paint(first_local_child(line, "gradFill"), theme_colors)
    stroke: Any = grad or solid or "transparent"
    width = int_attr(line, "w", 12700 if stroke != "transparent" else 0)
    extras: dict[str, Any] = {}
    dash = line_dash(line)
    if dash:
        extras["dash"] = dash
    cap = line.get("cap")
    if cap:
        extras["lineCap"] = {"flat": "butt", "rnd": "round", "sq": "square"}.get(
            cap,
            "butt",
        )
    join = line_join(line)
    if join:
        extras["lineJoin"] = join
    return stroke, round(max(0, width * scale.average_scale), 2), extras


def referenced_theme_line_style(
    shape: ET.Element[Any],
    theme_styles: OoxmlThemeStyles | None,
) -> ET.Element[Any] | None:
    if theme_styles is None:
        return None
    style = first_local_child(shape, "style")
    line_ref = first_local_child(style, "lnRef") if style is not None else None
    return theme_style_by_index(theme_styles.line_styles, int_attr(line_ref, "idx", 0))


def style_reference_color(
    shape: ET.Element[Any],
    reference_name: str,
    theme_colors: dict[str, str],
) -> str | None:
    style = first_local_child(shape, "style")
    reference = first_local_child(style, reference_name) if style is not None else None
    return solid_color(reference, theme_colors) if reference is not None else None


def theme_style_by_index(
    styles: tuple[ET.Element[Any], ...],
    index: int,
) -> ET.Element[Any] | None:
    if index <= 0 or index > len(styles):
        return None
    return styles[index - 1]


def line_dash(line: ET.Element[Any]) -> list[int] | None:
    preset = first_local_child(line, "prstDash")
    value = str(preset.get("val", "")) if preset is not None else ""
    return {
        "dash": [8, 4],
        "dashDot": [8, 4, 2, 4],
        "dot": [2, 4],
        "lgDash": [12, 6],
        "sysDash": [8, 4],
        "sysDot": [2, 4],
    }.get(value)


def line_join(line: ET.Element[Any]) -> str | None:
    if first_local_child(line, "round") is not None:
        return "round"
    if first_local_child(line, "bevel") is not None:
        return "bevel"
    if first_local_child(line, "miter") is not None:
        return "miter"
    return None


def gradient_paint(
    gradient: ET.Element[Any] | None,
    theme_colors: dict[str, str],
) -> dict[str, Any] | None:
    if gradient is None:
        return None
    stops = []
    stop_list = first_local_descendant(gradient, "gsLst")
    for stop in list(stop_list) if stop_list is not None else []:
        if local_name(stop) != "gs":
            continue
        color = solid_color(stop, theme_colors)
        if not color:
            continue
        alpha = first_local_descendant(stop, "alpha")
        stops.append(
            {
                "offset": max(0, min(1, int_attr(stop, "pos", 0) / 100000)),
                "color": color,
                "opacity": max(0, min(1, int_attr(alpha, "val", 100000) / 100000)),
            }
        )
    if len(stops) < 2:
        return None
    line = first_local_child(gradient, "lin")
    angle = round(int_attr(line, "ang", 0) / 60000) if line is not None else 0
    return {
        "type": "linear-gradient",
        "angle": angle,
        "stops": sorted(stops, key=lambda stop: float(stop["offset"])),
    }


def pattern_paint(
    pattern: ET.Element[Any] | None,
    theme_colors: dict[str, str],
) -> dict[str, Any] | None:
    if pattern is None:
        return None
    foreground = solid_color(first_local_child(pattern, "fgClr"), theme_colors)
    background = solid_color(first_local_child(pattern, "bgClr"), theme_colors)
    return {
        "type": "pattern",
        "preset": str(pattern.get("prst", "pct20")),
        "foreground": foreground or "#111827",
        "background": background or "#FFFFFF",
    }


def solid_color_with_placeholder(
    container: ET.Element[Any] | None,
    theme_colors: dict[str, str],
    placeholder_color: str | None,
) -> str | None:
    color = solid_color(container, theme_colors)
    if color or container is None or not placeholder_color:
        return color
    scheme = first_local_descendant(container, "schemeClr")
    if scheme is not None and str(scheme.get("val", "")) == "phClr":
        return apply_color_transforms(placeholder_color, scheme)
    return None


def solid_color(
    container: ET.Element[Any] | None,
    theme_colors: dict[str, str],
) -> str | None:
    if container is None:
        return None
    srgb = first_local_descendant(container, "srgbClr")
    if srgb is not None and srgb.get("val"):
        return apply_color_transforms(f"#{str(srgb.get('val')).upper()}", srgb)
    sys = first_local_descendant(container, "sysClr")
    if sys is not None:
        last = sys.get("lastClr")
        if last:
            return apply_color_transforms(f"#{str(last).upper()}", sys)
    scheme = first_local_descendant(container, "schemeClr")
    if scheme is not None:
        color = scheme_color(str(scheme.get("val", "")), theme_colors)
        return apply_color_transforms(color, scheme) if color else None
    return None


def scheme_color(value: str, theme_colors: dict[str, str]) -> str | None:
    lookup = SCHEME_COLOR_ALIASES.get(value, value)
    return theme_colors.get(value) or theme_colors.get(lookup) or FALLBACK_SCHEME_COLORS.get(value)


def shape_shadow(
    shape: ET.Element[Any],
    scale: OoxmlScale,
    theme_colors: dict[str, str],
    theme_styles: OoxmlThemeStyles | None = None,
) -> dict[str, Any] | None:
    shadow = first_local_descendant(shape, "outerShdw")
    placeholder_color: str | None = None
    if shadow is None:
        shadow = referenced_theme_outer_shadow(shape, theme_styles)
        placeholder_color = style_reference_color(shape, "effectRef", theme_colors)
    if shadow is None:
        return None
    color = solid_color_with_placeholder(shadow, theme_colors, placeholder_color) or "#000000"
    blur = round(int_attr(shadow, "blurRad", 0) * scale.average_scale, 2)
    distance = int_attr(shadow, "dist", 0) * scale.average_scale
    direction = math.radians(int_attr(shadow, "dir", 0) / 60000)
    alpha = first_local_descendant(shadow, "alpha")
    return {
        "color": color,
        "blur": blur,
        "offsetX": round(math.cos(direction) * distance, 2),
        "offsetY": round(math.sin(direction) * distance, 2),
        "opacity": max(0, min(1, int_attr(alpha, "val", 25000) / 100000)),
    }


def referenced_theme_outer_shadow(
    shape: ET.Element[Any],
    theme_styles: OoxmlThemeStyles | None,
) -> ET.Element[Any] | None:
    if theme_styles is None:
        return None
    style = first_local_child(shape, "style")
    effect_ref = first_local_child(style, "effectRef") if style is not None else None
    effect_style = theme_style_by_index(
        theme_styles.effect_styles,
        int_attr(effect_ref, "idx", 0),
    )
    return first_local_descendant(effect_style, "outerShdw")


def image_crop(shape: ET.Element[Any]) -> dict[str, float] | None:
    src_rect = first_local_descendant(shape, "srcRect")
    if src_rect is None:
        return None
    crop = {
        "left": pct_attr(src_rect, "l"),
        "top": pct_attr(src_rect, "t"),
        "right": pct_attr(src_rect, "r"),
        "bottom": pct_attr(src_rect, "b"),
    }
    return crop if any(value > 0 for value in crop.values()) else None


def pct_attr(element: ET.Element[Any], name: str) -> float:
    return max(0, min(0.99, int_attr(element, name, 0) / 100000))


def shape_frame(
    shape: ET.Element[Any],
    scale: OoxmlScale,
    transform: OoxmlTransform,
    placeholder_frames: dict[tuple[str, str], dict[str, int]],
) -> dict[str, int] | None:
    xfrm = first_local_descendant(shape, "xfrm")
    if xfrm is None or first_local_child(xfrm, "off") is None:
        key = placeholder_key(shape)
        if key is not None:
            fallback = placeholder_frames.get(key) or placeholder_frames.get((key[0], ""))
            if fallback is not None:
                return fallback
        return None
    off = first_local_child(xfrm, "off")
    ext = first_local_child(xfrm, "ext")
    raw_x, raw_y, raw_width, raw_height = transform.rect(
        int_attr(off, "x", 0),
        int_attr(off, "y", 0),
        max(1, int_attr(ext, "cx", 1)),
        max(1, int_attr(ext, "cy", 1)),
    )
    x = max(0, round(raw_x * scale.scale_x))
    y = max(0, round(raw_y * scale.scale_y))
    width = max(1, round(raw_width * scale.scale_x))
    height = max(1, round(raw_height * scale.scale_y))
    rotation = round(int_attr(xfrm, "rot", 0) / 60000)
    return {
        "x": min(x, scale.canvas_width - 1),
        "y": min(y, scale.canvas_height - 1),
        "width": min(width, scale.canvas_width - min(x, scale.canvas_width - 1)),
        "height": min(height, scale.canvas_height - min(y, scale.canvas_height - 1)),
        "rotation": rotation,
    }


def placeholder_frame_map(
    root: ET.Element[Any] | None,
    scale: OoxmlScale,
) -> dict[tuple[str, str], dict[str, int]]:
    if root is None:
        return {}
    frames: dict[tuple[str, str], dict[str, int]] = {}
    for shape in root.iter():
        key = placeholder_key(shape)
        if key is None:
            continue
        frame = shape_frame(shape, scale, OoxmlTransform(), {})
        if frame is not None:
            frames[key] = frame
            if key[0] and (key[0], "") not in frames:
                frames[(key[0], "")] = frame
    return frames


def placeholder_key(shape: ET.Element[Any]) -> tuple[str, str] | None:
    ph = first_local_descendant(shape, "ph")
    if ph is None:
        return None
    return str(ph.get("type", "")), str(ph.get("idx", ""))


def shape_source(
    shape: ET.Element[Any],
    part_path: str,
    shape_id: str,
    source_name: str,
    locked: bool,
) -> dict[str, Any]:
    ph_key = placeholder_key(shape)
    source_type = "placeholder" if ph_key is not None and source_name == "slide" else source_name
    source = {
        "type": source_type,
        "name": shape_name(shape) or "shape",
        "slidePart": part_path,
        "shapeId": shape_id,
        "writable": not locked and source_name == "slide",
    }
    if ph_key is not None and ph_key[0]:
        source["placeholderType"] = ph_key[0]
    relationship_id = attr_by_local_name(first_local_descendant(shape, "blip"), "embed")
    if relationship_id:
        source["relationshipId"] = relationship_id
    return source


def background_element(
    slide_index: int,
    canvas_width: int,
    canvas_height: int,
) -> dict[str, Any]:
    return {
        **element_base(
            element_id=f"el_ooxml_{slide_index}_background",
            role="background",
            frame={"x": 0, "y": 0, "width": canvas_width, "height": canvas_height},
            z_index=0,
            locked=True,
        ),
        "type": "rect",
        "props": {
            "fill": "#FFFFFF",
            "stroke": "transparent",
            "strokeWidth": 0,
            "borderRadius": 0,
        },
    }


def element_base(
    *,
    element_id: str,
    role: str,
    frame: dict[str, int],
    z_index: int,
    locked: bool,
) -> dict[str, Any]:
    return {
        "elementId": element_id,
        "role": role,
        "x": frame["x"],
        "y": frame["y"],
        "width": frame["width"],
        "height": frame["height"],
        "rotation": frame.get("rotation", 0),
        "opacity": 1,
        "zIndex": z_index,
        "locked": locked,
        "visible": True,
    }


def shape_type_for_preset(token: str, tag: str) -> str:
    if tag == "cxnSp" or token in {"line", "straightConnector1"}:
        return "line"
    if token in {"ellipse", "oval"}:
        return "ellipse"
    if "donut" in token:
        return "ring"
    if "star" in token:
        return "star"
    if preset_custom_shape_path(token):
        return "customShape"
    return "rect"


def preset_token(shape: ET.Element[Any]) -> str:
    preset = first_local_descendant(shape, "prstGeom")
    return str(preset.get("prst", "rect")) if preset is not None else "rect"


def shape_identifier(shape: ET.Element[Any], fallback_index: int) -> str:
    c_nv_pr = first_local_descendant(shape, "cNvPr")
    return safe_id(str(c_nv_pr.get("id", ""))) if c_nv_pr is not None else str(fallback_index)


def shape_name(shape: ET.Element[Any]) -> str:
    c_nv_pr = first_local_descendant(shape, "cNvPr")
    return str(c_nv_pr.get("descr") or c_nv_pr.get("name") or "") if c_nv_pr is not None else ""


def graphic_frame_kind(frame_element: ET.Element[Any]) -> str:
    if first_local_descendant(frame_element, "tbl") is not None:
        return "table"
    if first_local_descendant(frame_element, "chart") is not None:
        return "chart"
    return "graphic"


def element_id(
    slide_index: int,
    source_name: str,
    shape_id: str,
    kind: str,
) -> str:
    return f"el_ooxml_{slide_index}_{safe_id(source_name)}_{safe_id(shape_id)}_{kind}"


def slide_background_color(
    slide: ET.Element[Any],
    theme_colors: dict[str, str],
) -> str | None:
    background = first_local_descendant(slide, "bgPr")
    return (
        solid_color(first_local_child(background, "solidFill"), theme_colors)
        if background is not None
        else None
    )
