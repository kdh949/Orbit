from __future__ import annotations

from dataclasses import dataclass

from typing import Any, Literal

from xml.etree import ElementTree as ET


from pydantic import BaseModel, ConfigDict, Field


from app.ai.pptx_design_importer import (
    ImportedDesignAsset,
)


from app.ai.pptx_ooxml.common import (
    PptxOoxmlMotionReasonCode,
    PptxOoxmlMotionScope,
    PptxOoxmlSyncOperationType,
    PptxOoxmlUnsupportedReasonCode,
)


class PptxOoxmlGenerationError(RuntimeError):
    pass


class UnsupportedPptxAspectRatioError(PptxOoxmlGenerationError):
    pass


class PptxRenderUnavailableError(PptxOoxmlGenerationError):
    pass


class PptxOoxmlGenerationResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    canvas: dict[str, Any]
    blueprint: dict[str, Any]
    template_blueprint: dict[str, Any] = Field(alias="templateBlueprint")
    quality_report: dict[str, Any] = Field(alias="qualityReport")
    assets: list[ImportedDesignAsset] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PptxOoxmlAppliedOperation(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    operation_type: PptxOoxmlSyncOperationType = Field(alias="operationType")
    slide_id: str | None = Field(default=None, alias="slideId")
    element_id: str | None = Field(default=None, alias="elementId")


class PptxOoxmlUnsupportedOperation(PptxOoxmlAppliedOperation):
    reason_code: PptxOoxmlUnsupportedReasonCode = Field(alias="reasonCode")


class PptxOoxmlNotesPage(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    status: Literal["preserved", "rendered", "render-unavailable"]
    source_notes_part: str = Field(
        alias="sourceNotesPart",
        pattern=r"^ppt/notesSlides/notesSlide[1-9][0-9]*\.xml$",
    )
    source_notes_master_part: str = Field(
        alias="sourceNotesMasterPart",
        pattern=r"^ppt/notesMasters/notesMaster[1-9][0-9]*\.xml$",
    )
    body_shape_id: str = Field(alias="bodyShapeId", min_length=1, max_length=64)
    body_writable: Literal[True] = Field(alias="bodyWritable")
    notes_width_emu: int = Field(alias="notesWidthEmu", gt=0)
    notes_height_emu: int = Field(alias="notesHeightEmu", gt=0)
    has_non_body_content: bool = Field(alias="hasNonBodyContent")


class PptxOoxmlNotesPageUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    slide_id: str = Field(alias="slideId", min_length=1, max_length=128)
    notes_page: PptxOoxmlNotesPage = Field(alias="notesPage")


class PptxOoxmlAppliedSlideMotion(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    slide_id: str = Field(alias="slideId")
    transition: bool = False
    animations: bool = False


class PptxOoxmlUnsupportedSlideMotion(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    slide_id: str = Field(alias="slideId")
    scope: PptxOoxmlMotionScope
    reason_code: PptxOoxmlMotionReasonCode = Field(alias="reasonCode")


class PptxOoxmlSyncResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    assets: list[ImportedDesignAsset] = Field(default_factory=list)
    element_sources: list[dict[str, Any]] = Field(
        default_factory=list,
        alias="elementSources",
    )
    applied_operations: list[PptxOoxmlAppliedOperation] = Field(
        default_factory=list,
        max_length=500,
        alias="appliedOperations",
    )
    unsupported_operations: list[PptxOoxmlUnsupportedOperation] = Field(
        default_factory=list,
        max_length=500,
        alias="unsupportedOperations",
    )
    notes_pages: list[PptxOoxmlNotesPageUpdate] = Field(
        default_factory=list,
        max_length=500,
        alias="notesPages",
    )
    applied_slide_motion: list[PptxOoxmlAppliedSlideMotion] = Field(
        default_factory=list,
        alias="appliedSlideMotion",
    )
    unsupported_slide_motion: list[PptxOoxmlUnsupportedSlideMotion] = Field(
        default_factory=list,
        alias="unsupportedSlideMotion",
    )
    warnings: list[str] = Field(default_factory=list)


@dataclass(frozen=True)
class CanvasSpec:
    preset: str
    width: int
    height: int
    aspect_ratio: str

    def payload(self) -> dict[str, Any]:
        return {
            "preset": self.preset,
            "width": self.width,
            "height": self.height,
            "aspectRatio": self.aspect_ratio,
        }


@dataclass(frozen=True)
class PackageFrameScale:
    canvas_width: int
    canvas_height: int
    slide_width_emu: int
    slide_height_emu: int


@dataclass(frozen=True)
class TextRunTemplate:
    start: int
    end: int
    run_properties: ET.Element[Any] | None


@dataclass(frozen=True)
class TextEqualSpan:
    target_start: int
    target_end: int
    source_start: int
    source_end: int


@dataclass(frozen=True)
class TextParagraphTemplate:
    start: int
    end: int
    paragraph: ET.Element[Any]
