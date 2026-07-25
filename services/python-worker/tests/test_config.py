import pytest

from app.config import ConfigError, load_config


VALID_ENV = {
    "NODE_ENV": "test",
    "APP_ENV": "local",
    "PYTHON_WORKER_PORT": "8000",
    "PYTHON_WORKER_URL": "http://localhost:8000",
    "API_BASE_URL": "http://localhost:3000",
    "DATABASE_URL": "postgres://orbit:orbit@localhost:5432/orbit",
    "REDIS_URL": "redis://localhost:6379",
    "STORAGE_DRIVER": "minio",
    "S3_ENDPOINT": "http://localhost:9000",
    "S3_PUBLIC_ENDPOINT": "http://localhost:9000",
    "S3_BUCKET": "orbit-local",
    "S3_REGION": "ap-northeast-2",
    "S3_ACCESS_KEY_ID": "orbit",
    "S3_SECRET_ACCESS_KEY": "orbit-password",
    "S3_FORCE_PATH_STYLE": "true",
    "JOB_QUEUE_DRIVER": "bullmq",
    "LIVE_STT_PROVIDER": "sherpa",
    "REPORT_STT_PROVIDER": "openai",
    "OCR_PROVIDER": "python",
    "LLM_PROVIDER": "openai",
    "OPENAI_API_KEY": "",
    "OPENAI_MODEL": "gpt-4.1-mini",
    "OPENAI_TRANSCRIPTION_MODEL": "gpt-4o-transcribe",
    "OPENAI_EMBEDDING_MODEL": "text-embedding-3-small",
    "AWS_REGION": "ap-northeast-2",
    "AWS_ACCESS_KEY_ID": "",
    "AWS_SECRET_ACCESS_KEY": "",
    "TRANSCRIBE_LANGUAGE_CODE": "ko-KR",
    "TEXTRACT_ENABLED": "false",
}


def test_openai_model_defaults_are_loaded_from_env() -> None:
    config = load_config(
        {
            **VALID_ENV,
            "OPENAI_MODEL": "gpt-4.1",
            "OPENAI_TRANSCRIPTION_MODEL": "gpt-4o-mini-transcribe",
            "OPENAI_EMBEDDING_MODEL": "text-embedding-3-large",
        }
    )

    assert config.openai_model == "gpt-4.1"
    assert config.openai_transcription_model == "gpt-4o-mini-transcribe"
    assert config.openai_embedding_model == "text-embedding-3-large"


def test_visual_qa_model_falls_back_when_not_configured() -> None:
    config = load_config(VALID_ENV)

    assert config.ai_ppt_visual_qa_model is None
    configured = load_config(
        {**VALID_ENV, "AI_PPT_VISUAL_QA_MODEL": "gpt-4.1-vision"}
    )
    assert configured.ai_ppt_visual_qa_model == "gpt-4.1-vision"


def test_system_design_pack_rollout_defaults_off_and_accepts_allowlist() -> None:
    default = load_config(VALID_ENV)
    enabled = load_config(
        {
            **VALID_ENV,
            "AI_PPT_SYSTEM_DESIGN_PACKS_ENABLED": "true",
            "AI_PPT_SYSTEM_DESIGN_PACK_ALLOWLIST": (
                "neutral-light,executive-review"
            ),
        }
    )

    assert default.ai_ppt_system_design_packs_enabled is False
    assert enabled.ai_ppt_system_design_packs_enabled is True
    assert enabled.ai_ppt_system_design_pack_allowlist == (
        "neutral-light,executive-review"
    )


def test_ooxml_reference_private_catalog_rollout_is_exact_and_defaults_off() -> None:
    default = load_config(VALID_ENV)
    enabled = load_config(
        {
            **VALID_ENV,
            "AI_PPT_OOXML_REFERENCE_TEMPLATES_ENABLED": "true",
            "AI_PPT_OOXML_REFERENCE_TEMPLATE_ALLOWLIST": (
                "operating-review@1,simple-dark@2"
            ),
        }
    )

    assert default.ai_ppt_ooxml_reference_templates_enabled is False
    assert default.ooxml_reference_template_allowlist == frozenset()
    assert enabled.ooxml_reference_template_allowlist == frozenset(
        {("operating-review", 1), ("simple-dark", 2)}
    )

    for invalid in [
        "operating-review",
        "operating-review@latest",
        "operating-review@0",
        "Operating-Review@1",
        "operating-review@1,,simple-dark@1",
    ]:
        with pytest.raises(
            ConfigError,
            match="AI_PPT_OOXML_REFERENCE_TEMPLATE_ALLOWLIST",
        ):
            load_config(
                {
                    **VALID_ENV,
                    "AI_PPT_OOXML_REFERENCE_TEMPLATE_ALLOWLIST": invalid,
                }
            )


def test_ooxml_reference_local_demo_mode_is_local_only() -> None:
    enabled = load_config(
        {
            **VALID_ENV,
            "AI_PPT_OOXML_REFERENCE_LOCAL_DEMO_ENABLED": "true",
        }
    )

    assert enabled.ai_ppt_ooxml_reference_local_demo_enabled is True

    with pytest.raises(
        ConfigError,
        match="AI_PPT_OOXML_REFERENCE_LOCAL_DEMO_ENABLED",
    ):
        load_config(
            {
                **VALID_ENV,
                "APP_ENV": "production",
                "AI_PPT_OOXML_REFERENCE_LOCAL_DEMO_ENABLED": "true",
            }
        )


def test_ai_slide_image_review_mode_defaults_to_auto() -> None:
    config = load_config(VALID_ENV)

    assert config.ai_slide_image_review_mode == "auto"

    with pytest.raises(ConfigError, match="AI_SLIDE_IMAGE_REVIEW_MODE"):
        load_config({**VALID_ENV, "AI_SLIDE_IMAGE_REVIEW_MODE": "manual"})


def test_live_and_report_stt_providers_are_separate_contracts() -> None:
    config = load_config(VALID_ENV)

    assert config.live_stt_provider == "sherpa"
    assert config.report_stt_provider == "openai"
    assert config.rehearsal_audio_max_bytes == 25_000_000
    with pytest.raises(ConfigError, match="LIVE_STT_PROVIDER"):
        load_config({**VALID_ENV, "LIVE_STT_PROVIDER": "openai"})
    with pytest.raises(ConfigError, match="REPORT_STT_PROVIDER"):
        load_config({**VALID_ENV, "REPORT_STT_PROVIDER": "sherpa"})


def test_whisperx_report_stt_provider_accepts_required_config() -> None:
    config = load_config(
        {
            **VALID_ENV,
            "REPORT_STT_PROVIDER": "whisperx",
            "WHISPERX_API_URL": "https://whisperx.example.test/transcribe",
            "WHISPERX_API_KEY": "whisperx-test-key",
            "WHISPERX_MODEL": "large-v3",
            "WHISPERX_TIMEOUT_MS": "45000",
        }
    )

    assert config.report_stt_provider == "whisperx"
    assert config.whisperx_api_url == "https://whisperx.example.test/transcribe"
    assert config.whisperx_model == "large-v3"
    assert config.whisperx_timeout_ms == 45_000


def test_whisperx_report_stt_requires_endpoint_key_and_model() -> None:
    with pytest.raises(ConfigError, match="WHISPERX_API_URL"):
        load_config({**VALID_ENV, "REPORT_STT_PROVIDER": "whisperx"})


def test_openai_report_stt_rejects_large_audio_limit() -> None:
    with pytest.raises(ConfigError, match="REHEARSAL_AUDIO_MAX_BYTES"):
        load_config({**VALID_ENV, "REHEARSAL_AUDIO_MAX_BYTES": "25000001"})


def test_missing_required_env_fails_with_readable_error() -> None:
    env = dict(VALID_ENV)
    del env["DATABASE_URL"]

    with pytest.raises(ConfigError, match="DATABASE_URL"):
        load_config(env)


def test_empty_strings_are_treated_as_missing() -> None:
    with pytest.raises(ConfigError, match="OPENAI_MODEL"):
        load_config({**VALID_ENV, "OPENAI_MODEL": " "})


def test_staging_rejects_local_defaults() -> None:
    with pytest.raises(ConfigError, match="DATABASE_URL must not use"):
        load_config(
            {
                **VALID_ENV,
                "APP_ENV": "staging",
                "OPENAI_API_KEY": "sk-staging-placeholder",
            }
        )
