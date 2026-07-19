from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, model_validator

VolumeAnalysisReasonCode = Literal[
    "AUDIO_DECODE_FAILED",
    "NO_AUDIO_STREAM",
    "EMPTY_AUDIO",
    "INSUFFICIENT_ACTIVE_AUDIO",
    "ANALYSIS_FAILED",
    "LEGACY_REPORT",
]

SilenceAnalysisReasonCode = Literal[
    "AUDIO_DECODE_FAILED",
    "NO_AUDIO_STREAM",
    "EMPTY_AUDIO",
    "INSUFFICIENT_SPEECH",
    "VAD_INITIALIZATION_FAILED",
    "ANALYSIS_FAILED",
    "LEGACY_REPORT",
]

AudioAnalysisReasonCode = VolumeAnalysisReasonCode | SilenceAnalysisReasonCode


class AudioAnalysisError(RuntimeError):
    def __init__(self, reason_code: AudioAnalysisReasonCode) -> None:
        super().__init__(reason_code)
        self.reason_code = reason_code


@dataclass(frozen=True)
class DecodedAudio:
    samples: NDArray[np.float32]
    sample_rate_hz: int
    duration_seconds: float


class VolumeIssueSegment(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    kind: Literal["quiet", "loud"]
    start_seconds: float = Field(alias="startSeconds", ge=0)
    end_seconds: float = Field(alias="endSeconds", ge=0)
    duration_seconds: float = Field(alias="durationSeconds", gt=0)
    mean_deviation_db: float = Field(alias="meanDeviationDb")

    @model_validator(mode="after")
    def validate_time_range(self) -> VolumeIssueSegment:
        expected_duration = self.end_seconds - self.start_seconds
        if expected_duration <= 0 or not math.isclose(
            self.duration_seconds,
            expected_duration,
            abs_tol=0.002,
        ):
            raise ValueError("volume issue duration must match its time range")
        return self


class RehearsalVolumeAnalysis(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    metric_definition_version: Literal[1, 2] = Field(alias="metricDefinitionVersion")
    measurement_state: Literal["measured", "unmeasured"] = Field(
        alias="measurementState"
    )
    reason_code: VolumeAnalysisReasonCode | None = Field(alias="reasonCode")
    average_dbfs: float | None = Field(alias="averageDbfs")
    baseline_dbfs: float | None = Field(alias="baselineDbfs")
    variation_db: float | None = Field(alias="variationDb", ge=0)
    active_ratio: float | None = Field(alias="activeRatio", ge=0, le=1)
    issue_segments: list[VolumeIssueSegment] = Field(alias="issueSegments")

    @model_validator(mode="after")
    def validate_measurement_state(self) -> RehearsalVolumeAnalysis:
        if self.metric_definition_version == 2:
            if len(self.issue_segments) > 5:
                raise ValueError("volume analysis v2 supports at most 5 issue segments")
            if any(segment.duration_seconds < 2 for segment in self.issue_segments):
                raise ValueError(
                    "volume analysis v2 issue segments must last at least 2 seconds"
                )

        metric_values = (
            self.average_dbfs,
            self.baseline_dbfs,
            self.variation_db,
            self.active_ratio,
        )
        if self.measurement_state == "measured":
            if self.reason_code is not None or any(
                value is None for value in metric_values
            ):
                raise ValueError("measured volume analysis requires all metric values")
        elif self.reason_code is None or any(
            value is not None for value in metric_values
        ):
            raise ValueError("unmeasured volume analysis requires a reason only")
        elif self.issue_segments:
            raise ValueError("unmeasured volume analysis cannot include issue segments")

        return self


class SilenceSegment(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    category: Literal["brief", "long"]
    start_seconds: float = Field(alias="startSeconds", ge=0)
    end_seconds: float = Field(alias="endSeconds", ge=0)
    duration_seconds: float = Field(alias="durationSeconds", ge=0.25)

    @model_validator(mode="after")
    def validate_time_range(self) -> SilenceSegment:
        expected_duration = self.end_seconds - self.start_seconds
        if expected_duration <= 0 or not math.isclose(
            self.duration_seconds,
            expected_duration,
            abs_tol=0.002,
        ):
            raise ValueError("silence duration must match its time range")
        return self


class RehearsalSilenceAnalysis(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    metric_definition_version: Literal[1, 2] = Field(alias="metricDefinitionVersion")
    measurement_state: Literal["measured", "unmeasured"] = Field(
        alias="measurementState"
    )
    reason_code: SilenceAnalysisReasonCode | None = Field(alias="reasonCode")
    detector: Literal["silero-vad"] = "silero-vad"
    detector_version: str = Field(alias="detectorVersion", min_length=1)
    speech_threshold: float = Field(alias="speechThreshold")
    minimum_silence_ms: Literal[250] = Field(alias="minimumSilenceMs")
    long_silence_ms: Literal[1000, 5000] = Field(alias="longSilenceMs")
    analysis_window_start_seconds: float | None = Field(
        alias="analysisWindowStartSeconds",
        ge=0,
    )
    analysis_window_end_seconds: float | None = Field(
        alias="analysisWindowEndSeconds",
        ge=0,
    )
    total_silence_seconds: float | None = Field(alias="totalSilenceSeconds", ge=0)
    silence_ratio: float | None = Field(alias="silenceRatio", ge=0, le=1)
    long_silence_count: int | None = Field(alias="longSilenceCount", ge=0)
    detected_segment_count: int | None = Field(alias="detectedSegmentCount", ge=0)
    segments_truncated: bool = Field(alias="segmentsTruncated")
    segments: list[SilenceSegment]

    @model_validator(mode="after")
    def validate_measurement_state(self) -> RehearsalSilenceAnalysis:
        if self.speech_threshold != 0.5:
            raise ValueError("silence analysis speech threshold must be 0.5")
        expected_long_silence_ms = 1000 if self.metric_definition_version == 1 else 5000
        if self.long_silence_ms != expected_long_silence_ms:
            raise ValueError(
                "silence threshold must match its metric definition version"
            )
        long_silence_seconds = self.long_silence_ms / 1000
        if any(
            (segment.duration_seconds >= long_silence_seconds)
            != (segment.category == "long")
            for segment in self.segments
        ):
            raise ValueError("silence category must match its duration")
        metric_values = (
            self.analysis_window_start_seconds,
            self.analysis_window_end_seconds,
            self.total_silence_seconds,
            self.silence_ratio,
            self.long_silence_count,
            self.detected_segment_count,
        )
        if self.measurement_state == "measured":
            if self.reason_code is not None or any(
                value is None for value in metric_values
            ):
                raise ValueError("measured silence analysis requires all metrics")
            window_start = self.analysis_window_start_seconds
            window_end = self.analysis_window_end_seconds
            detected_segment_count = self.detected_segment_count
            long_silence_count = self.long_silence_count
            if (
                window_start is None
                or window_end is None
                or detected_segment_count is None
                or long_silence_count is None
            ):
                raise ValueError("measured silence analysis requires all metrics")
            if window_end <= window_start:
                raise ValueError("silence analysis window must be positive")
            if detected_segment_count < len(self.segments):
                raise ValueError("detected segment count cannot be smaller than output")
            if self.segments_truncated != (detected_segment_count > len(self.segments)):
                raise ValueError("silence truncation flag must match segment counts")
            if (
                long_silence_count
                != sum(segment.category == "long" for segment in self.segments)
                and not self.segments_truncated
            ):
                raise ValueError("long silence count must match segments")
            previous_start = -math.inf
            for segment in self.segments:
                if (
                    segment.start_seconds < window_start
                    or segment.end_seconds > window_end
                ):
                    raise ValueError("silence segments must stay in analysis window")
                if segment.start_seconds < previous_start:
                    raise ValueError("silence segments must be ordered")
                previous_start = segment.start_seconds
            total_silence_seconds = self.total_silence_seconds
            silence_ratio = self.silence_ratio
            if total_silence_seconds is None or silence_ratio is None:
                raise ValueError("measured silence analysis requires all metrics")
            if not self.segments_truncated and not math.isclose(
                total_silence_seconds,
                sum(segment.duration_seconds for segment in self.segments),
                abs_tol=0.002,
            ):
                raise ValueError("total silence must match segments")
            expected_ratio = total_silence_seconds / (window_end - window_start)
            if not math.isclose(silence_ratio, expected_ratio, abs_tol=0.0001):
                raise ValueError("silence ratio must match analysis window")
        elif self.reason_code is None or any(
            value is not None for value in metric_values
        ):
            raise ValueError("unmeasured silence analysis requires a reason only")
        elif self.segments or self.segments_truncated:
            raise ValueError("unmeasured silence analysis cannot include segments")

        return self


def unmeasured_volume_analysis(
    reason_code: VolumeAnalysisReasonCode,
) -> RehearsalVolumeAnalysis:
    return RehearsalVolumeAnalysis(
        metricDefinitionVersion=2,
        measurementState="unmeasured",
        reasonCode=reason_code,
        averageDbfs=None,
        baselineDbfs=None,
        variationDb=None,
        activeRatio=None,
        issueSegments=[],
    )


def unmeasured_silence_analysis(
    reason_code: SilenceAnalysisReasonCode,
    *,
    detector_version: str,
) -> RehearsalSilenceAnalysis:
    return RehearsalSilenceAnalysis(
        metricDefinitionVersion=2,
        measurementState="unmeasured",
        reasonCode=reason_code,
        detector="silero-vad",
        detectorVersion=detector_version,
        speechThreshold=0.5,
        minimumSilenceMs=250,
        longSilenceMs=5000,
        analysisWindowStartSeconds=None,
        analysisWindowEndSeconds=None,
        totalSilenceSeconds=None,
        silenceRatio=None,
        longSilenceCount=None,
        detectedSegmentCount=None,
        segmentsTruncated=False,
        segments=[],
    )
