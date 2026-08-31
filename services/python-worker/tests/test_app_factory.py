from app.app_factory import create_app
from fastapi.testclient import TestClient


def test_app_factory_registers_extracted_routes_once() -> None:
    app = create_app()
    paths = app.openapi()["paths"]

    assert app.title == "ORBIT Python Worker"
    assert app.version == "0.1.0"
    assert "/health" in paths
    assert "/extract/reference" in paths
    assert "/references/index" in paths
    assert "/references/search" in paths

    assert set(paths["/health"]) == {"get"}
    assert set(paths["/extract/reference"]) == {"post"}
    assert set(paths["/references/index"]) == {"post"}
    assert set(paths["/references/search"]) == {"post"}


def test_internal_metrics_endpoint_exposes_bounded_http_labels() -> None:
    client = TestClient(create_app())

    assert client.get("/health").status_code == 200
    response = client.get("/internal/metrics")

    assert response.status_code == 200
    assert "orbit_python_http_requests_total" in response.text
    assert 'route="/health"' in response.text
    assert "request_private_123" not in response.text


def test_app_factory_preserves_the_public_endpoint_inventory() -> None:
    app = create_app()
    paths = app.openapi()["paths"]

    assert {path: set(methods) for path, methods in paths.items()} == {
        "/ai/deck-color-customization": {"post"},
        "/ai/deck-color-options": {"post"},
        "/ai/design-agent/propose": {"post"},
        "/ai/export-deck-pptx": {"post"},
        "/ai/export-pptx-png-zip": {"post"},
        "/ai/extract-semantic-cues": {"post"},
        "/ai/generate-deck": {"post"},
        "/ai/pptx-ooxml-generation": {"post"},
        "/ai/pptx-ooxml-sync": {"post"},
        "/ai/repair-deck-visuals": {"post"},
        "/ai/review-deck-visuals": {"post"},
        "/ai/speaker-notes/suggest": {"post"},
        "/audio/clip": {"post"},
        "/audio/transcribe": {"post"},
        "/audio/transcribe-private": {"post"},
        "/challenge-qna/analyze-answer": {"post"},
        "/challenge-qna/generate": {"post"},
        "/design/import-pptx": {"post"},
        "/documents/parse": {"post"},
        "/extract/reference": {"post"},
        "/focused-practice/analyze": {"post"},
        "/health": {"get"},
        "/internal/ai/deck-generation/content-planning": {"post"},
        "/internal/ai/deck-generation/design-planning": {"post"},
        "/internal/ai/deck-generation/layout-compile": {"post"},
        "/internal/ai/deck-generation/slide-compose": {"post"},
        "/internal/ai/deck-generation/source-grounding": {"post"},
        "/references/index": {"post"},
        "/references/search": {"post"},
        "/rehearsal/analyze": {"post"},
        "/rehearsal/analyze-semantic-cues": {"post"},
        "/rehearsal/progress-comment": {"post"},
        "/slide-practice/analyze-audio": {"post"},
        "/slide-practice/coaching": {"post"},
        "/slide-question-guides/generate": {"post"},
    }
