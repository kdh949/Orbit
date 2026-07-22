from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.ai.ooxml_reference_templates.content_adapter import ReferenceContentPlan
from app.ai.ooxml_reference_templates.models import OoxmlReferenceTemplateManifest
from app.ai.ooxml_reference_templates.selection import (
    PlannedSlotAssignment,
    SourceSelectionError,
    select_source_sequence,
)


class PlannerModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        str_strip_whitespace=True,
    )


class PlannedReferenceSlide(PlannerModel):
    order: int = Field(ge=1, le=20)
    source_slide_id: str = Field(min_length=1)
    slot_assignments: list[PlannedSlotAssignment] = Field(max_length=500)
    source_refs: list[str] = Field(default_factory=list, max_length=500)
    obligation_refs: list[str] = Field(default_factory=list, max_length=500)


class OoxmlReferenceContentPlan(PlannerModel):
    template_id: str = Field(min_length=1)
    template_version: int = Field(gt=0)
    catalog_version: str = Field(min_length=1)
    slides: list[PlannedReferenceSlide] = Field(min_length=1, max_length=20)


class ReferenceTemplatePlanningError(ValueError):
    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        self.retryable = False
        self.authored_fallback_created = False
        super().__init__(f"{code}: {detail}")


def plan_reference_template(
    content_plan: ReferenceContentPlan,
    *,
    manifest: OoxmlReferenceTemplateManifest,
    catalog_version: str,
) -> OoxmlReferenceContentPlan:
    if content_plan.template_id not in {None, manifest.template_id}:
        raise ReferenceTemplatePlanningError(
            "OOXML_REFERENCE_SINGLE_TEMPLATE_REQUIRED",
            "content plan and manifest must use one exact template",
        )
    if content_plan.slides[0].semantic_role != "cover" or content_plan.slides[
        -1
    ].semantic_role != "closing":
        raise ReferenceTemplatePlanningError(
            "OOXML_REFERENCE_COVER_CLOSING_REQUIRED",
            "source sequence requires exact cover and closing roles",
        )
    for slide in content_plan.slides:
        if slide.evidence_required and not slide.source_refs:
            raise ReferenceTemplatePlanningError(
                "OOXML_REFERENCE_EVIDENCE_SOURCE_REQUIRED",
                f"slide {slide.order} has an evidence obligation without a source",
            )
    try:
        selected = select_source_sequence(content_plan.slides, manifest=manifest)
    except SourceSelectionError as error:
        raise ReferenceTemplatePlanningError(error.code, error.detail) from error

    return OoxmlReferenceContentPlan(
        template_id=manifest.template_id,
        template_version=manifest.version,
        catalog_version=catalog_version,
        slides=[
            PlannedReferenceSlide(
                order=source.order,
                source_slide_id=source.source_slide_id,
                slot_assignments=source.slot_assignments,
                source_refs=content.source_refs,
                obligation_refs=content.obligation_refs,
            )
            for content, source in zip(
                content_plan.slides,
                selected,
                strict=True,
            )
        ],
    )
