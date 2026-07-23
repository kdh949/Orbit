from __future__ import annotations

import hashlib
import json
from io import BytesIO
from typing import Any

import pytest

from app.ai.ooxml_reference_templates.catalog_transport import (
    CatalogPreviewNotFoundError,
    PrivateCatalogRuntimeError,
    S3CompatibleObjectStorage,
    S3PrivateOoxmlReferenceTemplateCatalogRuntime,
    build_private_catalog_runtime,
)
from app.ai.ooxml_reference_templates.calibration import (
    CALIBRATION_CONTENT_TYPE,
    CALIBRATION_OBJECT_KEY,
)
from app.ai.ooxml_reference_templates.fidelity import EXPECTED_TEMPLATE_IDS
from app.ai.ooxml_reference_templates.font_aliases import (
    approved_font_alias_policy,
)
from app.ai.ooxml_reference_templates.models import (
    OoxmlReferenceTemplateManifest,
)
from app.ai.ooxml_reference_templates.registry import (
    CATALOG_PREFIX,
    canonical_manifest_bytes,
)
from app.config import load_config
from app.main import configure_ooxml_reference_template_catalog

from test_config import VALID_ENV


PNG = b"\x89PNG\r\n\x1a\nfixture"
SOURCE = b"PK\x03\x04private-pptx-fixture"


class MissingObjectError(Exception):
    def __init__(self) -> None:
        self.response = {"Error": {"Code": "NoSuchKey"}}


class FakeS3Client:
    def __init__(self) -> None:
        self.objects: dict[str, dict[str, Any]] = {}
        self.requested_keys: list[str] = []

    def seed(
        self,
        key: str,
        content: bytes,
        content_type: str,
        *,
        declared_sha256: str | None = None,
    ) -> None:
        self.objects[key] = {
            "content": content,
            "content_type": content_type,
            "sha256": declared_sha256 or _sha256(content),
        }

    def head_object(self, **kwargs: object) -> dict[str, object]:
        key = str(kwargs["Key"])
        self.requested_keys.append(key)
        value = self.objects.get(key)
        if value is None:
            raise MissingObjectError
        return {
            "ContentLength": len(value["content"]),
            "ContentType": value["content_type"],
            "Metadata": {"sha256": value["sha256"]},
        }

    def get_object(self, **kwargs: object) -> dict[str, object]:
        key = str(kwargs["Key"])
        self.requested_keys.append(key)
        value = self.objects.get(key)
        if value is None:
            raise MissingObjectError
        return {"Body": BytesIO(value["content"])}


def test_private_runtime_reads_only_exact_allowlisted_verified_assets() -> None:
    manifest = _manifest()
    client = FakeS3Client()
    _seed(client, manifest)
    runtime = S3PrivateOoxmlReferenceTemplateCatalogRuntime(
        storage=S3CompatibleObjectStorage(client=client, bucket="private-bucket"),
        allowlist=frozenset({("operating-review", 1)}),
    )

    options = runtime.list_options()
    verified_source = runtime.read_source("operating-review", 1)
    preview = runtime.read_preview("operating-review", 1, "cover")

    assert [option.template_id for option in options.options] == [
        "operating-review"
    ]
    assert verified_source.manifest.template_id == "operating-review"
    assert verified_source.content == SOURCE
    assert preview == PNG
    assert set(client.requested_keys) <= {
        f"{CATALOG_PREFIX}/operating-review/v1/manifest.json",
        f"{CATALOG_PREFIX}/operating-review/v1/source.pptx",
        f"{CATALOG_PREFIX}/operating-review/v1/previews/cover.png",
        f"{CATALOG_PREFIX}/operating-review/v1/previews/body.png",
    }


def test_private_runtime_fails_closed_on_checksum_drift_or_missing_metadata() -> None:
    manifest = _manifest()
    prefix = f"{CATALOG_PREFIX}/operating-review/v1"
    drifted = FakeS3Client()
    _seed(drifted, manifest)
    drifted.seed(
        f"{prefix}/previews/cover.png",
        PNG + b"-drift",
        "image/png",
    )
    runtime = S3PrivateOoxmlReferenceTemplateCatalogRuntime(
        storage=S3CompatibleObjectStorage(drifted, "private-bucket"),
        allowlist=frozenset({("operating-review", 1)}),
    )

    assert runtime.list_options().options == []
    with pytest.raises(CatalogPreviewNotFoundError):
        runtime.read_preview("operating-review", 1, "cover")
    with pytest.raises(PrivateCatalogRuntimeError) as error:
        runtime.read_source("operating-review", 1)
    assert error.value.code == "OOXML_REFERENCE_CATALOG_UNAVAILABLE"
    assert CATALOG_PREFIX not in str(error.value)

    missing_metadata = FakeS3Client()
    _seed(missing_metadata, manifest)
    missing_metadata.objects[f"{prefix}/source.pptx"]["sha256"] = ""
    missing_runtime = S3PrivateOoxmlReferenceTemplateCatalogRuntime(
        storage=S3CompatibleObjectStorage(missing_metadata, "private-bucket"),
        allowlist=frozenset({("operating-review", 1)}),
    )
    assert missing_runtime.list_options().options == []


def test_private_runtime_rejects_non_allowlisted_identity_and_preview_id() -> None:
    manifest = _manifest()
    client = FakeS3Client()
    _seed(client, manifest)
    runtime = S3PrivateOoxmlReferenceTemplateCatalogRuntime(
        storage=S3CompatibleObjectStorage(client, "private-bucket"),
        allowlist=frozenset({("operating-review", 1)}),
    )

    with pytest.raises(PrivateCatalogRuntimeError) as error:
        runtime.read_source("operating-review", 2)
    assert error.value.code == "OOXML_REFERENCE_TEMPLATE_NOT_ALLOWED"
    with pytest.raises(CatalogPreviewNotFoundError):
        runtime.read_preview("operating-review", 1, "arbitrary-storage-key")


def test_configured_runtime_uses_s3_compatible_private_storage_without_secrets() -> None:
    client = FakeS3Client()
    _seed_calibration(client)
    config = load_config(
        {
            **VALID_ENV,
            "AI_PPT_OOXML_REFERENCE_TEMPLATES_ENABLED": "true",
            "AI_PPT_OOXML_REFERENCE_TEMPLATE_ALLOWLIST": "operating-review@1",
            "S3_ACCESS_KEY_ID": "do-not-expose-access-key",
            "S3_SECRET_ACCESS_KEY": "do-not-expose-secret-key",
        }
    )

    runtime = build_private_catalog_runtime(config, client=client)
    state = type("State", (), {})()
    configure_ooxml_reference_template_catalog(state, config, client=client)

    assert isinstance(runtime, S3PrivateOoxmlReferenceTemplateCatalogRuntime)
    assert isinstance(
        state.ooxml_reference_template_catalog,
        S3PrivateOoxmlReferenceTemplateCatalogRuntime,
    )
    assert "do-not-expose" not in repr(runtime)
    assert "private-bucket" not in repr(runtime)


def _seed(
    client: FakeS3Client,
    manifest: OoxmlReferenceTemplateManifest,
) -> None:
    prefix = f"{CATALOG_PREFIX}/{manifest.template_id}/v{manifest.version}"
    client.seed(
        f"{prefix}/source.pptx",
        SOURCE,
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )
    client.seed(f"{prefix}/previews/cover.png", PNG, "image/png")
    client.seed(f"{prefix}/previews/body.png", PNG, "image/png")
    client.seed(
        f"{prefix}/manifest.json",
        canonical_manifest_bytes(manifest),
        "application/json",
    )


def _seed_calibration(client: FakeS3Client) -> None:
    content = json.dumps(
        {
            "schemaVersion": 1,
            "status": "calibrated",
            "lockedRegionSsimThreshold": 0.998,
            "geometryEdgeTolerancePx": 0,
            "rationale": "approved deterministic identity baselines",
            "fontAliasPolicy": approved_font_alias_policy().model_dump(
                by_alias=True,
                mode="json",
            ),
            "identityBaselines": [
                {
                    "templateId": template_id,
                    "version": 1,
                    "renderer": "libreoffice-pdf-pymupdf",
                    "rendererVersion": "26.8.0.0",
                    "reportSha256": str(index + 1) * 64,
                }
                for index, template_id in enumerate(sorted(EXPECTED_TEMPLATE_IDS))
            ],
        },
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    client.seed(
        CALIBRATION_OBJECT_KEY,
        content,
        CALIBRATION_CONTENT_TYPE,
    )


def _manifest() -> OoxmlReferenceTemplateManifest:
    return OoxmlReferenceTemplateManifest.model_validate(
        {
            "templateId": "operating-review",
            "version": 1,
            "status": "active",
            "sourceFormat": "pptx",
            "sourceSha256": _sha256(SOURCE),
            "slideCount": 2,
            "canvas": {
                "aspectRatio": "16:9",
                "widthEmu": 12_192_000,
                "heightEmu": 6_858_000,
            },
            "name": "Operating Review",
            "description": "운영 지표와 실행 과제 보고",
            "preview": {
                "coverPreviewId": "cover",
                "coverPreviewSha256": _sha256(PNG),
                "bodyPreviewId": "body",
                "bodyPreviewSha256": _sha256(PNG),
            },
            "sourceSlides": [
                {
                    "sourceSlideId": "cover-01",
                    "sourceSlidePart": "ppt/slides/slide1.xml",
                    "sourceOrder": 1,
                    "semanticRole": "cover",
                    "relationships": {
                        "layoutPart": "ppt/slideLayouts/slideLayout1.xml",
                        "masterPart": "ppt/slideMasters/slideMaster1.xml",
                        "themePart": "ppt/theme/theme1.xml",
                    },
                    "capacity": {
                        "textSlotCount": 1,
                        "imageSlotCount": 0,
                        "tableSlotCount": 0,
                        "chartSlotCount": 0,
                    },
                    "previewId": "cover",
                    "lockedInventorySha256": "a" * 64,
                    "slots": [
                        {
                            "slotId": "cover-title",
                            "semanticRole": "title",
                            "contentType": "text",
                            "required": True,
                            "locator": {
                                "slidePart": "ppt/slides/slide1.xml",
                                "shapeId": "2",
                                "placeholderType": "title",
                                "relationshipId": None,
                            },
                            "capacity": {"maxChars": 80, "maxLines": 2},
                            "mutationPolicy": ["text-content"],
                            "replacementPolicy": {"overflow": "fail"},
                        }
                    ],
                },
                {
                    "sourceSlideId": "closing-02",
                    "sourceSlidePart": "ppt/slides/slide2.xml",
                    "sourceOrder": 2,
                    "semanticRole": "closing",
                    "relationships": {
                        "layoutPart": "ppt/slideLayouts/slideLayout1.xml",
                        "masterPart": "ppt/slideMasters/slideMaster1.xml",
                        "themePart": "ppt/theme/theme1.xml",
                    },
                    "capacity": {
                        "textSlotCount": 0,
                        "imageSlotCount": 0,
                        "tableSlotCount": 0,
                        "chartSlotCount": 0,
                    },
                    "previewId": "body",
                    "lockedInventorySha256": "b" * 64,
                    "slots": [],
                },
            ],
            "provenance": {
                "authorizationStatus": "approved",
                "inventoryVersion": 1,
            },
        }
    )


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()
