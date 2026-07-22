from __future__ import annotations

from app.ai.deck_generation.models import (
    GenerationDiagnosticsInput,
    GenerationDiagnosticsResult,
    GenerateDeckDiagnostics,
    RawInput,
    ValidationIssue,
    ValidationResult,
)
from app.ai.design_program import DeckDesignProgram


def generate_deck_diagnostics(
    raw_input: RawInput,
    validation: ValidationResult,
    unique_core_layout_count: int,
    design_program: DeckDesignProgram | None = None,
) -> GenerateDeckDiagnostics:
    source_records = raw_input.source_records
    uploaded_source_ids = {
        record.source_id for record in source_records if record.source_type == "uploaded"
    }
    web_source_urls = {
        record.url for record in source_records if record.source_type == "web" and record.url
    }
    validation_issue_count = sum(
        len(issues)
        for issues in (
            validation.layout_issues,
            validation.content_issues,
            validation.design_issues,
            validation.presentation_issues,
        )
    )
    return GenerateDeckDiagnostics(
        referencePolicy=raw_input.brief.reference_policy,
        uploadedSourceCount=len(uploaded_source_ids),
        webSourceCount=len(web_source_urls),
        researchAttempts=raw_input.research_attempts,
        relevantWebSourceCount=raw_input.relevant_web_source_count,
        officialWebSourceCount=raw_input.official_web_source_count,
        independentWebSourceCount=raw_input.independent_web_source_count,
        researchQuality=raw_input.research_quality,
        researchIssueCodes=raw_input.research_issue_codes,
        researchFactCoverageSatisfied=raw_input.research_fact_coverage_satisfied,
        repairAttempted=raw_input.repair_attempted,
        repairReasons=raw_input.repair_reason_codes,
        uniqueCoreLayoutCount=unique_core_layout_count,
        validationIssueCount=validation_issue_count,
        warningCodes=raw_input.warning_codes,
        designPackId=(design_program.design_pack_id if design_program else None),
        designPackVersion=(
            design_program.design_pack_version if design_program else None
        ),
        designPackSelectionMode=(
            design_program.selection_mode if design_program else None
        ),
        designPackLayoutIds=(design_program.layout_ids or [] if design_program else []),
        designPackCatalogVersion=(
            design_program.layout_catalog_version if design_program else None
        ),
        designPackFallbackUsed=(
            design_program.selection_fallback_used if design_program else None
        ),
    )


def generation_warnings(
    raw_input: RawInput,
    generated_slide_count: int,
    validation: ValidationResult,
) -> list[str]:
    warnings: list[str] = []
    if (
        not raw_input.references
        and raw_input.brief.reference_policy in {"topic-only", "user-input-only"}
    ):
        warnings.append("참고자료 없이 topic-only generation으로 생성했습니다.")
    if raw_input.min_slide_count <= generated_slide_count < raw_input.max_slide_count:
        warnings.append(
            f"AI가 참고자료/주제 밀도를 기준으로 {generated_slide_count}장이 적정하다고 판단했습니다."
        )
    for issue in validation.design_issues:
        if should_promote_design_issue_to_warning(issue) and issue.message not in warnings:
            warnings.append(issue.message)
    if validation.design_issues:
        warnings.append(
            f"Design Pack validation retained {len(validation.design_issues)} design issue(s)."
        )

    return warnings


def unique_warnings(warnings: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for warning in warnings:
        if warning in seen:
            continue
        seen.add(warning)
        result.append(warning)
    return result


def assemble_generation_diagnostics(
    stage_input: GenerationDiagnosticsInput,
) -> GenerationDiagnosticsResult:
    return GenerationDiagnosticsResult(
        warnings=unique_warnings(
            [
                *generation_warnings(
                    stage_input.raw_input,
                    stage_input.generated_slide_count,
                    stage_input.validation,
                ),
                *stage_input.agent_warnings,
            ]
        ),
        diagnostics=generate_deck_diagnostics(
            stage_input.raw_input,
            stage_input.validation,
            stage_input.unique_core_layout_count,
            stage_input.design_program,
        ),
    )












def should_promote_design_issue_to_warning(issue: ValidationIssue) -> bool:
    return issue.message.startswith("이미지 소스가 없어") or issue.message.startswith(
        "근거 데이터가 없어"
    )
