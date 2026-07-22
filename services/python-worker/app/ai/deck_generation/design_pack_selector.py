from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.ai.deck_generation.design_pack_registry import (
    SystemDesignPackManifest,
    SystemDesignPackRegistry,
    load_design_pack_catalog,
)
from app.ai.deck_generation.models import RawInput
from app.ai.design_pack_layouts.neutral import select_neutral_layouts
from app.ai.design_pack_layouts.executive_review import (
    select_executive_review_layouts,
)
from app.ai.design_pack_layouts.kickoff_alignment import (
    select_kickoff_alignment_layouts,
)
from app.ai.design_program import DeckDesignProgram


DESIGN_PACK_DIRECTORY = (
    Path(__file__).resolve().parents[1] / "design_library" / "design-packs"
)


class DesignPackSelection(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    pack_id: str = Field(alias="packId")
    pack_version: int = Field(alias="packVersion", ge=1)
    selection_mode: Literal["auto", "user"] = Field(alias="selectionMode")
    layout_ids: list[str] = Field(alias="layoutIds", min_length=1)
    catalog_version: int = Field(alias="catalogVersion", ge=1)
    fallback_used: bool = Field(alias="fallbackUsed")
    reason: str = Field(min_length=1)


def select_system_design_pack(
    raw_input: RawInput,
    slides: list[dict[str, Any]],
    *,
    registry: SystemDesignPackRegistry | None = None,
) -> DesignPackSelection:
    catalog = registry or load_design_pack_catalog(DESIGN_PACK_DIRECTORY)
    approved = [
        pack
        for pack in catalog.packs
        if pack.status == "active" and pack.provenance.license_status == "approved"
    ]
    if not approved:
        raise ValueError("design pack catalog has no active approved pack")

    explicit_pack_id = (raw_input.design.style_pack_id or "").casefold()
    explicit = next(
        (pack for pack in approved if pack.id.casefold() == explicit_pack_id),
        None,
    )
    saved_preferences = raw_input.design_program_context.saved_design_preferences
    if explicit is not None:
        selected = explicit
        selection_mode: Literal["auto", "user"] = "user"
        fallback_used = False
        reason = "explicit-system-design-pack"
    else:
        compatible = [
            pack
            for pack in approved
            if raw_input.presentation_profile in pack.supported_profiles
            and raw_input.metadata.purpose in pack.supported_purposes
            and raw_input.design.media_policy in pack.media_policy
        ]
        fallback_used = not compatible
        candidates = compatible or approved
        selected = min(
            candidates,
            key=lambda pack: selection_sort_key(pack, raw_input, slides),
        )
        selection_mode = "user" if saved_preferences else "auto"
        reason = (
            "saved-design-pack-preferences"
            if saved_preferences
            else "deterministic-compatible-match"
            if compatible
            else "deterministic-catalog-fallback"
        )

    return DesignPackSelection(
        packId=selected.id,
        packVersion=selected.version,
        selectionMode=selection_mode,
        layoutIds=select_layouts(selected, slides, catalog),
        catalogVersion=catalog.catalog_version,
        fallbackUsed=fallback_used,
        reason=reason,
    )


def selection_sort_key(
    pack: SystemDesignPackManifest,
    raw_input: RawInput,
    slides: list[dict[str, Any]],
) -> tuple[int, int, int, int, int, str, int]:
    preferences = raw_input.design_program_context.saved_design_preferences
    preferred_rhythm = str(preferences.get("backgroundRhythm", ""))
    profile_penalty = int(raw_input.presentation_profile not in pack.supported_profiles)
    purpose_penalty = int(raw_input.metadata.purpose not in pack.supported_purposes)
    intent_penalty = semantic_intent_penalty(pack, raw_input)
    media_penalty = int(raw_input.design.media_policy not in pack.media_policy)
    rhythm_penalty = int(
        bool(preferred_rhythm) and pack.background_rhythm != preferred_rhythm
    )
    default_variant_penalty = int(not preferred_rhythm and pack.variant == "dark")
    role_penalty = missing_role_count(pack, slides)
    return (
        profile_penalty,
        purpose_penalty,
        intent_penalty,
        media_penalty,
        rhythm_penalty + default_variant_penalty + role_penalty,
        pack.id,
        -pack.version,
    )


def semantic_intent_penalty(
    pack: SystemDesignPackManifest,
    raw_input: RawInput,
) -> int:
    text = " ".join(
        (
            raw_input.topic,
            raw_input.prompt,
            raw_input.design_prompt,
            raw_input.brief.presentation_context,
            raw_input.brief.presentation_type,
        )
    ).casefold()
    keyword_groups = {
        "kickoff-alignment": (
            "kickoff",
            "alignment",
            "project plan",
            "roadmap",
            "schedule",
            "착수",
            "킥오프",
            "얼라인먼트",
            "로드맵",
            "일정 계획",
        ),
        "editorial-insight": (
            "market trend",
            "market insight",
            "editorial",
            "시장 동향",
            "시장 인사이트",
            "트렌드",
        ),
    }
    matched_families = {
        family
        for family, keywords in keyword_groups.items()
        if any(keyword in text for keyword in keywords)
    }
    if pack.family == "neutral":
        return int(bool(matched_families))
    if pack.family in keyword_groups:
        return int(pack.family not in matched_families)
    return 0


def missing_role_count(
    pack: SystemDesignPackManifest,
    slides: list[dict[str, Any]],
) -> int:
    required_tags = {
        "data" if slide.get("slideType") in {"data", "chart"} else "general"
        for slide in slides
    }
    return int("data" in required_tags and "data" not in pack.selection_tags)


def select_layouts(
    pack: SystemDesignPackManifest,
    slides: list[dict[str, Any]],
    registry: SystemDesignPackRegistry,
) -> list[str]:
    if pack.family == "neutral":
        return select_neutral_layouts(slides, registry)
    if pack.family == "executive-review":
        return select_executive_review_layouts(slides, registry)
    if pack.family == "kickoff-alignment":
        return select_kickoff_alignment_layouts(slides, registry)
    raise ValueError(f"unsupported design pack family: {pack.family}")


def apply_design_pack_selection(
    program: DeckDesignProgram,
    selection: DesignPackSelection,
) -> DeckDesignProgram:
    if len(selection.layout_ids) != len(program.slides):
        raise ValueError("design pack layout selection must match the slide count")
    return program.model_copy(
        update={
            "design_pack_id": selection.pack_id,
            "design_pack_version": selection.pack_version,
            "selection_mode": selection.selection_mode,
            "selection_reason": selection.reason,
            "selection_fallback_used": selection.fallback_used,
            "layout_ids": selection.layout_ids,
            "layout_catalog_version": selection.catalog_version,
        }
    )
