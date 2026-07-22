from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from importlib import import_module
from pathlib import PurePosixPath
from typing import Any, Protocol, cast

from pydantic import ValidationError

from app.ai.ooxml_reference_templates.models import (
    OoxmlReferenceTemplateManifest,
)

from app.ai.ooxml_reference_templates.options import (
    OoxmlReferenceTemplateAllowlist,
    OoxmlReferenceTemplateOptionsResponse,
    build_ooxml_reference_template_options,
)
from app.ai.ooxml_reference_templates.registry import (
    CATALOG_PREFIX,
    ObjectStorage,
    RegistryError,
    StoredObjectMetadata,
    load_active_reference_template,
)
from app.config import PythonWorkerConfig


MAX_CATALOG_OBJECT_BYTES = 209_715_200
MAX_MANIFEST_BYTES = 1_048_576
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
PPTX_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
)


class OoxmlReferenceTemplateCatalogRuntime(Protocol):
    def list_options(self) -> OoxmlReferenceTemplateOptionsResponse: ...

    def read_source(
        self,
        template_id: str,
        version: int,
    ) -> VerifiedPrivateCatalogSource: ...

    def read_preview(
        self,
        template_id: str,
        version: int,
        asset_id: str,
    ) -> bytes: ...


class CatalogPreviewNotFoundError(LookupError):
    pass


class PrivateCatalogRuntimeError(RuntimeError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__("OOXML reference template catalog unavailable.")


@dataclass(frozen=True)
class VerifiedPrivateCatalogSource:
    manifest: OoxmlReferenceTemplateManifest
    content: bytes


class UnconfiguredOoxmlReferenceTemplateCatalogRuntime:
    """Fail-closed default until private managed storage is configured."""

    def list_options(self) -> OoxmlReferenceTemplateOptionsResponse:
        return OoxmlReferenceTemplateOptionsResponse(options=[])

    def read_source(
        self,
        template_id: str,
        version: int,
    ) -> VerifiedPrivateCatalogSource:
        del template_id, version
        raise PrivateCatalogRuntimeError("OOXML_REFERENCE_CATALOG_UNCONFIGURED")

    def read_preview(
        self,
        template_id: str,
        version: int,
        asset_id: str,
    ) -> bytes:
        del template_id, version, asset_id
        raise CatalogPreviewNotFoundError


class S3ObjectClient(Protocol):
    def head_object(self, **kwargs: object) -> dict[str, object]: ...

    def get_object(self, **kwargs: object) -> dict[str, object]: ...


class S3CompatibleObjectStorage:
    """Read-only private catalog adapter for S3-compatible object stores."""

    def __init__(self, client: S3ObjectClient, bucket: str) -> None:
        if not bucket.strip():
            raise PrivateCatalogRuntimeError("OOXML_REFERENCE_CATALOG_UNCONFIGURED")
        self._client = client
        self._bucket = bucket

    def __repr__(self) -> str:
        return "S3CompatibleObjectStorage(private=True)"

    def put_if_absent(
        self,
        key: str,
        content: bytes,
        content_type: str,
    ) -> bool:
        del key, content, content_type
        raise RegistryError(
            "CATALOG_READ_ONLY",
            "runtime catalog storage does not permit writes",
        )

    def head_object(self, key: str) -> StoredObjectMetadata | None:
        bounded_key = _bounded_catalog_key(key)
        try:
            response = self._client.head_object(
                Bucket=self._bucket,
                Key=bounded_key,
            )
        except Exception as error:
            if _is_missing_object(error):
                return None
            raise RegistryError(
                "CATALOG_STORAGE_READ_FAILED",
                "private catalog metadata cannot be read",
            ) from error
        try:
            raw_size = response["ContentLength"]
            if not isinstance(raw_size, int):
                raise TypeError
            size = raw_size
            content_type = str(response["ContentType"])
            raw_metadata = response["Metadata"]
            if not isinstance(raw_metadata, dict):
                raise TypeError
            sha256 = str(raw_metadata["sha256"])
        except (KeyError, TypeError, ValueError) as error:
            raise RegistryError(
                "CATALOG_OBJECT_METADATA_INVALID",
                "private catalog object metadata is incomplete",
            ) from error
        if (
            size < 1
            or size > _maximum_bytes_for_key(bounded_key)
            or not SHA256_PATTERN.fullmatch(sha256)
            or content_type != _content_type_for_key(bounded_key)
        ):
            raise RegistryError(
                "CATALOG_OBJECT_METADATA_INVALID",
                "private catalog object metadata is invalid",
            )
        return StoredObjectMetadata(
            sha256=sha256,
            size=size,
            content_type=content_type,
        )

    def read_object(self, key: str) -> bytes:
        bounded_key = _bounded_catalog_key(key)
        maximum_bytes = _maximum_bytes_for_key(bounded_key)
        try:
            response = self._client.get_object(
                Bucket=self._bucket,
                Key=bounded_key,
            )
            body = response["Body"]
            read = getattr(body, "read")
            content = read(maximum_bytes + 1)
            close = getattr(body, "close", None)
            if callable(close):
                close()
        except Exception as error:
            raise RegistryError(
                "CATALOG_STORAGE_READ_FAILED",
                "private catalog object cannot be read",
            ) from error
        if not isinstance(content, bytes) or not (0 < len(content) <= maximum_bytes):
            raise RegistryError(
                "CATALOG_OBJECT_SIZE_INVALID",
                "private catalog object size is invalid",
            )
        return content


class S3PrivateOoxmlReferenceTemplateCatalogRuntime:
    def __init__(
        self,
        storage: ObjectStorage,
        allowlist: frozenset[tuple[str, int]],
    ) -> None:
        self._storage = storage
        self._allowlist = allowlist

    def __repr__(self) -> str:
        return "S3PrivateOoxmlReferenceTemplateCatalogRuntime(private=True)"

    def list_options(self) -> OoxmlReferenceTemplateOptionsResponse:
        manifests: list[OoxmlReferenceTemplateManifest] = []
        for template_id, version in sorted(self._allowlist):
            try:
                manifests.append(self._read_manifest(template_id, version))
            except (RegistryError, ValidationError):
                continue
        return build_ooxml_reference_template_options(
            self._storage,
            manifests,
            OoxmlReferenceTemplateAllowlist(templates=self._allowlist),
        )

    def read_source(
        self,
        template_id: str,
        version: int,
    ) -> VerifiedPrivateCatalogSource:
        self._require_allowed(template_id, version)
        try:
            manifest = self._load_verified_manifest(template_id, version)
            content = self._storage.read_object(
                f"{_catalog_prefix(template_id, version)}/source.pptx"
            )
            if _sha256(content) != manifest.source_sha256:
                raise RegistryError(
                    "CATALOG_CHECKSUM_MISMATCH",
                    "source checksum drifted",
                )
        except (RegistryError, ValidationError) as error:
            raise PrivateCatalogRuntimeError(
                "OOXML_REFERENCE_CATALOG_UNAVAILABLE"
            ) from error
        return VerifiedPrivateCatalogSource(manifest=manifest, content=content)

    def read_preview(
        self,
        template_id: str,
        version: int,
        asset_id: str,
    ) -> bytes:
        if (template_id, version) not in self._allowlist:
            raise CatalogPreviewNotFoundError
        try:
            manifest = self._load_verified_manifest(template_id, version)
            previews = {
                manifest.preview.cover_preview_id: (
                    manifest.preview.cover_preview_sha256
                ),
                manifest.preview.body_preview_id: (
                    manifest.preview.body_preview_sha256
                ),
            }
            expected_sha256 = previews.get(asset_id)
            if expected_sha256 is None:
                raise CatalogPreviewNotFoundError
            content = self._storage.read_object(
                f"{_catalog_prefix(template_id, version)}/previews/{asset_id}.png"
            )
            if _sha256(content) != expected_sha256:
                raise RegistryError(
                    "CATALOG_CHECKSUM_MISMATCH",
                    "preview checksum drifted",
                )
            return require_png_preview(content)
        except CatalogPreviewNotFoundError:
            raise
        except (RegistryError, ValidationError) as error:
            raise CatalogPreviewNotFoundError from error

    def _load_verified_manifest(
        self,
        template_id: str,
        version: int,
    ) -> OoxmlReferenceTemplateManifest:
        manifest = self._read_manifest(template_id, version)
        return load_active_reference_template(self._storage, manifest)

    def _read_manifest(
        self,
        template_id: str,
        version: int,
    ) -> OoxmlReferenceTemplateManifest:
        key = f"{_catalog_prefix(template_id, version)}/manifest.json"
        metadata = self._storage.head_object(key)
        if metadata is None:
            raise RegistryError(
                "CATALOG_OBJECT_MISSING",
                "private catalog manifest is missing",
            )
        content = self._storage.read_object(key)
        if metadata.size != len(content) or metadata.sha256 != _sha256(content):
            raise RegistryError(
                "CATALOG_CHECKSUM_MISMATCH",
                "private catalog manifest checksum drifted",
            )
        try:
            payload = json.loads(content)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RegistryError(
                "CATALOG_MANIFEST_INVALID",
                "private catalog manifest is invalid",
            ) from error
        manifest = OoxmlReferenceTemplateManifest.model_validate(payload)
        if (manifest.template_id, manifest.version) != (template_id, version):
            raise RegistryError(
                "CATALOG_IDENTITY_MISMATCH",
                "private catalog manifest identity mismatched",
            )
        return manifest

    def _require_allowed(self, template_id: str, version: int) -> None:
        if (template_id, version) not in self._allowlist:
            raise PrivateCatalogRuntimeError("OOXML_REFERENCE_TEMPLATE_NOT_ALLOWED")


def build_private_catalog_runtime(
    config: PythonWorkerConfig,
    *,
    client: S3ObjectClient | None = None,
) -> OoxmlReferenceTemplateCatalogRuntime:
    allowlist = config.ooxml_reference_template_allowlist
    if not config.ai_ppt_ooxml_reference_templates_enabled or not allowlist:
        return UnconfiguredOoxmlReferenceTemplateCatalogRuntime()
    resolved_client = client or create_s3_object_client(config)
    return S3PrivateOoxmlReferenceTemplateCatalogRuntime(
        storage=S3CompatibleObjectStorage(resolved_client, config.s3_bucket),
        allowlist=allowlist,
    )


def create_s3_object_client(config: PythonWorkerConfig) -> S3ObjectClient:
    try:
        boto3 = import_module("boto3")
        botocore_config = import_module("botocore.config")
        client_config = botocore_config.Config(
            s3={
                "addressing_style": (
                    "path" if config.s3_force_path_style else "virtual"
                )
            }
        )
        kwargs: dict[str, Any] = {
            "region_name": config.s3_region,
            "config": client_config,
        }
        if config.s3_endpoint:
            kwargs["endpoint_url"] = config.s3_endpoint
        if config.s3_access_key_id and config.s3_secret_access_key:
            kwargs["aws_access_key_id"] = config.s3_access_key_id
            kwargs["aws_secret_access_key"] = config.s3_secret_access_key
        return cast(S3ObjectClient, boto3.client("s3", **kwargs))
    except Exception as error:
        raise PrivateCatalogRuntimeError(
            "OOXML_REFERENCE_CATALOG_UNCONFIGURED"
        ) from error


def _catalog_prefix(template_id: str, version: int) -> str:
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", template_id) or version < 1:
        raise RegistryError(
            "INVALID_CATALOG_IDENTITY",
            "catalog identity is invalid",
        )
    return f"{CATALOG_PREFIX}/{template_id}/v{version}"


def _bounded_catalog_key(key: str) -> str:
    pure_key = PurePosixPath(key)
    if (
        not key.startswith(f"{CATALOG_PREFIX}/")
        or key.startswith("/")
        or ".." in pure_key.parts
        or "." in pure_key.parts
        or "" in key.split("/")
    ):
        raise RegistryError("INVALID_OBJECT_KEY", "catalog object key is invalid")
    return key


def _maximum_bytes_for_key(key: str) -> int:
    return (
        MAX_MANIFEST_BYTES
        if key.endswith("/manifest.json")
        else MAX_CATALOG_OBJECT_BYTES
    )


def _content_type_for_key(key: str) -> str:
    if key.endswith("/manifest.json"):
        return "application/json"
    if key.endswith(".pptx"):
        return PPTX_CONTENT_TYPE
    if key.endswith(".png"):
        return "image/png"
    raise RegistryError("INVALID_OBJECT_KEY", "catalog object type is invalid")


def _is_missing_object(error: Exception) -> bool:
    response = getattr(error, "response", None)
    if not isinstance(response, dict):
        return False
    error_payload = response.get("Error")
    if not isinstance(error_payload, dict):
        return False
    return str(error_payload.get("Code")) in {"404", "NoSuchKey", "NotFound"}


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def require_png_preview(content: bytes) -> bytes:
    if (
        len(content) < 8
        or len(content) > 10_485_760
        or not content.startswith(b"\x89PNG\r\n\x1a\n")
    ):
        raise CatalogPreviewNotFoundError
    return content
