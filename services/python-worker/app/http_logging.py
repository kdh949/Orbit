from __future__ import annotations

import json
import logging
import sys
from collections.abc import Callable, Mapping
from time import perf_counter

from fastapi import FastAPI, Request
from opentelemetry import trace
from opentelemetry.trace import SpanContext
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response

SERVICE_NAME = "orbit-python-worker"
_EXCLUDED_PATHS = frozenset({"/health", "/internal/metrics"})
_KNOWN_METHODS = frozenset({"DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"})

HttpLogRecord = dict[str, object]
HttpLogEmitter = Callable[[Mapping[str, object]], None]
SpanContextGetter = Callable[[], SpanContext | None]

_HTTP_LOGGER = logging.getLogger("orbit.http")
if not _HTTP_LOGGER.handlers:
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(logging.Formatter("%(message)s"))
    _HTTP_LOGGER.addHandler(_handler)
_HTTP_LOGGER.setLevel(logging.INFO)
_HTTP_LOGGER.propagate = False


def serialize_http_log_record(record: Mapping[str, object]) -> str:
    return json.dumps(record, ensure_ascii=False, separators=(",", ":"))


def _emit_http_log(record: Mapping[str, object]) -> None:
    _HTTP_LOGGER.info(serialize_http_log_record(record))


def _active_span_context() -> SpanContext | None:
    context = trace.get_current_span().get_span_context()
    return context if context.is_valid else None


def _route_template(request: Request) -> str:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) and path else "unmatched"


def _method(method: str) -> str:
    normalized = method.upper()
    return normalized if normalized in _KNOWN_METHODS else "OTHER"


def _record(
    *,
    duration_ms: float,
    event: str,
    method: str,
    route: str,
    span_context: SpanContext | None,
    status_code: int,
) -> HttpLogRecord:
    record: HttpLogRecord = {
        "service": SERVICE_NAME,
        "event": event,
        "method": _method(method),
        "route": route,
        "statusCode": status_code,
        "durationMs": round(duration_ms, 3),
    }
    if span_context is not None and span_context.is_valid:
        record["traceId"] = format(span_context.trace_id, "032x")
        record["spanId"] = format(span_context.span_id, "016x")
    return record


def install_http_trace_logging(
    app: FastAPI,
    *,
    emit: HttpLogEmitter = _emit_http_log,
    span_context_getter: SpanContextGetter = _active_span_context,
) -> None:
    @app.middleware("http")
    async def log_http_request(
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        started_at = perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            if request.url.path not in _EXCLUDED_PATHS:
                emit(
                    _record(
                        duration_ms=(perf_counter() - started_at) * 1000,
                        event="http.request.failed",
                        method=request.method,
                        route=_route_template(request),
                        span_context=span_context_getter(),
                        status_code=500,
                    )
                )
            raise

        if request.url.path not in _EXCLUDED_PATHS:
            emit(
                _record(
                    duration_ms=(perf_counter() - started_at) * 1000,
                    event="http.request.completed",
                    method=request.method,
                    route=_route_template(request),
                    span_context=span_context_getter(),
                    status_code=response.status_code,
                )
            )
        return response
