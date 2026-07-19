from __future__ import annotations

from typing import Literal

from app.audio.analysis.models import (
    AudioAnalysisError,
    DecodedAudio,
    RehearsalSilenceAnalysis,
    SilenceSegment,
)
from app.audio.analysis.vad import (
    MINIMUM_SILENCE_DURATION_MS,
    SPEECH_THRESHOLD,
    SpeechRange,
    VoiceActivityDetector,
)

MINIMUM_DETECTED_SPEECH_SECONDS = 1.0
LONG_SILENCE_MS: Literal[5000] = 5_000
MAXIMUM_SILENCE_SEGMENTS = 1_000


def analyze_silence(
    decoded_audio: DecodedAudio,
    detector: VoiceActivityDetector,
) -> RehearsalSilenceAnalysis:
    """발화 사이의 실제 비발화 구간을 계산한다."""
    speech_ranges = _normalize_speech_ranges(
        detector.detect_speech(decoded_audio),
        decoded_audio.samples.size,
    )
    if not speech_ranges:
        raise AudioAnalysisError("INSUFFICIENT_SPEECH")
    speech_seconds = (
        sum(speech.end_sample - speech.start_sample for speech in speech_ranges)
        / decoded_audio.sample_rate_hz
    )
    if speech_seconds < MINIMUM_DETECTED_SPEECH_SECONDS:
        raise AudioAnalysisError("INSUFFICIENT_SPEECH")

    all_segments = _build_silence_segments(decoded_audio, speech_ranges)
    output_segments = all_segments[:MAXIMUM_SILENCE_SEGMENTS]
    window_start = speech_ranges[0].start_sample / decoded_audio.sample_rate_hz
    window_end = speech_ranges[-1].end_sample / decoded_audio.sample_rate_hz
    window_seconds = window_end - window_start
    total_silence_seconds = sum(segment.duration_seconds for segment in all_segments)

    return RehearsalSilenceAnalysis(
        metricDefinitionVersion=2,
        measurementState="measured",
        reasonCode=None,
        detector="silero-vad",
        detectorVersion=detector.detector_version,
        speechThreshold=SPEECH_THRESHOLD,
        minimumSilenceMs=MINIMUM_SILENCE_DURATION_MS,
        longSilenceMs=LONG_SILENCE_MS,
        analysisWindowStartSeconds=round(window_start, 3),
        analysisWindowEndSeconds=round(window_end, 3),
        totalSilenceSeconds=round(total_silence_seconds, 3),
        silenceRatio=round(total_silence_seconds / window_seconds, 4),
        longSilenceCount=sum(segment.category == "long" for segment in all_segments),
        detectedSegmentCount=len(all_segments),
        segmentsTruncated=len(all_segments) > len(output_segments),
        segments=output_segments,
    )


def _normalize_speech_ranges(
    speech_ranges: list[SpeechRange],
    sample_count: int,
) -> list[SpeechRange]:
    normalized: list[SpeechRange] = []
    for speech_range in sorted(speech_ranges, key=lambda item: item.start_sample):
        if speech_range.start_sample < 0 or speech_range.start_sample >= sample_count:
            raise AudioAnalysisError("ANALYSIS_FAILED")
        end_sample = min(speech_range.end_sample, sample_count)
        if end_sample <= speech_range.start_sample:
            raise AudioAnalysisError("ANALYSIS_FAILED")
        if normalized and speech_range.start_sample <= normalized[-1].end_sample:
            previous = normalized[-1]
            normalized[-1] = SpeechRange(
                start_sample=previous.start_sample,
                end_sample=max(previous.end_sample, end_sample),
            )
            continue
        normalized.append(
            SpeechRange(
                start_sample=speech_range.start_sample,
                end_sample=end_sample,
            )
        )
    return normalized


def _build_silence_segments(
    decoded_audio: DecodedAudio,
    speech_ranges: list[SpeechRange],
) -> list[SilenceSegment]:
    minimum_silence_samples = round(
        decoded_audio.sample_rate_hz * MINIMUM_SILENCE_DURATION_MS / 1_000
    )
    long_silence_samples = round(decoded_audio.sample_rate_hz * LONG_SILENCE_MS / 1_000)
    segments: list[SilenceSegment] = []
    for previous, current in zip(speech_ranges, speech_ranges[1:], strict=False):
        duration_samples = current.start_sample - previous.end_sample
        if duration_samples < minimum_silence_samples:
            continue
        start_seconds = round(
            previous.end_sample / decoded_audio.sample_rate_hz,
            3,
        )
        end_seconds = round(
            current.start_sample / decoded_audio.sample_rate_hz,
            3,
        )
        segments.append(
            SilenceSegment(
                category=(
                    "long" if duration_samples >= long_silence_samples else "brief"
                ),
                startSeconds=start_seconds,
                endSeconds=end_seconds,
                durationSeconds=round(duration_samples / decoded_audio.sample_rate_hz, 4),
            )
        )
    return segments
