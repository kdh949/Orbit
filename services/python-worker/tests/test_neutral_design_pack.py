from pathlib import Path
from typing import Any

from app.ai.deck_generation.design_pack_registry import load_design_pack_registry
from app.ai.design_pack_layouts.neutral import (
    compile_neutral_layout,
    select_neutral_layouts,
)
from app.ai.design_program import DeckDesignProgram, SlideCompositionDirection


MANIFEST = (
    Path(__file__).parents[1]
    / "app/ai/design_library/design-packs/neutral.json"
)


def test_neutral_registry_contains_light_dark_and_nine_native_layouts() -> None:
    registry = load_design_pack_registry(MANIFEST)

    assert [(pack.id, pack.variant) for pack in registry.packs] == [
        ("neutral-light", "light"),
        ("neutral-dark", "dark"),
    ]
    assert len(registry.layouts) == 9
    assert all(pack.provenance.source == "orbit-native" for pack in registry.packs)


def test_eight_slide_general_deck_uses_four_silhouettes_without_adjacency() -> None:
    registry = load_design_pack_registry(MANIFEST)
    slides = [
        slide("cover", 0),
        slide("solution", 3),
        slide("comparison", 3),
        slide("process", 4),
        slide("feature-grid", 3),
        slide("quote", 1),
        slide("solution", 2),
        slide("summary", 1),
    ]

    selected = select_neutral_layouts(slides, registry)
    layouts = {layout.layout_id: layout for layout in registry.layouts}
    silhouettes = [layouts[layout_id].silhouette_id for layout_id in selected]

    assert len(selected) == 8
    assert len(set(silhouettes)) >= 4
    assert all(left != right for left, right in zip(silhouettes, silhouettes[1:]))


def test_neutral_layout_compiles_editable_light_and_dark_elements() -> None:
    slide_payload = slide("solution", 3)
    for background in ("light", "dark"):
        program = design_program(background)
        direction = SlideCompositionDirection.model_validate(
            {
                "order": 1,
                "compositionId": "editorial-split",
                "variant": background,
                "backgroundMode": background,
                "focalType": "message",
                "assetRole": "none",
                "requiredAsset": False,
            }
        )

        compiled = compile_neutral_layout(
            "neutral-content-01", direction, slide_payload, program
        )

        assert compiled.background_color in {"#FFFFFF", "#111827"}
        assert any(element["role"] == "title" for element in compiled.elements)
        assert all(element["type"] != "image" for element in compiled.elements)


def slide(slide_type: str, item_count: int) -> dict[str, Any]:
    return {
        "title": f"{slide_type} title",
        "message": "한 슬라이드에 하나의 명확한 메시지를 전달합니다",
        "slideType": slide_type,
        "contentItems": [
            {"contentItemId": f"item-{index}", "text": f"근거 항목 {index}"}
            for index in range(1, item_count + 1)
        ],
        "mediaIntent": {"needed": False, "alt": ""},
    }


def design_program(background: str) -> DeckDesignProgram:
    dark = background == "dark"
    return DeckDesignProgram.model_validate(
        {
            "version": "program-v2",
            "visualConcept": "Neutral Orbit-native layout",
            "paletteRoles": {
                "dominant": "#111827" if dark else "#FFFFFF",
                "surface": "#1F2937" if dark else "#F3F4F6",
                "text": "#F9FAFB" if dark else "#111827",
                "focal": "#3B82F6",
                "secondary": "#0F766E",
            },
            "typography": {
                "headingFont": "Pretendard",
                "bodyFont": "Pretendard",
                "typeScale": {"cover": 64, "title": 40, "body": 22, "caption": 16},
            },
            "backgroundSequence": [background],
            "imageStyle": "Optional evidence media",
            "surfaceStyle": "Flat neutral fields",
            "slides": [
                {
                    "order": 1,
                    "compositionId": "editorial-split",
                    "variant": background,
                    "backgroundMode": background,
                    "focalType": "message",
                    "assetRole": "none",
                    "requiredAsset": False,
                }
            ],
        }
    )
