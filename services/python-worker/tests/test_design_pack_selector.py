from __future__ import annotations

from typing import Any

from app.ai.deck_generation.design_pack_selector import (
    apply_design_pack_selection,
    select_system_design_pack,
)
from app.ai.deck_generation.models import GenerateDeckRequest
from app.ai.deck_generation.pipeline import analyze_input
from app.ai.design_program import DeckDesignProgram


def test_auto_selection_is_deterministic_for_catalog_version() -> None:
    raw_input = raw()

    first = select_system_design_pack(raw_input, SLIDES)
    second = select_system_design_pack(raw_input, SLIDES)

    assert first == second
    assert first.pack_id == "neutral-light"
    assert first.catalog_version == 1
    assert first.selection_mode == "auto"
    assert first.fallback_used is False


def test_explicit_system_pack_wins_over_auto_selection() -> None:
    selection = select_system_design_pack(
        raw(style_pack_id="neutral-dark"),
        SLIDES,
    )

    assert selection.pack_id == "neutral-dark"
    assert selection.selection_mode == "user"
    assert selection.reason == "explicit-system-design-pack"
    assert selection.fallback_used is False


def test_saved_design_preferences_win_over_default_variant() -> None:
    selection = select_system_design_pack(
        raw(saved_preferences={"backgroundRhythm": "dark-dominant"}),
        SLIDES,
    )

    assert selection.pack_id == "neutral-dark"
    assert selection.selection_mode == "user"
    assert selection.reason == "saved-design-pack-preferences"


def test_unsupported_profile_uses_stable_catalog_fallback() -> None:
    selection = select_system_design_pack(
        raw(profile="executive-report", purpose="report"),
        SLIDES,
    )

    assert selection.pack_id == "neutral-light"
    assert selection.fallback_used is True
    assert selection.reason == "deterministic-catalog-fallback"


def test_selection_preserves_program_compositions_and_adds_snapshot_provenance() -> (
    None
):
    selection = select_system_design_pack(raw(), SLIDES)
    selected = apply_design_pack_selection(program(), selection)

    assert [slide.composition_id for slide in selected.slides] == [
        "editorial-split",
        "editorial-split",
        "editorial-split",
        "editorial-split",
        "editorial-split",
    ]
    assert selected.design_pack_id == "neutral-light"
    assert selected.design_pack_version == 1
    assert selected.layout_ids == selection.layout_ids
    assert selected.layout_catalog_version == 1


def raw(
    *,
    profile: str = "general-inform",
    purpose: str = "inform",
    style_pack_id: str | None = None,
    saved_preferences: dict[str, Any] | None = None,
):
    request = GenerateDeckRequest.model_validate(
        {
            "projectId": "project_demo_1",
            "topic": "ORBIT",
            "metadata": {"purpose": purpose},
            "design": ({"stylePackId": style_pack_id} if style_pack_id else {}),
            "designProgramContext": {
                "savedDesignPreferences": saved_preferences or {},
            },
        }
    )
    return analyze_input(request).model_copy(update={"presentation_profile": profile})


def slide(slide_type: str, item_count: int) -> dict[str, Any]:
    return {
        "title": f"{slide_type} title",
        "message": "하나의 명확한 메시지",
        "slideType": slide_type,
        "contentItems": [
            {"contentItemId": f"item-{index}", "text": f"근거 {index}"}
            for index in range(item_count)
        ],
        "mediaIntent": {"kind": "none"},
    }


SLIDES = [
    slide("cover", 0),
    slide("solution", 3),
    slide("comparison", 3),
    slide("process", 4),
    slide("summary", 1),
]


def program() -> DeckDesignProgram:
    backgrounds = ["light"] * len(SLIDES)
    return DeckDesignProgram.model_validate(
        {
            "visualConcept": "Neutral selector fixture",
            "paletteRoles": {
                "dominant": "#FFFFFF",
                "surface": "#F3F4F6",
                "text": "#111827",
                "focal": "#2563EB",
                "secondary": "#0F766E",
            },
            "typography": {
                "headingFont": "Pretendard",
                "bodyFont": "Pretendard",
                "typeScale": {"cover": 64, "title": 40, "body": 22},
            },
            "backgroundSequence": backgrounds,
            "imageStyle": "Evidence-first",
            "surfaceStyle": "Flat",
            "slides": [
                {
                    "order": index,
                    "compositionId": "editorial-split",
                    "variant": "light",
                    "backgroundMode": "light",
                    "focalType": "message",
                    "assetRole": "none",
                    "requiredAsset": False,
                }
                for index in range(1, len(SLIDES) + 1)
            ],
        }
    )
