from __future__ import annotations

from pydantic import ConfigDict, Field

from app.audio.analysis.models import (
    RehearsalSilenceAnalysis,
    RehearsalVolumeAnalysis,
)
from app.audio.analysis.service import analyze_audio_safely
from app.audio.analysis.vad import VoiceActivityDetector
from app.audio.source import load_audio_content
from app.audio.transcribe import (
    AudioTranscribeRequest,
    AudioTranscribeResponse,
    ReportSttProvider,
    build_audio_transcribe_response,
    transcribe_audio_content,
)


class RehearsalAudioProcessingResponse(AudioTranscribeResponse):
    model_config = ConfigDict(populate_by_name=True)

    volume_analysis: RehearsalVolumeAnalysis = Field(alias="volumeAnalysis")
    silence_analysis: RehearsalSilenceAnalysis = Field(alias="silenceAnalysis")


def process_rehearsal_audio(
    payload: AudioTranscribeRequest,
    provider: ReportSttProvider,
    detector: VoiceActivityDetector | None = None,
) -> RehearsalAudioProcessingResponse:
    """원본 음성을 한 번 로드해 STT와 독립 음향 분석에 공유한다."""
    audio_content = load_audio_content(payload.audio)
    provider_transcription = transcribe_audio_content(
        audio_content,
        provider,
        payload.pronunciation_context,
    )
    volume_analysis, silence_analysis = analyze_audio_safely(
        audio_content,
        detector,
    )
    transcription_response = build_audio_transcribe_response(
        payload,
        provider_transcription,
    )

    return RehearsalAudioProcessingResponse(
        **transcription_response.model_dump(),
        volumeAnalysis=volume_analysis,
        silenceAnalysis=silence_analysis,
    )
