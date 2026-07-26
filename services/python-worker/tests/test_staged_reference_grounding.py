from collections import Counter
from types import SimpleNamespace
from typing import Any

import pytest

import app.main as api_module
import app.routers.ai_deck as ai_deck_router
from app.ai.deck_generation.content_planning import (
    deck_content_prompt,
    story_source_records,
)
from app.ai.deck_generation.design_planning import resolve_style_prompt_context
from app.ai.deck_generation.models import (
    DeckContentGenerationError,
    GenerateDeckRequest,
    SourceGroundingResult,
    SourceRecord,
)
from app.ai.deck_generation.pipeline import analyze_input
from app.ai.deck_generation.source_grounding import initial_source_records
from app.ai.deck_generation.stage_runtime import SourceGroundingStageInput
from app.references import EmbeddingResult, ReferenceSearchResult
from tests.test_config import VALID_ENV


def chunk(
    file_id: str,
    index: int,
    score: float,
    content: str,
    *,
    project_id: str = "project-a",
) -> ReferenceSearchResult:
    return ReferenceSearchResult(
        chunk_id=f"{file_id}-chunk-{index}",
        project_id=project_id,
        file_id=file_id,
        chunk_index=index,
        content=content,
        metadata={"fileName": f"{file_id}.pdf"},
        score=score,
    )


def config() -> Any:
    return api_module.load_config(VALID_ENV)


def test_staged_retrieval_uses_full_query_balances_files_and_keeps_late_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}
    overlap = "overlap text that should appear once"
    candidates = [
        chunk("file-1", 0, 0.99, f"opening {overlap}"),
        chunk("file-1", 1, 0.98, f"{overlap} LATE_DOCUMENT_FACT"),
        chunk("file-1", 2, 0.97, "duplicate   content"),
        chunk("file-1", 3, 0.50, "duplicate content"),
        chunk("file-2", 0, 0.60, "second file evidence"),
        chunk("file-other", 0, 1.0, "must not leak"),
        chunk("file-2", 1, 1.0, "wrong project", project_id="project-b"),
    ]

    def fake_search(**kwargs: Any) -> tuple[list[ReferenceSearchResult], EmbeddingResult]:
        captured.update(kwargs)
        return candidates, EmbeddingResult(status="succeeded", embeddings=[[0.1]])

    monkeypatch.setattr(ai_deck_router, "search_reference_chunks_by_file", fake_search)
    request = GenerateDeckRequest(
        projectId="project-a",
        topic="발표 주제",
        prompt="발표 내용",
        brief={"audienceText": "실무 담당자"},
        metadata={"audience": "executive"},
        referencePolicy="references-only",
        references=[{"fileId": "file-1"}, {"fileId": "file-2"}],
        referenceKeywords=[{"text": "핵심 키워드"}],
        referenceContext=[
            {"fileId": "file-1", "content": "x" * 2000},
            {"fileId": "file-2", "content": "y" * 2000},
        ],
    )

    contexts, degraded = api_module._staged_reference_context(request, config())

    assert degraded is False
    assert captured["project_id"] == "project-a"
    assert captured["file_ids"] == ["file-1", "file-2"]
    assert captured["limit_per_file"] == 3
    assert all(
        value in str(captured["query"])
        for value in [
            "발표 주제",
            "발표 내용",
            "실무 담당자",
            "executive",
            "핵심 키워드",
        ]
    )
    assert {context.file_id for context in contexts} == {"file-1", "file-2"}
    assert [context.file_id for context in contexts[:2]] == ["file-1", "file-2"]
    assert len([context for context in contexts if context.file_id == "file-1"]) == 3
    assert next(
        context.content for context in contexts if context.chunk_id == "file-1-chunk-1"
    ) == "LATE_DOCUMENT_FACT"
    assert all(context.source_id and context.chunk_id for context in contexts)

    raw_input = analyze_input(request, reference_context=contexts)
    raw_input.source_records = initial_source_records(raw_input)
    prompt = deck_content_prompt(raw_input, resolve_style_prompt_context(raw_input))
    assert "LATE_DOCUMENT_FACT" in prompt
    assert "x" * 1600 not in prompt


def test_policy_selection_limits_and_fallbacks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    candidates = [
        chunk(file_id, index, 1 - index / 10 - file_number / 100, f"{file_id}-{index}")
        for file_number, file_id in enumerate(
            ["file-1", "file-2", "file-3", "file-4", "file-5"]
        )
        for index in range(3)
    ]
    monkeypatch.setattr(
        ai_deck_router,
        "search_reference_chunks_by_file",
        lambda **_kwargs: (
            candidates,
            EmbeddingResult(status="succeeded", embeddings=[[0.1]]),
        ),
    )
    file_ids = [f"file-{index}" for index in range(1, 6)]
    request = GenerateDeckRequest(
        projectId="project-a",
        topic="topic",
        referencePolicy="references-first",
        references=[{"fileId": file_id} for file_id in file_ids],
        referenceContext=[
            {"fileId": file_id, "content": f"fallback {file_id}"}
            for file_id in file_ids
        ],
    )

    contexts, degraded = api_module._staged_reference_context(request, config())

    counts = Counter(context.file_id for context in contexts)
    assert degraded is False
    assert len(contexts) == 12
    assert set(counts) == set(file_ids)
    assert max(counts.values()) <= 3

    research_contexts, _ = api_module._staged_reference_context(
        request.model_copy(update={"reference_policy": "research-first"}),
        config(),
    )
    assert len(research_contexts) == 4


def test_references_only_requires_an_indexed_chunk_for_every_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        ai_deck_router,
        "search_reference_chunks_by_file",
        lambda **_kwargs: (
            [chunk("file-1", 0, 0.9, "indexed")],
            EmbeddingResult(status="succeeded", embeddings=[[0.1]]),
        ),
    )
    request = GenerateDeckRequest(
        projectId="project-a",
        topic="topic",
        referencePolicy="references-only",
        references=[{"fileId": "file-1"}, {"fileId": "file-2"}],
        referenceContext=[
            {"fileId": "file-1", "content": "direct one"},
            {"fileId": "file-2", "content": "direct two"},
        ],
    )

    with pytest.raises(DeckContentGenerationError, match="SOURCE_GROUNDING_REQUIRED"):
        api_module._staged_reference_context(request, config())


def test_references_first_degrades_and_user_input_only_skips_search(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0

    def failed_search(**_kwargs: Any) -> tuple[list[ReferenceSearchResult], EmbeddingResult]:
        nonlocal calls
        calls += 1
        return [], EmbeddingResult(status="failed")

    monkeypatch.setattr(ai_deck_router, "search_reference_chunks_by_file", failed_search)
    request = GenerateDeckRequest(
        projectId="project-a",
        topic="topic",
        referencePolicy="references-first",
        references=[{"fileId": "file-1"}],
        referenceContext=[{"fileId": "file-1", "content": "direct fallback"}],
    )

    contexts, degraded = api_module._staged_reference_context(request, config())
    assert degraded is True
    assert [context.content for context in contexts] == ["direct fallback"]

    contexts, degraded = api_module._staged_reference_context(
        request.model_copy(update={"reference_policy": "user-input-only"}),
        config(),
    )
    assert contexts == []
    assert degraded is False
    assert calls == 1

    direct_only = GenerateDeckRequest(
        projectId="project-a",
        topic="topic",
        referencePolicy="references-first",
        referenceContext=[{"fileId": "file-direct", "content": "direct context"}],
    )
    contexts, degraded = api_module._staged_reference_context(direct_only, config())
    assert [context.content for context in contexts] == ["direct context"]
    assert degraded is False
    assert calls == 1


def test_degraded_stage_adds_safe_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ai_deck_router,
        "search_reference_chunks_by_file",
        lambda **_kwargs: ([], EmbeddingResult(status="failed")),
    )

    def fake_stage(stage_input: SourceGroundingStageInput, **_kwargs: Any) -> SourceGroundingResult:
        raw_input = analyze_input(stage_input.request)
        raw_input.source_records = initial_source_records(raw_input)
        return SourceGroundingResult(
            rawInput=raw_input,
            sourceRecords=raw_input.source_records,
        )

    monkeypatch.setattr(ai_deck_router, "run_source_grounding_stage", fake_stage)
    api_module.app.state.config = config()
    result = api_module.source_grounding_stage(
        SourceGroundingStageInput(
            request={
                "projectId": "project-a",
                "topic": "topic",
                "referencePolicy": "references-first",
                "references": [{"fileId": "file-1"}],
                "referenceContext": [
                    {"fileId": "file-1", "content": "direct fallback"}
                ],
            }
        ),
        SimpleNamespace(app=api_module.app),  # type: ignore[arg-type]
    )

    assert "REFERENCE_CHUNK_RETRIEVAL_DEGRADED" in result.raw_input.warning_codes
    assert any("continued" in warning for warning in result.warnings)


def test_story_evidence_budget_is_policy_specific() -> None:
    raw_input = analyze_input(
        GenerateDeckRequest(projectId="project-a", topic="topic")
    )
    topic = SourceRecord(
        sourceType="topic", sourceId="topic:brief", content="topic"
    )
    uploaded = [
        SourceRecord(
            sourceType="uploaded",
            sourceId=f"uploaded:{index}",
            content=f"uploaded {index}",
        )
        for index in range(15)
    ]
    web = [
        SourceRecord(
            sourceType="web",
            sourceId=f"web:{index}",
            content=f"web {index}",
        )
        for index in range(10)
    ]
    raw_input.source_records = [topic, *uploaded, *web]

    raw_input.brief.reference_policy = "references-first"
    assert len(story_source_records(raw_input)) == 13
    assert all(
        record.source_type != "web" for record in story_source_records(raw_input)
    )

    raw_input.brief.reference_policy = "research-first"
    research = story_source_records(raw_input)
    assert [record.source_type for record in research] == [
        "topic",
        *(["web"] * 8),
        *(["uploaded"] * 4),
    ]

    raw_input.brief.reference_policy = "user-input-only"
    assert story_source_records(raw_input) == [topic]
