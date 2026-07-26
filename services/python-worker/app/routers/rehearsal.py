from typing import Literal, Self

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.audio.transcribe import (
    PronunciationContextTerm,
    TranscriptSegment,
)
from app.audio.analysis.models import (
    RehearsalSilenceAnalysis,
    unmeasured_silence_analysis,
)
from app.config import load_config as load_config
from app.routers.health import health as health
from app.rehearsal import (
    DeckKeyword,
    RunSeriesEntry,
    SlideTimelineEntry,
    analyze_rehearsal_metrics,
    generate_progress_comment,
    generate_rehearsal_coaching,
)
from app.semantic_rehearsal import (
    AnalyzeSemanticCuesRequest,
    AnalyzeSemanticCuesResponse,
    OpenAISemanticGrader,
    analyze_semantic_cues,
)


from fastapi import APIRouter
from app.routers.dependencies import config_from_request as _config

router = APIRouter()


class DeckKeywordRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    keyword_id: str = Field(default="", alias="keywordId")
    slide_id: str = Field(default="", alias="slideId")
    text: str
    synonyms: list[str] = Field(default_factory=list)
    abbreviations: list[str] = Field(default_factory=list)
    required: bool = False


class RehearsalSlideTimelineEntryRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    slide_id: str = Field(alias="slideId")
    entered_second: float = Field(alias="enteredSecond", ge=0)


class RehearsalAnalyzeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    run_id: str = Field(alias="runId")
    project_id: str = Field(alias="projectId")
    deck_id: str = Field(alias="deckId")
    transcript: str
    language: str = Field(default="und", min_length=1, max_length=128)
    duration_seconds: float = Field(alias="durationSeconds", ge=0)
    segments: list[TranscriptSegment] = Field(default_factory=list)
    deck_keywords: list[DeckKeywordRequest] = Field(
        default_factory=list,
        alias="deckKeywords",
    )
    slide_timeline: list[RehearsalSlideTimelineEntryRequest] = Field(
        default_factory=list,
        alias="slideTimeline",
    )
    silence_analysis: RehearsalSilenceAnalysis = Field(
        default_factory=lambda: unmeasured_silence_analysis(
            "LEGACY_REPORT",
            detector_version="unavailable",
        ),
        alias="silenceAnalysis",
    )
    pronunciation_context: list[PronunciationContextTerm] = Field(
        default_factory=list,
        alias="pronunciationContext",
        max_length=32,
    )


class RehearsalCoachingResponse(BaseModel):
    # 정상 응답에는 성공한 코칭 결과만 포함한다.
    status: Literal["succeeded"]
    summary: str = ""
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    next_practice_focus: str = Field(default="", alias="nextPracticeFocus")
    message: str = ""


class RehearsalAiSummaryResponse(BaseModel):
    headline: str
    paragraphs: list[str]


class RehearsalSpeedSampleResponse(BaseModel):
    start_second: float = Field(alias="startSecond", ge=0)
    end_second: float = Field(alias="endSecond", ge=0)
    words_per_minute: float = Field(alias="wordsPerMinute", ge=0)


class RehearsalFillerWordDetailResponse(BaseModel):
    word: str
    count: int = Field(ge=0)


class RehearsalMissedKeywordResponse(BaseModel):
    slide_id: str = Field(alias="slideId")
    keyword_id: str = Field(alias="keywordId")
    text: str


class RehearsalSlideSpeakingRateResponse(BaseModel):
    metric_definition_version: Literal[1] = Field(alias="metricDefinitionVersion")
    measurement_state: Literal["measured", "unmeasured"] = Field(
        alias="measurementState"
    )
    reason_code: (
        Literal[
            "UNSUPPORTED_LANGUAGE",
            "SEGMENT_TIMESTAMPS_UNAVAILABLE",
            "INSUFFICIENT_SLIDE_SPEECH",
            "BASELINE_UNAVAILABLE",
            "LEGACY_REPORT",
        ]
        | None
    ) = Field(alias="reasonCode")
    characters_per_second: float | None = Field(
        alias="charactersPerSecond",
        gt=0,
    )
    baseline_characters_per_second: float | None = Field(
        alias="baselineCharactersPerSecond",
        gt=0,
    )
    relative_rate_ratio: float | None = Field(alias="relativeRateRatio", gt=0)
    pace_category: Literal["slower", "similar", "faster"] | None = Field(
        alias="paceCategory"
    )
    active_speech_seconds: float = Field(alias="activeSpeechSeconds", ge=0)
    character_count: int = Field(alias="characterCount", ge=0)

    @model_validator(mode="after")
    def validate_measurement_state(self) -> Self:
        values = (
            self.characters_per_second,
            self.baseline_characters_per_second,
            self.relative_rate_ratio,
            self.pace_category,
        )
        if self.measurement_state == "measured":
            if self.reason_code is not None or any(value is None for value in values):
                raise ValueError("Measured speaking rate requires all values.")
        elif self.reason_code is None or any(value is not None for value in values):
            raise ValueError("Unmeasured speaking rate requires only a reason code.")
        return self


class RehearsalSlideInsightResponse(BaseModel):
    slide_id: str = Field(alias="slideId")
    filler_word_count: int = Field(alias="fillerWordCount", ge=0)
    long_silence_count: int | None = Field(alias="longSilenceCount", ge=0)
    speaking_rate: RehearsalSlideSpeakingRateResponse = Field(alias="speakingRate")


class RehearsalAnalyzeResponse(BaseModel):
    run_id: str = Field(alias="runId")
    words_per_minute: float = Field(alias="wordsPerMinute")
    filler_word_count: int = Field(alias="fillerWordCount")
    long_silence_count: int | None = Field(alias="longSilenceCount")
    keyword_coverage: float = Field(alias="keywordCoverage")
    speed_samples: list[RehearsalSpeedSampleResponse] = Field(
        default_factory=list,
        alias="speedSamples",
    )
    filler_word_details: list[RehearsalFillerWordDetailResponse] = Field(
        default_factory=list,
        alias="fillerWordDetails",
    )
    missed_keywords: list[RehearsalMissedKeywordResponse] = Field(
        default_factory=list,
        alias="missedKeywords",
    )
    slide_insights: list[RehearsalSlideInsightResponse] = Field(
        default_factory=list,
        alias="slideInsights",
    )
    ai_summary: RehearsalAiSummaryResponse = Field(alias="aiSummary")
    coaching: RehearsalCoachingResponse


@router.post("/rehearsal/analyze", response_model=RehearsalAnalyzeResponse)
def analyze_rehearsal(
    request: Request,
    payload: RehearsalAnalyzeRequest,
) -> RehearsalAnalyzeResponse:
    config = _config(request)
    deck_keywords = [
        DeckKeyword(
            keyword_id=keyword.keyword_id,
            slide_id=keyword.slide_id,
            text=keyword.text,
            synonyms=keyword.synonyms,
            abbreviations=keyword.abbreviations,
            required=keyword.required,
        )
        for keyword in payload.deck_keywords
    ]
    metrics = analyze_rehearsal_metrics(
        transcript=payload.transcript,
        language=payload.language,
        duration_seconds=payload.duration_seconds,
        segments=payload.segments,
        deck_keywords=deck_keywords,
        slide_timeline=[
            SlideTimelineEntry(
                slide_id=entry.slide_id,
                entered_second=entry.entered_second,
            )
            for entry in payload.slide_timeline
        ],
        silence_analysis=payload.silence_analysis,
        pronunciation_context=payload.pronunciation_context,
    )
    coaching = generate_rehearsal_coaching(
        transcript=payload.transcript,
        metrics=metrics,
        model=config.openai_model,
        api_key=config.openai_api_key,
    )
    # 코칭 생성 실패는 부분 성공으로 숨기지 않고 API 오류로 반환한다.
    if coaching.status != "succeeded":
        raise _coaching_http_exception(coaching.status, coaching.message)

    ai_summary_headline = (
        coaching.ai_summary_headline
        or coaching.summary
        or "리허설 총평을 생성하지 못했습니다."
    )
    ai_summary_paragraphs = [
        paragraph for paragraph in coaching.ai_summary_paragraphs if paragraph.strip()
    ] or [coaching.summary or ai_summary_headline]

    return RehearsalAnalyzeResponse(
        runId=payload.run_id,
        wordsPerMinute=metrics.words_per_minute,
        fillerWordCount=metrics.filler_word_count,
        longSilenceCount=metrics.long_silence_count,
        keywordCoverage=metrics.keyword_coverage,
        speedSamples=[
            RehearsalSpeedSampleResponse(
                startSecond=sample.start_second,
                endSecond=sample.end_second,
                wordsPerMinute=sample.words_per_minute,
            )
            for sample in metrics.speed_samples
        ],
        fillerWordDetails=[
            RehearsalFillerWordDetailResponse(
                word=detail.word,
                count=detail.count,
            )
            for detail in metrics.filler_word_details
        ],
        missedKeywords=[
            RehearsalMissedKeywordResponse(
                slideId=keyword.slide_id,
                keywordId=keyword.keyword_id,
                text=keyword.text,
            )
            for keyword in metrics.missed_keywords
        ],
        slideInsights=[
            RehearsalSlideInsightResponse(
                slideId=insight.slide_id,
                fillerWordCount=insight.filler_word_count,
                longSilenceCount=insight.long_silence_count,
                speakingRate=RehearsalSlideSpeakingRateResponse(
                    metricDefinitionVersion=(
                        insight.speaking_rate.metric_definition_version
                    ),
                    measurementState=insight.speaking_rate.measurement_state,
                    reasonCode=insight.speaking_rate.reason_code,
                    charactersPerSecond=(insight.speaking_rate.characters_per_second),
                    baselineCharactersPerSecond=(
                        insight.speaking_rate.baseline_characters_per_second
                    ),
                    relativeRateRatio=insight.speaking_rate.relative_rate_ratio,
                    paceCategory=insight.speaking_rate.pace_category,
                    activeSpeechSeconds=insight.speaking_rate.active_speech_seconds,
                    characterCount=insight.speaking_rate.character_count,
                ),
            )
            for insight in metrics.slide_insights
        ],
        aiSummary=RehearsalAiSummaryResponse(
            headline=ai_summary_headline,
            paragraphs=ai_summary_paragraphs[:3],
        ),
        coaching=RehearsalCoachingResponse(
            status="succeeded",
            summary=coaching.summary,
            strengths=coaching.strengths,
            improvements=coaching.improvements,
            nextPracticeFocus=coaching.next_practice_focus,
            message=coaching.message,
        ),
    )


@router.post(
    "/rehearsal/analyze-semantic-cues",
    response_model=AnalyzeSemanticCuesResponse,
)
def analyze_rehearsal_semantic_cues(
    payload: AnalyzeSemanticCuesRequest,
    request: Request,
) -> AnalyzeSemanticCuesResponse:
    config = _config(request)
    return analyze_semantic_cues(
        payload,
        grader=OpenAISemanticGrader(
            model=config.openai_model,
            api_key=config.openai_api_key,
        ),
    )


class RehearsalProgressRunEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    run_id: str = Field(alias="runId")
    created_at: str = Field(alias="createdAt")
    duration_seconds: float = Field(alias="durationSeconds", ge=0)


class RehearsalProgressCommentRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    project_id: str = Field(alias="projectId")
    run_series: list[RehearsalProgressRunEntry] = Field(alias="runSeries")


class RehearsalProgressCommentResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    project_id: str = Field(alias="projectId")
    comment: str | None = None


@router.post(
    "/rehearsal/progress-comment", response_model=RehearsalProgressCommentResponse
)
def rehearsal_progress_comment(
    payload: RehearsalProgressCommentRequest,
    request: Request,
) -> RehearsalProgressCommentResponse:
    config = _config(request)
    run_series = [
        RunSeriesEntry(
            run_id=e.run_id,
            created_at=e.created_at,
            duration_seconds=e.duration_seconds,
        )
        for e in payload.run_series
    ]
    comment = generate_progress_comment(
        run_series=run_series,
        model=config.openai_model,
        api_key=config.openai_api_key,
    )
    return RehearsalProgressCommentResponse(
        projectId=payload.project_id, comment=comment
    )


def _coaching_http_exception(status: str, message: str) -> HTTPException:
    # 코칭 실패 원인을 클라이언트가 구분할 수 있는 HTTP 상태로 변환한다.
    detail = message or "Rehearsal coaching failed."
    if status == "skipped":
        return HTTPException(status_code=400, detail=detail)
    if status == "unavailable":
        return HTTPException(status_code=503, detail=detail)
    return HTTPException(status_code=502, detail=detail)
