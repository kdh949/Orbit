from pathlib import Path

from fastapi.testclient import TestClient

import app.main as api_module
import app.routers.documents as documents_router
from app.config import load_config
from app.extraction import (
    ExtractedSection,
    ExtractionResult,
    FileKind,
    KeywordExtractionResult,
    PresentationKeyword,
    ResultStatus,
)
from tests.test_config import VALID_ENV


def test_documents_parse_connects_extraction_cleanup_and_indexing(monkeypatch) -> None:
    def fake_extract_file(source_path: Path, config: object) -> ExtractionResult:
        return ExtractionResult(
            source_path=source_path,
            kind=FileKind.IMAGE,
            status=ResultStatus.SUCCEEDED,
            sections=[
                ExtractedSection(title="Image OCR", text="first block", status="ocr"),
                ExtractedSection(title="Details", text="second block", status="ocr"),
            ],
            message="Image OCR completed.",
        )

    def fake_clean_reference_text(
        raw_text: str,
        *,
        model: str | None = None,
        api_key: str | None = None,
    ) -> object:
        return type(
            "Cleanup",
            (),
            {
                "text": f"cleaned: {raw_text}",
                "status": "succeeded",
                "message": "",
            },
        )()

    def fake_extract_presentation_keywords(
        cleaned_text: str,
        *,
        model: str | None = None,
        api_key: str | None = None,
    ) -> KeywordExtractionResult:
        return KeywordExtractionResult(
            keywords=[
                PresentationKeyword(
                    keyword="실시간 발표 피드백",
                    reason="발표 흐름 개선의 핵심 기능",
                    priority="high",
                )
            ],
            status="succeeded",
        )

    def fake_index_reference_text(**kwargs: object) -> object:
        assert kwargs["project_id"] == "project-a"
        assert kwargs["file_id"] == "file-1"
        assert kwargs["text"] == "cleaned: first block\n\nsecond block"
        assert kwargs["model"] == "text-embedding-3-small"
        return type(
            "IndexResult",
            (),
            {
                "status": "indexed",
                "message": "2 chunks indexed",
                "chunk_count": 2,
            },
        )()

    monkeypatch.setattr(documents_router, "extract_file", fake_extract_file)
    monkeypatch.setattr(
        documents_router, "clean_reference_text", fake_clean_reference_text
    )
    monkeypatch.setattr(
        documents_router,
        "extract_presentation_keywords",
        fake_extract_presentation_keywords,
    )
    monkeypatch.setattr(
        documents_router, "index_reference_text", fake_index_reference_text
    )
    api_module.app.state.config = load_config(VALID_ENV)

    client = TestClient(api_module.app)
    response = client.post(
        "/documents/parse",
        data={"project_id": "project-a", "file_ids": "file-1"},
        files=[("files", ("sample.png", b"fake image bytes", "image/png"))],
    )

    assert response.status_code == 200
    assert response.json()["files"][0] == {
        "projectId": "project-a",
        "referenceDocumentId": "file-1",
        "fileName": "sample.png",
        "kind": "image",
        "status": "succeeded",
        "message": "Image OCR completed.",
        "rawText": "first block\n\nsecond block",
        "cleanedText": "cleaned: first block\n\nsecond block",
        "cleanupStatus": "succeeded",
        "cleanupMessage": "",
        "keywords": [
            {
                "keyword": "실시간 발표 피드백",
                "reason": "발표 흐름 개선의 핵심 기능",
                "priority": "high",
            }
        ],
        "keywordStatus": "succeeded",
        "keywordMessage": "",
        "indexingStatus": "indexed",
        "indexingMessage": "2 chunks indexed",
        "chunkCount": 2,
        "sections": [
            {
                "title": "Image OCR",
                "status": "ocr",
                "index": None,
                "text": "first block",
                "notes": [],
                "metadata": {},
            },
            {
                "title": "Details",
                "status": "ocr",
                "index": None,
                "text": "second block",
                "notes": [],
                "metadata": {},
            },
        ],
    }


def test_documents_parse_returns_ordered_success_and_failure_results(monkeypatch) -> None:
    def fake_extract_file(source_path: Path, config: object) -> ExtractionResult:
        if source_path.name == "usable.pdf":
            return ExtractionResult(
                source_path=source_path,
                kind=FileKind.PDF,
                status=ResultStatus.SUCCEEDED,
                sections=[
                    ExtractedSection(
                        title="PDF text",
                        text="usable reference text",
                        status="text",
                    )
                ],
                message="PDF extraction completed.",
            )
        return ExtractionResult(
            source_path=source_path,
            kind=FileKind.DOCX,
            status=ResultStatus.FAILED,
            message="Document extraction failed.",
        )

    def fake_clean_reference_text(
        raw_text: str,
        *,
        model: str | None = None,
        api_key: str | None = None,
    ) -> object:
        return type(
            "Cleanup",
            (),
            {"text": raw_text, "status": "succeeded", "message": ""},
        )()

    def fake_extract_presentation_keywords(
        cleaned_text: str,
        *,
        model: str | None = None,
        api_key: str | None = None,
    ) -> KeywordExtractionResult:
        return KeywordExtractionResult(keywords=[], status="succeeded")

    def fake_index_reference_text(**kwargs: object) -> object:
        has_text = bool(str(kwargs["text"]).strip())
        return type(
            "IndexResult",
            (),
            {
                "status": "indexed" if has_text else "skipped",
                "message": "",
                "chunk_count": 1 if has_text else 0,
            },
        )()

    monkeypatch.setattr(documents_router, "extract_file", fake_extract_file)
    monkeypatch.setattr(
        documents_router, "clean_reference_text", fake_clean_reference_text
    )
    monkeypatch.setattr(
        documents_router,
        "extract_presentation_keywords",
        fake_extract_presentation_keywords,
    )
    monkeypatch.setattr(
        documents_router, "index_reference_text", fake_index_reference_text
    )
    api_module.app.state.config = load_config(VALID_ENV)

    client = TestClient(api_module.app)
    response = client.post(
        "/documents/parse",
        data={
            "project_id": "project-a",
            "file_ids": ["file-1", "file-2"],
        },
        files=[
            ("files", ("usable.pdf", b"pdf", "application/pdf")),
            (
                "files",
                (
                    "broken.docx",
                    b"docx",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ),
            ),
        ],
    )

    assert response.status_code == 200
    files = response.json()["files"]
    assert [file["referenceDocumentId"] for file in files] == ["file-1", "file-2"]
    assert [file["fileName"] for file in files] == ["usable.pdf", "broken.docx"]
    assert [file["status"] for file in files] == ["succeeded", "failed"]
    assert files[0]["rawText"] == "usable reference text"
    assert files[1]["rawText"] == ""
    assert files[1]["message"] == "Document extraction failed."
