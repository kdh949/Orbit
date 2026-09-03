from app.app_factory import create_app
from app.metrics import HTTP_DURATION, current_trace_exemplar_labels, install_metrics
from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.sampling import ALWAYS_ON
from opentelemetry.trace import INVALID_SPAN_CONTEXT, SpanContext, TraceFlags
from prometheus_client.openmetrics.exposition import CONTENT_TYPE_LATEST


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
    assert response.headers["content-type"] == CONTENT_TYPE_LATEST
    assert "orbit_python_http_requests_total" in response.text
    assert 'route="/health"' in response.text
    assert "request_private_123" not in response.text


def test_internal_metrics_endpoint_exports_sampled_latency_exemplars() -> None:
    provider = TracerProvider(sampler=ALWAYS_ON)
    tracer = provider.get_tracer(__name__)

    with tracer.start_as_current_span("metrics-test"):
        exemplar = current_trace_exemplar_labels()
        HTTP_DURATION.labels("GET", "/health", "2xx").observe(0.125, exemplar=exemplar)

    assert exemplar is not None

    response = TestClient(create_app()).get("/internal/metrics")

    exemplar_line = next(
        line
        for line in response.text.splitlines()
        if "orbit_python_http_request_duration_seconds_bucket" in line and "# {" in line
    )
    assert f'traceID="{exemplar["traceID"]}"' in exemplar_line
    assert f'spanID="{exemplar["spanID"]}"' in exemplar_line
    assert "} 0.125 " in exemplar_line


def test_inactive_trace_does_not_create_exemplar_labels() -> None:
    assert current_trace_exemplar_labels() is None


def test_unsampled_trace_does_not_create_exemplar_labels(monkeypatch) -> None:
    span = type(
        "RecordingSpan",
        (),
        {
            "is_recording": lambda self: True,
            "get_span_context": lambda self: SpanContext(
                trace_id=int("0123456789abcdef0123456789abcdef", 16),
                span_id=int("0123456789abcdef", 16),
                is_remote=False,
                trace_flags=TraceFlags.DEFAULT,
            ),
        },
    )()
    monkeypatch.setattr(trace, "get_current_span", lambda: span)

    assert current_trace_exemplar_labels() is None


def test_invalid_trace_does_not_create_exemplar_labels(monkeypatch) -> None:
    span = type(
        "RecordingSpan",
        (),
        {
            "is_recording": lambda self: True,
            "get_span_context": lambda self: INVALID_SPAN_CONTEXT,
        },
    )()
    monkeypatch.setattr(trace, "get_current_span", lambda: span)

    assert current_trace_exemplar_labels() is None


def test_metrics_middleware_records_the_outer_fastapi_trace() -> None:
    app = FastAPI()
    install_metrics(app)
    FastAPIInstrumentor.instrument_app(
        app,
        tracer_provider=TracerProvider(sampler=ALWAYS_ON),
        excluded_urls="^/internal/metrics$",
        exclude_spans=["receive", "send"],
    )

    @app.get("/exemplar-probe")
    def exemplar_probe() -> dict[str, bool]:
        return {"ok": True}

    try:
        client = TestClient(app)
        assert client.get("/exemplar-probe").status_code == 200
        response = client.get("/internal/metrics")
    finally:
        FastAPIInstrumentor.uninstrument_app(app)

    exemplar_line = next(
        line
        for line in response.text.splitlines()
        if "orbit_python_http_request_duration_seconds_bucket" in line
        and 'route="/exemplar-probe"' in line
        and "# {" in line
    )
    assert "traceID=" in exemplar_line
    assert "spanID=" in exemplar_line


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
