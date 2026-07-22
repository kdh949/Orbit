from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, JsonValue, model_validator

from app.ai.ooxml_reference_templates.models import (
    OoxmlReferenceTemplateGenerationRequest,
    StrictModel,
)
from app.ai.ooxml_reference_templates.registry import load_repository_catalog


GenerationStage = Literal[
    "reference-extract-file",
    "source-grounding",
    "content-planning",
    "template-planning",
    "package-generation",
    "render-validation",
    "materialization",
]


class OoxmlReferenceStageDependency(StrictModel):
    stage: GenerationStage
    payload: dict[str, JsonValue]


class OoxmlReferenceGenerationStageRequest(StrictModel):
    job_id: str = Field(min_length=1, max_length=200)
    project_id: str = Field(min_length=1, max_length=200)
    stage: GenerationStage
    template_id: str = Field(min_length=1, max_length=200)
    template_version: int = Field(gt=0)
    request: OoxmlReferenceTemplateGenerationRequest
    dependencies: list[OoxmlReferenceStageDependency] = Field(max_length=7)

    @model_validator(mode="after")
    def validate_identity_and_dependencies(
        self,
    ) -> OoxmlReferenceGenerationStageRequest:
        selection = self.request.template_selection.root
        if selection.mode != "user":
            raise ValueError("stage execution requires exact user template selection")
        if (
            selection.template_id != self.template_id
            or selection.version != self.template_version
        ):
            raise ValueError("stage template identity must match request selection")
        expected = list(GENERATION_STAGE_ORDER[: GENERATION_STAGE_ORDER.index(self.stage)])
        actual = [dependency.stage for dependency in self.dependencies]
        if actual != expected:
            raise ValueError("stage dependencies must be a complete ordered prefix")
        dependency_payload = [
            item.model_dump(mode="json") for item in self.dependencies
        ]
        if _json_size(dependency_payload) > 7_340_032:
            raise ValueError("stage dependencies exceed 7 MiB")
        _reject_private_locator(dependency_payload)
        return self


class OoxmlReferenceGenerationStageResponse(StrictModel):
    stage: GenerationStage
    template_id: str = Field(min_length=1, max_length=200)
    template_version: int = Field(gt=0)
    source_slide_count: int = Field(ge=0, le=500)
    slot_count: int = Field(ge=0, le=10_000)
    artifact: dict[str, JsonValue]
    issue_codes: list[
        Annotated[str, Field(pattern=r"^OOXML_REFERENCE_[A-Z0-9_]+$")]
    ] = Field(max_length=500)

    @model_validator(mode="after")
    def validate_bounded_result(self) -> OoxmlReferenceGenerationStageResponse:
        if _json_size(self.artifact) > 1_048_576:
            raise ValueError("stage artifact exceeds 1 MiB")
        _reject_private_locator(self.artifact)
        return self


GENERATION_STAGE_ORDER: tuple[GenerationStage, ...] = (
    "reference-extract-file",
    "source-grounding",
    "content-planning",
    "template-planning",
    "package-generation",
    "render-validation",
    "materialization",
)


class OoxmlReferenceStageError(ValueError):
    def __init__(self, code: str, *, retryable: bool) -> None:
        self.code = code
        self.retryable = retryable
        super().__init__(code)


def execute_ooxml_reference_generation_stage(
    payload: OoxmlReferenceGenerationStageRequest,
) -> OoxmlReferenceGenerationStageResponse:
    """Fail closed until the exact catalog version is active and locally runnable.

    The stage transport is production-wired now; source bytes remain exclusively in
    managed storage. The remaining stage implementations are enabled only after the
    catalog entry has approved provenance, annotations, previews, and a storage adapter.
    """

    catalog_path = (
        Path(__file__).parents[1]
        / "design_library"
        / "ooxml-reference-templates"
        / "catalog.json"
    )
    catalog = load_repository_catalog(catalog_path)
    selected = next(
        (
            template
            for template in catalog.templates
            if template.template_id == payload.template_id
            and template.version == payload.template_version
        ),
        None,
    )
    if selected is None or selected.activation_blockers:
        raise OoxmlReferenceStageError(
            "OOXML_REFERENCE_TEMPLATE_UNAVAILABLE",
            retryable=False,
        )
    raise OoxmlReferenceStageError(
        "OOXML_REFERENCE_RUNTIME_UNAVAILABLE",
        retryable=True,
    )


def _json_size(value: object) -> int:
    return len(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )


def _reject_private_locator(value: object) -> None:
    if isinstance(value, list):
        for item in value:
            _reject_private_locator(item)
        return
    if not isinstance(value, dict):
        return
    forbidden = {
        "storagekey",
        "signedurl",
        "rawpackagebytes",
        "rawpackagexml",
        "packagebase64",
    }
    for key, item in value.items():
        if key.lower() in forbidden:
            raise ValueError("stage artifact contains a private locator")
        _reject_private_locator(item)
