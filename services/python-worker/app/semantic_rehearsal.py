from __future__ import annotations

from dataclasses import dataclass
import json
import math
import re
from typing import Any, Literal, Protocol
import unicodedata

from pydantic import BaseModel, ConfigDict, Field, model_validator


SemanticFallbackReason = Literal[
    "user_disabled",
    "permission_denied",
    "stt_unavailable",
    "network_error",
    "provider_unavailable",
    "model_not_ready",
    "model_load_failed",
    "timeout",
    "runtime_error",
    "server_evaluation_failed",
    "stale_cue",
    "transcript_incomplete",
    "no_transcript",
    "insufficient_evidence",
    "slide_not_visited",
    "evaluation_not_run",
    "evaluation_snapshot_mismatch",
    "queue_dropped",
    "needs_confirmation",
]
SemanticMeasurementMode = Literal["full", "basic", "none"]
SemanticOutcomeStatus = Literal[
    "covered", "partial", "missed", "unmeasured", "excluded"
]


class StrictApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class SnapshotKeyword(StrictApiModel):
    keyword_id: str = Field(alias="keywordId", min_length=1)
    text: str = Field(min_length=1)
    synonyms: list[str] = Field(default_factory=list)
    abbreviations: list[str] = Field(default_factory=list)
    required: bool = True


class SnapshotSourceRef(StrictApiModel):
    kind: Literal[
        "slide-title",
        "speaker-notes",
        "element",
        "table",
        "chart",
        "image-analysis",
    ]
    ref_id: str | None = Field(default=None, alias="refId", min_length=1)
    source_hash: str = Field(alias="sourceHash", min_length=8, max_length=128)


class SnapshotSemanticCue(StrictApiModel):
    cue_id: str = Field(alias="cueId", min_length=1)
    slide_id: str = Field(alias="slideId", min_length=1)
    meaning: str = Field(min_length=1, max_length=240)
    report_label: str | None = Field(default=None, alias="reportLabel", max_length=80)
    presenter_tag: str | None = Field(default=None, alias="presenterTag", max_length=40)
    cue_type: (
        Literal[
            "definition",
            "problem",
            "cause",
            "solution",
            "result",
            "warning",
            "lesson",
            "transition",
            "closing",
        ]
        | None
    ) = Field(default=None, alias="cueType")
    importance: Literal["core", "supporting", "optional"] = "supporting"
    review_status: Literal["approved", "excluded"] = Field(alias="reviewStatus")
    freshness: Literal["current", "stale"] = "current"
    origin: Literal["ai", "manual", "imported"] = "imported"
    revision: int = Field(default=1, ge=1)
    source_deck_version: int | None = Field(
        default=None, alias="sourceDeckVersion", ge=1
    )
    source_fingerprint: str | None = Field(
        default=None, alias="sourceFingerprint", min_length=8, max_length=128
    )
    source_refs: list[SnapshotSourceRef] = Field(default_factory=list, alias="sourceRefs")
    quality_warnings: list[str] = Field(
        default_factory=list, alias="qualityWarnings", max_length=12
    )
    required: bool = True
    priority: Literal[1, 2, 3] = 2
    candidate_keywords: list[str] = Field(
        default_factory=list, alias="candidateKeywords"
    )
    aliases: dict[str, list[str]] = Field(default_factory=dict)
    required_concepts: list[str] = Field(
        default_factory=list, alias="requiredConcepts"
    )
    nli_hypotheses: list[str] = Field(
        alias="nliHypotheses", min_length=1, max_length=3
    )
    negative_hints: list[str] = Field(default_factory=list, alias="negativeHints")
    target_element_ids: list[str] = Field(
        default_factory=list, alias="targetElementIds"
    )
    trigger_action_ids: list[str] = Field(
        default_factory=list, alias="triggerActionIds"
    )


class SnapshotSlide(StrictApiModel):
    slide_id: str = Field(alias="slideId", min_length=1)
    order: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=240)
    estimated_seconds: int = Field(alias="estimatedSeconds", ge=1)
    keywords: list[SnapshotKeyword] = Field(default_factory=list)
    semantic_cues: list[SnapshotSemanticCue] = Field(
        default_factory=list, alias="semanticCues"
    )

    @model_validator(mode="after")
    def validate_cue_slide_ids(self) -> SnapshotSlide:
        if any(cue.slide_id != self.slide_id for cue in self.semantic_cues):
            raise ValueError("semantic cue must reference its containing slide")
        return self


class SnapshotPronunciationAlias(StrictApiModel):
    text: str = Field(min_length=1)
    normalized_text: str = Field(alias="normalizedText", min_length=1)
    origin: Literal[
        "static",
        "domain",
        "rule",
        "existing-keyword",
        "existing-semantic-cue",
        "llm",
        "user",
    ]
    confidence: float = Field(ge=0, le=1)
    enabled: bool


class SnapshotPronunciationOccurrence(StrictApiModel):
    slide_id: str = Field(alias="slideId", min_length=1)
    sentence_id: str | None = Field(default=None, alias="sentenceId", min_length=1)
    start: int = Field(ge=0)
    end: int = Field(gt=0)


class SnapshotPronunciationEntry(StrictApiModel):
    id: str = Field(min_length=1)
    source_text: str = Field(alias="sourceText", min_length=1)
    normalized_source: str = Field(alias="normalizedSource", min_length=1)
    canonical_text: str = Field(alias="canonicalText", min_length=1)
    canonical_key: str = Field(alias="canonicalKey", min_length=1)
    category: Literal["acronym", "word", "product", "numeric-symbol", "mixed"]
    aliases: list[SnapshotPronunciationAlias] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    status: Literal["active", "needs-review", "disabled"]
    script_occurrences: list[SnapshotPronunciationOccurrence] = Field(
        alias="scriptOccurrences",
        min_length=1,
    )


class SnapshotPronunciationLexicon(StrictApiModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    generator_version: str = Field(alias="generatorVersion", min_length=1)
    deck_id: str = Field(alias="deckId", min_length=1)
    deck_version: int = Field(alias="deckVersion", ge=1)
    source_hash: str = Field(alias="sourceHash", pattern=r"^[a-f0-9]{16}$")
    entries: list[SnapshotPronunciationEntry] = Field(default_factory=list)


class EvaluationSnapshot(StrictApiModel):
    deck_id: str = Field(alias="deckId", min_length=1)
    deck_version: int = Field(alias="deckVersion", ge=1)
    deck_content_hash: str | None = Field(
        default=None,
        alias="deckContentHash",
        min_length=1,
    )
    captured_at: str = Field(alias="capturedAt", min_length=1)
    slides: list[SnapshotSlide] = Field(default_factory=list)
    evaluation_plan: dict[str, Any] | None = Field(
        default=None,
        alias="evaluationPlan",
    )
    focus_profile_snapshot: dict[str, Any] | None = Field(
        default=None,
        alias="focusProfileSnapshot",
    )
    pronunciation_lexicon: SnapshotPronunciationLexicon | None = Field(
        default=None,
        alias="pronunciationLexicon",
    )


class SemanticTranscriptSegment(StrictApiModel):
    start_ms: float = Field(alias="startMs", ge=0)
    end_ms: float = Field(alias="endMs", ge=0)
    text: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_range(self) -> SemanticTranscriptSegment:
        if self.end_ms < self.start_ms:
            raise ValueError("segment endMs must be greater than or equal to startMs")
        return self


class SemanticSlideTimelineEntry(StrictApiModel):
    slide_id: str = Field(alias="slideId", min_length=1)
    entered_at_ms: float = Field(alias="enteredAtMs", ge=0)
    exited_at_ms: float | None = Field(default=None, alias="exitedAtMs", ge=0)

    @model_validator(mode="after")
    def validate_range(self) -> SemanticSlideTimelineEntry:
        if self.exited_at_ms is not None and self.exited_at_ms <= self.entered_at_ms:
            raise ValueError("timeline exitedAtMs must be greater than enteredAtMs")
        return self


class ProvisionalSemanticDecision(StrictApiModel):
    slide_id: str = Field(alias="slideId", min_length=1)
    cue_id: str = Field(alias="cueId", min_length=1)
    label: Literal["covered", "partial", "not_covered", "contradicted"]
    final_score: float = Field(alias="finalScore", ge=0, le=1)
    embedding_score: float | None = Field(default=None, alias="embeddingScore")
    lexical_score: float | None = Field(default=None, alias="lexicalScore", ge=0, le=1)
    concept_coverage: float | None = Field(
        default=None, alias="conceptCoverage", ge=0, le=1
    )
    entailment_score: float | None = Field(
        default=None, alias="entailmentScore", ge=0, le=1
    )
    neutral_score: float | None = Field(
        default=None, alias="neutralScore", ge=0, le=1
    )
    contradiction_score: float | None = Field(
        default=None, alias="contradictionScore", ge=0, le=1
    )
    premise: str | None = Field(default=None, max_length=600)
    hypothesis: str | None = Field(default=None, max_length=300)
    matched_by: Literal["lexical", "alias", "embedding", "nli"] = Field(
        default="nli", alias="matchedBy"
    )
    measurement_mode: SemanticMeasurementMode = Field(
        default="full", alias="measurementMode"
    )
    fallback_used: bool = Field(default=False, alias="fallbackUsed")
    fallback_reason: SemanticFallbackReason | None = Field(
        default=None, alias="fallbackReason"
    )
    provider: Literal["browser-transformersjs", "browser-onnx", "mock"] | None = None
    model_id: str | None = Field(default=None, alias="modelId")
    reason_codes: list[str] = Field(alias="reasonCodes", min_length=1, max_length=12)
    at: str | None = None


class SemanticCapabilityEventInput(StrictApiModel):
    event_id: str = Field(alias="eventId", min_length=1)
    capability: Literal[
        "stt",
        "semantic_runtime",
        "embedding",
        "nli",
        "server_evaluation",
        "cue_freshness",
        "transcript_evidence",
    ]
    from_state: Literal["available", "degraded", "unavailable"] | None = Field(
        alias="fromState"
    )
    to_state: Literal["available", "degraded", "unavailable"] = Field(
        alias="toState"
    )
    reason: SemanticFallbackReason | None = None
    measurement_mode: SemanticMeasurementMode = Field(alias="measurementMode")
    retryable: bool
    slide_id: str | None = Field(default=None, alias="slideId")
    cue_ids: list[str] = Field(default_factory=list, alias="cueIds", max_length=50)
    provider: str | None = None
    latency_ms: float | None = Field(default=None, alias="latencyMs", ge=0)
    at: str = Field(min_length=1)


class AnalyzeSemanticCuesRequest(StrictApiModel):
    run_id: str = Field(alias="runId", min_length=1)
    evaluation_snapshot: EvaluationSnapshot = Field(alias="evaluationSnapshot")
    segments: list[SemanticTranscriptSegment] = Field(default_factory=list)
    slide_timeline: list[SemanticSlideTimelineEntry] = Field(
        default_factory=list, alias="slideTimeline"
    )
    provisional_decisions: list[ProvisionalSemanticDecision] = Field(
        default_factory=list, alias="provisionalDecisions"
    )
    capability_events: list[SemanticCapabilityEventInput] = Field(
        default_factory=list, alias="capabilityEvents", max_length=100
    )


class SemanticOutcomeEvidence(StrictApiModel):
    excerpt: str = Field(min_length=1, max_length=300)
    start_ms: float = Field(alias="startMs", ge=0)
    end_ms: float = Field(alias="endMs", ge=0)


class SemanticCueOutcome(StrictApiModel):
    slide_id: str = Field(alias="slideId")
    cue_id: str = Field(alias="cueId")
    cue_revision: int = Field(alias="cueRevision", ge=1)
    cue_meaning_snapshot: str = Field(alias="cueMeaningSnapshot", min_length=1, max_length=240)
    report_label_snapshot: str = Field(
        alias="reportLabelSnapshot", min_length=1, max_length=80
    )
    importance: Literal["core", "supporting", "optional"]
    status: SemanticOutcomeStatus
    confidence: float | None = Field(default=None, ge=0, le=1)
    matched_by: (
        Literal["lexical", "alias", "embedding", "nli", "post_run_semantic"] | None
    ) = Field(default=None, alias="matchedBy")
    measurement_mode: SemanticMeasurementMode = Field(alias="measurementMode")
    fallback_used: bool = Field(alias="fallbackUsed")
    fallback_reason: SemanticFallbackReason | None = Field(
        default=None, alias="fallbackReason"
    )
    unmeasured_reason: SemanticFallbackReason | None = Field(
        default=None, alias="unmeasuredReason"
    )
    evidence: SemanticOutcomeEvidence | None = None
    covered_concepts: list[str] = Field(
        default_factory=list, alias="coveredConcepts", max_length=24
    )
    missing_concepts: list[str] = Field(
        default_factory=list, alias="missingConcepts", max_length=24
    )
    feedback: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def validate_measurement_contract(self) -> SemanticCueOutcome:
        if self.status == "unmeasured" and (
            self.measurement_mode != "none" or self.unmeasured_reason is None
        ):
            raise ValueError("unmeasured outcome requires mode none and reason")
        if self.status == "excluded" and (
            self.measurement_mode != "none" or self.evidence is not None
        ):
            raise ValueError("excluded outcome requires mode none without evidence")
        if self.status == "missed" and self.measurement_mode != "full":
            raise ValueError("missed outcome requires full measurement")
        if self.fallback_used and self.fallback_reason is None:
            raise ValueError("fallback outcome requires fallbackReason")
        if self.measurement_mode == "basic" and self.status not in {
            "covered",
            "partial",
        }:
            raise ValueError("basic measurement only supports positive outcomes")
        return self


class SemanticEvaluation(StrictApiModel):
    state: Literal["succeeded", "partial", "unavailable"]
    measurement_mode: SemanticMeasurementMode = Field(alias="measurementMode")
    reasons: list[SemanticFallbackReason] = Field(default_factory=list, max_length=20)
    retryable: bool


class AnalyzeSemanticCuesResponse(StrictApiModel):
    semantic_evaluation: SemanticEvaluation = Field(alias="semanticEvaluation")
    semantic_cue_outcomes: list[SemanticCueOutcome] = Field(alias="semanticCueOutcomes")


@dataclass(frozen=True)
class SemanticGraderInput:
    cue_id: str
    meaning: str
    required_concepts: list[str]
    hypotheses: list[str]
    negative_hints: list[str]
    segments: list[SemanticTranscriptSegment]


@dataclass(frozen=True)
class SemanticGraderDecision:
    cue_id: str
    status: Literal["covered", "partial", "missed", "needs_confirmation"]
    confidence: float
    covered_concepts: list[str]
    missing_concepts: list[str]
    evidence_segment_index: int | None


class SemanticGrader(Protocol):
    def grade(self, inputs: list[SemanticGraderInput]) -> list[SemanticGraderDecision]:
        pass


class SemanticGraderError(RuntimeError):
    def __init__(self, reason: SemanticFallbackReason) -> None:
        super().__init__(reason)
        self.reason = reason


class _GraderDecisionPayload(StrictApiModel):
    cue_id: str = Field(alias="cueId")
    status: Literal["covered", "partial", "missed", "needs_confirmation"]
    confidence: float = Field(ge=0, le=1)
    covered_concepts: list[str] = Field(alias="coveredConcepts", max_length=24)
    missing_concepts: list[str] = Field(alias="missingConcepts", max_length=24)
    evidence_segment_index: int | None = Field(alias="evidenceSegmentIndex", ge=0)


class _GraderResponsePayload(StrictApiModel):
    outcomes: list[_GraderDecisionPayload]


SEMANTIC_GRADER_INSTRUCTIONS = """
You are ORBIT's post-run presentation semantic evaluator.
Evaluate only whether the speaker conveyed each requested cue using the supplied slide
segments. Return one outcome for every cueId. Use covered when the required meaning is
clearly conveyed, partial when only part is conveyed, missed only when evaluation is
complete and evidence is absent, and needs_confirmation when evidence conflicts or is
too ambiguous. negativeHints are plausible incompatible claims: use them to reject close
false positives, but do not penalize a complete correct explanation merely because it mentions
the same topic. Select at most one supplied segment index as best evidence. Do not add coaching
or change cue identity.
""".strip()

SEMANTIC_GRADER_RESPONSE_FORMAT: dict[str, Any] = {
    "format": {
        "type": "json_schema",
        "name": "rehearsal_semantic_evaluation",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "outcomes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "cueId": {"type": "string"},
                            "status": {
                                "type": "string",
                                "enum": [
                                    "covered",
                                    "partial",
                                    "missed",
                                    "needs_confirmation",
                                ],
                            },
                            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                            "coveredConcepts": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "missingConcepts": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "evidenceSegmentIndex": {
                                "type": ["integer", "null"],
                                "minimum": 0,
                            },
                        },
                        "required": [
                            "cueId",
                            "status",
                            "confidence",
                            "coveredConcepts",
                            "missingConcepts",
                            "evidenceSegmentIndex",
                        ],
                    },
                }
            },
            "required": ["outcomes"],
        },
    }
}


class OpenAISemanticGrader:
    def __init__(
        self,
        *,
        model: str,
        api_key: str | None,
        client: Any | None = None,
    ) -> None:
        self.model = model
        self.api_key = api_key
        self.client = client

    def grade(self, inputs: list[SemanticGraderInput]) -> list[SemanticGraderDecision]:
        if not inputs:
            return []
        if self.client is None and not self.api_key:
            raise SemanticGraderError("provider_unavailable")

        client: Any = self.client
        if client is None:
            from openai import OpenAI

            client = OpenAI(api_key=self.api_key)

        safe_payload = [
            {
                "cueId": item.cue_id,
                "meaning": item.meaning,
                "requiredConcepts": item.required_concepts,
                "hypotheses": item.hypotheses,
                "negativeHints": item.negative_hints,
                "segments": [
                    {"index": index, "text": segment.text}
                    for index, segment in enumerate(item.segments)
                ],
            }
            for item in inputs
        ]
        try:
            response = client.responses.create(
                model=self.model,
                instructions=SEMANTIC_GRADER_INSTRUCTIONS,
                input=json.dumps(safe_payload, ensure_ascii=False),
                text=SEMANTIC_GRADER_RESPONSE_FORMAT,
            )
        except Exception as error:
            if (
                isinstance(error, TimeoutError)
                or "timeout" in type(error).__name__.casefold()
            ):
                raise SemanticGraderError("timeout") from None
            raise SemanticGraderError("runtime_error") from None

        output_text = str(getattr(response, "output_text", "")).strip()
        if not output_text:
            raise SemanticGraderError("provider_unavailable")
        try:
            payload = _GraderResponsePayload.model_validate_json(output_text)
        except Exception:
            raise SemanticGraderError("provider_unavailable") from None

        requested_ids = {item.cue_id for item in inputs}
        returned_ids = [outcome.cue_id for outcome in payload.outcomes]
        if (
            len(returned_ids) != len(set(returned_ids))
            or set(returned_ids) != requested_ids
        ):
            raise SemanticGraderError("provider_unavailable")

        return [
            SemanticGraderDecision(
                cue_id=outcome.cue_id,
                status=outcome.status,
                confidence=outcome.confidence,
                covered_concepts=_compact_strings(outcome.covered_concepts, 24, 120),
                missing_concepts=_compact_strings(outcome.missing_concepts, 24, 120),
                evidence_segment_index=outcome.evidence_segment_index,
            )
            for outcome in payload.outcomes
        ]


@dataclass(frozen=True)
class _TimelineRange:
    slide_id: str
    start_ms: float
    end_ms: float


@dataclass(frozen=True)
class _PendingGraderCue:
    outcome_index: int
    cue: SnapshotSemanticCue
    segments: list[SemanticTranscriptSegment]


def analyze_semantic_cues(
    request: AnalyzeSemanticCuesRequest,
    *,
    grader: SemanticGrader,
) -> AnalyzeSemanticCuesResponse:
    del request.provisional_decisions
    segments_by_slide = _align_segments_to_slides(request.segments, request.slide_timeline)
    visited_slides = {entry.slide_id for entry in request.slide_timeline}
    outcomes: list[SemanticCueOutcome | None] = []
    pending: list[_PendingGraderCue] = []

    for slide in request.evaluation_snapshot.slides:
        slide_segments = segments_by_slide.get(slide.slide_id, [])
        for cue in slide.semantic_cues:
            outcome_index = len(outcomes)
            if cue.review_status == "excluded":
                outcomes.append(_excluded_outcome(cue))
                continue
            if cue.freshness == "stale":
                outcomes.append(_unmeasured_outcome(cue, "stale_cue"))
                continue
            if slide.slide_id not in visited_slides:
                outcomes.append(_unmeasured_outcome(cue, "slide_not_visited"))
                continue

            transcript_reason = _transcript_blocking_reason(
                request.capability_events, slide.slide_id, cue.cue_id
            )
            if not slide_segments:
                outcomes.append(
                    _unmeasured_outcome(cue, transcript_reason or "no_transcript")
                )
                continue
            if transcript_reason is not None:
                outcomes.append(_unmeasured_outcome(cue, transcript_reason))
                continue

            provider_reason = _provider_blocking_reason(
                request.capability_events, slide.slide_id, cue.cue_id
            )
            if provider_reason is not None:
                outcomes.append(
                    _unmeasured_outcome(
                        cue,
                        provider_reason,
                        fallback_used=True,
                    )
                )
                continue

            outcomes.append(None)
            pending.append(
                _PendingGraderCue(
                    outcome_index=outcome_index,
                    cue=cue,
                    segments=slide_segments,
                )
            )

    if pending:
        grader_inputs = [
            SemanticGraderInput(
                cue_id=item.cue.cue_id,
                meaning=item.cue.meaning,
                required_concepts=_concepts(item.cue),
                hypotheses=item.cue.nli_hypotheses,
                negative_hints=item.cue.negative_hints,
                segments=item.segments,
            )
            for item in pending
        ]
        try:
            decisions = grader.grade(grader_inputs)
            decision_by_id = {decision.cue_id: decision for decision in decisions}
            if len(decision_by_id) != len(decisions):
                raise SemanticGraderError("provider_unavailable")
            for item in pending:
                decision = decision_by_id.get(item.cue.cue_id)
                outcomes[item.outcome_index] = (
                    _full_outcome(item.cue, item.segments, decision)
                    if decision is not None
                    else _unmeasured_outcome(
                        item.cue,
                        "provider_unavailable",
                        fallback_used=True,
                    )
                )
        except SemanticGraderError as error:
            for item in pending:
                outcomes[item.outcome_index] = _unmeasured_outcome(
                    item.cue,
                    error.reason,
                    fallback_used=True,
                )

    completed_outcomes = [outcome for outcome in outcomes if outcome is not None]
    if len(completed_outcomes) != len(outcomes):
        raise RuntimeError("semantic evaluator did not produce one outcome per reviewed cue")

    return AnalyzeSemanticCuesResponse(
        semanticEvaluation=_semantic_evaluation(completed_outcomes),
        semanticCueOutcomes=completed_outcomes,
    )


def _align_segments_to_slides(
    segments: list[SemanticTranscriptSegment],
    timeline: list[SemanticSlideTimelineEntry],
) -> dict[str, list[SemanticTranscriptSegment]]:
    ranges = _timeline_ranges(timeline)
    result: dict[str, list[SemanticTranscriptSegment]] = {}
    for segment in sorted(segments, key=lambda item: (item.start_ms, item.end_ms)):
        best_range: _TimelineRange | None = None
        best_overlap = 0.0
        for candidate in ranges:
            overlap = min(segment.end_ms, candidate.end_ms) - max(
                segment.start_ms, candidate.start_ms
            )
            if segment.start_ms == segment.end_ms:
                overlap = (
                    1.0
                    if candidate.start_ms <= segment.start_ms < candidate.end_ms
                    else 0.0
                )
            if overlap > best_overlap:
                best_overlap = overlap
                best_range = candidate
        if best_range is not None:
            result.setdefault(best_range.slide_id, []).append(segment)
    return result


def _timeline_ranges(
    timeline: list[SemanticSlideTimelineEntry],
) -> list[_TimelineRange]:
    ordered = sorted(timeline, key=lambda item: item.entered_at_ms)
    result: list[_TimelineRange] = []
    for index, entry in enumerate(ordered):
        next_entry = ordered[index + 1] if index + 1 < len(ordered) else None
        end_ms = entry.exited_at_ms
        if end_ms is None:
            end_ms = next_entry.entered_at_ms if next_entry is not None else math.inf
        result.append(
            _TimelineRange(
                slide_id=entry.slide_id,
                start_ms=entry.entered_at_ms,
                end_ms=end_ms,
            )
        )
    return result


def _concepts(cue: SnapshotSemanticCue) -> list[str]:
    return _compact_strings(
        cue.required_concepts or cue.candidate_keywords,
        24,
        120,
    )


def _match_concepts(
    concepts: list[str],
    aliases: dict[str, list[str]],
    segments: list[SemanticTranscriptSegment],
) -> list[tuple[str, str, bool]]:
    transcript = " ".join(segment.text for segment in segments)
    matches: list[tuple[str, str, bool]] = []
    for concept in concepts:
        terms = [concept, *aliases.get(concept, [])]
        matched_term = next((term for term in terms if _contains_term(transcript, term)), "")
        matches.append((concept, matched_term or concept, bool(matched_term)))
    return matches


def _contains_term(text: str, term: str) -> bool:
    normalized_text = _normalize_text(text)
    normalized_term = _normalize_text(term)
    if not normalized_term:
        return False
    if re.fullmatch(r"[a-z0-9 _-]+", normalized_term):
        return bool(
            re.search(
                rf"(?<![a-z0-9]){re.escape(normalized_term)}(?![a-z0-9])",
                normalized_text,
            )
        )
    return normalized_term in normalized_text


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value).casefold()).strip()


def _base_outcome(cue: SnapshotSemanticCue) -> dict[str, Any]:
    label = _normalize_excerpt(cue.report_label or cue.presenter_tag or cue.meaning, 80)
    return {
        "slideId": cue.slide_id,
        "cueId": cue.cue_id,
        "cueRevision": cue.revision,
        "cueMeaningSnapshot": cue.meaning,
        "reportLabelSnapshot": label,
        "importance": cue.importance,
    }


def _excluded_outcome(cue: SnapshotSemanticCue) -> SemanticCueOutcome:
    return SemanticCueOutcome(
        **_base_outcome(cue),
        status="excluded",
        measurementMode="none",
        fallbackUsed=False,
        coveredConcepts=[],
        missingConcepts=[],
    )


def _unmeasured_outcome(
    cue: SnapshotSemanticCue,
    reason: SemanticFallbackReason,
    *,
    fallback_used: bool = False,
) -> SemanticCueOutcome:
    return SemanticCueOutcome(
        **_base_outcome(cue),
        status="unmeasured",
        measurementMode="none",
        fallbackUsed=fallback_used,
        fallbackReason=reason if fallback_used else None,
        unmeasuredReason=reason,
        coveredConcepts=[],
        missingConcepts=_concepts(cue),
    )


def _basic_outcome(
    cue: SnapshotSemanticCue,
    *,
    covered: list[str],
    missing: list[str],
    matched_by: Literal["lexical", "alias"],
    segments: list[SemanticTranscriptSegment],
    matched_terms: list[str],
) -> SemanticCueOutcome:
    evidence_segment = max(
        segments,
        key=lambda segment: sum(
            1 for term in matched_terms if _contains_term(segment.text, term)
        ),
    )
    confidence = len(covered) / max(len(covered) + len(missing), 1)
    return SemanticCueOutcome(
        **_base_outcome(cue),
        status="covered" if not missing else "partial",
        confidence=confidence,
        matchedBy=matched_by,
        measurementMode="basic",
        fallbackUsed=False,
        evidence=_evidence(evidence_segment),
        coveredConcepts=covered,
        missingConcepts=missing,
    )


def _full_outcome(
    cue: SnapshotSemanticCue,
    segments: list[SemanticTranscriptSegment],
    decision: SemanticGraderDecision,
) -> SemanticCueOutcome:
    if decision.status == "needs_confirmation":
        return _unmeasured_outcome(
            cue,
            "needs_confirmation",
            fallback_used=True,
        )

    evidence = None
    if (
        decision.status in {"covered", "partial"}
        and decision.evidence_segment_index is not None
        and 0 <= decision.evidence_segment_index < len(segments)
    ):
        evidence = _evidence(segments[decision.evidence_segment_index])

    return SemanticCueOutcome(
        **_base_outcome(cue),
        status=decision.status,
        confidence=max(0.0, min(decision.confidence, 1.0)),
        matchedBy="post_run_semantic",
        measurementMode="full",
        fallbackUsed=False,
        evidence=evidence,
        coveredConcepts=_compact_strings(decision.covered_concepts, 24, 120),
        missingConcepts=_compact_strings(decision.missing_concepts, 24, 120),
    )


def _evidence(segment: SemanticTranscriptSegment) -> SemanticOutcomeEvidence:
    return SemanticOutcomeEvidence(
        excerpt=_normalize_excerpt(segment.text, 300),
        startMs=segment.start_ms,
        endMs=segment.end_ms,
    )


def _normalize_excerpt(value: str, max_length: int) -> str:
    normalized = re.sub(r"\s+", " ", unicodedata.normalize("NFC", value)).strip()
    return normalized[:max_length]


def _compact_strings(values: list[str], max_items: int, max_length: int) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = _normalize_excerpt(value, max_length)
        key = normalized.casefold()
        if not normalized or key in seen:
            continue
        seen.add(key)
        result.append(normalized)
        if len(result) >= max_items:
            break
    return result


def _transcript_blocking_reason(
    events: list[SemanticCapabilityEventInput],
    slide_id: str,
    cue_id: str,
) -> SemanticFallbackReason | None:
    allowed: set[SemanticFallbackReason] = {
        "user_disabled",
        "permission_denied",
        "stt_unavailable",
        "transcript_incomplete",
        "no_transcript",
        "queue_dropped",
    }
    return _latest_relevant_reason(
        events,
        slide_id,
        cue_id,
        capabilities={"stt", "transcript_evidence"},
        allowed=allowed,
    )


def _provider_blocking_reason(
    events: list[SemanticCapabilityEventInput],
    slide_id: str,
    cue_id: str,
) -> SemanticFallbackReason | None:
    allowed: set[SemanticFallbackReason] = {
        "network_error",
        "provider_unavailable",
        "model_not_ready",
        "model_load_failed",
        "timeout",
        "runtime_error",
        "server_evaluation_failed",
    }
    return _latest_relevant_reason(
        events,
        slide_id,
        cue_id,
        capabilities={"semantic_runtime", "embedding", "nli", "server_evaluation"},
        allowed=allowed,
    )


def _latest_relevant_reason(
    events: list[SemanticCapabilityEventInput],
    slide_id: str,
    cue_id: str,
    *,
    capabilities: set[str],
    allowed: set[SemanticFallbackReason],
) -> SemanticFallbackReason | None:
    for event in reversed(events):
        if event.capability not in capabilities or event.to_state == "available":
            continue
        if event.reason not in allowed:
            continue
        if event.cue_ids and cue_id not in event.cue_ids:
            continue
        if event.slide_id is not None and event.slide_id != slide_id:
            continue
        return event.reason
    return None


def _semantic_evaluation(outcomes: list[SemanticCueOutcome]) -> SemanticEvaluation:
    reasons = _dedupe_reasons(
        [
            outcome.unmeasured_reason
            for outcome in outcomes
            if outcome.status == "unmeasured" and outcome.unmeasured_reason is not None
        ]
    )
    measured_count = sum(
        outcome.status in {"covered", "partial", "missed"} for outcome in outcomes
    )
    unmeasured_count = sum(outcome.status == "unmeasured" for outcome in outcomes)
    if unmeasured_count > 0:
        state: Literal["succeeded", "partial", "unavailable"] = (
            "partial" if measured_count > 0 else "unavailable"
        )
    else:
        state = "succeeded"

    if any(outcome.measurement_mode == "full" for outcome in outcomes):
        measurement_mode: SemanticMeasurementMode = "full"
    elif any(outcome.measurement_mode == "basic" for outcome in outcomes):
        measurement_mode = "basic"
    else:
        measurement_mode = "none"

    retryable_reasons: set[SemanticFallbackReason] = {
        "network_error",
        "provider_unavailable",
        "model_not_ready",
        "model_load_failed",
        "timeout",
        "runtime_error",
        "server_evaluation_failed",
    }
    return SemanticEvaluation(
        state=state,
        measurementMode=measurement_mode,
        reasons=reasons,
        retryable=any(reason in retryable_reasons for reason in reasons),
    )


def _dedupe_reasons(
    values: list[SemanticFallbackReason],
) -> list[SemanticFallbackReason]:
    result: list[SemanticFallbackReason] = []
    for value in values:
        if value not in result:
            result.append(value)
    return result[:20]
