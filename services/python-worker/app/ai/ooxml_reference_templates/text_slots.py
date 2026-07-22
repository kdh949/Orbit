from __future__ import annotations

import copy
import zipfile
from dataclasses import dataclass
from io import BytesIO
from xml.etree import ElementTree as ET

from app.ai.ooxml_reference_templates.capacity import SlotCapacityError
from app.ai.ooxml_reference_templates.models import OoxmlTextTemplateSlot


DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"


@dataclass(frozen=True)
class TextSlotReplacementResult:
    package_bytes: bytes
    warning_codes: list[str]
    font_substitutions: dict[str, str]


def replace_text_slot(
    package_bytes: bytes,
    *,
    slot: OoxmlTextTemplateSlot,
    text: str,
    available_fonts: set[str],
    font_fallbacks: dict[str, str] | None = None,
) -> TextSlotReplacementResult:
    lines = text.split("\n")
    capacity = slot.capacity
    paragraph_count = len(lines)
    max_paragraphs = capacity.max_paragraphs or capacity.max_lines
    if (
        len(text) > capacity.max_chars
        or len(lines) > capacity.max_lines
        or paragraph_count > max_paragraphs
    ):
        raise SlotCapacityError(
            "OOXML_REFERENCE_CAPACITY_TEXT_EXCEEDED",
            "text exceeds the annotated character, line, or paragraph capacity",
            package_bytes=package_bytes,
        )

    entries, infos = _read_package(package_bytes)
    slide_part = slot.locator.slide_part
    try:
        slide = ET.fromstring(entries[slide_part])
    except (KeyError, ET.ParseError) as error:
        raise SlotCapacityError(
            "OOXML_REFERENCE_TEXT_LOCATOR_INVALID",
            "annotated slide part cannot be loaded",
            package_bytes=package_bytes,
        ) from error
    shape = _find_shape(slide, slot.locator.shape_id)
    paragraphs = shape.findall(f".//{{{DRAWING_NS}}}p")
    if not paragraphs:
        raise SlotCapacityError(
            "OOXML_REFERENCE_TEXT_LOCATOR_INVALID",
            "annotated shape has no direct text body",
            package_bytes=package_bytes,
        )
    max_depth = max((_paragraph_depth(paragraph) for paragraph in paragraphs), default=0)
    if capacity.max_bullet_depth is not None and max_depth > capacity.max_bullet_depth:
        raise SlotCapacityError(
            "OOXML_REFERENCE_CAPACITY_TEXT_BULLET_DEPTH",
            "source paragraph depth exceeds annotated capacity",
            package_bytes=package_bytes,
        )

    text_body = _text_body(shape)
    while len(paragraphs) < len(lines):
        cloned = copy.deepcopy(paragraphs[-1])
        text_body.append(cloned)
        paragraphs.append(cloned)
    while len(paragraphs) > len(lines):
        text_body.remove(paragraphs.pop())

    substitutions: dict[str, str] = {}
    fallback_map = font_fallbacks or {}
    for paragraph, line in zip(paragraphs, lines, strict=True):
        run_properties = _first_run_properties(paragraph)
        for child in list(paragraph):
            if child.tag.rsplit("}", 1)[-1] in {"r", "br", "fld"}:
                paragraph.remove(child)
        run = ET.Element(f"{{{DRAWING_NS}}}r")
        if run_properties is not None:
            copied_properties = copy.deepcopy(run_properties)
            _apply_font_fallbacks(
                copied_properties,
                available_fonts,
                fallback_map,
                substitutions,
                package_bytes,
            )
            run.append(copied_properties)
        text_element = ET.SubElement(run, f"{{{DRAWING_NS}}}t")
        text_element.text = line
        end_properties = paragraph.find(f"{{{DRAWING_NS}}}endParaRPr")
        insert_at = list(paragraph).index(end_properties) if end_properties is not None else len(paragraph)
        paragraph.insert(insert_at, run)

    entries[slide_part] = _xml_bytes(slide)
    return TextSlotReplacementResult(
        package_bytes=_write_package(entries, infos),
        warning_codes=[],
        font_substitutions=substitutions,
    )


def _find_shape(root: ET.Element[str], shape_id: str) -> ET.Element[str]:
    for shape in root.iter():
        if shape.tag.rsplit("}", 1)[-1] not in {"sp", "pic", "graphicFrame"}:
            continue
        non_visual = shape.find(f".//{{{PRESENTATION_NS}}}cNvPr")
        if non_visual is not None and non_visual.attrib.get("id") == shape_id:
            return shape
    raise SlotCapacityError(
        "OOXML_REFERENCE_TEXT_LOCATOR_INVALID", "annotated shape ID was not found"
    )


def _text_body(shape: ET.Element[str]) -> ET.Element[str]:
    body = shape.find(f"{{{PRESENTATION_NS}}}txBody")
    if body is None:
        body = shape.find(f".//{{{DRAWING_NS}}}txBody")
    if body is None:
        raise SlotCapacityError(
            "OOXML_REFERENCE_TEXT_LOCATOR_INVALID", "annotated shape has no text body"
        )
    return body


def _first_run_properties(paragraph: ET.Element[str]) -> ET.Element[str] | None:
    properties = paragraph.find(f"{{{DRAWING_NS}}}r/{{{DRAWING_NS}}}rPr")
    if properties is not None:
        return properties
    return paragraph.find(f"{{{DRAWING_NS}}}endParaRPr")


def _paragraph_depth(paragraph: ET.Element[str]) -> int:
    properties = paragraph.find(f"{{{DRAWING_NS}}}pPr")
    if properties is None:
        return 0
    return int(properties.attrib.get("lvl", "0"))


def _apply_font_fallbacks(
    run_properties: ET.Element[str],
    available_fonts: set[str],
    fallback_map: dict[str, str],
    substitutions: dict[str, str],
    package_bytes: bytes,
) -> None:
    typefaces = [
        child
        for child in run_properties
        if child.tag.rsplit("}", 1)[-1] in {"latin", "ea", "cs"}
    ]
    for typeface in typefaces:
        original = typeface.attrib.get("typeface")
        if not original or original.startswith(("+mj-", "+mn-")):
            continue
        if original in available_fonts:
            continue
        fallback = fallback_map.get(original)
        if fallback is None or fallback not in available_fonts:
            raise SlotCapacityError(
                "OOXML_REFERENCE_FONT_UNAVAILABLE",
                "annotated font has no explicit available fallback",
                package_bytes=package_bytes,
            )
        typeface.attrib["typeface"] = fallback
        substitutions[original] = fallback


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


def _xml_bytes(root: ET.Element[str]) -> bytes:
    ET.register_namespace("a", DRAWING_NS)
    ET.register_namespace("p", PRESENTATION_NS)
    return bytes(ET.tostring(root, encoding="utf-8", xml_declaration=True))
