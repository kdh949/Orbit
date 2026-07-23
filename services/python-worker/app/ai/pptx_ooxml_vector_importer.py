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

PML_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
DML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
ORBIT_OOXML_NS = "urn:orbit:deck:ooxml"
TABLE_GRAPHIC_DATA_URI = (
    "http://schemas.openxmlformats.org/drawingml/2006/table"
)

SLIDE_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
)
SLIDE_LAYOUT_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"
)
SLIDE_MASTER_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster"
)
IMAGE_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
)
THEME_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"
)
VECTOR_IMPORT_FLAG = "ORBIT_PPTX_OOXML_VECTOR_IMPORT"
DEFAULT_TEXT_BODY_HORIZONTAL_INSET_EMU = 91440
DEFAULT_TEXT_BODY_VERTICAL_INSET_EMU = 45720
DEFAULT_PPTX_FONT_FAMILY = "Aptos, Calibri, Arial, sans-serif"
RICH_TEXT_UNSUPPORTED_HYPERLINK = "PPTX_RICH_TEXT_UNSUPPORTED_HYPERLINK"
TABLE_STRUCTURE_UNSUPPORTED = "PPTX_TABLE_STRUCTURE_UNSUPPORTED"
TABLE_TRACK_MISMATCH = "PPTX_TABLE_TRACK_MISMATCH"
MAX_TABLE_CELL_LOCATORS = 10_000
MAX_MOTION_DIAGNOSTIC_DETAILS = 500
FALLBACK_SCHEME_COLORS = {
    "bg1": "#FFFFFF",
    "tx1": "#111827",
    "bg2": "#FFFFFF",
    "tx2": "#111827",
    "accent1": "#2563EB",
    "accent2": "#7C3AED",
    "accent3": "#0EA5E9",
    "accent4": "#10B981",
    "accent5": "#F59E0B",
    "accent6": "#EF4444",
    "dk1": "#111827",
    "lt1": "#FFFFFF",
    "dk2": "#111827",
    "lt2": "#FFFFFF",
}
SCHEME_COLOR_ALIASES = {
    "bg1": "lt1",
    "tx1": "dk1",
    "bg2": "lt2",
    "tx2": "dk2",
}


def import_pptx_design_with_optional_ooxml_vector(
    path: Path,
    file_id: str,
    *,
    canvas_width: int = CANVAS_WIDTH,
    canvas_height: int = CANVAS_HEIGHT,
) -> PptxDesignImportResult:
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
class OoxmlScale:
    canvas_width: int
    canvas_height: int
    slide_width_emu: int
    slide_height_emu: int

    @property
    def scale_x(self) -> float:
        return self.canvas_width / max(1, self.slide_width_emu)

    @property
    def scale_y(self) -> float:
        return self.canvas_height / max(1, self.slide_height_emu)

    @property
    def average_scale(self) -> float:
        return (self.scale_x + self.scale_y) / 2


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


@dataclass
class OoxmlImportState:
    assets: list[ImportedDesignAsset]
    asset_colors: dict[str, str]
    theme_colors: dict[str, str]
    theme_styles: OoxmlThemeStyles
    warnings: list[str]
    z_cursor: int = 1

    def next_z(self) -> int:
        value = self.z_cursor
        self.z_cursor += 1
        return value


@dataclass(frozen=True)
class OoxmlThemeStyles:
    line_styles: tuple[ET.Element[Any], ...] = ()
    effect_styles: tuple[ET.Element[Any], ...] = ()


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
            asset_colors={},
            theme_colors=theme_color_map(package),
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
            source["type"] = "chart"
            relationship_id = attr_by_local_name(
                first_local_descendant(frame_element, "chart"),
                "id",
            )
            if relationship_id:
                source["relationshipId"] = relationship_id
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
    if not rel:
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
    image_part = resolve_part_path(part_path, rel.get("Target", ""))
    if image_part not in package.namelist():
        state.warnings.append(
            f"OOXML image part missing on slide {slide_index}: {image_part}"
        )
        return None
    blob = package.read(image_part)
    asset_id = f"image_{len(state.assets) + 1}"
    mime_type = mime_type_for_part(content_types, image_part)
    state.assets.append(
        ImportedDesignAsset(
            assetId=asset_id,
            fileName=f"{asset_id}.{extension_for_mime_type(mime_type)}",
            mimeType=mime_type,
            contentBase64=base64.b64encode(blob).decode("ascii"),
        )
    )
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
    paragraphs = text_paragraphs(body, scale, theme_colors)
    runs = flatten_paragraph_runs(paragraphs)
    text = "\n".join(str(paragraph.get("text", "")) for paragraph in paragraphs)
    if not text.strip():
        return None
    first_run = next((run for run in runs if str(run.get("text", "")).strip()), runs[0])
    props: dict[str, Any] = {
        "text": text,
        "runs": runs,
        "paragraphs": paragraphs,
        "bodyInset": text_body_inset(body, scale),
        "fontFamily": first_run.get("fontFamily", DEFAULT_PPTX_FONT_FAMILY),
        "fontSize": first_run.get("fontSize", 24),
        "fontWeight": first_run.get("fontWeight", "normal"),
        "color": first_run.get("color", "#111827"),
        "align": paragraph_align(body),
        "verticalAlign": text_vertical_align(body),
        "writingMode": text_writing_mode(body),
        "lineHeight": paragraph_line_height(body),
    }
    for key in ("italic", "underline"):
        if key in first_run:
            props[key] = first_run[key]
    bullet = paragraph_bullet(body, scale)
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
) -> list[dict[str, Any]]:
    paragraphs: list[dict[str, Any]] = []
    for paragraph in direct_local_children(body, "p"):
        runs = paragraph_runs(paragraph, scale, theme_colors)
        text = "".join(str(run.get("text", "")) for run in runs)
        props: dict[str, Any] = {
            "text": text,
            "runs": runs,
            "align": paragraph_align_value(paragraph),
            "lineHeight": paragraph_line_height_value(paragraph),
            "spaceBefore": paragraph_spacing_px(paragraph, "spcBef", scale),
            "spaceAfter": paragraph_spacing_px(paragraph, "spcAft", scale),
            "indent": paragraph_indent_px(paragraph, scale),
        }
        bullet = paragraph_bullet_value(paragraph, scale)
        if bullet:
            props["bullet"] = bullet
        if runs:
            first_run = next(
                (run for run in runs if str(run.get("text", "")).strip()),
                runs[0],
            )
            for key in (
                "fontFamily",
                "fontSize",
                "fontWeight",
                "italic",
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
) -> list[dict[str, Any]]:
    runs: list[dict[str, Any]] = []
    for child in list(paragraph):
        name = local_name(child)
        if name == "r":
            text = "".join(node.text or "" for node in child.iter() if local_name(node) == "t")
            if text:
                runs.append({"text": text, **run_props(child, scale, theme_colors)})
        elif name == "br":
            runs.append({"text": "\n", "baseline": "normal"})
    return runs


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


def run_properties_value(
    r_pr: ET.Element[Any] | None,
    scale: OoxmlScale,
    theme_colors: dict[str, str],
) -> dict[str, Any]:
    props: dict[str, Any] = {"baseline": "normal"}
    if r_pr is None:
        return props
    typeface = run_typeface(r_pr)
    if typeface:
        props["fontFamily"] = typeface
    size = int_attr(r_pr, "sz", 0)
    if size > 0:
        props["fontSize"] = font_size_to_canvas_px(size / 100, scale)
    spacing = r_pr.get("spc")
    if spacing is not None:
        props["letterSpacing"] = round(
            int_attr(r_pr, "spc", 0) / 100 * 12700 * scale.average_scale,
            3,
        )
    bold = r_pr.get("b")
    if bold is not None:
        props["fontWeight"] = "bold" if bold in {"1", "true"} else "normal"
    italic = r_pr.get("i")
    if italic is not None:
        props["italic"] = italic in {"1", "true"}
    underline = r_pr.get("u")
    if underline is not None:
        props["underline"] = underline not in {"0", "false", "none"}
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


def run_typeface(r_pr: ET.Element[Any]) -> str | None:
    for child_name in ("latin", "ea", "cs"):
        child = first_local_child(r_pr, child_name)
        if child is not None and child.get("typeface"):
            return str(child.get("typeface"))
    return None


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


def text_vertical_align(body: ET.Element[Any]) -> str:
    body_pr = first_local_child(body, "bodyPr")
    anchor = str(body_pr.get("anchor", "t")) if body_pr is not None else "t"
    return {
        "ctr": "middle",
        "mid": "middle",
        "b": "bottom",
    }.get(anchor, "top")


def text_writing_mode(body: ET.Element[Any]) -> str:
    body_pr = first_local_child(body, "bodyPr")
    vertical = str(body_pr.get("vert", "horz")) if body_pr is not None else "horz"
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


def text_body_inset(body: ET.Element[Any], scale: OoxmlScale) -> dict[str, int]:
    body_pr = first_local_child(body, "bodyPr")
    if body_pr is None:
        return {"left": 0, "right": 0, "top": 0, "bottom": 0}
    return {
        "left": max(
            0,
            round(
                int_attr(body_pr, "lIns", DEFAULT_TEXT_BODY_HORIZONTAL_INSET_EMU)
                * scale.scale_x
            ),
        ),
        "right": max(
            0,
            round(
                int_attr(body_pr, "rIns", DEFAULT_TEXT_BODY_HORIZONTAL_INSET_EMU)
                * scale.scale_x
            ),
        ),
        "top": max(
            0,
            round(
                int_attr(body_pr, "tIns", DEFAULT_TEXT_BODY_VERTICAL_INSET_EMU)
                * scale.scale_y
            ),
        ),
        "bottom": max(
            0,
            round(
                int_attr(body_pr, "bIns", DEFAULT_TEXT_BODY_VERTICAL_INSET_EMU)
                * scale.scale_y
            ),
        ),
    }


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
        if rel and rel.get("Type") == SLIDE_REL_TYPE:
            slide_parts.append(resolve_part_path("ppt/presentation.xml", rel.get("Target", "")))
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
        if rel.get("Type") == rel_type and rel.get("Target"):
            return resolve_part_path(part_path, rel["Target"])
    return None


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
