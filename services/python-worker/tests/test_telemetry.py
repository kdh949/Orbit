import pytest

from app.telemetry import (
    _url_without_query_or_fragment,
    resolve_python_telemetry_config,
)


def test_resolve_python_telemetry_config_uses_bounded_resource_attributes() -> None:
    config = resolve_python_telemetry_config(
        "orbit-python-worker",
        {
            "APP_ENV": "staging",
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": "http://alloy:4318/v1/traces",
            "OTEL_SERVICE_VERSION": "test-sha",
            "OTEL_TRACES_SAMPLER_ARG": "0.05",
        },
    )

    assert config is not None
    assert config.endpoint == "http://alloy:4318/v1/traces"
    assert config.environment == "staging"
    assert config.sample_ratio == 0.05
    assert config.service_name == "orbit-python-worker"
    assert config.service_version == "test-sha"


def test_resolve_python_telemetry_config_is_disabled_without_endpoint() -> None:
    assert resolve_python_telemetry_config("orbit-python-worker", {}) is None


@pytest.mark.parametrize("sample_ratio", ["-0.01", "1.01", "not-a-number"])
def test_resolve_python_telemetry_config_rejects_invalid_sampling(
    sample_ratio: str,
) -> None:
    with pytest.raises(ValueError, match="OTEL_TRACES_SAMPLER_ARG"):
        resolve_python_telemetry_config(
            "orbit-python-worker",
            {
                "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": "http://alloy:4318/v1/traces",
                "OTEL_TRACES_SAMPLER_ARG": sample_ratio,
            },
        )


def test_resolve_python_telemetry_config_rejects_non_http_endpoint() -> None:
    with pytest.raises(ValueError, match=r"HTTP\(S\) URL"):
        resolve_python_telemetry_config(
            "orbit-python-worker",
            {"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": "file:///tmp/traces"},
        )


def test_outbound_url_sanitizer_removes_query_and_fragment() -> None:
    assert (
        _url_without_query_or_fragment(
            "https://provider.example/v1/jobs?token=secret#private"
        )
        == "https://provider.example/v1/jobs"
    )
