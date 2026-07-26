from typing import Any, Literal, cast

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from app.config import PythonWorkerConfig
from app.references import (
    PostgresReferenceRepository,
    index_reference_text,
    search_reference_chunks,
)

router = APIRouter()


class ReferenceExtractRequest(BaseModel):
    file_id: str = Field(alias="fileId")
    project_id: str = Field(alias="projectId")
    mime_type: str = Field(alias="mimeType")
    text: str = ""


class ReferenceExtractResponse(BaseModel):
    file_id: str = Field(alias="fileId")
    project_id: str = Field(alias="projectId")
    text: str


class ReferenceIndexRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    file_id: str = Field(alias="fileId")
    project_id: str = Field(alias="projectId")
    text: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ReferenceIndexResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    file_id: str = Field(alias="fileId")
    project_id: str = Field(alias="projectId")
    status: str
    message: str = ""
    chunk_count: int = Field(alias="chunkCount")


class ReferenceSearchRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    project_id: str = Field(alias="projectId")
    query: str = Field(min_length=1)
    limit: int = Field(default=6, ge=1, le=20)


class ReferenceSearchChunk(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    chunk_id: str = Field(alias="chunkId")
    project_id: str = Field(alias="projectId")
    file_id: str = Field(alias="fileId")
    chunk_index: int = Field(alias="chunkIndex")
    content: str
    metadata: dict[str, Any]
    score: float


class ReferenceSearchResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    project_id: str = Field(alias="projectId")
    query: str
    status: Literal["succeeded", "unavailable", "failed"]
    message: str = ""
    chunks: list[ReferenceSearchChunk]


@router.post("/extract/reference", response_model=ReferenceExtractResponse)
def extract_reference(payload: ReferenceExtractRequest) -> ReferenceExtractResponse:
    text = payload.text.strip()
    return ReferenceExtractResponse(
        fileId=payload.file_id,
        projectId=payload.project_id,
        text=text or f"stub extraction for {payload.file_id} ({payload.mime_type})",
    )


@router.post("/references/index", response_model=ReferenceIndexResponse)
def index_reference(
    payload: ReferenceIndexRequest,
    request: Request,
) -> ReferenceIndexResponse:
    config = _config(request)
    result = index_reference_text(
        repository=PostgresReferenceRepository(config.database_url),
        project_id=payload.project_id,
        file_id=payload.file_id,
        text=payload.text,
        metadata=payload.metadata,
        model=config.openai_embedding_model,
        api_key=config.openai_api_key,
    )

    return ReferenceIndexResponse(
        fileId=payload.file_id,
        projectId=payload.project_id,
        status=result.status,
        message=result.message,
        chunkCount=result.chunk_count,
    )


@router.post("/references/search", response_model=ReferenceSearchResponse)
def search_references(
    payload: ReferenceSearchRequest,
    request: Request,
) -> ReferenceSearchResponse:
    config = _config(request)
    results, embedding_result = search_reference_chunks(
        repository=PostgresReferenceRepository(config.database_url),
        project_id=payload.project_id,
        query=payload.query,
        limit=payload.limit,
        model=config.openai_embedding_model,
        api_key=config.openai_api_key,
    )

    return ReferenceSearchResponse(
        projectId=payload.project_id,
        query=payload.query,
        status=_search_status(embedding_result.status),
        message=embedding_result.message,
        chunks=[
            ReferenceSearchChunk(
                chunkId=result.chunk_id,
                projectId=result.project_id,
                fileId=result.file_id,
                chunkIndex=result.chunk_index,
                content=result.content,
                metadata=result.metadata,
                score=result.score,
            )
            for result in results
        ],
    )


def _config(request: Request) -> PythonWorkerConfig:
    return cast(PythonWorkerConfig, request.app.state.config)


def _search_status(status: str) -> Literal["succeeded", "unavailable", "failed"]:
    if status in {"succeeded", "unavailable", "failed"}:
        return cast(Literal["succeeded", "unavailable", "failed"], status)
    return "failed"
