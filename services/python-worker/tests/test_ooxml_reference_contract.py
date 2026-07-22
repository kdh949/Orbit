from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.ai.deck_generation.models import GenerateDeckRequest
from app.ai.ooxml_reference_templates.models import (
    OoxmlReferenceTemplateGenerationJobResult,
    OoxmlReferenceTemplateGenerationRequest,
    OoxmlReferenceTemplateManifest,
    OoxmlTemplateSelection,
)


SHA256 = "a" * 64


def text_slot(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "slotId": "operating-review-v1-slide-01-title",
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
    value.update(overrides)
    return value


def source_slide(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
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
        "lockedInventorySha256": SHA256,
        "slots": [text_slot()],
    }
    value.update(overrides)
    return value


def manifest(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "templateId": "operating-review",
        "version": 1,
        "status": "active",
        "sourceFormat": "pptx",
        "sourceSha256": SHA256,
        "slideCount": 2,
        "canvas": {
            "aspectRatio": "16:9",
            "widthEmu": 12_192_000,
            "heightEmu": 6_858_000,
        },
        "name": "Operating Review",
        "description": "경영 보고와 KPI 중심",
        "preview": {
            "coverPreviewId": "cover",
            "coverPreviewSha256": SHA256,
            "bodyPreviewId": "body",
            "bodyPreviewSha256": SHA256,
        },
        "sourceSlides": [
            source_slide(),
            source_slide(
                sourceSlideId="closing-02",
                sourceSlidePart="ppt/slides/slide2.xml",
                sourceOrder=2,
                semanticRole="closing",
                previewId="body",
                slots=[],
            ),
        ],
        "provenance": {"authorizationStatus": "approved", "inventoryVersion": 1},
    }
    value.update(overrides)
    return value


def fidelity_report() -> dict[str, object]:
    return {
        "status": "passed",
        "structuralGate": {"passed": True, "issueCodes": []},
        "identityControl": {
            "status": "passed",
            "evaluatedSlideCount": 2,
            "packageWarningCount": 0,
            "lockedGeometryDriftCount": 0,
        },
        "generatedComparison": {
            "status": "passed",
            "evaluatedSlideCount": 2,
            "lockedRegionDriftCount": 0,
            "slotOverflowCount": 0,
        },
        "warningCodes": [],
    }


def test_manifest_mirror_accepts_strict_active_template() -> None:
    parsed = OoxmlReferenceTemplateManifest.model_validate(manifest())

    assert parsed.template_id == "operating-review"
    assert parsed.source_slides[0].slots[0].mutation_policy == ["text-content"]


@pytest.mark.parametrize("unknown_field", ["sourcePath", "rawXml", "storageKey"])
def test_manifest_mirror_rejects_unknown_private_fields(unknown_field: str) -> None:
    payload = manifest(**{unknown_field: "private"})

    with pytest.raises(ValidationError):
        OoxmlReferenceTemplateManifest.model_validate(payload)


def test_manifest_mirror_rejects_duplicate_ids_and_locators() -> None:
    duplicate = manifest(
        sourceSlides=[
            source_slide(
                slots=[
                    text_slot(),
                    text_slot(slotId="operating-review-v1-slide-01-subtitle"),
                ]
            ),
            source_slide(
                sourceSlideId="cover-01",
                sourceSlidePart="ppt/slides/slide2.xml",
                sourceOrder=2,
                semanticRole="closing",
                slots=[],
            ),
        ]
    )

    with pytest.raises(ValidationError):
        OoxmlReferenceTemplateManifest.model_validate(duplicate)


def test_user_selection_requires_exact_template_version() -> None:
    parsed = OoxmlTemplateSelection.model_validate(
        {"mode": "user", "templateId": "operating-review", "version": 1}
    )
    assert parsed.mode == "user"

    with pytest.raises(ValidationError):
        OoxmlTemplateSelection.model_validate(
            {"mode": "user", "templateId": "operating-review"}
        )


@pytest.mark.parametrize(
    "forbidden",
    [
        {"generationMode": "ooxml-reference"},
        {"design": {"stylePackId": "brandlogy-modern"}},
        {"templateBlueprintId": "template_file_1"},
        {"designReferences": [{"fileId": "file_1"}]},
        {"slidePresetId": "process-horizontal"},
    ],
)
def test_separate_request_rejects_generate_deck_design_selectors(
    forbidden: dict[str, object],
) -> None:
    payload: dict[str, object] = {
        "topic": "운영 리뷰",
        "templateSelection": {
            "mode": "user",
            "templateId": "operating-review",
            "version": 1,
        },
        **forbidden,
    }

    with pytest.raises(ValidationError):
        OoxmlReferenceTemplateGenerationRequest.model_validate(payload)


def test_general_generate_deck_contract_remains_strict() -> None:
    for forbidden in (
        {"generationMode": "ooxml-reference"},
        {"templateBlueprintId": "template_file_1"},
        {"designReferences": [{"fileId": "file_1"}]},
        {"slidePresetId": "process-horizontal"},
    ):
        with pytest.raises(ValidationError):
            GenerateDeckRequest.model_validate(
                {"projectId": "project_1", "topic": "운영 리뷰", **forbidden}
            )


def test_job_result_mirror_rejects_sensitive_assignment_payload() -> None:
    payload: dict[str, object] = {
        "deckId": "deck_ooxml_reference_1",
        "templateId": "template_job_1",
        "currentPackageFileId": "file_current",
        "renderAssetFileIds": ["file_slide_1"],
        "templateSnapshot": {
            "catalogTemplateId": "operating-review",
            "catalogTemplateVersion": 1,
            "sourceSha256": SHA256,
            "sourceSlideIds": ["cover-01", "closing-02"],
            "slotAssignmentCount": 1,
        },
        "fidelityReport": fidelity_report(),
        "warningCodes": [],
        "slotAssignments": [{"slotId": "private", "content": "private"}],
    }

    with pytest.raises(ValidationError):
        OoxmlReferenceTemplateGenerationJobResult.model_validate(payload)
