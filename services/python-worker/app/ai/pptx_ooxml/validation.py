from __future__ import annotations


import copy


import math


import zipfile


from typing import Any, cast

from xml.etree import ElementTree as ET


from app.ai.pptx_ooxml_vector_importer import (
    OoxmlScale,
    direct_graphic_frame_table,
    table_column_widths,
    table_row_heights,
    table_rows,
    theme_color_map,
)


from typing import TYPE_CHECKING

from app.ai.pptx_ooxml.common import (
    PptxOoxmlSyncOperationType,
    PptxOoxmlUnsupportedReasonCode,
    SUPPORTED_TABLE_CELL_PROPS,
    SUPPORTED_TABLE_PROPS,
    SUPPORTED_TEXT_PARAGRAPH_PROPS,
    SUPPORTED_TEXT_PROPS,
    SUPPORTED_TEXT_RUN_PROPS,
)

if TYPE_CHECKING:
    from app.ai.pptx_ooxml.models import (
        PackageFrameScale,
        PptxOoxmlAppliedOperation,
        PptxOoxmlUnsupportedOperation,
    )


def validate_imported_table_props_update(
    shape: ET.Element[Any],
    props: dict[str, Any],
    scale: PackageFrameScale,
    source_package: zipfile.ZipFile,
) -> PptxOoxmlUnsupportedReasonCode | None:
    from app.ai.pptx_ooxml.media import (
        table_cell_text_can_set,
    )
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
    )

    table = direct_graphic_frame_table(shape)
    if table is None:
        return "TABLE_CELL_CAPABILITY_UNSAFE"
    ooxml_scale = OoxmlScale(
        canvas_width=scale.canvas_width,
        canvas_height=scale.canvas_height,
        slide_width_emu=scale.slide_width_emu,
        slide_height_emu=scale.slide_height_emu,
    )
    actual_rows = table_rows(table, ooxml_scale, theme_color_map(source_package))
    target_rows = props.get("rows")
    if (
        not isinstance(target_rows, list)
        or len(target_rows) != len(actual_rows)
        or any(
            not isinstance(target_row, list) or len(target_row) != len(actual_row)
            for target_row, actual_row in zip(target_rows, actual_rows, strict=True)
        )
    ):
        return "TABLE_STRUCTURE_UNSUPPORTED"

    changed_text_count = 0
    xml_rows = direct_local_children(table, "tr")
    for row_index, (target_row, actual_row) in enumerate(
        zip(target_rows, actual_rows, strict=True)
    ):
        xml_cells = direct_local_children(xml_rows[row_index], "tc")
        for column_index, (target_cell, actual_cell) in enumerate(
            zip(target_row, actual_row, strict=True)
        ):
            if not isinstance(target_cell, dict):
                return "TABLE_STRUCTURE_UNSUPPORTED"
            if not table_cell_non_text_equal(target_cell, actual_cell):
                return "TABLE_STRUCTURE_UNSUPPORTED"
            if str(target_cell.get("text", "")) != str(actual_cell.get("text", "")):
                changed_text_count += 1
                if not table_cell_text_can_set(
                    xml_cells[column_index],
                    str(target_cell.get("text", "")),
                ):
                    return "TABLE_STRUCTURE_UNSUPPORTED"
    if changed_text_count != 1:
        return "TABLE_STRUCTURE_UNSUPPORTED"

    if "columnWidths" in props and not numeric_track_values_equal(
        props.get("columnWidths"), table_column_widths(table, ooxml_scale)
    ):
        return "TABLE_STRUCTURE_UNSUPPORTED"
    if "rowHeights" in props and not numeric_track_values_equal(
        props.get("rowHeights"), table_row_heights(table, ooxml_scale)
    ):
        return "TABLE_STRUCTURE_UNSUPPORTED"
    if "borderColor" in props and not table_value_equal(
        props.get("borderColor"), "#CBD5E1"
    ):
        return "TABLE_STRUCTURE_UNSUPPORTED"
    if "borderWidth" in props and not table_value_equal(props.get("borderWidth"), 1):
        return "TABLE_STRUCTURE_UNSUPPORTED"
    return None


def table_cell_non_text_equal(
    target: dict[str, Any],
    actual: dict[str, Any],
) -> bool:
    if set(target) - SUPPORTED_TABLE_CELL_PROPS:
        return False
    defaults: dict[str, Any] = {
        "fill": "transparent",
        "fontSize": 18,
        "fontWeight": "normal",
        "align": "left",
        "verticalAlign": "middle",
        "borderColor": "#CBD5E1",
        "borderWidth": 1,
        "colSpan": 1,
        "rowSpan": 1,
    }
    for key in SUPPORTED_TABLE_CELL_PROPS - {"text"}:
        target_value = target.get(key, defaults.get(key))
        actual_value = actual.get(key, defaults.get(key))
        if not table_value_equal(target_value, actual_value):
            return False
    return True


def numeric_track_values_equal(target: Any, actual: list[int]) -> bool:
    return (
        isinstance(target, list)
        and len(target) == len(actual)
        and all(
            table_value_equal(left, right)
            for left, right in zip(target, actual, strict=True)
        )
    )


def table_value_equal(left: Any, right: Any) -> bool:
    from app.ai.pptx_ooxml.routing import (
        valid_hex_color,
    )

    if isinstance(left, bool) or isinstance(right, bool):
        return left is right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return math.isclose(float(left), float(right), rel_tol=1e-4, abs_tol=0.1)
    if isinstance(left, str) and isinstance(right, str):
        if valid_hex_color(left) and valid_hex_color(right):
            return left.upper() == right.upper()
    return bool(left == right)


def valid_table_props(props: dict[str, Any]) -> bool:
    from app.ai.pptx_ooxml.routing import (
        valid_hex_color,
    )

    if not props or set(props) - SUPPORTED_TABLE_PROPS:
        return False
    rows = props.get("rows")
    if not isinstance(rows, list) or not 1 <= len(rows) <= 1000:
        return False
    if not isinstance(rows[0], list) or not 1 <= len(rows[0]) <= 1000:
        return False
    column_count = len(rows[0])
    if len(rows) * column_count > 10_000:
        return False
    if any(not isinstance(row, list) or len(row) != column_count for row in rows):
        return False
    if any(
        not isinstance(cell, dict) or not valid_table_cell_props(cell)
        for row in rows
        for cell in row
    ):
        return False
    if not valid_table_tracks(props.get("columnWidths"), column_count):
        return False
    if not valid_table_tracks(props.get("rowHeights"), len(rows)):
        return False
    border_color = props.get("borderColor", "#CBD5E1")
    border_width = props.get("borderWidth", 1)
    return (
        isinstance(border_color, str)
        and valid_hex_color(border_color)
        and finite_table_number(border_width, minimum=0)
    )


def valid_table_cell_props(cell: dict[str, Any]) -> bool:
    from app.ai.pptx_ooxml.routing import (
        valid_hex_color,
    )

    if set(cell) - SUPPORTED_TABLE_CELL_PROPS:
        return False
    text = cell.get("text", "")
    fill = cell.get("fill", "transparent")
    text_color = cell.get("textColor")
    font_family = cell.get("fontFamily")
    font_weight = cell.get("fontWeight", "normal")
    return (
        isinstance(text, str)
        and isinstance(fill, str)
        and (fill == "transparent" or valid_hex_color(fill))
        and (
            text_color is None
            or isinstance(text_color, str)
            and valid_hex_color(text_color)
        )
        and (font_family is None or isinstance(font_family, str) and bool(font_family))
        and finite_table_number(cell.get("fontSize", 18), minimum=0, strict=True)
        and valid_table_font_weight(font_weight)
        and cell.get("align", "left") in {"left", "center", "right", "justify"}
        and cell.get("verticalAlign", "middle") in {"top", "middle", "bottom"}
        and isinstance(cell.get("borderColor", "#CBD5E1"), str)
        and valid_hex_color(str(cell.get("borderColor", "#CBD5E1")))
        and finite_table_number(cell.get("borderWidth", 1), minimum=0)
        and valid_positive_integer(cell.get("colSpan", 1))
        and valid_positive_integer(cell.get("rowSpan", 1))
        and int(cell.get("colSpan", 1)) == 1
        and int(cell.get("rowSpan", 1)) == 1
    )


def valid_table_tracks(value: Any, count: int) -> bool:
    return value is None or (
        isinstance(value, list)
        and len(value) == count
        and all(finite_table_number(item, minimum=0, strict=True) for item in value)
    )


def valid_table_font_weight(value: Any) -> bool:
    return isinstance(value, str) and value in {"normal", "bold"}


def valid_positive_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def finite_table_number(
    value: Any,
    *,
    minimum: float,
    strict: bool = False,
) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
        and (float(value) > minimum if strict else float(value) >= minimum)
    )


def valid_text_props(props: dict[str, Any]) -> bool:
    if set(props) - SUPPORTED_TEXT_PROPS:
        return False
    if "text" in props and not isinstance(props.get("text"), str):
        return False
    if not valid_text_style_values(props):
        return False
    if props.get("align", "left") not in {"left", "center", "right", "justify"}:
        return False
    if props.get("verticalAlign", "top") not in {"top", "middle", "bottom"}:
        return False
    if props.get("writingMode", "horizontal") not in {"horizontal", "vertical-270"}:
        return False
    auto_fit = props.get("autoFit")
    if auto_fit is not None and auto_fit not in {"none", "shrink-text", "resize-shape"}:
        return False
    if "fontScale" in props and not valid_ratio(props.get("fontScale"), positive=True):
        return False
    if "lineSpaceReduction" in props and not valid_ratio(
        props.get("lineSpaceReduction")
    ):
        return False
    if (
        any(key in props for key in ("fontScale", "lineSpaceReduction"))
        and auto_fit != "shrink-text"
    ):
        return False
    if not valid_positive_number(props.get("lineHeight", 1.2)):
        return False
    if not valid_text_body_inset(props.get("bodyInset")):
        return False
    if "bullet" in props and not valid_text_bullet(props.get("bullet")):
        return False
    runs = props.get("runs")
    if runs is not None and (
        not isinstance(runs, list) or any(not valid_text_run(run) for run in runs)
    ):
        return False
    paragraphs = props.get("paragraphs")
    if paragraphs is not None and (
        not isinstance(paragraphs, list)
        or any(not valid_text_paragraph(item) for item in paragraphs)
    ):
        return False
    return (
        not text_props_has_content_projection(props)
        or canonical_text_paragraphs(props) is not None
    )


def valid_text_paragraph(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) - SUPPORTED_TEXT_PARAGRAPH_PROPS:
        return False
    if "text" in value and not isinstance(value.get("text"), str):
        return False
    if not valid_text_style_values(value):
        return False
    if value.get("align", "left") not in {"left", "center", "right", "justify"}:
        return False
    if not valid_positive_number(value.get("lineHeight", 1.2)):
        return False
    if any(
        key in value and not valid_nonnegative_number(value.get(key))
        for key in ("spaceBefore", "spaceAfter")
    ):
        return False
    if "indent" in value and not valid_finite_number(value.get("indent")):
        return False
    if "bullet" in value and not valid_text_bullet(value.get("bullet")):
        return False
    runs = value.get("runs")
    return (
        runs is None
        or isinstance(runs, list)
        and all(valid_text_run(run) for run in runs)
    )


def valid_text_run(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and not set(value) - SUPPORTED_TEXT_RUN_PROPS
        and isinstance(value.get("text", ""), str)
        and valid_text_style_values(value)
        and value.get("baseline", "normal") in {"normal", "superscript", "subscript"}
    )


def valid_text_style_values(value: dict[str, Any]) -> bool:
    from app.ai.pptx_ooxml.routing import (
        valid_hex_color,
    )

    font_family = value.get("fontFamily")
    if font_family is not None and (
        not isinstance(font_family, str) or not font_family
    ):
        return False
    if "fontSize" in value and not valid_positive_number(value.get("fontSize")):
        return False
    if "letterSpacing" in value and not valid_finite_number(value.get("letterSpacing")):
        return False
    weight = value.get("fontWeight")
    if weight is not None and not valid_text_font_weight(weight):
        return False
    if any(
        key in value and not isinstance(value.get(key), bool)
        for key in ("italic", "underline")
    ):
        return False
    color = value.get("color")
    return color is None or isinstance(color, str) and valid_hex_color(color)


def valid_text_bullet(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and not set(value) - {"enabled", "character", "indent"}
        and isinstance(value.get("enabled", False), bool)
        and isinstance(value.get("character", "\u2022"), str)
        and bool(value.get("character", "\u2022"))
        and valid_nonnegative_number(value.get("indent", 0))
    )


def valid_text_body_inset(value: Any) -> bool:
    return value is None or (
        isinstance(value, dict)
        and not set(value) - {"left", "right", "top", "bottom"}
        and all(valid_nonnegative_number(item) for item in value.values())
    )


def valid_finite_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def valid_positive_number(value: Any) -> bool:
    return valid_finite_number(value) and float(value) > 0


def valid_nonnegative_number(value: Any) -> bool:
    return valid_finite_number(value) and float(value) >= 0


def valid_ratio(value: Any, *, positive: bool = False) -> bool:
    return valid_finite_number(value) and (
        0 < float(value) <= 1 if positive else 0 <= float(value) <= 1
    )


def valid_text_font_weight(value: Any) -> bool:
    return (
        isinstance(value, str) and value in {"normal", "medium", "semibold", "bold"}
    ) or (
        isinstance(value, int) and not isinstance(value, bool) and 100 <= value <= 900
    )


def valid_rect_props(props: dict[str, Any]) -> bool:
    from app.ai.pptx_ooxml.routing import (
        valid_hex_color,
    )

    if set(props) - {"fill", "stroke", "strokeWidth", "borderRadius"}:
        return False
    for color_name in ("fill", "stroke"):
        if color_name not in props:
            continue
        color = props[color_name]
        if color != "transparent" and not (
            isinstance(color, str) and valid_hex_color(color)
        ):
            return False
    return all(
        name not in props or valid_nonnegative_number(props[name])
        for name in ("strokeWidth", "borderRadius")
    )


def canonical_text_value(props: dict[str, Any]) -> str | None:
    paragraphs = canonical_text_paragraphs(props)
    if paragraphs is None:
        return None
    return "\n".join(str(paragraph["text"]) for paragraph in paragraphs)


def text_props_has_content_projection(props: dict[str, Any]) -> bool:
    return any(key in props for key in ("text", "runs", "paragraphs"))


def canonical_text_paragraphs(props: dict[str, Any]) -> list[dict[str, Any]] | None:
    raw_paragraphs = props.get("paragraphs")
    if isinstance(raw_paragraphs, list):
        paragraphs: list[dict[str, Any]] = []
        for raw in raw_paragraphs:
            if not isinstance(raw, dict):
                return None
            paragraph = copy.deepcopy(raw)
            raw_runs = paragraph.get("runs")
            if isinstance(raw_runs, list) and raw_runs:
                if any(not isinstance(run, dict) for run in raw_runs):
                    return None
                runs = [copy.deepcopy(run) for run in raw_runs]
                text = "".join(str(run.get("text", "")) for run in runs)
                if "text" in paragraph and paragraph.get("text") != text:
                    return None
            else:
                text = str(paragraph.get("text", ""))
                runs = [{"text": text}] if text else []
            paragraph.update({"text": text, "runs": runs})
            paragraphs.append(paragraph)
        paragraphs = paragraphs or [{"text": "", "runs": []}]
        value = "\n".join(str(item["text"]) for item in paragraphs)
        return None if "text" in props and props.get("text") != value else paragraphs
    raw_runs = props.get("runs")
    if isinstance(raw_runs, list) and raw_runs:
        paragraphs = [{"text": "", "runs": []}]
        for raw in raw_runs:
            if not isinstance(raw, dict):
                return None
            pieces = str(raw.get("text", "")).split("\n")
            for index, piece in enumerate(pieces):
                if piece or len(pieces) == 1:
                    run = copy.deepcopy(raw)
                    run["text"] = piece
                    paragraphs[-1]["runs"].append(run)
                    paragraphs[-1]["text"] += piece
                if index < len(pieces) - 1:
                    paragraphs.append({"text": "", "runs": []})
        value = "\n".join(str(item["text"]) for item in paragraphs)
        return None if "text" in props and props.get("text") != value else paragraphs
    text = str(props.get("text", ""))
    return [
        {"text": part, "runs": [{"text": part}] if part else []}
        for part in text.split("\n")
    ]


def text_body_value(shape: ET.Element[Any]) -> str:
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
        first_local_child,
        local_name,
    )

    body = first_local_child(shape, "txBody")
    if body is None:
        return ""
    paragraphs: list[str] = []
    for paragraph in direct_local_children(body, "p"):
        parts: list[str] = []
        for child in paragraph:
            name = local_name(child)
            if name in {"r", "fld"}:
                parts.append(
                    "".join(
                        node.text or ""
                        for node in child.iter()
                        if local_name(node) == "t"
                    )
                )
            elif name == "br":
                parts.append("\n")
        paragraphs.append("".join(parts))
    return "\n".join(paragraphs)


def normalized_image_crop(value: Any) -> dict[str, float] | None:
    if not isinstance(value, dict) or set(value) - {
        "left",
        "top",
        "right",
        "bottom",
    }:
        return None
    crop: dict[str, float] = {}
    for edge in ("left", "top", "right", "bottom"):
        raw_value = value.get(edge, 0)
        if (
            not isinstance(raw_value, (int, float))
            or isinstance(raw_value, bool)
            or not math.isfinite(float(raw_value))
            or not 0 <= float(raw_value) <= 1
        ):
            return None
        crop[edge] = float(raw_value)
    if crop["left"] + crop["right"] >= 1:
        return None
    if crop["top"] + crop["bottom"] >= 1:
        return None
    return crop


def operation_element_id(operation: dict[str, Any]) -> str:
    element_id = operation.get("elementId")
    if isinstance(element_id, str):
        return element_id
    element = operation.get("element")
    if isinstance(element, dict) and isinstance(element.get("elementId"), str):
        return str(element["elementId"])
    return ""


def applied_operation(operation: dict[str, Any]) -> PptxOoxmlAppliedOperation:
    from app.ai.pptx_ooxml.models import (
        PptxOoxmlAppliedOperation,
    )

    return PptxOoxmlAppliedOperation(
        operationType=cast(PptxOoxmlSyncOperationType, operation.get("type")),
        slideId=operation_slide_id(operation) or None,
        elementId=operation_element_id(operation) or None,
    )


def unsupported_operation(
    operation: dict[str, Any],
    reason_code: PptxOoxmlUnsupportedReasonCode,
) -> PptxOoxmlUnsupportedOperation:
    from app.ai.pptx_ooxml.models import (
        PptxOoxmlUnsupportedOperation,
    )

    return PptxOoxmlUnsupportedOperation(
        operationType=cast(PptxOoxmlSyncOperationType, operation.get("type")),
        slideId=operation_slide_id(operation) or None,
        elementId=operation_element_id(operation) or None,
        reasonCode=reason_code,
    )


def operation_slide_id(operation: dict[str, Any]) -> str:
    slide_id = operation.get("slideId")
    if isinstance(slide_id, str):
        return slide_id
    slide = operation.get("slide")
    if isinstance(slide, dict) and isinstance(slide.get("slideId"), str):
        return str(slide["slideId"])
    return ""


def element_source_map(
    template_blueprint: dict[str, Any],
) -> dict[tuple[str, str], dict[str, Any]]:
    return {
        (
            str(source.get("slidePart", "")),
            str(source.get("elementId", "")),
        ): dict(source)
        for slide in template_blueprint.get("slides", [])
        if isinstance(slide, dict)
        for source in slide.get("elementSources", [])
        if isinstance(source, dict) and source.get("elementId")
    }


def shared_shape_operation_plan(
    operations: list[dict[str, Any]],
    sources: dict[tuple[str, str], dict[str, Any]],
) -> tuple[set[int], PptxOoxmlUnsupportedOperation | None]:
    cohorts: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}
    for source in sources.values():
        slide_part = str(source.get("slidePart", ""))
        shape_id = str(source.get("shapeId", ""))
        element_id = str(source.get("elementId", ""))
        if not slide_part or not shape_id or not element_id:
            continue
        cohorts.setdefault((slide_part, shape_id), {})[element_id] = source

    shared_cohorts = {
        cohort_key: members
        for cohort_key, members in cohorts.items()
        if len(members) > 1
    }
    operations_by_cohort: dict[tuple[str, str], list[tuple[int, dict[str, Any]]]] = {}
    for operation_index, operation in enumerate(operations):
        if operation.get("type") not in {"delete_element", "update_element_frame"}:
            continue
        source_key = (
            str(operation.get("sourceSlidePart", "")),
            operation_element_id(operation),
        )
        operation_source = sources.get(source_key)
        if operation_source is None:
            continue
        cohort_key = (
            str(operation_source.get("slidePart", "")),
            str(operation_source.get("shapeId", "")),
        )
        if cohort_key in shared_cohorts:
            operations_by_cohort.setdefault(cohort_key, []).append(
                (operation_index, operation)
            )

    redundant_indexes: set[int] = set()
    for cohort_key, indexed_operations in operations_by_cohort.items():
        member_ids = set(shared_cohorts[cohort_key])
        representative = indexed_operations[0][1]
        member_count = len(member_ids)
        if len(indexed_operations) % member_count != 0:
            return (
                set(),
                unsupported_operation(
                    representative,
                    "SHARED_SHAPE_COHORT_UNSAFE",
                ),
            )
        for round_start in range(0, len(indexed_operations), member_count):
            operation_round = indexed_operations[
                round_start : round_start + member_count
            ]
            round_representative = operation_round[0][1]
            representative_type = round_representative.get("type")
            representative_frame = round_representative.get("frame")
            round_member_ids = {
                operation_element_id(operation)
                for _operation_index, operation in operation_round
            }
            unsafe = round_member_ids != member_ids or any(
                operation.get("type") != representative_type
                or (
                    representative_type == "update_element_frame"
                    and operation.get("frame") != representative_frame
                )
                for _operation_index, operation in operation_round[1:]
            )
            if unsafe:
                return (
                    set(),
                    unsupported_operation(
                        round_representative,
                        "SHARED_SHAPE_COHORT_UNSAFE",
                    ),
                )
            redundant_indexes.update(
                operation_index for operation_index, _operation in operation_round[1:]
            )

    return redundant_indexes, None
