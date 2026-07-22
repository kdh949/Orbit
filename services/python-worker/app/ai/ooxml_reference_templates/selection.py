from __future__ import annotations

import math
import re
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.ai.ooxml_reference_templates.content_adapter import (
    ReferenceContentSlide,
)
from app.ai.ooxml_reference_templates.models import (
    OoxmlReferenceTemplateManifest,
    OoxmlSourceSlide,
    OoxmlTemplateSlot,
)


class SelectionModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        str_strip_whitespace=True,
    )


class PlannedSlotAssignment(SelectionModel):
    slot_id: str = Field(min_length=1)
    content_item_id: str = Field(min_length=1)
    content_type: str = Field(min_length=1)
    content: str = Field(min_length=1)


class SelectedSourceSlide(SelectionModel):
    order: int = Field(ge=1, le=20)
    source_slide_id: str = Field(min_length=1)
    source_layout_part: str = Field(min_length=1)
    slot_assignments: list[PlannedSlotAssignment] = Field(max_length=500)


class SourceSelectionError(ValueError):
    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        self.detail = detail
        super().__init__(f"{code}: {detail}")


@dataclass(frozen=True)
class _Candidate:
    source: OoxmlSourceSlide
    assignments: tuple[PlannedSlotAssignment, ...]


def select_source_sequence(
    slides: list[ReferenceContentSlide],
    *,
    manifest: OoxmlReferenceTemplateManifest,
) -> list[SelectedSourceSlide]:
    candidate_rows = [
        _eligible_candidates(slide, manifest=manifest) for slide in slides
    ]
    for slide, candidates in zip(slides, candidate_rows, strict=True):
        if not candidates:
            raise SourceSelectionError(
                "OOXML_REFERENCE_SOURCE_NO_ELIGIBLE_CANDIDATE",
                f"slide {slide.order} has no role/capacity/capability match",
            )

    eligible_source_count = len(
        {
            candidate.source.source_slide_id
            for candidates in candidate_rows
            for candidate in candidates
        }
    )
    required_unique_count = min(
        math.ceil(len(slides) * 0.8),
        eligible_source_count,
    )
    candidate_sequence = _solve_sequence(
        candidate_rows,
        required_unique_count=required_unique_count,
    )
    if candidate_sequence is None:
        raise SourceSelectionError(
            "OOXML_REFERENCE_REPETITION_RULE_FAILED",
            "no sequence satisfies adjacency, copy, and unique-source rules",
        )
    return [
        SelectedSourceSlide(
            order=slide.order,
            source_slide_id=candidate.source.source_slide_id,
            source_layout_part=candidate.source.relationships.layout_part,
            slot_assignments=list(candidate.assignments),
        )
        for slide, candidate in zip(slides, candidate_sequence, strict=True)
    ]


def _solve_sequence(
    candidate_rows: list[list[_Candidate]],
    *,
    required_unique_count: int,
) -> list[_Candidate] | None:
    future_sources: list[set[str]] = [
        set() for _ in range(len(candidate_rows) + 1)
    ]
    for index in range(len(candidate_rows) - 1, -1, -1):
        future_sources[index] = future_sources[index + 1] | {
            candidate.source.source_slide_id for candidate in candidate_rows[index]
        }

    def visit(
        index: int,
        chosen: list[_Candidate],
        used_sources: set[str],
        used_copy: set[tuple[str, str, str]],
    ) -> list[_Candidate] | None:
        if len(used_sources | future_sources[index]) < required_unique_count:
            return None
        if index == len(candidate_rows):
            return chosen if len(used_sources) >= required_unique_count else None

        previous_source = chosen[-1].source if chosen else None
        ordered = sorted(
            candidate_rows[index],
            key=lambda candidate: (
                candidate.source.source_slide_id in used_sources,
                candidate.source.source_order,
                candidate.source.source_slide_id,
            ),
        )
        for candidate in ordered:
            if not _sequence_compatible(
                candidate,
                previous_source=previous_source,
                used_copy=used_copy,
            ):
                continue
            result = visit(
                index + 1,
                [*chosen, candidate],
                used_sources | {candidate.source.source_slide_id},
                used_copy | _copy_keys(candidate),
            )
            if result is not None:
                return result
        return None

    return visit(0, [], set(), set())


def _eligible_candidates(
    slide: ReferenceContentSlide,
    *,
    manifest: OoxmlReferenceTemplateManifest,
) -> list[_Candidate]:
    candidates: list[_Candidate] = []
    for source in manifest.source_slides:
        if source.semantic_role != slide.semantic_role:
            continue
        assignments = _assign_slots(slide, source)
        if assignments is None:
            continue
        available_capabilities = {
            slot.content_type
            for slot in source.slots
            if slot.content_type in {"image", "table", "chart"}
        }
        if not set(slide.required_capabilities).issubset(available_capabilities):
            continue
        candidates.append(_Candidate(source=source, assignments=assignments))
    return candidates


def _assign_slots(
    slide: ReferenceContentSlide,
    source: OoxmlSourceSlide,
) -> tuple[PlannedSlotAssignment, ...] | None:
    assignments: list[PlannedSlotAssignment] = []
    for slot in sorted(source.slots, key=lambda value: value.slot_id):
        value = slide.value_for(slot.semantic_role)
        if value is None:
            if slot.required:
                return None
            continue
        if not _fits_capacity(value.content, slot):
            return None
        assignments.append(
            PlannedSlotAssignment(
                slot_id=slot.slot_id,
                content_item_id=value.content_item_id,
                content_type=slot.content_type,
                content=value.content,
            )
        )
    return tuple(assignments)


def _fits_capacity(content: str, slot: OoxmlTemplateSlot) -> bool:
    if slot.content_type != "text":
        return True
    capacity = slot.capacity
    paragraphs = content.splitlines() or [content]
    if len(content) > capacity.max_chars or len(paragraphs) > capacity.max_lines:
        return False
    if capacity.max_paragraphs is not None and len(paragraphs) > capacity.max_paragraphs:
        return False
    return True


def _sequence_compatible(
    candidate: _Candidate,
    *,
    previous_source: OoxmlSourceSlide | None,
    used_copy: set[tuple[str, str, str]],
) -> bool:
    if (
        previous_source is not None
        and previous_source.source_slide_id == candidate.source.source_slide_id
    ):
        return False
    return not (_copy_keys(candidate) & used_copy)


def _copy_keys(candidate: _Candidate) -> set[tuple[str, str, str]]:
    return {
        (
            candidate.source.source_slide_id,
            assignment.slot_id,
            re.sub(r"\s+", " ", assignment.content).strip().casefold(),
        )
        for assignment in candidate.assignments
    }
