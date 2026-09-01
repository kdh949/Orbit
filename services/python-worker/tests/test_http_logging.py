import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry.trace import SpanContext, TraceFlags, TraceState

from app.http_logging import install_http_trace_logging, serialize_http_log_record


def _span_context() -> SpanContext:
    return SpanContext(
        trace_id=int("0123456789abcdef0123456789abcdef", 16),
        span_id=int("0123456789abcdef", 16),
        is_remote=False,
        trace_flags=TraceFlags(TraceFlags.SAMPLED),
        trace_state=TraceState(),
    )


def test_http_completion_log_uses_route_template_and_trace_context() -> None:
    records: list[dict[str, object]] = []
    app = FastAPI()
    install_http_trace_logging(
        app,
        emit=lambda record: records.append(dict(record)),
        span_context_getter=_span_context,
    )

    @app.post("/items/{item_id}")
    async def create_item(item_id: str) -> dict[str, str]:
        return {"itemId": item_id}

    response = TestClient(app).post(
        "/items/private-item?token=secret-query",
        json={"password": "secret-body"},
    )

    assert response.status_code == 200
    assert len(records) == 1
    record = records[0]
    assert record["service"] == "orbit-python-worker"
    assert record["event"] == "http.request.completed"
    assert record["method"] == "POST"
    assert record["route"] == "/items/{item_id}"
    assert record["statusCode"] == 200
    assert isinstance(record["durationMs"], float)
    assert record["traceId"] == "0123456789abcdef0123456789abcdef"
    assert record["spanId"] == "0123456789abcdef"

    encoded = serialize_http_log_record(record)
    assert json.loads(encoded) == record
    assert "private-item" not in encoded
    assert "secret-query" not in encoded
    assert "secret-body" not in encoded


def test_http_log_omits_trace_fields_without_an_active_span() -> None:
    records: list[dict[str, object]] = []
    app = FastAPI()
    install_http_trace_logging(
        app,
        emit=lambda record: records.append(dict(record)),
        span_context_getter=lambda: None,
    )

    @app.get("/ready")
    async def ready() -> dict[str, bool]:
        return {"ready": True}

    assert TestClient(app).get("/ready").status_code == 200
    assert "traceId" not in records[0]
    assert "spanId" not in records[0]


def test_http_error_log_redacts_exception_and_reraises() -> None:
    records: list[dict[str, object]] = []
    app = FastAPI()
    install_http_trace_logging(
        app,
        emit=lambda record: records.append(dict(record)),
        span_context_getter=_span_context,
    )

    @app.get("/fail/{item_id}")
    async def fail(item_id: str) -> None:
        raise RuntimeError(f"provider token leaked for {item_id}")

    with pytest.raises(RuntimeError, match="provider token leaked"):
        TestClient(app).get("/fail/private-item?token=secret-query")

    assert len(records) == 1
    assert records[0]["event"] == "http.request.failed"
    assert records[0]["route"] == "/fail/{item_id}"
    assert records[0]["statusCode"] == 500
    encoded = serialize_http_log_record(records[0])
    assert "provider token leaked" not in encoded
    assert "private-item" not in encoded
    assert "secret-query" not in encoded


@pytest.mark.parametrize("path", ["/health", "/internal/metrics"])
def test_http_log_excludes_probe_routes(path: str) -> None:
    records: list[dict[str, object]] = []
    app = FastAPI()
    install_http_trace_logging(
        app,
        emit=lambda record: records.append(dict(record)),
        span_context_getter=lambda: None,
    )

    @app.get(path)
    async def probe() -> dict[str, bool]:
        return {"ok": True}

    assert TestClient(app).get(path).status_code == 200
    assert records == []
