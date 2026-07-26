from __future__ import annotations

from dataclasses import dataclass

import re


import zipfile


from io import BytesIO


from typing import Any, cast

from xml.etree import ElementTree as ET


from app.ai.authored_element_rasterizer import (
    AuthoredElementRasterizationError,
    RasterizedAuthoredElement,
)


from app.ai.pptx_motion import (
    replace_main_sequence,
    replace_slide_transition,
)


from typing import TYPE_CHECKING

from app.ai.pptx_ooxml.common import (
    PptxOoxmlMotionReasonCode,
    PptxOoxmlMotionScope,
)

if TYPE_CHECKING:
    from app.ai.pptx_ooxml.models import (
        PackageFrameScale,
        PptxOoxmlAppliedOperation,
        PptxOoxmlAppliedSlideMotion,
        PptxOoxmlUnsupportedOperation,
        PptxOoxmlUnsupportedSlideMotion,
    )


def apply_patch_operations_to_package(
    package_bytes: bytes,
    template_blueprint: dict[str, Any],
    operations: list[dict[str, Any]],
    scale: PackageFrameScale,
    *,
    slide_motion: list[dict[str, Any]] | None = None,
    authored_element_fallbacks: dict[str, Any] | None = None,
) -> tuple[
    bytes,
    list[str],
    list[dict[str, Any]],
    list[PptxOoxmlAppliedOperation],
    list[PptxOoxmlUnsupportedOperation],
    list[PptxOoxmlAppliedSlideMotion],
    list[PptxOoxmlUnsupportedSlideMotion],
]:
    from app.ai.pptx_ooxml.import_capabilities import (
        authored_raster_fallback_map,
    )
    from app.ai.pptx_ooxml.media import (
        motion_reference_failure,
    )
    from app.ai.pptx_ooxml.models import (
        PptxOoxmlUnsupportedSlideMotion,
    )
    from app.ai.pptx_ooxml.operations import (
        apply_sync_operation,
    )
    from app.ai.pptx_ooxml.rendering import (
        rewrite_zip,
    )
    from app.ai.pptx_ooxml.routing import (
        is_safe_notes_master_part,
        is_safe_notes_part,
        is_safe_slide_part,
        rels_part_for_slide_part,
        route_operations_to_source_parts,
    )
    from app.ai.pptx_ooxml.validation import (
        applied_operation,
        element_source_map,
        shared_shape_operation_plan,
        unsupported_operation,
    )

    slide_motion = slide_motion or []
    try:
        fallback_theme, fallback_elements = authored_raster_fallback_map(
            authored_element_fallbacks or {},
        )
    except AuthoredElementRasterizationError:
        first_operation = operations[0] if operations else {}
        failure = unsupported_operation(
            first_operation,
            "AUTHORED_RASTER_FALLBACK_FAILED",
        )
        return package_bytes, [], [], [], [failure], [], []
    raster_cache: dict[tuple[str, str], RasterizedAuthoredElement] = {}
    sources = element_source_map(template_blueprint)
    operations = route_operations_to_source_parts(template_blueprint, operations)
    warnings: list[str] = []
    updated_sources: dict[tuple[str, str], dict[str, Any]] = {}
    applied_operations: list[PptxOoxmlAppliedOperation] = []
    unsupported_operations: list[PptxOoxmlUnsupportedOperation] = []
    applied_slide_motion: list[PptxOoxmlAppliedSlideMotion] = []
    unsupported_slide_motion: list[PptxOoxmlUnsupportedSlideMotion] = []

    motion_failure = motion_reference_failure(
        operations,
        template_blueprint,
        slide_motion,
    )
    if motion_failure is not None:
        return package_bytes, warnings, [], [], [motion_failure], [], []

    redundant_shape_operations, cohort_failure = shared_shape_operation_plan(
        operations,
        sources,
    )
    if cohort_failure is not None:
        return package_bytes, warnings, [], [], [cohort_failure], [], []

    with zipfile.ZipFile(BytesIO(package_bytes), "r") as source:
        source_names = set(source.namelist())
        slide_parts = {
            str(slide.get("sourceSlidePart", ""))
            for slide in template_blueprint.get("slides", [])
            if isinstance(slide, dict) and slide.get("sourceSlidePart")
        }
        slide_parts.update(
            str(item.get("slidePart", ""))
            for item in sources.values()
            if str(item.get("slidePart", ""))
        )
        slide_parts.update(
            str(item.get("sourceSlidePart", ""))
            for item in slide_motion
            if isinstance(item, dict)
            and is_safe_slide_part(str(item.get("sourceSlidePart", "")))
        )
        notes_parts = {
            str(notes_page.get("sourceNotesPart", ""))
            for slide in template_blueprint.get("slides", [])
            if isinstance(slide, dict)
            and isinstance((notes_page := slide.get("notesPage")), dict)
            and is_safe_notes_part(str(notes_page.get("sourceNotesPart", "")))
        }
        notes_master_parts = {
            str(notes_page.get("sourceNotesMasterPart", ""))
            for slide in template_blueprint.get("slides", [])
            if isinstance(slide, dict)
            and isinstance((notes_page := slide.get("notesPage")), dict)
            and is_safe_notes_master_part(
                str(notes_page.get("sourceNotesMasterPart", ""))
            )
        }
        notes_relationship_parts = {
            rels_part_for_slide_part(part) for part in notes_parts | notes_master_parts
        }
        package_entries = {
            slide_part: source.read(slide_part)
            for slide_part in (
                slide_parts
                | notes_parts
                | notes_master_parts
                | notes_relationship_parts
            )
            if slide_part in source_names
        }
        for slide_part in slide_parts:
            rels_part = rels_part_for_slide_part(slide_part)
            if rels_part in source_names:
                package_entries[rels_part] = source.read(rels_part)
        if "[Content_Types].xml" in source_names:
            package_entries["[Content_Types].xml"] = source.read("[Content_Types].xml")
        for presentation_part in (
            "ppt/presentation.xml",
            "ppt/_rels/presentation.xml.rels",
        ):
            if presentation_part in source_names:
                package_entries[presentation_part] = source.read(presentation_part)
        added_entries: dict[str, bytes] = {}

        for operation_index, operation in enumerate(operations):
            if operation_index in redundant_shape_operations:
                applied_operations.append(applied_operation(operation))
                continue
            reason_code = apply_sync_operation(
                operation,
                sources,
                package_entries,
                added_entries,
                updated_sources,
                scale,
                warnings,
                source,
                template_blueprint,
                fallback_theme,
                fallback_elements,
                raster_cache,
            )
            if reason_code is None:
                applied_operations.append(applied_operation(operation))
            else:
                unsupported_operations.append(
                    unsupported_operation(operation, reason_code)
                )

        if unsupported_operations:
            return package_bytes, warnings, [], [], unsupported_operations, [], []

        for motion_item in slide_motion:
            motion_result = apply_slide_motion_item(
                motion_item,
                template_blueprint,
                package_entries,
                sources,
            )
            if isinstance(motion_result, PptxOoxmlUnsupportedSlideMotion):
                unsupported_slide_motion.append(motion_result)
            else:
                applied_slide_motion.append(motion_result)

        if unsupported_slide_motion:
            return (
                package_bytes,
                warnings,
                [],
                [],
                [],
                [],
                unsupported_slide_motion,
            )

        animation_touched_parts = {
            str(item.get("sourceSlidePart", ""))
            for item in slide_motion
            if isinstance(item, dict)
            and isinstance(item.get("touched"), dict)
            and item["touched"].get("animations") is True
        }
        for part, content in list(package_entries.items()):
            if (
                part not in source_names
                or not is_safe_slide_part(part)
                or part in animation_touched_parts
            ):
                continue
            preserved_timing = preserve_xml_subtree_bytes(
                source.read(part),
                content,
                "timing",
            )
            if preserved_timing is None:
                first_operation = operations[0] if operations else {}
                failure = unsupported_operation(
                    first_operation,
                    "MOTION_REFERENCE_COVERAGE_UNSAFE",
                )
                return package_bytes, warnings, [], [], [failure], [], []
            package_entries[part] = preserved_timing

        changed_entries = {
            part: content
            for part, content in package_entries.items()
            if part not in source_names or content != source.read(part)
        }
        if not changed_entries and not added_entries:
            return (
                package_bytes,
                warnings,
                list(updated_sources.values()),
                applied_operations,
                unsupported_operations,
                applied_slide_motion,
                unsupported_slide_motion,
            )
        return (
            rewrite_zip(source, changed_entries, added_entries),
            warnings,
            list(updated_sources.values()),
            applied_operations,
            unsupported_operations,
            applied_slide_motion,
            unsupported_slide_motion,
        )


def apply_slide_motion_item(
    item: dict[str, Any],
    template_blueprint: dict[str, Any],
    package_entries: dict[str, bytes],
    current_sources: dict[tuple[str, str], dict[str, Any]] | None = None,
) -> PptxOoxmlAppliedSlideMotion | PptxOoxmlUnsupportedSlideMotion:
    from app.ai.pptx_ooxml.models import (
        PptxOoxmlAppliedSlideMotion,
    )
    from app.ai.pptx_ooxml.rendering import (
        int_value,
        xml_bytes,
    )
    from app.ai.pptx_ooxml.routing import (
        dict_value,
        is_safe_slide_part,
        source_slide_part,
    )

    slide_id = str(item.get("slideId", ""))
    slide_part = str(item.get("sourceSlidePart", ""))
    touched = item.get("touched")
    transition_touched = isinstance(touched, dict) and touched.get("transition") is True
    animations_touched = isinstance(touched, dict) and touched.get("animations") is True
    scope: PptxOoxmlMotionScope = (
        "transition" if transition_touched or not animations_touched else "animations"
    )
    matching_template_slides = [
        slide
        for slide in template_blueprint.get("slides", [])
        if isinstance(slide, dict) and source_slide_part(slide) == slide_part
    ]
    template_slide = (
        matching_template_slides[0] if len(matching_template_slides) == 1 else None
    )
    if (
        not slide_id
        or not is_safe_slide_part(slide_part)
        or template_slide is None
        or slide_part not in package_entries
    ):
        return unsupported_slide_motion(
            slide_id,
            scope,
            "SLIDE_MOTION_SOURCE_MISSING",
        )
    if not isinstance(touched, dict) or not (transition_touched or animations_touched):
        return unsupported_slide_motion(
            slide_id,
            scope,
            "SLIDE_MOTION_PAYLOAD_INVALID",
        )

    authoritative_capabilities = dict_value(
        template_slide,
        "ooxmlMotionCapabilities",
    )
    supplied_capabilities = item.get("capabilities")
    if not isinstance(supplied_capabilities, dict):
        return unsupported_slide_motion(
            slide_id,
            scope,
            "SLIDE_MOTION_PAYLOAD_INVALID",
        )
    authoritative_coverage = str(
        authoritative_capabilities.get("importedMainSequenceCoverage", "unknown")
    )
    if transition_touched and supplied_capabilities.get(
        "transitionWritable"
    ) != authoritative_capabilities.get("transitionWritable"):
        return unsupported_slide_motion(
            slide_id,
            "transition",
            "SLIDE_TRANSITION_CAPABILITY_UNSAFE",
        )
    if (
        animations_touched
        and supplied_capabilities.get("importedMainSequenceCoverage")
        != authoritative_coverage
    ):
        return unsupported_slide_motion(
            slide_id,
            "animations",
            "SLIDE_ANIMATION_CAPABILITY_UNSAFE",
        )

    original_slide_xml = package_entries[slide_part]
    try:
        root = ET.fromstring(original_slide_xml)
    except ET.ParseError:
        return unsupported_slide_motion(
            slide_id,
            scope,
            "SLIDE_MOTION_STRUCTURE_UNSUPPORTED",
        )

    if transition_touched:
        if authoritative_capabilities.get("transitionWritable") is not True:
            return unsupported_slide_motion(
                slide_id,
                "transition",
                "SLIDE_TRANSITION_CAPABILITY_UNSAFE",
            )
        if "transition" not in item or (
            item.get("transition") is not None
            and not isinstance(item.get("transition"), dict)
        ):
            return unsupported_slide_motion(
                slide_id,
                "transition",
                "SLIDE_MOTION_PAYLOAD_INVALID",
            )
        try:
            replace_slide_transition(root, item.get("transition"))
        except (TypeError, ValueError):
            return unsupported_slide_motion(
                slide_id,
                "transition",
                "SLIDE_TRANSITION_UNSUPPORTED",
            )

    if animations_touched:
        if authoritative_coverage not in {"absent", "complete"}:
            return unsupported_slide_motion(
                slide_id,
                "animations",
                "SLIDE_ANIMATION_CAPABILITY_UNSAFE",
            )
        animations = item.get("animations")
        if not isinstance(animations, list) or not all(
            isinstance(animation, dict) for animation in animations
        ):
            return unsupported_slide_motion(
                slide_id,
                "animations",
                "SLIDE_MOTION_PAYLOAD_INVALID",
            )
        try:
            applied, diagnostics = replace_main_sequence(
                root,
                cast(list[dict[str, Any]], animations),
                slide_index=int_value(template_slide.get("slideIndex"), 1),
                element_targets=slide_motion_element_targets(
                    template_slide,
                    current_sources,
                ),
            )
        except (TypeError, ValueError):
            return unsupported_slide_motion(
                slide_id,
                "animations",
                "SLIDE_MOTION_PAYLOAD_INVALID",
            )
        if not applied or diagnostics:
            codes = {str(diagnostic.get("code", "")) for diagnostic in diagnostics}
            if "PPTX_MOTION_TARGET_UNRESOLVED" in codes:
                reason = "SLIDE_ANIMATION_TARGET_UNRESOLVED"
            elif "PPTX_MOTION_STRUCTURE_UNSUPPORTED" in codes:
                reason = "SLIDE_MOTION_STRUCTURE_UNSUPPORTED"
            else:
                reason = "SLIDE_ANIMATION_UNSUPPORTED"
            return unsupported_slide_motion(
                slide_id,
                "animations",
                cast(PptxOoxmlMotionReasonCode, reason),
            )

    rewritten = preserve_root_namespace_declarations(
        original_slide_xml,
        xml_bytes(root),
    )
    if rewritten is None:
        return unsupported_slide_motion(
            slide_id,
            scope,
            "SLIDE_MOTION_STRUCTURE_UNSUPPORTED",
        )
    if animations_touched:
        preserved = preserve_excluded_timing_branch_bytes(
            original_slide_xml,
            rewritten,
        )
        if preserved is None:
            return unsupported_slide_motion(
                slide_id,
                "animations",
                "SLIDE_MOTION_STRUCTURE_UNSUPPORTED",
            )
        rewritten = preserved
    if transition_touched and not animations_touched:
        preserved_timing = preserve_xml_subtree_bytes(
            original_slide_xml,
            rewritten,
            "timing",
        )
        if preserved_timing is None:
            return unsupported_slide_motion(
                slide_id,
                "transition",
                "SLIDE_MOTION_STRUCTURE_UNSUPPORTED",
            )
        rewritten = preserved_timing
    package_entries[slide_part] = rewritten
    return PptxOoxmlAppliedSlideMotion(
        slideId=slide_id,
        transition=transition_touched,
        animations=animations_touched,
    )


def slide_motion_element_targets(
    template_slide: dict[str, Any],
    current_sources: dict[tuple[str, str], dict[str, Any]] | None = None,
) -> dict[str, list[str]]:
    from app.ai.pptx_ooxml.routing import (
        source_slide_part,
    )

    targets: dict[str, list[str]] = {}
    slide_part = source_slide_part(template_slide)
    candidates = (
        current_sources.values()
        if current_sources is not None
        else template_slide.get("elementSources", [])
    )
    for source in candidates:
        if not isinstance(source, dict) or not bool(source.get("writable", False)):
            continue
        if (
            current_sources is not None
            and str(source.get("slidePart", "")) != slide_part
        ):
            continue
        element_id = str(source.get("elementId", ""))
        shape_id = str(source.get("shapeId", ""))
        if not element_id or not shape_id:
            continue
        values = targets.setdefault(element_id, [])
        if shape_id not in values:
            values.append(shape_id)
    return targets


def unsupported_slide_motion(
    slide_id: str,
    scope: PptxOoxmlMotionScope,
    reason_code: PptxOoxmlMotionReasonCode,
) -> PptxOoxmlUnsupportedSlideMotion:
    from app.ai.pptx_ooxml.models import (
        PptxOoxmlUnsupportedSlideMotion,
    )

    return PptxOoxmlUnsupportedSlideMotion(
        slideId=slide_id or "unknown",
        scope=scope,
        reasonCode=reason_code,
    )


def preserve_xml_subtree_bytes(
    original: bytes,
    rewritten: bytes,
    local_name_value: str,
) -> bytes | None:
    namespaced_rewritten = preserve_root_namespace_declarations(
        original,
        rewritten,
    )
    if namespaced_rewritten is None:
        return None
    original_match = xml_subtree_match(original, local_name_value)
    rewritten_match = xml_subtree_match(namespaced_rewritten, local_name_value)
    if original_match is None:
        return namespaced_rewritten
    if rewritten_match is None:
        return None
    return (
        namespaced_rewritten[: rewritten_match.start()]
        + original[original_match.start() : original_match.end()]
        + namespaced_rewritten[rewritten_match.end() :]
    )


def preserve_root_namespace_declarations(
    original: bytes,
    rewritten: bytes,
) -> bytes | None:
    original_root = xml_root_opening_tag(original)
    rewritten_root = xml_root_opening_tag(rewritten)
    if original_root is None or rewritten_root is None:
        return None
    original_namespaces = xml_namespace_declarations(original_root.group(0))
    rewritten_namespaces = xml_namespace_declarations(rewritten_root.group(0))
    missing: list[bytes] = []
    for prefix, (uri, declaration) in original_namespaces.items():
        current = rewritten_namespaces.get(prefix)
        if current is not None:
            if current[0] != uri:
                return None
            continue
        missing.append(declaration)
    if not missing:
        return rewritten
    insertion = b"".join(b" " + declaration.strip() for declaration in missing)
    insert_at = rewritten_root.end() - 1
    return rewritten[:insert_at] + insertion + rewritten[insert_at:]


def xml_root_opening_tag(content: bytes) -> re.Match[bytes] | None:
    return re.search(
        rb"<[A-Za-z_][A-Za-z0-9_.:-]*\b[^>]*>",
        content,
    )


def xml_namespace_declarations(
    opening_tag: bytes,
) -> dict[bytes, tuple[bytes, bytes]]:
    pattern = re.compile(
        rb"\s+xmlns(?::(?P<prefix>[A-Za-z_][A-Za-z0-9_.-]*))?"
        rb"\s*=\s*(?P<quote>['\"])(?P<uri>.*?)(?P=quote)"
    )
    return {
        match.group("prefix") or b"": (match.group("uri"), match.group(0))
        for match in pattern.finditer(opening_tag)
    }


def preserve_excluded_timing_branch_bytes(
    original: bytes,
    rewritten: bytes,
) -> bytes | None:
    original_ranges = excluded_timing_branch_ranges(original)
    rewritten_ranges = excluded_timing_branch_ranges(rewritten)
    if [item[0] for item in original_ranges] != [item[0] for item in rewritten_ranges]:
        return None
    result = rewritten
    for original_item, rewritten_item in zip(
        reversed(original_ranges),
        reversed(rewritten_ranges),
        strict=True,
    ):
        _, original_start, original_end = original_item
        _, rewritten_start, rewritten_end = rewritten_item
        result = (
            result[:rewritten_start]
            + original[original_start:original_end]
            + result[rewritten_end:]
        )
    return result


def excluded_timing_branch_bytes(content: bytes) -> list[bytes]:
    return [
        content[start:end] for _, start, end in excluded_timing_branch_ranges(content)
    ]


def excluded_timing_branch_ranges(
    content: bytes,
) -> list[tuple[str, int, int]]:
    tag_pattern = re.compile(
        rb"<(?P<closing>/)?(?P<name>[A-Za-z_][A-Za-z0-9_.:-]*)"
        rb"\b(?P<body>[^<>]*?)(?P<self_closing>/)?>",
        re.DOTALL,
    )
    nodes: list[XmlByteNode] = []
    stack: list[int] = []

    for match in tag_pattern.finditer(content):
        name = match.group("name")
        local = name.rsplit(b":", 1)[-1].decode("ascii")
        if match.group("closing"):
            if not stack:
                continue
            node_index = stack.pop()
            node = nodes[node_index]
            if node.name != name:
                return []
            node.end = match.end()
            continue

        body = match.group("body") or b""
        nodes.append(
            XmlByteNode(
                name=name,
                local=local,
                body=body,
                start=match.start(),
                end=match.end() if match.group("self_closing") else -1,
                parent=stack[-1] if stack else None,
            )
        )
        if not match.group("self_closing"):
            stack.append(len(nodes) - 1)

    if stack or any(node.end < 0 for node in nodes):
        return []

    selected: dict[int, str] = {}
    for node_index, node in enumerate(nodes):
        if node.local == "cTn" and xml_attribute_equals(
            node.body,
            "nodeType",
            "interactiveSeq",
        ):
            branch_index = nearest_ancestor(nodes, node_index, "seq")
            selected[branch_index if branch_index is not None else node_index] = (
                "interactiveSeq"
            )
            continue
        is_media_timeline = node.local == "cTn" and xml_attribute_equals(
            node.body,
            "presetClass",
            "mediacall",
        )
        if is_media_timeline:
            branch_index = nearest_ancestor(nodes, node_index, "par")
            selected[branch_index if branch_index is not None else node_index] = "media"
            continue
        if node.local in {"audio", "video", "cmd"}:
            media_timeline = nearest_ancestor_with_attribute(
                nodes,
                node_index,
                local="cTn",
                attribute="presetClass",
                value="mediacall",
            )
            if media_timeline is not None:
                branch_index = nearest_ancestor(nodes, media_timeline, "par")
                selected[
                    branch_index if branch_index is not None else media_timeline
                ] = "media"
            else:
                selected[node_index] = "media"

    selected_indexes = set(selected)
    outermost_indexes = [
        node_index
        for node_index in selected_indexes
        if not any(
            ancestor in selected_indexes
            for ancestor in ancestor_indexes(nodes, node_index)
        )
    ]
    return [
        (selected[node_index], nodes[node_index].start, nodes[node_index].end)
        for node_index in sorted(
            outermost_indexes,
            key=lambda index: nodes[index].start,
        )
    ]


@dataclass
class XmlByteNode:
    name: bytes
    local: str
    body: bytes
    start: int
    end: int
    parent: int | None


def xml_attribute_equals(body: bytes, name: str, value: str) -> bool:
    return (
        re.search(
            rb"\b"
            + re.escape(name.encode("ascii"))
            + rb"\s*=\s*['\"]"
            + re.escape(value.encode("ascii"))
            + rb"['\"]",
            body,
        )
        is not None
    )


def ancestor_indexes(nodes: list[XmlByteNode], node_index: int) -> list[int]:
    indexes: list[int] = []
    parent = nodes[node_index].parent
    while parent is not None:
        indexes.append(parent)
        parent = nodes[parent].parent
    return indexes


def nearest_ancestor(
    nodes: list[XmlByteNode],
    node_index: int,
    local: str,
) -> int | None:
    return next(
        (
            ancestor
            for ancestor in ancestor_indexes(nodes, node_index)
            if nodes[ancestor].local == local
        ),
        None,
    )


def nearest_ancestor_with_attribute(
    nodes: list[XmlByteNode],
    node_index: int,
    *,
    local: str,
    attribute: str,
    value: str,
) -> int | None:
    return next(
        (
            ancestor
            for ancestor in ancestor_indexes(nodes, node_index)
            if nodes[ancestor].local == local
            and xml_attribute_equals(nodes[ancestor].body, attribute, value)
        ),
        None,
    )


def xml_subtree_match(content: bytes, local_name_value: str) -> re.Match[bytes] | None:
    escaped = re.escape(local_name_value.encode("ascii"))
    pattern = re.compile(
        rb"<(?P<prefix>[A-Za-z_][A-Za-z0-9_.-]*:)?"
        + escaped
        + rb"\b(?:[^>]*/\s*>|[^>]*>.*?</(?P=prefix)"
        + escaped
        + rb"\s*>)",
        re.DOTALL,
    )
    return pattern.search(content)
