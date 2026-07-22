from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, JsonValue, ValidationError, model_validator

from app.ai.ooxml_reference_templates.models import (
    OoxmlReferenceTemplateGenerationRequest,
    StrictModel,
)
from app.ai.ooxml_reference_templates.generation_pipeline import (
    GenerationPipelineError,
    execute_generation_stage,
)
from app.ai.ooxml_reference_templates.generation_runtime import (
    OoxmlReferenceGenerationRuntime,
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
        expected = list(
            GENERATION_STAGE_ORDER[: GENERATION_STAGE_ORDER.index(self.stage)]
        )
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
    *,
    runtime: OoxmlReferenceGenerationRuntime | None = None,
) -> OoxmlReferenceGenerationStageResponse:
    """Execute one ordered stage without exposing private package storage details."""

    if runtime is not None:
        try:
            result = execute_generation_stage(payload, runtime=runtime)
            return OoxmlReferenceGenerationStageResponse(
                stage=payload.stage,
                template_id=payload.template_id,
                template_version=payload.template_version,
                source_slide_count=result.source_slide_count,
                slot_count=result.slot_count,
                artifact=result.artifact,
                issue_codes=result.issue_codes,
            )
        except GenerationPipelineError as error:
            raise OoxmlReferenceStageError(
                error.code,
                retryable=error.retryable,
            ) from error
        except ValidationError as error:
            raise OoxmlReferenceStageError(
                "OOXML_REFERENCE_STAGE_ARTIFACT_INVALID",
                retryable=False,
            ) from error
        except Exception as error:
            code = getattr(error, "code", "OOXML_REFERENCE_STAGE_FAILED")
            if (
                isinstance(code, str)
                and code
                and not code.startswith("OOXML_REFERENCE_")
            ):
                code = f"OOXML_REFERENCE_{code}"
            if not isinstance(code, str) or not code.startswith("OOXML_REFERENCE_"):
                code = "OOXML_REFERENCE_STAGE_FAILED"
            raise OoxmlReferenceStageError(code, retryable=False) from error

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
    if isinstance(value, str):
        if value.startswith("data:") and ";base64," in value[:256].lower():
            raise ValueError("stage artifact contains a private locator")
        if value.startswith("UEsDB"):
            raise ValueError("stage artifact contains a private locator")
        return
    if isinstance(value, list):
        for item in value:
            _reject_private_locator(item)
        return
    if not isinstance(value, dict):
        return
    for key, item in value.items():
        normalized = "".join(
            character for character in key.lower() if character.isalnum()
        )
        if (
            "storagekey" in normalized
            or "objectkey" in normalized
            or "signedurl" in normalized
            or "presignedurl" in normalized
            or "rawpackage" in normalized
            or "base64" in normalized
            or "privatebinarylocator" in normalized
            or "packagelocator" in normalized
        ):
            raise ValueError("stage artifact contains a private locator")
        _reject_private_locator(item)
