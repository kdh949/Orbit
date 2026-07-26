from __future__ import annotations

from fastapi.testclient import TestClient

import app.main as api_module
from app.routers import references as references_router
from app.references import (
    EMBEDDING_DIMENSION,
    EmbeddingResult,
    PostgresReferenceRepository,
    ReferenceChunkInput,
    ReferenceSearchResult,
    create_embeddings,
    index_reference_text,
    search_reference_chunks,
    search_reference_chunks_by_file,
    split_reference_text,
)
from tests.test_config import VALID_ENV


class FakeRepository:
    def __init__(self) -> None:
        self.chunks: list[ReferenceChunkInput] = []
        self.search_project_id = ""
        self.search_embedding: list[float] = []
        self.search_file_ids: list[str] | None = None
        self.project_id = ""
        self.file_id = ""

    def replace_chunks(
        self,
        project_id: str,
        file_id: str,
        chunks: list[ReferenceChunkInput],
    ) -> None:
        self.chunks = list(chunks)
        self.project_id = project_id
        self.file_id = file_id

    def search_chunks(
        self,
        project_id: str,
        query_embedding: list[float],
        *,
        limit: int = 6,
        file_ids: list[str] | None = None,
    ) -> list[ReferenceSearchResult]:
        self.search_project_id = project_id
        self.search_embedding = query_embedding
        self.search_file_ids = file_ids
        return [
            ReferenceSearchResult(
                chunk_id="chunk-1",
                project_id=project_id,
                file_id="file-1",
                chunk_index=0,
                content="grounded evidence",
                metadata={"fileName": "source.pdf"},
                score=0.91,
            )
        ][:limit]


class FakeEmbeddingClient:
    class Embeddings:
        def __init__(self, parent: "FakeEmbeddingClient") -> None:
            self.parent = parent

        def create(self, *, model: str, input: list[str]) -> object:
            self.parent.requests.append((model, input))
            data = [
                type("Embedding", (), {"embedding": [0.01] * EMBEDDING_DIMENSION})()
                for _ in input
            ]
            return type("EmbeddingResponse", (), {"data": data})()

    def __init__(self) -> None:
        self.requests: list[tuple[str, list[str]]] = []
        self.embeddings = self.Embeddings(self)


class FailingEmbeddingClient:
    class Embeddings:
        def create(self, *, model: str, input: list[str]) -> object:
            raise RuntimeError("embedding failed")

    embeddings = Embeddings()


def test_split_reference_text_uses_metadata_and_hashes() -> None:
    text = "\n\n".join(f"paragraph {index} " + ("x" * 120) for index in range(20))

    chunks = split_reference_text(text, metadata={"fileId": "file-1"})

    assert len(chunks) > 1
    assert all(len(chunk.content) <= 1500 for chunk in chunks)
    assert chunks[0].metadata["fileId"] == "file-1"
    assert chunks[0].metadata["chunkIndex"] == 0
    assert chunks[0].content_hash


def test_index_reference_text_replaces_project_file_chunks() -> None:
    repository = FakeRepository()

    result = index_reference_text(
        repository=repository,
        project_id="project-a",
        file_id="file-1",
        text="cleaned text\n\n" * 80,
        embedding_client=FakeEmbeddingClient(),
    )

    assert result.status == "indexed"
    assert repository.project_id == "project-a"
    assert repository.file_id == "file-1"
    assert repository.chunks
    assert repository.chunks[0].project_id == "project-a"
    assert repository.chunks[0].file_id == "file-1"


def test_index_reference_text_marks_embedding_failure() -> None:
    repository = FakeRepository()

    result = index_reference_text(
        repository=repository,
        project_id="project-a",
        file_id="file-1",
        text="cleaned text",
        embedding_client=FailingEmbeddingClient(),
    )

    assert result.status == "failed"
    assert repository.chunks == []
    assert "embedding failed" in result.message


def test_search_reference_chunks_applies_project_boundary() -> None:
    repository = FakeRepository()

    results, embedding_result = search_reference_chunks(
        repository=repository,
        project_id="project-a",
        query="deck topic",
        file_ids=["file-1"],
        embedding_client=FakeEmbeddingClient(),
    )

    assert embedding_result.status == "succeeded"
    assert repository.search_project_id == "project-a"
    assert repository.search_embedding == [0.01] * EMBEDDING_DIMENSION
    assert repository.search_file_ids == ["file-1"]
    assert results[0].project_id == "project-a"
    assert results[0].content == "grounded evidence"


def test_search_reference_chunks_by_file_embeds_once() -> None:
    class PerFileRepository(FakeRepository):
        def __init__(self) -> None:
            super().__init__()
            self.calls: list[tuple[str, list[str] | None, int]] = []
            self.failed_file_id = ""

        def search_chunks(
            self,
            project_id: str,
            query_embedding: list[float],
            *,
            limit: int = 6,
            file_ids: list[str] | None = None,
        ) -> list[ReferenceSearchResult]:
            self.calls.append((project_id, file_ids, limit))
            file_id = (file_ids or ["missing"])[0]
            if file_id == self.failed_file_id:
                raise RuntimeError("file search failed")
            return [
                ReferenceSearchResult(
                    chunk_id=f"chunk-{file_id}",
                    project_id=project_id,
                    file_id=file_id,
                    chunk_index=0,
                    content=f"evidence {file_id}",
                    metadata={},
                    score=0.9,
                )
            ]

    repository = PerFileRepository()
    embedding_client = FakeEmbeddingClient()

    results, embedding_result = search_reference_chunks_by_file(
        repository=repository,
        project_id="project-a",
        query="topic prompt audience keyword",
        file_ids=["file-1", "file-2", "file-1"],
        embedding_client=embedding_client,
    )

    assert embedding_result.status == "succeeded"
    assert len(embedding_client.requests) == 1
    assert repository.calls == [
        ("project-a", ["file-1"], 3),
        ("project-a", ["file-2"], 3),
    ]
    assert [result.file_id for result in results] == ["file-1", "file-2"]

    repository.failed_file_id = "file-2"
    partial, _ = search_reference_chunks_by_file(
        repository=repository,
        project_id="project-a",
        query="topic",
        file_ids=["file-1", "file-2"],
        embedding_client=FakeEmbeddingClient(),
    )
    assert [result.file_id for result in partial] == ["file-1"]


def test_postgres_search_filters_file_ids_before_limit(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeCursor:
        def __enter__(self) -> "FakeCursor":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def execute(self, query: str, params: tuple[object, ...]) -> None:
            captured["query"] = query
            captured["params"] = params

        def fetchall(self) -> list[tuple[object, ...]]:
            return []

    class FakeConnection:
        def __enter__(self) -> "FakeConnection":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def cursor(self) -> FakeCursor:
            return FakeCursor()

    repository = PostgresReferenceRepository("postgres://unused")
    monkeypatch.setattr(repository, "_connect", lambda: FakeConnection())

    repository.search_chunks(
        "project-a",
        [0.01] * EMBEDDING_DIMENSION,
        file_ids=["file-selected"],
        limit=2,
    )

    query = str(captured["query"])
    assert query.index("file_id = ANY(%s)") < query.index("LIMIT %s")
    assert captured["params"] == (
        "[" + ",".join(["0.01"] * EMBEDDING_DIMENSION) + "]",
        "project-a",
        ["file-selected"],
        "[" + ",".join(["0.01"] * EMBEDDING_DIMENSION) + "]",
        2,
    )


def test_create_embeddings_reports_missing_api_key() -> None:
    result = create_embeddings(["hello"], api_key=None)

    assert result.status == "unavailable"
    assert result.embeddings == []


def test_references_search_endpoint_keeps_project_boundary(monkeypatch) -> None:
    def fake_search_reference_chunks(**kwargs: object) -> object:
        assert kwargs["project_id"] == "project-b"
        return (
            [
                ReferenceSearchResult(
                    chunk_id="chunk-1",
                    project_id="project-b",
                    file_id="file-1",
                    chunk_index=0,
                    content="project scoped evidence",
                    metadata={},
                    score=0.93,
                )
            ],
            EmbeddingResult(status="succeeded"),
        )

    monkeypatch.setattr(
        references_router,
        "search_reference_chunks",
        fake_search_reference_chunks,
    )
    api_module.app.state.config = api_module.load_config(VALID_ENV)

    response = TestClient(api_module.app).post(
        "/references/search",
        json={"projectId": "project-b", "query": "deck", "limit": 1},
    )

    assert response.status_code == 200
    assert response.json()["projectId"] == "project-b"
    assert response.json()["chunks"][0]["projectId"] == "project-b"
