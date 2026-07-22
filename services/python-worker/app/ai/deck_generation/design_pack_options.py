from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.ai.deck_generation.design_pack_registry import (
    SystemDesignPackManifest,
    SystemDesignPackLayout,
    SystemDesignPackRegistry,
    load_design_pack_catalog,
)
from app.ai.deck_generation.design_pack_selector import (
    DESIGN_PACK_DIRECTORY,
    selection_sort_key,
)
from app.ai.deck_generation.models import (
    DesignProfile,
    GenerateDeckRequest,
    MediaPolicy,
    Purpose,
    RawInput,
    Tone,
)
from app.ai.deck_generation.pipeline import analyze_input


class StrictModel(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="forbid",
    )


class DesignPackOptionsRequest(StrictModel):
    topic: str = Field(min_length=1, max_length=500)
    purpose: Purpose = "inform"
    profile: DesignProfile | None = None
    tone: Tone = "professional"
    slide_count: int = Field(default=8, alias="slideCount", ge=1, le=20)
    media_policy: MediaPolicy = Field(default="balanced", alias="mediaPolicy")


class DesignPackPreview(StrictModel):
    manifest_id: str = Field(alias="manifestId", min_length=1)
    cover_preview_id: str = Field(alias="coverPreviewId", min_length=1)
    body_preview_id: str = Field(alias="bodyPreviewId", min_length=1)


class DesignPackOption(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    version: int = Field(ge=1)
    name: str = Field(min_length=1)
    family: Literal[
        "neutral",
        "executive-review",
        "kickoff-alignment",
        "editorial-insight",
    ]
    rationale: str = Field(min_length=1)
    preview: DesignPackPreview


class DesignPackOptionsResponse(StrictModel):
    catalog_version: int = Field(alias="catalogVersion", ge=1)
    options: list[DesignPackOption] = Field(max_length=3)
    fallback_used: bool = Field(alias="fallbackUsed")


CandidateRanker = Callable[
    [DesignPackOptionsRequest, list[SystemDesignPackManifest]],
    list[tuple[str, int]],
]


PACK_NAMES = {
    "neutral": "Neutral",
    "executive-review": "Executive Review",
    "kickoff-alignment": "Kickoff & Alignment",
    "editorial-insight": "Editorial Insight",
}


def generate_design_pack_options(
    request: DesignPackOptionsRequest,
    *,
    registry: SystemDesignPackRegistry | None = None,
    ranker: CandidateRanker | None = None,
) -> DesignPackOptionsResponse:
    catalog = registry or load_design_pack_catalog(DESIGN_PACK_DIRECTORY)
    candidates = [
        pack
        for pack in catalog.packs
        if pack.status == "active" and pack.provenance.license_status == "approved"
    ]
    raw_input = option_raw_input(request)
    slides = option_slides(request.slide_count)
    deterministic = sorted(
        candidates,
        key=lambda pack: selection_sort_key(pack, raw_input, slides),
    )
    fallback_used = False
    ranked = deterministic
    if ranker is not None:
        try:
            ranked = apply_ranker_order(ranker(request, candidates), candidates)
        except (LookupError, RuntimeError, TypeError, ValueError):
            ranked = deterministic
            fallback_used = True

    layouts = {layout.layout_id: layout for layout in catalog.layouts}
    return DesignPackOptionsResponse(
        catalogVersion=catalog.catalog_version,
        options=[
            option_from_pack(pack, layouts, raw_input.presentation_profile)
            for pack in ranked[:3]
        ],
        fallbackUsed=fallback_used,
    )


def option_raw_input(request: DesignPackOptionsRequest) -> RawInput:
    generate_request = GenerateDeckRequest.model_validate(
        {
            "projectId": "internal-design-options",
            "topic": request.topic,
            "slideCountRange": {
                "min": request.slide_count,
                "max": request.slide_count,
            },
            "metadata": {"purpose": request.purpose, "tone": request.tone},
            "design": {
                "profile": request.profile,
                "mediaPolicy": request.media_policy,
            },
        }
    )
    return analyze_input(generate_request)


def option_slides(slide_count: int) -> list[dict[str, object]]:
    if slide_count == 1:
        return [option_slide("cover", 0)]
    slides = [option_slide("cover", 0)]
    slides.extend(option_slide("solution", 3) for _ in range(slide_count - 2))
    slides.append(option_slide("summary", 1))
    return slides


def option_slide(slide_type: str, item_count: int) -> dict[str, object]:
    return {
        "slideType": slide_type,
        "contentItems": [
            {"contentItemId": f"option-{index}", "text": "preview"}
            for index in range(item_count)
        ],
        "mediaIntent": {"kind": "none"},
    }


def apply_ranker_order(
    order: list[tuple[str, int]],
    candidates: list[SystemDesignPackManifest],
) -> list[SystemDesignPackManifest]:
    lookup = {(pack.id, pack.version): pack for pack in candidates}
    if len(order) != len(set(order)):
        raise ValueError("provider returned duplicate design pack candidates")
    ranked = [lookup[key] for key in order]
    if set(order) != set(lookup):
        raise ValueError("provider candidate set does not match active catalog")
    return ranked


def option_from_pack(
    pack: SystemDesignPackManifest,
    layouts: Mapping[str, SystemDesignPackLayout],
    presentation_profile: str,
) -> DesignPackOption:
    pack_layouts = [layouts[layout_id] for layout_id in pack.layout_ids]
    cover = next(
        layout for layout in pack_layouts if "cover" in layout.slide_roles
    )
    body = next(
        layout
        for layout in pack_layouts
        if "cover" not in layout.slide_roles
        and "closing" not in layout.slide_roles
    )
    return DesignPackOption(
        id=pack.id,
        version=pack.version,
        name=PACK_NAMES[pack.family],
        family=pack.family,
        rationale=rationale_for(pack, presentation_profile),
        preview=DesignPackPreview(
            manifestId=pack.preview_manifest_id,
            coverPreviewId=cover.preview_id,
            bodyPreviewId=body.preview_id,
        ),
    )


def rationale_for(pack: SystemDesignPackManifest, presentation_profile: str) -> str:
    if presentation_profile in pack.supported_profiles:
        return f"{presentation_profile} 구조와 콘텐츠 밀도에 적합합니다."
    return "요청한 목적과 미디어 정책에 사용할 수 있는 안전한 대안입니다."
