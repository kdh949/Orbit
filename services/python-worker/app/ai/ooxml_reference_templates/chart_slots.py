from __future__ import annotations

import hashlib
import math
import posixpath
import re
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePosixPath
from typing import Sequence
from xml.etree import ElementTree as ET

from app.ai.ooxml_reference_templates.capacity import SlotCapacityError
from app.ai.ooxml_reference_templates.models import OoxmlChartTemplateSlot


CHART_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart"
PACKAGE_RELATIONSHIPS_NS = (
    "http://schemas.openxmlformats.org/package/2006/relationships"
)
PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
OFFICE_RELATIONSHIPS_NS = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
)
SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

_CELL_RANGE = re.compile(
    r"^(?P<sheet>'(?:[^']|'')+'|[^'!]+)!"
    r"\$(?P<start_col>[A-Z]{1,3})\$(?P<start_row>[1-9][0-9]*)"
    r"(?::\$(?P<end_col>[A-Z]{1,3})\$(?P<end_row>[1-9][0-9]*))?$"
)
_SUPPORTED_CHART_TAGS = {
    "barChart",
    "lineChart",
    "pieChart",
    "doughnutChart",
}
_ALL_CHART_TAGS = {
    *_SUPPORTED_CHART_TAGS,
    "areaChart",
    "area3DChart",
    "bar3DChart",
    "bubbleChart",
    "line3DChart",
    "ofPieChart",
    "pie3DChart",
    "radarChart",
    "scatterChart",
    "stockChart",
    "surfaceChart",
    "surface3DChart",
}


@dataclass(frozen=True)
class ChartSeriesData:
    name: str
    values: tuple[float, ...]


@dataclass(frozen=True)
class ChartSlotReplacementResult:
    package_bytes: bytes
    warning_codes: list[str]
    chart_part: str
    workbook_part: str


@dataclass(frozen=True)
class _CellRange:
    sheet_token: str
    sheet_name: str
    start_column: str
    start_row: int
    end_row: int

    def formula(self, end_row: int | None = None) -> str:
        final_row = self.end_row if end_row is None else end_row
        return (
            f"{self.sheet_token}!${self.start_column}${self.start_row}:"
            f"${self.start_column}${final_row}"
        )


class _ChartMutationError(ValueError):
    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(detail)


def replace_chart_slot(
    package_bytes: bytes,
    *,
    slot: OoxmlChartTemplateSlot,
    categories: Sequence[str],
    series: Sequence[ChartSeriesData],
) -> ChartSlotReplacementResult:
    try:
        normalized_categories, normalized_series = _validate_input(
            slot, categories, series
        )
        entries, infos = _read_archive(package_bytes)
        chart_part = _resolve_chart_part(entries, slot)
        chart = _parse_xml(
            entries.get(chart_part),
            "OOXML_REFERENCE_CHART_LOCATOR_INVALID",
            "chart part cannot be loaded",
        )
        chart_type_element, chart_type = _direct_chart_type(chart)
        if chart_type != slot.capacity.chart_type:
            raise _ChartMutationError(
                "OOXML_REFERENCE_CHART_TYPE_MISMATCH",
                "live chart type differs from the manifest allowlist",
            )
        workbook_part = _resolve_workbook_part(entries, chart_part)
        workbook_bytes = entries.get(workbook_part)
        if workbook_bytes is None:
            raise _ChartMutationError(
                "OOXML_REFERENCE_CHART_WORKBOOK_UNSUPPORTED",
                "embedded chart workbook is missing",
            )
        if hashlib.sha256(workbook_bytes).hexdigest() != (
            slot.capacity.workbook_fingerprint
        ):
            raise _ChartMutationError(
                "OOXML_REFERENCE_CHART_WORKBOOK_FINGERPRINT_MISMATCH",
                "embedded workbook no longer matches the approved fingerprint",
            )

        workbook_entries, workbook_infos = _read_archive(workbook_bytes)
        series_elements = chart_type_element.findall(f"{{{CHART_NS}}}ser")
        if len(series_elements) != len(normalized_series):
            raise _ChartMutationError(
                "OOXML_REFERENCE_CHART_STRUCTURE_UNSUPPORTED",
                "series count cannot change without changing source chart identity",
            )
        bindings = _chart_bindings(series_elements)
        sheet_part = _resolve_worksheet_part(workbook_entries, bindings[0][0].sheet_name)
        sheet = _parse_xml(
            workbook_entries.get(sheet_part),
            "OOXML_REFERENCE_CHART_WORKBOOK_UNSUPPORTED",
            "embedded chart worksheet cannot be loaded",
        )
        _replace_chart_data(
            series_elements,
            bindings,
            normalized_categories,
            normalized_series,
            sheet,
        )

        entries[chart_part] = _chart_xml_bytes(chart)
        workbook_entries[sheet_part] = _spreadsheet_xml_bytes(sheet)
        entries[workbook_part] = _write_archive(workbook_entries, workbook_infos)
        return ChartSlotReplacementResult(
            package_bytes=_write_archive(entries, infos),
            warning_codes=[],
            chart_part=chart_part,
            workbook_part=workbook_part,
        )
    except _ChartMutationError as error:
        raise SlotCapacityError(
            error.code,
            str(error),
            package_bytes=package_bytes,
        ) from error


def _validate_input(
    slot: OoxmlChartTemplateSlot,
    categories: Sequence[str],
    series: Sequence[ChartSeriesData],
) -> tuple[tuple[str, ...], tuple[ChartSeriesData, ...]]:
    normalized_categories = tuple(categories)
    normalized_series = tuple(series)
    if not normalized_categories or len(normalized_categories) > (
        slot.capacity.max_categories
    ):
        raise _ChartMutationError(
            "OOXML_REFERENCE_CAPACITY_CHART_CATEGORIES",
            "category count exceeds the annotated chart capacity",
        )
    if not normalized_series or len(normalized_series) > slot.capacity.max_series:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CAPACITY_CHART_SERIES",
            "series count exceeds the annotated chart capacity",
        )
    if any(not isinstance(category, str) or not category for category in categories):
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_DATA_INVALID",
            "chart categories must be non-empty strings",
        )
    for item in normalized_series:
        if not isinstance(item, ChartSeriesData) or not item.name:
            raise _ChartMutationError(
                "OOXML_REFERENCE_CHART_DATA_INVALID",
                "chart series must have a non-empty name",
            )
        if len(item.values) != len(normalized_categories):
            raise _ChartMutationError(
                "OOXML_REFERENCE_CHART_DATA_INVALID",
                "each chart series must have one value per category",
            )
        if any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            for value in item.values
        ):
            raise _ChartMutationError(
                "OOXML_REFERENCE_CHART_DATA_INVALID",
                "chart values must be finite numbers",
            )
        if slot.capacity.chart_type in {"pie", "doughnut"} and any(
            value < 0 for value in item.values
        ):
            raise _ChartMutationError(
                "OOXML_REFERENCE_CHART_DATA_INVALID",
                "pie and doughnut chart values cannot be negative",
            )
    return normalized_categories, normalized_series


def _resolve_chart_part(
    entries: dict[str, bytes], slot: OoxmlChartTemplateSlot
) -> str:
    slide_part = slot.locator.slide_part
    slide = _parse_xml(
        entries.get(slide_part),
        "OOXML_REFERENCE_CHART_LOCATOR_INVALID",
        "annotated slide part cannot be loaded",
    )
    matching_frames: list[ET.Element[str]] = []
    for frame in slide.findall(f".//{{{PRESENTATION_NS}}}graphicFrame"):
        shape = frame.find(f".//{{{PRESENTATION_NS}}}cNvPr")
        if shape is not None and shape.attrib.get("id") == slot.locator.shape_id:
            matching_frames.append(frame)
    if len(matching_frames) != 1:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_LOCATOR_INVALID",
            "chart shape locator is missing or ambiguous",
        )
    chart_refs = matching_frames[0].findall(f".//{{{CHART_NS}}}chart")
    relationship_id = slot.locator.relationship_id
    if (
        relationship_id is None
        or len(chart_refs) != 1
        or chart_refs[0].attrib.get(f"{{{OFFICE_RELATIONSHIPS_NS}}}id")
        != relationship_id
    ):
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_LOCATOR_INVALID",
            "direct chart relationship locator drifted",
        )
    relationships = _parse_xml(
        entries.get(_rels_part(slide_part)),
        "OOXML_REFERENCE_CHART_LOCATOR_INVALID",
        "slide relationship part cannot be loaded",
    )
    matches = [
        relationship
        for relationship in relationships.findall(
            f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship"
        )
        if relationship.attrib.get("Id") == relationship_id
        and relationship.attrib.get("Type", "").endswith("/chart")
        and relationship.attrib.get("TargetMode") != "External"
    ]
    if len(matches) != 1:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_LOCATOR_INVALID",
            "chart relationship is not unique and internal",
        )
    chart_part = _resolve_target(slide_part, matches[0].attrib.get("Target", ""))
    if chart_part not in entries:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_LOCATOR_INVALID",
            "chart relationship target is missing",
        )
    return chart_part


def _direct_chart_type(
    chart: ET.Element[str],
) -> tuple[ET.Element[str], str]:
    plot_area = chart.find(f".//{{{CHART_NS}}}plotArea")
    if plot_area is None:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_TYPE_UNSUPPORTED",
            "chart has no direct plot area",
        )
    chart_elements = [
        child for child in plot_area if _local_name(child) in _ALL_CHART_TAGS
    ]
    if len(chart_elements) != 1:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_TYPE_UNSUPPORTED",
            "combined or missing chart types are preserve-only",
        )
    chart_element = chart_elements[0]
    local_type = _local_name(chart_element)
    if local_type not in _SUPPORTED_CHART_TAGS:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_TYPE_UNSUPPORTED",
            "unsupported chart types are preserve-only",
        )
    if local_type == "barChart":
        direction = chart_element.find(f"{{{CHART_NS}}}barDir")
        if direction is None or direction.attrib.get("val") not in {"bar", "col"}:
            raise _ChartMutationError(
                "OOXML_REFERENCE_CHART_TYPE_UNSUPPORTED",
                "bar chart direction is missing or unsupported",
            )
        chart_type = "bar" if direction.attrib["val"] == "bar" else "column"
    else:
        chart_type = {
            "lineChart": "line",
            "pieChart": "pie",
            "doughnutChart": "doughnut",
        }[local_type]
    return chart_element, chart_type


def _resolve_workbook_part(entries: dict[str, bytes], chart_part: str) -> str:
    relationships = _parse_xml(
        entries.get(_rels_part(chart_part)),
        "OOXML_REFERENCE_CHART_WORKBOOK_UNSUPPORTED",
        "chart relationship part cannot be loaded",
    )
    matches = [
        relationship
        for relationship in relationships.findall(
            f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship"
        )
        if relationship.attrib.get("Type", "").endswith("/package")
    ]
    if (
        len(matches) != 1
        or matches[0].attrib.get("TargetMode") == "External"
    ):
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_WORKBOOK_UNSUPPORTED",
            "chart must have exactly one internal embedded workbook",
        )
    workbook_part = _resolve_target(
        chart_part, matches[0].attrib.get("Target", "")
    )
    if PurePosixPath(workbook_part).suffix.casefold() != ".xlsx":
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_WORKBOOK_UNSUPPORTED",
            "only internal XLSX chart workbooks can be replaced",
        )
    return workbook_part


def _chart_bindings(
    series_elements: Sequence[ET.Element[str]],
) -> list[tuple[_CellRange, _CellRange, _CellRange]]:
    result: list[tuple[_CellRange, _CellRange, _CellRange]] = []
    for series in series_elements:
        category_ref = series.find(
            f"{{{CHART_NS}}}cat/{{{CHART_NS}}}strRef"
        )
        value_ref = series.find(
            f"{{{CHART_NS}}}val/{{{CHART_NS}}}numRef"
        )
        title_ref = series.find(
            f"{{{CHART_NS}}}tx/{{{CHART_NS}}}strRef"
        )
        if category_ref is None or value_ref is None or title_ref is None:
            raise _ChartMutationError(
                "OOXML_REFERENCE_CHART_STRUCTURE_UNSUPPORTED",
                "chart series must use direct string and numeric worksheet references",
            )
        category = _parse_formula(category_ref, allow_single=False)
        value = _parse_formula(value_ref, allow_single=False)
        title = _parse_formula(title_ref, allow_single=True)
        if (
            category.sheet_name != value.sheet_name
            or category.sheet_name != title.sheet_name
            or category.start_row != value.start_row
            or category.end_row != value.end_row
            or title.start_row >= category.start_row
            or title.start_column != value.start_column
        ):
            raise _ChartMutationError(
                "OOXML_REFERENCE_CHART_STRUCTURE_UNSUPPORTED",
                "chart formula ranges are not a bounded rectangular data grid",
            )
        result.append((category, value, title))
    if not result:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_STRUCTURE_UNSUPPORTED",
            "chart has no editable direct series",
        )
    first_category = result[0][0]
    if any(
        category != first_category
        or value.start_column == category.start_column
        for category, value, _ in result
    ):
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_STRUCTURE_UNSUPPORTED",
            "chart category formulas must share one independent source range",
        )
    if len({value.start_column for _, value, _ in result}) != len(result):
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_STRUCTURE_UNSUPPORTED",
            "chart value formulas must use unique workbook columns",
        )
    return result


def _parse_formula(reference: ET.Element[str], *, allow_single: bool) -> _CellRange:
    formula = reference.find(f"{{{CHART_NS}}}f")
    match = _CELL_RANGE.fullmatch(str(formula.text or "")) if formula is not None else None
    if match is None:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_STRUCTURE_UNSUPPORTED",
            "chart formula is not a direct absolute worksheet range",
        )
    end_column = match.group("end_col")
    end_row = match.group("end_row")
    if (end_column is None or end_row is None) and not allow_single:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_STRUCTURE_UNSUPPORTED",
            "chart data formula must be a cell range",
        )
    if end_column is not None and end_column != match.group("start_col"):
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_STRUCTURE_UNSUPPORTED",
            "chart data formula must use one workbook column",
        )
    sheet_token = match.group("sheet")
    sheet_name = (
        sheet_token[1:-1].replace("''", "'")
        if sheet_token.startswith("'")
        else sheet_token
    )
    start_row = int(match.group("start_row"))
    return _CellRange(
        sheet_token=sheet_token,
        sheet_name=sheet_name,
        start_column=match.group("start_col"),
        start_row=start_row,
        end_row=int(end_row) if end_row is not None else start_row,
    )


def _resolve_worksheet_part(entries: dict[str, bytes], sheet_name: str) -> str:
    workbook_part = "xl/workbook.xml"
    workbook = _parse_xml(
        entries.get(workbook_part),
        "OOXML_REFERENCE_CHART_WORKBOOK_UNSUPPORTED",
        "embedded workbook metadata is missing",
    )
    sheets = [
        sheet
        for sheet in workbook.findall(f".//{{{SPREADSHEET_NS}}}sheet")
        if sheet.attrib.get("name") == sheet_name
    ]
    if len(sheets) != 1:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_WORKBOOK_UNSUPPORTED",
            "chart formula worksheet is missing or ambiguous",
        )
    relationship_id = sheets[0].attrib.get(f"{{{OFFICE_RELATIONSHIPS_NS}}}id")
    relationships = _parse_xml(
        entries.get(_rels_part(workbook_part)),
        "OOXML_REFERENCE_CHART_WORKBOOK_UNSUPPORTED",
        "embedded workbook relationships are missing",
    )
    matches = [
        relationship
        for relationship in relationships.findall(
            f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship"
        )
        if relationship.attrib.get("Id") == relationship_id
        and relationship.attrib.get("Type", "").endswith("/worksheet")
        and relationship.attrib.get("TargetMode") != "External"
    ]
    if len(matches) != 1:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_WORKBOOK_UNSUPPORTED",
            "chart worksheet relationship is not unique and internal",
        )
    sheet_part = _resolve_target(workbook_part, matches[0].attrib.get("Target", ""))
    if sheet_part not in entries:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_WORKBOOK_UNSUPPORTED",
            "chart worksheet part is missing",
        )
    return sheet_part


def _replace_chart_data(
    series_elements: Sequence[ET.Element[str]],
    bindings: Sequence[tuple[_CellRange, _CellRange, _CellRange]],
    categories: Sequence[str],
    series_data: Sequence[ChartSeriesData],
    sheet: ET.Element[str],
) -> None:
    category_binding = bindings[0][0]
    final_row = category_binding.start_row + len(categories) - 1
    for series_element, (_, value_binding, title_binding), data in zip(
        series_elements, bindings, series_data, strict=True
    ):
        category_ref = series_element.find(
            f"{{{CHART_NS}}}cat/{{{CHART_NS}}}strRef"
        )
        value_ref = series_element.find(
            f"{{{CHART_NS}}}val/{{{CHART_NS}}}numRef"
        )
        title_ref = series_element.find(
            f"{{{CHART_NS}}}tx/{{{CHART_NS}}}strRef"
        )
        assert category_ref is not None and value_ref is not None and title_ref is not None
        _set_formula(category_ref, category_binding.formula(final_row))
        _set_formula(value_ref, value_binding.formula(final_row))
        _replace_cache(category_ref, "strCache", categories)
        _replace_cache(value_ref, "numCache", data.values)
        _replace_cache(title_ref, "strCache", (data.name,))

        _set_cell_text(
            sheet,
            f"{title_binding.start_column}{title_binding.start_row}",
            data.name,
        )
        for offset, category in enumerate(categories):
            row = category_binding.start_row + offset
            _set_cell_text(
                sheet,
                f"{category_binding.start_column}{row}",
                category,
            )
            _set_cell_number(
                sheet,
                f"{value_binding.start_column}{row}",
                data.values[offset],
            )
    _update_sheet_dimension(sheet)


def _set_formula(reference: ET.Element[str], value: str) -> None:
    formula = reference.find(f"{{{CHART_NS}}}f")
    if formula is None:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_STRUCTURE_UNSUPPORTED",
            "chart formula disappeared during replacement",
        )
    formula.text = value


def _replace_cache(
    reference: ET.Element[str], cache_name: str, values: Sequence[str | float]
) -> None:
    cache = reference.find(f"{{{CHART_NS}}}{cache_name}")
    if cache is None:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_STRUCTURE_UNSUPPORTED",
            "chart cache is missing",
        )
    for child in list(cache):
        if _local_name(child) in {"ptCount", "pt"}:
            cache.remove(child)
    extension = cache.find(f"{{{CHART_NS}}}extLst")
    insertion_index = list(cache).index(extension) if extension is not None else len(cache)
    count = ET.Element(f"{{{CHART_NS}}}ptCount", {"val": str(len(values))})
    cache.insert(insertion_index, count)
    insertion_index += 1
    for index, value in enumerate(values):
        point = ET.Element(f"{{{CHART_NS}}}pt", {"idx": str(index)})
        node = ET.SubElement(point, f"{{{CHART_NS}}}v")
        node.text = _number_text(value) if isinstance(value, (int, float)) else value
        cache.insert(insertion_index, point)
        insertion_index += 1


def _set_cell_text(sheet: ET.Element[str], reference: str, value: str) -> None:
    cell = _cell(sheet, reference)
    for child in list(cell):
        if _local_name(child) in {"f", "v", "is"}:
            cell.remove(child)
    cell.attrib["t"] = "inlineStr"
    inline = ET.SubElement(cell, f"{{{SPREADSHEET_NS}}}is")
    text = ET.SubElement(inline, f"{{{SPREADSHEET_NS}}}t")
    text.text = value


def _set_cell_number(
    sheet: ET.Element[str], reference: str, value: float
) -> None:
    cell = _cell(sheet, reference)
    for child in list(cell):
        if _local_name(child) in {"f", "v", "is"}:
            cell.remove(child)
    cell.attrib.pop("t", None)
    node = ET.SubElement(cell, f"{{{SPREADSHEET_NS}}}v")
    node.text = _number_text(value)


def _cell(sheet: ET.Element[str], reference: str) -> ET.Element[str]:
    sheet_data = sheet.find(f"{{{SPREADSHEET_NS}}}sheetData")
    if sheet_data is None:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_WORKBOOK_UNSUPPORTED",
            "chart worksheet has no sheet data",
        )
    row_number = int(re.search(r"[1-9][0-9]*$", reference).group())  # type: ignore[union-attr]
    column = re.match(r"[A-Z]+", reference)
    if column is None:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_WORKBOOK_UNSUPPORTED",
            "chart worksheet cell reference is invalid",
        )
    style_template = next(
        (
            candidate
            for candidate in reversed(sheet.findall(f".//{{{SPREADSHEET_NS}}}c"))
            if _column_letters(candidate.attrib.get("r", "")) == column.group()
            and candidate.attrib.get("s") is not None
        ),
        None,
    )
    rows = {
        int(row.attrib["r"]): row
        for row in sheet_data.findall(f"{{{SPREADSHEET_NS}}}row")
        if row.attrib.get("r", "").isdigit()
    }
    row = rows.get(row_number)
    if row is None:
        row = ET.Element(f"{{{SPREADSHEET_NS}}}row", {"r": str(row_number)})
        sheet_data.append(row)
        sheet_data[:] = sorted(
            sheet_data,
            key=lambda item: int(item.attrib.get("r", "0")),
        )
    matches = [
        item
        for item in row.findall(f"{{{SPREADSHEET_NS}}}c")
        if item.attrib.get("r") == reference
    ]
    if len(matches) > 1:
        raise _ChartMutationError(
            "OOXML_REFERENCE_CHART_WORKBOOK_UNSUPPORTED",
            "chart worksheet contains duplicate cells",
        )
    if matches:
        return matches[0]
    cell = ET.Element(f"{{{SPREADSHEET_NS}}}c", {"r": reference})
    if style_template is not None:
        cell.attrib["s"] = style_template.attrib["s"]
    row.append(cell)
    row[:] = sorted(row, key=lambda item: _column_number(item.attrib.get("r", "A1")))
    return cell


def _update_sheet_dimension(sheet: ET.Element[str]) -> None:
    cells = sheet.findall(f".//{{{SPREADSHEET_NS}}}c")
    if not cells:
        return
    references = [cell.attrib["r"] for cell in cells if "r" in cell.attrib]
    if not references:
        return
    maximum = max(
        references,
        key=lambda reference: (
            int(re.search(r"[1-9][0-9]*$", reference).group()),  # type: ignore[union-attr]
            _column_number(reference),
        ),
    )
    dimension = sheet.find(f"{{{SPREADSHEET_NS}}}dimension")
    if dimension is not None:
        dimension.attrib["ref"] = f"A1:{maximum}"


def _column_number(reference: str) -> int:
    column = _column_letters(reference)
    if not column:
        return 0
    result = 0
    for character in column:
        result = result * 26 + ord(character) - ord("A") + 1
    return result


def _column_letters(reference: str) -> str:
    match = re.match(r"[A-Z]+", reference)
    return match.group() if match is not None else ""


def _number_text(value: str | float) -> str:
    if isinstance(value, str):
        return value
    return format(float(value), ".15g")


def _read_archive(
    content: bytes,
) -> tuple[dict[str, bytes], dict[str, zipfile.ZipInfo]]:
    try:
        with zipfile.ZipFile(BytesIO(content), "r") as package:
            infos = {item.filename: item for item in package.infolist()}
            entries = {
                item.filename: package.read(item.filename)
                for item in package.infolist()
                if not item.is_dir()
            }
    except (OSError, KeyError, zipfile.BadZipFile) as error:
        raise _ChartMutationError(
            "OOXML_REFERENCE_PACKAGE_INVALID",
            "OOXML package or embedded workbook cannot be read",
        ) from error
    return entries, infos


def _write_archive(
    entries: dict[str, bytes], infos: dict[str, zipfile.ZipInfo]
) -> bytes:
    output = BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as package:
        for name in sorted(entries):
            package.writestr(infos.get(name, name), entries[name])
    return output.getvalue()


def _parse_xml(
    content: bytes | None, code: str, detail: str
) -> ET.Element[str]:
    try:
        if content is None:
            raise ET.ParseError("missing part")
        return ET.fromstring(content)
    except ET.ParseError as error:
        raise _ChartMutationError(code, detail) from error


def _rels_part(part: str) -> str:
    path = PurePosixPath(part)
    return str(path.parent / "_rels" / f"{path.name}.rels")


def _resolve_target(source_part: str, target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join(posixpath.dirname(source_part), target))


def _local_name(element: ET.Element[str]) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _chart_xml_bytes(root: ET.Element[str]) -> bytes:
    ET.register_namespace("a", "http://schemas.openxmlformats.org/drawingml/2006/main")
    ET.register_namespace("c", CHART_NS)
    ET.register_namespace("r", OFFICE_RELATIONSHIPS_NS)
    return bytes(ET.tostring(root, encoding="utf-8", xml_declaration=True))


def _spreadsheet_xml_bytes(root: ET.Element[str]) -> bytes:
    ET.register_namespace("", SPREADSHEET_NS)
    return bytes(ET.tostring(root, encoding="utf-8", xml_declaration=True))
