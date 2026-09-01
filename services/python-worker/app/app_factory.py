from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.challenge_qna import router as challenge_qna_router
from app.config import load_config
from app.focused_practice import router as focused_practice_router
from app.http_logging import install_http_trace_logging
from app.metrics import install_metrics
from app.routers.ai_deck import router as ai_deck_router
from app.routers.audio import router as audio_router
from app.routers.documents import router as documents_router
from app.routers.health import router as health_router
from app.routers.pptx import router as pptx_router
from app.routers.references import router as references_router
from app.routers.rehearsal import router as rehearsal_router
from app.slide_question_guides import router as slide_question_guides_router
from app.telemetry import configure_python_profiling, configure_python_telemetry


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.config = load_config()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="ORBIT Python Worker",
        version="0.1.0",
        lifespan=lifespan,
    )
    configure_python_profiling()
    install_http_trace_logging(app)
    configure_python_telemetry(app)
    install_metrics(app)
    app.include_router(health_router)
    app.include_router(documents_router)
    app.include_router(pptx_router)
    app.include_router(audio_router)
    app.include_router(ai_deck_router)
    app.include_router(rehearsal_router)
    app.include_router(references_router)
    app.include_router(challenge_qna_router)
    app.include_router(slide_question_guides_router)
    app.include_router(focused_practice_router)
    return app
