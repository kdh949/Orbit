from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, cast

import librosa
import numpy as np
from numpy.typing import NDArray

from app.audio.analysis.models import (
    AudioAnalysisError,
    DecodedAudio,
    RehearsalVolumeAnalysis,
    VolumeIssueSegment,
)

FRAME_LENGTH = 2_048
HOP_LENGTH = 512
ABSOLUTE_ACTIVE_THRESHOLD_DBFS = -55.0
RELATIVE_ACTIVE_RANGE_DB = 35.0
ISSUE_DEVIATION_DB = 6.0
MINIMUM_ACTIVE_SECONDS = 1.0
MINIMUM_ISSUE_SECONDS = 2.0
MERGE_GAP_SECONDS = 1.0
MAXIMUM_ISSUE_SEGMENTS = 5
RMS_FLOOR = 1e-10
VolumeIssueKind = Literal["quiet", "loud"]


@dataclass
class _IssueCandidate:
    kind: VolumeIssueKind
    start_seconds: float
    end_seconds: float
    deviations_db: list[float] = field(default_factory=list)


def analyze_volume(decoded_audio: DecodedAudio) -> RehearsalVolumeAnalysis:
    """활성 발화의 상대적인 음량 변화와 문제 구간을 계산한다."""
    if decoded_audio.samples.size < FRAME_LENGTH:
        raise AudioAnalysisError("INSUFFICIENT_ACTIVE_AUDIO")

    frame_rms = librosa.feature.rms(
        y=decoded_audio.samples,
        frame_length=FRAME_LENGTH,
        hop_length=HOP_LENGTH,
        center=False,
    ).reshape(-1)
    if frame_rms.size == 0:
        raise AudioAnalysisError("INSUFFICIENT_ACTIVE_AUDIO")

    frame_dbfs = _rms_to_dbfs(frame_rms)
    active_threshold_dbfs = max(
        ABSOLUTE_ACTIVE_THRESHOLD_DBFS,
        float(np.percentile(frame_dbfs, 95)) - RELATIVE_ACTIVE_RANGE_DB,
    )
    active_frame_mask = frame_dbfs >= active_threshold_dbfs
    active_seconds = float(active_frame_mask.sum() * HOP_LENGTH)
    active_seconds /= decoded_audio.sample_rate_hz
    if active_seconds < MINIMUM_ACTIVE_SECONDS:
        raise AudioAnalysisError("INSUFFICIENT_ACTIVE_AUDIO")

    active_frame_rms = frame_rms[active_frame_mask]
    active_frame_dbfs = frame_dbfs[active_frame_mask]
    baseline_dbfs = float(np.median(active_frame_dbfs))
    issue_segments = _build_issue_segments(
        decoded_audio,
        frame_dbfs,
        active_frame_mask,
        baseline_dbfs,
    )

    return RehearsalVolumeAnalysis(
        metricDefinitionVersion=2,
        measurementState="measured",
        reasonCode=None,
        averageDbfs=round(float(_rms_to_dbfs(np.mean(active_frame_rms))), 2),
        baselineDbfs=round(baseline_dbfs, 2),
        variationDb=round(
            float(
                np.percentile(active_frame_dbfs, 90)
                - np.percentile(active_frame_dbfs, 10)
            ),
            2,
        ),
        activeRatio=round(float(active_frame_mask.mean()), 4),
        issueSegments=issue_segments,
    )


def _rms_to_dbfs(rms: NDArray[np.floating] | np.floating) -> NDArray[np.float64]:
    rms_values = np.asarray(rms, dtype=np.float64)
    return 20.0 * np.log10(np.maximum(rms_values, RMS_FLOOR))


def _build_issue_segments(
    decoded_audio: DecodedAudio,
    frame_dbfs: NDArray[np.float64],
    active_frame_mask: NDArray[np.bool_],
    baseline_dbfs: float,
) -> list[VolumeIssueSegment]:
    issue_kinds = np.full(frame_dbfs.shape, "", dtype=object)
    issue_kinds[
        active_frame_mask & (frame_dbfs < baseline_dbfs - ISSUE_DEVIATION_DB)
    ] = "quiet"
    issue_kinds[
        active_frame_mask & (frame_dbfs > baseline_dbfs + ISSUE_DEVIATION_DB)
    ] = "loud"

    candidates: list[_IssueCandidate] = []
    for frame_index, kind_value in enumerate(issue_kinds):
        if kind_value not in {"quiet", "loud"}:
            continue
        kind = cast(VolumeIssueKind, kind_value)
        start_seconds = frame_index * HOP_LENGTH / decoded_audio.sample_rate_hz
        end_seconds = min(
            (frame_index * HOP_LENGTH + FRAME_LENGTH) / decoded_audio.sample_rate_hz,
            decoded_audio.duration_seconds,
        )
        deviation_db = float(frame_dbfs[frame_index] - baseline_dbfs)
        _merge_issue_candidate(
            candidates,
            kind,
            start_seconds,
            end_seconds,
            deviation_db,
        )

    return _finalize_issue_segments(candidates)


def _merge_issue_candidate(
    candidates: list[_IssueCandidate],
    kind: VolumeIssueKind,
    start_seconds: float,
    end_seconds: float,
    deviation_db: float,
) -> None:
    if (
        candidates
        and candidates[-1].kind == kind
        and start_seconds - candidates[-1].end_seconds <= MERGE_GAP_SECONDS
    ):
        candidates[-1].end_seconds = max(candidates[-1].end_seconds, end_seconds)
        candidates[-1].deviations_db.append(deviation_db)
        return

    candidates.append(
        _IssueCandidate(
            kind=kind,
            start_seconds=start_seconds,
            end_seconds=end_seconds,
            deviations_db=[deviation_db],
        )
    )


def _finalize_issue_segments(
    candidates: list[_IssueCandidate],
) -> list[VolumeIssueSegment]:
    issue_segments: list[VolumeIssueSegment] = []
    for candidate in candidates:
        duration_seconds = candidate.end_seconds - candidate.start_seconds
        if duration_seconds < MINIMUM_ISSUE_SECONDS:
            continue
        issue_segments.append(
            VolumeIssueSegment(
                kind=candidate.kind,
                startSeconds=round(candidate.start_seconds, 3),
                endSeconds=round(candidate.end_seconds, 3),
                durationSeconds=round(duration_seconds, 3),
                meanDeviationDb=round(float(np.mean(candidate.deviations_db)), 2),
            )
        )

    representative_segments = sorted(
        issue_segments,
        key=lambda segment: (
            segment.duration_seconds * abs(segment.mean_deviation_db),
            segment.duration_seconds,
            abs(segment.mean_deviation_db),
        ),
        reverse=True,
    )[:MAXIMUM_ISSUE_SEGMENTS]
    return sorted(representative_segments, key=lambda segment: segment.start_seconds)
