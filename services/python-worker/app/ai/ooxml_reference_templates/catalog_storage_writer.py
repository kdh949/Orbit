from __future__ import annotations

import hashlib
from typing import Protocol, cast

from app.ai.ooxml_reference_templates.catalog_transport import (
    PrivateCatalogRuntimeError,
    S3CompatibleObjectStorage,
    S3ObjectClient,
    _bounded_catalog_key,
    create_s3_object_client,
)
from app.ai.ooxml_reference_templates.registry import RegistryError
from app.config import ConfigError, load_config


class WritableS3ObjectClient(S3ObjectClient, Protocol):
    def put_object(self, **kwargs: object) -> dict[str, object]: ...


class S3ImmutableCatalogObjectStorage(S3CompatibleObjectStorage):
    """Conditional-create writer for immutable private catalog objects."""

    def __init__(self, client: WritableS3ObjectClient, bucket: str) -> None:
        super().__init__(client, bucket)
        self._writer_client = client
        self._writer_bucket = bucket

    def __repr__(self) -> str:
        return "S3ImmutableCatalogObjectStorage(private=True)"

    def put_if_absent(
        self,
        key: str,
        content: bytes,
        content_type: str,
    ) -> bool:
        bounded_key = _bounded_catalog_key(key)
        try:
            self._writer_client.put_object(
                Bucket=self._writer_bucket,
                Key=bounded_key,
                Body=content,
                ContentType=content_type,
                Metadata={"sha256": hashlib.sha256(content).hexdigest()},
                IfNoneMatch="*",
            )
        except Exception as error:
            if _is_precondition_failure(error):
                return False
            raise RegistryError(
                "CATALOG_STORAGE_WRITE_FAILED",
                "private catalog object cannot be written",
            ) from error
        return True


def build_s3_immutable_catalog_writer() -> S3ImmutableCatalogObjectStorage:
    try:
        config = load_config()
        client = cast(WritableS3ObjectClient, create_s3_object_client(config))
        return S3ImmutableCatalogObjectStorage(client, config.s3_bucket)
    except (ConfigError, PrivateCatalogRuntimeError) as error:
        raise RegistryError(
            "CATALOG_STORAGE_UNCONFIGURED",
            "private catalog storage is not configured",
        ) from error


def _is_precondition_failure(error: Exception) -> bool:
    response = getattr(error, "response", None)
    if not isinstance(response, dict):
        return False
    error_payload = response.get("Error")
    if not isinstance(error_payload, dict):
        return False
    return str(error_payload.get("Code")) in {
        "409",
        "412",
        "ConditionalRequestConflict",
        "PreconditionFailed",
    }
