import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

import app.main as api_module
import app.rehearsal as rehearsal_module
from app.audio.analysis.models import RehearsalSilenceAnalysis
from app.audio.transcribe import PronunciationContextTerm, TranscriptSegment
from app.config import load_config
from app.rehearsal import (
    DeckKeyword,
    FillerWordDetail,
    RehearsalCoachingResult,
    RehearsalMetricsResult,
    SlideTimelineEntry,
    analyze_rehearsal_metrics,
    build_slide_speaking_rates,
    classify_relative_pace,
    count_speech_characters,
    generate_rehearsal_coaching,
)
from tests.test_config import VALID_ENV


P0_FIXTURE_PATH = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "shared"
    / "src"
    / "coaching"
    / "p0-core-contract.fixtures.json"
)


class FakeResponses:
    def create(self, **kwargs: object) -> object:
        return type(
            "Response",
            (),
            {
                "output_text": json.dumps(
                    {
                        "summary": "핵심 메시지가 분명합니다.",
                        "aiSummary": {
                            "headline": "핵심 메시지가 분명합니다.",
                            "paragraphs": [
                                "발표 흐름은 안정적입니다.",
                                "다음 연습에서는 도입부를 더 짧게 연습하세요.",
                            ],
                        },
                        "strengths": ["키워드를 언급했습니다."],
                        "improvements": ["불필요한 filler를 줄이세요."],
                        "nextPracticeFocus": "도입부를 더 짧게 연습하세요.",
                    }
                )
            },
        )()


def test_rehearsal_analyze_v1_request_uses_the_compatibility_fixture() -> None:
    fixtures = json.loads(P0_FIXTURE_PATH.read_text(encoding="utf-8"))

    request = api_module.RehearsalAnalyzeRequest.model_validate(
        fixtures["rehearsalAnalyzeRequestV1"]
    )

    assert request.deck_keywords[0].required is True
    assert request.language == "und"


class FakeClient:
    responses = FakeResponses()


def _measured_silence_analysis(
    segments: list[tuple[float, float]],
) -> RehearsalSilenceAnalysis:
    total_silence_seconds = sum(end - start for start, end in segments)
    window_end = max(end for _start, end in segments) + 1
    return RehearsalSilenceAnalysis(
        metricDefinitionVersion=1,
        measurementState="measured",
        reasonCode=None,
        detector="silero-vad",
        detectorVersion="test-vad",
        speechThreshold=0.5,
        minimumSilenceMs=250,
        longSilenceMs=1000,
        analysisWindowStartSeconds=0,
        analysisWindowEndSeconds=window_end,
        totalSilenceSeconds=total_silence_seconds,
        silenceRatio=total_silence_seconds / window_end,
        longSilenceCount=sum(end - start >= 1 for start, end in segments),
        detectedSegmentCount=len(segments),
        segmentsTruncated=False,
        segments=[
            {
                "category": "long" if end - start >= 1 else "brief",
                "startSeconds": start,
                "endSeconds": end,
                "durationSeconds": end - start,
            }
            for start, end in segments
        ],
    )


def test_analyze_rehearsal_metrics_counts_silences_fillers_and_keywords() -> None:
    metrics = analyze_rehearsal_metrics(
        transcript="음 오늘은 ORBIT 실시간 피드백을 설명합니다",
        duration_seconds=30,
        segments=[
            TranscriptSegment(text="음 오늘은 ORBIT", startSeconds=0, endSeconds=2),
            TranscriptSegment(text="실시간 피드백", startSeconds=3.5, endSeconds=5),
        ],
        deck_keywords=[
            DeckKeyword(
                keyword_id="kw_1",
                slide_id="slide_1",
                text="ORBIT",
                synonyms=["오르빗"],
                required=True,
            ),
            DeckKeyword(
                keyword_id="kw_2",
                slide_id="slide_1",
                text="실시간 피드백",
                required=True,
            ),
        ],
        slide_timeline=[SlideTimelineEntry(slide_id="slide_1", entered_second=0)],
        silence_analysis=_measured_silence_analysis([(2.0, 3.5)]),
    )

    assert metrics.words_per_minute == 12
    assert metrics.filler_word_count == 1
    assert metrics.long_silence_count == 1
    assert metrics.keyword_coverage == 1


def test_analyze_rehearsal_metrics_matches_korean_pronunciation_aliases() -> None:
    metrics = analyze_rehearsal_metrics(
        transcript="오픈 에이아이 에이피아이를 활용했습니다",
        duration_seconds=10,
        segments=[
            TranscriptSegment(
                text="오픈 에이아이 에이피아이를 활용했습니다",
                startSeconds=0,
                endSeconds=5,
            )
        ],
        deck_keywords=[
            DeckKeyword(
                keyword_id="kw_openai",
                slide_id="slide_1",
                text="OpenAI",
                required=True,
            ),
            DeckKeyword(
                keyword_id="kw_api",
                slide_id="slide_1",
                text="API",
                required=True,
            ),
        ],
        slide_timeline=[SlideTimelineEntry(slide_id="slide_1", entered_second=0)],
        pronunciation_context=[
            PronunciationContextTerm(source="OpenAI", aliases=["오픈에이아이"]),
            PronunciationContextTerm(source="API", aliases=["에이피아이"]),
        ],
    )

    assert metrics.keyword_coverage == 1


def test_analyze_rehearsal_metrics_builds_safe_report_details() -> None:
    metrics = analyze_rehearsal_metrics(
        transcript="음 오늘은 ORBIT 발표입니다",
        duration_seconds=30,
        segments=[
            TranscriptSegment(text="음 오늘은 ORBIT", startSeconds=0, endSeconds=2),
            TranscriptSegment(text="발표입니다", startSeconds=3.5, endSeconds=5),
        ],
        deck_keywords=[
            DeckKeyword(
                keyword_id="kw_1",
                slide_id="slide_1",
                text="ORBIT",
                required=True,
            ),
            DeckKeyword(
                keyword_id="kw_2",
                slide_id="slide_1",
                text="리포트",
                required=True,
            ),
        ],
        slide_timeline=[SlideTimelineEntry(slide_id="slide_1", entered_second=0)],
        silence_analysis=_measured_silence_analysis([(2.0, 3.5)]),
    )

    assert metrics.speed_samples[0].words_per_minute == 90
    assert metrics.filler_word_details == [FillerWordDetail(word="음", count=1)]
    assert metrics.long_silence_count == 1
    assert metrics.missed_keywords[0].keyword_id == "kw_2"
    assert metrics.keyword_coverage == 0.5


def test_required_keywords_use_only_their_slide_transcript() -> None:
    metrics = analyze_rehearsal_metrics(
        transcript="Unity를 설명합니다. 다음으로 성능을 설명합니다.",
        duration_seconds=12,
        segments=[
            TranscriptSegment(text="Unity를 설명합니다", startSeconds=0, endSeconds=3),
            TranscriptSegment(
                text="다음으로 성능을 설명합니다", startSeconds=6, endSeconds=9
            ),
        ],
        deck_keywords=[
            DeckKeyword(
                keyword_id="kw_unity",
                slide_id="slide_1",
                text="Unity",
                required=True,
            ),
            DeckKeyword(
                keyword_id="kw_performance",
                slide_id="slide_1",
                text="성능",
                required=True,
            ),
            DeckKeyword(
                keyword_id="kw_optional",
                slide_id="slide_2",
                text="Three.js",
                required=False,
            ),
        ],
        slide_timeline=[
            SlideTimelineEntry(slide_id="slide_1", entered_second=0),
            SlideTimelineEntry(slide_id="slide_2", entered_second=5),
        ],
    )

    assert metrics.keyword_coverage == 0.5
    assert [keyword.keyword_id for keyword in metrics.missed_keywords] == [
        "kw_performance"
    ]


def test_analyze_rehearsal_metrics_builds_slide_insights_from_timeline() -> None:
    metrics = analyze_rehearsal_metrics(
        transcript="음 ORBIT 소개입니다 어 다음은 실시간 피드백입니다",
        duration_seconds=12,
        segments=[
            TranscriptSegment(text="음 ORBIT 소개입니다", startSeconds=0, endSeconds=3),
            TranscriptSegment(text="어 다음은", startSeconds=4.5, endSeconds=5.5),
            TranscriptSegment(text="실시간 피드백입니다", startSeconds=6, endSeconds=8),
        ],
        deck_keywords=[],
        slide_timeline=[
            SlideTimelineEntry(slide_id="slide_1", entered_second=0),
            SlideTimelineEntry(slide_id="slide_2", entered_second=4),
        ],
        silence_analysis=_measured_silence_analysis([(3.0, 4.5)]),
    )

    assert len(metrics.slide_insights) == 2
    assert metrics.slide_insights[0].slide_id == "slide_1"
    assert metrics.slide_insights[0].filler_word_count == 1
    assert metrics.slide_insights[0].long_silence_count == 1
    assert metrics.slide_insights[1].slide_id == "slide_2"
    assert metrics.slide_insights[1].filler_word_count == 1
    assert metrics.slide_insights[1].long_silence_count == 0


def test_count_speech_characters_normalizes_nfkc_and_ignores_spacing() -> None:
    assert count_speech_characters("ＡＢＣ １２３, 가 나!") == 8


def test_build_slide_speaking_rates_aggregates_repeated_slide_visits() -> None:
    rates = build_slide_speaking_rates(
        language="ko-KR",
        duration_seconds=24,
        segments=[
            TranscriptSegment(text="가" * 20, startSeconds=0, endSeconds=5),
            TranscriptSegment(text="나" * 30, startSeconds=6, endSeconds=11),
            TranscriptSegment(text="다" * 20, startSeconds=12, endSeconds=17),
            TranscriptSegment(text="라" * 20, startSeconds=18, endSeconds=23),
        ],
        slide_timeline=[
            SlideTimelineEntry(slide_id="slide_1", entered_second=0),
            SlideTimelineEntry(slide_id="slide_2", entered_second=6),
            SlideTimelineEntry(slide_id="slide_3", entered_second=12),
            SlideTimelineEntry(slide_id="slide_1", entered_second=18),
        ],
    )

    assert list(rates) == ["slide_1", "slide_2", "slide_3"]
    assert rates["slide_1"].character_count == 40
    assert rates["slide_1"].active_speech_seconds == 10
    assert rates["slide_1"].pace_category == "similar"
    assert rates["slide_2"].pace_category == "faster"
    assert rates["slide_3"].pace_category == "similar"
    assert rates["slide_1"].baseline_characters_per_second == 4


def test_build_slide_speaking_rates_merges_overlapping_segment_intervals() -> None:
    rates = build_slide_speaking_rates(
        language="ko",
        duration_seconds=5,
        segments=[
            TranscriptSegment(text="가" * 10, startSeconds=0, endSeconds=3),
            TranscriptSegment(text="나" * 10, startSeconds=2, endSeconds=5),
        ],
        slide_timeline=[SlideTimelineEntry(slide_id="slide_1", entered_second=0)],
    )

    assert rates["slide_1"].active_speech_seconds == 5
    assert rates["slide_1"].character_count == 20
    assert rates["slide_1"].reason_code == "BASELINE_UNAVAILABLE"


def test_build_slide_speaking_rates_assigns_segment_by_midpoint() -> None:
    rates = build_slide_speaking_rates(
        language="ko",
        duration_seconds=8,
        segments=[
            TranscriptSegment(text="가" * 24, startSeconds=2, endSeconds=8),
        ],
        slide_timeline=[
            SlideTimelineEntry(slide_id="slide_1", entered_second=0),
            SlideTimelineEntry(slide_id="slide_2", entered_second=4),
        ],
    )

    assert rates["slide_1"].reason_code == "INSUFFICIENT_SLIDE_SPEECH"
    assert rates["slide_2"].reason_code == "BASELINE_UNAVAILABLE"
    assert rates["slide_2"].character_count == 24


def test_build_slide_speaking_rates_applies_minimum_evidence_boundaries() -> None:
    rates = build_slide_speaking_rates(
        language="ko-KR",
        duration_seconds=15,
        segments=[
            TranscriptSegment(text="가" * 20, startSeconds=0, endSeconds=5),
            TranscriptSegment(text="나" * 20, startSeconds=5, endSeconds=9.999),
            TranscriptSegment(text="다" * 19, startSeconds=10, endSeconds=15),
        ],
        slide_timeline=[
            SlideTimelineEntry(slide_id="exact", entered_second=0),
            SlideTimelineEntry(slide_id="short", entered_second=5),
            SlideTimelineEntry(slide_id="few", entered_second=10),
        ],
    )

    assert rates["exact"].reason_code == "BASELINE_UNAVAILABLE"
    assert rates["exact"].active_speech_seconds == 5
    assert rates["exact"].character_count == 20
    assert rates["short"].reason_code == "INSUFFICIENT_SLIDE_SPEECH"
    assert rates["short"].active_speech_seconds == 4.999
    assert rates["few"].reason_code == "INSUFFICIENT_SLIDE_SPEECH"
    assert rates["few"].character_count == 19


def test_classify_relative_pace_includes_thresholds_in_similar() -> None:
    assert classify_relative_pace(0.8499) == "slower"
    assert classify_relative_pace(0.85) == "similar"
    assert classify_relative_pace(1.15) == "similar"
    assert classify_relative_pace(1.1501) == "faster"


def test_build_slide_speaking_rates_accepts_provider_korean_language_name() -> None:
    rates = build_slide_speaking_rates(
        language="korean",
        duration_seconds=5,
        segments=[
            TranscriptSegment(text="가" * 20, startSeconds=0, endSeconds=5),
        ],
        slide_timeline=[SlideTimelineEntry(slide_id="slide_1", entered_second=0)],
    )

    assert rates["slide_1"].reason_code == "BASELINE_UNAVAILABLE"
    assert rates["slide_1"].reason_code != "UNSUPPORTED_LANGUAGE"


def test_build_slide_speaking_rates_marks_unsupported_language_unmeasured() -> None:
    rates = build_slide_speaking_rates(
        language="en-US",
        duration_seconds=3,
        segments=[
            TranscriptSegment(text="tenletters", startSeconds=0, endSeconds=3),
        ],
        slide_timeline=[SlideTimelineEntry(slide_id="slide_1", entered_second=0)],
    )

    assert rates["slide_1"].reason_code == "UNSUPPORTED_LANGUAGE"


def test_build_slide_speaking_rates_requires_segment_timestamps() -> None:
    rates = build_slide_speaking_rates(
        language="ko",
        duration_seconds=3,
        segments=[TranscriptSegment(text="가나다라마바사아자차")],
        slide_timeline=[SlideTimelineEntry(slide_id="slide_1", entered_second=0)],
    )

    assert rates["slide_1"].reason_code == "SEGMENT_TIMESTAMPS_UNAVAILABLE"


def test_build_slide_speaking_rates_requires_baseline_characters() -> None:
    rates = build_slide_speaking_rates(
        language="ko",
        duration_seconds=3,
        segments=[TranscriptSegment(text="...!", startSeconds=0, endSeconds=3)],
        slide_timeline=[SlideTimelineEntry(slide_id="slide_1", entered_second=0)],
    )

    assert rates["slide_1"].reason_code == "BASELINE_UNAVAILABLE"


def test_analyze_rehearsal_metrics_isolates_slide_speed_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_speaking_rate_analysis(**_kwargs: object) -> object:
        raise ValueError("synthetic speaking rate failure")

    monkeypatch.setattr(
        rehearsal_module,
        "build_slide_speaking_rates",
        fail_speaking_rate_analysis,
    )

    metrics = analyze_rehearsal_metrics(
        transcript="음 가나다라마바사아자차",
        language="ko",
        duration_seconds=3,
        segments=[
            TranscriptSegment(
                text="음 가나다라마바사아자차",
                startSeconds=0,
                endSeconds=3,
            ),
        ],
        deck_keywords=[],
        slide_timeline=[SlideTimelineEntry(slide_id="slide_1", entered_second=0)],
    )

    assert metrics.filler_word_count == 1
    assert metrics.slide_insights[0].speaking_rate.reason_code == (
        "BASELINE_UNAVAILABLE"
    )


def test_analyze_rehearsal_metrics_uses_segment_duration_when_total_duration_is_missing() -> (
    None
):
    metrics = analyze_rehearsal_metrics(
        transcript="하나 둘 셋 넷 다섯 여섯",
        duration_seconds=0,
        segments=[
            TranscriptSegment(text="하나 둘 셋", startSeconds=10, endSeconds=20),
            TranscriptSegment(text="넷 다섯 여섯", startSeconds=20, endSeconds=40),
        ],
        deck_keywords=[],
    )

    assert metrics.words_per_minute == 12


def test_analyze_rehearsal_metrics_does_not_inflate_speed_without_duration_data() -> (
    None
):
    metrics = analyze_rehearsal_metrics(
        transcript="하나 둘 셋 넷 다섯 여섯",
        duration_seconds=0,
        segments=[],
        deck_keywords=[],
    )

    assert metrics.words_per_minute == 0


def test_analyze_rehearsal_metrics_does_not_count_contextual_geu_as_filler() -> None:
    metrics = analyze_rehearsal_metrics(
        transcript="그 프로젝트는 음 안정적이고 그니까 다음으로 넘어가겠습니다",
        duration_seconds=30,
        segments=[],
        deck_keywords=[],
    )

    assert metrics.filler_word_count == 2
    assert metrics.filler_word_details == [
        FillerWordDetail(word="그니까", count=1),
        FillerWordDetail(word="음", count=1),
    ]


def test_analyze_rehearsal_metrics_counts_normalized_and_phrase_fillers() -> None:
    metrics = analyze_rehearsal_metrics(
        transcript="으음 오늘은 뭐 랄까 ORBIT 소개입니다 you know 핵심은 umm 자동 리포트입니다",
        duration_seconds=30,
        segments=[],
        deck_keywords=[],
    )

    assert metrics.filler_word_count == 4
    assert metrics.filler_word_details == [
        FillerWordDetail(word="um", count=1),
        FillerWordDetail(word="you know", count=1),
        FillerWordDetail(word="뭐랄까", count=1),
        FillerWordDetail(word="음", count=1),
    ]


def test_analyze_rehearsal_metrics_counts_common_korean_fillers() -> None:
    metrics = analyze_rehearsal_metrics(
        transcript="아 이제 일단 ORBIT을 소개하고 사실 뭐냐면 발표 연습을 자동화합니다",
        duration_seconds=30,
        segments=[],
        deck_keywords=[],
    )

    assert metrics.filler_word_count == 5
    assert metrics.filler_word_details == [
        FillerWordDetail(word="뭐냐면", count=1),
        FillerWordDetail(word="사실", count=1),
        FillerWordDetail(word="아", count=1),
        FillerWordDetail(word="이제", count=1),
        FillerWordDetail(word="일단", count=1),
    ]


def test_analyze_rehearsal_metrics_does_not_count_non_filler_substrings() -> None:
    metrics = analyze_rehearsal_metrics(
        transcript="음악 자료와 그 프로젝트를 설명합니다",
        duration_seconds=30,
        segments=[],
        deck_keywords=[],
    )

    assert metrics.filler_word_count == 0
    assert metrics.filler_word_details == []


def test_analyze_rehearsal_metrics_uses_vad_silence_instead_of_segment_gaps() -> None:
    metrics = analyze_rehearsal_metrics(
        transcript="첫 문장 다음 문장",
        duration_seconds=10,
        segments=[
            TranscriptSegment(text="첫 문장", startSeconds=0.5, endSeconds=1.5),
            TranscriptSegment(text="다음 문장", startSeconds=4.25, endSeconds=5.25),
        ],
        deck_keywords=[],
        silence_analysis=_measured_silence_analysis([(2.0, 3.0), (6.0, 6.5)]),
    )

    assert metrics.long_silence_count == 1


def test_analyze_rehearsal_metrics_does_not_derive_silence_from_segment_gaps() -> None:
    metrics = analyze_rehearsal_metrics(
        transcript="하나 둘 셋",
        duration_seconds=5,
        segments=[
            TranscriptSegment(text="셋", startSeconds=2.9, endSeconds=4),
            TranscriptSegment(text="하나", startSeconds=0, endSeconds=1),
            TranscriptSegment(text="겹침", startSeconds=0.5, endSeconds=1.5),
            TranscriptSegment(text="무시", startSeconds=None, endSeconds=None),
        ],
        deck_keywords=[],
    )

    assert metrics.long_silence_count is None


def test_generate_rehearsal_coaching_parses_structured_llm_response() -> None:
    coaching = generate_rehearsal_coaching(
        transcript="ORBIT 발표입니다",
        metrics=RehearsalMetricsResult(
            words_per_minute=120,
            filler_word_count=1,
            long_silence_count=0,
            keyword_coverage=1,
        ),
        client=FakeClient(),
        model="fake-model",
        api_key=None,
    )

    assert coaching.status == "succeeded"
    assert coaching.summary == "핵심 메시지가 분명합니다."
    assert coaching.ai_summary_headline == "핵심 메시지가 분명합니다."
    assert coaching.ai_summary_paragraphs == [
        "발표 흐름은 안정적입니다.",
        "다음 연습에서는 도입부를 더 짧게 연습하세요.",
    ]
    assert coaching.next_practice_focus == "도입부를 더 짧게 연습하세요."


def test_rehearsal_analyze_endpoint_returns_slide_speaking_rate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        api_module,
        "generate_rehearsal_coaching",
        lambda **_kwargs: RehearsalCoachingResult(
            status="succeeded",
            summary="발표 흐름은 안정적입니다.",
        ),
    )
    api_module.app.state.config = load_config(VALID_ENV)
    client = TestClient(api_module.app)

    response = client.post(
        "/rehearsal/analyze",
        json={
            "runId": "run-1",
            "projectId": "project-a",
            "deckId": "deck-a",
            "transcript": ("가" * 20) + ("나" * 25) + ("다" * 30),
            "language": "ko-KR",
            "durationSeconds": 18,
            "segments": [
                {"text": "가" * 20, "startSeconds": 0, "endSeconds": 5},
                {"text": "나" * 25, "startSeconds": 6, "endSeconds": 11},
                {"text": "다" * 30, "startSeconds": 12, "endSeconds": 17},
            ],
            "deckKeywords": [],
            "slideTimeline": [
                {"slideId": "slide_1", "enteredSecond": 0},
                {"slideId": "slide_2", "enteredSecond": 6},
                {"slideId": "slide_3", "enteredSecond": 12},
            ],
        },
    )

    assert response.status_code == 200
    speaking_rate = response.json()["slideInsights"][0]["speakingRate"]
    assert speaking_rate["measurementState"] == "measured"
    assert speaking_rate["paceCategory"] == "slower"
    assert speaking_rate["baselineCharactersPerSecond"] == 5


def test_rehearsal_analyze_endpoint_fails_when_coaching_is_unavailable() -> None:
    api_module.app.state.config = load_config(VALID_ENV)
    client = TestClient(api_module.app)

    response = client.post(
        "/rehearsal/analyze",
        json={
            "runId": "run-1",
            "projectId": "project-a",
            "deckId": "deck-a",
            "transcript": "어 ORBIT 발표입니다",
            "durationSeconds": 30,
            "segments": [
                {
                    "text": "어 ORBIT 발표입니다",
                    "startSeconds": 0,
                    "endSeconds": 3,
                }
            ],
            "deckKeywords": [{"text": "ORBIT"}],
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "OPENAI_API_KEY is not configured."


def test_rehearsal_analyze_endpoint_rejects_unknown_top_level_fields() -> None:
    api_module.app.state.config = load_config(VALID_ENV)
    client = TestClient(api_module.app)

    response = client.post(
        "/rehearsal/analyze",
        json={
            "runId": "run-1",
            "projectId": "project-a",
            "deckId": "deck-a",
            "transcript": "ORBIT 발표입니다",
            "durationSeconds": 30,
            "segments": [],
            "deckKeywords": [],
            "unexpectedField": "must-be-rejected",
        },
    )

    assert response.status_code == 422


def test_rehearsal_analyze_endpoint_rejects_unknown_nested_fields() -> None:
    api_module.app.state.config = load_config(VALID_ENV)
    client = TestClient(api_module.app)

    response = client.post(
        "/rehearsal/analyze",
        json={
            "runId": "run-1",
            "projectId": "project-a",
            "deckId": "deck-a",
            "transcript": "ORBIT 발표입니다",
            "durationSeconds": 30,
            "segments": [
                {
                    "text": "ORBIT 발표입니다",
                    "startSeconds": 0,
                    "endSeconds": 3,
                    "providerPayload": "must-be-rejected",
                }
            ],
            "deckKeywords": [],
        },
    )

    assert response.status_code == 422
