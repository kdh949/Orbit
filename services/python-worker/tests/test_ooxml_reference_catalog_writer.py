from __future__ import annotations

import hashlib
from io import BytesIO
from typing import Any

import pytest

from app.ai.ooxml_reference_templates.catalog_storage_writer import (
    S3ImmutableCatalogObjectStorage,
    build_s3_immutable_catalog_writer,
)
from app.ai.ooxml_reference_templates.registry import RegistryError
from app.config import ConfigError


class PreconditionFailed(Exception):
    def __init__(self) -> None:
        self.response = {"Error": {"Code": "PreconditionFailed"}}


class FakeWritableS3Client:
    def __init__(self) -> None:
        self.objects: dict[str, dict[str, Any]] = {}

    def put_object(self, **kwargs: object) -> dict[str, object]:
        key = str(kwargs["Key"])
        if key in self.objects:
            raise PreconditionFailed
        body = kwargs["Body"]
        assert isinstance(body, bytes)
        metadata = kwargs["Metadata"]
        assert isinstance(metadata, dict)
        self.objects[key] = {
            "content": body,
            "content_type": kwargs["ContentType"],
            "sha256": metadata["sha256"],
        }
        return {}

    def head_object(self, **kwargs: object) -> dict[str, object]:
        value = self.objects[str(kwargs["Key"])]
        return {
            "ContentLength": len(value["content"]),
            "ContentType": value["content_type"],
            "Metadata": {"sha256": value["sha256"]},
        }

    def get_object(self, **kwargs: object) -> dict[str, object]:
        value = self.objects[str(kwargs["Key"])]
        return {"Body": BytesIO(value["content"])}


def test_writer_uses_conditional_create_with_checksum_metadata() -> None:
    client = FakeWritableS3Client()
    writer = S3ImmutableCatalogObjectStorage(client, "private-bucket")
    content = b"private-source"
    key = "system/ooxml-reference-templates/operating-review/v1/source.pptx"

    assert writer.put_if_absent(key, content, _pptx_content_type()) is True
    assert writer.put_if_absent(key, content, _pptx_content_type()) is False
    assert writer.head_object(key) is not None
    assert writer.head_object(key).sha256 == hashlib.sha256(content).hexdigest()  # type: ignore[union-attr]
    assert writer.read_object(key) == content
    assert "private-bucket" not in repr(writer)


def test_writer_sanitizes_provider_failure_without_object_locator() -> None:
    class FailingClient(FakeWritableS3Client):
        def put_object(self, **kwargs: object) -> dict[str, object]:
            raise RuntimeError(
                f"bucket=secret-bucket key={kwargs['Key']} credential=do-not-log"
            )

    writer = S3ImmutableCatalogObjectStorage(FailingClient(), "secret-bucket")
    key = "system/ooxml-reference-templates/operating-review/v1/source.pptx"

    with pytest.raises(RegistryError) as captured:
        writer.put_if_absent(key, b"private", _pptx_content_type())

    assert captured.value.code == "CATALOG_STORAGE_WRITE_FAILED"
    assert "secret-bucket" not in str(captured.value)
    assert key not in str(captured.value)
    assert "do-not-log" not in str(captured.value)


def test_writer_factory_sanitizes_configuration_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.ai.ooxml_reference_templates.catalog_storage_writer as writer_module

    monkeypatch.setattr(
        writer_module,
        "load_config",
        lambda: (_ for _ in ()).throw(
            ConfigError("endpoint=https://private.invalid credential=do-not-log")
        ),
    )

    with pytest.raises(RegistryError) as captured:
        build_s3_immutable_catalog_writer()

    assert captured.value.code == "CATALOG_STORAGE_UNCONFIGURED"
    assert "private.invalid" not in str(captured.value)
    assert "do-not-log" not in str(captured.value)


def _pptx_content_type() -> str:
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
