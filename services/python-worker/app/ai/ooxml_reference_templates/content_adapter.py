from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from app.ai.deck_generation.models import ContentPlan, SlidePlan


ReferenceSlideRole = Literal[
    "cover",
    "agenda",
    "section",
    "statement",
    "summary",
    "metric",
    "comparison",
    "chart",
    "table",
    "process",
    "timeline",
    "team-role",
    "evidence",
    "closing",
]
ReferenceCapability = Literal["image", "table", "chart"]


class AdapterModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        str_strip_whitespace=True,
    )


class ReferenceContentValue(AdapterModel):
    content_item_id: str = Field(min_length=1)
    semantic_role: Literal[
        "title",
        "subtitle",
        "body",
        "caption",
        "label",
        "metric",
        "image",
        "table",
        "chart",
    ]
    content: str = Field(min_length=1)


class ReferenceContentSlide(AdapterModel):
    order: int = Field(ge=1, le=20)
    semantic_role: ReferenceSlideRole
    values: list[ReferenceContentValue] = Field(min_length=1, max_length=500)
    source_refs: list[str] = Field(default_factory=list, max_length=500)
    obligation_refs: list[str] = Field(default_factory=list, max_length=500)
    evidence_required: bool = False
    required_capabilities: list[ReferenceCapability] = Field(
        default_factory=list,
        max_length=3,
    )

    @model_validator(mode="after")
    def validate_value_roles(self) -> ReferenceContentSlide:
        roles = [value.semantic_role for value in self.values]
        if len(roles) != len(set(roles)):
            raise ValueError("adapted content value roles must be unique")
        return self

    def value_for(self, semantic_role: str) -> ReferenceContentValue | None:
        return next(
            (
                value
                for value in self.values
                if value.semantic_role == semantic_role
            ),
            None,
        )


class ReferenceContentPlan(AdapterModel):
    template_id: str | None = None
    title: str = Field(min_length=1)
    slides: list[ReferenceContentSlide] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def validate_sequence(self) -> ReferenceContentPlan:
        if [slide.order for slide in self.slides] != list(
            range(1, len(self.slides) + 1)
        ):
            raise ValueError("adapted content slide orders must be contiguous")
        if self.slides[0].semantic_role != "cover":
            raise ValueError("adapted content must start with a cover")
        if self.slides[-1].semantic_role != "closing":
            raise ValueError("adapted content must end with a closing slide")
        return self


def adapt_content_plan(content_plan: ContentPlan) -> ReferenceContentPlan:
    """Project the existing grounded content plan into the OOXML-only boundary.

    This adapter deliberately carries semantic content and evidence identifiers only.
    Design Program, layout compilation, coordinates, and authored element data never
    cross this boundary.
    """

    if content_plan.slide_count != len(content_plan.slide_plans):
        raise ValueError("content plan slide count does not match its slides")
    last_order = len(content_plan.slide_plans)
    slides = [
        _adapt_slide(slide, last_order=last_order)
        for slide in content_plan.slide_plans
    ]
    return ReferenceContentPlan(title=content_plan.outline.title, slides=slides)


def _adapt_slide(slide: SlidePlan, *, last_order: int) -> ReferenceContentSlide:
    semantic_role = _semantic_role_for(slide, last_order=last_order)
    body = "\n".join(item.text for item in slide.content_items).strip()
    if not body:
        body = slide.message

    values = [
        ReferenceContentValue(
            content_item_id=f"slide-{slide.order}-title",
            semantic_role="title",
            content=slide.title,
        ),
        ReferenceContentValue(
            content_item_id=f"slide-{slide.order}-message",
            semantic_role="subtitle" if semantic_role in {"cover", "closing"} else "body",
            content=body,
        ),
    ]
    if slide.typed_metrics:
        values.append(
            ReferenceContentValue(
                content_item_id=f"slide-{slide.order}-metric",
                semantic_role="metric",
                content="\n".join(
                    f"{metric.value}{metric.unit} {metric.label}"
                    for metric in slide.typed_metrics
                ),
            )
        )
    media_source = slide.media_intent.src.strip()
    required_capabilities: list[ReferenceCapability] = []
    if slide.media_intent.required or media_source:
        required_capabilities.append("image")
    if media_source:
        values.append(
            ReferenceContentValue(
                content_item_id=f"slide-{slide.order}-image",
                semantic_role="image",
                content=media_source,
            )
        )
    if semantic_role == "chart":
        required_capabilities.append("chart")
        values.append(
            ReferenceContentValue(
                content_item_id=f"slide-{slide.order}-chart",
                semantic_role="chart",
                content=body,
            )
        )
    elif semantic_role == "table":
        required_capabilities.append("table")
        values.append(
            ReferenceContentValue(
                content_item_id=f"slide-{slide.order}-table",
                semantic_role="table",
                content=body,
            )
        )

    source_refs = list(
        dict.fromkeys(
            [
                *slide.source_refs,
                *[evidence.file_id for evidence in slide.evidence if evidence.file_id],
            ]
        )
    )
    return ReferenceContentSlide(
        order=slide.order,
        semantic_role=semantic_role,
        values=values,
        source_refs=source_refs,
        obligation_refs=list(dict.fromkeys(slide.obligation_refs)),
        evidence_required=bool(slide.evidence or slide.obligation_refs),
        required_capabilities=list(dict.fromkeys(required_capabilities)),
    )


def _semantic_role_for(slide: SlidePlan, *, last_order: int) -> ReferenceSlideRole:
    if slide.order == 1:
        return "cover"
    if slide.order == last_order:
        return "closing"
    role_by_slide_type: dict[str, ReferenceSlideRole] = {
        "title": "statement",
        "cover": "statement",
        "problem": "statement",
        "solution": "statement",
        "feature-grid": "comparison",
        "process": "process",
        "data": "metric",
        "comparison": "comparison",
        "architecture": "process",
        "quote": "evidence",
        "chart": "chart",
        "summary": "summary",
    }
    return role_by_slide_type[slide.slide_type]
