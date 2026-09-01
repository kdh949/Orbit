import pytest

from app.telemetry import (
    _url_without_query_or_fragment,
    resolve_python_profiling_config,
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


def test_resolve_python_profiling_config_is_opt_in() -> None:
    assert resolve_python_profiling_config("orbit-python-worker", {}) is None


def test_resolve_python_profiling_config_uses_cpu_only_defaults() -> None:
    config = resolve_python_profiling_config(
        "orbit-python-worker",
        {
            "APP_ENV": "staging",
            "OTEL_SERVICE_VERSION": "test-sha",
            "PYROSCOPE_ENABLED": "true",
            "PYROSCOPE_SERVER_ADDRESS": "http://monitoring.internal:4040",
        },
    )

    assert config is not None
    assert config.application_name == "orbit-python-worker"
    assert config.environment == "staging"
    assert config.sample_rate == 50
    assert config.server_address == "http://monitoring.internal:4040"
    assert config.service_version == "test-sha"


@pytest.mark.parametrize("sample_rate", ["9", "101", "invalid"])
def test_resolve_python_profiling_config_rejects_invalid_sample_rate(
    sample_rate: str,
) -> None:
    with pytest.raises(ValueError, match="PYROSCOPE_CPU_SAMPLE_RATE"):
        resolve_python_profiling_config(
            "orbit-python-worker",
            {
                "PYROSCOPE_ENABLED": "true",
                "PYROSCOPE_SERVER_ADDRESS": "http://monitoring.internal:4040",
                "PYROSCOPE_CPU_SAMPLE_RATE": sample_rate,
            },
        )


def test_resolve_python_profiling_config_rejects_credentials() -> None:
    with pytest.raises(ValueError, match="must not contain credentials"):
        resolve_python_profiling_config(
            "orbit-python-worker",
            {
                "PYROSCOPE_ENABLED": "true",
                "PYROSCOPE_SERVER_ADDRESS": (
                    "http://profiling-user:profiling-password@monitoring.internal:4040"
                ),
            },
        )
