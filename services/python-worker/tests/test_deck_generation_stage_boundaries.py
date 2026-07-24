from datetime import date
import json
from types import SimpleNamespace
from typing import Any

import pytest

import app.ai.deck_generation.design_planning as design_planning_module
import app.ai.deck_generation.stage_runtime as stage_runtime_module
from app.ai.design_program import DeckDesignProgram
from app.ai.deck_generation.content_planning import (
    compose_cover_detail,
    normalize_cover_content,
    plan_content,
    plan_story_content,
)
from app.ai.deck_generation.design_planning import resolve_style_prompt_context
from app.ai.deck_generation.diagnostics import assemble_generation_diagnostics
from app.ai.deck_generation.models import (
    ContentPlan,
    ContentFactIssue,
    CoverContent,
    GenerationDiagnosticsInput,
    GenerationDiagnosticsResult,
    GenerateDeckRequest,
    PythonQualityInput,
    PythonQualityResult,
    SourceGroundingResult,
    SlidePlan,
    ValidationResult,
)
from app.ai.deck_generation.pipeline import analyze_input
from app.ai.deck_generation.quality import review_python_quality
from app.ai.deck_generation.source_grounding import ground_sources
from app.ai.deck_generation.stage_runtime import (
    ContentPlanningStageInput,
    DesignPlanningStageInput,
    LayoutCompileStageInput,
    SlideComposeStageInput,
    SourceGroundingStageInput,
    run_content_planning_stage,
    run_design_planning_stage,
    run_layout_compile_stage,
    run_slide_compose_stage,
    run_source_grounding_stage,
)


def test_source_and_content_stage_entrypoints_return_boundary_dtos() -> None:
    raw_input = analyze_input(
        GenerateDeckRequest(projectId="project_demo_1", topic="ORBIT")
    )

    grounding_result = ground_sources(raw_input, current_date=date(2026, 7, 15))
    content_stage_input = grounding_result.raw_input.model_copy(deep=True)
    original_content_stage_input = content_stage_input.model_copy(deep=True)
    content_plan = plan_content(
        content_stage_input,
        resolve_style_prompt_context(content_stage_input),
    )
    checkpoint = ContentPlan.model_validate_json(
        content_plan.model_dump_json(by_alias=True)
    )
    restored_input = original_content_stage_input.model_copy(
        update={
            "slide_count": checkpoint.slide_count,
            "timing_plan": checkpoint.timing_plan.model_copy(deep=True),
            "repair_attempted": checkpoint.repair_attempted,
            "repair_reason_codes": list(checkpoint.repair_reason_codes),
        }
    )

    assert isinstance(grounding_result, SourceGroundingResult)
    assert grounding_result.source_records == grounding_result.raw_input.source_records
    assert grounding_result.warnings == []
    assert isinstance(content_plan, ContentPlan)
    assert content_plan.outline.slide_titles == [
        slide_plan.title for slide_plan in content_plan.slide_plans
    ]
    assert restored_input.slide_count == content_stage_input.slide_count
    assert restored_input.timing_plan == content_stage_input.timing_plan
    assert restored_input.repair_attempted == content_stage_input.repair_attempted
    assert restored_input.repair_reason_codes == content_stage_input.repair_reason_codes


def test_staged_story_plan_uses_one_llm_call_without_slide_details() -> None:
    raw_input = ground_sources(
        analyze_input(
            GenerateDeckRequest(
                projectId="project_demo_1",
                topic="ORBIT",
                prompt="ORBIT 생성 흐름을 설명해줘",
            )
        ),
        current_date=date(2026, 7, 17),
    ).raw_input
    source_id = raw_input.source_records[0].source_id

    class Responses:
        def __init__(self) -> None:
            self.calls = 0

        def create(self, **_kwargs: Any) -> SimpleNamespace:
            self.calls += 1
            slides = [
                {
                    "title": f"슬라이드 {order}",
                    "message": f"핵심 메시지 {order}",
                    "slideType": (
                        "cover"
                        if order == 1
                        else "summary"
                        if order == raw_input.slide_count
                        else "solution"
                    ),
                    "sourceRefs": [source_id],
                }
                for order in range(1, raw_input.slide_count + 1)
            ]
            return SimpleNamespace(
                output_text=json.dumps(
                    {"title": "ORBIT", "slides": slides},
                    ensure_ascii=False,
                )
            )

    responses = Responses()
    content = plan_story_content(
        raw_input,
        resolve_style_prompt_context(raw_input),
        client=SimpleNamespace(responses=responses),
    )

    assert responses.calls == 1
    assert content.slide_plans[0].cover_content is not None
    assert content.slide_plans[0].slide_type == "cover"
    assert all(
        bool(slide.speaker_notes)
        == (slide.slide_type in {"cover", "agenda", "closing"})
        for slide in content.slide_plans
    )
    assert all(not slide.content_items for slide in content.slide_plans)


def test_cover_content_keeps_only_title_and_subtitle() -> None:
    raw_input = analyze_input(
        GenerateDeckRequest(
            projectId="project_demo_1",
            topic="ORBIT 연구 결과",
            prompt=(
                "발표자는 김민지이고 ORBIT 연구소 소속이다. "
                "asset-profile은 발표자 프로필 사진이다."
            ),
            officialAssetFileIds=["asset-profile", "asset-other"],
        )
    )
    first_slide = SlidePlan(
        order=1,
        slide_type="cover",
        title="ORBIT 연구 결과",
        message="팀 생산성을 높이는 발표 설계",
        speaker_notes="",
        keywords=[],
        evidence=[],
    )

    cover = normalize_cover_content(
        raw_input,
        CoverContent(
            title="ignored",
            subtitle="ignored",
            presenterName="김민지",
            organization="ORBIT 연구소",
            dateText="2026년 12월 31일",
            venue="서울 컨벤션 센터",
            profileImageAssetId="asset-profile",
            speakerNotes="표지를 소개합니다.",
        ),
        first_slide,
    )
    detailed = compose_cover_detail(
        raw_input,
        first_slide.model_copy(update={"cover_content": cover}),
    )

    assert cover.title == first_slide.title
    assert cover.subtitle == first_slide.message
    assert cover.presenter_name is None
    assert cover.organization is None
    assert cover.date_text is None
    assert cover.venue is None
    assert cover.profile_image_asset_id is None
    assert detailed.content_items == []
    assert detailed.media_intent.kind == "none"


def test_quality_and_diagnostics_stage_entrypoints_use_pydantic_boundaries() -> None:
    raw_input = analyze_input(
        GenerateDeckRequest(projectId="project_demo_1", topic="ORBIT")
    )
    deck = {
        "title": "ORBIT",
        "metadata": {"createdFrom": {"topic": "ORBIT"}},
        "slides": [],
    }
    quality_result = review_python_quality(
        PythonQualityInput(rawInput=raw_input, deck=deck)
    )
    diagnostics_result = assemble_generation_diagnostics(
        GenerationDiagnosticsInput(
            rawInput=raw_input,
            validation=ValidationResult(passed=True),
            generatedSlideCount=0,
            uniqueCoreLayoutCount=0,
            agentWarnings=["stage warning", "stage warning"],
        )
    )

    assert isinstance(quality_result, PythonQualityResult)
    assert isinstance(diagnostics_result, GenerationDiagnosticsResult)
    assert diagnostics_result.warnings.count("stage warning") == 1
    assert diagnostics_result.diagnostics.unique_core_layout_count == 0


def test_planning_stage_runtime_preserves_typed_stage_boundaries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def create_design_program(
        _context: Any,
        slides: list[dict[str, Any]],
        **_kwargs: Any,
    ) -> DeckDesignProgram:
        return DeckDesignProgram.model_validate(
            {
                "version": "program-v2",
                "visualConcept": "Typed stage boundary",
                "paletteRoles": {
                    "dominant": "#111827",
                    "surface": "#FFFFFF",
                    "text": "#111827",
                    "focal": "#2563EB",
                    "secondary": "#64748B",
                },
                "typography": {
                    "headingFont": "Pretendard",
                    "bodyFont": "Pretendard",
                    "typeScale": {
                        "cover": 52,
                        "title": 36,
                        "body": 24,
                        "caption": 16,
                    },
                },
                "backgroundSequence": ["light"] * len(slides),
                "imageStyle": "documentary",
                "surfaceStyle": "flat",
                "slides": [
                    {
                        "order": order,
                        "compositionId": "hero-split",
                        "variant": "light",
                        "backgroundMode": "light",
                        "focalType": "none",
                        "assetRole": "none",
                        "requiredAsset": False,
                    }
                    for order in range(1, len(slides) + 1)
                ],
            }
        )

    monkeypatch.setattr(
        design_planning_module,
        "create_design_program",
        create_design_program,
    )
    source = run_source_grounding_stage(
        SourceGroundingStageInput(
            request=GenerateDeckRequest(projectId="project_demo_1", topic="ORBIT")
        ),
        current_date=date(2026, 7, 15),
    )
    content = run_content_planning_stage(
        ContentPlanningStageInput(groundingResult=source)
    )
    design = run_design_planning_stage(
        DesignPlanningStageInput(
            rawInput=content.raw_input,
            contentPlan=content.content_plan,
        )
    )
    layout = run_layout_compile_stage(
        LayoutCompileStageInput(
            rawInput=content.raw_input,
            contentPlan=content.content_plan,
            designPlan=design.design_plan,
        )
    )

    assert content.content_plan.slide_count == len(content.content_plan.slide_plans)
    assert len(design.design_plan.design_program.slides) == content.content_plan.slide_count
    assert layout.artifact_version == 2
    assert len(layout.slides) == content.content_plan.slide_count
    assert [slide.shard_key for slide in layout.slides] == [
        f"{order:03d}-slide_{order}"
        for order in range(1, content.content_plan.slide_count + 1)
    ]
    assert "slides" not in layout.deck_shell

    agenda_manifest = layout.slides[1]
    agenda = run_slide_compose_stage(
        SlideComposeStageInput(
            rawInput=content.raw_input,
            contentPlan=content.content_plan,
            designPlan=design.design_plan,
            sourceOrder=agenda_manifest.source_order,
            order=agenda_manifest.order,
            slideId=agenda_manifest.slide_id,
        )
    )
    agenda_text = " ".join(
        str(element.get("props", {}).get("text", ""))
        for element in agenda.slide["elements"]
        if element.get("type") == "text"
    )
    body_titles = [
        slide.title
        for slide in content.content_plan.slide_plans
        if 2 < slide.order < content.content_plan.slide_count
    ]
    assert body_titles
    assert all(title in agenda_text for title in body_titles[:6])

    content.raw_input.fact_repair_eligible_slide_orders = [2]
    validated_items: list[list[str]] = []

    def validate_agenda_detail(
        _raw_input: Any,
        target: SlidePlan,
        _all_slides: list[SlidePlan],
    ) -> tuple[list[ContentFactIssue], int]:
        validated_items.append([item.text for item in target.content_items])
        return (
            [
                ContentFactIssue(
                    code="FACT_REPAIR_REQUIRED",
                    message="repair required",
                    slideOrder=2,
                    priority=2,
                )
            ],
            1,
        )

    def compose_incorrect_agenda(
        _raw_input: Any,
        target: SlidePlan,
        _style_context: Any,
        **_kwargs: Any,
    ) -> SlidePlan:
        raise AssertionError("agenda compose must not call the LLM repair path")

    monkeypatch.setattr(
        stage_runtime_module,
        "validate_slide_detail",
        validate_agenda_detail,
    )
    monkeypatch.setattr(
        stage_runtime_module,
        "compose_slide_detail_with_llm",
        compose_incorrect_agenda,
    )

    validated_agenda = run_slide_compose_stage(
        SlideComposeStageInput(
            rawInput=content.raw_input,
            contentPlan=content.content_plan,
            designPlan=design.design_plan,
            sourceOrder=agenda_manifest.source_order,
            order=agenda_manifest.order,
            slideId=agenda_manifest.slide_id,
        )
    )

    assert validated_agenda.fact_diagnostics.repair_attempted is False
    assert validated_items == [body_titles[:6]]
    assert validated_agenda.slide["aiNotes"]["sourceLedger"] == []

    closing_manifest = layout.slides[-1]
    validated_closing = run_slide_compose_stage(
        SlideComposeStageInput(
            rawInput=content.raw_input,
            contentPlan=content.content_plan,
            designPlan=design.design_plan,
            sourceOrder=closing_manifest.source_order,
            order=closing_manifest.order,
            slideId=closing_manifest.slide_id,
        )
    )

    assert validated_closing.fact_diagnostics.repair_attempted is False
    assert validated_closing.slide["aiNotes"]["sourceLedger"] == []
    assert all(
        element.get("role") not in {"body", "highlight"}
        for element in validated_closing.slide["elements"]
    )
