from __future__ import annotations

import json
import logging
import re
import unicodedata
from dataclasses import dataclass, field
from statistics import median
from typing import Any, Literal

from app.audio.analysis.models import RehearsalSilenceAnalysis
from app.audio.transcribe import PronunciationContextTerm, TranscriptSegment
from app.pronunciation import find_canonical_term_keys, normalize_pronunciation_key

logger = logging.getLogger(__name__)

FILLER_WORDS = {
    "아",
    "음",
    "어",
    "이제",
    "일단",
    "사실",
    "막",
    "그니까",
    "그니까요",
    "그러니까",
    "그러니까요",
    "저기",
    "약간",
    "뭐",
    "뭐냐면",
    "뭐랄까",
    "um",
    "uh",
    "erm",
    "like",
}

FILLER_PHRASES = {
    ("뭐", "랄까"): "뭐랄까",
    ("you", "know"): "you know",
    ("i", "mean"): "i mean",
    ("kind", "of"): "kind of",
    ("sort", "of"): "sort of",
}

SLIDE_SPEAKING_RATE_MINIMUM_SECONDS = 5.0
SLIDE_SPEAKING_RATE_MINIMUM_CHARACTERS = 20
SLIDE_SPEAKING_RATE_SLOWER_RATIO = 0.85
SLIDE_SPEAKING_RATE_FASTER_RATIO = 1.15

PROGRESS_COMMENT_INSTRUCTIONS = """
You are a Korean presentation rehearsal coach for ORBIT.
You are given a list of rehearsal sessions for the same presentation, ordered by date.
Analyze the trend in total presentation duration and identify whether the presenter is improving, declining, or staying consistent.
Return only a single concise Korean sentence (2-3 lines max) that summarizes the overall progress trend and gives one actionable suggestion.
Do not use bullet points. Write in a warm, encouraging tone.
""".strip()

COACHING_INSTRUCTIONS = """
You are a Korean presentation rehearsal coach for ORBIT.
Return only JSON with:
- summary: one concise Korean sentence
- aiSummary: object with headline and paragraphs
- aiSummary.headline: one Korean sentence that summarizes the main report finding
- aiSummary.paragraphs: array of 2-3 Korean sentences with evidence-backed overall feedback
- strengths: array of 1-3 Korean strings
- improvements: array of 1-3 Korean strings
- nextPracticeFocus: one concise Korean string

Use only the transcript and metrics. Do not invent unsupported details.
""".strip()

COACHING_RESPONSE_FORMAT: dict[str, Any] = {
    "format": {
        "type": "json_schema",
        "name": "rehearsal_coaching",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "summary": {"type": "string"},
                "aiSummary": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "headline": {"type": "string"},
                        "paragraphs": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 2,
                            "maxItems": 3,
                        },
                    },
                    "required": ["headline", "paragraphs"],
                },
                "strengths": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "improvements": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "nextPracticeFocus": {"type": "string"},
            },
            "required": [
                "summary",
                "aiSummary",
                "strengths",
                "improvements",
                "nextPracticeFocus",
            ],
        },
    }
}


@dataclass(frozen=True)
class DeckKeyword:
    text: str
    keyword_id: str = ""
    slide_id: str = ""
    synonyms: list[str] = field(default_factory=list)
    abbreviations: list[str] = field(default_factory=list)
    required: bool = False


@dataclass(frozen=True)
class SpeedSample:
    start_second: float
    end_second: float
    words_per_minute: float


@dataclass(frozen=True)
class FillerWordDetail:
    word: str
    count: int


@dataclass(frozen=True)
class SlideTimelineEntry:
    slide_id: str
    entered_second: float


@dataclass(frozen=True)
class MissedKeywordDetail:
    slide_id: str
    keyword_id: str
    text: str


SpeakingRateReasonCode = Literal[
    "UNSUPPORTED_LANGUAGE",
    "SEGMENT_TIMESTAMPS_UNAVAILABLE",
    "INSUFFICIENT_SLIDE_SPEECH",
    "BASELINE_UNAVAILABLE",
    "LEGACY_REPORT",
]
SpeakingRatePaceCategory = Literal["slower", "similar", "faster"]


@dataclass(frozen=True)
class SlideSpeakingRate:
    metric_definition_version: Literal[1]
    measurement_state: Literal["measured", "unmeasured"]
    reason_code: SpeakingRateReasonCode | None
    characters_per_second: float | None
    baseline_characters_per_second: float | None
    relative_rate_ratio: float | None
    pace_category: SpeakingRatePaceCategory | None
    active_speech_seconds: float
    character_count: int


@dataclass
class _SlideSpeakingRateEvidence:
    character_count: int = 0
    intervals: list[tuple[float, float]] = field(default_factory=list)


@dataclass(frozen=True)
class SlideInsight:
    slide_id: str
    filler_word_count: int
    long_silence_count: int | None
    speaking_rate: SlideSpeakingRate


@dataclass(frozen=True)
class KeywordAnalysis:
    coverage: float
    missed: list[MissedKeywordDetail] = field(default_factory=list)


@dataclass(frozen=True)
class RehearsalMetricsResult:
    words_per_minute: float
    filler_word_count: int
    long_silence_count: int | None
    keyword_coverage: float
    speed_samples: list[SpeedSample] = field(default_factory=list)
    filler_word_details: list[FillerWordDetail] = field(default_factory=list)
    missed_keywords: list[MissedKeywordDetail] = field(default_factory=list)
    slide_insights: list[SlideInsight] = field(default_factory=list)


@dataclass(frozen=True)
class RehearsalCoachingResult:
    status: str
    summary: str = ""
    ai_summary_headline: str = ""
    ai_summary_paragraphs: list[str] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)
    improvements: list[str] = field(default_factory=list)
    next_practice_focus: str = ""
    message: str = ""


def analyze_rehearsal_metrics(
    *,
    transcript: str,
    duration_seconds: float,
    segments: list[TranscriptSegment],
    deck_keywords: list[DeckKeyword],
    language: str = "und",
    slide_timeline: list[SlideTimelineEntry] | None = None,
    silence_analysis: RehearsalSilenceAnalysis | None = None,
    pronunciation_context: list[PronunciationContextTerm] | None = None,
) -> RehearsalMetricsResult:
    # TODO: 현재 산식은 MVP 휴리스틱이므로, 문서화된 리허설 평가 기준에 맞춰 재검토한다.
    words = transcript_words(transcript)
    speaking_duration_seconds = resolve_speaking_duration_seconds(
        duration_seconds,
        segments,
    )
    keyword_result = analyze_required_keywords_by_slide(
        segments=segments,
        deck_keywords=deck_keywords,
        slide_timeline=slide_timeline or [],
        duration_seconds=duration_seconds,
        pronunciation_context=pronunciation_context,
    )
    long_silence_count = (
        silence_analysis.long_silence_count
        if silence_analysis is not None
        and silence_analysis.measurement_state == "measured"
        else None
    )
    return RehearsalMetricsResult(
        words_per_minute=calculate_words_per_minute(
            len(words),
            speaking_duration_seconds,
        ),
        filler_word_count=count_filler_words(words),
        long_silence_count=long_silence_count,
        keyword_coverage=keyword_result.coverage,
        speed_samples=build_speed_samples(segments),
        filler_word_details=count_filler_word_details(words),
        missed_keywords=keyword_result.missed,
        slide_insights=build_slide_insights(
            duration_seconds,
            segments,
            slide_timeline or [],
            silence_analysis,
            language,
        ),
    )


def generate_rehearsal_coaching(
    *,
    transcript: str,
    metrics: RehearsalMetricsResult,
    client: Any | None = None,
    model: str,
    api_key: str | None,
) -> RehearsalCoachingResult:
    text = transcript.strip()
    if not text:
        return RehearsalCoachingResult(
            status="skipped",
            message="No transcript to coach.",
        )

    api_client: Any = client
    if api_client is None:
        if not api_key:
            return RehearsalCoachingResult(
                status="unavailable",
                message="OPENAI_API_KEY is not configured.",
            )

        from openai import OpenAI

        api_client = OpenAI(api_key=api_key)

    try:
        response = api_client.responses.create(
            model=model,
            instructions=COACHING_INSTRUCTIONS,
            input=(
                "Transcript:\n"
                f"{text}\n\n"
                "Metrics:\n"
                f"- wordsPerMinute: {metrics.words_per_minute}\n"
                f"- fillerWordCount: {metrics.filler_word_count}\n"
                f"- longSilenceCount: {metrics.long_silence_count}\n"
                f"- keywordCoverage: {metrics.keyword_coverage}\n"
            ),
            text=COACHING_RESPONSE_FORMAT,
        )
    except Exception as error:
        return RehearsalCoachingResult(status="failed", message=str(error))

    output_text = str(getattr(response, "output_text", "")).strip()
    if not output_text:
        return RehearsalCoachingResult(
            status="failed",
            message="OpenAI returned empty coaching.",
        )

    try:
        payload = json.loads(output_text)
    except json.JSONDecodeError as error:
        return RehearsalCoachingResult(
            status="failed",
            message=f"OpenAI returned invalid coaching JSON: {error}",
        )

    if not isinstance(payload, dict):
        return RehearsalCoachingResult(
            status="failed",
            message="OpenAI coaching response was not an object.",
        )

    ai_summary = payload.get("aiSummary")
    if not isinstance(ai_summary, dict):
        ai_summary = {}

    return RehearsalCoachingResult(
        status="succeeded",
        summary=str(payload.get("summary", "")).strip(),
        ai_summary_headline=str(ai_summary.get("headline", "")).strip(),
        ai_summary_paragraphs=string_list(ai_summary.get("paragraphs"))[:3],
        strengths=string_list(payload.get("strengths")),
        improvements=string_list(payload.get("improvements")),
        next_practice_focus=str(payload.get("nextPracticeFocus", "")).strip(),
    )


@dataclass(frozen=True)
class RunSeriesEntry:
    run_id: str
    created_at: str
    duration_seconds: float


def generate_progress_comment(
    *,
    run_series: list[RunSeriesEntry],
    client: Any | None = None,
    model: str,
    api_key: str | None,
) -> str | None:
    if len(run_series) < 2:
        return None

    api_client: Any = client
    if api_client is None:
        if not api_key:
            return None
        from openai import OpenAI

        api_client = OpenAI(api_key=api_key)

    lines = "\n".join(
        f"- 회차 {i + 1} ({entry.created_at[:10]}): {entry.duration_seconds:.0f}초"
        for i, entry in enumerate(run_series)
    )
    input_text = f"리허설 회차별 총 발표 시간:\n{lines}"

    try:
        response = api_client.responses.create(
            model=model,
            instructions=PROGRESS_COMMENT_INSTRUCTIONS,
            input=input_text,
        )
    except Exception:
        return None

    output_text = str(getattr(response, "output_text", "")).strip()
    return output_text or None


def transcript_words(transcript: str) -> list[str]:
    return re.findall(r"[\w가-힣']+", transcript.lower())


def resolve_speaking_duration_seconds(
    duration_seconds: float,
    segments: list[TranscriptSegment],
) -> float:
    if duration_seconds > 0:
        return duration_seconds

    timed_segments = valid_timed_segments(segments)

    if not timed_segments:
        return 0

    start_seconds = min(start for start, _end in timed_segments)
    end_seconds = max(end for _start, end in timed_segments)
    return max(0, end_seconds - start_seconds)


def calculate_words_per_minute(word_count: int, duration_seconds: float) -> float:
    if word_count <= 0 or duration_seconds <= 0:
        return 0.0

    return round(word_count / (duration_seconds / 60), 2)


def count_filler_words(words: list[str]) -> int:
    return len(find_filler_words(words))


def count_filler_word_details(words: list[str]) -> list[FillerWordDetail]:
    counts: dict[str, int] = {}
    for word in find_filler_words(words):
        counts[word] = counts.get(word, 0) + 1

    return [
        FillerWordDetail(word=word, count=count)
        for word, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


def find_filler_words(words: list[str]) -> list[str]:
    fillers: list[str] = []
    index = 0
    while index < len(words):
        phrase = canonical_filler_phrase(words, index)
        if phrase is not None:
            canonical, length = phrase
            fillers.append(canonical)
            index += length
            continue

        canonical_word = canonical_filler_word(words[index])
        if canonical_word is not None:
            fillers.append(canonical_word)

        index += 1

    return fillers


def canonical_filler_phrase(words: list[str], index: int) -> tuple[str, int] | None:
    for phrase_words, canonical in FILLER_PHRASES.items():
        end_index = index + len(phrase_words)
        if tuple(words[index:end_index]) == phrase_words:
            return canonical, len(phrase_words)

    return None


def canonical_filler_word(word: str) -> str | None:
    if word in FILLER_WORDS:
        return word

    if re.fullmatch(r"(?:으+)?음+", word):
        return "음"

    if re.fullmatch(r"어+", word):
        return "어"

    if re.fullmatch(r"umm+", word):
        return "um"

    if re.fullmatch(r"uhh+", word):
        return "uh"

    return None


def valid_timed_segments(
    segments: list[TranscriptSegment],
) -> list[tuple[float, float]]:
    timed_segments: list[tuple[float, float]] = []
    for segment in segments:
        if segment.start_seconds is None or segment.end_seconds is None:
            continue
        if segment.end_seconds <= segment.start_seconds:
            continue
        timed_segments.append((segment.start_seconds, segment.end_seconds))

    return sorted(timed_segments, key=lambda segment: (segment[0], segment[1]))


def resolve_analysis_end_second(
    duration_seconds: float,
    segments: list[TranscriptSegment],
) -> float:
    if duration_seconds > 0:
        return duration_seconds

    timed_segments = valid_timed_segments(segments)
    if not timed_segments:
        return 0.0

    return max(end for _start, end in timed_segments)


def build_slide_insights(
    duration_seconds: float,
    segments: list[TranscriptSegment],
    slide_timeline: list[SlideTimelineEntry],
    silence_analysis: RehearsalSilenceAnalysis | None = None,
    language: str = "und",
) -> list[SlideInsight]:
    timeline = normalize_slide_timeline(slide_timeline)
    if not timeline:
        return []

    analysis_end_second = resolve_analysis_end_second(duration_seconds, segments)
    if analysis_end_second <= 0:
        return []

    long_silence_segments = (
        [segment for segment in silence_analysis.segments if segment.category == "long"]
        if silence_analysis is not None
        and silence_analysis.measurement_state == "measured"
        else None
    )
    try:
        speaking_rates = build_slide_speaking_rates(
            language=language,
            segments=segments,
            slide_timeline=timeline,
            duration_seconds=analysis_end_second,
        )
    except Exception:
        logger.warning("Slide speaking rate analysis failed.", exc_info=True)
        speaking_rates = build_unmeasured_slide_speaking_rates(
            list(dict.fromkeys(entry.slide_id for entry in timeline)),
            reason_code="BASELINE_UNAVAILABLE",
        )
    slide_order: list[str] = []
    slide_words: dict[str, list[str]] = {}
    slide_long_silence_counts: dict[str, int] = {}

    for index, entry in enumerate(timeline):
        next_entry = timeline[index + 1] if index + 1 < len(timeline) else None
        window_end = (
            next_entry.entered_second if next_entry is not None else analysis_end_second
        )
        if window_end <= entry.entered_second:
            continue

        if entry.slide_id not in slide_words:
            slide_order.append(entry.slide_id)
            slide_words[entry.slide_id] = []
            slide_long_silence_counts[entry.slide_id] = 0

        for segment in segments:
            if segment_belongs_to_window(segment, entry.entered_second, window_end):
                slide_words[entry.slide_id].extend(transcript_words(segment.text))

        if long_silence_segments is not None:
            slide_long_silence_counts[entry.slide_id] += sum(
                1
                for silence in long_silence_segments
                if interval_midpoint_in_window(
                    silence.start_seconds,
                    silence.end_seconds,
                    entry.entered_second,
                    window_end,
                )
            )

    return [
        SlideInsight(
            slide_id=slide_id,
            filler_word_count=count_filler_words(slide_words[slide_id]),
            long_silence_count=(
                slide_long_silence_counts[slide_id]
                if long_silence_segments is not None
                else None
            ),
            speaking_rate=speaking_rates[slide_id],
        )
        for slide_id in slide_order
    ]


def count_speech_characters(text: str) -> int:
    """공백과 문장부호를 제외한 Unicode 문자·숫자 개수를 센다."""
    normalized_text = unicodedata.normalize("NFKC", text)
    return sum(character.isalnum() for character in normalized_text)


def classify_relative_pace(relative_rate_ratio: float) -> SpeakingRatePaceCategory:
    """현재 발표 평균 대비 장표 속도를 분류한다."""
    if relative_rate_ratio < SLIDE_SPEAKING_RATE_SLOWER_RATIO:
        return "slower"
    if relative_rate_ratio > SLIDE_SPEAKING_RATE_FASTER_RATIO:
        return "faster"
    return "similar"


def build_slide_speaking_rates(
    *,
    language: str,
    segments: list[TranscriptSegment],
    slide_timeline: list[SlideTimelineEntry],
    duration_seconds: float,
) -> dict[str, SlideSpeakingRate]:
    """STT segment timestamp를 이용해 슬라이드별 상대 발화 속도를 계산한다."""
    timeline = normalize_slide_timeline(slide_timeline)
    slide_ids = list(dict.fromkeys(entry.slide_id for entry in timeline))
    if not slide_ids:
        return {}

    if not is_supported_speaking_rate_language(language):
        return build_unmeasured_slide_speaking_rates(
            slide_ids,
            reason_code="UNSUPPORTED_LANGUAGE",
        )

    if not valid_timed_segments(segments):
        return build_unmeasured_slide_speaking_rates(
            slide_ids,
            reason_code="SEGMENT_TIMESTAMPS_UNAVAILABLE",
        )

    timed_segments = timed_segments_with_character_counts(segments)
    if not timed_segments:
        return build_unmeasured_slide_speaking_rates(
            slide_ids,
            reason_code="BASELINE_UNAVAILABLE",
        )

    evidence_by_slide = {
        slide_id: _SlideSpeakingRateEvidence() for slide_id in slide_ids
    }
    analysis_end_second = resolve_analysis_end_second(duration_seconds, segments)
    for index, entry in enumerate(timeline):
        next_entry = timeline[index + 1] if index + 1 < len(timeline) else None
        window_end = (
            next_entry.entered_second if next_entry is not None else analysis_end_second
        )
        if window_end <= entry.entered_second:
            continue

        evidence = evidence_by_slide[entry.slide_id]
        for _segment, start_second, end_second, character_count in timed_segments:
            if interval_midpoint_in_window(
                start_second,
                end_second,
                entry.entered_second,
                window_end,
            ):
                evidence.character_count += character_count
                evidence.intervals.append((start_second, end_second))

    evidence_rates: dict[str, float] = {}
    evidence_durations: dict[str, float] = {}
    for slide_id, evidence in evidence_by_slide.items():
        active_speech_seconds = merged_interval_duration(evidence.intervals)
        evidence_durations[slide_id] = active_speech_seconds
        if (
            active_speech_seconds >= SLIDE_SPEAKING_RATE_MINIMUM_SECONDS
            and evidence.character_count >= SLIDE_SPEAKING_RATE_MINIMUM_CHARACTERS
        ):
            evidence_rates[slide_id] = evidence.character_count / active_speech_seconds

    if len(evidence_rates) < 3:
        return {
            slide_id: unmeasured_slide_speaking_rate(
                reason_code=(
                    "BASELINE_UNAVAILABLE"
                    if slide_id in evidence_rates
                    else "INSUFFICIENT_SLIDE_SPEECH"
                ),
                active_speech_seconds=evidence_durations[slide_id],
                character_count=evidence_by_slide[slide_id].character_count,
            )
            for slide_id in slide_ids
        }

    baseline_characters_per_second = median(evidence_rates.values())
    return {
        slide_id: build_slide_speaking_rate(
            evidence=evidence_by_slide[slide_id],
            baseline_characters_per_second=baseline_characters_per_second,
        )
        for slide_id in slide_ids
    }


def build_slide_speaking_rate(
    *,
    evidence: _SlideSpeakingRateEvidence,
    baseline_characters_per_second: float,
) -> SlideSpeakingRate:
    active_speech_seconds = merged_interval_duration(evidence.intervals)
    if (
        active_speech_seconds < SLIDE_SPEAKING_RATE_MINIMUM_SECONDS
        or evidence.character_count < SLIDE_SPEAKING_RATE_MINIMUM_CHARACTERS
    ):
        return unmeasured_slide_speaking_rate(
            reason_code="INSUFFICIENT_SLIDE_SPEECH",
            active_speech_seconds=active_speech_seconds,
            character_count=evidence.character_count,
        )

    characters_per_second = evidence.character_count / active_speech_seconds
    relative_rate_ratio = characters_per_second / baseline_characters_per_second
    return SlideSpeakingRate(
        metric_definition_version=1,
        measurement_state="measured",
        reason_code=None,
        characters_per_second=max(0.01, round(characters_per_second, 2)),
        baseline_characters_per_second=max(
            0.01,
            round(baseline_characters_per_second, 2),
        ),
        relative_rate_ratio=max(0.0001, round(relative_rate_ratio, 4)),
        pace_category=classify_relative_pace(relative_rate_ratio),
        active_speech_seconds=round(active_speech_seconds, 3),
        character_count=evidence.character_count,
    )


def build_unmeasured_slide_speaking_rates(
    slide_ids: list[str],
    *,
    reason_code: SpeakingRateReasonCode,
) -> dict[str, SlideSpeakingRate]:
    return {
        slide_id: unmeasured_slide_speaking_rate(reason_code=reason_code)
        for slide_id in slide_ids
    }


def unmeasured_slide_speaking_rate(
    *,
    reason_code: SpeakingRateReasonCode,
    active_speech_seconds: float = 0,
    character_count: int = 0,
) -> SlideSpeakingRate:
    return SlideSpeakingRate(
        metric_definition_version=1,
        measurement_state="unmeasured",
        reason_code=reason_code,
        characters_per_second=None,
        baseline_characters_per_second=None,
        relative_rate_ratio=None,
        pace_category=None,
        active_speech_seconds=round(active_speech_seconds, 3),
        character_count=character_count,
    )


def is_supported_speaking_rate_language(language: str) -> bool:
    normalized_language = language.strip().lower().replace("_", "-")
    return (
        normalized_language == "korean"
        or normalized_language.split("-", maxsplit=1)[0] == "ko"
    )


def timed_segments_with_character_counts(
    segments: list[TranscriptSegment],
) -> list[tuple[TranscriptSegment, float, float, int]]:
    timed_segments: list[tuple[TranscriptSegment, float, float, int]] = []
    for segment in segments:
        if segment.start_seconds is None or segment.end_seconds is None:
            continue
        if segment.end_seconds <= segment.start_seconds:
            continue

        character_count = count_speech_characters(segment.text)
        if character_count <= 0:
            continue
        timed_segments.append(
            (
                segment,
                segment.start_seconds,
                segment.end_seconds,
                character_count,
            )
        )

    return timed_segments


def merged_interval_duration(intervals: list[tuple[float, float]]) -> float:
    if not intervals:
        return 0.0

    sorted_intervals = sorted(
        intervals,
        key=lambda interval: (interval[0], interval[1]),
    )
    merged: list[tuple[float, float]] = []
    for start_second, end_second in sorted_intervals:
        if not merged or start_second > merged[-1][1]:
            merged.append((start_second, end_second))
            continue

        previous_start, previous_end = merged[-1]
        merged[-1] = (previous_start, max(previous_end, end_second))

    return sum(end - start for start, end in merged)


def normalize_slide_timeline(
    slide_timeline: list[SlideTimelineEntry],
) -> list[SlideTimelineEntry]:
    normalized: list[SlideTimelineEntry] = []

    for entry in slide_timeline:
        if not entry.slide_id.strip() or entry.entered_second < 0:
            continue

        if normalized and entry.entered_second <= normalized[-1].entered_second:
            continue

        if normalized and normalized[-1].slide_id == entry.slide_id:
            continue

        normalized.append(entry)

    return normalized


def segment_belongs_to_window(
    segment: TranscriptSegment,
    window_start: float,
    window_end: float,
) -> bool:
    if segment.start_seconds is None or segment.end_seconds is None:
        return False

    if segment.end_seconds <= segment.start_seconds:
        return False

    midpoint = (segment.start_seconds + segment.end_seconds) / 2
    return window_start <= midpoint < window_end


def interval_midpoint_in_window(
    start_second: float,
    end_second: float,
    window_start: float,
    window_end: float,
) -> bool:
    if end_second <= start_second:
        return False

    midpoint = (start_second + end_second) / 2
    return window_start <= midpoint < window_end


def keyword_coverage(transcript: str, deck_keywords: list[DeckKeyword]) -> float:
    return analyze_keywords(transcript, deck_keywords).coverage


def analyze_keywords(
    transcript: str,
    deck_keywords: list[DeckKeyword],
    pronunciation_context: list[PronunciationContextTerm] | None = None,
) -> KeywordAnalysis:
    # 현재 키워드 커버리지는 유의어/약어 후보의 단순 부분 문자열 매칭으로 계산한다.
    if not deck_keywords:
        return KeywordAnalysis(coverage=0.0)

    normalized_transcript = transcript.lower()
    canonical_term_keys = find_canonical_term_keys(
        transcript,
        pronunciation_context or [],
    )
    matched = 0
    missed: list[MissedKeywordDetail] = []
    for keyword in deck_keywords:
        candidates = [
            candidate.strip().lower()
            for candidate in [keyword.text, *keyword.synonyms, *keyword.abbreviations]
            if candidate.strip()
        ]
        candidate_canonical_keys = {
            normalize_pronunciation_key(candidate) for candidate in candidates
        }
        if any(candidate in normalized_transcript for candidate in candidates) or (
            canonical_term_keys & candidate_canonical_keys
        ):
            matched += 1
        elif keyword.slide_id and keyword.keyword_id and keyword.text.strip():
            missed.append(
                MissedKeywordDetail(
                    slide_id=keyword.slide_id,
                    keyword_id=keyword.keyword_id,
                    text=keyword.text.strip(),
                )
            )

    return KeywordAnalysis(
        coverage=round(matched / len(deck_keywords), 4), missed=missed
    )


def analyze_required_keywords_by_slide(
    *,
    segments: list[TranscriptSegment],
    deck_keywords: list[DeckKeyword],
    slide_timeline: list[SlideTimelineEntry],
    duration_seconds: float,
    pronunciation_context: list[PronunciationContextTerm] | None = None,
) -> KeywordAnalysis:
    required_keywords = [keyword for keyword in deck_keywords if keyword.required]
    if not required_keywords:
        return KeywordAnalysis(coverage=0.0)

    timeline = normalize_slide_timeline(slide_timeline)
    analysis_end_second = resolve_analysis_end_second(duration_seconds, segments)
    if not timeline or analysis_end_second <= 0:
        return KeywordAnalysis(coverage=0.0)

    slide_transcripts: dict[str, list[str]] = {}
    for index, entry in enumerate(timeline):
        next_entry = timeline[index + 1] if index + 1 < len(timeline) else None
        window_end = (
            next_entry.entered_second if next_entry is not None else analysis_end_second
        )
        if window_end <= entry.entered_second:
            continue

        slide_transcripts.setdefault(entry.slide_id, [])
        slide_transcripts[entry.slide_id].extend(
            segment.text
            for segment in segments
            if segment_belongs_to_window(
                segment,
                entry.entered_second,
                window_end,
            )
        )

    matched = 0
    missed: list[MissedKeywordDetail] = []
    for keyword in required_keywords:
        slide_transcript = " ".join(slide_transcripts.get(keyword.slide_id, []))
        normalized_transcript = unicodedata.normalize("NFKC", slide_transcript).casefold()
        canonical_term_keys = find_canonical_term_keys(
            slide_transcript,
            pronunciation_context or [],
        )
        candidates = [
            unicodedata.normalize("NFKC", candidate.strip()).casefold()
            for candidate in [keyword.text, *keyword.synonyms, *keyword.abbreviations]
            if candidate.strip()
        ]
        candidate_canonical_keys = {
            normalize_pronunciation_key(candidate) for candidate in candidates
        }
        if any(candidate in normalized_transcript for candidate in candidates) or (
            canonical_term_keys & candidate_canonical_keys
        ):
            matched += 1
        elif keyword.slide_id and keyword.keyword_id and keyword.text.strip():
            missed.append(
                MissedKeywordDetail(
                    slide_id=keyword.slide_id,
                    keyword_id=keyword.keyword_id,
                    text=keyword.text.strip(),
                )
            )

    return KeywordAnalysis(
        coverage=round(matched / len(required_keywords), 4),
        missed=missed,
    )


def build_speed_samples(segments: list[TranscriptSegment]) -> list[SpeedSample]:
    samples: list[SpeedSample] = []
    for segment in segments:
        if segment.start_seconds is None or segment.end_seconds is None:
            continue

        duration_seconds = segment.end_seconds - segment.start_seconds
        if duration_seconds <= 0:
            continue

        word_count = len(transcript_words(segment.text))
        if word_count == 0:
            continue

        samples.append(
            SpeedSample(
                start_second=round(segment.start_seconds, 2),
                end_second=round(segment.end_seconds, 2),
                words_per_minute=round(word_count / (duration_seconds / 60), 2),
            )
        )

    return samples


def string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []

    return [item.strip() for item in value if isinstance(item, str) and item.strip()]
