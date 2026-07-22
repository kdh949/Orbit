from __future__ import annotations

import hashlib
from dataclasses import dataclass

from app.ai.ooxml_reference_templates.models import OoxmlReferenceTemplateManifest
from app.ai.ooxml_reference_templates.options import (
    OoxmlReferenceTemplateAllowlist,
    build_ooxml_reference_template_options,
)
from app.ai.ooxml_reference_templates.registry import (
    CATALOG_PREFIX,
    StoredObjectMetadata,
    canonical_manifest_bytes,
)


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


@dataclass
class _Object:
    content: bytes
    content_type: str


class MemoryStorage:
    def __init__(self) -> None:
        self.objects: dict[str, _Object] = {}

    def put_if_absent(self, key: str, content: bytes, content_type: str) -> bool:
        if key in self.objects:
            return False
        self.objects[key] = _Object(content, content_type)
        return True

    def head_object(self, key: str) -> StoredObjectMetadata | None:
        value = self.objects.get(key)
        if value is None:
            return None
        return StoredObjectMetadata(
            sha256=_sha256(value.content),
            size=len(value.content),
            content_type=value.content_type,
        )

    def read_object(self, key: str) -> bytes:
        return self.objects[key].content


def _manifest(
    template_id: str,
    *,
    status: str = "active",
) -> OoxmlReferenceTemplateManifest:
    source = f"private-{template_id}-source".encode()
    cover = f"private-{template_id}-cover".encode()
    body = f"private-{template_id}-body".encode()
    authorization_status = "approved" if status == "active" else "pending"
    return OoxmlReferenceTemplateManifest.model_validate(
        {
            "templateId": template_id,
            "version": 1,
            "status": status,
            "sourceFormat": "pptx",
            "sourceSha256": _sha256(source),
            "slideCount": 2,
            "canvas": {
                "aspectRatio": "16:9",
                "widthEmu": 12_192_000,
                "heightEmu": 6_858_000,
            },
            "name": f"{template_id} name",
            "description": f"{template_id} description",
            "preview": {
                "coverPreviewId": "cover",
                "coverPreviewSha256": _sha256(cover),
                "bodyPreviewId": "body",
                "bodyPreviewSha256": _sha256(body),
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
                        "imageSlotCount": 1,
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
                        },
                        {
                            "slotId": "cover-image",
                            "semanticRole": "image",
                            "contentType": "image",
                            "required": False,
                            "locator": {
                                "slidePart": "ppt/slides/slide1.xml",
                                "shapeId": "3",
                                "placeholderType": None,
                                "relationshipId": "rId5",
                            },
                            "capacity": {
                                "minAspectRatio": 1.2,
                                "maxAspectRatio": 2.0,
                                "cropPolicy": "preserve-frame",
                                "alphaRequired": False,
                                "maskRequired": True,
                            },
                            "mutationPolicy": ["image-source"],
                            "replacementPolicy": {"overflow": "fail"},
                        },
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
                "authorizationStatus": authorization_status,
                "inventoryVersion": 1,
            },
        }
    )


def _seed(storage: MemoryStorage, manifest: OoxmlReferenceTemplateManifest) -> None:
    prefix = f"{CATALOG_PREFIX}/{manifest.template_id}/v{manifest.version}"
    source = f"private-{manifest.template_id}-source".encode()
    cover = f"private-{manifest.template_id}-cover".encode()
    body = f"private-{manifest.template_id}-body".encode()
    storage.objects = {
        f"{prefix}/source.pptx": _Object(source, "application/octet-stream"),
        f"{prefix}/previews/cover.png": _Object(cover, "image/png"),
        f"{prefix}/previews/body.png": _Object(body, "image/png"),
        f"{prefix}/manifest.json": _Object(
            canonical_manifest_bytes(manifest), "application/json"
        ),
    }


def test_options_include_only_verified_active_allowlisted_templates() -> None:
    storage = MemoryStorage()
    active = _manifest("operating-review")
    disabled = _manifest("simple-dark", status="disabled")
    _seed(storage, active)
    active_objects = dict(storage.objects)
    _seed(storage, disabled)
    storage.objects.update(active_objects)

    response = build_ooxml_reference_template_options(
        storage,
        [disabled, active],
        OoxmlReferenceTemplateAllowlist(
            templates=frozenset(
                {("operating-review", 1), ("simple-dark", 1)}
            )
        ),
    )

    assert response.model_dump(by_alias=True, mode="json") == {
        "options": [
            {
                "templateId": "operating-review",
                "version": 1,
                "name": "operating-review name",
                "description": "operating-review description",
                "preview": {
                    "coverAssetId": "cover",
                    "bodyAssetId": "body",
                },
                "editableRanges": [
                    {
                        "contentType": "image",
                        "mutationPolicy": "image-source",
                        "slotCount": 1,
                    },
                    {
                        "contentType": "text",
                        "mutationPolicy": "text-content",
                        "slotCount": 1,
                    },
                ],
            }
        ]
    }


def test_options_exclude_template_not_allowlisted() -> None:
    storage = MemoryStorage()
    manifest = _manifest("operating-review")
    _seed(storage, manifest)

    response = build_ooxml_reference_template_options(
        storage,
        [manifest],
        OoxmlReferenceTemplateAllowlist(templates=frozenset()),
    )

    assert response.options == []


def test_options_fail_closed_for_missing_preview_or_checksum_drift() -> None:
    missing_storage = MemoryStorage()
    missing = _manifest("operating-review")
    _seed(missing_storage, missing)
    del missing_storage.objects[
        f"{CATALOG_PREFIX}/operating-review/v1/previews/body.png"
    ]

    drift_storage = MemoryStorage()
    drifted = _manifest("simple-light")
    _seed(drift_storage, drifted)
    drift_storage.objects[
        f"{CATALOG_PREFIX}/simple-light/v1/source.pptx"
    ].content = b"checksum-drift"

    allowlist = OoxmlReferenceTemplateAllowlist(
        templates=frozenset({("operating-review", 1), ("simple-light", 1)})
    )
    missing_response = build_ooxml_reference_template_options(
        missing_storage, [missing], allowlist
    )
    drift_response = build_ooxml_reference_template_options(
        drift_storage, [drifted], allowlist
    )

    assert missing_response.options == []
    assert drift_response.options == []


def test_projection_never_exposes_private_catalog_or_locator_fields() -> None:
    storage = MemoryStorage()
    manifest = _manifest("operating-review")
    _seed(storage, manifest)

    response = build_ooxml_reference_template_options(
        storage,
        [manifest],
        OoxmlReferenceTemplateAllowlist(
            templates=frozenset({("operating-review", 1)})
        ),
    )

    serialized = response.model_dump_json(by_alias=True)
    forbidden = (
        "storage",
        "sourceSha256",
        "sourceSlide",
        "slidePart",
        "shapeId",
        "relationshipId",
        "signedUrl",
        CATALOG_PREFIX,
    )
    assert all(value not in serialized for value in forbidden)
