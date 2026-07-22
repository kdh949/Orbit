from __future__ import annotations

import math
from typing import Any

import pytest

from app.ai.deck_generation.models import (
    ContentPlan,
    DeckOutline,
    GeneratedContentItem,
    PresentationTimingPlan,
    SlidePlan,
    SourceEvidence,
)
from app.ai.ooxml_reference_templates.content_adapter import adapt_content_plan
from app.ai.ooxml_reference_templates.models import OoxmlReferenceTemplateManifest
from app.ai.ooxml_reference_templates.planner import (
    ReferenceTemplatePlanningError,
    plan_reference_template,
)


TEMPLATE_IDS = (
    "simple-light",
    "simple-dark",
    "operating-review",
    "business-review",
    "project-kickoff",
    "team-alignment",
    "market-trends-report",
)


def _timing(slide_count: int) -> PresentationTimingPlan:
    return PresentationTimingPlan(
        charsPerMinute=400,
        speakingTimeRatio=0.8,
        targetTotalChars=800,
        targetSpokenSeconds=120,
        targetSlideCount=slide_count,
        targetSecondsPerSlide=30,
        targetSpeakerNotesCharsPerSlide=200,
    )


def _content_plan(
    *,
    messages: tuple[str, ...] = ("첫 번째 핵심", "두 번째 핵심"),
    body_types: tuple[str, ...] | None = None,
    evidence_at: int | None = None,
) -> ContentPlan:
    body_types = body_types or tuple("problem" for _ in messages)
    slide_count = len(messages) + 2
    slides = [
        SlidePlan(
            order=1,
            slide_type="cover",
            title="분기 운영 리뷰",
            message="의사결정을 위한 핵심 요약",
            speaker_notes="표지 설명",
            keywords=[],
            evidence=[],
        )
    ]
    for offset, (message, slide_type) in enumerate(
        zip(messages, body_types, strict=True), start=2
    ):
        evidence = (
            [SourceEvidence(fileId="file_evidence", note="검증 근거")]
            if evidence_at == offset
            else []
        )
        slides.append(
            SlidePlan(
                order=offset,
                slide_type=slide_type,  # type: ignore[arg-type]
                title=f"본문 {offset - 1}",
                message=message,
                speaker_notes="본문 설명",
                keywords=[],
                evidence=evidence,
                source_refs=["source:verified"] if evidence else [],
                obligationRefs=["obligation-1"] if evidence else [],
                content_items=[
                    GeneratedContentItem(
                        contentItemId=f"content-{offset}",
                        text=message,
                    )
                ],
            )
        )
    slides.append(
        SlidePlan(
            order=slide_count,
            slide_type="summary",
            title="다음 단계",
            message="실행 항목을 확정합니다",
            speaker_notes="마무리 설명",
            keywords=[],
            evidence=[],
        )
    )
    return ContentPlan(
        outline=DeckOutline(
            title="분기 운영 리뷰",
            slide_titles=[slide.title for slide in slides],
        ),
        slidePlans=slides,
        slideCount=slide_count,
        timingPlan=_timing(slide_count),
        repairAttempted=False,
        repairReasonCodes=[],
    )


def _text_slot(
    template_id: str,
    source_order: int,
    role: str,
    *,
    max_chars: int = 120,
    required: bool = True,
) -> dict[str, Any]:
    return {
        "slotId": f"{template_id}-v1-slide-{source_order:02d}-{role}",
        "semanticRole": role,
        "contentType": "text",
        "required": required,
        "locator": {
            "slidePart": f"ppt/slides/slide{source_order}.xml",
            "shapeId": str(source_order * 10 + len(role)),
            "placeholderType": role,
            "relationshipId": None,
        },
        "capacity": {"maxChars": max_chars, "maxLines": 8},
        "mutationPolicy": ["text-content"],
        "replacementPolicy": {"overflow": "fail"},
    }


def _image_slot(template_id: str, source_order: int) -> dict[str, Any]:
    return {
        "slotId": f"{template_id}-v1-slide-{source_order:02d}-image",
        "semanticRole": "image",
        "contentType": "image",
        "required": True,
        "locator": {
            "slidePart": f"ppt/slides/slide{source_order}.xml",
            "shapeId": str(source_order * 10 + 9),
            "placeholderType": "picture",
            "relationshipId": "rId9",
        },
        "capacity": {
            "minAspectRatio": 0.5,
            "maxAspectRatio": 2.0,
            "cropPolicy": "preserve-frame",
        },
        "mutationPolicy": ["image-source"],
        "replacementPolicy": {"overflow": "fail"},
    }


def _source_slide(
    template_id: str,
    source_order: int,
    role: str,
    *,
    layout: int,
    body_max_chars: int = 120,
    extra_slots: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    slots = [
        _text_slot(template_id, source_order, "title", max_chars=80),
        _text_slot(
            template_id,
            source_order,
            "body" if role not in {"cover", "closing"} else "subtitle",
            max_chars=body_max_chars,
        ),
        *(extra_slots or []),
    ]
    return {
        "sourceSlideId": f"{role}-{source_order:02d}",
        "sourceSlidePart": f"ppt/slides/slide{source_order}.xml",
        "sourceOrder": source_order,
        "semanticRole": role,
        "relationships": {
            "layoutPart": f"ppt/slideLayouts/slideLayout{layout}.xml",
            "masterPart": "ppt/slideMasters/slideMaster1.xml",
            "themePart": "ppt/theme/theme1.xml",
        },
        "capacity": {
            "textSlotCount": sum(slot["contentType"] == "text" for slot in slots),
            "imageSlotCount": sum(slot["contentType"] == "image" for slot in slots),
            "tableSlotCount": 0,
            "chartSlotCount": 0,
        },
        "previewId": f"preview-{source_order}",
        "lockedInventorySha256": f"{source_order:064x}",
        "slots": slots,
    }


def _manifest(
    template_id: str,
    *,
    body_capacities: tuple[int, ...] = (120, 120),
    body_roles: tuple[str, ...] | None = None,
    body_layouts: tuple[int, ...] | None = None,
    body_extra_slots: dict[int, list[dict[str, Any]]] | None = None,
) -> OoxmlReferenceTemplateManifest:
    body_roles = body_roles or tuple("statement" for _ in body_capacities)
    body_layouts = body_layouts or tuple(
        2 + index % 2 for index in range(len(body_capacities))
    )
    body_extra_slots = body_extra_slots or {}
    source_slides = [_source_slide(template_id, 1, "cover", layout=1)]
    for index, (capacity, role, layout) in enumerate(
        zip(body_capacities, body_roles, body_layouts, strict=True), start=2
    ):
        source_slides.append(
            _source_slide(
                template_id,
                index,
                role,
                layout=layout,
                body_max_chars=capacity,
                extra_slots=body_extra_slots.get(index),
            )
        )
    closing_order = len(source_slides) + 1
    source_slides.append(
        _source_slide(template_id, closing_order, "closing", layout=9)
    )
    return OoxmlReferenceTemplateManifest.model_validate(
        {
            "templateId": template_id,
            "version": 1,
            "status": "active",
            "sourceFormat": "pptx",
            "sourceSha256": "a" * 64,
            "slideCount": len(source_slides),
            "canvas": {
                "aspectRatio": "16:9",
                "widthEmu": 12_192_000,
                "heightEmu": 6_858_000,
            },
            "name": template_id,
            "description": f"{template_id} fixture",
            "preview": {
                "coverPreviewId": "cover",
                "coverPreviewSha256": "b" * 64,
                "bodyPreviewId": "body",
                "bodyPreviewSha256": "c" * 64,
            },
            "sourceSlides": source_slides,
            "provenance": {
                "authorizationStatus": "approved",
                "inventoryVersion": 1,
            },
        }
    )


@pytest.mark.parametrize("template_id", TEMPLATE_IDS)
def test_seven_template_families_obey_role_capacity_and_repetition_rules(
    template_id: str,
) -> None:
    manifest = _manifest(template_id)
    content = _content_plan()

    plan = plan_reference_template(
        adapt_content_plan(content),
        manifest=manifest,
        catalog_version="catalog-v1",
    )

    assert plan.template_id == template_id
    assert plan.template_version == 1
    assert plan.catalog_version == "catalog-v1"
    assert plan.slides[0].source_slide_id.startswith("cover-")
    assert plan.slides[-1].source_slide_id.startswith("closing-")
    layout_by_source_id = {
        slide.source_slide_id: slide.relationships.layout_part
        for slide in manifest.source_slides
    }
    assert all(
        left.source_slide_id != right.source_slide_id
        and layout_by_source_id[left.source_slide_id]
        != layout_by_source_id[right.source_slide_id]
        for left, right in zip(plan.slides, plan.slides[1:], strict=False)
    )
    unique_count = len({slide.source_slide_id for slide in plan.slides})
    assert unique_count >= math.ceil(len(plan.slides) * 0.8)
    dumped = plan.model_dump(by_alias=True)
    forbidden_geometry = {
        "x",
        "y",
        "width",
        "height",
        "zIndex",
        "rotation",
        "geometry",
    }

    def keys(value: object) -> set[str]:
        if isinstance(value, dict):
            return set(value) | set().union(*(keys(item) for item in value.values()))
        if isinstance(value, list):
            return set().union(*(keys(item) for item in value))
        return set()

    assert keys(dumped).isdisjoint(forbidden_geometry)
    assert all(
        assignment.slot_id.startswith(f"{template_id}-v1-")
        for slide in plan.slides
        for assignment in slide.slot_assignments
    )


def test_capacity_filter_selects_larger_same_role_source() -> None:
    manifest = _manifest("operating-review", body_capacities=(5, 120))
    content = _content_plan(messages=("용량이 작은 후보에는 들어가지 않는 본문",))

    plan = plan_reference_template(
        adapt_content_plan(content),
        manifest=manifest,
        catalog_version="catalog-v1",
    )

    assert plan.slides[1].source_slide_id == "statement-03"


def test_required_media_capability_fails_closed_without_media_content() -> None:
    manifest = _manifest(
        "project-kickoff",
        body_capacities=(120,),
        body_extra_slots={2: [_image_slot("project-kickoff", 2)]},
    )

    with pytest.raises(
        ReferenceTemplatePlanningError,
        match="OOXML_REFERENCE_SOURCE_NO_ELIGIBLE_CANDIDATE",
    ):
        plan_reference_template(
            adapt_content_plan(_content_plan(messages=("이미지 없는 본문",))),
            manifest=manifest,
            catalog_version="catalog-v1",
        )


def test_evidence_obligation_requires_verified_source_and_is_preserved() -> None:
    manifest = _manifest(
        "business-review",
        body_capacities=(120,),
        body_roles=("evidence",),
    )
    adapted = adapt_content_plan(
        _content_plan(
            messages=("검증된 시장 근거",),
            body_types=("quote",),
            evidence_at=2,
        )
    )

    plan = plan_reference_template(
        adapted,
        manifest=manifest,
        catalog_version="catalog-v1",
    )

    assert plan.slides[1].source_refs == ["source:verified", "file_evidence"]
    assert plan.slides[1].obligation_refs == ["obligation-1"]

    invalid = adapted.model_copy(deep=True)
    invalid.slides[1].source_refs = []
    with pytest.raises(
        ReferenceTemplatePlanningError,
        match="OOXML_REFERENCE_EVIDENCE_SOURCE_REQUIRED",
    ):
        plan_reference_template(
            invalid,
            manifest=manifest,
            catalog_version="catalog-v1",
        )


def test_same_input_and_catalog_version_has_deterministic_tie_break() -> None:
    manifest = _manifest(
        "simple-light",
        body_capacities=(120, 120, 120),
        body_layouts=(2, 3, 4),
    )
    adapted = adapt_content_plan(_content_plan(messages=("단일 본문",)))

    first = plan_reference_template(
        adapted,
        manifest=manifest,
        catalog_version="catalog-v1",
    )
    second = plan_reference_template(
        adapted,
        manifest=manifest.model_copy(
            update={"source_slides": list(reversed(manifest.source_slides))}
        ),
        catalog_version="catalog-v1",
    )

    assert first.model_dump() == second.model_dump()
    assert first.slides[1].source_slide_id == "statement-02"


def test_solver_backtracks_when_first_tie_break_would_block_later_capacity() -> None:
    manifest = _manifest(
        "team-alignment",
        body_capacities=(120, 8),
        body_layouts=(2, 3),
    )
    adapted = adapt_content_plan(
        _content_plan(
            messages=("짧은 본문", "두 번째 후보의 용량을 넘는 충분히 긴 본문"),
        )
    )

    plan = plan_reference_template(
        adapted,
        manifest=manifest,
        catalog_version="catalog-v1",
    )

    assert [slide.source_slide_id for slide in plan.slides[1:3]] == [
        "statement-03",
        "statement-02",
    ]


def test_plan_rejects_content_from_a_different_template() -> None:
    adapted = adapt_content_plan(_content_plan())
    adapted.template_id = "simple-dark"

    with pytest.raises(
        ReferenceTemplatePlanningError,
        match="OOXML_REFERENCE_SINGLE_TEMPLATE_REQUIRED",
    ):
        plan_reference_template(
            adapted,
            manifest=_manifest("simple-light"),
            catalog_version="catalog-v1",
        )


def test_reusing_same_source_with_same_slot_copy_is_rejected() -> None:
    manifest = _manifest(
        "market-trends-report",
        body_capacities=(120,),
    )
    content = _content_plan(messages=("반복 문구", "반복 문구"))

    with pytest.raises(
        ReferenceTemplatePlanningError,
        match="OOXML_REFERENCE_REPETITION_RULE_FAILED",
    ):
        plan_reference_template(
            adapt_content_plan(content),
            manifest=manifest,
            catalog_version="catalog-v1",
        )


def test_insufficient_source_diversity_does_not_relax_eighty_percent_rule() -> None:
    manifest = _manifest(
        "operating-review",
        body_capacities=(120, 120),
        body_layouts=(2, 3),
    )
    content = _content_plan(messages=("본문 1", "본문 2", "본문 3", "본문 4"))

    with pytest.raises(
        ReferenceTemplatePlanningError,
        match="OOXML_REFERENCE_REPETITION_RULE_FAILED",
    ):
        plan_reference_template(
            adapt_content_plan(content),
            manifest=manifest,
            catalog_version="catalog-v1",
        )
