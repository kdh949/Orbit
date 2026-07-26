from fastapi import HTTPException, Request

from app.ai.color_options import (
    DeckColorCustomizationRequest,
    DeckColorCustomizationResponse,
    DeckColorOptionsRequest,
    DeckColorOptionsResponse,
    customize_deck_color_palette,
    generate_deck_color_options,
)
from app.ai.deck_pptx_export import (
    DeckPptxExportRequest,
    DeckPptxExportResponse,
    export_deck_pptx,
)
from app.ai.design_agent import (
    DesignAgentGenerationError,
    DesignAgentRequest,
    DesignAgentResponse,
    generate_design_proposal,
)
from app.ai.generate_deck import (
    DeckContentGenerationError,
    GenerateDeckRequest,
    GenerateDeckResponse,
    ReferenceContext,
    generate_deck,
)
from app.ai.deck_generation.stage_runtime import (
    ContentPlanningStageInput,
    ContentPlanningStageResult,
    DesignPlanningStageInput,
    DesignPlanningStageResult,
    LayoutCompileStageInput,
    LayoutCompileStageResult,
    SlideComposeStageInput,
    SlideComposeStageResult,
    SourceGroundingStageInput,
    run_content_planning_stage,
    run_design_planning_stage,
    run_layout_compile_stage,
    run_slide_compose_stage,
    run_source_grounding_stage,
)
from app.ai.deck_generation.models import ReferencePolicy, SourceGroundingResult
from app.ai.pptx.facade import (
    PptxRenderUnavailableError,
)
from app.ai.pptx_png_zip_export import (
    PptxPngZipExportError,
    PptxPngZipExportRequest,
    PptxPngZipExportResponse,
    export_pptx_png_zip,
)
from app.ai.visual_qa import (
    VisualQaRequest,
    VisualQaResponse,
    VisualQaUnavailableError,
    VisualRepairRequest,
    VisualRepairResponse,
    repair_deck_visuals,
    review_deck_visuals,
)
from app.ai.semantic_cues import (
    SemanticCueExtractionError,
    SemanticCueExtractionRequest,
    SemanticCueExtractionResponse,
    extract_semantic_cues,
)
from app.ai.speaker_notes import (
    SpeakerNotesSuggestionError,
    SpeakerNotesSuggestionRequest,
    SpeakerNotesSuggestionResponse,
    generate_speaker_notes_suggestion,
)
from app.config import PythonWorkerConfig, load_config as load_config
from app.routers.health import health as health
from app.references import (
    PostgresReferenceRepository,
    ReferenceSearchResult,
    search_reference_chunks,
    search_reference_chunks_by_file,
)


from fastapi import APIRouter
from app.routers.dependencies import config_from_request as _config

router = APIRouter()


def _planning_failure_detail(error: DeckContentGenerationError) -> dict[str, object]:
    message = str(error)
    if "SOURCE_GROUNDING_REQUIRED" in message:
        reason_code = "SOURCE_GROUNDING_REQUIRED"
    elif message.startswith("LLM deck content generation failed:"):
        reason_code = "CONTENT_LLM_PROVIDER_FAILURE"
    elif message.startswith("LLM returned empty deck content."):
        reason_code = "CONTENT_LLM_EMPTY_RESPONSE"
    elif message.startswith("LLM returned invalid deck content:"):
        reason_code = "CONTENT_LLM_INVALID_RESPONSE"
    elif message.startswith(
        (
            "LLM content plan reused content item IDs:",
            "LLM content plan referenced unavailable source IDs:",
            "UNSUPPORTED_NUMERIC_CLAIM:",
            "LLM returned fewer slides than the requested minimum",
        )
    ):
        reason_code = "CONTENT_LLM_INVALID_RESPONSE"
    elif message.startswith("LLM slide count repair failed:"):
        reason_code = "CONTENT_LLM_SLIDE_COUNT_REPAIR_FAILED"
    elif message.startswith(
        (
            "OPENAI_API_KEY is required for prompt or reference-based deck generation.",
            "LLM deck content generation is required for prompt or reference-based decks.",
        )
    ):
        reason_code = "CONTENT_LLM_PROVIDER_FAILURE"
    elif "Art Director could not create a valid design plan" in message:
        reason_code = "ART_DIRECTOR_INVALID_RESPONSE"
    elif "Art Director" in message and "unavailable" in message:
        reason_code = "ART_DIRECTOR_UNAVAILABLE"
    elif message.startswith(
        (
            "No composition supports",
            "No composition sequence satisfies",
            "Design Program slide count mismatch",
        )
    ):
        reason_code = "DESIGN_COMPOSITION_UNSUPPORTED"
    else:
        reason_code = "PLANNING_FAILURE_UNCLASSIFIED"

    detail: dict[str, object] = {"reasonCode": reason_code}
    if reason_code.startswith(("CONTENT_LLM_", "ART_DIRECTOR_")):
        detail["provider"] = "openai"
    provider_error: BaseException | None = error.__cause__
    for _ in range(3):
        if provider_error is None:
            break
        provider_status = getattr(provider_error, "status_code", None)
        if isinstance(provider_status, int) and 100 <= provider_status <= 599:
            detail["providerHttpStatus"] = provider_status
        provider_request_id = getattr(provider_error, "request_id", None)
        if isinstance(provider_request_id, str) and 0 < len(provider_request_id) <= 256:
            detail["providerRequestId"] = provider_request_id
        if "providerHttpStatus" in detail and "providerRequestId" in detail:
            break
        provider_error = provider_error.__cause__
    return detail


@router.post("/ai/generate-deck", response_model=GenerateDeckResponse)
def generate_ai_deck(
    payload: GenerateDeckRequest,
    request: Request,
) -> GenerateDeckResponse:
    config = _config(request)
    try:
        return generate_deck(
            payload,
            model=config.openai_model,
            api_key=config.openai_api_key,
            reference_context=_generate_deck_reference_context(payload, config),
            image_review_mode=(
                payload.image_review_mode or config.ai_slide_image_review_mode
            ),
        )
    except DeckContentGenerationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.post(
    "/internal/ai/deck-generation/source-grounding",
    response_model=SourceGroundingResult,
)
def source_grounding_stage(
    payload: SourceGroundingStageInput,
    request: Request,
) -> SourceGroundingResult:
    config = _config(request)
    try:
        reference_context, degraded = _staged_reference_context(
            payload.request,
            config,
        )
        result = run_source_grounding_stage(
            payload.model_copy(
                update={
                    "request": payload.request.model_copy(
                        update={"reference_context": reference_context}
                    )
                }
            ),
            model=config.openai_model,
            api_key=config.openai_api_key,
        )
        if degraded:
            result.warnings.append(
                "Reference chunk retrieval was unavailable for some files; "
                "generation continued with extracted text or web research."
            )
            if (
                "REFERENCE_CHUNK_RETRIEVAL_DEGRADED"
                not in result.raw_input.warning_codes
            ):
                result.raw_input.warning_codes.append(
                    "REFERENCE_CHUNK_RETRIEVAL_DEGRADED"
                )
        return result
    except DeckContentGenerationError as error:
        raise HTTPException(
            status_code=503, detail=_planning_failure_detail(error)
        ) from error


@router.post(
    "/internal/ai/deck-generation/content-planning",
    response_model=ContentPlanningStageResult,
)
def content_planning_stage(
    payload: ContentPlanningStageInput,
    request: Request,
) -> ContentPlanningStageResult:
    config = _config(request)
    try:
        return run_content_planning_stage(
            payload,
            model=config.openai_model,
            api_key=config.openai_api_key,
        )
    except DeckContentGenerationError as error:
        raise HTTPException(
            status_code=503, detail=_planning_failure_detail(error)
        ) from error


@router.post(
    "/internal/ai/deck-generation/design-planning",
    response_model=DesignPlanningStageResult,
)
def design_planning_stage(
    payload: DesignPlanningStageInput,
    request: Request,
) -> DesignPlanningStageResult:
    config = _config(request)
    try:
        return run_design_planning_stage(
            payload,
            model=config.openai_model,
            api_key=config.openai_api_key,
        )
    except DeckContentGenerationError as error:
        raise HTTPException(
            status_code=503, detail=_planning_failure_detail(error)
        ) from error


@router.post(
    "/internal/ai/deck-generation/layout-compile",
    response_model=LayoutCompileStageResult,
)
def layout_compile_stage(
    payload: LayoutCompileStageInput,
    request: Request,
) -> LayoutCompileStageResult:
    config = _config(request)
    return run_layout_compile_stage(
        payload,
        model=config.openai_model,
        api_key=config.openai_api_key,
        image_review_mode=config.ai_slide_image_review_mode,
    )


@router.post(
    "/internal/ai/deck-generation/slide-compose",
    response_model=SlideComposeStageResult,
)
def slide_compose_stage(
    payload: SlideComposeStageInput,
    request: Request,
) -> SlideComposeStageResult:
    config = _config(request)
    try:
        return run_slide_compose_stage(
            payload,
            model=config.openai_model,
            api_key=config.openai_api_key,
        )
    except DeckContentGenerationError as error:
        raise HTTPException(
            status_code=503, detail=_planning_failure_detail(error)
        ) from error


@router.post("/ai/deck-color-options", response_model=DeckColorOptionsResponse)
def generate_ai_deck_color_options(
    payload: DeckColorOptionsRequest,
    request: Request,
) -> DeckColorOptionsResponse:
    config = _config(request)
    return generate_deck_color_options(
        payload,
        model=config.openai_model,
        api_key=config.openai_api_key,
    )


@router.post(
    "/ai/deck-color-customization",
    response_model=DeckColorCustomizationResponse,
)
def generate_ai_deck_color_customization(
    payload: DeckColorCustomizationRequest,
    request: Request,
) -> DeckColorCustomizationResponse:
    config = _config(request)
    return customize_deck_color_palette(
        payload,
        model=config.openai_model,
        api_key=config.openai_api_key,
    )


@router.post(
    "/ai/design-agent/propose",
    response_model=DesignAgentResponse,
    response_model_exclude_none=True,
)
def propose_slide_design(
    payload: DesignAgentRequest,
    request: Request,
) -> DesignAgentResponse:
    config = _config(request)
    try:
        return generate_design_proposal(
            payload,
            model=config.openai_model,
            api_key=config.openai_api_key,
        )
    except DesignAgentGenerationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.post("/ai/export-deck-pptx", response_model=DeckPptxExportResponse)
def export_ai_deck_pptx(payload: DeckPptxExportRequest) -> DeckPptxExportResponse:
    return export_deck_pptx(payload)


@router.post("/ai/export-pptx-png-zip", response_model=PptxPngZipExportResponse)
def export_pptx_png_zip_endpoint(
    payload: PptxPngZipExportRequest,
) -> PptxPngZipExportResponse:
    try:
        return export_pptx_png_zip(payload)
    except PptxRenderUnavailableError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except PptxPngZipExportError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/ai/review-deck-visuals", response_model=VisualQaResponse)
def review_ai_deck_visuals(
    payload: VisualQaRequest,
    request: Request,
) -> VisualQaResponse:
    config = _config(request)
    try:
        return review_deck_visuals(
            payload,
            model=config.ai_ppt_visual_qa_model or config.openai_model,
            api_key=config.openai_api_key,
        )
    except VisualQaUnavailableError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.post("/ai/repair-deck-visuals", response_model=VisualRepairResponse)
def repair_ai_deck_visuals(payload: VisualRepairRequest) -> VisualRepairResponse:
    return repair_deck_visuals(payload)


@router.post("/ai/extract-semantic-cues", response_model=SemanticCueExtractionResponse)
def extract_semantic_cues_endpoint(
    payload: SemanticCueExtractionRequest,
    request: Request,
) -> SemanticCueExtractionResponse:
    config = _config(request)
    try:
        return extract_semantic_cues(
            payload,
            model=config.openai_model,
            api_key=config.openai_api_key,
        )
    except SemanticCueExtractionError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.post(
    "/ai/speaker-notes/suggest",
    response_model=SpeakerNotesSuggestionResponse,
)
def suggest_speaker_notes(
    payload: SpeakerNotesSuggestionRequest,
    request: Request,
) -> SpeakerNotesSuggestionResponse:
    config = _config(request)
    try:
        return generate_speaker_notes_suggestion(
            payload,
            model=config.openai_model,
            api_key=config.openai_api_key,
        )
    except SpeakerNotesSuggestionError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


def _generate_deck_reference_context(
    payload: GenerateDeckRequest,
    config: PythonWorkerConfig,
) -> list[ReferenceContext]:
    file_ids = {reference.file_id for reference in payload.references}
    if not file_ids:
        return []

    direct_context = [
        item
        for item in payload.reference_context
        if item.file_id in file_ids and item.content.strip()
    ]

    query = " ".join(
        [
            payload.topic,
            payload.prompt,
            *[keyword.text for keyword in payload.reference_keywords],
        ]
    ).strip()

    try:
        results, _embedding_result = search_reference_chunks(
            repository=PostgresReferenceRepository(config.database_url),
            project_id=payload.project_id,
            query=query or payload.topic,
            limit=20,
            file_ids=sorted(file_ids),
            model=config.openai_embedding_model,
            api_key=config.openai_api_key,
        )
    except Exception:
        return direct_context[:6]

    searched_context = [
        ReferenceContext(
            fileId=result.file_id,
            sourceId=f"uploaded:{result.file_id}:{result.chunk_id}",
            chunkId=result.chunk_id,
            title=str(result.metadata.get("fileName", "")),
            content=result.content,
        )
        for result in results
        if result.file_id in file_ids and result.content.strip()
    ]
    return unique_reference_context([*direct_context, *searched_context])[:6]


def _staged_reference_context(
    payload: GenerateDeckRequest,
    config: PythonWorkerConfig,
) -> tuple[list[ReferenceContext], bool]:
    policy = _reference_policy(payload)
    if policy == "user-input-only":
        return [], False

    file_ids = list(
        dict.fromkeys(
            [reference.file_id for reference in payload.references]
            or payload.reference_file_ids
        )
    )
    if not file_ids:
        return unique_reference_context(payload.reference_context), False

    direct_by_file: dict[str, ReferenceContext] = {}
    for context in payload.reference_context:
        if (
            context.file_id in file_ids
            and context.content.strip()
            and context.file_id not in direct_by_file
        ):
            direct_by_file[context.file_id] = context

    if policy == "topic-only":
        return list(direct_by_file.values()), False

    query = " ".join(
        dict.fromkeys(
            value.strip()
            for value in [
                payload.topic,
                payload.prompt,
                payload.brief.audience_text,
                str(payload.metadata.audience),
                *[keyword.text for keyword in payload.reference_keywords],
            ]
            if value.strip()
        )
    )
    try:
        candidates, embedding_result = search_reference_chunks_by_file(
            repository=PostgresReferenceRepository(config.database_url),
            project_id=payload.project_id,
            query=query or payload.topic,
            file_ids=file_ids,
            limit_per_file=3,
            model=config.openai_embedding_model,
            api_key=config.openai_api_key,
        )
    except Exception:
        candidates = []
        embedding_result = None

    candidates = _unique_reference_chunks(
        candidates,
        project_id=payload.project_id,
        file_ids=file_ids,
    )
    available_file_ids = {candidate.file_id for candidate in candidates}
    missing_file_ids = [
        file_id for file_id in file_ids if file_id not in available_file_ids
    ]
    search_succeeded = (
        embedding_result is not None and embedding_result.status == "succeeded"
    )
    if policy == "references-only" and (not search_succeeded or missing_file_ids):
        raise DeckContentGenerationError(
            "SOURCE_GROUNDING_REQUIRED: every selected reference requires an "
            "indexed chunk."
        )

    if policy == "research-first":
        research_chunks = sorted(candidates, key=_chunk_rank)[:4]
        return _chunk_contexts(research_chunks, direct_by_file), bool(
            not search_succeeded or missing_file_ids
        )

    selected: list[ReferenceSearchResult] = []
    selected_keys: set[tuple[str, str]] = set()
    fallback_contexts: list[ReferenceContext] = []
    for file_id in file_ids:
        best = next(
            (candidate for candidate in candidates if candidate.file_id == file_id),
            None,
        )
        if best is not None:
            selected.append(best)
            selected_keys.add((best.file_id, best.chunk_id))
        elif policy == "references-first" and file_id in direct_by_file:
            fallback_contexts.append(direct_by_file[file_id])

    selected.extend(
        candidate
        for candidate in sorted(candidates, key=_chunk_rank)
        if (candidate.file_id, candidate.chunk_id) not in selected_keys
    )
    selected = selected[: 12 - len(fallback_contexts)]
    return [
        *_chunk_contexts(selected, direct_by_file),
        *fallback_contexts,
    ], bool(not search_succeeded or missing_file_ids)


def _reference_policy(payload: GenerateDeckRequest) -> ReferencePolicy:
    return (
        payload.reference_policy
        or payload.design.reference_policy
        or payload.brief.reference_policy
    )


def _unique_reference_chunks(
    candidates: list[ReferenceSearchResult],
    *,
    project_id: str,
    file_ids: list[str],
) -> list[ReferenceSearchResult]:
    allowed_file_ids = set(file_ids)
    seen: set[tuple[str, str]] = set()
    counts: dict[str, int] = {}
    unique: list[ReferenceSearchResult] = []
    for candidate in sorted(candidates, key=_chunk_rank):
        normalized = " ".join(candidate.content.split()).casefold()
        key = (candidate.file_id, normalized)
        if (
            candidate.project_id != project_id
            or candidate.file_id not in allowed_file_ids
            or not normalized
            or key in seen
            or counts.get(candidate.file_id, 0) >= 3
        ):
            continue
        seen.add(key)
        counts[candidate.file_id] = counts.get(candidate.file_id, 0) + 1
        unique.append(candidate)
    return unique


def _chunk_rank(candidate: ReferenceSearchResult) -> tuple[float, int, str]:
    return (-candidate.score, candidate.chunk_index, candidate.chunk_id)


def _chunk_contexts(
    candidates: list[ReferenceSearchResult],
    direct_by_file: dict[str, ReferenceContext],
) -> list[ReferenceContext]:
    content_by_key = {
        (candidate.file_id, candidate.chunk_id): candidate.content.strip()
        for candidate in candidates
    }
    by_file: dict[str, list[ReferenceSearchResult]] = {}
    for candidate in candidates:
        by_file.setdefault(candidate.file_id, []).append(candidate)
    for file_candidates in by_file.values():
        ordered = sorted(file_candidates, key=lambda candidate: candidate.chunk_index)
        for previous, current in zip(ordered, ordered[1:]):
            if current.chunk_index == previous.chunk_index + 1:
                key = (current.file_id, current.chunk_id)
                content_by_key[key] = _remove_chunk_overlap(
                    content_by_key[(previous.file_id, previous.chunk_id)],
                    content_by_key[key],
                )

    contexts: list[ReferenceContext] = []
    for candidate in candidates:
        direct = direct_by_file.get(candidate.file_id)
        contexts.append(
            ReferenceContext(
                fileId=candidate.file_id,
                sourceId=f"uploaded:{candidate.file_id}:{candidate.chunk_id}",
                chunkId=candidate.chunk_id,
                title=(
                    str(candidate.metadata.get("fileName", "")).strip()
                    or (direct.title if direct else "")
                ),
                content=content_by_key[(candidate.file_id, candidate.chunk_id)],
            )
        )
    return contexts


def _remove_chunk_overlap(previous: str, current: str) -> str:
    max_overlap = min(150, len(previous), len(current))
    for size in range(max_overlap, 19, -1):
        if previous[-size:] == current[:size]:
            return current[size:].lstrip() or current
    return current


def unique_reference_context(items: list[ReferenceContext]) -> list[ReferenceContext]:
    seen: set[tuple[str, str]] = set()
    unique: list[ReferenceContext] = []
    for item in items:
        content = item.content.strip()
        key = (item.file_id, content)
        if not content or key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique
