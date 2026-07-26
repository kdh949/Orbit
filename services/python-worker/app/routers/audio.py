from fastapi import File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from fastapi.concurrency import run_in_threadpool

from app.audio.clip import create_rehearsal_audio_clip
from app.audio.models import AudioContent
from app.audio.transcribe import (
    AudioTranscribeRequest,
    AudioTranscribeResponse,
    AudioTranscriptionError,
    ReportSttProviderDependency,
    to_http_exception,
    transcribe_rehearsal_audio,
)
from app.audio.processing import (
    RehearsalAudioProcessingResponse,
    process_rehearsal_audio,
)
from app.audio.slide_practice import (
    SlidePracticeAudioResponse,
    process_slide_practice_audio,
)
from app.slide_practice_coaching import (
    SlidePracticeCoachingError,
    SlidePracticeCoachingRequest,
    SlidePracticeCoachingResponse,
    generate_slide_practice_coaching,
)
from app.config import load_config as load_config
from app.routers.health import health as health


from fastapi import APIRouter
from app.routers.dependencies import config_from_request as _config

router = APIRouter()


@router.post("/audio/clip")
async def create_rehearsal_audio_clip_endpoint(
    request: Request,
    file: UploadFile = File(...),
    start_seconds: float = Form(..., alias="startSeconds"),
    end_seconds: float = Form(..., alias="endSeconds"),
) -> Response:
    config = _config(request)
    audio_bytes = await file.read(config.rehearsal_audio_max_bytes + 1)
    if len(audio_bytes) > config.rehearsal_audio_max_bytes:
        raise HTTPException(status_code=413, detail="rehearsal audio is too large")

    try:
        clip_bytes = await run_in_threadpool(
            create_rehearsal_audio_clip,
            AudioContent(
                data=audio_bytes,
                file_name=file.filename or "rehearsal-audio",
                mime_type=file.content_type or "application/octet-stream",
            ),
            start_seconds,
            end_seconds,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=422, detail="audio clip generation failed"
        ) from error

    return Response(
        content=clip_bytes,
        media_type="audio/wav",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.post("/audio/transcribe-private", response_model=AudioTranscribeResponse)
def transcribe_private_audio_endpoint(
    payload: AudioTranscribeRequest,
    provider: ReportSttProviderDependency,
) -> AudioTranscribeResponse:
    try:
        return transcribe_rehearsal_audio(payload, provider)
    except AudioTranscriptionError as exc:
        raise to_http_exception(exc) from exc


@router.post("/audio/transcribe", response_model=RehearsalAudioProcessingResponse)
def process_rehearsal_audio_endpoint(
    payload: AudioTranscribeRequest,
    provider: ReportSttProviderDependency,
) -> RehearsalAudioProcessingResponse:
    try:
        return process_rehearsal_audio(payload, provider)
    except AudioTranscriptionError as exc:
        raise to_http_exception(exc) from exc


@router.post("/slide-practice/analyze-audio", response_model=SlidePracticeAudioResponse)
def process_slide_practice_audio_endpoint(
    payload: AudioTranscribeRequest,
    provider: ReportSttProviderDependency,
) -> SlidePracticeAudioResponse:
    try:
        return process_slide_practice_audio(payload, provider)
    except AudioTranscriptionError as exc:
        raise to_http_exception(exc) from exc


@router.post(
    "/slide-practice/coaching",
    response_model=SlidePracticeCoachingResponse,
)
def generate_slide_practice_coaching_endpoint(
    payload: SlidePracticeCoachingRequest,
    request: Request,
) -> SlidePracticeCoachingResponse:
    config = _config(request)
    try:
        return generate_slide_practice_coaching(
            payload,
            model=config.openai_model,
            api_key=config.openai_api_key,
        )
    except SlidePracticeCoachingError as error:
        raise HTTPException(
            status_code=503,
            detail="Slide practice coaching generation failed.",
        ) from error
