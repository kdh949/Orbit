from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path, PurePosixPath
from typing import Annotated, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from app.ai.ooxml_reference_templates.inventory import (
    ReferenceSource,
    inspect_reference_package,
)
from app.ai.ooxml_reference_templates.models import (
    OoxmlReferenceTemplateManifest,
    Sha256,
    TemplateId,
)


CATALOG_PREFIX = "system/ooxml-reference-templates"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


@dataclass(frozen=True)
class StoredObjectMetadata:
    sha256: str
    size: int
    content_type: str


class ObjectStorage(Protocol):
    def put_if_absent(
        self, key: str, content: bytes, content_type: str
    ) -> bool: ...

    def head_object(self, key: str) -> StoredObjectMetadata | None: ...

    def read_object(self, key: str) -> bytes: ...


@dataclass(frozen=True)
class IngestionResult:
    template_id: str
    version: int
    manifest_sha256: str
    created_object_count: int


class RegistryError(ValueError):
    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


class _StrictCatalogModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        str_strip_whitespace=True,
    )


class RepositoryPreviewBaseline(_StrictCatalogModel):
    cover_preview_id: Annotated[str, Field(min_length=1, max_length=128)]
    cover_preview_sha256: Sha256 | None
    body_preview_id: Annotated[str, Field(min_length=1, max_length=128)]
    body_preview_sha256: Sha256 | None


class RepositoryProvenance(_StrictCatalogModel):
    authorization_status: Literal["approved", "pending", "rejected"]
    inventory_version: int = Field(gt=0)


class RepositoryAnnotationReview(_StrictCatalogModel):
    status: Literal["approved"]
    reviewed_on: date
    reviewed_manifest_sha256: Sha256
    slide_count: int = Field(gt=0, le=500)
    slot_count: int = Field(gt=0, le=10_000)
    content_types: list[Literal["text"]] = Field(min_length=1, max_length=1)


ActivationBlocker = Literal[
    "SOURCE_AUTHORIZATION_PENDING",
    "SOURCE_SLIDE_ANNOTATION_MISSING",
    "COVER_BODY_PREVIEW_BASELINE_MISSING",
    "PRIVATE_MANAGED_STORAGE_ADAPTER_UNCONFIGURED",
    "POWERPOINT_QA_PENDING",
    "FONT_AVAILABILITY_VALIDATION_PENDING",
]


class RepositoryCatalogTemplate(_StrictCatalogModel):
    template_id: TemplateId
    version: int = Field(gt=0)
    status: Literal["disabled"]
    source_format: Literal["pptx"]
    source_sha256: Sha256
    slide_count: int = Field(gt=0, le=500)
    name: Annotated[str, Field(min_length=1, max_length=120)]
    description: Annotated[str, Field(min_length=1, max_length=500)]
    preview: RepositoryPreviewBaseline
    provenance: RepositoryProvenance
    annotation_review: RepositoryAnnotationReview
    activation_blockers: list[ActivationBlocker] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def validate_approval_and_activation_blockers(
        self,
    ) -> RepositoryCatalogTemplate:
        blockers = set(self.activation_blockers)
        if len(blockers) != len(self.activation_blockers):
            raise ValueError("activation blockers must be unique")
        if self.annotation_review.slide_count != self.slide_count:
            raise ValueError("annotation review slide count must match source")
        if (
            self.provenance.authorization_status == "approved"
            and "SOURCE_AUTHORIZATION_PENDING" in blockers
        ):
            raise ValueError("approved source cannot retain authorization blocker")
        if "SOURCE_SLIDE_ANNOTATION_MISSING" in blockers:
            raise ValueError("approved annotation cannot retain annotation blocker")

        preview_missing = (
            self.preview.cover_preview_sha256 is None
            or self.preview.body_preview_sha256 is None
        )
        if preview_missing != ("COVER_BODY_PREVIEW_BASELINE_MISSING" in blockers):
            raise ValueError("preview blocker must match preview checksum evidence")

        required_unverified_gates = {
            "PRIVATE_MANAGED_STORAGE_ADAPTER_UNCONFIGURED",
            "POWERPOINT_QA_PENDING",
            "FONT_AVAILABILITY_VALIDATION_PENDING",
        }
        if not required_unverified_gates.issubset(blockers):
            raise ValueError("disabled catalog must retain every unverified gate")
        return self


class RepositoryCatalog(_StrictCatalogModel):
    schema_version: Literal[2]
    templates: list[RepositoryCatalogTemplate] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_unique_template_versions(self) -> RepositoryCatalog:
        identities = [
            (template.template_id, template.version) for template in self.templates
        ]
        if len(identities) != len(set(identities)):
            raise ValueError("repository template/version identities must be unique")
        return self


class LocalDirectoryObjectStorage:
    """Test-only local adapter; production managed storage remains unconfigured."""

    def __init__(self, root: Path) -> None:
        self._root = root.resolve()

    def put_if_absent(self, key: str, content: bytes, content_type: str) -> bool:
        del content_type
        path = self._path_for_key(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("xb") as stream:
                stream.write(content)
        except FileExistsError:
            return False
        return True

    def head_object(self, key: str) -> StoredObjectMetadata | None:
        path = self._path_for_key(key)
        try:
            content = path.read_bytes()
        except FileNotFoundError:
            return None
        return StoredObjectMetadata(
            sha256=_sha256(content),
            size=len(content),
            content_type=_content_type_for_key(key),
        )

    def read_object(self, key: str) -> bytes:
        return self._path_for_key(key).read_bytes()

    def _path_for_key(self, key: str) -> Path:
        pure_key = PurePosixPath(key)
        if (
            not key
            or key.startswith("/")
            or ".." in pure_key.parts
            or "." in pure_key.parts
            or "" in key.split("/")
        ):
            raise RegistryError("INVALID_OBJECT_KEY", "object key is not bounded")
        path = self._root.joinpath(*pure_key.parts).resolve()
        try:
            path.relative_to(self._root)
        except ValueError as error:
            raise RegistryError(
                "INVALID_OBJECT_KEY", "object key escapes local storage root"
            ) from error
        return path


def canonical_manifest_bytes(manifest: OoxmlReferenceTemplateManifest) -> bytes:
    payload = manifest.model_dump(by_alias=True, mode="json")
    return json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def ingest_reference_template(
    storage: ObjectStorage,
    manifest: OoxmlReferenceTemplateManifest,
    source_path: Path,
    cover_preview_path: Path,
    body_preview_path: Path,
) -> IngestionResult:
    _require_active_manifest(manifest)
    inventory = inspect_reference_package(
        ReferenceSource(manifest.template_id, source_path)
    )
    if inventory["securityPreflight"] != "passed":
        raise RegistryError("SOURCE_PREFLIGHT_FAILED", "source preflight did not pass")
    if inventory["slideCount"] != manifest.slide_count:
        raise RegistryError("SOURCE_SLIDE_COUNT_MISMATCH", "source slide count drifted")

    source = _read_private_input(source_path, "SOURCE_READ_FAILED")
    cover = _read_private_input(cover_preview_path, "PREVIEW_READ_FAILED")
    body = _read_private_input(body_preview_path, "PREVIEW_READ_FAILED")
    if not cover.startswith(PNG_SIGNATURE) or not body.startswith(PNG_SIGNATURE):
        raise RegistryError("INVALID_PREVIEW_FORMAT", "previews must be PNG files")
    _require_checksum(source, manifest.source_sha256, "SOURCE_CHECKSUM_MISMATCH")
    _require_checksum(
        cover,
        manifest.preview.cover_preview_sha256,
        "PREVIEW_CHECKSUM_MISMATCH",
    )
    _require_checksum(
        body,
        manifest.preview.body_preview_sha256,
        "PREVIEW_CHECKSUM_MISMATCH",
    )

    manifest_bytes = canonical_manifest_bytes(manifest)
    prefix = _template_prefix(manifest)
    objects = [
        (f"{prefix}/source.pptx", source, "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        (
            f"{prefix}/previews/{manifest.preview.cover_preview_id}.png",
            cover,
            "image/png",
        ),
        (
            f"{prefix}/previews/{manifest.preview.body_preview_id}.png",
            body,
            "image/png",
        ),
        (f"{prefix}/manifest.json", manifest_bytes, "application/json"),
    ]
    keys = [key for key, _, _ in objects]
    if len(keys) != len(set(keys)):
        raise RegistryError(
            "CATALOG_OBJECT_KEY_COLLISION", "manifest resolves duplicate object keys"
        )

    for key, content, content_type in objects:
        _require_immutable_or_absent(storage, key, content, content_type)

    created = 0
    for key, content, content_type in objects:
        if storage.head_object(key) is None:
            created += int(storage.put_if_absent(key, content, content_type))
        _verify_stored_object(storage, key, content, content_type)

    return IngestionResult(
        template_id=manifest.template_id,
        version=manifest.version,
        manifest_sha256=_sha256(manifest_bytes),
        created_object_count=created,
    )


def load_active_reference_template(
    storage: ObjectStorage,
    manifest: OoxmlReferenceTemplateManifest,
) -> OoxmlReferenceTemplateManifest:
    _require_active_manifest(manifest)
    prefix = _template_prefix(manifest)
    expected = [
        (f"{prefix}/source.pptx", manifest.source_sha256, None),
        (
            f"{prefix}/previews/{manifest.preview.cover_preview_id}.png",
            manifest.preview.cover_preview_sha256,
            None,
        ),
        (
            f"{prefix}/previews/{manifest.preview.body_preview_id}.png",
            manifest.preview.body_preview_sha256,
            None,
        ),
        (
            f"{prefix}/manifest.json",
            _sha256(canonical_manifest_bytes(manifest)),
            canonical_manifest_bytes(manifest),
        ),
    ]
    for key, checksum, exact_content in expected:
        metadata = storage.head_object(key)
        if metadata is None:
            raise RegistryError(
                "CATALOG_OBJECT_MISSING", "active template object is missing"
            )
        content = storage.read_object(key)
        if metadata.sha256 != checksum or _sha256(content) != checksum:
            raise RegistryError(
                "CATALOG_CHECKSUM_MISMATCH", "active template checksum drifted"
            )
        if exact_content is not None and content != exact_content:
            raise RegistryError(
                "CATALOG_CHECKSUM_MISMATCH", "canonical manifest bytes drifted"
            )
    return manifest


def load_repository_catalog(path: Path) -> RepositoryCatalog:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RegistryError(
            "REPOSITORY_CATALOG_INVALID", "repository catalog cannot be loaded"
        ) from error
    try:
        return RepositoryCatalog.model_validate(payload)
    except ValueError as error:
        raise RegistryError(
            "REPOSITORY_CATALOG_INVALID", "repository catalog is not strict"
        ) from error


def _template_prefix(manifest: OoxmlReferenceTemplateManifest) -> str:
    return f"{CATALOG_PREFIX}/{manifest.template_id}/v{manifest.version}"


def _require_active_manifest(manifest: OoxmlReferenceTemplateManifest) -> None:
    if manifest.status != "active":
        raise RegistryError("TEMPLATE_NOT_ACTIVE", "template is not active")
    if manifest.provenance.authorization_status != "approved":
        raise RegistryError(
            "PROVENANCE_NOT_APPROVED", "template provenance is not approved"
        )


def _require_immutable_or_absent(
    storage: ObjectStorage,
    key: str,
    content: bytes,
    content_type: str,
) -> None:
    metadata = storage.head_object(key)
    if metadata is None:
        return
    if (
        metadata.sha256 != _sha256(content)
        or metadata.size != len(content)
        or metadata.content_type != content_type
    ):
        raise RegistryError(
            "IMMUTABLE_OBJECT_CONFLICT",
            "template/version already exists with different content",
        )
    if storage.read_object(key) != content:
        raise RegistryError(
            "IMMUTABLE_OBJECT_CONFLICT", "stored immutable bytes do not match metadata"
        )


def _verify_stored_object(
    storage: ObjectStorage,
    key: str,
    content: bytes,
    content_type: str,
) -> None:
    metadata = storage.head_object(key)
    if metadata is None:
        raise RegistryError("READ_AFTER_WRITE_FAILED", "stored object is missing")
    if (
        metadata.sha256 != _sha256(content)
        or metadata.size != len(content)
        or metadata.content_type != content_type
        or storage.read_object(key) != content
    ):
        raise RegistryError(
            "READ_AFTER_WRITE_FAILED", "stored object failed checksum verification"
        )


def _read_private_input(path: Path, code: str) -> bytes:
    try:
        return path.read_bytes()
    except OSError as error:
        raise RegistryError(code, "private input cannot be read") from error


def _require_checksum(content: bytes, expected: str, code: str) -> None:
    if _sha256(content) != expected:
        raise RegistryError(code, "private input checksum does not match manifest")


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _content_type_for_key(key: str) -> str:
    if key.endswith(".pptx"):
        return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    if key.endswith(".png"):
        return "image/png"
    if key.endswith(".json"):
        return "application/json"
    return "application/octet-stream"
