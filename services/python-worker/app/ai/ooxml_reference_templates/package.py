from __future__ import annotations

import posixpath
import zipfile
from io import BytesIO
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET


CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
PACKAGE_RELATIONSHIPS_NS = (
    "http://schemas.openxmlformats.org/package/2006/relationships"
)
PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
OFFICE_RELATIONSHIPS_NS = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
)


def validate_cloned_package(package_bytes: bytes) -> list[str]:
    warnings: list[str] = []
    try:
        with zipfile.ZipFile(BytesIO(package_bytes), "r") as package:
            names = [item.filename for item in package.infolist() if not item.is_dir()]
            parts = set(names)
            if len(names) != len(parts):
                warnings.append("DUPLICATE_PACKAGE_PART")
            required = {
                "[Content_Types].xml",
                "_rels/.rels",
                "ppt/presentation.xml",
                "ppt/_rels/presentation.xml.rels",
            }
            if not required.issubset(parts):
                warnings.append("REQUIRED_PART_MISSING")
                return sorted(set(warnings))
            _validate_relationships(package, parts, warnings)
            _validate_content_types(package, parts, warnings)
            _validate_presentation_mapping(package, parts, warnings)
    except (OSError, KeyError, zipfile.BadZipFile, ET.ParseError):
        return ["MALFORMED_OOXML_PACKAGE"]
    return sorted(set(warnings))


def _validate_relationships(
    package: zipfile.ZipFile, parts: set[str], warnings: list[str]
) -> None:
    for rels_part in sorted(part for part in parts if part.endswith(".rels")):
        root = ET.fromstring(package.read(rels_part))
        relationship_ids: list[str] = []
        source_part = _source_part_for_rels(rels_part)
        for relationship in root.findall(
            f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship"
        ):
            relationship_id = relationship.attrib.get("Id", "")
            relationship_ids.append(relationship_id)
            if relationship.attrib.get("TargetMode") == "External":
                warnings.append("EXTERNAL_RELATIONSHIP")
                continue
            target = relationship.attrib.get("Target", "")
            target_part = _resolve_target(source_part, target)
            if target_part not in parts:
                warnings.append("RELATIONSHIP_TARGET_MISSING")
        if not all(relationship_ids) or len(relationship_ids) != len(
            set(relationship_ids)
        ):
            warnings.append("DUPLICATE_RELATIONSHIP_ID")


def _validate_content_types(
    package: zipfile.ZipFile, parts: set[str], warnings: list[str]
) -> None:
    root = ET.fromstring(package.read("[Content_Types].xml"))
    defaults: set[str] = set()
    overrides: list[str] = []
    for child in root:
        local = child.tag.rsplit("}", 1)[-1]
        if local == "Default":
            defaults.add(child.attrib.get("Extension", "").casefold())
        elif local == "Override":
            overrides.append(child.attrib.get("PartName", "").lstrip("/"))
    if len(overrides) != len(set(overrides)):
        warnings.append("DUPLICATE_CONTENT_TYPE_OVERRIDE")
    if any(part not in parts for part in overrides):
        warnings.append("STALE_CONTENT_TYPE_OVERRIDE")
    override_set = set(overrides)
    for part in parts:
        if part == "[Content_Types].xml":
            continue
        extension = (
            "rels"
            if part.endswith(".rels")
            else PurePosixPath(part).suffix.removeprefix(".").casefold()
        )
        if part not in override_set and extension not in defaults:
            warnings.append("CONTENT_TYPE_MISSING")


def _validate_presentation_mapping(
    package: zipfile.ZipFile, parts: set[str], warnings: list[str]
) -> None:
    presentation = ET.fromstring(package.read("ppt/presentation.xml"))
    rels = ET.fromstring(package.read("ppt/_rels/presentation.xml.rels"))
    slide_relationships = {
        item.attrib["Id"]: _resolve_target(
            "ppt/presentation.xml", item.attrib.get("Target", "")
        )
        for item in rels.findall(f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship")
        if item.attrib.get("Type", "").endswith("/slide")
    }
    slide_ids = presentation.findall(f".//{{{PRESENTATION_NS}}}sldId")
    numeric_ids = [item.attrib.get("id", "") for item in slide_ids]
    relationship_ids = [
        item.attrib.get(f"{{{OFFICE_RELATIONSHIPS_NS}}}id", "")
        for item in slide_ids
    ]
    mapped_parts = [slide_relationships.get(value, "") for value in relationship_ids]
    package_slides = {
        part
        for part in parts
        if part.startswith("ppt/slides/slide") and part.endswith(".xml")
    }
    if (
        not all(numeric_ids)
        or len(numeric_ids) != len(set(numeric_ids))
        or not all(relationship_ids)
        or len(relationship_ids) != len(set(relationship_ids))
        or set(mapped_parts) != package_slides
        or len(mapped_parts) != len(package_slides)
    ):
        warnings.append("PRESENTATION_SLIDE_MAPPING_INVALID")


def _source_part_for_rels(rels_part: str) -> str:
    if rels_part == "_rels/.rels":
        return ""
    path = PurePosixPath(rels_part)
    return str(path.parent.parent / path.name.removesuffix(".rels"))


def _resolve_target(source_part: str, target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join(posixpath.dirname(source_part), target))
