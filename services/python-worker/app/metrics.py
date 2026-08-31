from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from time import perf_counter
from typing import Any

from fastapi import FastAPI, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

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
        try:
            response = await call_next(request)
        except Exception:
            labels = {
                "method": _method(request.method),
                "route": _route(request.scope),
                "status_class": "5xx",
            }
            HTTP_REQUESTS.labels(**labels).inc()
            HTTP_DURATION.labels(**labels).observe(perf_counter() - started_at)
            raise

        labels = {
            "method": _method(request.method),
            "route": _route(request.scope),
            "status_class": _status_class(response.status_code),
        }
        HTTP_REQUESTS.labels(**labels).inc()
        HTTP_DURATION.labels(**labels).observe(perf_counter() - started_at)
        return response


def metrics_endpoint() -> Response:
    return Response(
        content=generate_latest(),
        headers={"Cache-Control": "no-store", "Content-Type": CONTENT_TYPE_LATEST},
    )


def _route(scope: Mapping[str, Any]) -> str:
    route = scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) and path.startswith("/") else "unmatched"


def _method(method: str) -> str:
    normalized = method.strip().upper()
    return normalized if normalized.isalpha() and 3 <= len(normalized) <= 10 else "OTHER"


def _status_class(status_code: int) -> str:
    return f"{status_code // 100}xx" if 100 <= status_code <= 599 else "other"
