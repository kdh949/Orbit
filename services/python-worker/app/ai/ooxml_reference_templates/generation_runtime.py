from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Protocol

from pydantic import Field, JsonValue, model_validator

from app.ai.ooxml_reference_templates.content_adapter import ReferenceContentPlan
from app.ai.ooxml_reference_templates.models import (
    OoxmlReferenceTemplateGenerationRequest,
    OoxmlReferenceTemplateManifest,
    StrictModel,
)


class GeneratedAsset(StrictModel):
    file_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,200}$")
    original_name: str = Field(min_length=1, max_length=255)
    size: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_name(self) -> GeneratedAsset:
        if "/" in self.original_name or "\\" in self.original_name:
            raise ValueError("generated asset name cannot contain a path")
        return self


class ReferenceInput(StrictModel):
    file_id: str = Field(min_length=1, max_length=200)
    content: str = Field(max_length=200_000)
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


@dataclass(frozen=True)
class LoadedReferenceTemplate:
    manifest: OoxmlReferenceTemplateManifest
    catalog_version: str
    source_package: bytes
    source_asset: GeneratedAsset


@dataclass(frozen=True)
class RenderValidationInput:
    assets: tuple[GeneratedAsset, ...]
    slides: list[Mapping[str, Any]]
    environment: dict[str, Any]
    calibration: dict[str, Any]


class OoxmlReferenceGenerationRuntime(Protocol):
    def load_template(
        self,
        template_id: str,
        template_version: int,
    ) -> LoadedReferenceTemplate: ...

    def extract_references(
        self,
        project_id: str,
        request: OoxmlReferenceTemplateGenerationRequest,
    ) -> list[ReferenceInput]: ...

    def plan_content(
        self,
        project_id: str,
        request: OoxmlReferenceTemplateGenerationRequest,
        references: list[ReferenceInput],
    ) -> ReferenceContentPlan: ...

    def available_fonts(self) -> set[str]: ...

    def font_fallbacks(self) -> dict[str, str]: ...

    def read_image_asset(
        self,
        project_id: str,
        file_id: str,
    ) -> tuple[bytes, str]: ...

    def store_current_package(
        self,
        job_id: str,
        project_id: str,
        template_id: str,
        content: bytes,
    ) -> GeneratedAsset: ...

    def stage_baseline_package(
        self,
        job_id: str,
        project_id: str,
        template_id: str,
        content: bytes,
    ) -> GeneratedAsset: ...

    def read_current_package(
        self,
        job_id: str,
        project_id: str,
        template_id: str,
        file_id: str,
    ) -> bytes: ...

    def render_and_prepare_fidelity(
        self,
        job_id: str,
        project_id: str,
        template_id: str,
        template_version: int,
        package_file_id: str,
        package_bytes: bytes,
        source_slide_ids: list[str],
    ) -> RenderValidationInput: ...

    def render_assets(
        self,
        job_id: str,
        project_id: str,
        package_file_id: str,
        assets: list[GeneratedAsset],
    ) -> tuple[GeneratedAsset, ...]: ...
