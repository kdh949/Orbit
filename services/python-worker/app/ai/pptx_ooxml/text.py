from __future__ import annotations


import copy

import difflib


import math


from typing import Any

from xml.etree import ElementTree as ET


from typing import TYPE_CHECKING

from app.ai.pptx_ooxml.common import (
    A_T,
    DML_NS,
    MAX_TEXT_DIFF_MATRIX_CELLS,
    SUPPORTED_TEXT_STYLE_PROPS,
    XML_SPACE,
)

if TYPE_CHECKING:
    from app.ai.pptx_ooxml.models import (
        PackageFrameScale,
        TextEqualSpan,
        TextParagraphTemplate,
        TextRunTemplate,
    )


def sync_text_shape(
    shape: ET.Element[Any],
    props: dict[str, Any],
    source: dict[str, Any],
    scale: PackageFrameScale,
) -> bool:
    from app.ai.pptx_ooxml.routing import (
        dict_value,
        ensure_text_body,
    )
    from app.ai.pptx_ooxml.validation import (
        text_body_value,
    )

    if set(props) == {"text"} and str(props.get("text", "")) == text_body_value(shape):
        return True
    paragraphs = text_sync_paragraphs(shape, props)
    if paragraphs is None:
        return False
    body = ensure_text_body(shape)
    if dict_value(source, "ooxmlEditCapabilities").get("richText") == "style-only":
        paragraphs = preserve_existing_run_boundaries(body, paragraphs)
    equal_spans = text_equal_spans(
        text_body_value(shape),
        "\n".join(str(paragraph.get("text", "")) for paragraph in paragraphs),
    )
    apply_text_body_properties(body, props, scale)
    authored = source.get("ooxmlOrigin") == "authored"
    if text_structure_matches(body, paragraphs):
        patch_matching_text_structure(body, paragraphs, props, scale, authored)
    else:
        rebuild_text_structure(
            body,
            paragraphs,
            props,
            scale,
            authored,
            equal_spans,
        )
    return True


def text_sync_paragraphs(
    shape: ET.Element[Any],
    props: dict[str, Any],
) -> list[dict[str, Any]] | None:
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
        first_local_child,
        local_name,
    )
    from app.ai.pptx_ooxml.validation import (
        canonical_text_paragraphs,
        text_body_value,
        text_props_has_content_projection,
    )

    redundant_text_projection = (
        "text" in props
        and "runs" not in props
        and "paragraphs" not in props
        and str(props.get("text", "")) == text_body_value(shape)
    )
    if text_props_has_content_projection(props) and not redundant_text_projection:
        return canonical_text_paragraphs(props)
    body = first_local_child(shape, "txBody")
    if body is None:
        return [{"text": "", "runs": []}]
    paragraph_style = {
        key: props[key] for key in ("align", "lineHeight", "bullet") if key in props
    }
    paragraphs: list[dict[str, Any]] = []
    for paragraph in direct_local_children(body, "p"):
        runs: list[dict[str, Any]] = []
        for child in list(paragraph):
            name = local_name(child)
            if name == "r":
                runs.append({"text": text_run_value(child)})
            elif name == "br":
                runs.append({"text": "\n"})
        paragraphs.append(
            {
                "text": "".join(str(run["text"]) for run in runs),
                "runs": runs,
                **paragraph_style,
            }
        )
    return paragraphs or [{"text": "", "runs": [], **paragraph_style}]


def style_only_paragraphs_match(
    body: ET.Element[Any],
    paragraphs: list[dict[str, Any]],
) -> bool:
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
    )

    existing = [
        text_paragraph_value(paragraph)
        for paragraph in direct_local_children(body, "p")
    ]
    target = [str(paragraph.get("text", "")) for paragraph in paragraphs]
    return existing == target


def preserve_existing_run_boundaries(
    body: ET.Element[Any],
    paragraphs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
        local_name,
    )

    existing_paragraphs = direct_local_children(body, "p")
    if len(existing_paragraphs) != len(paragraphs):
        return paragraphs
    result: list[dict[str, Any]] = []
    for existing, target in zip(existing_paragraphs, paragraphs, strict=True):
        text = str(target.get("text", ""))
        target_runs = target.get("runs", [])
        if not isinstance(target_runs, list):
            result.append(target)
            continue
        boundaries = {0, utf16_length(text)}
        offset = 0
        for child in list(existing):
            name = local_name(child)
            if name == "r":
                offset += utf16_length(text_run_value(child))
                boundaries.add(offset)
            elif name == "br":
                offset += 1
                boundaries.add(offset)
        target_intervals: list[tuple[int, int, dict[str, Any]]] = []
        offset = 0
        for target_run in target_runs:
            if not isinstance(target_run, dict):
                continue
            end = offset + utf16_length(str(target_run.get("text", "")))
            target_intervals.append((offset, end, target_run))
            boundaries.update({offset, end})
            offset = end
        ordered = sorted(boundaries)
        rebuilt_runs: list[dict[str, Any]] = []
        for start, end in zip(ordered, ordered[1:]):
            if start == end:
                continue
            target_run = next(
                (
                    run
                    for run_start, run_end, run in target_intervals
                    if run_start <= start < run_end
                ),
                {},
            )
            rebuilt_runs.append(
                {
                    **copy.deepcopy(target_run),
                    "text": utf16_slice(text, start, end),
                }
            )
        result.append({**copy.deepcopy(target), "runs": rebuilt_runs})
    return result


def apply_text_body_properties(
    body: ET.Element[Any],
    props: dict[str, Any],
    scale: PackageFrameScale,
) -> None:
    from app.ai.pptx_ooxml.routing import (
        dict_value,
        first_local_child,
        local_name,
    )

    body_pr = first_local_child(body, "bodyPr")
    if body_pr is None:
        body_pr = ET.Element(f"{{{DML_NS}}}bodyPr")
        body.insert(0, body_pr)
    body_pr.set("horzOverflow", "clip")
    body_pr.set("vertOverflow", "clip")
    body_pr.set("wrap", "square")
    if "verticalAlign" in props:
        body_pr.set(
            "anchor",
            {"top": "t", "middle": "ctr", "bottom": "b"}.get(
                str(props.get("verticalAlign", "top")),
                "t",
            ),
        )
    if "writingMode" in props:
        body_pr.set(
            "vert",
            "vert270" if props.get("writingMode") == "vertical-270" else "horz",
        )
    if "bodyInset" in props:
        inset = dict_value(props, "bodyInset")
        for key, attribute, converter in (
            ("left", "lIns", canvas_x_to_emu),
            ("right", "rIns", canvas_x_to_emu),
            ("top", "tIns", canvas_y_to_emu),
            ("bottom", "bIns", canvas_y_to_emu),
        ):
            if key in inset:
                body_pr.set(attribute, str(converter(inset[key], scale)))
    if "autoFit" in props:
        for child in list(body_pr):
            if local_name(child) in {"noAutofit", "normAutofit", "spAutoFit"}:
                body_pr.remove(child)
        auto_fit = str(props.get("autoFit"))
        if auto_fit == "none":
            ET.SubElement(body_pr, f"{{{DML_NS}}}noAutofit")
        elif auto_fit == "resize-shape":
            ET.SubElement(body_pr, f"{{{DML_NS}}}spAutoFit")
        elif auto_fit == "shrink-text":
            attributes = {
                "fontScale": str(round(float(props.get("fontScale", 1)) * 100000)),
                "lnSpcReduction": str(
                    round(float(props.get("lineSpaceReduction", 0)) * 100000)
                ),
            }
            ET.SubElement(
                body_pr,
                f"{{{DML_NS}}}normAutofit",
                attributes,
            )


def text_structure_matches(
    body: ET.Element[Any],
    paragraphs: list[dict[str, Any]],
) -> bool:
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
        local_name,
    )

    existing_paragraphs = direct_local_children(body, "p")
    if len(existing_paragraphs) != len(paragraphs):
        return False
    for existing, target in zip(existing_paragraphs, paragraphs, strict=True):
        content = [
            child
            for child in list(existing)
            if local_name(child) not in {"pPr", "endParaRPr"}
        ]
        if any(local_name(child) != "r" for child in content):
            return False
        target_runs = target.get("runs", [])
        if not isinstance(target_runs, list) or len(content) != len(target_runs):
            return False
        if any(
            text_run_value(run) != str(target_run.get("text", ""))
            for run, target_run in zip(content, target_runs, strict=True)
        ):
            return False
    return True


def patch_matching_text_structure(
    body: ET.Element[Any],
    paragraphs: list[dict[str, Any]],
    props: dict[str, Any],
    scale: PackageFrameScale,
    authored: bool,
) -> None:
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
    )

    raw_paragraphs = props.get("paragraphs")
    for paragraph_index, (paragraph, target) in enumerate(
        zip(direct_local_children(body, "p"), paragraphs, strict=True)
    ):
        desired_paragraph = desired_paragraph_style(props, target, authored)
        patch_paragraph_properties(paragraph, desired_paragraph, scale)
        raw_paragraph = (
            raw_paragraphs[paragraph_index]
            if isinstance(raw_paragraphs, list)
            and paragraph_index < len(raw_paragraphs)
            and isinstance(raw_paragraphs[paragraph_index], dict)
            else None
        )
        raw_runs = raw_paragraph.get("runs") if raw_paragraph is not None else None
        has_explicit_runs = isinstance(raw_runs, list) and bool(raw_runs)
        existing_runs = direct_local_children(paragraph, "r")
        target_runs = target.get("runs", [])
        for run, target_run in zip(existing_runs, target_runs, strict=True):
            desired_run = desired_run_style(
                props,
                target,
                target_run,
                authored=authored,
                has_explicit_runs=has_explicit_runs,
            )
            patch_run_properties(run, desired_run, scale)


def rebuild_text_structure(
    body: ET.Element[Any],
    paragraphs: list[dict[str, Any]],
    props: dict[str, Any],
    scale: PackageFrameScale,
    authored: bool,
    equal_spans: list[TextEqualSpan],
) -> None:
    from app.ai.pptx_ooxml.routing import (
        direct_local_children,
        first_local_child,
        local_name,
    )

    existing_paragraphs = direct_local_children(body, "p")
    run_templates = existing_text_run_templates(existing_paragraphs)
    paragraph_templates = existing_text_paragraph_templates(existing_paragraphs)
    raw_paragraphs = props.get("paragraphs")
    rebuilt: list[ET.Element[Any]] = []
    logical_offset = 0
    for paragraph_index, target in enumerate(paragraphs):
        paragraph_text_length = utf16_length(str(target.get("text", "")))
        source_start, source_end = map_target_interval_to_source(
            logical_offset,
            logical_offset + paragraph_text_length,
            equal_spans,
        )
        paragraph_template_record = nearest_text_paragraph_template(
            paragraph_templates,
            source_start,
            source_end,
        )
        paragraph_template = (
            paragraph_template_record.paragraph
            if paragraph_template_record is not None
            else None
        )
        paragraph = ET.Element(f"{{{DML_NS}}}p")
        if paragraph_template is not None:
            p_pr = first_local_child(paragraph_template, "pPr")
            if p_pr is not None:
                paragraph.append(copy.deepcopy(p_pr))
        patch_paragraph_properties(
            paragraph,
            desired_paragraph_style(props, target, authored),
            scale,
        )
        raw_paragraph = (
            raw_paragraphs[paragraph_index]
            if isinstance(raw_paragraphs, list)
            and paragraph_index < len(raw_paragraphs)
            and isinstance(raw_paragraphs[paragraph_index], dict)
            else None
        )
        raw_runs = raw_paragraph.get("runs") if raw_paragraph is not None else None
        has_explicit_runs = isinstance(raw_runs, list) and bool(raw_runs)
        target_runs = target.get("runs", [])
        for target_run in target_runs if isinstance(target_runs, list) else []:
            run_text = str(target_run.get("text", ""))
            desired_run = desired_run_style(
                props,
                target,
                target_run,
                authored=authored,
                has_explicit_runs=has_explicit_runs,
            )
            append_rebuilt_run_content(
                paragraph,
                run_text,
                logical_offset,
                desired_run,
                run_templates,
                equal_spans,
                scale,
            )
            logical_offset += utf16_length(run_text)
        if paragraph_template is not None:
            end_properties = first_local_child(paragraph_template, "endParaRPr")
            if end_properties is not None:
                paragraph.append(copy.deepcopy(end_properties))
        rebuilt.append(paragraph)
        if paragraph_index < len(paragraphs) - 1:
            logical_offset += 1

    children = list(body)
    paragraph_indexes = [
        index for index, child in enumerate(children) if local_name(child) == "p"
    ]
    insertion_index = paragraph_indexes[0] if paragraph_indexes else len(children)
    for paragraph in existing_paragraphs:
        body.remove(paragraph)
    for offset, paragraph in enumerate(rebuilt):
        body.insert(insertion_index + offset, paragraph)


def existing_text_run_templates(
    paragraphs: list[ET.Element[Any]],
) -> list[TextRunTemplate]:
    from app.ai.pptx_ooxml.models import (
        TextRunTemplate,
    )
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
        local_name,
    )

    templates: list[TextRunTemplate] = []
    offset = 0
    for paragraph_index, paragraph in enumerate(paragraphs):
        for child in list(paragraph):
            name = local_name(child)
            if name == "r":
                text = text_run_value(child)
                length = utf16_length(text)
                r_pr = first_local_child(child, "rPr")
                templates.append(
                    TextRunTemplate(
                        start=offset,
                        end=offset + length,
                        run_properties=copy.deepcopy(r_pr)
                        if r_pr is not None
                        else None,
                    )
                )
                offset += length
            elif name == "br":
                r_pr = first_local_child(child, "rPr")
                templates.append(
                    TextRunTemplate(
                        start=offset,
                        end=offset + 1,
                        run_properties=copy.deepcopy(r_pr)
                        if r_pr is not None
                        else None,
                    )
                )
                offset += 1
        if paragraph_index < len(paragraphs) - 1:
            offset += 1
    return templates


def existing_text_paragraph_templates(
    paragraphs: list[ET.Element[Any]],
) -> list[TextParagraphTemplate]:
    from app.ai.pptx_ooxml.models import (
        TextParagraphTemplate,
    )

    templates: list[TextParagraphTemplate] = []
    offset = 0
    for paragraph_index, paragraph in enumerate(paragraphs):
        length = utf16_length(text_paragraph_value(paragraph))
        templates.append(
            TextParagraphTemplate(
                start=offset,
                end=offset + length,
                paragraph=paragraph,
            )
        )
        offset += length
        if paragraph_index < len(paragraphs) - 1:
            offset += 1
    return templates


def append_rebuilt_run_content(
    paragraph: ET.Element[Any],
    text: str,
    start: int,
    desired_style: dict[str, Any],
    templates: list[TextRunTemplate],
    equal_spans: list[TextEqualSpan],
    scale: PackageFrameScale,
) -> None:
    offset = start
    pieces = text.split("\n")
    for piece_index, piece in enumerate(pieces):
        if piece or len(pieces) == 1:
            run = ET.SubElement(paragraph, f"{{{DML_NS}}}r")
            source_start, source_end = map_target_interval_to_source(
                offset,
                offset + utf16_length(piece),
                equal_spans,
            )
            template = nearest_text_run_template(
                templates,
                source_start,
                source_end,
            )
            if template is not None and template.run_properties is not None:
                run.append(copy.deepcopy(template.run_properties))
            patch_run_properties(run, desired_style, scale)
            text_node = ET.SubElement(run, A_T)
            set_text_node_value(text_node, piece)
            offset += utf16_length(piece)
        if piece_index < len(pieces) - 1:
            line_break = ET.SubElement(paragraph, f"{{{DML_NS}}}br")
            source_start, source_end = map_target_interval_to_source(
                offset,
                offset + 1,
                equal_spans,
            )
            template = nearest_text_run_template(
                templates,
                source_start,
                source_end,
            )
            if template is not None and template.run_properties is not None:
                line_break.append(copy.deepcopy(template.run_properties))
            patch_run_properties(line_break, desired_style, scale)
            offset += 1


def nearest_text_run_template(
    templates: list[TextRunTemplate],
    start: int,
    end: int,
) -> TextRunTemplate | None:
    overlapping = [
        template
        for template in templates
        if max(start, template.start) < min(end, template.end)
    ]
    if overlapping:
        return max(
            overlapping,
            key=lambda template: min(end, template.end) - max(start, template.start),
        )
    return min(
        templates,
        key=lambda template: min(
            abs(start - template.start),
            abs(start - template.end),
        ),
        default=None,
    )


def nearest_text_paragraph_template(
    templates: list[TextParagraphTemplate],
    start: int,
    end: int,
) -> TextParagraphTemplate | None:
    overlapping = [
        template
        for template in templates
        if max(start, template.start) < min(end, template.end)
    ]
    if overlapping:
        return max(
            overlapping,
            key=lambda template: min(end, template.end) - max(start, template.start),
        )
    return min(
        templates,
        key=lambda template: min(
            abs(start - template.start),
            abs(start - template.end),
        ),
        default=None,
    )


def text_equal_spans(source: str, target: str) -> list[TextEqualSpan]:
    from app.ai.pptx_ooxml.models import (
        TextEqualSpan,
    )

    source_offsets = utf16_prefix_offsets(source)
    target_offsets = utf16_prefix_offsets(target)
    prefix_length = 0
    shared_length = min(len(source), len(target))
    while (
        prefix_length < shared_length and source[prefix_length] == target[prefix_length]
    ):
        prefix_length += 1

    suffix_length = 0
    source_remaining = len(source) - prefix_length
    target_remaining = len(target) - prefix_length
    while (
        suffix_length < min(source_remaining, target_remaining)
        and source[len(source) - suffix_length - 1]
        == target[len(target) - suffix_length - 1]
    ):
        suffix_length += 1

    spans: list[TextEqualSpan] = []
    if prefix_length:
        spans.append(
            TextEqualSpan(
                target_start=0,
                target_end=target_offsets[prefix_length],
                source_start=0,
                source_end=source_offsets[prefix_length],
            )
        )

    source_middle_end = len(source) - suffix_length
    target_middle_end = len(target) - suffix_length
    source_middle = source[prefix_length:source_middle_end]
    target_middle = target[prefix_length:target_middle_end]
    if (
        source_middle
        and target_middle
        and len(source_middle) * len(target_middle) <= MAX_TEXT_DIFF_MATRIX_CELLS
    ):
        matcher = difflib.SequenceMatcher(
            a=source_middle,
            b=target_middle,
            autojunk=False,
        )
        spans.extend(
            TextEqualSpan(
                target_start=target_offsets[prefix_length + match.b],
                target_end=target_offsets[prefix_length + match.b + match.size],
                source_start=source_offsets[prefix_length + match.a],
                source_end=source_offsets[prefix_length + match.a + match.size],
            )
            for match in matcher.get_matching_blocks()
            if match.size > 0
        )

    if suffix_length:
        spans.append(
            TextEqualSpan(
                target_start=target_offsets[target_middle_end],
                target_end=target_offsets[len(target)],
                source_start=source_offsets[source_middle_end],
                source_end=source_offsets[len(source)],
            )
        )
    return spans


def map_target_interval_to_source(
    start: int,
    end: int,
    equal_spans: list[TextEqualSpan],
) -> tuple[int, int]:

    overlaps: list[tuple[int, TextEqualSpan]] = []
    for span in equal_spans:
        overlap_start = max(start, span.target_start)
        overlap_end = min(end, span.target_end)
        if overlap_start < overlap_end:
            overlaps.append((overlap_end - overlap_start, span))
    if overlaps:
        _length, span = max(overlaps, key=lambda item: item[0])
        overlap_start = max(start, span.target_start)
        overlap_end = min(end, span.target_end)
        return (
            span.source_start + overlap_start - span.target_start,
            span.source_start + overlap_end - span.target_start,
        )

    preceding = [span for span in equal_spans if span.target_end <= start]
    if preceding:
        position = max(preceding, key=lambda span: span.target_end).source_end
        return position, position
    following = [span for span in equal_spans if span.target_start >= end]
    if following:
        position = min(following, key=lambda span: span.target_start).source_start
        return position, position
    return 0, 0


def desired_paragraph_style(
    props: dict[str, Any],
    paragraph: dict[str, Any],
    authored: bool,
) -> dict[str, Any]:
    keys = {"align", "lineHeight", "spaceBefore", "spaceAfter", "indent", "bullet"}
    desired: dict[str, Any] = {}
    if authored:
        for key in ("align", "lineHeight", "bullet"):
            if key in props:
                desired[key] = props[key]
    for key in keys:
        if key in paragraph:
            desired[key] = paragraph[key]
    return desired


def desired_run_style(
    props: dict[str, Any],
    paragraph: dict[str, Any],
    run: dict[str, Any],
    *,
    authored: bool,
    has_explicit_runs: bool,
) -> dict[str, Any]:
    desired: dict[str, Any] = {}
    if authored or not has_explicit_runs:
        for source in (props, paragraph):
            for key in SUPPORTED_TEXT_STYLE_PROPS:
                if key in source:
                    desired[key] = source[key]
    for key in SUPPORTED_TEXT_STYLE_PROPS:
        if key in run:
            desired[key] = run[key]
    return desired


def patch_run_properties(
    run: ET.Element[Any],
    desired: dict[str, Any],
    scale: PackageFrameScale,
) -> None:
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
        local_name,
    )

    current = current_run_style(first_local_child(run, "rPr"), scale)
    differences = {
        key: value
        for key, value in desired.items()
        if key in SUPPORTED_TEXT_STYLE_PROPS
        and not text_style_values_equal(current.get(key), value)
    }
    if not differences:
        return
    r_pr = ensure_run_properties(run)
    if "fontFamily" in differences:
        for name in ("latin", "ea"):
            font = first_local_child(r_pr, name)
            if font is None:
                font = ET.SubElement(r_pr, f"{{{DML_NS}}}{name}")
            font.set("typeface", str(differences["fontFamily"]))
    if "fontSize" in differences:
        r_pr.set("sz", str(font_size_to_ooxml(differences["fontSize"], scale)))
    if "fontWeight" in differences:
        r_pr.set("b", "1" if is_bold_text_weight(differences["fontWeight"]) else "0")
    if "letterSpacing" in differences:
        r_pr.set(
            "spc",
            str(letter_spacing_to_ooxml(differences["letterSpacing"], scale)),
        )
    if "italic" in differences:
        r_pr.set("i", "1" if differences["italic"] else "0")
    if "underline" in differences:
        r_pr.set("u", "sng" if differences["underline"] else "none")
    if "baseline" in differences:
        baseline = differences["baseline"]
        if baseline == "superscript":
            r_pr.set("baseline", "30000")
        elif baseline == "subscript":
            r_pr.set("baseline", "-25000")
        else:
            r_pr.attrib.pop("baseline", None)
    if "color" in differences:
        for child in list(r_pr):
            if local_name(child) in {
                "solidFill",
                "gradFill",
                "noFill",
                "pattFill",
                "blipFill",
            }:
                r_pr.remove(child)
        color_fill = ET.Element(f"{{{DML_NS}}}solidFill")
        ET.SubElement(
            color_fill,
            f"{{{DML_NS}}}srgbClr",
            {"val": str(differences["color"])[1:].upper()},
        )
        r_pr.insert(0, color_fill)


def current_run_style(
    r_pr: ET.Element[Any] | None,
    scale: PackageFrameScale,
) -> dict[str, Any]:
    from app.ai.pptx_ooxml.rendering import (
        int_value,
    )
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
    )

    if r_pr is None:
        return {"baseline": "normal"}
    current: dict[str, Any] = {"baseline": "normal"}
    for name in ("latin", "ea", "cs"):
        font = first_local_child(r_pr, name)
        if font is not None and font.get("typeface"):
            current["fontFamily"] = str(font.get("typeface"))
            break
    size = int_value(r_pr.get("sz"), 0)
    if size > 0:
        current["fontSize"] = font_size_from_ooxml(size, scale)
    if r_pr.get("b") is not None:
        current["fontWeight"] = "bold" if r_pr.get("b") in {"1", "true"} else "normal"
    if r_pr.get("i") is not None:
        current["italic"] = r_pr.get("i") in {"1", "true"}
    if r_pr.get("u") is not None:
        current["underline"] = r_pr.get("u") not in {"0", "false", "none"}
    if r_pr.get("spc") is not None:
        current["letterSpacing"] = round(
            int_value(r_pr.get("spc"), 0) / 100 * 12700 * canvas_average_scale(scale),
            3,
        )
    solid_fill = first_local_child(r_pr, "solidFill")
    srgb = first_local_child(solid_fill, "srgbClr") if solid_fill is not None else None
    if srgb is not None and srgb.get("val"):
        current["color"] = f"#{str(srgb.get('val')).upper()}"
    baseline = int_value(r_pr.get("baseline"), 0)
    if baseline > 0:
        current["baseline"] = "superscript"
    elif baseline < 0:
        current["baseline"] = "subscript"
    return current


def ensure_run_properties(run: ET.Element[Any]) -> ET.Element[Any]:
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
    )

    r_pr = first_local_child(run, "rPr")
    if r_pr is not None:
        return r_pr
    r_pr = ET.Element(f"{{{DML_NS}}}rPr", {"lang": "ko-KR"})
    run.insert(0, r_pr)
    return r_pr


def patch_paragraph_properties(
    paragraph: ET.Element[Any],
    desired: dict[str, Any],
    scale: PackageFrameScale,
) -> None:
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
        local_name,
    )

    current = current_paragraph_style(first_local_child(paragraph, "pPr"), scale)
    differences = {
        key: value
        for key, value in desired.items()
        if not text_style_values_equal(current.get(key), value)
    }
    if not differences:
        return
    p_pr = first_local_child(paragraph, "pPr")
    if p_pr is None:
        p_pr = ET.Element(f"{{{DML_NS}}}pPr")
        paragraph.insert(0, p_pr)
    if "align" in differences:
        p_pr.set(
            "algn",
            {"left": "l", "center": "ctr", "right": "r", "justify": "just"}.get(
                str(differences["align"]),
                "l",
            ),
        )
    if "indent" in differences:
        p_pr.set("marL", str(canvas_x_to_signed_emu(differences["indent"], scale)))
    if "lineHeight" in differences:
        set_paragraph_spacing_percent(p_pr, "lnSpc", differences["lineHeight"])
    if "spaceBefore" in differences:
        set_paragraph_spacing_points(p_pr, "spcBef", differences["spaceBefore"], scale)
    if "spaceAfter" in differences:
        set_paragraph_spacing_points(p_pr, "spcAft", differences["spaceAfter"], scale)
    if "bullet" in differences:
        for child in list(p_pr):
            if local_name(child) in {"buNone", "buChar", "buAutoNum"}:
                p_pr.remove(child)
        bullet = differences["bullet"]
        if isinstance(bullet, dict) and bullet.get("enabled"):
            ET.SubElement(
                p_pr,
                f"{{{DML_NS}}}buChar",
                {"char": str(bullet.get("character", "\u2022"))},
            )
            p_pr.set(
                "marL",
                str(canvas_x_to_signed_emu(bullet.get("indent", 0), scale)),
            )
        else:
            ET.SubElement(p_pr, f"{{{DML_NS}}}buNone")


def current_paragraph_style(
    p_pr: ET.Element[Any] | None,
    scale: PackageFrameScale,
) -> dict[str, Any]:
    from app.ai.pptx_ooxml.rendering import (
        int_value,
    )
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
    )

    if p_pr is None:
        return {
            "align": "left",
            "lineHeight": 1.15,
            "spaceBefore": 0,
            "spaceAfter": 0,
            "indent": 0,
        }
    current: dict[str, Any] = {
        "align": {
            "ctr": "center",
            "r": "right",
            "just": "justify",
        }.get(str(p_pr.get("algn", "l")), "left"),
        "lineHeight": paragraph_spacing_percent(p_pr, "lnSpc", 1.15),
        "spaceBefore": paragraph_spacing_canvas(p_pr, "spcBef", scale),
        "spaceAfter": paragraph_spacing_canvas(p_pr, "spcAft", scale),
        "indent": round(int_value(p_pr.get("marL"), 0) * canvas_x_scale(scale), 3),
    }
    bullet = first_local_child(p_pr, "buChar")
    if bullet is not None:
        current["bullet"] = {
            "enabled": True,
            "character": str(bullet.get("char", "\u2022")),
            "indent": max(0, current["indent"]),
        }
    elif first_local_child(p_pr, "buNone") is not None:
        current["bullet"] = {"enabled": False, "character": "\u2022", "indent": 0}
    return current


def set_paragraph_spacing_percent(
    p_pr: ET.Element[Any],
    name: str,
    value: Any,
) -> None:
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
    )

    spacing = first_local_child(p_pr, name)
    if spacing is None:
        spacing = ET.SubElement(p_pr, f"{{{DML_NS}}}{name}")
    for child in list(spacing):
        spacing.remove(child)
    ET.SubElement(
        spacing,
        f"{{{DML_NS}}}spcPct",
        {"val": str(round(float(value) * 100000))},
    )


def set_paragraph_spacing_points(
    p_pr: ET.Element[Any],
    name: str,
    value: Any,
    scale: PackageFrameScale,
) -> None:
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
    )

    spacing = first_local_child(p_pr, name)
    if spacing is None:
        spacing = ET.SubElement(p_pr, f"{{{DML_NS}}}{name}")
    for child in list(spacing):
        spacing.remove(child)
    ET.SubElement(
        spacing,
        f"{{{DML_NS}}}spcPts",
        {"val": str(canvas_spacing_to_ooxml(value, scale))},
    )


def paragraph_spacing_percent(
    p_pr: ET.Element[Any],
    name: str,
    fallback: float,
) -> float:
    from app.ai.pptx_ooxml.rendering import (
        int_value,
    )
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
    )

    spacing = first_local_child(p_pr, name)
    percentage = first_local_child(spacing, "spcPct") if spacing is not None else None
    return (
        int_value(percentage.get("val"), round(fallback * 100000)) / 100000
        if percentage is not None
        else fallback
    )


def paragraph_spacing_canvas(
    p_pr: ET.Element[Any],
    name: str,
    scale: PackageFrameScale,
) -> float:
    from app.ai.pptx_ooxml.rendering import (
        int_value,
    )
    from app.ai.pptx_ooxml.routing import (
        first_local_child,
    )

    spacing = first_local_child(p_pr, name)
    points = first_local_child(spacing, "spcPts") if spacing is not None else None
    if points is None:
        return 0
    return round(
        int_value(points.get("val"), 0) / 100 * 12700 * canvas_average_scale(scale),
        3,
    )


def font_size_from_ooxml(size: int, scale: PackageFrameScale) -> float:
    return round(size / 100 * 12700 * canvas_average_scale(scale), 3)


def font_size_to_ooxml(value: Any, scale: PackageFrameScale) -> int:
    return max(1, round(float(value) / (12700 * canvas_average_scale(scale)) * 100))


def canvas_spacing_to_ooxml(value: Any, scale: PackageFrameScale) -> int:
    return max(0, round(float(value) / (12700 * canvas_average_scale(scale)) * 100))


def letter_spacing_to_ooxml(value: Any, scale: PackageFrameScale) -> int:
    return round(float(value) / (12700 * canvas_average_scale(scale)) * 100)


def canvas_x_scale(scale: PackageFrameScale) -> float:
    return scale.canvas_width / scale.slide_width_emu


def canvas_average_scale(scale: PackageFrameScale) -> float:
    return (
        scale.canvas_width / scale.slide_width_emu
        + scale.canvas_height / scale.slide_height_emu
    ) / 2


def canvas_x_to_signed_emu(value: Any, scale: PackageFrameScale) -> int:
    return round(float(value) * scale.slide_width_emu / scale.canvas_width)


def text_style_values_equal(current: Any, desired: Any) -> bool:
    from app.ai.pptx_ooxml.routing import (
        valid_hex_color,
    )

    if isinstance(current, (int, float)) and isinstance(desired, (int, float)):
        return math.isclose(float(current), float(desired), rel_tol=1e-4, abs_tol=0.01)
    if isinstance(current, str) and isinstance(desired, str):
        if valid_hex_color(current) and valid_hex_color(desired):
            return current.upper() == desired.upper()
    return bool(current == desired)


def is_bold_text_weight(value: Any) -> bool:
    return value in {"semibold", "bold"} or (
        isinstance(value, int) and not isinstance(value, bool) and value >= 600
    )


def text_run_value(run: ET.Element[Any]) -> str:
    from app.ai.pptx_ooxml.routing import (
        local_name,
    )

    return "".join(node.text or "" for node in run.iter() if local_name(node) == "t")


def text_paragraph_value(paragraph: ET.Element[Any]) -> str:
    from app.ai.pptx_ooxml.routing import (
        local_name,
    )

    parts: list[str] = []
    for child in list(paragraph):
        name = local_name(child)
        if name in {"r", "fld"}:
            parts.append(text_run_value(child))
        elif name == "br":
            parts.append("\n")
    return "".join(parts)


def set_text_node_value(node: ET.Element[Any], value: str) -> None:
    node.text = value
    if value != value.strip():
        node.set(XML_SPACE, "preserve")
    else:
        node.attrib.pop(XML_SPACE, None)


def utf16_length(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def utf16_prefix_offsets(value: str) -> list[int]:
    offsets = [0]
    for character in value:
        offsets.append(offsets[-1] + utf16_length(character))
    return offsets


def utf16_slice(value: str, start: int, end: int) -> str:
    encoded = value.encode("utf-16-le")
    return encoded[start * 2 : end * 2].decode("utf-16-le")


def canvas_x_to_emu(value: Any, scale: PackageFrameScale) -> int:
    return round(float(value) * scale.slide_width_emu / scale.canvas_width)


def canvas_y_to_emu(value: Any, scale: PackageFrameScale) -> int:
    return round(float(value) * scale.slide_height_emu / scale.canvas_height)
