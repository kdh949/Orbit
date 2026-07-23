from __future__ import annotations

import posixpath
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET

from PIL import Image

from app.ai.ooxml_reference_templates.capacity import SlotCapacityError
from app.ai.ooxml_reference_templates.media_targets import inspect_image_media_usage
from app.ai.ooxml_reference_templates.models import OoxmlImageTemplateSlot


DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
OFFICE_RELATIONSHIPS_NS = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
)
PACKAGE_RELATIONSHIPS_NS = (
    "http://schemas.openxmlformats.org/package/2006/relationships"
)


@dataclass(frozen=True)
class ImageSlotReplacementResult:
    package_bytes: bytes
    warning_codes: list[str]


def replace_image_slot(
    package_bytes: bytes,
    *,
    slot: OoxmlImageTemplateSlot,
    image_bytes: bytes,
    mime_type: str,
) -> ImageSlotReplacementResult:
    if mime_type not in {"image/png", "image/jpeg"}:
        raise SlotCapacityError(
            "OOXML_REFERENCE_IMAGE_FORMAT_UNSUPPORTED",
            "only PNG and JPEG slot replacements are supported",
            package_bytes=package_bytes,
        )
    width, height, has_alpha = _image_properties(image_bytes, package_bytes)
    aspect_ratio = width / height
    capacity = slot.capacity
    if not capacity.min_aspect_ratio <= aspect_ratio <= capacity.max_aspect_ratio:
        raise SlotCapacityError(
            "OOXML_REFERENCE_CAPACITY_IMAGE_ASPECT_RATIO",
            "replacement image aspect ratio exceeds annotated capacity",
            package_bytes=package_bytes,
        )
    if capacity.alpha_required and not has_alpha:
        raise SlotCapacityError(
            "OOXML_REFERENCE_CAPACITY_IMAGE_ALPHA_REQUIRED",
            "replacement image must preserve an alpha channel",
            package_bytes=package_bytes,
        )

    entries, infos = _read_package(package_bytes)
    slide_part = slot.locator.slide_part
    relationship_id = slot.locator.relationship_id
    if relationship_id is None:
        raise SlotCapacityError(
            "OOXML_REFERENCE_IMAGE_LOCATOR_INVALID",
            "image relationship locator is missing",
            package_bytes=package_bytes,
        )
    rels_part = _rels_part(slide_part)
    try:
        slide = ET.fromstring(entries[slide_part])
        relationships = ET.fromstring(entries[rels_part])
    except (KeyError, ET.ParseError) as error:
        raise SlotCapacityError(
            "OOXML_REFERENCE_IMAGE_LOCATOR_INVALID",
            "annotated slide or relationship part cannot be loaded",
            package_bytes=package_bytes,
        ) from error
    picture = _find_picture(slide, slot.locator.shape_id, package_bytes)
    blip = picture.find(f".//{{{DRAWING_NS}}}blip")
    if blip is None or blip.attrib.get(
        f"{{{OFFICE_RELATIONSHIPS_NS}}}embed"
    ) != relationship_id:
        raise SlotCapacityError(
            "OOXML_REFERENCE_IMAGE_LOCATOR_INVALID",
            "picture relationship locator drifted",
            package_bytes=package_bytes,
        )
    matches = [
        relationship
        for relationship in relationships.findall(
            f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship"
        )
        if relationship.attrib.get("Id") == relationship_id
        and relationship.attrib.get("Type", "").endswith("/image")
        and relationship.attrib.get("TargetMode") != "External"
    ]
    if len(matches) != 1:
        raise SlotCapacityError(
            "OOXML_REFERENCE_IMAGE_LOCATOR_INVALID",
            "image relationship is not unique and internal",
            package_bytes=package_bytes,
        )
    if capacity.mask_required:
        geometry = picture.find(f".//{{{DRAWING_NS}}}prstGeom")
        if geometry is None or geometry.attrib.get("prst") in {None, "rect"}:
            raise SlotCapacityError(
                "OOXML_REFERENCE_CAPACITY_IMAGE_MASK_REQUIRED",
                "annotated image mask is missing",
                package_bytes=package_bytes,
            )
    media_part = _resolve_target(slide_part, matches[0].attrib["Target"])
    try:
        usage = inspect_image_media_usage(
            entries,
            slide_part=slide_part,
            relationship_id=relationship_id,
            media_part=media_part,
        )
    except (KeyError, ET.ParseError) as error:
        raise SlotCapacityError(
            "OOXML_REFERENCE_IMAGE_LOCATOR_INVALID",
            "image media usage cannot be inspected",
            package_bytes=package_bytes,
        ) from error
    if not usage.is_exclusive:
        raise SlotCapacityError(
            "OOXML_REFERENCE_IMAGE_MEDIA_SHARED",
            "annotated image media target is shared by another package consumer",
            package_bytes=package_bytes,
        )
    expected_suffix = ".png" if mime_type == "image/png" else ".jpeg"
    if PurePosixPath(media_part).suffix.casefold() not in {
        expected_suffix,
        ".jpg" if expected_suffix == ".jpeg" else expected_suffix,
    }:
        raise SlotCapacityError(
            "OOXML_REFERENCE_IMAGE_FORMAT_MISMATCH",
            "replacement MIME type does not match the immutable media locator",
            package_bytes=package_bytes,
        )
    if media_part not in entries:
        raise SlotCapacityError(
            "OOXML_REFERENCE_IMAGE_LOCATOR_INVALID",
            "image media part is missing",
            package_bytes=package_bytes,
        )
    entries[media_part] = image_bytes
    return ImageSlotReplacementResult(
        package_bytes=_write_package(entries, infos), warning_codes=[]
    )


def _image_properties(content: bytes, package_bytes: bytes) -> tuple[int, int, bool]:
    try:
        with Image.open(BytesIO(content)) as image:
            image.verify()
        with Image.open(BytesIO(content)) as image:
            return image.width, image.height, "A" in image.getbands()
    except (OSError, ValueError) as error:
        raise SlotCapacityError(
            "OOXML_REFERENCE_IMAGE_INVALID",
            "replacement image cannot be decoded",
            package_bytes=package_bytes,
        ) from error


def _find_picture(
    slide: ET.Element[str], shape_id: str, package_bytes: bytes
) -> ET.Element[str]:
    for picture in slide.findall(f".//{{{PRESENTATION_NS}}}pic"):
        non_visual = picture.find(f".//{{{PRESENTATION_NS}}}cNvPr")
        if non_visual is not None and non_visual.attrib.get("id") == shape_id:
            return picture
    raise SlotCapacityError(
        "OOXML_REFERENCE_IMAGE_LOCATOR_INVALID",
        "annotated picture shape was not found",
        package_bytes=package_bytes,
    )


def _rels_part(part: str) -> str:
    path = PurePosixPath(part)
    return str(path.parent / "_rels" / f"{path.name}.rels")


def _resolve_target(source_part: str, target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join(posixpath.dirname(source_part), target))


def _read_package(
    package_bytes: bytes,
) -> tuple[dict[str, bytes], dict[str, zipfile.ZipInfo]]:
    try:
        with zipfile.ZipFile(BytesIO(package_bytes), "r") as package:
            infos = {item.filename: item for item in package.infolist()}
            entries = {
                item.filename: package.read(item.filename)
                for item in package.infolist()
                if not item.is_dir()
            }
    except (OSError, zipfile.BadZipFile, KeyError) as error:
        raise SlotCapacityError(
            "OOXML_REFERENCE_PACKAGE_INVALID", "package cannot be mutated"
        ) from error
    return entries, infos


def _write_package(
    entries: dict[str, bytes], infos: dict[str, zipfile.ZipInfo]
) -> bytes:
    output = BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as package:
        for name in sorted(entries):
            package.writestr(infos.get(name, name), entries[name])
    return output.getvalue()
