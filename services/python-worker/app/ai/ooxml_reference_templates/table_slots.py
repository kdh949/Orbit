from __future__ import annotations

import copy
import zipfile
from dataclasses import dataclass
from io import BytesIO
from xml.etree import ElementTree as ET

from app.ai.ooxml_reference_templates.capacity import SlotCapacityError
from app.ai.ooxml_reference_templates.models import OoxmlTableTemplateSlot
from app.ai.pptx_ooxml_vector_importer import table_cell_fingerprint


DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
TABLE_GRAPHIC_DATA_URI = "http://schemas.openxmlformats.org/drawingml/2006/table"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"


@dataclass(frozen=True)
class TableSlotReplacementResult:
    package_bytes: bytes
    warning_codes: list[str]


def replace_table_slot(
    package_bytes: bytes,
    *,
    slot: OoxmlTableTemplateSlot,
    rows: list[list[str]],
) -> TableSlotReplacementResult:
    entries, infos = _read_package(package_bytes)
    slide_part = slot.locator.slide_part
    try:
        slide = ET.fromstring(entries[slide_part])
    except (KeyError, ET.ParseError) as error:
        raise _error(
            "OOXML_REFERENCE_TABLE_LOCATOR_INVALID",
            "annotated slide part cannot be loaded",
            package_bytes,
        ) from error

    table = _find_direct_table(slide, slot.locator.shape_id, package_bytes)
    table_rows, table_cells = _rectangular_cells(table, package_bytes)
    actual_row_count = len(table_rows)
    actual_column_count = len(table_cells[0])
    capacity = slot.capacity
    if (
        capacity.row_count != actual_row_count
        or capacity.column_count != actual_column_count
        or len(rows) != capacity.row_count
        or any(
            not isinstance(row, list) or len(row) != capacity.column_count
            for row in rows
        )
        or any(not isinstance(value, str) for row in rows for value in row)
    ):
        raise _error(
            "OOXML_REFERENCE_CAPACITY_TABLE_SHAPE",
            "table data and source tracks must match the annotated rectangular capacity",
            package_bytes,
        )

    editable: dict[tuple[int, int], str] = {}
    for locator in capacity.editable_cells:
        index = (locator.row_index, locator.column_index)
        if (
            index in editable
            or locator.row_index >= actual_row_count
            or locator.column_index >= actual_column_count
        ):
            raise _error(
                "OOXML_REFERENCE_TABLE_LOCATOR_INVALID",
                "editable cell locator is duplicate or outside the source table",
                package_bytes,
            )
        cell = table_cells[locator.row_index][locator.column_index]
        if table_cell_fingerprint(cell) != locator.fingerprint:
            raise _error(
                "OOXML_REFERENCE_TABLE_LOCATOR_FINGERPRINT_MISMATCH",
                "editable cell locator no longer matches the immutable source cell",
                package_bytes,
            )
        editable[index] = locator.fingerprint

    for row_index, cells in enumerate(table_cells):
        for column_index, cell in enumerate(cells):
            target_text = rows[row_index][column_index]
            if (row_index, column_index) not in editable:
                if target_text != _cell_text(cell):
                    raise _error(
                        "OOXML_REFERENCE_TABLE_CELL_NOT_EDITABLE",
                        "table data attempts to change a cell outside the annotated policy",
                        package_bytes,
                    )
                continue
            if not _set_cell_text(cell, target_text):
                raise _error(
                    "OOXML_REFERENCE_TABLE_TEXT_UNSAFE",
                    "cell text body cannot be replaced without changing its structure",
                    package_bytes,
                )

    entries[slide_part] = _xml_bytes(slide)
    return TableSlotReplacementResult(
        package_bytes=_write_package(entries, infos),
        warning_codes=[],
    )


def _find_direct_table(
    slide: ET.Element[str],
    shape_id: str,
    package_bytes: bytes,
) -> ET.Element[str]:
    matches: list[ET.Element[str]] = []
    for frame in slide.iter(f"{{{PRESENTATION_NS}}}graphicFrame"):
        non_visual = frame.find(
            f"{{{PRESENTATION_NS}}}nvGraphicFramePr/{{{PRESENTATION_NS}}}cNvPr"
        )
        if non_visual is None or non_visual.get("id") != shape_id:
            continue
        graphic = frame.find(f"{{{DRAWING_NS}}}graphic")
        graphic_data = (
            graphic.find(f"{{{DRAWING_NS}}}graphicData")
            if graphic is not None
            else None
        )
        table = (
            graphic_data.find(f"{{{DRAWING_NS}}}tbl")
            if graphic_data is not None
            and graphic_data.get("uri") == TABLE_GRAPHIC_DATA_URI
            else None
        )
        if table is not None:
            matches.append(table)
    if len(matches) != 1:
        raise _error(
            "OOXML_REFERENCE_TABLE_STRUCTURE_UNSUPPORTED",
            "table locator must resolve to one direct graphic-frame table",
            package_bytes,
        )
    return matches[0]


def _rectangular_cells(
    table: ET.Element[str],
    package_bytes: bytes,
) -> tuple[list[ET.Element[str]], list[list[ET.Element[str]]]]:
    grids = [child for child in table if child.tag == f"{{{DRAWING_NS}}}tblGrid"]
    rows = [child for child in table if child.tag == f"{{{DRAWING_NS}}}tr"]
    columns = (
        [child for child in grids[0] if child.tag == f"{{{DRAWING_NS}}}gridCol"]
        if len(grids) == 1
        else []
    )
    cells = [
        [child for child in row if child.tag == f"{{{DRAWING_NS}}}tc"] for row in rows
    ]
    if (
        not rows
        or not columns
        or len(grids) != 1
        or any(len(row_cells) != len(columns) for row_cells in cells)
        or any(_cell_has_merge(cell) for row_cells in cells for cell in row_cells)
    ):
        raise _error(
            "OOXML_REFERENCE_TABLE_STRUCTURE_UNSUPPORTED",
            "only direct unmerged rectangular tables are editable",
            package_bytes,
        )
    return rows, cells


def _cell_has_merge(cell: ET.Element[str]) -> bool:
    for name in ("gridSpan", "rowSpan"):
        raw = cell.get(name)
        if raw is None:
            continue
        try:
            if int(raw) != 1:
                return True
        except ValueError:
            return True
    for name in ("hMerge", "vMerge"):
        raw = cell.get(name)
        if raw is None:
            continue
        if raw.casefold() not in {"0", "false", "off"}:
            return True
    return False


def _cell_text(cell: ET.Element[str]) -> str:
    body = _direct_child(cell, "txBody")
    if body is None:
        return ""
    return "\n".join(
        "".join(
            text.text or ""
            for run in _direct_children(paragraph, "r")
            for text in _direct_children(run, "t")
        )
        for paragraph in _direct_children(body, "p")
    )


def _set_cell_text(cell: ET.Element[str], value: str) -> bool:
    body = _direct_child(cell, "txBody")
    if body is None or not _safe_text_body(body):
        return False
    paragraphs = _direct_children(body, "p")
    lines = value.split("\n")
    if len(lines) != len(paragraphs):
        return False
    for paragraph, line in zip(paragraphs, lines, strict=True):
        runs = _direct_children(paragraph, "r")
        if runs:
            text = _direct_child(runs[0], "t")
            if text is None:
                return False
            _set_text(text, line)
            continue
        if not line:
            continue
        run = ET.Element(f"{{{DRAWING_NS}}}r")
        end_properties = _direct_child(paragraph, "endParaRPr")
        if end_properties is not None:
            properties = copy.deepcopy(end_properties)
            properties.tag = f"{{{DRAWING_NS}}}rPr"
            run.append(properties)
        text = ET.SubElement(run, f"{{{DRAWING_NS}}}t")
        _set_text(text, line)
        insert_at = (
            list(paragraph).index(end_properties)
            if end_properties is not None
            else len(paragraph)
        )
        paragraph.insert(insert_at, run)
    return True


def _safe_text_body(body: ET.Element[str]) -> bool:
    if any(
        _local_name(child) not in {"bodyPr", "lstStyle", "p", "extLst"}
        for child in body
    ):
        return False
    paragraphs = _direct_children(body, "p")
    if not paragraphs:
        return False
    for paragraph in paragraphs:
        if any(
            _local_name(child) not in {"pPr", "r", "endParaRPr"} for child in paragraph
        ):
            return False
        runs = _direct_children(paragraph, "r")
        if len(runs) > 1:
            return False
        if runs and (
            any(_local_name(child) not in {"rPr", "t"} for child in runs[0])
            or len(_direct_children(runs[0], "t")) != 1
            or any(
                _local_name(descendant) in {"hlinkClick", "hlinkMouseOver"}
                for descendant in runs[0].iter()
            )
        ):
            return False
    return True


def _set_text(node: ET.Element[str], value: str) -> None:
    node.text = value
    if value != value.strip():
        node.set(XML_SPACE, "preserve")
    else:
        node.attrib.pop(XML_SPACE, None)


def _direct_child(root: ET.Element[str], local_name: str) -> ET.Element[str] | None:
    return next(
        (child for child in root if _local_name(child) == local_name),
        None,
    )


def _direct_children(root: ET.Element[str], local_name: str) -> list[ET.Element[str]]:
    return [child for child in root if _local_name(child) == local_name]


def _local_name(element: ET.Element[str]) -> str:
    return element.tag.rsplit("}", 1)[-1]


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
        raise _error(
            "OOXML_REFERENCE_PACKAGE_INVALID",
            "package cannot be mutated",
            package_bytes,
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


def _error(code: str, detail: str, package_bytes: bytes) -> SlotCapacityError:
    return SlotCapacityError(code, detail, package_bytes=package_bytes)
