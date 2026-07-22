from __future__ import annotations

import hashlib
import math
import posixpath
import re
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as ET


EXPECTED_REFERENCE_SLIDE_COUNTS: dict[str, int] = {
    "simple-light": 26,
    "simple-dark": 26,
    "operating-review": 31,
    "business-review": 14,
    "project-kickoff": 12,
    "team-alignment": 24,
    "market-trends-report": 6,
}

CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
PACKAGE_RELATIONSHIPS_NS = (
    "http://schemas.openxmlformats.org/package/2006/relationships"
)
PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
OFFICE_RELATIONSHIPS_NS = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
)
SLIDE_RELATIONSHIP_TYPE = f"{OFFICE_RELATIONSHIPS_NS}/slide"
PACKAGE_RELATIONSHIP_TYPE = f"{OFFICE_RELATIONSHIPS_NS}/package"

_SLIDE_PART = re.compile(r"^ppt/slides/slide[0-9]+\.xml$")
_MASTER_PART = re.compile(r"^ppt/slideMasters/slideMaster[0-9]+\.xml$")
_LAYOUT_PART = re.compile(r"^ppt/slideLayouts/slideLayout[0-9]+\.xml$")
_THEME_PART = re.compile(r"^ppt/theme/theme[0-9]+\.xml$")
_CHART_PART = re.compile(r"^ppt/charts/chart[0-9]+\.xml$")
_SMART_ART_PART = re.compile(r"^ppt/diagrams/data[0-9]+\.xml$")
_WINDOWS_DRIVE = re.compile(r"^[A-Za-z]:")
_COMPOUND_FILE_SIGNATURE = bytes.fromhex("d0cf11e0a1b11ae1")


@dataclass(frozen=True)
class ReferenceSource:
    template_id: str
    path: Path


@dataclass(frozen=True)
class InventoryLimits:
    max_archive_bytes: int = 200 * 1024 * 1024
    max_parts: int = 10_000
    max_total_uncompressed_bytes: int = 1024 * 1024 * 1024
    max_part_uncompressed_bytes: int = 200 * 1024 * 1024
    max_compression_ratio: float = 200.0


class InventoryValidationError(ValueError):
    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


def build_reference_inventory(
    sources: list[ReferenceSource],
    *,
    expected_slide_counts: dict[str, int] | None = None,
    limits: InventoryLimits | None = None,
) -> dict[str, Any]:
    expected = expected_slide_counts or EXPECTED_REFERENCE_SLIDE_COUNTS
    selected_limits = limits or InventoryLimits()
    sources_by_id = _validate_source_set(sources, expected)

    inventories: list[dict[str, Any]] = []
    for template_id, expected_slide_count in expected.items():
        inventory = inspect_reference_package(
            sources_by_id[template_id], limits=selected_limits
        )
        if inventory["slideCount"] != expected_slide_count:
            raise InventoryValidationError(
                "inventory_drift",
                f"{template_id} expected {expected_slide_count} slides but found "
                f"{inventory['slideCount']}",
            )
        inventories.append(inventory)

    slide_count = sum(int(source["slideCount"]) for source in inventories)
    expected_total = sum(expected.values())
    if slide_count != expected_total:
        raise InventoryValidationError(
            "inventory_drift",
            f"expected {expected_total} total slides but found {slide_count}",
        )
    return {
        "schemaVersion": 1,
        "sourceCount": len(inventories),
        "slideCount": slide_count,
        "sources": inventories,
    }


def inspect_reference_package(
    source: ReferenceSource,
    *,
    limits: InventoryLimits | None = None,
) -> dict[str, Any]:
    selected_limits = limits or InventoryLimits()
    try:
        archive_size = source.path.stat().st_size
        with source.path.open("rb") as stream:
            signature = stream.read(8)
    except OSError as error:
        raise InventoryValidationError(
            "source_unavailable", f"{source.template_id} cannot be read"
        ) from error

    if signature == _COMPOUND_FILE_SIGNATURE:
        raise InventoryValidationError(
            "encrypted_package", f"{source.template_id} is an encrypted package"
        )
    if archive_size > selected_limits.max_archive_bytes:
        raise InventoryValidationError(
            "archive_size_limit", f"{source.template_id} exceeds archive size limit"
        )

    try:
        with zipfile.ZipFile(source.path, "r") as package:
            infos = package.infolist()
            normalized_parts = _security_preflight(
                package,
                infos,
                source.template_id,
                selected_limits,
            )
            counts = _inventory_counts(package, normalized_parts, source.template_id)
            part_count = len(infos)
            uncompressed_bytes = sum(item.file_size for item in infos)
    except InventoryValidationError:
        raise
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile) as error:
        raise InventoryValidationError(
            "malformed_package", f"{source.template_id} is not a valid OOXML package"
        ) from error

    return {
        "templateId": source.template_id,
        "sha256": _sha256(source.path),
        "archiveBytes": archive_size,
        "partCount": part_count,
        "uncompressedBytes": uncompressed_bytes,
        **counts,
        "securityPreflight": "passed",
    }


def _validate_source_set(
    sources: list[ReferenceSource], expected: dict[str, int]
) -> dict[str, ReferenceSource]:
    sources_by_id: dict[str, ReferenceSource] = {}
    for source in sources:
        if source.template_id in sources_by_id:
            raise InventoryValidationError(
                "inventory_drift", f"duplicate template ID {source.template_id}"
            )
        sources_by_id[source.template_id] = source

    expected_ids = set(expected)
    actual_ids = set(sources_by_id)
    if actual_ids != expected_ids:
        missing = sorted(expected_ids - actual_ids)
        unexpected = sorted(actual_ids - expected_ids)
        raise InventoryValidationError(
            "inventory_drift",
            f"source IDs differ; missing={missing}, unexpected={unexpected}",
        )
    return sources_by_id


def _security_preflight(
    package: zipfile.ZipFile,
    infos: list[zipfile.ZipInfo],
    template_id: str,
    limits: InventoryLimits,
) -> set[str]:
    if len(infos) > limits.max_parts:
        raise InventoryValidationError(
            "part_count_limit", f"{template_id} exceeds package part count limit"
        )

    normalized_parts: set[str] = set()
    normalized_part_keys: set[str] = set()
    total_uncompressed = 0
    for info in infos:
        normalized = _validate_part_name(info.filename, template_id)
        duplicate_key = normalized.casefold()
        if duplicate_key in normalized_part_keys:
            raise InventoryValidationError(
                "duplicate_zip_part", f"{template_id} contains duplicate package parts"
            )
        normalized_parts.add(normalized)
        normalized_part_keys.add(duplicate_key)
        if info.flag_bits & 0x1:
            raise InventoryValidationError(
                "encrypted_package", f"{template_id} contains an encrypted ZIP part"
            )
        if info.is_dir():
            continue
        total_uncompressed += info.file_size
        if total_uncompressed > limits.max_total_uncompressed_bytes:
            raise InventoryValidationError(
                "uncompressed_size_limit",
                f"{template_id} exceeds total uncompressed size limit",
            )
        if info.file_size > limits.max_part_uncompressed_bytes:
            raise InventoryValidationError(
                "part_size_limit", f"{template_id} contains an oversized package part"
            )
        ratio = (
            math.inf
            if info.file_size > 0 and info.compress_size == 0
            else info.file_size / max(info.compress_size, 1)
        )
        if ratio > limits.max_compression_ratio:
            raise InventoryValidationError(
                "compression_ratio_limit",
                f"{template_id} contains a suspiciously compressed package part",
            )
        _reject_prohibited_part(normalized, template_id)

    required = {
        "[Content_Types].xml",
        "_rels/.rels",
        "ppt/presentation.xml",
        "ppt/_rels/presentation.xml.rels",
    }
    if not required.issubset(normalized_parts):
        raise InventoryValidationError(
            "malformed_package", f"{template_id} is missing required OOXML parts"
        )

    relationships = _validate_relationships(package, normalized_parts, template_id)
    _validate_embedded_chart_workbooks(
        package, normalized_parts, relationships, template_id, limits
    )
    _validate_content_types(package, normalized_parts, template_id)
    _validate_presentation_mapping(package, normalized_parts, relationships, template_id)
    _reject_presentation_protection(package, template_id)
    return normalized_parts


def _validate_part_name(name: str, template_id: str) -> str:
    normalized = name.replace("\\", "/")
    path = PurePosixPath(normalized)
    if (
        not normalized
        or normalized.startswith("/")
        or _WINDOWS_DRIVE.match(normalized)
        or ".." in path.parts
        or "." in path.parts
        or "" in normalized.split("/")
    ):
        raise InventoryValidationError(
            "zip_path_traversal", f"{template_id} contains an unsafe ZIP part name"
        )
    return normalized


def _reject_prohibited_part(part: str, template_id: str) -> None:
    lowered = part.casefold()
    if (
        lowered in {"encryptioninfo", "encryptedpackage"}
        or lowered.endswith("/vbaproject.bin")
        or "/activex/" in f"/{lowered}"
        or "/oleobjects/" in f"/{lowered}"
    ):
        code = (
            "encrypted_package"
            if lowered in {"encryptioninfo", "encryptedpackage"}
            else "prohibited_active_content"
        )
        raise InventoryValidationError(
            code, f"{template_id} contains prohibited active or embedded content"
        )


def _validate_content_types(
    package: zipfile.ZipFile,
    parts: set[str],
    template_id: str,
) -> None:
    root = _parse_xml(
        package.read("[Content_Types].xml"),
        "malformed_content_types",
        template_id,
    )
    if root.tag != f"{{{CONTENT_TYPES_NS}}}Types":
        raise InventoryValidationError(
            "malformed_content_types", f"{template_id} has an invalid content type root"
        )

    defaults: dict[str, str] = {}
    overrides: dict[str, str] = {}
    for child in root:
        if child.tag == f"{{{CONTENT_TYPES_NS}}}Default":
            extension = child.attrib.get("Extension", "").casefold()
            content_type = child.attrib.get("ContentType", "")
            if not extension or not content_type or extension in defaults:
                raise InventoryValidationError(
                    "malformed_content_types",
                    f"{template_id} has an invalid default content type",
                )
            defaults[extension] = content_type
        elif child.tag == f"{{{CONTENT_TYPES_NS}}}Override":
            raw_part = child.attrib.get("PartName", "")
            content_type = child.attrib.get("ContentType", "")
            if not raw_part.startswith("/") or not content_type:
                raise InventoryValidationError(
                    "malformed_content_types",
                    f"{template_id} has an invalid content type override",
                )
            part = raw_part[1:].replace("\\", "/")
            if part in overrides or part not in parts:
                raise InventoryValidationError(
                    "malformed_content_types",
                    f"{template_id} has a stale or duplicate content type override",
                )
            overrides[part] = content_type
            lowered_type = content_type.casefold()
            if any(
                marker in lowered_type
                for marker in ("macroenabled", "vba", "activex", "oleobject")
            ):
                raise InventoryValidationError(
                    "prohibited_active_content",
                    f"{template_id} declares prohibited active content",
                )
        else:
            raise InventoryValidationError(
                "malformed_content_types",
                f"{template_id} has an unknown content type declaration",
            )

    for part in parts:
        if part == "[Content_Types].xml" or part.endswith("/"):
            continue
        extension = (
            "rels"
            if part.endswith(".rels")
            else PurePosixPath(part).suffix.removeprefix(".").casefold()
        )
        if part not in overrides and extension not in defaults:
            raise InventoryValidationError(
                "malformed_content_types",
                f"{template_id} has a package part without a content type",
            )


def _validate_relationships(
    package: zipfile.ZipFile,
    parts: set[str],
    template_id: str,
) -> dict[str, dict[str, tuple[str, str]]]:
    result: dict[str, dict[str, tuple[str, str]]] = {}
    for rel_part in sorted(part for part in parts if part.endswith(".rels")):
        source_part = _relationship_source_part(rel_part, template_id)
        if source_part and source_part not in parts:
            raise InventoryValidationError(
                "malformed_relationships",
                f"{template_id} has relationships for a missing source part",
            )
        root = _parse_xml(
            package.read(rel_part), "malformed_relationships", template_id
        )
        if root.tag != f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationships":
            raise InventoryValidationError(
                "malformed_relationships",
                f"{template_id} has an invalid relationships root",
            )
        relationships: dict[str, tuple[str, str]] = {}
        for child in root:
            if child.tag != f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship":
                raise InventoryValidationError(
                    "malformed_relationships",
                    f"{template_id} has an invalid relationship declaration",
                )
            relationship_id = child.attrib.get("Id", "")
            relationship_type = child.attrib.get("Type", "")
            target = child.attrib.get("Target", "")
            if not relationship_id or not relationship_type or not target:
                raise InventoryValidationError(
                    "malformed_relationships",
                    f"{template_id} has an incomplete relationship",
                )
            if relationship_id in relationships:
                raise InventoryValidationError(
                    "malformed_relationships",
                    f"{template_id} has a duplicate relationship ID",
                )
            if child.attrib.get("TargetMode", "").casefold() == "external":
                raise InventoryValidationError(
                    "external_relationship",
                    f"{template_id} contains an external relationship",
                )
            resolved_target = _resolve_relationship_target(
                source_part, target, template_id
            )
            if resolved_target not in parts:
                raise InventoryValidationError(
                    "malformed_relationships",
                    f"{template_id} has a relationship to a missing package part",
                )
            relationships[relationship_id] = (relationship_type, resolved_target)
        result[source_part] = relationships
    return result


def _relationship_source_part(rel_part: str, template_id: str) -> str:
    if rel_part == "_rels/.rels":
        return ""
    parent, separator, filename = rel_part.rpartition("/_rels/")
    if not separator or not filename.endswith(".rels"):
        raise InventoryValidationError(
            "malformed_relationships",
            f"{template_id} has an invalid relationship part name",
        )
    return f"{parent}/{filename.removesuffix('.rels')}"


def _resolve_relationship_target(
    source_part: str, target: str, template_id: str
) -> str:
    parsed = urlsplit(target)
    if parsed.scheme or parsed.netloc:
        raise InventoryValidationError(
            "external_relationship",
            f"{template_id} contains an external relationship target",
        )
    decoded = unquote(parsed.path).replace("\\", "/")
    if not decoded:
        raise InventoryValidationError(
            "malformed_relationships", f"{template_id} has an empty relationship target"
        )
    if decoded.startswith("/"):
        resolved = posixpath.normpath(decoded.removeprefix("/"))
    else:
        resolved = posixpath.normpath(
            posixpath.join(posixpath.dirname(source_part), decoded)
        )
    if resolved == ".." or resolved.startswith("../") or _WINDOWS_DRIVE.match(resolved):
        raise InventoryValidationError(
            "zip_path_traversal",
            f"{template_id} has a relationship target outside the package",
        )
    return resolved


def _validate_presentation_mapping(
    package: zipfile.ZipFile,
    parts: set[str],
    relationships: dict[str, dict[str, tuple[str, str]]],
    template_id: str,
) -> None:
    root = _parse_xml(
        package.read("ppt/presentation.xml"),
        "malformed_presentation",
        template_id,
    )
    if root.tag != f"{{{PRESENTATION_NS}}}presentation":
        raise InventoryValidationError(
            "malformed_presentation", f"{template_id} has an invalid presentation root"
        )

    slide_ids = root.findall(f".//{{{PRESENTATION_NS}}}sldId")
    presentation_relationships = relationships.get("ppt/presentation.xml", {})
    mapped_parts: list[str] = []
    seen_relationship_ids: set[str] = set()
    for slide_id in slide_ids:
        relationship_id = slide_id.attrib.get(
            f"{{{OFFICE_RELATIONSHIPS_NS}}}id", ""
        )
        if not relationship_id or relationship_id in seen_relationship_ids:
            raise InventoryValidationError(
                "malformed_presentation_mapping",
                f"{template_id} has an invalid slide relationship ID",
            )
        seen_relationship_ids.add(relationship_id)
        relationship = presentation_relationships.get(relationship_id)
        if relationship is None or relationship[0] != SLIDE_RELATIONSHIP_TYPE:
            raise InventoryValidationError(
                "malformed_presentation_mapping",
                f"{template_id} has an unresolved slide relationship",
            )
        mapped_parts.append(relationship[1])

    package_slide_parts = {part for part in parts if _SLIDE_PART.fullmatch(part)}
    if (
        len(mapped_parts) != len(set(mapped_parts))
        or set(mapped_parts) != package_slide_parts
    ):
        raise InventoryValidationError(
            "malformed_presentation_mapping",
            f"{template_id} slide list does not match package slide parts",
        )


def _validate_embedded_chart_workbooks(
    package: zipfile.ZipFile,
    parts: set[str],
    relationships: dict[str, dict[str, tuple[str, str]]],
    template_id: str,
    limits: InventoryLimits,
) -> None:
    embedded_parts = {
        part
        for part in parts
        if part.startswith("ppt/embeddings/") and not part.endswith("/")
    }
    references: dict[str, list[tuple[str, str]]] = {
        part: [] for part in embedded_parts
    }
    for source_part, source_relationships in relationships.items():
        for relationship_type, target in source_relationships.values():
            if target in references:
                references[target].append((source_part, relationship_type))

    for embedded_part in sorted(embedded_parts):
        incoming = references[embedded_part]
        allowed_chart_workbook = (
            embedded_part.casefold().endswith(".xlsx")
            and len(incoming) == 1
            and _CHART_PART.fullmatch(incoming[0][0]) is not None
            and incoming[0][1] == PACKAGE_RELATIONSHIP_TYPE
        )
        if not allowed_chart_workbook:
            raise InventoryValidationError(
                "prohibited_active_content",
                f"{template_id} contains an unsupported embedded package",
            )
        _validate_nested_chart_workbook(
            package.read(embedded_part), template_id, limits
        )


def _validate_nested_chart_workbook(
    content: bytes,
    template_id: str,
    limits: InventoryLimits,
) -> None:
    if content.startswith(_COMPOUND_FILE_SIGNATURE):
        raise InventoryValidationError(
            "encrypted_package", f"{template_id} contains an encrypted chart workbook"
        )
    try:
        with zipfile.ZipFile(BytesIO(content), "r") as workbook:
            infos = workbook.infolist()
            if len(infos) > limits.max_parts:
                raise InventoryValidationError(
                    "part_count_limit",
                    f"{template_id} chart workbook exceeds part count limit",
                )
            workbook_parts: set[str] = set()
            workbook_part_keys: set[str] = set()
            total_uncompressed = 0
            for info in infos:
                part = _validate_part_name(info.filename, template_id)
                part_key = part.casefold()
                if part_key in workbook_part_keys:
                    raise InventoryValidationError(
                        "duplicate_zip_part",
                        f"{template_id} chart workbook contains duplicate parts",
                    )
                workbook_parts.add(part)
                workbook_part_keys.add(part_key)
                if info.flag_bits & 0x1:
                    raise InventoryValidationError(
                        "encrypted_package",
                        f"{template_id} contains an encrypted chart workbook part",
                    )
                if info.is_dir():
                    continue
                total_uncompressed += info.file_size
                if total_uncompressed > limits.max_total_uncompressed_bytes:
                    raise InventoryValidationError(
                        "uncompressed_size_limit",
                        f"{template_id} chart workbook exceeds size limit",
                    )
                if info.file_size > limits.max_part_uncompressed_bytes:
                    raise InventoryValidationError(
                        "part_size_limit",
                        f"{template_id} chart workbook contains an oversized part",
                    )
                ratio = (
                    math.inf
                    if info.file_size > 0 and info.compress_size == 0
                    else info.file_size / max(info.compress_size, 1)
                )
                if ratio > limits.max_compression_ratio:
                    raise InventoryValidationError(
                        "compression_ratio_limit",
                        f"{template_id} chart workbook has a suspicious part",
                    )
                lowered = part.casefold()
                _reject_prohibited_part(part, template_id)
                if "/embeddings/" in f"/{lowered}":
                    raise InventoryValidationError(
                        "prohibited_active_content",
                        f"{template_id} chart workbook nests an embedded package",
                    )

            required = {"[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"}
            if not required.issubset(workbook_parts):
                raise InventoryValidationError(
                    "prohibited_active_content",
                    f"{template_id} has an invalid embedded chart workbook",
                )
            _validate_content_types(workbook, workbook_parts, template_id)
            _validate_relationships(workbook, workbook_parts, template_id)
    except InventoryValidationError:
        raise
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile) as error:
        raise InventoryValidationError(
            "prohibited_active_content",
            f"{template_id} has an invalid embedded chart workbook",
        ) from error


def _reject_presentation_protection(
    package: zipfile.ZipFile, template_id: str
) -> None:
    root = _parse_xml(
        package.read("ppt/presentation.xml"),
        "malformed_presentation",
        template_id,
    )
    prohibited_elements = {
        "modifyVerifier",
        "documentProtection",
        "presentationProtection",
    }
    if any(_local_name(element.tag) in prohibited_elements for element in root.iter()):
        raise InventoryValidationError(
            "protected_presentation",
            f"{template_id} is password or modification protected",
        )


def _inventory_counts(
    package: zipfile.ZipFile,
    parts: set[str],
    template_id: str,
) -> dict[str, int]:
    slide_parts = sorted(part for part in parts if _SLIDE_PART.fullmatch(part))
    font_families: set[str] = set()
    table_count = 0
    animation_count = 0
    for part in sorted(
        part for part in parts if part.startswith("ppt/") and part.endswith(".xml")
    ):
        root = _parse_xml(package.read(part), "malformed_package_xml", template_id)
        for element in root.iter():
            typeface = element.attrib.get("typeface")
            if typeface:
                font_families.add(typeface.casefold())
        if part in slide_parts:
            table_count += sum(1 for element in root.iter() if _local_name(element.tag) == "tbl")
            animation_count += sum(
                1 for element in root.iter() if _local_name(element.tag) == "timing"
            )

    return {
        "slideCount": len(slide_parts),
        "masterCount": sum(1 for part in parts if _MASTER_PART.fullmatch(part)),
        "layoutCount": sum(1 for part in parts if _LAYOUT_PART.fullmatch(part)),
        "themeCount": sum(1 for part in parts if _THEME_PART.fullmatch(part)),
        "fontCount": len(font_families),
        "embeddedFontCount": sum(
            1
            for part in parts
            if part.startswith("ppt/fonts/") and not part.endswith("/")
        ),
        "embeddedWorkbookCount": sum(
            1
            for part in parts
            if part.startswith("ppt/embeddings/")
            and part.casefold().endswith(".xlsx")
        ),
        "mediaCount": sum(
            1
            for part in parts
            if part.startswith("ppt/media/") and not part.endswith("/")
        ),
        "chartCount": sum(1 for part in parts if _CHART_PART.fullmatch(part)),
        "tableCount": table_count,
        "smartArtCount": sum(1 for part in parts if _SMART_ART_PART.fullmatch(part)),
        "animationCount": animation_count,
    }


def _parse_xml(content: bytes, error_code: str, template_id: str) -> ET.Element[str]:
    lowered = content[:4096].lower()
    if b"<!doctype" in lowered or b"<!entity" in lowered:
        raise InventoryValidationError(
            error_code, f"{template_id} contains a prohibited XML declaration"
        )
    try:
        return ET.fromstring(content)
    except ET.ParseError as error:
        raise InventoryValidationError(
            error_code, f"{template_id} contains malformed OOXML"
        ) from error


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise InventoryValidationError(
            "source_unavailable", "source cannot be read for checksum"
        ) from error
    return digest.hexdigest()
