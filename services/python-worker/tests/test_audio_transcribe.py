from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.audio import processing
from app.audio.analysis.models import (
    unmeasured_silence_analysis,
    unmeasured_volume_analysis,
)
from app.audio.transcribe import (
    AudioTranscribeRequest,
    AudioTranscriptionError,
    AudioContent,
    OpenAISpeechToTextProvider,
    PronunciationContextTerm,
    ProviderTranscription,
    SpeechToTextProvider,
    TranscriptSegment,
    WhisperXSpeechToTextProvider,
    create_speech_to_text_provider,
    get_speech_to_text_provider,
    transcribe_rehearsal_audio,
)
from app.config import ConfigError, load_config
from app.main import app
from tests.test_config import VALID_ENV


class FakeSpeechToTextProvider:
    name = "fake"
    model = "fake-transcriber"

    def __init__(self, transcript: str = "안녕하세요 ORBIT 리허설입니다") -> None:
        self.transcript = transcript
        self.last_audio: AudioContent | None = None

    def transcribe(
        self,
        audio: AudioContent,
        pronunciation_context: list[PronunciationContextTerm] | None = None,
    ) -> ProviderTranscription:
        self.last_audio = audio
        return ProviderTranscription(
            transcript=self.transcript,
            language="ko-KR",
            provider=self.name,
            model=self.model,
            duration_seconds=3.5,
            segments=[
                TranscriptSegment(
                    text=self.transcript,
                    startSeconds=0,
                    endSeconds=3.5,
                )
            ],
        )


class FailingSpeechToTextProvider:
    name = "fake"
    model = "failing-transcriber"

    def transcribe(
        self,
        audio: AudioContent,
        pronunciation_context: list[PronunciationContextTerm] | None = None,
    ) -> ProviderTranscription:
        raise RuntimeError(f"failed for {audio.file_name}")


def test_transcribe_audio_returns_fixture_transcript(tmp_path: Path) -> None:
    audio_path = tmp_path / "rehearsal.wav"
    audio_path.write_bytes(b"fake wav bytes")
    provider = FakeSpeechToTextProvider()

    response = transcribe_rehearsal_audio(
        _request(audio_path),
        provider,
    )

    assert response.run_id == "run_demo_1"
    assert response.project_id == "project_demo_1"
    assert response.file_id == "file_demo_1"
    assert response.transcript == "안녕하세요 ORBIT 리허설입니다"
    assert response.language == "ko-KR"
    assert response.provider == "fake"
    assert response.model == "fake-transcriber"
    assert response.duration_seconds == 3.5
    assert len(response.segments) == 1
    assert provider.last_audio is not None
    assert provider.last_audio.data == b"fake wav bytes"


def test_rehearsal_processing_loads_once_and_shares_audio_content(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    audio_path = tmp_path / "rehearsal.wav"
    audio_path.write_bytes(b"fake wav bytes")
    audio_content = AudioContent(
        data=b"shared audio bytes",
        file_name="rehearsal.wav",
        mime_type="audio/wav",
    )
    provider = FakeSpeechToTextProvider()
    analyzed_audio: list[AudioContent] = []
    load_count = 0

    def fake_load_audio_content(_reference: object) -> AudioContent:
        nonlocal load_count
        load_count += 1
        return audio_content

    def fake_analyze_audio_safely(audio: AudioContent, _detector: object):
        analyzed_audio.append(audio)
        return (
            unmeasured_volume_analysis("ANALYSIS_FAILED"),
            unmeasured_silence_analysis(
                "ANALYSIS_FAILED",
                detector_version="test-vad",
            ),
        )

    monkeypatch.setattr(processing, "load_audio_content", fake_load_audio_content)
    monkeypatch.setattr(
        processing,
        "analyze_audio_safely",
        fake_analyze_audio_safely,
    )

    response = processing.process_rehearsal_audio(_request(audio_path), provider)

    assert load_count == 1
    assert provider.last_audio is audio_content
    assert analyzed_audio == [audio_content]
    assert response.volume_analysis.reason_code == "ANALYSIS_FAILED"
    assert response.silence_analysis.reason_code == "ANALYSIS_FAILED"


def test_audio_reference_accepts_flac_mime_type(tmp_path: Path) -> None:
    audio_path = tmp_path / "rehearsal.flac"
    audio_path.write_bytes(b"fake flac bytes")

    request = AudioTranscribeRequest.model_validate(
        {
            "runId": "run_demo_1",
            "projectId": "project_demo_1",
            "audio": {
                "fileId": "file_demo_1",
                "storageUrl": str(audio_path),
                "mimeType": "audio/flac",
            },
        }
    )

    assert request.audio.mime_type == "audio/flac"


def test_transcribe_audio_wraps_provider_failure(tmp_path: Path) -> None:
    audio_path = tmp_path / "rehearsal.wav"
    audio_path.write_bytes(b"fake wav bytes")

    with pytest.raises(AudioTranscriptionError) as error:
        transcribe_rehearsal_audio(_request(audio_path), FailingSpeechToTextProvider())

    assert error.value.code == "stt_provider_failed"
    assert error.value.status_code == 502


def test_invalid_audio_reference_requires_readable_source() -> None:
    with pytest.raises(ValidationError, match="objectKey or storageUrl"):
        AudioTranscribeRequest.model_validate(
            {
                "runId": "run_demo_1",
                "projectId": "project_demo_1",
                "audio": {
                    "fileId": "file_demo_1",
                    "mimeType": "audio/wav",
                },
            }
        )


def test_missing_audio_file_returns_predictable_error(tmp_path: Path) -> None:
    with pytest.raises(AudioTranscriptionError) as error:
        transcribe_rehearsal_audio(
            _request(tmp_path / "missing.wav"),
            FakeSpeechToTextProvider(),
        )

    assert error.value.code == "file_access_failed"
    assert error.value.status_code == 404


def test_report_stt_provider_rejects_non_openai_values() -> None:
    with pytest.raises(ConfigError, match="REPORT_STT_PROVIDER"):
        load_config({**VALID_ENV, "REPORT_STT_PROVIDER": "sherpa"})


def test_openai_stt_requires_api_key() -> None:
    config = load_config(VALID_ENV)

    with pytest.raises(AudioTranscriptionError) as error:
        create_speech_to_text_provider(config)

    assert error.value.code == "provider_not_configured"
    assert "OPENAI_API_KEY" in error.value.message


def test_create_provider_selects_whisperx() -> None:
    config = load_config(
        {
            **VALID_ENV,
            "REPORT_STT_PROVIDER": "whisperx",
            "WHISPERX_API_URL": "https://whisperx.example.test/transcribe",
            "WHISPERX_API_KEY": "whisperx-test-key",
            "WHISPERX_MODEL": "large-v3",
        }
    )

    provider = create_speech_to_text_provider(config)

    assert isinstance(provider, WhisperXSpeechToTextProvider)
    assert provider.name == "whisperx"
    assert provider.model == "large-v3"


def test_gpt4o_transcribe_uses_json_response_format(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    class FakeTranscriptions:
        def create(self, **kwargs: object) -> dict[str, str]:
            calls.append(kwargs)
            return {"text": "테스트 전사"}

    class FakeOpenAI:
        def __init__(self, *, api_key: str) -> None:
            self.api_key = api_key
            self.audio = SimpleNamespace(transcriptions=FakeTranscriptions())

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=FakeOpenAI))

    provider = OpenAISpeechToTextProvider(
        api_key="test-key",
        model="gpt-4o-transcribe",
        language="ko-KR",
    )
    result = provider.transcribe(
        AudioContent(
            data=b"fake webm bytes",
            file_name="rehearsal.webm",
            mime_type="audio/webm",
        )
    )

    assert result.transcript == "테스트 전사"
    assert calls[0]["response_format"] == "json"


def test_openai_stt_uses_bounded_pronunciation_context_as_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    class FakeTranscriptions:
        def create(self, **kwargs: object) -> dict[str, str]:
            calls.append(kwargs)
            return {"text": "오픈에이아이 에이피아이"}

    class FakeOpenAI:
        def __init__(self, *, api_key: str) -> None:
            self.audio = SimpleNamespace(transcriptions=FakeTranscriptions())

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=FakeOpenAI))
    provider = OpenAISpeechToTextProvider(
        api_key="test-key",
        model="whisper-1",
        language="ko-KR",
    )

    provider.transcribe(
        AudioContent(
            data=b"fake webm bytes",
            file_name="rehearsal.webm",
            mime_type="audio/webm",
        ),
        [
            PronunciationContextTerm(
                source="OpenAI",
                aliases=["오픈에이아이", "오픈 AI"],
            ),
            PronunciationContextTerm(source="API", aliases=["에이피아이"]),
        ],
    )

    assert calls[0]["prompt"] == (
        "발표 용어 표기와 발음: OpenAI(오픈에이아이, 오픈 AI), API(에이피아이)."
    )


def test_whisper1_uses_verbose_json_and_parses_segments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    class FakeTranscriptions:
        def create(self, **kwargs: object) -> dict[str, object]:
            calls.append(kwargs)
            return {
                "text": "첫 문장 다음 문장",
                "language": "korean",
                "duration": 12.5,
                "segments": [
                    {"text": "첫 문장", "start": 0.0, "end": 2.0},
                    {"text": "다음 문장", "start": 5.0, "end": 7.5},
                ],
            }

    class FakeOpenAI:
        def __init__(self, *, api_key: str) -> None:
            self.api_key = api_key
            self.audio = SimpleNamespace(transcriptions=FakeTranscriptions())

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=FakeOpenAI))

    provider = OpenAISpeechToTextProvider(
        api_key="test-key",
        model="whisper-1",
        language="ko-KR",
    )
    result = provider.transcribe(
        AudioContent(
            data=b"fake webm bytes",
            file_name="rehearsal.webm",
            mime_type="audio/webm",
        )
    )

    # whisper-1은 verbose_json 응답을 써야 세그먼트/duration이 채워진다.
    assert calls[0]["response_format"] == "verbose_json"
    assert result.transcript == "첫 문장 다음 문장"
    assert result.language == "ko"
    assert result.duration_seconds == 12.5
    assert len(result.segments) == 2
    assert result.segments[0].start_seconds == 0.0
    assert result.segments[0].end_seconds == 2.0
    assert result.segments[1].start_seconds == 5.0
    assert result.segments[1].end_seconds == 7.5


def test_whisperx_provider_posts_multipart_and_normalizes_response() -> None:
    calls: list[tuple[object, float]] = []

    def fake_urlopen(request: object, *, timeout: float) -> FakeHttpResponse:
        calls.append((request, timeout))
        return FakeHttpResponse(
            {
                "transcript": "발표 화면 테스트",
                "language": "ko",
                "provider": "whisperx",
                "model": "large-v3",
                "durationSeconds": 2.5,
                "segments": [
                    {
                        "text": "발표 화면 테스트",
                        "startSeconds": 0,
                        "endSeconds": 2.5,
                    }
                ],
            }
        )

    provider = WhisperXSpeechToTextProvider(
        api_url="https://whisperx.example.test/transcribe",
        api_key="whisperx-test-key",
        model="large-v3",
        language="ko-KR",
        timeout_ms=45_000,
        opener=fake_urlopen,
    )

    result = provider.transcribe(
        AudioContent(
            data=b"fake flac bytes",
            file_name="rehearsal.flac",
            mime_type="audio/flac",
        )
    )

    request, timeout = calls[0]
    body = request.data.decode("latin1")  # type: ignore[attr-defined]
    assert timeout == 45
    assert request.headers["Authorization"] == "Bearer whisperx-test-key"  # type: ignore[attr-defined]
    assert "multipart/form-data" in request.headers["Content-type"]  # type: ignore[attr-defined]
    assert 'name="language"' in body
    assert "ko" in body
    assert 'name="model"' in body
    assert "large-v3" in body
    assert 'name="file"; filename="rehearsal.flac"' in body
    assert "fake flac bytes" in body
    assert result.transcript == "발표 화면 테스트"
    assert result.language == "ko"
    assert result.provider == "whisperx"
    assert result.duration_seconds == 2.5
    assert result.segments[0].start_seconds == 0
    assert result.segments[0].end_seconds == 2.5


def test_whisperx_provider_sanitizes_multipart_filename() -> None:
    calls: list[object] = []

    def fake_urlopen(request: object, *, timeout: float) -> FakeHttpResponse:
        calls.append(request)
        return FakeHttpResponse(
            {
                "transcript": "파일명 테스트",
                "segments": [
                    {
                        "text": "파일명 테스트",
                        "startSeconds": 0,
                        "endSeconds": 1,
                    }
                ],
            }
        )

    provider = WhisperXSpeechToTextProvider(
        api_url="https://whisperx.example.test/transcribe",
        api_key="whisperx-test-key",
        model="large-v3",
        language="ko-KR",
        timeout_ms=30_000,
        opener=fake_urlopen,
    )

    provider.transcribe(
        AudioContent(
            data=b"fake flac bytes",
            file_name=(
                'deck"\\\r\nX-Injected: yes\r\n\r\n--fake-part\r\n'
                'Content-Disposition: form-data; name="owned"\r\n\r\npayload\x00.flac'
            ),
            mime_type="audio/flac",
        )
    )

    request = calls[0]
    body = request.data.decode("latin1")  # type: ignore[attr-defined]
    file_header = next(
        line for line in body.split("\r\n") if 'name="file"; filename=' in line
    )

    assert file_header == (
        'Content-Disposition: form-data; name="file"; '
        'filename="deck_X-Injected_yes_--fake-part_Content-Disposition_'
        'form-data_name_owned_payload.flac"'
    )
    safe_filename = file_header.split('filename="', maxsplit=1)[1].removesuffix('"')
    assert "\r" not in file_header
    assert "\n" not in file_header
    assert "\x00" not in file_header
    assert "\\" not in safe_filename
    assert "X-Injected: yes\r\n" not in body
    assert 'name="owned"' not in body


def test_whisperx_provider_rejects_empty_transcript() -> None:
    provider = WhisperXSpeechToTextProvider(
        api_url="https://whisperx.example.test/transcribe",
        api_key="whisperx-test-key",
        model="large-v3",
        language="ko-KR",
        timeout_ms=30_000,
        opener=lambda _request, *, timeout: FakeHttpResponse(
            {"transcript": "", "segments": []}
        ),
    )

    with pytest.raises(AudioTranscriptionError) as error:
        provider.transcribe(
            AudioContent(
                data=b"fake flac bytes",
                file_name="rehearsal.flac",
                mime_type="audio/flac",
            )
        )

    assert error.value.code == "empty_transcript"


def test_whisperx_provider_rejects_malformed_segments() -> None:
    provider = WhisperXSpeechToTextProvider(
        api_url="https://whisperx.example.test/transcribe",
        api_key="whisperx-test-key",
        model="large-v3",
        language="ko-KR",
        timeout_ms=30_000,
        opener=lambda _request, *, timeout: FakeHttpResponse(
            {"transcript": "발표 화면 테스트", "segments": {"text": "invalid"}}
        ),
    )

    with pytest.raises(AudioTranscriptionError) as error:
        provider.transcribe(
            AudioContent(
                data=b"fake flac bytes",
                file_name="rehearsal.flac",
                mime_type="audio/flac",
            )
        )

    assert error.value.code == "malformed_provider_response"


@pytest.mark.parametrize(
    "segment",
    [
        {"text": "발표 화면 테스트", "endSeconds": 2.5},
        {"text": "발표 화면 테스트", "startSeconds": "0", "endSeconds": 2.5},
        {"text": "발표 화면 테스트", "startSeconds": 0, "endSeconds": "2.5"},
        {"text": "발표 화면 테스트", "startSeconds": -1, "endSeconds": 2.5},
        {"text": "발표 화면 테스트", "startSeconds": 3, "endSeconds": 2.5},
        {"text": "", "startSeconds": 0, "endSeconds": 2.5},
    ],
)
def test_whisperx_provider_rejects_malformed_segment_fields(
    segment: dict[str, object],
) -> None:
    provider = WhisperXSpeechToTextProvider(
        api_url="https://whisperx.example.test/transcribe",
        api_key="whisperx-test-key",
        model="large-v3",
        language="ko-KR",
        timeout_ms=30_000,
        opener=lambda _request, *, timeout: FakeHttpResponse(
            {"transcript": "발표 화면 테스트", "segments": [segment]}
        ),
    )

    with pytest.raises(AudioTranscriptionError) as error:
        provider.transcribe(
            AudioContent(
                data=b"fake flac bytes",
                file_name="rehearsal.flac",
                mime_type="audio/flac",
            )
        )

    assert error.value.code == "malformed_provider_response"


def test_whisperx_provider_wraps_request_failure() -> None:
    def failing_urlopen(_request: object, *, timeout: float) -> FakeHttpResponse:
        raise OSError("network failed")

    provider = WhisperXSpeechToTextProvider(
        api_url="https://whisperx.example.test/transcribe",
        api_key="whisperx-test-key",
        model="large-v3",
        language="ko-KR",
        timeout_ms=30_000,
        opener=failing_urlopen,
    )

    with pytest.raises(AudioTranscriptionError) as error:
        provider.transcribe(
            AudioContent(
                data=b"fake flac bytes",
                file_name="rehearsal.flac",
                mime_type="audio/flac",
            )
        )

    assert error.value.code == "stt_provider_failed"


def test_whisperx_provider_wraps_auth_failure() -> None:
    def auth_failure(_request: object, *, timeout: float) -> FakeHttpResponse:
        raise HTTPError(
            "https://whisperx.example.test/transcribe",
            401,
            "Unauthorized",
            hdrs=None,
            fp=None,
        )

    provider = WhisperXSpeechToTextProvider(
        api_url="https://whisperx.example.test/transcribe",
        api_key="whisperx-test-key",
        model="large-v3",
        language="ko-KR",
        timeout_ms=30_000,
        opener=auth_failure,
    )

    with pytest.raises(AudioTranscriptionError) as error:
        provider.transcribe(
            AudioContent(
                data=b"fake flac bytes",
                file_name="rehearsal.flac",
                mime_type="audio/flac",
            )
        )

    assert error.value.code == "stt_provider_failed"


def test_whisperx_provider_wraps_timeout() -> None:
    def timeout_urlopen(_request: object, *, timeout: float) -> FakeHttpResponse:
        raise TimeoutError("timed out")

    provider = WhisperXSpeechToTextProvider(
        api_url="https://whisperx.example.test/transcribe",
        api_key="whisperx-test-key",
        model="large-v3",
        language="ko-KR",
        timeout_ms=30_000,
        opener=timeout_urlopen,
    )

    with pytest.raises(AudioTranscriptionError) as error:
        provider.transcribe(
            AudioContent(
                data=b"fake flac bytes",
                file_name="rehearsal.flac",
                mime_type="audio/flac",
            )
        )

    assert error.value.code == "stt_provider_failed"


def test_audio_reference_rejects_unsupported_openai_mime_type(
    tmp_path: Path,
) -> None:
    audio_path = tmp_path / "rehearsal.ogg"
    audio_path.write_bytes(b"fake ogg bytes")

    with pytest.raises(ValidationError, match="unsupported audio mime type"):
        AudioTranscribeRequest.model_validate(
            {
                "runId": "run_demo_1",
                "projectId": "project_demo_1",
                "audio": {
                    "fileId": "file_demo_1",
                    "storageUrl": str(audio_path),
                    "mimeType": "audio/ogg",
                },
            }
        )


def test_audio_transcribe_endpoint_uses_injected_provider(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    audio_path = tmp_path / "rehearsal.webm"
    audio_path.write_bytes(b"fake webm bytes")

    for key, value in VALID_ENV.items():
        monkeypatch.setenv(key, value)

    def provider_override() -> SpeechToTextProvider:
        return FakeSpeechToTextProvider("발표 키워드를 확인했습니다")

    app.dependency_overrides[get_speech_to_text_provider] = provider_override

    try:
        with TestClient(app) as client:
            response = client.post(
                "/audio/transcribe",
                json={
                    "runId": "run_demo_1",
                    "projectId": "project_demo_1",
                    "audio": {
                        "fileId": "file_demo_1",
                        "storageUrl": str(audio_path),
                        "mimeType": "audio/webm",
                    },
                },
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["transcript"] == "발표 키워드를 확인했습니다"
    assert response.json()["volumeAnalysis"] == {
        "metricDefinitionVersion": 2,
        "measurementState": "unmeasured",
        "reasonCode": "AUDIO_DECODE_FAILED",
        "averageDbfs": None,
        "baselineDbfs": None,
        "variationDb": None,
        "activeRatio": None,
        "issueSegments": [],
    }
    silence_analysis = response.json()["silenceAnalysis"]
    assert silence_analysis == {
        "metricDefinitionVersion": 2,
        "measurementState": "unmeasured",
        "reasonCode": "AUDIO_DECODE_FAILED",
        "detector": "silero-vad",
        "detectorVersion": silence_analysis["detectorVersion"],
        "speechThreshold": 0.5,
        "minimumSilenceMs": 250,
        "longSilenceMs": 5000,
        "analysisWindowStartSeconds": None,
        "analysisWindowEndSeconds": None,
        "totalSilenceSeconds": None,
        "silenceRatio": None,
        "longSilenceCount": None,
        "detectedSegmentCount": None,
        "segmentsTruncated": False,
        "segments": [],
    }
    assert response.json()["segments"] == [
        {
            "text": "발표 키워드를 확인했습니다",
            "startSeconds": 0.0,
            "endSeconds": 3.5,
        }
    ]


def test_private_audio_transcribe_endpoint_does_not_run_volume_analysis(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    audio_path = tmp_path / "private.webm"
    audio_path.write_bytes(b"fake webm bytes")

    for key, value in VALID_ENV.items():
        monkeypatch.setenv(key, value)

    def provider_override() -> SpeechToTextProvider:
        return FakeSpeechToTextProvider("집중 연습 전사입니다")

    app.dependency_overrides[get_speech_to_text_provider] = provider_override

    try:
        with TestClient(app) as client:
            response = client.post(
                "/audio/transcribe-private",
                json={
                    "runId": "run_demo_1",
                    "projectId": "project_demo_1",
                    "audio": {
                        "fileId": "file_demo_1",
                        "storageUrl": str(audio_path),
                        "mimeType": "audio/webm",
                    },
                },
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["transcript"] == "집중 연습 전사입니다"
    assert "volumeAnalysis" not in response.json()
    assert "silenceAnalysis" not in response.json()


def _request(audio_path: Path) -> AudioTranscribeRequest:
    return AudioTranscribeRequest.model_validate(
        {
            "runId": "run_demo_1",
            "projectId": "project_demo_1",
            "audio": {
                "fileId": "file_demo_1",
                "storageUrl": str(audio_path),
                "mimeType": "audio/wav",
            },
        }
    )


class FakeHttpResponse:
    def __init__(self, body: object) -> None:
        self.body = body

    def __enter__(self) -> FakeHttpResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self) -> bytes:
        import json

        return json.dumps(self.body).encode("utf-8")
