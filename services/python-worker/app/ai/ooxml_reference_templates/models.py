from __future__ import annotations

from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    RootModel,
    model_validator,
)
from pydantic.alias_generators import to_camel

from app.ai.deck_generation.models import Audience, Purpose, ReferencePolicy, Tone


Sha256 = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
TemplateId = Annotated[
    str,
    Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=1),
]
IssueCode = Annotated[str, Field(pattern=r"^[A-Z][A-Z0-9_]*$")]
MutationPolicy = Literal[
    "text-content",
    "image-source",
    "table-cell-text",
    "chart-data",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        str_strip_whitespace=True,
    )


class OoxmlTemplateSlotLocator(StrictModel):
    slide_part: Annotated[str, Field(pattern=r"^ppt/slides/slide[^/]+\.xml$")]
    shape_id: Annotated[str, Field(min_length=1, max_length=128)]
    placeholder_type: Annotated[str, Field(min_length=1, max_length=128)] | None
    relationship_id: Annotated[str, Field(min_length=1, max_length=128)] | None


class OoxmlReplacementPolicy(StrictModel):
    overflow: Literal["fail"]


class OoxmlTextSlotCapacity(StrictModel):
    max_chars: int = Field(gt=0, le=20_000)
    max_lines: int = Field(gt=0, le=500)
    max_paragraphs: int | None = Field(default=None, gt=0, le=500)
    max_bullet_depth: int | None = Field(default=None, ge=0, le=8)


class OoxmlImageSlotCapacity(StrictModel):
    min_aspect_ratio: float = Field(gt=0)
    max_aspect_ratio: float = Field(gt=0)
    crop_policy: Literal["preserve-frame", "cover", "contain"]
    alpha_required: bool = False
    mask_required: bool = False

    @model_validator(mode="after")
    def validate_aspect_ratio_range(self) -> OoxmlImageSlotCapacity:
        if self.min_aspect_ratio > self.max_aspect_ratio:
            raise ValueError("minimum aspect ratio must not exceed maximum")
        return self


class OoxmlTableCellLocator(StrictModel):
    row_index: int = Field(ge=0, le=199)
    column_index: int = Field(ge=0, le=99)
    fingerprint: Sha256


class OoxmlTableSlotCapacity(StrictModel):
    row_count: int = Field(gt=0, le=200)
    column_count: int = Field(gt=0, le=100)
    merged_cell_policy: Literal["preserve"]
    editable_cells: list[OoxmlTableCellLocator] = Field(min_length=1, max_length=10_000)


class OoxmlChartSlotCapacity(StrictModel):
    chart_type: Literal["bar", "column", "line", "pie", "doughnut"]
    max_categories: int = Field(gt=0, le=500)
    max_series: int = Field(gt=0, le=100)
    workbook_update_policy: Literal["atomic"]
    workbook_fingerprint: Sha256


class OoxmlTemplateSlotBase(StrictModel):
    slot_id: Annotated[str, Field(min_length=1, max_length=160)]
    semantic_role: Literal[
        "title",
        "subtitle",
        "body",
        "caption",
        "label",
        "metric",
        "image",
        "table",
        "chart",
    ]
    required: bool
    locator: OoxmlTemplateSlotLocator
    mutation_policy: list[MutationPolicy] = Field(min_length=1, max_length=4)
    replacement_policy: OoxmlReplacementPolicy


class OoxmlTextTemplateSlot(OoxmlTemplateSlotBase):
    content_type: Literal["text"]
    capacity: OoxmlTextSlotCapacity

    @model_validator(mode="after")
    def validate_mutation(self) -> OoxmlTextTemplateSlot:
        if self.mutation_policy != ["text-content"]:
            raise ValueError("text slot mutation policy must be text-content")
        return self


class OoxmlImageTemplateSlot(OoxmlTemplateSlotBase):
    content_type: Literal["image"]
    capacity: OoxmlImageSlotCapacity

    @model_validator(mode="after")
    def validate_locator_and_mutation(self) -> OoxmlImageTemplateSlot:
        if self.mutation_policy != ["image-source"]:
            raise ValueError("image slot mutation policy must be image-source")
        if self.locator.relationship_id is None:
            raise ValueError("image slots require a relationship locator")
        return self


class OoxmlTableTemplateSlot(OoxmlTemplateSlotBase):
    content_type: Literal["table"]
    capacity: OoxmlTableSlotCapacity

    @model_validator(mode="after")
    def validate_mutation(self) -> OoxmlTableTemplateSlot:
        if self.mutation_policy != ["table-cell-text"]:
            raise ValueError("table slot mutation policy must be table-cell-text")
        return self


class OoxmlChartTemplateSlot(OoxmlTemplateSlotBase):
    content_type: Literal["chart"]
    capacity: OoxmlChartSlotCapacity

    @model_validator(mode="after")
    def validate_locator_and_mutation(self) -> OoxmlChartTemplateSlot:
        if self.mutation_policy != ["chart-data"]:
            raise ValueError("chart slot mutation policy must be chart-data")
        if self.locator.relationship_id is None:
            raise ValueError("chart slots require a relationship locator")
        return self


OoxmlTemplateSlot = Annotated[
    OoxmlTextTemplateSlot
    | OoxmlImageTemplateSlot
    | OoxmlTableTemplateSlot
    | OoxmlChartTemplateSlot,
    Field(discriminator="content_type"),
]


class OoxmlSourceSlideRelationships(StrictModel):
    layout_part: Annotated[
        str,
        Field(pattern=r"^ppt/slideLayouts/slideLayout[^/]+\.xml$"),
    ]
    master_part: Annotated[
        str,
        Field(pattern=r"^ppt/slideMasters/slideMaster[^/]+\.xml$"),
    ]
    theme_part: Annotated[str, Field(pattern=r"^ppt/theme/theme[^/]+\.xml$")]


class OoxmlSourceSlideCapacity(StrictModel):
    text_slot_count: int = Field(ge=0, le=500)
    image_slot_count: int = Field(ge=0, le=500)
    table_slot_count: int = Field(ge=0, le=500)
    chart_slot_count: int = Field(ge=0, le=500)


class OoxmlSourceSlide(StrictModel):
    source_slide_id: Annotated[str, Field(min_length=1, max_length=128)]
    source_slide_part: Annotated[
        str,
        Field(pattern=r"^ppt/slides/slide[^/]+\.xml$"),
    ]
    source_order: int = Field(gt=0, le=500)
    semantic_role: Literal[
        "cover",
        "agenda",
        "section",
        "statement",
        "summary",
        "metric",
        "comparison",
        "chart",
        "table",
        "process",
        "timeline",
        "team-role",
        "evidence",
        "closing",
    ]
    relationships: OoxmlSourceSlideRelationships
    capacity: OoxmlSourceSlideCapacity
    preview_id: Annotated[str, Field(min_length=1, max_length=128)]
    locked_inventory_sha256: Sha256
    slots: list[OoxmlTemplateSlot] = Field(max_length=500)

    @model_validator(mode="after")
    def validate_slot_slide_parts(self) -> OoxmlSourceSlide:
        if any(
            slot.locator.slide_part != self.source_slide_part for slot in self.slots
        ):
            raise ValueError("slot locator must reference its source slide part")
        return self


class OoxmlReferenceCanvas(StrictModel):
    aspect_ratio: Literal["16:9", "4:3"]
    width_emu: int = Field(gt=0)
    height_emu: int = Field(gt=0)


class OoxmlReferencePreview(StrictModel):
    cover_preview_id: Annotated[str, Field(min_length=1, max_length=128)]
    body_preview_id: Annotated[str, Field(min_length=1, max_length=128)]


class OoxmlReferenceProvenance(StrictModel):
    authorization_status: Literal["approved", "pending", "rejected"]
    inventory_version: int = Field(gt=0)


class OoxmlReferenceTemplateManifest(StrictModel):
    template_id: TemplateId
    version: int = Field(gt=0)
    status: Literal["active", "disabled"]
    source_format: Literal["pptx"]
    source_sha256: Sha256
    slide_count: int = Field(gt=0, le=500)
    canvas: OoxmlReferenceCanvas
    name: Annotated[str, Field(min_length=1, max_length=120)]
    description: Annotated[str, Field(min_length=1, max_length=500)]
    preview: OoxmlReferencePreview
    source_slides: list[OoxmlSourceSlide] = Field(min_length=1, max_length=500)
    provenance: OoxmlReferenceProvenance

    @model_validator(mode="after")
    def validate_manifest_invariants(self) -> OoxmlReferenceTemplateManifest:
        if self.slide_count != len(self.source_slides):
            raise ValueError("slide count must match source slide annotations")
        slide_ids = [slide.source_slide_id for slide in self.source_slides]
        slide_parts = [slide.source_slide_part for slide in self.source_slides]
        if len(slide_ids) != len(set(slide_ids)):
            raise ValueError("source slide IDs must be unique")
        if len(slide_parts) != len(set(slide_parts)):
            raise ValueError("source slide parts must be unique")
        slots = [slot for slide in self.source_slides for slot in slide.slots]
        slot_ids = [slot.slot_id for slot in slots]
        if len(slot_ids) != len(set(slot_ids)):
            raise ValueError("slot IDs must be unique")
        locators = [
            (
                slot.locator.slide_part,
                slot.locator.shape_id,
                slot.locator.relationship_id,
            )
            for slot in slots
        ]
        if len(locators) != len(set(locators)):
            raise ValueError("slot locators must be unique")
        if self.status == "active":
            if self.provenance.authorization_status != "approved":
                raise ValueError("active templates require approved authorization")
            roles = {slide.semantic_role for slide in self.source_slides}
            if not {"cover", "closing"}.issubset(roles):
                raise ValueError("active templates require cover and closing roles")
            if not slots:
                raise ValueError("active templates require an editable slot")
        return self


class OoxmlUserTemplateSelection(StrictModel):
    mode: Literal["user"]
    template_id: TemplateId
    version: int = Field(gt=0)


class OoxmlAutoTemplateSelection(StrictModel):
    mode: Literal["auto"]


class OoxmlTemplateSelection(
    RootModel[OoxmlUserTemplateSelection | OoxmlAutoTemplateSelection]
):
    root: Annotated[
        OoxmlUserTemplateSelection | OoxmlAutoTemplateSelection,
        Field(discriminator="mode"),
    ]

    @property
    def mode(self) -> Literal["user", "auto"]:
        return self.root.mode


class OoxmlSlideCountRange(StrictModel):
    min: int = Field(default=5, ge=1, le=20)
    max: int = Field(default=8, ge=1, le=20)

    @model_validator(mode="after")
    def validate_order(self) -> OoxmlSlideCountRange:
        if self.min > self.max:
            raise ValueError("min must be less than or equal to max")
        return self


class OoxmlReferenceGenerationMetadata(StrictModel):
    audience: Audience = "general"
    purpose: Purpose = "inform"
    tone: Tone = "professional"


class OoxmlReferenceTemplateGenerationRequest(StrictModel):
    topic: Annotated[str, Field(min_length=1, max_length=500)]
    prompt: Annotated[str, Field(max_length=10_000)] | None = None
    target_duration_minutes: int = Field(default=10, ge=1, le=120)
    slide_count_range: OoxmlSlideCountRange = Field(default_factory=OoxmlSlideCountRange)
    metadata: OoxmlReferenceGenerationMetadata = Field(
        default_factory=OoxmlReferenceGenerationMetadata
    )
    reference_policy: ReferencePolicy = "topic-only"
    reference_file_ids: list[Annotated[str, Field(min_length=1)]] = Field(
        default_factory=list,
        max_length=10,
    )
    template_selection: OoxmlTemplateSelection


class OoxmlTemplateSnapshot(StrictModel):
    catalog_template_id: TemplateId
    catalog_template_version: int = Field(gt=0)
    source_sha256: Sha256
    source_slide_ids: list[Annotated[str, Field(min_length=1)]] = Field(
        min_length=1,
        max_length=200,
    )
    slot_assignment_count: int = Field(ge=0, le=10_000)

    @model_validator(mode="after")
    def validate_source_slide_ids(self) -> OoxmlTemplateSnapshot:
        if len(self.source_slide_ids) != len(set(self.source_slide_ids)):
            raise ValueError("source slide IDs must be unique")
        return self


FidelityStatus = Literal["not-run", "passed", "failed"]


class OoxmlStructuralGate(StrictModel):
    passed: bool
    issue_codes: list[IssueCode] = Field(max_length=500)


class OoxmlIdentityControl(StrictModel):
    status: FidelityStatus
    evaluated_slide_count: int = Field(ge=0, le=500)
    package_warning_count: int = Field(ge=0, le=10_000)
    locked_geometry_drift_count: int = Field(ge=0, le=10_000)


class OoxmlGeneratedComparison(StrictModel):
    status: FidelityStatus
    evaluated_slide_count: int = Field(ge=0, le=500)
    locked_region_drift_count: int = Field(ge=0, le=10_000)
    slot_overflow_count: int = Field(ge=0, le=10_000)


class OoxmlTemplateFidelityReport(StrictModel):
    status: FidelityStatus
    structural_gate: OoxmlStructuralGate
    identity_control: OoxmlIdentityControl
    generated_comparison: OoxmlGeneratedComparison
    warning_codes: list[IssueCode] = Field(max_length=500)

    @model_validator(mode="after")
    def validate_passed_status(self) -> OoxmlTemplateFidelityReport:
        if self.status == "passed" and not self.structural_gate.passed:
            raise ValueError("passed fidelity requires the structural gate")
        return self


class OoxmlReferenceTemplateGenerationJobResult(StrictModel):
    deck_id: Annotated[str, Field(pattern=r"^deck_[A-Za-z0-9_-]+$")]
    template_id: Annotated[str, Field(pattern=r"^template_[A-Za-z0-9_-]+$")]
    current_package_file_id: Annotated[str, Field(min_length=1)]
    render_asset_file_ids: list[Annotated[str, Field(min_length=1)]] = Field(
        max_length=500
    )
    template_snapshot: OoxmlTemplateSnapshot
    fidelity_report: OoxmlTemplateFidelityReport
    warning_codes: list[IssueCode] = Field(max_length=500)
