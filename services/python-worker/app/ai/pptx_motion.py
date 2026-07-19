from __future__ import annotations

import copy
import math
from dataclasses import dataclass
from typing import Any, Literal
from xml.etree import ElementTree as ET


PML_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
DML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
P14_NS = "http://schemas.microsoft.com/office/powerpoint/2010/main"
MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006"
ORBIT_OOXML_NS = "urn:orbit:deck:ooxml"

TRANSITION_SPEED_DURATION_MS = {
    "fast": 250,
    "med": 500,
    "slow": 1000,
}
SUPPORTED_ANIMATION_TYPES = {"appear", "fade-in", "zoom-in"}
SUPPORTED_START_MODES = {
    "on-slide-enter",
    "on-click",
    "with-previous",
    "after-previous",
}
PRESET_TO_ANIMATION = {
    "1": "appear",
    "10": "fade-in",
    "23": "zoom-in",
}
ANIMATION_TO_PRESET = {
    "appear": "1",
    "fade-in": "10",
    "zoom-in": "23",
}
NODE_TYPE_TO_START_MODE = {
    "clickEffect": "on-click",
    "withEffect": "with-previous",
    "afterEffect": "after-previous",
}
START_MODE_TO_NODE_TYPE = {
    "on-slide-enter": "withEffect",
    "on-click": "clickEffect",
    "with-previous": "withEffect",
    "after-previous": "afterEffect",
}

MotionCoverage = Literal["unknown", "absent", "partial", "complete"]

ET.register_namespace("p", PML_NS)
ET.register_namespace("p14", P14_NS)
ET.register_namespace("mc", MC_NS)
ET.register_namespace("orbit", ORBIT_OOXML_NS)


@dataclass(frozen=True)
class ParsedSlideMotion:
    transition: dict[str, Any] | None
    animations: list[dict[str, Any]]
    coverage: MotionCoverage
    diagnostics: list[dict[str, Any]]


@dataclass(frozen=True)
class SerializedSlideMotion:
    timing: ET.Element[Any] | None
    diagnostics: list[dict[str, Any]]
    effect_count: int


def parse_slide_motion(
    slide_root: ET.Element[Any] | None,
    *,
    slide_index: int,
    shape_targets: dict[str, str],
) -> ParsedSlideMotion:
    if slide_root is None:
        return ParsedSlideMotion(
            transition=None,
            animations=[],
            coverage="unknown",
            diagnostics=[
                motion_diagnostic("PPTX_MOTION_SOURCE_UNAVAILABLE", slide_index)
            ],
        )
    transition = parse_slide_transition(slide_root)
    animations, coverage, diagnostics = parse_main_sequence(
        slide_root,
        slide_index=slide_index,
        shape_targets=shape_targets,
    )
    return ParsedSlideMotion(
        transition=transition,
        animations=animations,
        coverage=coverage,
        diagnostics=diagnostics,
    )


def parse_slide_transition(slide_root: ET.Element[Any]) -> dict[str, Any] | None:
    transition = selected_transition_element(slide_root)
    if transition is None or direct_child(transition, "fade") is None:
        return None
    duration = positive_int(transition.get(f"{{{P14_NS}}}dur"))
    if duration is None:
        duration = TRANSITION_SPEED_DURATION_MS.get(
            str(transition.get("spd", "med")),
            TRANSITION_SPEED_DURATION_MS["med"],
        )
    return {"type": "fade", "durationMs": duration}


def selected_transition_element(
    slide_root: ET.Element[Any],
) -> ET.Element[Any] | None:
    for child in list(slide_root):
        if local_name(child) == "transition":
            return child
        if child.tag != f"{{{MC_NS}}}AlternateContent":
            continue
        choices = [
            candidate
            for candidate in list(child)
            if candidate.tag == f"{{{MC_NS}}}Choice"
        ]
        fallback = next(
            (
                candidate
                for candidate in list(child)
                if candidate.tag == f"{{{MC_NS}}}Fallback"
            ),
            None,
        )
        for branch in choices:
            required_prefixes = set(str(branch.get("Requires", "")).split())
            if not required_prefixes or not required_prefixes.issubset({"p14"}):
                continue
            transition = descendant(branch, "transition")
            if transition is not None and direct_child(transition, "fade") is not None:
                return transition
        if fallback is not None:
            transition = descendant(fallback, "transition")
            if transition is not None and direct_child(transition, "fade") is not None:
                return transition
    return None


def parse_main_sequence(
    slide_root: ET.Element[Any],
    *,
    slide_index: int,
    shape_targets: dict[str, str],
) -> tuple[list[dict[str, Any]], MotionCoverage, list[dict[str, Any]]]:
    timing = direct_child(slide_root, "timing")
    if timing is None:
        return [], "absent", []
    diagnostics = excluded_timing_diagnostics(timing, slide_index)
    main_sequence = main_sequence_node(timing)
    if main_sequence is None:
        if any(local_name(node) in {"spTgt", "bldP"} for node in timing.iter()):
            diagnostics.append(
                motion_diagnostic(
                    "PPTX_MOTION_STRUCTURE_UNSUPPORTED",
                    slide_index,
                )
            )
            return [], "partial", dedupe_diagnostics(diagnostics)
        return [], "absent", diagnostics

    outer_nodes = logical_effect_roots(main_sequence)
    animations: list[dict[str, Any]] = []
    partial = bool(excluded_timing_diagnostics(main_sequence, slide_index))
    build_targets = {
        str(node.get("spid", ""))
        for node in timing.iter()
        if local_name(node) == "bldP" and node.get("spid")
    }
    for source_index, outer in enumerate(outer_nodes):
        outer_id = str(outer.get("id", source_index + 1))
        preset_class = str(outer.get("presetClass", ""))
        node_type = str(outer.get("nodeType", ""))
        if node_type == "interactiveSeq":
            diagnostics.append(
                motion_diagnostic(
                    "PPTX_MOTION_INTERACTIVE_EXCLUDED",
                    slide_index,
                    timing_node_id=outer_id,
                )
            )
            partial = True
            continue
        if preset_class == "mediacall":
            diagnostics.append(
                motion_diagnostic(
                    "PPTX_MOTION_MEDIA_EXCLUDED",
                    slide_index,
                    timing_node_id=outer_id,
                )
            )
            partial = True
            continue
        animation_type = animation_type_for_effect(outer)
        if animation_type is None:
            diagnostics.append(
                motion_diagnostic(
                    "PPTX_MOTION_PRESET_UNSUPPORTED",
                    slide_index,
                    timing_node_id=outer_id,
                )
            )
            partial = True
            continue
        shape_ids = unique_shape_targets(outer)
        if len(shape_ids) != 1:
            diagnostics.append(
                motion_diagnostic(
                    "PPTX_MOTION_TARGET_UNRESOLVED",
                    slide_index,
                    timing_node_id=outer_id,
                )
            )
            partial = True
            continue
        shape_id = shape_ids[0]
        element_id = shape_targets.get(shape_id)
        if not element_id:
            diagnostics.append(
                motion_diagnostic(
                    "PPTX_MOTION_TARGET_UNRESOLVED",
                    slide_index,
                    shape_id=shape_id,
                    timing_node_id=outer_id,
                )
            )
            partial = True
            continue
        if shape_id in build_targets:
            diagnostics.append(
                motion_diagnostic(
                    "PPTX_MOTION_PARAGRAPH_BUILD_DOWNGRADED",
                    slide_index,
                    shape_id=shape_id,
                    timing_node_id=outer_id,
                )
            )
            partial = True
        start_mode = start_mode_for_effect(outer)
        if start_mode is None:
            diagnostics.append(
                motion_diagnostic(
                    "PPTX_MOTION_START_MODE_UNSUPPORTED",
                    slide_index,
                    timing_node_id=outer_id,
                )
            )
            partial = True
            continue
        animations.append(
            {
                "animationId": deterministic_animation_id(
                    slide_index,
                    outer_id,
                ),
                "elementId": element_id,
                "type": animation_type,
                "order": positive_int(outer.get(f"{{{ORBIT_OOXML_NS}}}order"))
                or len(animations) + 1,
                "durationMs": effect_duration_ms(
                    outer,
                    animation_type=animation_type,
                ),
                "delayMs": effect_delay_ms(outer),
                "easing": "ease-out",
                "startMode": start_mode,
                "_sourceIndex": nonnegative_int(
                    outer.get(f"{{{ORBIT_OOXML_NS}}}sourceIndex")
                ),
            }
        )
    animations.sort(
        key=lambda animation: (
            integer_value(animation.get("order"), len(animations)),
            animation["_sourceIndex"]
            if animation["_sourceIndex"] is not None
            else len(animations),
        )
    )
    for animation in animations:
        animation.pop("_sourceIndex", None)
    return (
        animations,
        "partial" if partial else "complete",
        dedupe_diagnostics(diagnostics),
    )


def excluded_timing_diagnostics(
    timing: ET.Element[Any],
    slide_index: int,
) -> list[dict[str, Any]]:
    diagnostics: list[dict[str, Any]] = []
    parents = {child: parent for parent in timing.iter() for child in list(parent)}
    for node in timing.iter():
        name = local_name(node)
        if name == "cTn" and node.get("nodeType") == "interactiveSeq":
            diagnostics.append(
                motion_diagnostic(
                    "PPTX_MOTION_INTERACTIVE_EXCLUDED",
                    slide_index,
                    timing_node_id=str(node.get("id", "")) or None,
                )
            )
        elif name == "cTn" and node.get("presetClass") == "mediacall":
            diagnostics.append(
                motion_diagnostic(
                    "PPTX_MOTION_MEDIA_EXCLUDED",
                    slide_index,
                    timing_node_id=str(node.get("id", "")) or None,
                )
            )
        elif name in {"audio", "video", "cmd"}:
            ancestor = parents.get(node)
            belongs_to_excluded_timeline = False
            while ancestor is not None:
                if local_name(ancestor) == "cTn" and (
                    ancestor.get("presetClass") == "mediacall"
                    or ancestor.get("nodeType") == "interactiveSeq"
                ):
                    belongs_to_excluded_timeline = True
                    break
                ancestor = parents.get(ancestor)
            if belongs_to_excluded_timeline:
                continue
            diagnostics.append(
                motion_diagnostic(
                    "PPTX_MOTION_MEDIA_EXCLUDED",
                    slide_index,
                )
            )
    return dedupe_diagnostics(diagnostics)


def main_sequence_node(timing: ET.Element[Any]) -> ET.Element[Any] | None:
    return next(
        (
            node
            for node in timing.iter()
            if local_name(node) == "cTn" and node.get("nodeType") == "mainSeq"
        ),
        None,
    )


def logical_effect_roots(main_sequence: ET.Element[Any]) -> list[ET.Element[Any]]:
    child_list = direct_child(main_sequence, "childTnLst")
    if child_list is None:
        return []
    effects: list[ET.Element[Any]] = []

    def visit(node: ET.Element[Any]) -> None:
        name = local_name(node)
        if name in {"audio", "video", "cmd"}:
            return
        if name == "cTn" and (
            node.get("nodeType") == "interactiveSeq"
            or node.get("presetClass") == "mediacall"
        ):
            return
        if name == "cTn" and node.get("presetClass") is not None:
            effects.append(node)
            return
        for child in list(node):
            visit(child)

    visit(child_list)
    return effects


def supported_main_sequence_shape_ids(main_sequence: ET.Element[Any]) -> set[str]:
    shape_ids: set[str] = set()
    for effect in logical_effect_roots(main_sequence):
        if (
            animation_type_for_effect(effect) is None
            or start_mode_for_effect(effect) is None
        ):
            continue
        effect_shape_ids = unique_shape_targets(effect)
        if len(effect_shape_ids) == 1:
            shape_ids.add(effect_shape_ids[0])
    return shape_ids


def animation_type_for_effect(outer: ET.Element[Any]) -> str | None:
    if str(outer.get("presetClass", "")) != "entr":
        return None
    preset = str(outer.get("presetID", ""))
    if preset:
        return PRESET_TO_ANIMATION.get(preset)
    if any(
        local_name(node) == "animEffect" and "fade" in str(node.get("filter", ""))
        for node in outer.iter()
    ):
        return "fade-in"
    if any(local_name(node) == "animScale" for node in outer.iter()):
        return "zoom-in"
    if any(local_name(node) == "set" for node in outer.iter()):
        return "appear"
    return None


def start_mode_for_effect(outer: ET.Element[Any]) -> str | None:
    explicit = outer.get(f"{{{ORBIT_OOXML_NS}}}startMode")
    if explicit in SUPPORTED_START_MODES:
        return str(explicit)
    return NODE_TYPE_TO_START_MODE.get(str(outer.get("nodeType", "")))


def unique_shape_targets(outer: ET.Element[Any]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for node in outer.iter():
        if local_name(node) != "spTgt":
            continue
        shape_id = str(node.get("spid", ""))
        if not shape_id or shape_id in seen:
            continue
        seen.add(shape_id)
        result.append(shape_id)
    return result


def effect_duration_ms(
    outer: ET.Element[Any],
    *,
    animation_type: str,
) -> int:
    behavior_names = ["animEffect", "animScale", "anim", "animClr"]
    if animation_type == "appear":
        behavior_names.append("set")
    for behavior_name in behavior_names:
        for behavior in outer.iter():
            if local_name(behavior) != behavior_name:
                continue
            common_behavior = direct_child(behavior, "cBhvr")
            common_time = direct_child(common_behavior, "cTn")
            duration = positive_int(
                common_time.get("dur") if common_time is not None else None
            )
            if duration is not None:
                return duration
    duration = positive_int(outer.get("dur"))
    return duration if duration is not None else 500


def effect_delay_ms(outer: ET.Element[Any]) -> int:
    condition_list = direct_child(outer, "stCondLst")
    if condition_list is None:
        return 0
    for condition in list(condition_list):
        if local_name(condition) != "cond":
            continue
        delay = nonnegative_int(condition.get("delay"))
        if delay is not None:
            return delay
    return 0


def serialize_transition(transition: dict[str, Any]) -> ET.Element[Any]:
    duration = transition_duration(transition)
    alternate = ET.Element(f"{{{MC_NS}}}AlternateContent")
    choice = ET.SubElement(
        alternate,
        f"{{{MC_NS}}}Choice",
        {"Requires": "p14"},
    )
    choice_transition = ET.SubElement(
        choice,
        f"{{{PML_NS}}}transition",
        {
            "spd": "med",
            f"{{{P14_NS}}}dur": str(duration),
        },
    )
    ET.SubElement(choice_transition, f"{{{PML_NS}}}fade")
    fallback = ET.SubElement(alternate, f"{{{MC_NS}}}Fallback")
    fallback_transition = ET.SubElement(
        fallback,
        f"{{{PML_NS}}}transition",
        {"spd": "med"},
    )
    ET.SubElement(fallback_transition, f"{{{PML_NS}}}fade")
    return alternate


def replace_slide_transition(
    slide_root: ET.Element[Any],
    transition: dict[str, Any] | None,
) -> bool:
    for child in list(slide_root):
        if local_name(child) == "transition" or (
            child.tag == f"{{{MC_NS}}}AlternateContent"
            and descendant(child, "transition") is not None
        ):
            slide_root.remove(child)
    if transition is not None:
        insert_slide_child(slide_root, serialize_transition(transition), "transition")
    return True


def serialize_slide_motion(
    animations: list[dict[str, Any]],
    *,
    slide_index: int,
    element_targets: dict[str, list[str]],
) -> SerializedSlideMotion:
    diagnostics: list[dict[str, Any]] = []
    entry_chains: list[list[tuple[dict[str, Any], str, str]]] = []
    click_chains: list[list[tuple[dict[str, Any], str, str]]] = []
    current_chain: list[tuple[dict[str, Any], str, str]] | None = None
    for source_index, animation in sorted_animations(animations):
        animation_type = str(animation.get("type", ""))
        element_id = str(animation.get("elementId", ""))
        if animation_type not in SUPPORTED_ANIMATION_TYPES:
            diagnostics.append(
                motion_diagnostic(
                    "PPTX_MOTION_EFFECT_UNSUPPORTED",
                    slide_index,
                    element_id=element_id or None,
                )
            )
            continue
        start_mode = str(animation.get("startMode", "on-click"))
        if start_mode not in SUPPORTED_START_MODES:
            diagnostics.append(
                motion_diagnostic(
                    "PPTX_MOTION_START_MODE_UNSUPPORTED",
                    slide_index,
                    element_id=element_id or None,
                )
            )
            continue
        if start_mode == "on-slide-enter":
            current_chain = []
            entry_chains.append(current_chain)
        elif start_mode == "on-click":
            current_chain = []
            click_chains.append(current_chain)
        elif current_chain is None:
            current_chain = []
            entry_chains.append(current_chain)
        targets = element_targets.get(element_id, [])
        if not targets:
            diagnostics.append(
                motion_diagnostic(
                    "PPTX_MOTION_TARGET_UNRESOLVED",
                    slide_index,
                    element_id=element_id or None,
                )
            )
            continue
        if len(targets) > 1:
            diagnostics.append(
                motion_diagnostic(
                    "PPTX_MOTION_TARGET_FLATTENED",
                    slide_index,
                    element_id=element_id,
                    count=len(targets),
                )
            )
        for target_index, shape_id in enumerate(targets):
            payload = copy.deepcopy(animation)
            payload["sourceIndex"] = source_index
            if target_index > 0:
                payload["startMode"] = "with-previous"
            current_chain.append((payload, animation_type, shape_id))

    normalized = [
        effect for chain in [*entry_chains, *click_chains] for effect in chain
    ]

    if not normalized:
        return SerializedSlideMotion(
            timing=None,
            diagnostics=diagnostics,
            effect_count=0,
        )
    timing, main_sequence = empty_timing_tree()
    child_list = direct_child(main_sequence, "childTnLst")
    if child_list is None:
        raise ValueError("main sequence child list is missing")
    next_id = 3
    for payload, animation_type, shape_id in normalized:
        effect, next_id = animation_effect_element(
            payload,
            animation_type=animation_type,
            shape_id=shape_id,
            outer_id=next_id,
        )
        child_list.append(effect)
    return SerializedSlideMotion(
        timing=timing,
        diagnostics=diagnostics,
        effect_count=len(normalized),
    )


def replace_main_sequence(
    slide_root: ET.Element[Any],
    animations: list[dict[str, Any]],
    *,
    slide_index: int,
    element_targets: dict[str, list[str]],
) -> tuple[bool, list[dict[str, Any]]]:
    timing = direct_child(slide_root, "timing")
    current_main = main_sequence_node(timing) if timing is not None else None
    if current_main is not None:
        excluded = excluded_timing_diagnostics(current_main, slide_index)
        if excluded:
            return False, excluded
    serialized = serialize_slide_motion(
        animations,
        slide_index=slide_index,
        element_targets=element_targets,
    )
    if serialized.diagnostics:
        return False, serialized.diagnostics
    if current_main is not None:
        current_children = direct_child(current_main, "childTnLst")
        if current_children is None:
            current_children = ET.SubElement(
                current_main,
                f"{{{PML_NS}}}childTnLst",
            )
        for child in list(current_children):
            current_children.remove(child)
        replacement_main = (
            main_sequence_node(serialized.timing)
            if serialized.timing is not None
            else None
        )
        replacement_children = (
            direct_child(replacement_main, "childTnLst")
            if replacement_main is not None
            else None
        )
        if replacement_children is not None:
            for child in list(replacement_children):
                current_children.append(copy.deepcopy(child))
        if replacement_children is not None and len(replacement_children) > 0:
            ensure_orbit_markup_compatibility(slide_root)
        return True, []

    if not animations:
        return True, []
    if serialized.timing is None:
        return False, [
            motion_diagnostic("PPTX_MOTION_SERIALIZATION_FAILED", slide_index)
        ]
    if timing is None:
        insert_slide_child(slide_root, serialized.timing, "timing")
        ensure_orbit_markup_compatibility(slide_root)
        return True, []

    timing_root = next(
        (
            node
            for node in timing.iter()
            if local_name(node) == "cTn" and node.get("nodeType") == "tmRoot"
        ),
        None,
    )
    serialized_main = main_sequence_node(serialized.timing)
    serialized_parent = (
        parent_of(serialized.timing, serialized_main)
        if serialized_main is not None
        else None
    )
    if timing_root is None or serialized_parent is None:
        return False, [
            motion_diagnostic("PPTX_MOTION_STRUCTURE_UNSUPPORTED", slide_index)
        ]
    root_children = direct_child(timing_root, "childTnLst")
    if root_children is None:
        root_children = ET.SubElement(timing_root, f"{{{PML_NS}}}childTnLst")
    root_children.append(copy.deepcopy(serialized_parent))
    ensure_orbit_markup_compatibility(slide_root)
    return True, []


def apply_generic_slide_motion(
    slide_root: ET.Element[Any],
    slide: dict[str, Any],
    *,
    slide_index: int,
    element_targets: dict[str, list[str]],
) -> list[dict[str, Any]]:
    transition = slide.get("transition")
    if isinstance(transition, dict):
        replace_slide_transition(slide_root, transition)
    animations = slide.get("animations", [])
    if not isinstance(animations, list) or not animations:
        return []
    serialized = serialize_slide_motion(
        animations,
        slide_index=slide_index,
        element_targets=element_targets,
    )
    if serialized.timing is not None:
        existing = direct_child(slide_root, "timing")
        if existing is not None:
            slide_root.remove(existing)
        insert_slide_child(slide_root, serialized.timing, "timing")
        ensure_orbit_markup_compatibility(slide_root)
    return serialized.diagnostics


def ensure_orbit_markup_compatibility(slide_root: ET.Element[Any]) -> None:
    attribute = f"{{{MC_NS}}}Ignorable"
    prefixes = slide_root.get(attribute, "").split()
    if "orbit" not in prefixes:
        prefixes.append("orbit")
    slide_root.set(attribute, " ".join(prefixes))


def empty_timing_tree() -> tuple[ET.Element[Any], ET.Element[Any]]:
    timing = ET.Element(f"{{{PML_NS}}}timing")
    timing_list = ET.SubElement(timing, f"{{{PML_NS}}}tnLst")
    root_parallel = ET.SubElement(timing_list, f"{{{PML_NS}}}par")
    root_time = ET.SubElement(
        root_parallel,
        f"{{{PML_NS}}}cTn",
        {
            "id": "1",
            "dur": "indefinite",
            "restart": "never",
            "nodeType": "tmRoot",
        },
    )
    root_children = ET.SubElement(root_time, f"{{{PML_NS}}}childTnLst")
    sequence = ET.SubElement(
        root_children,
        f"{{{PML_NS}}}seq",
        {"concurrent": "1", "nextAc": "seek"},
    )
    main_sequence = ET.SubElement(
        sequence,
        f"{{{PML_NS}}}cTn",
        {"id": "2", "dur": "indefinite", "nodeType": "mainSeq"},
    )
    ET.SubElement(main_sequence, f"{{{PML_NS}}}childTnLst")
    return timing, main_sequence


def animation_effect_element(
    animation: dict[str, Any],
    *,
    animation_type: str,
    shape_id: str,
    outer_id: int,
) -> tuple[ET.Element[Any], int]:
    duration = animation_duration(animation)
    delay = animation_delay(animation)
    start_mode = str(animation.get("startMode", "on-click"))
    outer = ET.Element(f"{{{PML_NS}}}par")
    outer_time = ET.SubElement(
        outer,
        f"{{{PML_NS}}}cTn",
        {
            "id": str(outer_id),
            "dur": str(duration),
            "fill": "hold",
            "presetClass": "entr",
            "presetID": ANIMATION_TO_PRESET[animation_type],
            "presetSubtype": "0",
            "nodeType": START_MODE_TO_NODE_TYPE[start_mode],
            f"{{{ORBIT_OOXML_NS}}}startMode": start_mode,
            f"{{{ORBIT_OOXML_NS}}}order": str(integer_value(animation.get("order"), 1)),
            f"{{{ORBIT_OOXML_NS}}}sourceIndex": str(
                integer_value(animation.get("sourceIndex"), 0)
            ),
        },
    )
    condition_list = ET.SubElement(outer_time, f"{{{PML_NS}}}stCondLst")
    ET.SubElement(condition_list, f"{{{PML_NS}}}cond", {"delay": str(delay)})
    children = ET.SubElement(outer_time, f"{{{PML_NS}}}childTnLst")
    next_id = outer_id + 1
    if animation_type in {"appear", "fade-in", "zoom-in"}:
        set_behavior = ET.SubElement(children, f"{{{PML_NS}}}set")
        set_common = ET.SubElement(set_behavior, f"{{{PML_NS}}}cBhvr")
        ET.SubElement(
            set_common,
            f"{{{PML_NS}}}cTn",
            {
                "id": str(next_id),
                "dur": str(duration if animation_type == "appear" else 1),
                "fill": "hold",
            },
        )
        append_shape_target(set_common, shape_id)
        names = ET.SubElement(set_common, f"{{{PML_NS}}}attrNameLst")
        ET.SubElement(names, f"{{{PML_NS}}}attrName").text = "style.visibility"
        target_value = ET.SubElement(set_behavior, f"{{{PML_NS}}}to")
        ET.SubElement(target_value, f"{{{PML_NS}}}strVal", {"val": "visible"})
        next_id += 1
    if animation_type == "fade-in":
        effect = ET.SubElement(
            children,
            f"{{{PML_NS}}}animEffect",
            {"transition": "in", "filter": "fade"},
        )
        common = ET.SubElement(effect, f"{{{PML_NS}}}cBhvr")
        ET.SubElement(
            common,
            f"{{{PML_NS}}}cTn",
            {"id": str(next_id), "dur": str(duration), "fill": "hold"},
        )
        append_shape_target(common, shape_id)
        next_id += 1
    elif animation_type == "zoom-in":
        scale = ET.SubElement(children, f"{{{PML_NS}}}animScale")
        common = ET.SubElement(scale, f"{{{PML_NS}}}cBhvr")
        ET.SubElement(
            common,
            f"{{{PML_NS}}}cTn",
            {"id": str(next_id), "dur": str(duration), "fill": "hold"},
        )
        append_shape_target(common, shape_id)
        names = ET.SubElement(common, f"{{{PML_NS}}}attrNameLst")
        ET.SubElement(names, f"{{{PML_NS}}}attrName").text = "ScaleX"
        ET.SubElement(names, f"{{{PML_NS}}}attrName").text = "ScaleY"
        ET.SubElement(scale, f"{{{PML_NS}}}from", {"x": "0", "y": "0"})
        ET.SubElement(
            scale,
            f"{{{PML_NS}}}to",
            {"x": "100000", "y": "100000"},
        )
        next_id += 1
    return outer, next_id


def append_shape_target(parent: ET.Element[Any], shape_id: str) -> None:
    target = ET.SubElement(parent, f"{{{PML_NS}}}tgtEl")
    ET.SubElement(target, f"{{{PML_NS}}}spTgt", {"spid": shape_id})


def sorted_animations(
    animations: list[dict[str, Any]],
) -> list[tuple[int, dict[str, Any]]]:
    indexed = list(enumerate(animations))
    return sorted(
        indexed,
        key=lambda item: (
            integer_value(item[1].get("order"), item[0] + 1),
            item[0],
            str(item[1].get("animationId", "")),
        ),
    )


def transition_duration(transition: dict[str, Any]) -> int:
    if transition.get("type") != "fade":
        raise ValueError("unsupported slide transition")
    duration = positive_int(transition.get("durationMs"))
    if duration is None or duration > 60_000:
        raise ValueError("invalid slide transition duration")
    return duration


def animation_duration(animation: dict[str, Any]) -> int:
    duration = positive_int(animation.get("durationMs"))
    if duration is None or duration > 60_000:
        raise ValueError("invalid animation duration")
    return duration


def animation_delay(animation: dict[str, Any]) -> int:
    delay = nonnegative_int(animation.get("delayMs", 0))
    if delay is None or delay > 60_000:
        raise ValueError("invalid animation delay")
    return delay


def insert_slide_child(
    slide_root: ET.Element[Any],
    child: ET.Element[Any],
    name: str,
) -> None:
    order = {"cSld": 0, "clrMapOvr": 1, "transition": 2, "timing": 3, "extLst": 4}
    target_order = order[name]
    insert_at = len(slide_root)
    for index, current in enumerate(list(slide_root)):
        current_order = order.get(local_name(current), -1)
        if current_order > target_order:
            insert_at = index
            break
    slide_root.insert(insert_at, child)


def deterministic_animation_id(slide_index: int, timing_node_id: str) -> str:
    safe_node = "".join(
        character
        if character.isascii() and (character.isalnum() or character in "_-")
        else "_"
        for character in timing_node_id
    )
    return f"anim_ooxml_{slide_index}_{safe_node or 'node'}"


def motion_diagnostic(
    code: str,
    slide_index: int,
    *,
    shape_id: str | None = None,
    element_id: str | None = None,
    timing_node_id: str | None = None,
    count: int | None = None,
) -> dict[str, Any]:
    return {
        "code": code,
        "slideIndex": slide_index,
        **({"shapeId": shape_id} if shape_id else {}),
        **({"elementId": element_id} if element_id else {}),
        **({"timingNodeId": timing_node_id} if timing_node_id else {}),
        **({"count": count} if count is not None else {}),
    }


def dedupe_diagnostics(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[tuple[tuple[str, str], ...]] = set()
    for value in values:
        key = tuple(sorted((name, str(item)) for name, item in value.items()))
        if key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def parent_of(
    root: ET.Element[Any],
    target: ET.Element[Any] | None,
) -> ET.Element[Any] | None:
    if target is None:
        return None
    return next(
        (parent for parent in root.iter() if target in list(parent)),
        None,
    )


def local_name(element: ET.Element[Any]) -> str:
    return str(element.tag).rsplit("}", maxsplit=1)[-1]


def direct_child(
    element: ET.Element[Any] | None,
    name: str,
) -> ET.Element[Any] | None:
    if element is None:
        return None
    return next((child for child in list(element) if local_name(child) == name), None)


def descendant(
    element: ET.Element[Any] | None,
    name: str,
) -> ET.Element[Any] | None:
    if element is None:
        return None
    return next((child for child in element.iter() if local_name(child) == name), None)


def positive_int(value: Any) -> int | None:
    parsed = integer_value(value, -1)
    return parsed if parsed > 0 else None


def nonnegative_int(value: Any) -> int | None:
    parsed = integer_value(value, -1)
    return parsed if parsed >= 0 else None


def integer_value(value: Any, fallback: int) -> int:
    if isinstance(value, bool):
        return fallback
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return fallback
    if not math.isfinite(numeric) or not numeric.is_integer():
        return fallback
    return int(numeric)
