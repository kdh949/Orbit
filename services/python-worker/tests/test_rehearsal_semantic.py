from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

import app.main as api_module
from app.config import load_config
from app.semantic_rehearsal import (
    AnalyzeSemanticCuesRequest,
    OpenAISemanticGrader,
    SemanticGraderDecision,
    SemanticGraderError,
    SemanticGraderInput,
    analyze_semantic_cues,
)
from tests.test_config import VALID_ENV


class FakeGrader:
    def __init__(
        self,
        decisions: list[SemanticGraderDecision] | None = None,
        error: SemanticGraderError | None = None,
    ) -> None:
        self.decisions = decisions or []
        self.error = error
        self.inputs: list[SemanticGraderInput] = []

    def grade(self, inputs: list[SemanticGraderInput]) -> list[SemanticGraderDecision]:
        self.inputs = inputs
        if self.error is not None:
            raise self.error
        return self.decisions


def test_exact_alias_evidence_still_requires_full_semantic_grader() -> None:
    grader = FakeGrader(
        [
            SemanticGraderDecision(
                cue_id="scue_alias",
                status="covered",
                confidence=0.95,
                covered_concepts=["ORBIT"],
                missing_concepts=[],
                evidence_segment_index=0,
            )
        ]
    )
    request = semantic_request(
        slides=[
            snapshot_slide(
                "slide_1",
                cues=[
                    snapshot_cue(
                        "scue_alias",
                        "slide_1",
                        required_concepts=["ORBIT"],
                        aliases={"ORBIT": ["오르빗"]},
                    )
                ],
            )
        ],
        segments=[{"startMs": 500, "endMs": 2_000, "text": "오르빗을 소개합니다"}],
        timeline=[{"slideId": "slide_1", "enteredAtMs": 0, "exitedAtMs": 3_000}],
    )

    response = analyze_semantic_cues(request, grader=grader)

    assert len(grader.inputs) == 1
    assert response.semantic_evaluation.state == "succeeded"
    assert response.semantic_evaluation.measurement_mode == "full"
    outcome = response.semantic_cue_outcomes[0]
    assert outcome.status == "covered"
    assert outcome.matched_by == "post_run_semantic"
    assert outcome.measurement_mode == "full"
    assert outcome.covered_concepts == ["ORBIT"]
    assert outcome.missing_concepts == []
    assert outcome.evidence is not None
    assert outcome.evidence.excerpt == "오르빗을 소개합니다"


def test_alias_match_does_not_hide_contradicting_meaning() -> None:
    grader = FakeGrader(
        [
            SemanticGraderDecision(
                cue_id="scue_api_improvement",
                status="missed",
                confidence=0.97,
                covered_concepts=["API"],
                missing_concepts=["응답 시간 개선"],
                evidence_segment_index=None,
            )
        ]
    )
    request = semantic_request(
        slides=[
            snapshot_slide(
                "slide_1",
                cues=[
                    snapshot_cue(
                        "scue_api_improvement",
                        "slide_1",
                        required_concepts=["API", "응답 시간 개선"],
                        aliases={"API": ["에이피아이"]},
                        negative_hints=["API 응답 시간이 악화되었다"],
                    )
                ],
            )
        ],
        segments=[
            {
                "startMs": 0,
                "endMs": 2_000,
                "text": "에이피아이 응답 시간을 악화시켰습니다",
            }
        ],
        timeline=[{"slideId": "slide_1", "enteredAtMs": 0, "exitedAtMs": 3_000}],
    )

    response = analyze_semantic_cues(request, grader=grader)

    assert len(grader.inputs) == 1
    assert response.semantic_cue_outcomes[0].status == "missed"
    assert response.semantic_cue_outcomes[0].measurement_mode == "full"


def test_semantic_grader_produces_full_canonical_outcome() -> None:
    grader = FakeGrader(
        [
            SemanticGraderDecision(
                cue_id="scue_semantic",
                status="covered",
                confidence=0.92,
                covered_concepts=["반복 업무 자동화"],
                missing_concepts=[],
                evidence_segment_index=0,
            )
        ]
    )
    request = semantic_request(
        slides=[
            snapshot_slide(
                "slide_1",
                cues=[
                    snapshot_cue(
                        "scue_semantic",
                        "slide_1",
                        required_concepts=["반복 업무 자동화"],
                        negative_hints=[
                            "발표자는 반복 업무를 계속 사람이 처리한다고 설명했다"
                        ],
                    )
                ],
            )
        ],
        segments=[
            {
                "startMs": 0,
                "endMs": 2_000,
                "text": "사람이 하던 정기 작업을 시스템이 대신 처리합니다",
            }
        ],
        timeline=[{"slideId": "slide_1", "enteredAtMs": 0, "exitedAtMs": 3_000}],
    )

    response = analyze_semantic_cues(request, grader=grader)

    assert len(grader.inputs) == 1
    assert grader.inputs[0].negative_hints == [
        "발표자는 반복 업무를 계속 사람이 처리한다고 설명했다"
    ]
    outcome = response.semantic_cue_outcomes[0]
    assert outcome.status == "covered"
    assert outcome.matched_by == "post_run_semantic"
    assert outcome.measurement_mode == "full"
    assert outcome.confidence == 0.92
    assert response.semantic_evaluation.state == "succeeded"
    assert response.semantic_evaluation.measurement_mode == "full"


def test_provider_timeout_does_not_promote_term_evidence_to_meaning_coverage() -> None:
    grader = FakeGrader(error=SemanticGraderError("timeout"))
    request = semantic_request(
        slides=[
            snapshot_slide(
                "slide_1",
                cues=[
                    snapshot_cue(
                        "scue_exact",
                        "slide_1",
                        required_concepts=["ORBIT"],
                    ),
                    snapshot_cue(
                        "scue_ambiguous",
                        "slide_1",
                        required_concepts=["운영 효율 개선"],
                    ),
                ],
            )
        ],
        segments=[{"startMs": 0, "endMs": 2_000, "text": "ORBIT을 소개합니다"}],
        timeline=[{"slideId": "slide_1", "enteredAtMs": 0, "exitedAtMs": 3_000}],
    )

    response = analyze_semantic_cues(request, grader=grader)

    outcomes = {outcome.cue_id: outcome for outcome in response.semantic_cue_outcomes}
    assert outcomes["scue_exact"].status == "unmeasured"
    assert outcomes["scue_exact"].unmeasured_reason == "timeout"
    failed = outcomes["scue_ambiguous"]
    assert failed.status == "unmeasured"
    assert failed.unmeasured_reason == "timeout"
    assert failed.fallback_used is True
    assert failed.fallback_reason == "timeout"
    assert response.semantic_evaluation.state == "unavailable"
    assert response.semantic_evaluation.measurement_mode == "none"
    assert response.semantic_evaluation.reasons == ["timeout"]
    assert response.semantic_evaluation.retryable is True


def test_outcome_priority_never_promotes_provisional_or_unmeasured_cues() -> None:
    request = semantic_request(
        slides=[
            snapshot_slide(
                "slide_1",
                cues=[
                    snapshot_cue("scue_excluded", "slide_1", review_status="excluded")
                ],
            ),
            snapshot_slide(
                "slide_2",
                cues=[snapshot_cue("scue_stale", "slide_2", freshness="stale")],
            ),
            snapshot_slide(
                "slide_3",
                cues=[snapshot_cue("scue_unvisited", "slide_3")],
            ),
            snapshot_slide(
                "slide_4",
                cues=[snapshot_cue("scue_no_transcript", "slide_4")],
            ),
            snapshot_slide(
                "slide_5",
                cues=[snapshot_cue("scue_incomplete", "slide_5")],
            ),
        ],
        segments=[{"startMs": 20_500, "endMs": 21_000, "text": "일부 발화"}],
        timeline=[
            {"slideId": "slide_1", "enteredAtMs": 0, "exitedAtMs": 5_000},
            {"slideId": "slide_2", "enteredAtMs": 5_000, "exitedAtMs": 10_000},
            {"slideId": "slide_4", "enteredAtMs": 10_000, "exitedAtMs": 20_000},
            {"slideId": "slide_5", "enteredAtMs": 20_000, "exitedAtMs": 30_000},
        ],
        provisional_decisions=[
            {
                "slideId": "slide_4",
                "cueId": "scue_no_transcript",
                "label": "covered",
                "finalScore": 0.99,
                "matchedBy": "nli",
                "measurementMode": "full",
                "fallbackUsed": False,
                "reasonCodes": ["live-only"],
            }
        ],
        capability_events=[
            {
                "eventId": "event-incomplete",
                "capability": "transcript_evidence",
                "fromState": "available",
                "toState": "degraded",
                "reason": "transcript_incomplete",
                "measurementMode": "none",
                "retryable": False,
                "slideId": "slide_5",
                "cueIds": ["scue_incomplete"],
                "at": "2026-07-10T00:00:00.000Z",
            }
        ],
    )

    response = analyze_semantic_cues(
        request,
        grader=FakeGrader(
            [
                SemanticGraderDecision(
                    cue_id="scue_bounded",
                    status="covered",
                    confidence=0.9,
                    covered_concepts=["ORBIT"],
                    missing_concepts=[],
                    evidence_segment_index=0,
                )
            ]
        ),
    )

    outcomes = {outcome.cue_id: outcome for outcome in response.semantic_cue_outcomes}
    assert outcomes["scue_excluded"].status == "excluded"
    assert outcomes["scue_stale"].unmeasured_reason == "stale_cue"
    assert outcomes["scue_unvisited"].unmeasured_reason == "slide_not_visited"
    assert outcomes["scue_no_transcript"].unmeasured_reason == "no_transcript"
    assert outcomes["scue_incomplete"].unmeasured_reason == "transcript_incomplete"
    assert all(outcome.status != "missed" for outcome in outcomes.values())
    assert len(response.semantic_cue_outcomes) == 5


def test_full_grader_can_create_missed_only_after_complete_evaluation() -> None:
    grader = FakeGrader(
        [
            SemanticGraderDecision(
                cue_id="scue_missed",
                status="missed",
                confidence=0.88,
                covered_concepts=[],
                missing_concepts=["핵심 원인"],
                evidence_segment_index=None,
            )
        ]
    )
    request = semantic_request(
        slides=[snapshot_slide("slide_1", cues=[snapshot_cue("scue_missed", "slide_1")])],
        segments=[{"startMs": 0, "endMs": 1_000, "text": "다른 내용을 설명합니다"}],
        timeline=[{"slideId": "slide_1", "enteredAtMs": 0, "exitedAtMs": 2_000}],
    )

    response = analyze_semantic_cues(request, grader=grader)

    outcome = response.semantic_cue_outcomes[0]
    assert outcome.status == "missed"
    assert outcome.measurement_mode == "full"
    assert outcome.evidence is None


def test_evidence_excerpt_is_normalized_and_bounded() -> None:
    long_text = f"  ORBIT   {'설명 ' * 100}  "
    request = semantic_request(
        slides=[
            snapshot_slide(
                "slide_1",
                cues=[
                    snapshot_cue(
                        "scue_bounded",
                        "slide_1",
                        required_concepts=["ORBIT"],
                    )
                ],
            )
        ],
        segments=[{"startMs": 0, "endMs": 1_000, "text": long_text}],
        timeline=[{"slideId": "slide_1", "enteredAtMs": 0, "exitedAtMs": 2_000}],
    )

    response = analyze_semantic_cues(
        request,
        grader=FakeGrader(
            [
                SemanticGraderDecision(
                    cue_id="scue_bounded",
                    status="covered",
                    confidence=0.9,
                    covered_concepts=["ORBIT"],
                    missing_concepts=[],
                    evidence_segment_index=0,
                )
            ]
        ),
    )

    evidence = response.semantic_cue_outcomes[0].evidence
    assert evidence is not None
    assert len(evidence.excerpt) <= 300
    assert "  " not in evidence.excerpt


def test_segment_outside_timeline_is_not_attached_to_a_slide() -> None:
    grader = FakeGrader()
    request = semantic_request(
        slides=[snapshot_slide("slide_1", cues=[snapshot_cue("scue_1", "slide_1")])],
        segments=[{"startMs": 2_000, "endMs": 3_000, "text": "범위 밖 발화"}],
        timeline=[{"slideId": "slide_1", "enteredAtMs": 0, "exitedAtMs": 2_000}],
    )

    response = analyze_semantic_cues(request, grader=grader)

    assert grader.inputs == []
    assert response.semantic_cue_outcomes[0].unmeasured_reason == "no_transcript"


def test_empty_segment_text_is_rejected() -> None:
    payload = semantic_payload(
        slides=[snapshot_slide("slide_1", cues=[snapshot_cue("scue_1", "slide_1")])],
        segments=[{"startMs": 0, "endMs": 1_000, "text": ""}],
        timeline=[{"slideId": "slide_1", "enteredAtMs": 0, "exitedAtMs": 2_000}],
    )

    try:
        AnalyzeSemanticCuesRequest.model_validate(payload)
    except ValueError:
        pass
    else:
        raise AssertionError("empty transcript segment must be rejected")


def test_empty_provider_output_is_provider_unavailable() -> None:
    class EmptyResponseClient:
        class Responses:
            @staticmethod
            def create(**_kwargs: Any) -> Any:
                return type("Response", (), {"output_text": ""})()

        responses = Responses()

    grader = OpenAISemanticGrader(
        model="fake-model",
        api_key=None,
        client=EmptyResponseClient(),
    )
    input_ = SemanticGraderInput(
        cue_id="scue_1",
        meaning="핵심 의미",
        required_concepts=["핵심 원인"],
        hypotheses=["발표자는 핵심 원인을 설명했다"],
        negative_hints=["발표자는 핵심 원인이 없다고 설명했다"],
        segments=[
            AnalyzeSemanticCuesRequest.model_validate(
                semantic_payload(
                    slides=[],
                    segments=[{"startMs": 0, "endMs": 1_000, "text": "발화"}],
                    timeline=[],
                )
            ).segments[0]
        ],
    )

    try:
        grader.grade([input_])
    except SemanticGraderError as error:
        assert error.reason == "provider_unavailable"
    else:
        raise AssertionError("empty provider output must not become a runtime success")


def test_semantic_endpoint_uses_camel_case_contract_and_rejects_unknown_fields() -> (
    None
):
    api_module.app.state.config = load_config(VALID_ENV)
    client = TestClient(api_module.app)
    payload = semantic_payload(
        slides=[
            snapshot_slide(
                "slide_1",
                cues=[
                    snapshot_cue(
                        "scue_endpoint",
                        "slide_1",
                        required_concepts=["ORBIT"],
                    )
                ],
            )
        ],
        segments=[{"startMs": 0, "endMs": 1_000, "text": "ORBIT 설명"}],
        timeline=[{"slideId": "slide_1", "enteredAtMs": 0, "exitedAtMs": 2_000}],
    )

    response = client.post("/rehearsal/analyze-semantic-cues", json=payload)

    assert response.status_code == 200
    assert response.json()["semanticEvaluation"] == {
        "state": "unavailable",
        "measurementMode": "none",
        "reasons": ["provider_unavailable"],
        "retryable": True,
    }
    assert response.json()["semanticCueOutcomes"][0]["cueId"] == "scue_endpoint"

    invalid_response = client.post(
        "/rehearsal/analyze-semantic-cues",
        json={**payload, "unexpected": "field"},
    )
    assert invalid_response.status_code == 422


def semantic_request(**patch: Any) -> AnalyzeSemanticCuesRequest:
    return AnalyzeSemanticCuesRequest.model_validate(semantic_payload(**patch))


def semantic_payload(
    *,
    slides: list[dict[str, Any]],
    segments: list[dict[str, Any]],
    timeline: list[dict[str, Any]],
    provisional_decisions: list[dict[str, Any]] | None = None,
    capability_events: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "runId": "run-semantic-1",
        "evaluationSnapshot": {
            "deckId": "deck_semantic",
            "deckVersion": 7,
            "capturedAt": "2026-07-10T00:00:00.000Z",
            "slides": slides,
        },
        "segments": segments,
        "slideTimeline": timeline,
        "provisionalDecisions": provisional_decisions or [],
        "capabilityEvents": capability_events or [],
    }


def snapshot_slide(
    slide_id: str,
    *,
    cues: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "slideId": slide_id,
        "order": int(slide_id.rsplit("_", 1)[-1]),
        "title": f"{slide_id} title",
        "estimatedSeconds": 30,
        "keywords": [],
        "semanticCues": cues,
    }


def snapshot_cue(
    cue_id: str,
    slide_id: str,
    *,
    required_concepts: list[str] | None = None,
    aliases: dict[str, list[str]] | None = None,
    negative_hints: list[str] | None = None,
    review_status: str = "approved",
    freshness: str = "current",
) -> dict[str, Any]:
    return {
        "cueId": cue_id,
        "slideId": slide_id,
        "meaning": f"{cue_id} 의미",
        "reportLabel": f"{cue_id} label",
        "importance": "core",
        "reviewStatus": review_status,
        "freshness": freshness,
        "origin": "manual",
        "revision": 1,
        "sourceRefs": [],
        "qualityWarnings": [],
        "required": True,
        "priority": 1,
        "candidateKeywords": [],
        "aliases": aliases or {},
        "requiredConcepts": required_concepts or ["핵심 원인"],
        "nliHypotheses": ["발표자는 핵심 원인을 설명했다"],
        "negativeHints": negative_hints or [],
        "targetElementIds": [],
        "triggerActionIds": [],
    }
