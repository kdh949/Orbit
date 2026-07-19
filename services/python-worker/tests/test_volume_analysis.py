from __future__ import annotations

import io
import wave

import numpy as np
import pytest

from app.audio.analysis import decoder
from app.audio.analysis.decoder import decode_audio
from app.audio.analysis.models import AudioAnalysisError, DecodedAudio
from app.audio.analysis.service import analyze_volume_safely
from app.audio.analysis.volume import (
    _IssueCandidate,
    _finalize_issue_segments,
    _merge_issue_candidate,
    analyze_volume,
)
from app.audio.models import AudioContent

SAMPLE_RATE_HZ = 16_000


def test_analyze_volume_measures_constant_active_audio() -> None:
    decoded_audio = _decoded_audio(np.full(SAMPLE_RATE_HZ * 3, 0.1, np.float32))

    analysis = analyze_volume(decoded_audio)

    assert analysis.measurement_state == "measured"
    assert analysis.average_dbfs == pytest.approx(-20, abs=0.1)
    assert analysis.baseline_dbfs == pytest.approx(-20, abs=0.1)
    assert analysis.variation_db == pytest.approx(0, abs=0.1)
    assert analysis.active_ratio == 1
    assert analysis.issue_segments == []


def test_analyze_volume_finds_quiet_and_loud_blocks() -> None:
    samples = np.concatenate(
        [
            np.full(SAMPLE_RATE_HZ * 2, 0.1, np.float32),
            np.full(int(SAMPLE_RATE_HZ * 2.5), 0.02, np.float32),
            np.full(SAMPLE_RATE_HZ * 2, 0.1, np.float32),
            np.full(int(SAMPLE_RATE_HZ * 2.5), 0.5, np.float32),
            np.full(SAMPLE_RATE_HZ * 2, 0.1, np.float32),
        ]
    )

    analysis = analyze_volume(_decoded_audio(samples))

    assert [segment.kind for segment in analysis.issue_segments] == ["quiet", "loud"]
    assert all(segment.duration_seconds >= 2 for segment in analysis.issue_segments)
    assert analysis.issue_segments[0].mean_deviation_db < -6
    assert analysis.issue_segments[1].mean_deviation_db > 6


def test_analyze_volume_does_not_report_silence_as_quiet_speech() -> None:
    samples = np.concatenate(
        [
            np.full(SAMPLE_RATE_HZ * 2, 0.1, np.float32),
            np.zeros(SAMPLE_RATE_HZ * 2, np.float32),
            np.full(SAMPLE_RATE_HZ * 2, 0.1, np.float32),
        ]
    )

    analysis = analyze_volume(_decoded_audio(samples))

    assert analysis.measurement_state == "measured"
    assert analysis.active_ratio < 1
    assert analysis.issue_segments == []


def test_volume_issues_merge_same_kind_across_a_one_second_gap() -> None:
    candidates: list[_IssueCandidate] = []
    _merge_issue_candidate(candidates, "quiet", 0, 1.2, -7)
    _merge_issue_candidate(candidates, "quiet", 2, 3.2, -8)

    segments = _finalize_issue_segments(candidates)

    assert len(segments) == 1
    assert segments[0].start_seconds == 0
    assert segments[0].end_seconds == 3.2
    assert segments[0].duration_seconds == 3.2


def test_volume_issues_keep_only_five_most_significant_segments_in_time_order() -> None:
    candidates = [
        _IssueCandidate(
            kind="quiet",
            start_seconds=index * 10,
            end_seconds=index * 10 + 2 + index,
            deviations_db=[-7],
        )
        for index in range(6)
    ]

    segments = _finalize_issue_segments(candidates)

    assert len(segments) == 5
    assert [segment.start_seconds for segment in segments] == [10, 20, 30, 40, 50]


def test_analyze_volume_rejects_short_active_audio() -> None:
    decoded_audio = _decoded_audio(np.full(SAMPLE_RATE_HZ // 2, 0.1, np.float32))

    with pytest.raises(AudioAnalysisError) as error:
        analyze_volume(decoded_audio)

    assert error.value.reason_code == "INSUFFICIENT_ACTIVE_AUDIO"


def test_decode_audio_converts_stereo_44khz_to_mono_16khz() -> None:
    duration_seconds = 2
    time_axis = np.arange(44_100 * duration_seconds) / 44_100
    mono_samples = 0.2 * np.sin(2 * np.pi * 220 * time_axis)
    stereo_samples = np.column_stack((mono_samples, mono_samples))
    audio_content = AudioContent(
        data=_wav_bytes(stereo_samples, sample_rate_hz=44_100),
        file_name="stereo.wav",
        mime_type="audio/wav",
    )

    decoded_audio = decode_audio(audio_content)

    assert decoded_audio.sample_rate_hz == SAMPLE_RATE_HZ
    assert decoded_audio.samples.ndim == 1
    assert decoded_audio.duration_seconds == pytest.approx(duration_seconds, abs=0.02)


def test_decode_audio_returns_bounded_reason_for_corrupted_file() -> None:
    audio_content = AudioContent(
        data=b"not an audio file",
        file_name="broken.wav",
        mime_type="audio/wav",
    )

    with pytest.raises(AudioAnalysisError) as error:
        decode_audio(audio_content)

    assert error.value.reason_code == "AUDIO_DECODE_FAILED"


def test_decode_audio_returns_empty_audio_reason() -> None:
    audio_content = AudioContent(
        data=b"",
        file_name="empty.wav",
        mime_type="audio/wav",
    )

    with pytest.raises(AudioAnalysisError) as error:
        decode_audio(audio_content)

    assert error.value.reason_code == "EMPTY_AUDIO"


def test_decode_audio_returns_no_stream_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeContainer:
        streams: list[object] = []

        def __enter__(self) -> FakeContainer:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

    monkeypatch.setattr(decoder.av, "open", lambda *_args, **_kwargs: FakeContainer())
    audio_content = AudioContent(
        data=b"container",
        file_name="video.mp4",
        mime_type="video/mp4",
    )

    with pytest.raises(AudioAnalysisError) as error:
        decode_audio(audio_content)

    assert error.value.reason_code == "NO_AUDIO_STREAM"


def test_safe_analysis_never_returns_non_finite_values() -> None:
    audio_content = AudioContent(
        data=_wav_bytes(np.full(SAMPLE_RATE_HZ * 2, 0.1, np.float32)),
        file_name="constant.wav",
        mime_type="audio/wav",
    )

    analysis = analyze_volume_safely(audio_content)

    values = [
        analysis.average_dbfs,
        analysis.baseline_dbfs,
        analysis.variation_db,
        analysis.active_ratio,
    ]
    assert all(value is not None and np.isfinite(value) for value in values)
    assert all(
        0 <= segment.start_seconds < segment.end_seconds <= 2.01
        for segment in analysis.issue_segments
    )


def _decoded_audio(
    samples: np.ndarray[tuple[int], np.dtype[np.float32]],
) -> DecodedAudio:
    return DecodedAudio(
        samples=samples,
        sample_rate_hz=SAMPLE_RATE_HZ,
        duration_seconds=float(samples.size / SAMPLE_RATE_HZ),
    )


def _wav_bytes(
    samples: np.ndarray[object, np.dtype[np.floating]],
    *,
    sample_rate_hz: int = SAMPLE_RATE_HZ,
) -> bytes:
    normalized_samples = np.clip(samples, -1, 1)
    pcm_samples = (normalized_samples * np.iinfo(np.int16).max).astype(np.int16)
    channel_count = 1 if pcm_samples.ndim == 1 else pcm_samples.shape[1]
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(channel_count)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate_hz)
        wav_file.writeframes(pcm_samples.tobytes())
    return buffer.getvalue()
