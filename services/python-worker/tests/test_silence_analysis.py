from __future__ import annotations

import numpy as np
import pytest

from app.audio.analysis import service
from app.audio.analysis.models import AudioAnalysisError, DecodedAudio
from app.audio.analysis.silence import MAXIMUM_SILENCE_SEGMENTS, analyze_silence
from app.audio.analysis.vad import SpeechRange, get_voice_activity_detector
from app.audio.models import AudioContent

SAMPLE_RATE_HZ = 16_000


class FakeVoiceActivityDetector:
    detector_version = "test-vad"

    def __init__(self, speech_ranges: list[SpeechRange]) -> None:
        self._speech_ranges = speech_ranges

    def detect_speech(self, decoded_audio: DecodedAudio) -> list[SpeechRange]:
        return self._speech_ranges


class FailingVoiceActivityDetector:
    detector_version = "test-vad"

    def detect_speech(self, decoded_audio: DecodedAudio) -> list[SpeechRange]:
        raise AudioAnalysisError("ANALYSIS_FAILED")


@pytest.mark.parametrize(
    ("silence_samples", "expected_category"),
    [
        (3_999, None),
        (4_000, "brief"),
        (79_999, "brief"),
        (80_000, "long"),
    ],
)
def test_analyze_silence_applies_250ms_and_5000ms_boundaries(
    silence_samples: int,
    expected_category: str | None,
) -> None:
    first_speech = SpeechRange(start_sample=8_000, end_sample=24_000)
    second_start = first_speech.end_sample + silence_samples
    second_speech = SpeechRange(
        start_sample=second_start,
        end_sample=second_start + 16_000,
    )

    analysis = analyze_silence(
        _decoded_audio(second_speech.end_sample + 8_000),
        FakeVoiceActivityDetector([first_speech, second_speech]),
    )

    if expected_category is None:
        assert analysis.segments == []
        assert analysis.detected_segment_count == 0
        return
    assert analysis.segments[0].category == expected_category
    assert analysis.segments[0].duration_seconds == pytest.approx(
        silence_samples / SAMPLE_RATE_HZ,
        abs=0.001,
    )


def test_analyze_silence_excludes_leading_and_trailing_silence() -> None:
    analysis = analyze_silence(
        _decoded_audio(96_000),
        FakeVoiceActivityDetector(
            [
                SpeechRange(start_sample=16_000, end_sample=32_000),
                SpeechRange(start_sample=48_000, end_sample=64_000),
            ]
        ),
    )

    assert analysis.analysis_window_start_seconds == 1.0
    assert analysis.analysis_window_end_seconds == 4.0
    assert analysis.total_silence_seconds == 1.0
    assert analysis.silence_ratio == pytest.approx(1 / 3, abs=0.0001)
    assert [
        (segment.start_seconds, segment.end_seconds) for segment in analysis.segments
    ] == [(2.0, 3.0)]


def test_analyze_silence_sorts_and_merges_overlapping_speech_ranges() -> None:
    analysis = analyze_silence(
        _decoded_audio(80_000),
        FakeVoiceActivityDetector(
            [
                SpeechRange(start_sample=40_000, end_sample=56_000),
                SpeechRange(start_sample=8_000, end_sample=24_000),
                SpeechRange(start_sample=20_000, end_sample=32_000),
            ]
        ),
    )

    assert len(analysis.segments) == 1
    assert analysis.segments[0].start_seconds == 2.0
    assert analysis.segments[0].end_seconds == 2.5


@pytest.mark.parametrize(
    "speech_ranges",
    [
        [SpeechRange(start_sample=5_000, end_sample=4_000)],
        [SpeechRange(start_sample=-1, end_sample=16_000)],
        [SpeechRange(start_sample=32_000, end_sample=48_000)],
    ],
)
def test_analyze_silence_rejects_invalid_speech_ranges(
    speech_ranges: list[SpeechRange],
) -> None:
    with pytest.raises(AudioAnalysisError, match="ANALYSIS_FAILED"):
        analyze_silence(
            _decoded_audio(32_000),
            FakeVoiceActivityDetector(speech_ranges),
        )


def test_analyze_silence_requires_at_least_one_second_of_speech() -> None:
    with pytest.raises(AudioAnalysisError, match="INSUFFICIENT_SPEECH"):
        analyze_silence(
            _decoded_audio(32_000),
            FakeVoiceActivityDetector([SpeechRange(start_sample=0, end_sample=15_999)]),
        )


def test_analyze_silence_counts_before_truncating_segments() -> None:
    speech_ranges: list[SpeechRange] = []
    cursor = 0
    for _ in range(MAXIMUM_SILENCE_SEGMENTS + 2):
        speech_ranges.append(SpeechRange(start_sample=cursor, end_sample=cursor + 16))
        cursor += 16 + 4_000

    analysis = analyze_silence(
        _decoded_audio(cursor),
        FakeVoiceActivityDetector(speech_ranges),
    )

    assert len(analysis.segments) == MAXIMUM_SILENCE_SEGMENTS
    assert analysis.detected_segment_count == MAXIMUM_SILENCE_SEGMENTS + 1
    assert analysis.segments_truncated is True
    assert analysis.long_silence_count == 0


def test_silero_vad_smoke_loads_model_and_accepts_silence() -> None:
    detector = get_voice_activity_detector()

    speech_ranges = detector.detect_speech(_decoded_audio(SAMPLE_RATE_HZ))

    assert detector.detector_version != "unavailable"
    assert speech_ranges == []


def test_audio_analysis_decodes_once_and_shares_decoded_audio(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    decoded_audio = _decoded_audio(32_000)
    decode_count = 0
    volume_inputs: list[DecodedAudio] = []
    silence_inputs: list[DecodedAudio] = []

    def fake_decode_audio(_audio_content: AudioContent) -> DecodedAudio:
        nonlocal decode_count
        decode_count += 1
        return decoded_audio

    def fake_analyze_volume(audio: DecodedAudio):
        volume_inputs.append(audio)
        return service.unmeasured_volume_analysis("ANALYSIS_FAILED")

    def fake_analyze_silence(audio: DecodedAudio, _detector: object):
        silence_inputs.append(audio)
        return service.unmeasured_silence_analysis(
            "ANALYSIS_FAILED",
            detector_version="test-vad",
        )

    monkeypatch.setattr(service, "decode_audio", fake_decode_audio)
    monkeypatch.setattr(service, "analyze_volume", fake_analyze_volume)
    monkeypatch.setattr(service, "analyze_silence", fake_analyze_silence)

    service.analyze_audio_safely(
        AudioContent(data=b"audio", file_name="audio.wav", mime_type="audio/wav"),
        FakeVoiceActivityDetector([]),
    )

    assert decode_count == 1
    assert volume_inputs == [decoded_audio]
    assert silence_inputs == [decoded_audio]


def test_vad_failure_does_not_discard_volume_measurement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    time = np.arange(32_000, dtype=np.float32) / SAMPLE_RATE_HZ
    samples = (0.2 * np.sin(2 * np.pi * 220 * time)).astype(np.float32)
    decoded_audio = DecodedAudio(
        samples=samples,
        sample_rate_hz=SAMPLE_RATE_HZ,
        duration_seconds=2,
    )
    monkeypatch.setattr(service, "decode_audio", lambda _audio: decoded_audio)

    volume, silence = service.analyze_audio_safely(
        AudioContent(data=b"audio", file_name="audio.wav", mime_type="audio/wav"),
        FailingVoiceActivityDetector(),
    )

    assert volume.measurement_state == "measured"
    assert silence.measurement_state == "unmeasured"
    assert silence.reason_code == "ANALYSIS_FAILED"


def _decoded_audio(sample_count: int) -> DecodedAudio:
    return DecodedAudio(
        samples=np.zeros(sample_count, dtype=np.float32),
        sample_rate_hz=SAMPLE_RATE_HZ,
        duration_seconds=sample_count / SAMPLE_RATE_HZ,
    )
