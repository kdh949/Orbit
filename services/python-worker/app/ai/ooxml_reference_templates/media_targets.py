from __future__ import annotations

import posixpath
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET


DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
OFFICE_RELATIONSHIPS_NS = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
)
PACKAGE_RELATIONSHIPS_NS = (
    "http://schemas.openxmlformats.org/package/2006/relationships"
)


@dataclass(frozen=True)
class ImageMediaUsage:
    relationship_count: int
    embed_count: int

    @property
    def is_exclusive(self) -> bool:
        return self.relationship_count == 1 and self.embed_count == 1


def inspect_image_media_usage(
    entries: Mapping[str, bytes],
    *,
    slide_part: str,
    relationship_id: str,
    media_part: str,
) -> ImageMediaUsage:
    slide = ET.fromstring(entries[slide_part])
    embed_attribute = f"{{{OFFICE_RELATIONSHIPS_NS}}}embed"
    embed_count = sum(
        blip.attrib.get(embed_attribute) == relationship_id
        for blip in slide.findall(f".//{{{DRAWING_NS}}}blip")
    )

    relationship_count = 0
    for rels_part, content in entries.items():
        source_part = _source_part_for_relationships(rels_part)
        if source_part is None:
            continue
        root = ET.fromstring(content)
        for relationship in root.findall(
            f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship"
        ):
            if (
                relationship.attrib.get("TargetMode") == "External"
                or not relationship.attrib.get("Type", "").endswith("/image")
            ):
                continue
            target = relationship.attrib.get("Target")
            if target is not None and _resolve_target(source_part, target) == media_part:
                relationship_count += 1

    return ImageMediaUsage(
        relationship_count=relationship_count,
        embed_count=embed_count,
    )


def _source_part_for_relationships(rels_part: str) -> str | None:
    path = PurePosixPath(rels_part)
    if path.parent.name != "_rels" or not path.name.endswith(".rels"):
        return None
    source_name = path.name[: -len(".rels")]
    if not source_name:
        return None
    return str(path.parent.parent / source_name)


def _resolve_target(source_part: str, target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join(posixpath.dirname(source_part), target))
