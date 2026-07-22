from __future__ import annotations

import copy
import hashlib
import zipfile
from dataclasses import dataclass
from io import BytesIO
from typing import Any
from xml.etree import ElementTree as ET

from app.ai.ooxml_reference_templates.capacity import SlotCapacityError
from app.ai.ooxml_reference_templates.chart_slots import (
    CHART_NS,
    OFFICE_RELATIONSHIPS_NS,
    PACKAGE_RELATIONSHIPS_NS,
    PRESENTATION_NS,
    ChartSeriesData,
    _chart_bindings,
    _direct_chart_type,
    _parse_xml,
    _read_archive,
    _rels_part,
    _resolve_target,
    _resolve_worksheet_part,
    _resolve_workbook_part,
    replace_chart_slot,
)
from app.ai.ooxml_reference_templates.models import OoxmlChartTemplateSlot


@dataclass(frozen=True)
class ChartDataSyncResult:
    package_bytes: bytes
    updated_source: dict[str, Any]


class ChartDataSyncError(ValueError):
    def __init__(self, code: str, detail: str, *, package_bytes: bytes) -> None:
        self.code = code
        self.package_bytes = package_bytes
        super().__init__(f"{code}: {detail}")


def build_chart_data_locator(
    package_bytes: bytes,
    *,
    source: dict[str, Any],
) -> dict[str, Any]:
    try:
        entries = _read_entries(package_bytes)
        slide_part = _required_string(source, "slidePart")
        shape_id = _required_string(source, "shapeId")
        relationship_id = _required_string(source, "relationshipId")
        if (
            source.get("elementType") != "chart"
            or source.get("sourceType") != "chart"
            or source.get("ooxmlOrigin") != "imported"
            or not source.get("writable")
            or source.get("fallbackReason")
        ):
            raise ChartDataSyncError(
                "CHART_CAPABILITY_UNSAFE",
                "chart source provenance is not authoritative",
                package_bytes=package_bytes,
            )
        chart_part = _resolve_unique_chart_part(
            entries,
            slide_part=slide_part,
            shape_id=shape_id,
            relationship_id=relationship_id,
            package_bytes=package_bytes,
        )
        chart = _parse_xml(
            entries.get(chart_part),
            "CHART_PART_INVALID",
            "chart XML cannot be loaded",
        )
        chart_type_element, chart_type = _direct_chart_type(chart)
        series_elements = chart_type_element.findall(f"{{{CHART_NS}}}ser")
        category_formulas = [_formula(item, "cat", "strRef") for item in series_elements]
        if len(set(category_formulas)) != 1:
            raise ChartDataSyncError(
                "CHART_FORMULA_DRIFT",
                "chart category formulas are not identical",
                package_bytes=package_bytes,
            )
        bindings = _chart_bindings(series_elements)
        workbook_part = _resolve_workbook_part(entries, chart_part)
        workbook_bytes = entries.get(workbook_part)
        if workbook_bytes is None:
            raise ChartDataSyncError(
                "CHART_WORKBOOK_UNSUPPORTED",
                "embedded workbook is missing",
                package_bytes=package_bytes,
            )
        workbook_entries, _workbook_infos = _read_archive(workbook_bytes)
        _resolve_worksheet_part(workbook_entries, bindings[0][0].sheet_name)
        return {
            "chartType": chart_type,
            "chartPart": chart_part,
            "workbookPart": workbook_part,
            "workbookFingerprint": hashlib.sha256(workbook_bytes).hexdigest(),
            "categoryFormula": category_formulas[0],
            "series": [
                {
                    "titleFormula": _formula(item, "tx", "strRef"),
                    "valueFormula": _formula(item, "val", "numRef"),
                }
                for item in series_elements
            ],
        }
    except ChartDataSyncError:
        raise
    except (KeyError, ValueError, zipfile.BadZipFile, ET.ParseError) as error:
        code = getattr(error, "code", "CHART_STRUCTURE_UNSUPPORTED")
        raise ChartDataSyncError(
            _public_error_code(str(code)),
            "chart source cannot prove a bounded editable workbook mapping",
            package_bytes=package_bytes,
        ) from error


def sync_chart_data(
    package_bytes: bytes,
    *,
    source: dict[str, Any],
    props: dict[str, Any],
) -> ChartDataSyncResult:
    capabilities = source.get("ooxmlEditCapabilities")
    declared = source.get("chartDataLocator")
    if not isinstance(capabilities, dict) or capabilities.get("chartData") is not True:
        raise ChartDataSyncError(
            "CHART_CAPABILITY_UNSAFE",
            "chart data capability is not enabled",
            package_bytes=package_bytes,
        )
    if not isinstance(declared, dict):
        raise ChartDataSyncError(
            "CHART_CAPABILITY_UNSAFE",
            "authoritative chart locator is missing",
            package_bytes=package_bytes,
        )
    live = build_chart_data_locator(package_bytes, source=source)
    _validate_locator_identity(declared, live, package_bytes)
    categories, series = _chart_data_from_props(
        package_bytes,
        props=props,
        locator=live,
        chart_xml=_read_entries(package_bytes)[str(live["chartPart"])],
    )
    slot = OoxmlChartTemplateSlot.model_validate(
        {
            "slotId": "sync-chart-data",
            "semanticRole": "chart",
            "contentType": "chart",
            "required": True,
            "locator": {
                "slidePart": source["slidePart"],
                "shapeId": source["shapeId"],
                "placeholderType": None,
                "relationshipId": source["relationshipId"],
            },
            "capacity": {
                "chartType": live["chartType"],
                "maxCategories": len(categories),
                "maxSeries": len(series),
                "workbookUpdatePolicy": "atomic",
                "workbookFingerprint": live["workbookFingerprint"],
            },
            "mutationPolicy": ["chart-data"],
            "replacementPolicy": {"overflow": "fail"},
        }
    )
    try:
        replacement = replace_chart_slot(
            package_bytes,
            slot=slot,
            categories=categories,
            series=series,
        )
    except SlotCapacityError as error:
        raise ChartDataSyncError(
            _public_error_code(error.code),
            "chart data replacement was rejected",
            package_bytes=package_bytes,
        ) from error
    updated_source = copy.deepcopy(source)
    updated_source["chartDataLocator"] = build_chart_data_locator(
        replacement.package_bytes,
        source=updated_source,
    )
    return ChartDataSyncResult(
        package_bytes=replacement.package_bytes,
        updated_source=updated_source,
    )


def _validate_locator_identity(
    declared: dict[str, Any], live: dict[str, Any], package_bytes: bytes
) -> None:
    for field in ("chartType", "chartPart", "workbookPart"):
        if declared.get(field) != live.get(field):
            raise ChartDataSyncError(
                "CHART_RELATIONSHIP_UNSAFE",
                f"authoritative {field} locator drifted",
                package_bytes=package_bytes,
            )
    if declared.get("workbookFingerprint") != live.get("workbookFingerprint"):
        raise ChartDataSyncError(
            "CHART_WORKBOOK_FINGERPRINT_MISMATCH",
            "embedded workbook fingerprint drifted",
            package_bytes=package_bytes,
        )
    if (
        declared.get("categoryFormula") != live.get("categoryFormula")
        or declared.get("series") != live.get("series")
    ):
        raise ChartDataSyncError(
            "CHART_FORMULA_DRIFT",
            "chart formula mapping drifted",
            package_bytes=package_bytes,
        )


def _chart_data_from_props(
    package_bytes: bytes,
    *,
    props: dict[str, Any],
    locator: dict[str, Any],
    chart_xml: bytes,
) -> tuple[list[str], list[ChartSeriesData]]:
    expected_type = "bar" if locator["chartType"] in {"bar", "column"} else locator["chartType"]
    if props.get("type") != expected_type or set(props) - {"type", "data"}:
        raise ChartDataSyncError(
            "CHART_TYPE_UNSUPPORTED",
            "only data for the existing chart type can be changed",
            package_bytes=package_bytes,
        )
    data = props.get("data")
    if not isinstance(data, list) or not data:
        raise ChartDataSyncError(
            "CHART_STRUCTURE_UNSUPPORTED",
            "chart data must be a non-empty list",
            package_bytes=package_bytes,
        )
    existing_names = _series_names(chart_xml)
    expected_series_count = len(locator["series"])
    grouped: dict[str, list[tuple[str, float]]] = {}
    for item in data:
        if not isinstance(item, dict) or set(item) - {"label", "series", "value"}:
            raise ChartDataSyncError(
                "CHART_STRUCTURE_UNSUPPORTED",
                "chart datum shape changed",
                package_bytes=package_bytes,
            )
        label = item.get("label")
        value = item.get("value")
        if not isinstance(label, str) or not label or isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ChartDataSyncError(
                "CHART_STRUCTURE_UNSUPPORTED",
                "chart datum is invalid",
                package_bytes=package_bytes,
            )
        series_name = item.get("series")
        if series_name is None and expected_series_count == 1:
            series_name = existing_names[0]
        if not isinstance(series_name, str) or not series_name:
            raise ChartDataSyncError(
                "CHART_STRUCTURE_UNSUPPORTED",
                "series identity is missing",
                package_bytes=package_bytes,
            )
        grouped.setdefault(series_name, []).append((label, float(value)))
    if len(grouped) != expected_series_count:
        raise ChartDataSyncError(
            "CHART_STRUCTURE_UNSUPPORTED",
            "series count changed",
            package_bytes=package_bytes,
        )
    categories = [label for label, _ in next(iter(grouped.values()))]
    expected_category_count = _formula_count(str(locator["categoryFormula"]))
    if len(categories) != expected_category_count or any(
        [label for label, _ in values] != categories for values in grouped.values()
    ):
        raise ChartDataSyncError(
            "CHART_STRUCTURE_UNSUPPORTED",
            "category count or ordering changed",
            package_bytes=package_bytes,
        )
    return categories, [
        ChartSeriesData(name=name, values=tuple(value for _, value in values))
        for name, values in grouped.items()
    ]


def _resolve_unique_chart_part(
    entries: dict[str, bytes],
    *,
    slide_part: str,
    shape_id: str,
    relationship_id: str,
    package_bytes: bytes,
) -> str:
    slide = ET.fromstring(entries[slide_part])
    frames = []
    for frame in slide.findall(f".//{{{PRESENTATION_NS}}}graphicFrame"):
        shape = frame.find(f".//{{{PRESENTATION_NS}}}cNvPr")
        if shape is not None and shape.attrib.get("id") == shape_id:
            frames.append(frame)
    if len(frames) != 1:
        raise ChartDataSyncError(
            "CHART_RELATIONSHIP_UNSAFE",
            "chart shape locator is missing or ambiguous",
            package_bytes=package_bytes,
        )
    chart_refs = frames[0].findall(f".//{{{CHART_NS}}}chart")
    if (
        len(chart_refs) != 1
        or chart_refs[0].attrib.get(f"{{{OFFICE_RELATIONSHIPS_NS}}}id")
        != relationship_id
    ):
        raise ChartDataSyncError(
            "CHART_RELATIONSHIP_UNSAFE",
            "chart relationship locator drifted",
            package_bytes=package_bytes,
        )
    relationships = ET.fromstring(entries[_rels_part(slide_part)])
    matches = [
        item
        for item in relationships.findall(f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship")
        if item.attrib.get("Id") == relationship_id
        and item.attrib.get("Type", "").endswith("/chart")
        and item.attrib.get("TargetMode") != "External"
    ]
    if len(matches) != 1:
        raise ChartDataSyncError(
            "CHART_RELATIONSHIP_UNSAFE",
            "chart relationship is not unique and internal",
            package_bytes=package_bytes,
        )
    chart_part = _resolve_target(slide_part, matches[0].attrib.get("Target", ""))
    if chart_part not in entries:
        raise ChartDataSyncError(
            "CHART_RELATIONSHIP_UNSAFE",
            "chart relationship target is missing",
            package_bytes=package_bytes,
        )
    return chart_part


def _formula(series: ET.Element[str], branch: str, reference: str) -> str:
    formula = series.find(
        f"{{{CHART_NS}}}{branch}/{{{CHART_NS}}}{reference}/{{{CHART_NS}}}f"
    )
    if formula is None or not formula.text:
        raise ValueError("chart formula missing")
    return formula.text


def _series_names(chart_xml: bytes) -> list[str]:
    chart = ET.fromstring(chart_xml)
    chart_type, _ = _direct_chart_type(chart)
    result: list[str] = []
    for series in chart_type.findall(f"{{{CHART_NS}}}ser"):
        cache = series.find(
            f"{{{CHART_NS}}}tx/{{{CHART_NS}}}strRef/{{{CHART_NS}}}strCache"
        )
        value = cache.find(f"{{{CHART_NS}}}pt/{{{CHART_NS}}}v") if cache is not None else None
        result.append(str(value.text or "Series") if value is not None else "Series")
    return result


def _formula_count(formula: str) -> int:
    cells = formula.rsplit("!", 1)[-1].split(":")
    if len(cells) != 2:
        raise ValueError("category formula is not a range")
    start = int("".join(character for character in cells[0] if character.isdigit()))
    end = int("".join(character for character in cells[1] if character.isdigit()))
    return end - start + 1


def _required_string(source: dict[str, Any], field: str) -> str:
    value = source.get(field)
    if not isinstance(value, str) or not value:
        raise ValueError(f"missing {field}")
    return value


def _read_entries(package_bytes: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(BytesIO(package_bytes), "r") as package:
        return {
            item.filename: package.read(item.filename)
            for item in package.infolist()
            if not item.is_dir()
        }


def _public_error_code(code: str) -> str:
    if "WORKBOOK_FINGERPRINT" in code:
        return "CHART_WORKBOOK_FINGERPRINT_MISMATCH"
    if "WORKBOOK" in code:
        return "CHART_WORKBOOK_UNSUPPORTED"
    if "TYPE" in code:
        return "CHART_TYPE_UNSUPPORTED"
    if "LOCATOR" in code or "RELATIONSHIP" in code:
        return "CHART_RELATIONSHIP_UNSAFE"
    return "CHART_STRUCTURE_UNSUPPORTED"
