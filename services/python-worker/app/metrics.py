from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from time import perf_counter
from typing import Any

from fastapi import FastAPI, Request, Response
from opentelemetry import trace
from opentelemetry.trace import TraceFlags
from prometheus_client import REGISTRY, Counter, Histogram
from prometheus_client.openmetrics.exposition import (
    CONTENT_TYPE_LATEST,
    generate_latest,
)

HTTP_REQUESTS = Counter(
    "orbit_python_http_requests_total",
    "Completed Python worker HTTP requests.",
    ("method", "route", "status_class"),
)
HTTP_DURATION = Histogram(
    "orbit_python_http_request_duration_seconds",
    "Python worker HTTP request duration in seconds.",
    ("method", "route", "status_class"),
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 30, 60),
)


def current_trace_exemplar_labels() -> dict[str, str] | None:
    span = trace.get_current_span()
    if not span.is_recording():
        return None

    span_context = span.get_span_context()
    if not span_context.is_valid or not (span_context.trace_flags & TraceFlags.SAMPLED):
        return None

    return {
        "traceID": f"{span_context.trace_id:032x}",
        "spanID": f"{span_context.span_id:016x}",
    }


def install_metrics(app: FastAPI) -> None:
    app.add_api_route(
        "/internal/metrics",
        metrics_endpoint,
        methods=["GET"],
        include_in_schema=False,
    )

    @app.middleware("http")
    async def record_http_metrics(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.url.path == "/internal/metrics":
            return await call_next(request)

        started_at = perf_counter()
        exemplar = current_trace_exemplar_labels()
        try:
            response = await call_next(request)
        except Exception:
            labels = {
                "method": _method(request.method),
                "route": _route(request.scope),
                "status_class": "5xx",
            }
            HTTP_REQUESTS.labels(**labels).inc()
            HTTP_DURATION.labels(**labels).observe(
                perf_counter() - started_at, exemplar=exemplar
            )
            raise

        labels = {
            "method": _method(request.method),
            "route": _route(request.scope),
            "status_class": _status_class(response.status_code),
        }
        HTTP_REQUESTS.labels(**labels).inc()
        HTTP_DURATION.labels(**labels).observe(
            perf_counter() - started_at, exemplar=exemplar
        )
        return response


def metrics_endpoint() -> Response:
    return Response(
        content=generate_latest(REGISTRY),  # type: ignore[no-untyped-call]
        headers={"Cache-Control": "no-store", "Content-Type": CONTENT_TYPE_LATEST},
    )


def _route(scope: Mapping[str, Any]) -> str:
    route = scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) and path.startswith("/") else "unmatched"


def _method(method: str) -> str:
    normalized = method.strip().upper()
    return (
        normalized if normalized.isalpha() and 3 <= len(normalized) <= 10 else "OTHER"
    )


def _status_class(status_code: int) -> str:
    return f"{status_code // 100}xx" if 100 <= status_code <= 599 else "other"
