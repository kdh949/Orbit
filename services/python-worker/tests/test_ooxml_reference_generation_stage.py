from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.ai.ooxml_reference_templates.generation_stage import (
    OoxmlReferenceGenerationStageRequest,
    OoxmlReferenceGenerationStageResponse,
    OoxmlReferenceStageError,
    execute_ooxml_reference_generation_stage,
)
from app.main import app


def _request() -> dict[str, object]:
    return {
        "jobId": "job-1",
        "projectId": "project-1",
        "stage": "reference-extract-file",
        "templateId": "operating-review",
        "templateVersion": 1,
        "request": {
            "topic": "운영 리뷰",
            "slideCountRange": {"min": 5, "max": 8},
            "templateSelection": {
                "mode": "user",
                "templateId": "operating-review",
                "version": 1,
            },
        },
        "dependencies": [],
    }


def test_stage_request_requires_exact_identity_and_dependency_prefix() -> None:
    request = OoxmlReferenceGenerationStageRequest.model_validate(_request())
    assert request.template_id == "operating-review"

    mismatch = _request()
    mismatch["templateVersion"] = 2
    with pytest.raises(ValidationError):
        OoxmlReferenceGenerationStageRequest.model_validate(mismatch)

    missing_dependency = _request()
    missing_dependency["stage"] = "content-planning"
    with pytest.raises(ValidationError):
        OoxmlReferenceGenerationStageRequest.model_validate(missing_dependency)


def test_stage_response_rejects_private_locators_and_unbounded_codes() -> None:
    common = {
        "stage": "reference-extract-file",
        "templateId": "operating-review",
        "templateVersion": 1,
        "sourceSlideCount": 0,
        "slotCount": 0,
        "issueCodes": [],
    }
    with pytest.raises(ValidationError):
        OoxmlReferenceGenerationStageResponse.model_validate(
            {**common, "artifact": {"storageKey": "private/source.pptx"}}
        )
    with pytest.raises(ValidationError):
        OoxmlReferenceGenerationStageResponse.model_validate(
            {**common, "artifact": {}, "issueCodes": ["provider-secret"]}
        )


def test_disabled_catalog_entry_fails_closed_without_fallback() -> None:
    request = OoxmlReferenceGenerationStageRequest.model_validate(_request())

    with pytest.raises(OoxmlReferenceStageError) as caught:
        execute_ooxml_reference_generation_stage(request)

    assert caught.value.code == "OOXML_REFERENCE_TEMPLATE_UNAVAILABLE"
    assert caught.value.retryable is False


def test_stage_http_boundary_returns_only_bounded_failure() -> None:
    response = TestClient(app).post(
        "/internal/ai/ooxml-reference-template-generation/stage",
        json=_request(),
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": {
            "code": "OOXML_REFERENCE_TEMPLATE_UNAVAILABLE",
            "retryable": False,
        }
    }
