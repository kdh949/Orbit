from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping
from urllib.parse import urlsplit, urlunsplit

from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.botocore import BotocoreInstrumentor
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import (
    HTTPXClientInstrumentor,
    RequestInfo,
)
from opentelemetry.instrumentation.psycopg import PsycopgInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased
from opentelemetry.trace import Span


@dataclass(frozen=True)
class PythonTelemetryConfig:
    endpoint: str
    environment: str
    sample_ratio: float
    service_name: str
    service_version: str | None


_provider: TracerProvider | None = None
_libraries_instrumented = False


def resolve_python_telemetry_config(
    service_name: str,
    env: Mapping[str, str] = os.environ,
) -> PythonTelemetryConfig | None:
    if env.get("OTEL_SDK_DISABLED", "").strip().lower() == "true":
        return None

    endpoint = env.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "").strip()
    if not endpoint:
        return None

    parsed_endpoint = urlsplit(endpoint)
    if parsed_endpoint.scheme not in {"http", "https"} or not parsed_endpoint.netloc:
        raise ValueError(
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must be an HTTP(S) URL"
        )

    sample_ratio_value = env.get("OTEL_TRACES_SAMPLER_ARG", "1").strip() or "1"
    try:
        sample_ratio = float(sample_ratio_value)
    except ValueError as error:
        raise ValueError("OTEL_TRACES_SAMPLER_ARG must be between 0 and 1") from error
    if not 0 <= sample_ratio <= 1:
        raise ValueError("OTEL_TRACES_SAMPLER_ARG must be between 0 and 1")

    service_version = env.get("OTEL_SERVICE_VERSION", "").strip() or None
    return PythonTelemetryConfig(
        endpoint=endpoint,
        environment=env.get("APP_ENV", "local").strip() or "local",
        sample_ratio=sample_ratio,
        service_name=service_name,
        service_version=service_version,
    )


def configure_python_telemetry(
    app: FastAPI,
    env: Mapping[str, str] = os.environ,
) -> TracerProvider | None:
    config = resolve_python_telemetry_config("orbit-python-worker", env)
    if config is None:
        return None

    provider = _get_or_create_provider(config)
    _instrument_libraries(provider)
    FastAPIInstrumentor.instrument_app(
        app,
        tracer_provider=provider,
        excluded_urls="^/health$|^/internal/metrics$",
        exclude_spans=["receive", "send"],
    )
    return provider


def _get_or_create_provider(config: PythonTelemetryConfig) -> TracerProvider:
    global _provider
    if _provider is not None:
        return _provider

    attributes: dict[str, str] = {
        "service.name": config.service_name,
        "service.namespace": "orbit",
        "deployment.environment.name": config.environment,
    }
    if config.service_version:
        attributes["service.version"] = config.service_version

    provider = TracerProvider(
        resource=Resource.create(attributes),
        sampler=ParentBased(TraceIdRatioBased(config.sample_ratio)),
    )
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=config.endpoint))
    )
    trace.set_tracer_provider(provider)
    _provider = provider
    return provider


def _instrument_libraries(provider: TracerProvider) -> None:
    global _libraries_instrumented
    if _libraries_instrumented:
        return

    HTTPXClientInstrumentor().instrument(
        tracer_provider=provider,
        request_hook=_sanitize_httpx_url,
        async_request_hook=_sanitize_httpx_url_async,
    )
    PsycopgInstrumentor().instrument(
        tracer_provider=provider,
        capture_parameters=False,
    )
    BotocoreInstrumentor().instrument(  # type: ignore[no-untyped-call]
        tracer_provider=provider
    )
    _libraries_instrumented = True


def _sanitize_httpx_url(span: Span, request: RequestInfo) -> None:
    if not span.is_recording():
        return
    sanitized_url = _url_without_query_or_fragment(str(request.url))
    span.set_attribute("url.full", sanitized_url)
    span.set_attribute("http.url", sanitized_url)


async def _sanitize_httpx_url_async(span: Span, request: RequestInfo) -> None:
    _sanitize_httpx_url(span, request)


def _url_without_query_or_fragment(url: str) -> str:
    parsed = urlsplit(url)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
