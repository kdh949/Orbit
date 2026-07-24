from __future__ import annotations

from datetime import date
import time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.ai.composition_library import COMPOSITION_SPECS
from app.ai.deck_generation.content_planning import (
    compose_agenda_detail,
    compose_closing_detail,
    compose_cover_detail,
    compose_slide_detail_with_llm,
    plan_story_content,
)
from app.ai.deck_generation.content_fact_quality import (
    as_validation_issues,
    validate_slide_detail,
)
from app.ai.deck_generation.design_planning import (
    plan_design,
    resolve_style_prompt_context,
)
from app.ai.deck_generation.layout_compiler import (
    assemble_program_v2_slide,
)
from app.ai.deck_generation.models import (
    ContentPlan,
    DeckContentGenerationError,
    DesignPlan,
    GenerateDeckRequest,
    ImageReviewMode,
    LayoutCompileResult,
    PythonQualityInput,
    RawInput,
    SourceGroundingResult,
    ValidationResult,
    VisualRequirements,
)
from app.ai.deck_generation.pipeline import analyze_input, build_deck_from_layout
from app.ai.deck_generation.quality import (
    finalize_python_quality,
)
from app.ai.deck_generation.source_grounding import ground_sources
from app.ai.deck_generation.structural_policy import is_body_slide_type
from app.ai.deck_generation.visual_requirements import (
    apply_visual_requirements,
    plan_visual_requirements,
)


class StageModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class SourceGroundingStageInput(StageModel):
    request: GenerateDeckRequest


class RegenerationContext(StageModel):
    instruction: str = Field(default="", max_length=240)
    previous_slide_titles: list[str] = Field(
        default_factory=list,
        alias="previousSlideTitles",
    )


class ContentPlanningStageInput(StageModel):
    grounding_result: SourceGroundingResult = Field(alias="groundingResult")
    regeneration_context: RegenerationContext | None = Field(
        default=None,
        alias="regenerationContext",
    )


class ContentPlanningStageResult(StageModel):
    artifact_version: Literal[2] = Field(default=2, alias="artifactVersion")
    raw_input: RawInput = Field(alias="rawInput")
    content_plan: ContentPlan = Field(alias="contentPlan")


class DesignPlanningStageInput(StageModel):
    raw_input: RawInput = Field(alias="rawInput")
    content_plan: ContentPlan = Field(alias="contentPlan")
    preserve_approved_content: bool = Field(
        default=False,
        alias="preserveApprovedContent",
    )


class DesignPlanningStageResult(StageModel):
    design_plan: DesignPlan = Field(alias="designPlan")


class LayoutCompileStageInput(StageModel):
    raw_input: RawInput = Field(alias="rawInput")
    content_plan: ContentPlan = Field(alias="contentPlan")
    design_plan: DesignPlan = Field(alias="designPlan")
    source_warnings: list[str] = Field(default_factory=list, alias="sourceWarnings")


class LayoutManifestSlide(StageModel):
    source_order: int = Field(alias="sourceOrder", ge=1)
    order: int = Field(ge=1)
    slide_id: str = Field(alias="slideId", min_length=1)
    shard_key: str = Field(alias="shardKey", min_length=1)


class LayoutCompileStageResult(StageModel):
    artifact_version: Literal[2] = Field(default=2, alias="artifactVersion")
    deck_shell: dict[str, Any] = Field(alias="deckShell")
    slides: list[LayoutManifestSlide] = Field(min_length=1)
    warnings: list[str] = Field(default_factory=list)


class SlideComposeStageInput(StageModel):
    raw_input: RawInput = Field(alias="rawInput")
    content_plan: ContentPlan = Field(alias="contentPlan")
    design_plan: DesignPlan = Field(alias="designPlan")
    source_order: int = Field(alias="sourceOrder", ge=1)
    order: int = Field(ge=1)
    slide_id: str = Field(alias="slideId", min_length=1)


class FactDiagnostics(StageModel):
    validation_duration_ms: int = Field(
        default=0,
        alias="validationDurationMs",
        ge=0,
    )
    issue_codes: list[str] = Field(default_factory=list, alias="issueCodes")
    slide_orders: list[int] = Field(default_factory=list, alias="slideOrders")
    repair_attempted: bool = Field(default=False, alias="repairAttempted")
    repair_succeeded: bool = Field(default=False, alias="repairSucceeded")
    repair_duration_ms: int = Field(default=0, alias="repairDurationMs", ge=0)


class SlideComposeStageResult(StageModel):
    slide: dict[str, Any]
    validation: ValidationResult
    warnings: list[str] = Field(default_factory=list)
    fact_diagnostics: FactDiagnostics = Field(
        default_factory=FactDiagnostics,
        alias="factDiagnostics",
    )


def run_source_grounding_stage(
    stage_input: SourceGroundingStageInput,
    *,
    client: Any | None = None,
    model: str | None = None,
    api_key: str | None = None,
    current_date: date | None = None,
) -> SourceGroundingResult:
    return ground_sources(
        analyze_input(stage_input.request),
        client=client,
        model=model,
        api_key=api_key,
        current_date=current_date or date.today(),
    )


def run_content_planning_stage(
    stage_input: ContentPlanningStageInput,
    *,
    client: Any | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> ContentPlanningStageResult:
    raw_input = stage_input.grounding_result.raw_input.model_copy(deep=True)
    if stage_input.regeneration_context is not None:
        raw_input = raw_input.model_copy(
            update={
                "regeneration_instruction": stage_input.regeneration_context.instruction,
                "previous_slide_titles": list(
                    stage_input.regeneration_context.previous_slide_titles
                ),
            }
        )
    content_plan = plan_story_content(
        raw_input,
        resolve_style_prompt_context(raw_input),
        client=client,
        model=model,
        api_key=api_key,
    )
    raw_input = raw_input.model_copy(
        update={
            "slide_count": content_plan.slide_count,
            "timing_plan": content_plan.timing_plan.model_copy(deep=True),
            "repair_attempted": content_plan.repair_attempted,
            "repair_reason_codes": list(content_plan.repair_reason_codes),
        }
    )
    return ContentPlanningStageResult(rawInput=raw_input, contentPlan=content_plan)


def run_design_planning_stage(
    stage_input: DesignPlanningStageInput,
    *,
    client: Any | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> DesignPlanningStageResult:
    return DesignPlanningStageResult(
        designPlan=plan_design(
            stage_input.raw_input,
            stage_input.content_plan.slide_plans,
            preserve_approved_content=stage_input.preserve_approved_content,
            client=client,
            model=model,
            api_key=api_key,
        )
    )


def run_layout_compile_stage(
    stage_input: LayoutCompileStageInput,
    *,
    client: Any | None = None,
    model: str | None = None,
    api_key: str | None = None,
    image_review_mode: ImageReviewMode = "auto",
) -> LayoutCompileStageResult:
    deck = build_deck_from_layout(
        stage_input.raw_input,
        stage_input.content_plan.outline,
        stage_input.design_plan,
        [],
    )
    deck.pop("slides", None)
    return LayoutCompileStageResult(
        deckShell=deck,
        slides=[
            LayoutManifestSlide(
                sourceOrder=slide.order,
                order=slide.order,
                slideId=f"slide_{slide.order}",
                shardKey=f"{slide.order:03d}-slide_{slide.order}",
            )
            for slide in stage_input.content_plan.slide_plans
        ],
        warnings=stage_input.source_warnings,
    )


def run_slide_compose_stage(
    stage_input: SlideComposeStageInput,
    *,
    client: Any | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> SlideComposeStageResult:
    target = next(
        (
            slide
            for slide in stage_input.content_plan.slide_plans
            if slide.order == stage_input.order
        ),
        None,
    )
    if target is None or stage_input.source_order != target.order:
        raise DeckContentGenerationError("Slide manifest does not match the story plan.")
    expected_slide_id = f"slide_{target.order}"
    if stage_input.slide_id != expected_slide_id:
        raise DeckContentGenerationError("Slide manifest identity is invalid.")
    available_sources = {
        source.source_id: source for source in stage_input.raw_input.source_records
    }
    scoped_raw_input = stage_input.raw_input.model_copy(
        deep=True,
        update={
            "source_records": [
                available_sources[source_id]
                for source_id in target.source_refs
                if source_id in available_sources
            ],
            "reference_context": [],
        },
    )
    direction = stage_input.design_plan.design_program.slides[target.order - 1]
    composition = COMPOSITION_SPECS[direction.composition_id]
    detailed = (
        compose_cover_detail(scoped_raw_input, target)
        if target.order == 1
        else compose_agenda_detail(
            scoped_raw_input,
            target,
            stage_input.content_plan.slide_plans,
        )
        if target.slide_type == "agenda"
        else compose_closing_detail(
            scoped_raw_input,
            target,
            stage_input.content_plan.slide_plans,
        )
        if target.slide_type == "closing"
        else compose_slide_detail_with_llm(
            scoped_raw_input,
            target,
            resolve_style_prompt_context(scoped_raw_input),
            client=client,
            model=model,
            api_key=api_key,
            content_item_range=(composition.min_items, composition.max_items),
        )
    )
    fact_issues, validation_duration_ms = validate_slide_detail(
        scoped_raw_input,
        detailed,
        stage_input.content_plan.slide_plans,
    )
    repair_attempted = bool(
        fact_issues
        and is_body_slide_type(target.slide_type)
        and target.order in scoped_raw_input.fact_repair_eligible_slide_orders
    )
    repair_succeeded = False
    repair_duration_ms = 0
    if repair_attempted:
        repair_started = time.perf_counter()
        try:
            repaired_detail = compose_slide_detail_with_llm(
                scoped_raw_input,
                detailed,
                resolve_style_prompt_context(scoped_raw_input),
                client=client,
                model=model,
                api_key=api_key,
                content_item_range=(composition.min_items, composition.max_items),
                repair_issue_codes=tuple(issue.code for issue in fact_issues),
            )
            detailed = (
                compose_agenda_detail(
                    scoped_raw_input,
                    repaired_detail,
                    stage_input.content_plan.slide_plans,
                )
                if target.slide_type == "agenda"
                else repaired_detail
            )
            repair_succeeded = True
        except DeckContentGenerationError:
            repair_succeeded = False
        repair_duration_ms = round((time.perf_counter() - repair_started) * 1000)
        fact_issues, second_validation_duration_ms = validate_slide_detail(
            scoped_raw_input,
            detailed,
            stage_input.content_plan.slide_plans,
        )
        validation_duration_ms += second_validation_duration_ms
        repair_succeeded = repair_succeeded and not fact_issues
    slide = assemble_program_v2_slide(
        scoped_raw_input,
        detailed,
        stage_input.design_plan.theme,
        stage_input.design_plan.design_program,
        direction,
    )
    single_design = stage_input.design_plan.model_copy(
        deep=True,
        update={"slide_plans": [detailed]},
    )
    layout_result = LayoutCompileResult(slides=[slide])
    visual_requirements = VisualRequirements(
        items=[
            plan_visual_requirements(
                scoped_raw_input,
                single_design,
                layout_result,
            ).items[0]
        ]
    )
    visualized = apply_visual_requirements(layout_result, visual_requirements)[0]
    deck = build_deck_from_layout(
        scoped_raw_input,
        stage_input.content_plan.outline,
        stage_input.design_plan,
        [visualized],
    )
    finalized = finalize_python_quality(
        PythonQualityInput(rawInput=scoped_raw_input, deck=deck)
    )
    finalized.validation.content_issues.extend(as_validation_issues(fact_issues))
    final_slide = finalized.deck.get("slides", [])[0]
    return SlideComposeStageResult(
        slide=final_slide,
        validation=finalized.validation,
        factDiagnostics=FactDiagnostics(
            validationDurationMs=validation_duration_ms,
            issueCodes=sorted({issue.code for issue in fact_issues}),
            slideOrders=[target.order] if fact_issues else [],
            repairAttempted=repair_attempted,
            repairSucceeded=repair_succeeded,
            repairDurationMs=repair_duration_ms,
        ),
    )
