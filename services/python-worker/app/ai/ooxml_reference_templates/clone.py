from __future__ import annotations

import copy
import posixpath
import re
import tempfile
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET

from app.ai.ooxml_reference_templates.inventory import (
    OFFICE_RELATIONSHIPS_NS,
    PACKAGE_RELATIONSHIPS_NS,
    PRESENTATION_NS,
    ReferenceSource,
    inspect_reference_package,
)
from app.ai.ooxml_reference_templates.package import validate_cloned_package


CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
_SLIDE_PART = re.compile(r"^ppt/slides/slide[0-9]+\.xml$")
class CloneError(ValueError):
    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


@dataclass(frozen=True)
class SlideClone:
    source_slide_part: str
    cloned_slide_part: str
    presentation_slide_id: str
    presentation_relationship_id: str
    layout_part: str
    master_part: str
    theme_part: str
    notes_parts: tuple[str, ...]
    media_parts: tuple[str, ...]
    chart_parts: tuple[str, ...]
    workbook_parts: tuple[str, ...]


@dataclass(frozen=True)
class CloneResult:
    package_bytes: bytes
    clones: tuple[SlideClone, ...]
    identity_control_slide_count: int


@dataclass
class _CloneCounters:
    notes: int = 0
    charts: int = 0
    workbooks: int = 0
    chart_styles: int = 0
    chart_colors: int = 0


def clone_source_slides(
    source_package_bytes: bytes,
    *,
    source_slide_parts: list[str],
    identity_control: bool = False,
) -> CloneResult:
    if not source_slide_parts or len(source_slide_parts) > 500:
        raise CloneError("INVALID_SLIDE_SELECTION", "select 1-500 source slides")
    if any(_SLIDE_PART.fullmatch(part) is None for part in source_slide_parts):
        raise CloneError(
            "INVALID_SLIDE_SELECTION", "source slide part is not canonical"
        )
    _preflight_source_bytes(source_package_bytes)

    try:
        with zipfile.ZipFile(BytesIO(source_package_bytes), "r") as source:
            source_infos = {item.filename: item for item in source.infolist()}
            source_parts = {
                name: source.read(name)
                for name, info in source_infos.items()
                if not info.is_dir()
            }
    except (OSError, zipfile.BadZipFile, KeyError) as error:
        raise CloneError("MALFORMED_SOURCE_PACKAGE", "source package cannot be read") from error

    missing = [part for part in source_slide_parts if part not in source_parts]
    if missing:
        raise CloneError("SOURCE_SLIDE_MISSING", "selected source slide is missing")

    removed_parts = _collect_original_mutable_parts(source_parts)
    output_parts = {
        name: content
        for name, content in source_parts.items()
        if name not in removed_parts
    }
    new_part_sources: dict[str, str] = {}
    counters = _CloneCounters()
    clone_records: list[SlideClone] = []

    presentation = ET.fromstring(source_parts["ppt/presentation.xml"])
    presentation_rels = ET.fromstring(
        source_parts["ppt/_rels/presentation.xml.rels"]
    )
    slide_id_list = presentation.find(f"{{{PRESENTATION_NS}}}sldIdLst")
    if slide_id_list is None:
        slide_id_list = ET.SubElement(
            presentation, f"{{{PRESENTATION_NS}}}sldIdLst"
        )
    original_slide_ids = [
        int(item.attrib["id"])
        for item in slide_id_list.findall(f"{{{PRESENTATION_NS}}}sldId")
    ]
    for item in list(slide_id_list):
        slide_id_list.remove(item)
    for relationship in list(presentation_rels):
        if relationship.attrib.get("Type", "").endswith("/slide"):
            presentation_rels.remove(relationship)
    next_slide_id = max(original_slide_ids, default=255) + 1
    next_presentation_rid = _next_relationship_number(presentation_rels)

    for index, source_slide_part in enumerate(source_slide_parts, start=1):
        cloned_slide_part = f"ppt/slides/slide{index}.xml"
        output_parts[cloned_slide_part] = source_parts[source_slide_part]
        new_part_sources[cloned_slide_part] = source_slide_part

        source_rels_part = _rels_part(source_slide_part)
        if source_rels_part not in source_parts:
            raise CloneError(
                "SOURCE_RELATIONSHIPS_MISSING", "source slide relationships are missing"
            )
        slide_rels = ET.fromstring(source_parts[source_rels_part])
        notes_parts: list[str] = []
        media_parts: list[str] = []
        chart_parts: list[str] = []
        workbook_parts: list[str] = []
        layout_part = ""
        for relationship in slide_rels.findall(
            f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship"
        ):
            relationship_type = relationship.attrib["Type"].rsplit("/", 1)[-1]
            source_target = _resolve_target(
                source_slide_part, relationship.attrib["Target"]
            )
            if relationship_type == "slideLayout":
                layout_part = source_target
            elif relationship_type == "image":
                media_parts.append(source_target)
            elif relationship_type == "notesSlide":
                cloned_target = _clone_notes_part(
                    source_parts,
                    output_parts,
                    new_part_sources,
                    counters,
                    source_target,
                    cloned_slide_part,
                )
                notes_parts.append(cloned_target)
                relationship.attrib["Target"] = _relative_target(
                    cloned_slide_part, cloned_target
                )
            elif relationship_type == "chart":
                cloned_target, cloned_workbooks = _clone_chart_part(
                    source_parts,
                    output_parts,
                    new_part_sources,
                    counters,
                    source_target,
                )
                chart_parts.append(cloned_target)
                workbook_parts.extend(cloned_workbooks)
                relationship.attrib["Target"] = _relative_target(
                    cloned_slide_part, cloned_target
                )

        cloned_rels_part = _rels_part(cloned_slide_part)
        output_parts[cloned_rels_part] = _xml_bytes(slide_rels)
        new_part_sources[cloned_rels_part] = source_rels_part

        master_part, theme_part = _layout_master_theme(source_parts, layout_part)
        presentation_relationship_id = f"rId{next_presentation_rid}"
        presentation_slide_id = str(next_slide_id)
        next_presentation_rid += 1
        next_slide_id += 1
        ET.SubElement(
            slide_id_list,
            f"{{{PRESENTATION_NS}}}sldId",
            {
                "id": presentation_slide_id,
                f"{{{OFFICE_RELATIONSHIPS_NS}}}id": presentation_relationship_id,
            },
        )
        ET.SubElement(
            presentation_rels,
            f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship",
            {
                "Id": presentation_relationship_id,
                "Type": f"{OFFICE_RELATIONSHIPS_NS}/slide",
                "Target": _relative_target(
                    "ppt/presentation.xml", cloned_slide_part
                ),
            },
        )
        clone_records.append(
            SlideClone(
                source_slide_part=source_slide_part,
                cloned_slide_part=cloned_slide_part,
                presentation_slide_id=presentation_slide_id,
                presentation_relationship_id=presentation_relationship_id,
                layout_part=layout_part,
                master_part=master_part,
                theme_part=theme_part,
                notes_parts=tuple(notes_parts),
                media_parts=tuple(media_parts),
                chart_parts=tuple(chart_parts),
                workbook_parts=tuple(workbook_parts),
            )
        )

    output_parts["ppt/presentation.xml"] = _xml_bytes(presentation)
    output_parts["ppt/_rels/presentation.xml.rels"] = _xml_bytes(
        presentation_rels
    )
    output_parts["[Content_Types].xml"] = _rewrite_content_types(
        source_parts["[Content_Types].xml"], removed_parts, new_part_sources
    )

    package_bytes = _write_package(output_parts, source_infos, new_part_sources)
    warnings = validate_cloned_package(package_bytes)
    if warnings:
        raise CloneError(
            "CLONED_PACKAGE_INVALID", ",".join(warnings)
        )
    return CloneResult(
        package_bytes=package_bytes,
        clones=tuple(clone_records),
        identity_control_slide_count=len(clone_records) if identity_control else 0,
    )


def _preflight_source_bytes(content: bytes) -> None:
    try:
        with tempfile.NamedTemporaryFile(suffix=".pptx") as temporary:
            temporary.write(content)
            temporary.flush()
            inspect_reference_package(
                ReferenceSource(template_id="clone-source", path=Path(temporary.name))
            )
    except Exception as error:
        if isinstance(error, CloneError):
            raise
        raise CloneError(
            "SOURCE_PREFLIGHT_FAILED", "source package failed security preflight"
        ) from error


def _collect_original_mutable_parts(source_parts: dict[str, bytes]) -> set[str]:
    removed: set[str] = set()
    slide_parts = sorted(part for part in source_parts if _SLIDE_PART.fullmatch(part))
    for slide_part in slide_parts:
        removed.add(slide_part)
        rels_part = _rels_part(slide_part)
        removed.add(rels_part)
        if rels_part not in source_parts:
            continue
        relationships = ET.fromstring(source_parts[rels_part])
        for relationship in relationships.findall(
            f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship"
        ):
            relationship_type = relationship.attrib.get("Type", "").rsplit("/", 1)[-1]
            if relationship_type not in {"notesSlide", "chart"}:
                continue
            target = _resolve_target(slide_part, relationship.attrib["Target"])
            removed.add(target)
            target_rels = _rels_part(target)
            removed.add(target_rels)
            if target_rels not in source_parts:
                continue
            child_relationships = ET.fromstring(source_parts[target_rels])
            for child in child_relationships.findall(
                f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship"
            ):
                child_type = child.attrib.get("Type", "").rsplit("/", 1)[-1]
                if relationship_type == "chart" and child_type in {
                    "package",
                    "chartStyle",
                    "chartColorStyle",
                }:
                    removed.add(_resolve_target(target, child.attrib["Target"]))
    return {part for part in removed if part in source_parts}


def _clone_notes_part(
    source_parts: dict[str, bytes],
    output_parts: dict[str, bytes],
    new_part_sources: dict[str, str],
    counters: _CloneCounters,
    source_notes_part: str,
    cloned_slide_part: str,
) -> str:
    counters.notes += 1
    cloned_notes_part = f"ppt/notesSlides/notesSlide{counters.notes}.xml"
    output_parts[cloned_notes_part] = source_parts[source_notes_part]
    new_part_sources[cloned_notes_part] = source_notes_part
    source_rels_part = _rels_part(source_notes_part)
    relationships = ET.fromstring(source_parts[source_rels_part])
    for relationship in relationships.findall(
        f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship"
    ):
        if relationship.attrib.get("Type", "").endswith("/slide"):
            relationship.attrib["Target"] = _relative_target(
                cloned_notes_part, cloned_slide_part
            )
    cloned_rels_part = _rels_part(cloned_notes_part)
    output_parts[cloned_rels_part] = _xml_bytes(relationships)
    new_part_sources[cloned_rels_part] = source_rels_part
    return cloned_notes_part


def _clone_chart_part(
    source_parts: dict[str, bytes],
    output_parts: dict[str, bytes],
    new_part_sources: dict[str, str],
    counters: _CloneCounters,
    source_chart_part: str,
) -> tuple[str, list[str]]:
    counters.charts += 1
    cloned_chart_part = f"ppt/charts/chart{counters.charts}.xml"
    output_parts[cloned_chart_part] = source_parts[source_chart_part]
    new_part_sources[cloned_chart_part] = source_chart_part
    source_rels_part = _rels_part(source_chart_part)
    cloned_workbooks: list[str] = []
    if source_rels_part in source_parts:
        relationships = ET.fromstring(source_parts[source_rels_part])
        for relationship in relationships.findall(
            f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship"
        ):
            relationship_type = relationship.attrib.get("Type", "").rsplit("/", 1)[
                -1
            ]
            if relationship_type == "package":
                source_workbook = _resolve_target(
                    source_chart_part, relationship.attrib["Target"]
                )
                counters.workbooks += 1
                suffix = PurePosixPath(source_workbook).suffix or ".xlsx"
                cloned_workbook = (
                    "ppt/embeddings/"
                    f"Microsoft_Excel_Worksheet{counters.workbooks}{suffix}"
                )
                output_parts[cloned_workbook] = source_parts[source_workbook]
                new_part_sources[cloned_workbook] = source_workbook
                relationship.attrib["Target"] = _relative_target(
                    cloned_chart_part, cloned_workbook
                )
                cloned_workbooks.append(cloned_workbook)
            elif relationship_type in {"chartStyle", "chartColorStyle"}:
                source_auxiliary = _resolve_target(
                    source_chart_part, relationship.attrib["Target"]
                )
                if relationship_type == "chartStyle":
                    counters.chart_styles += 1
                    cloned_auxiliary = (
                        f"ppt/charts/style{counters.chart_styles}.xml"
                    )
                else:
                    counters.chart_colors += 1
                    cloned_auxiliary = (
                        f"ppt/charts/colors{counters.chart_colors}.xml"
                    )
                output_parts[cloned_auxiliary] = source_parts[source_auxiliary]
                new_part_sources[cloned_auxiliary] = source_auxiliary
                relationship.attrib["Target"] = _relative_target(
                    cloned_chart_part, cloned_auxiliary
                )
        cloned_rels_part = _rels_part(cloned_chart_part)
        output_parts[cloned_rels_part] = _xml_bytes(relationships)
        new_part_sources[cloned_rels_part] = source_rels_part
    return cloned_chart_part, cloned_workbooks


def _layout_master_theme(
    source_parts: dict[str, bytes], layout_part: str
) -> tuple[str, str]:
    if not layout_part:
        raise CloneError("LAYOUT_RELATIONSHIP_MISSING", "slide layout is missing")
    layout_rels = ET.fromstring(source_parts[_rels_part(layout_part)])
    master_part = _single_related_part(layout_part, layout_rels, "slideMaster")
    master_rels = ET.fromstring(source_parts[_rels_part(master_part)])
    theme_part = _single_related_part(master_part, master_rels, "theme")
    return master_part, theme_part


def _single_related_part(
    source_part: str, relationships: ET.Element[str], suffix: str
) -> str:
    matches = [
        _resolve_target(source_part, relationship.attrib["Target"])
        for relationship in relationships.findall(
            f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship"
        )
        if relationship.attrib.get("Type", "").endswith(f"/{suffix}")
    ]
    if len(matches) != 1:
        raise CloneError(
            "TRANSITIVE_RELATIONSHIP_INVALID",
            f"expected exactly one {suffix} relationship",
        )
    return matches[0]


def _rewrite_content_types(
    content: bytes,
    removed_parts: set[str],
    new_part_sources: dict[str, str],
) -> bytes:
    root = ET.fromstring(content)
    content_type_by_source: dict[str, str] = {}
    for child in list(root):
        if child.tag.rsplit("}", 1)[-1] != "Override":
            continue
        source_part = child.attrib["PartName"].lstrip("/")
        content_type_by_source[source_part] = child.attrib["ContentType"]
        if source_part in removed_parts:
            root.remove(child)
    existing = {
        child.attrib["PartName"].lstrip("/")
        for child in root
        if child.tag.rsplit("}", 1)[-1] == "Override"
    }
    for new_part, source_part in sorted(new_part_sources.items()):
        content_type = content_type_by_source.get(source_part)
        if content_type is None or new_part in existing:
            continue
        ET.SubElement(
            root,
            f"{{{CONTENT_TYPES_NS}}}Override",
            {"PartName": f"/{new_part}", "ContentType": content_type},
        )
        existing.add(new_part)
    return _xml_bytes(root)


def _write_package(
    parts: dict[str, bytes],
    source_infos: dict[str, zipfile.ZipInfo],
    new_part_sources: dict[str, str],
) -> bytes:
    output = BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as package:
        for name in sorted(parts):
            source_name = new_part_sources.get(name, name)
            source_info = source_infos.get(source_name)
            if source_info is None:
                package.writestr(name, parts[name])
                continue
            info = copy.copy(source_info)
            info.filename = name
            package.writestr(info, parts[name])
    return output.getvalue()


def _next_relationship_number(relationships: ET.Element[str]) -> int:
    values = []
    for relationship in relationships:
        relationship_id = relationship.attrib.get("Id", "")
        if relationship_id.startswith("rId") and relationship_id[3:].isdigit():
            values.append(int(relationship_id[3:]))
    return max(values, default=0) + 1


def _rels_part(part: str) -> str:
    path = PurePosixPath(part)
    return str(path.parent / "_rels" / f"{path.name}.rels")


def _resolve_target(source_part: str, target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join(posixpath.dirname(source_part), target))


def _relative_target(source_part: str, target_part: str) -> str:
    return posixpath.relpath(target_part, posixpath.dirname(source_part))


def _xml_bytes(root: ET.Element[str]) -> bytes:
    namespace = root.tag.removeprefix("{").split("}", 1)[0]
    if namespace in {PACKAGE_RELATIONSHIPS_NS, CONTENT_TYPES_NS}:
        ET.register_namespace("", namespace)
    elif namespace == PRESENTATION_NS:
        ET.register_namespace("p", PRESENTATION_NS)
        ET.register_namespace("r", OFFICE_RELATIONSHIPS_NS)
        ET.register_namespace(
            "a", "http://schemas.openxmlformats.org/drawingml/2006/main"
        )
        ET.register_namespace(
            "p14", "http://schemas.microsoft.com/office/powerpoint/2012/main"
        )
    body = bytes(ET.tostring(root, encoding="utf-8", xml_declaration=False))
    return b"<?xml version='1.0' encoding='UTF-8' standalone='yes'?>\n" + body
