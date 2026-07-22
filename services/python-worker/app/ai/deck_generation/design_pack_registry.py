from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="forbid",
    )


class LayoutCapacity(StrictModel):
    title_max_lines: int = Field(alias="titleMaxLines", ge=1, le=3)
    message_max_chars: int = Field(alias="messageMaxChars", ge=20, le=400)
    item_min: int = Field(alias="itemMin", ge=0, le=12)
    item_max: int = Field(alias="itemMax", ge=0, le=12)

    @model_validator(mode="after")
    def validate_item_range(self) -> LayoutCapacity:
        if self.item_min > self.item_max:
            raise ValueError("itemMax must be greater than or equal to itemMin")
        return self


class LayoutSlot(StrictModel):
    role: Literal[
        "title",
        "subtitle",
        "body",
        "metric",
        "evidence",
        "source",
        "media",
        "table",
        "chart",
    ]
    required: bool


class SystemDesignPackLayout(StrictModel):
    layout_id: str = Field(alias="layoutId", pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    renderer_id: str = Field(alias="rendererId", pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    slide_roles: list[
        Literal[
            "cover",
            "section",
            "summary",
            "statement",
            "content",
            "comparison",
            "process",
            "timeline",
            "data",
            "chart",
            "decision",
            "closing",
        ]
    ] = Field(alias="slideRoles", min_length=1)
    silhouette_id: str = Field(alias="silhouetteId", pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    background_modes: list[Literal["light", "dark", "image"]] = Field(
        alias="backgroundModes", min_length=1
    )
    content_capacity: LayoutCapacity = Field(alias="contentCapacity")
    data_requirement: Literal[
        "none", "grounded-metrics", "table", "chart", "timeline"
    ] = Field(default="none", alias="dataRequirement")
    media_requirement: Literal["none", "optional", "required"] = Field(
        default="none", alias="mediaRequirement"
    )
    slots: list[LayoutSlot] = Field(min_length=1)
    preview_id: str = Field(alias="previewId", pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class PackProvenance(StrictModel):
    source: Literal["orbit-native", "curated-reference"]
    source_id: str | None = Field(default=None, alias="sourceId", min_length=1)
    license_status: Literal["approved", "pending", "rejected"] = Field(
        alias="licenseStatus"
    )


class SystemDesignPackManifest(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    version: int = Field(gt=0)
    family: Literal[
        "neutral",
        "executive-review",
        "kickoff-alignment",
        "editorial-insight",
    ]
    variant: Literal["light", "dark", "mixed"]
    status: Literal["draft", "active", "disabled"]
    base_style_pack_id: str = Field(
        alias="baseStylePackId", pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
    )
    supported_profiles: list[
        Literal[
            "proposal",
            "executive-report",
            "product-launch",
            "education",
            "technical",
            "research",
            "general-inform",
        ]
    ] = Field(alias="supportedProfiles", min_length=1)
    supported_purposes: list[Literal["inform", "persuade", "teach", "report"]] = Field(
        alias="supportedPurposes", min_length=1
    )
    selection_tags: list[str] = Field(alias="selectionTags", min_length=1)
    layout_ids: list[str] = Field(alias="layoutIds", min_length=1)
    background_rhythm: Literal[
        "light-dominant", "dark-dominant", "mixed"
    ] = Field(alias="backgroundRhythm")
    media_policy: list[
        Literal[
            "avoid",
            "balanced",
            "placeholder-ok",
            "provided-only",
            "public-assets",
            "ai-generated",
            "hybrid",
            "minimal",
        ]
    ] = Field(alias="mediaPolicy", min_length=1)
    preview_manifest_id: str = Field(alias="previewManifestId", min_length=1)
    provenance: PackProvenance

    @model_validator(mode="after")
    def validate_active_provenance(self) -> SystemDesignPackManifest:
        if self.status == "active" and self.provenance.license_status != "approved":
            raise ValueError("active packs require approved provenance")
        return self


class SystemDesignPackRegistry(StrictModel):
    catalog_version: int = Field(alias="catalogVersion", gt=0)
    packs: list[SystemDesignPackManifest] = Field(min_length=1)
    layouts: list[SystemDesignPackLayout] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_catalog_integrity(self) -> SystemDesignPackRegistry:
        layout_ids = [layout.layout_id for layout in self.layouts]
        if len(layout_ids) != len(set(layout_ids)):
            raise ValueError("duplicate layout ID")
        pack_ids = [(pack.id, pack.version) for pack in self.packs]
        if len(pack_ids) != len(set(pack_ids)):
            raise ValueError("duplicate pack ID and version")
        known_layouts = set(layout_ids)
        if any(
            layout_id not in known_layouts
            for pack in self.packs
            for layout_id in pack.layout_ids
        ):
            raise ValueError("pack references an unknown layout ID")
        return self
