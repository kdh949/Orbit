from __future__ import annotations

from datetime import date
import re
from typing import Any

from app.ai.composition_library import design_program_snapshot
from app.ai.deck_generation.content_planning import (
    choose_slide_count,
    plan_content,
    presentation_profile_for_request,
    presentation_timing_plan_for_request,
    split_content_and_design_prompt,
)
from app.ai.deck_generation.design_planning import (
    plan_design,
    resolve_style_prompt_context,
)
from app.ai.deck_generation.diagnostics import (
    assemble_generation_diagnostics,
)
from app.ai.deck_generation.layout_compiler import (
    compile_layout,
    core_geometry_fingerprint,
)
from app.ai.deck_generation.models import (
    AgentOutput,
    CANVAS,
    ContentPlan,
    DeckContentGenerationError,
    DeckOutline,
    DesignPlan,
    GenerationDiagnosticsInput,
    GenerateDeckReference,
    GenerateDeckRequest,
    GenerateDeckResponse,
    ImageReviewMode,
    LayoutCompileResult,
    PythonQualityInput,
    RawInput,
    ReferenceContext,
    SlideCountRange,
    SlidePlan,
    SourceGroundingResult,
    StylePromptContext,
    TemplateSelectionItem,
    ValidationResult,
)
from app.ai.deck_generation.quality import (
    enforce_design_pack_constraints,
    finalize_python_quality,
    refine_python_quality,
    review_python_quality,
)
from app.ai.deck_generation.source_grounding import ground_sources, safe_token
from app.ai.deck_generation.visual_requirements import (
    apply_visual_requirements,
    plan_visual_requirements,
)


class DeckGenerationOrchestrator:
    def __init__(
        self,
        request: GenerateDeckRequest,
        *,
        client: Any | None = None,
        model: str | None = None,
        api_key: str | None = None,
        reference_context: list[ReferenceContext] | None = None,
        image_review_mode: ImageReviewMode = "auto",
        current_date: date | None = None,
    ) -> None:
        self.request = request
        self.client = client
        self.model = model
        self.api_key = api_key
        self.reference_context = reference_context
        self.image_review_mode = image_review_mode
        self.current_date = current_date or date.today()
        self.agent_outputs: dict[str, AgentOutput] = {}

    def run(self) -> GenerateDeckResponse:
        raw_input = self.run_brief_agent()
        grounding_result = self.run_source_grounding_agent(raw_input)
        raw_input = grounding_result.raw_input
        style_context = resolve_style_prompt_context(raw_input)
        content_plan = self.run_narrative_agent(raw_input, style_context)
        raw_input = raw_input.model_copy(
            update={
                "slide_count": content_plan.slide_count,
                "timing_plan": content_plan.timing_plan.model_copy(deep=True),
                "repair_attempted": content_plan.repair_attempted,
                "repair_reason_codes": list(content_plan.repair_reason_codes),
            }
        )
        design_plan = self.run_design_director_agent(
            raw_input,
            content_plan.slide_plans,
        )
        template_selection: list[TemplateSelectionItem] = []
        layout_result = self.run_layout_agent(raw_input, design_plan)
        visual_requirements = plan_visual_requirements(
            raw_input,
            design_plan,
            layout_result,
        )
        visualized_slides = apply_visual_requirements(
            layout_result,
            visual_requirements,
        )
        deck = self.build_deck(
            raw_input,
            content_plan.outline,
            design_plan,
            visualized_slides,
        )
        deck = enforce_design_pack_constraints(deck, raw_input)
        self.run_chart_data_agent(deck)
        self.run_media_agent(deck)
        reviewer_validation = self.run_quality_reviewer_agent(raw_input, deck)
        deck, validation = self.run_refiner_agent(
            raw_input,
            deck,
            reviewer_validation,
        )
        quality_result = finalize_python_quality(
            PythonQualityInput(rawInput=raw_input, deck=deck)
        )
        deck = quality_result.deck
        validation = quality_result.validation
        body_slides = deck.get("slides", [])[1:-1]
        diagnostics_result = assemble_generation_diagnostics(
            GenerationDiagnosticsInput(
                rawInput=raw_input,
                validation=validation,
                generatedSlideCount=len(visualized_slides),
                uniqueCoreLayoutCount=len(
                    {core_geometry_fingerprint(slide) for slide in body_slides}
                ),
                agentWarnings=self.agent_warnings(),
                designProgram=design_plan.design_program,
            )
        )
        return GenerateDeckResponse(
            deck=deck,
            templateSelection=template_selection,
            warnings=diagnostics_result.warnings,
            validation=validation,
            diagnostics=diagnostics_result.diagnostics,
        )

    def record(
        self,
        name: str,
        summary: str,
        *,
        artifacts: dict[str, Any] | None = None,
        warnings: list[str] | None = None,
        next_actions: list[str] | None = None,
    ) -> None:
        self.agent_outputs[name] = AgentOutput(
            status="succeeded",
            summary=summary,
            artifacts=artifacts or {},
            warnings=warnings or [],
            nextActions=next_actions or [],
        )

    def agent_warnings(self) -> list[str]:
        return [
            warning
            for output in self.agent_outputs.values()
            for warning in output.warnings
        ]

    def run_brief_agent(self) -> RawInput:
        raw_input = analyze_input(self.request, reference_context=self.reference_context)
        self.record(
            "BriefAgent",
            "Normalized deck generation request.",
            artifacts={"rawInput": raw_input},
        )
        return raw_input

    def run_source_grounding_agent(
        self,
        raw_input: RawInput,
    ) -> SourceGroundingResult:
        result = ground_sources(
            raw_input,
            client=self.client,
            model=self.model,
            api_key=self.api_key,
            current_date=self.current_date,
        )
        self.record(
            "SourceGroundingAgent",
            "Prepared reference context for content grounding.",
            artifacts={
                "references": result.raw_input.references,
                "referenceContext": result.raw_input.reference_context,
                "sourceCount": len(result.source_records),
                "webSourceCount": result.web_source_count,
            },
            warnings=result.warnings,
        )
        return result

    def run_narrative_agent(
        self,
        raw_input: RawInput,
        style_context: StylePromptContext,
    ) -> ContentPlan:
        content_plan = plan_content(
            raw_input,
            style_context,
            client=self.client,
            model=self.model,
            api_key=self.api_key,
        )
        self.record(
            "NarrativeAgent",
            "Planned slide narrative.",
            artifacts={
                "outline": content_plan.outline,
                "slidePlans": content_plan.slide_plans,
            },
        )
        return content_plan

    def run_design_director_agent(
        self,
        raw_input: RawInput,
        slide_plans: list[SlidePlan],
    ) -> DesignPlan:
        design_plan = plan_design(
            raw_input,
            slide_plans,
            client=self.client,
            model=self.model,
            api_key=self.api_key,
        )
        self.record(
            "DesignDirectorAgent",
            "Selected theme and design direction.",
            artifacts={
                "theme": design_plan.theme,
                "slidePlans": design_plan.slide_plans,
                "designProgram": design_plan.design_program,
            },
        )
        return design_plan

    def run_layout_agent(
        self,
        raw_input: RawInput,
        design_plan: DesignPlan,
    ) -> LayoutCompileResult:
        layout_result = compile_layout(raw_input, design_plan)
        self.record(
            "LayoutAgent",
            "Composed editable slide elements.",
            artifacts={
                "slides": layout_result.slides,
                "uniqueCoreLayoutCount": len(
                    {
                        core_geometry_fingerprint(slide)
                        for slide in layout_result.slides[1:-1]
                    }
                ),
            },
        )
        return layout_result

    def run_chart_data_agent(self, deck: dict[str, Any]) -> None:
        empty_chart_count = sum(
            1
            for slide in deck["slides"]
            for element in slide["elements"]
            if element["type"] == "chart" and not element.get("props", {}).get("data")
        )
        warnings = (
            ["ChartDataAgent kept chart data empty because no source numbers were available."]
            if empty_chart_count
            else []
        )
        self.record(
            "ChartDataAgent",
            "Checked chart data provenance.",
            artifacts={"emptyChartCount": empty_chart_count},
            warnings=warnings,
        )

    def run_media_agent(self, deck: dict[str, Any]) -> None:
        image_count = sum(
            1
            for slide in deck["slides"]
            for element in slide["elements"]
            if element["type"] == "image"
        )
        self.record(
            "MediaAgent",
            "Checked media placeholders and provided images.",
            artifacts={"imageCount": image_count},
        )

    def run_quality_reviewer_agent(
        self,
        raw_input: RawInput,
        deck: dict[str, Any],
    ) -> ValidationResult:
        quality_result = review_python_quality(
            PythonQualityInput(rawInput=raw_input, deck=deck)
        )
        validation = quality_result.validation
        self.record(
            "QualityReviewerAgent",
            "Reviewed layout, content, design, and presentation quality.",
            artifacts={"validation": validation},
        )
        return validation

    def run_refiner_agent(
        self,
        raw_input: RawInput,
        deck: dict[str, Any],
        reviewer_validation: ValidationResult,
    ) -> tuple[dict[str, Any], ValidationResult]:
        quality_result = refine_python_quality(
            PythonQualityInput(
                rawInput=raw_input,
                deck=deck,
                reviewerValidation=reviewer_validation,
            ),
            client=self.client,
            model=self.model,
            api_key=self.api_key,
            image_review_mode=self.image_review_mode,
        )
        self.record(
            "RefinerAgent",
            "Applied bounded rule-based refinements.",
            artifacts={"validation": quality_result.validation},
        )
        return quality_result.deck, quality_result.validation

    def build_deck(
        self,
        raw_input: RawInput,
        outline: DeckOutline,
        design_plan: DesignPlan,
        slides: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return build_deck_from_layout(raw_input, outline, design_plan, slides)


def build_deck_from_layout(
    raw_input: RawInput,
    outline: DeckOutline,
    design_plan: DesignPlan,
    slides: list[dict[str, Any]],
) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "language": "ko",
        "locale": "ko-KR",
        "sourceType": "ai",
        "generatedBy": "ai",
        "audience": raw_input.metadata.audience,
        "purpose": raw_input.metadata.purpose,
        "tone": raw_input.metadata.tone,
        "createdFrom": {
            "topic": raw_input.topic,
            "references": [
                {"fileId": reference.file_id} for reference in raw_input.references
            ],
            "designReferences": [],
        },
    }
    metadata["presentationProfile"] = raw_input.presentation_profile
    metadata["designProgramSnapshot"] = design_program_snapshot(
        design_plan.design_program
    )

    return {
        "deckId": f"deck_ai_{safe_token(raw_input.project_id)}",
        "projectId": raw_input.project_id,
        "title": outline.title,
        "version": 1,
        "targetDurationMinutes": raw_input.target_duration_minutes,
        "metadata": metadata,
        "canvas": {
            "preset": "wide-16-9",
            "width": CANVAS.width,
            "height": CANVAS.height,
            "aspectRatio": "16:9",
        },
        "theme": design_plan.theme,
        "slides": slides,
    }


def generate_deck(
    request: GenerateDeckRequest,
    *,
    client: Any | None = None,
    model: str | None = None,
    api_key: str | None = None,
    reference_context: list[ReferenceContext] | None = None,
    image_review_mode: ImageReviewMode = "auto",
    current_date: date | None = None,
) -> GenerateDeckResponse:
    return DeckGenerationOrchestrator(
        request,
        client=client,
        model=model,
        api_key=api_key,
        reference_context=reference_context,
        image_review_mode=image_review_mode,
        current_date=current_date,
    ).run()


def analyze_input(
    request: GenerateDeckRequest,
    *,
    reference_context: list[ReferenceContext] | None = None,
) -> RawInput:
    request = apply_prompt_timing_constraints(request)
    slide_count = choose_slide_count(
        request.target_duration_minutes,
        request.slide_count_range,
    )
    duration_seconds = request.target_duration_minutes * 60
    if slide_count > duration_seconds // 15:
        raise DeckContentGenerationError(
            "Slide count exceeds the minimum 15 seconds available per slide."
        )
    prompt, design_prompt = split_content_and_design_prompt(
        request.prompt,
        request.design_prompt,
    )
    resolved_reference_context = (
        reference_context if reference_context is not None else request.reference_context
    )
    reference_policy = (
        request.reference_policy
        or request.design.reference_policy
        or request.brief.reference_policy
    )
    brief = request.brief.model_copy(update={"reference_policy": reference_policy})
    references = request.references or [
        GenerateDeckReference(fileId=file_id) for file_id in request.reference_file_ids
    ]
    return RawInput(
        project_id=request.project_id,
        topic=request.topic.strip(),
        prompt=prompt,
        design_prompt=design_prompt,
        brief=brief,
        target_duration_minutes=request.target_duration_minutes,
        slide_count=slide_count,
        min_slide_count=request.slide_count_range.min,
        max_slide_count=request.slide_count_range.max,
        timingPlan=presentation_timing_plan_for_request(request, slide_count),
        template=request.template,
        metadata=request.metadata,
        design=request.design,
        visual_plan_policy=request.visual_plan_policy,
        reference_policy=reference_policy,
        reference_file_ids=request.reference_file_ids,
        official_asset_file_ids=request.official_asset_file_ids or [],
        references=references,
        reference_keywords=request.reference_keywords,
        reference_context=resolved_reference_context,
        design_program_context=request.design_program_context,
    ).model_copy(
        update={
            "presentation_profile": presentation_profile_for_request(request),
        }
    )


def apply_prompt_timing_constraints(
    request: GenerateDeckRequest,
) -> GenerateDeckRequest:
    duration_match = re.search(
        r"(?:발표\s*시간(?:은|이)?\s*)?(\d{1,3})\s*분(?:짜리|간)?",
        request.prompt,
    )
    slide_match = re.search(
        r"(\d{1,2})\s*(?:[-~～–]\s*(\d{1,2}))?\s*(?:장|페이지|슬라이드)",
        request.prompt,
    )
    updates: dict[str, Any] = {}
    duration = int(duration_match.group(1)) if duration_match else None
    if duration is not None and 1 <= duration <= 120:
        updates["target_duration_minutes"] = duration
        updates["brief"] = request.brief.model_copy(
            update={"duration_minutes": duration}
        )
    if slide_match:
        counts = [int(slide_match.group(1))]
        if slide_match.group(2):
            counts.append(int(slide_match.group(2)))
        valid_counts = [count for count in counts if 1 <= count <= 20]
        if valid_counts:
            updates["slide_count_range"] = SlideCountRange(
                min=min(valid_counts),
                max=max(valid_counts),
            )
    return request.model_copy(update=updates) if updates else request
