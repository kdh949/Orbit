from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.challenge_qna import router as challenge_qna_router
from app.config import load_config
from app.focused_practice import router as focused_practice_router
from app.routers.health import router as health_router
from app.routers.references import router as references_router
from app.slide_question_guides import router as slide_question_guides_router


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
    app.include_router(health_router)
    app.include_router(references_router)
    app.include_router(challenge_qna_router)
    app.include_router(slide_question_guides_router)
    app.include_router(focused_practice_router)
    return app
