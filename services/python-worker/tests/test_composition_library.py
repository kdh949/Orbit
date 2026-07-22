import re
from collections import Counter
from itertools import groupby
from typing import Any

import pytest

from app.ai.composition_library import (
    COMPOSITION_SPECS,
    compile_composition,
    content_supports_composition,
    design_program_snapshot,
    normalize_design_program,
)
from app.ai.design_program import (
    ART_DIRECTOR_INSTRUCTIONS,
    COVER_COMPOSITION_IDS,
    DeckDesignProgram,
)


def program(slides: list[dict[str, Any]]) -> DeckDesignProgram:
    backgrounds = [slide.get("backgroundMode", "light") for slide in slides]
    return DeckDesignProgram.model_validate(
        {
            "version": "program-v2",
            "visualConcept": "Energetic product reveal",
            "paletteRoles": {
                "dominant": "#FFFFFF",
                "surface": "#F3F4F6",
                "text": "#111827",
                "focal": "#6D28D9",
                "secondary": "#06B6D4",
            },
            "typography": {
                "headingFont": "Pretendard",
                "bodyFont": "Pretendard",
                "typeScale": {
                    "cover": 64,
                    "title": 40,
                    "body": 22,
                    "caption": 14,
                },
            },
            "backgroundSequence": backgrounds,
            "imageStyle": "Official evidence and bold atmosphere",
            "surfaceStyle": "Flat ink fields",
            "slides": slides,
        }
    )


def slide_payload(slide_type: str, item_count: int) -> dict[str, Any]:
    return {
        "title": f"{slide_type} title",
        "message": "하나의 명확한 핵심 메시지",
        "slideType": slide_type,
        "contentItems": [
            {"contentItemId": f"item-{index}", "text": f"근거 항목 {index}"}
            for index in range(1, item_count + 1)
        ],
        "mediaIntent": {"alt": "관련 공식 이미지"},
    }


def typed_metrics(count: int = 1) -> list[dict[str, str]]:
    return [
        {
            "value": str(20 + index),
            "unit": "%",
            "label": f"근거 지표 {index}",
            "sourceRef": f"source:{index}",
        }
        for index in range(1, count + 1)
    ]


@pytest.mark.parametrize("composition_id", list(COMPOSITION_SPECS))
def test_each_composition_compiles_editable_elements(composition_id: str) -> None:
    spec = COMPOSITION_SPECS[composition_id]
    item_count = spec.min_items
    slide_type = spec.purposes[0]
    variant = spec.variants[0]
    asset_role = "evidence" if spec.media_requirement == "required" else "none"
    direction = {
        "order": 1,
        "compositionId": composition_id,
        "variant": variant,
        "backgroundMode": variant,
        "focalType": spec.focal_rule,
        "assetRole": asset_role,
        "requiredAsset": spec.media_requirement == "required",
    }
    design_program = program([direction])

    payload = slide_payload(slide_type, item_count)
    if composition_id in {"metric-poster", "kpi-strip-evidence"}:
        payload["typedMetrics"] = typed_metrics(2)
    compiled = compile_composition(
        design_program.slides[0],
        payload,
        design_program,
    )

    element_ids = {element["elementId"] for element in compiled.elements}
    assert compiled.primary_focal_element_id in element_ids
    assert all(
        element["width"] > 0 and element["height"] > 0 for element in compiled.elements
    )
    assert all(element["x"] + element["width"] <= 1920 for element in compiled.elements)
    assert all(
        element["y"] + element["height"] <= 1080 for element in compiled.elements
    )


@pytest.mark.parametrize("composition_id", COVER_COMPOSITION_IDS)
def test_generated_cover_compositions_render_minimal_cover_content(
    composition_id: str,
) -> None:
    spec = COMPOSITION_SPECS[composition_id]
    variant = spec.variants[0]
    direction = {
        "order": 1,
        "compositionId": composition_id,
        "variant": variant,
        "backgroundMode": variant,
        "focalType": spec.focal_rule,
        "assetRole": "evidence" if spec.media_requirement == "required" else "none",
        "requiredAsset": spec.media_requirement == "required",
    }
    design_program = program([direction])
    slide = {
        **slide_payload("cover", 0),
        "title": "AI로 완성하는 발표 경험",
        "message": "내용에서 리허설까지 하나의 흐름으로",
        "coverContent": {
            "title": "AI로 완성하는 발표 경험",
            "subtitle": "내용에서 리허설까지 하나의 흐름으로",
            "kicker": "ORBIT PRODUCT BRIEF",
            "presenterName": "김민지",
            "presenterRole": "Product Lead",
            "organization": "ORBIT",
            "dateText": "2026. 7. 21.",
            "reportPeriod": "2026 Q3",
            "documentLabel": "PRODUCT BRIEF",
            "profileImageAssetId": "asset-profile",
        },
    }

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )

    assert any(element["role"] == "title" for element in compiled.elements)
    assert all(element["role"] != "body" for element in compiled.elements)
    assert not any("agenda" in element["elementId"] for element in compiled.elements)


def test_diagram_first_policy_is_explicit_in_art_director_contract() -> None:
    for composition_id in (
        "process-horizontal",
        "timeline",
        "diagram-hub",
        "metric-poster",
        "kpi-strip-evidence",
        "feature-comparison",
    ):
        assert composition_id in ART_DIRECTOR_INSTRUCTIONS


def test_full_bleed_cover_omits_visible_placeholder_caption() -> None:
    direction = {
        "order": 1,
        "compositionId": "hero-full-bleed",
        "variant": "image",
        "backgroundMode": "image",
        "focalType": "hero-image",
        "assetRole": "atmosphere",
        "requiredAsset": True,
    }
    design_program = program([direction])

    compiled = compile_composition(
        design_program.slides[0],
        slide_payload("cover", 1),
        design_program,
    )

    assert not any(
        element["elementId"].endswith("_media_caption")
        for element in compiled.elements
    )


def launch_slides() -> list[dict[str, Any]]:
    definitions = [
        ("cover", 2),
        ("problem", 2),
        ("solution", 3),
        ("feature-grid", 3),
        ("data", 2),
        ("process", 3),
        ("comparison", 2),
        ("data", 3),
        ("quote", 1),
        ("summary", 2),
    ]
    return [slide_payload(slide_type, count) for slide_type, count in definitions]


def repeated_program(slide_count: int) -> DeckDesignProgram:
    return program(
        [
            {
                "order": index,
                "compositionId": "statement-poster",
                "variant": "dark",
                "backgroundMode": "dark",
                "focalType": "statement",
                "assetRole": "none",
                "requiredAsset": False,
            }
            for index in range(1, slide_count + 1)
        ]
    )


def test_normalizer_enforces_composition_and_background_rhythm() -> None:
    slides = launch_slides()
    normalized = normalize_design_program(
        repeated_program(len(slides)),
        slides,
        media_policy="hybrid",
        media_budget=4,
    )
    silhouettes = [
        COMPOSITION_SPECS[slide.composition_id].silhouette
        for slide in normalized.slides
    ]
    usage = Counter(slide.composition_id for slide in normalized.slides)

    assert normalized.slides[-1].composition_id == "cta-closing"
    assert all(left != right for left, right in zip(silhouettes, silhouettes[1:]))
    assert max(usage.values()) <= 2
    assert len(set(normalized.background_sequence)) >= 2
    assert max(
        len(list(group))
        for _, group in groupby(normalized.background_sequence)
    ) <= 4
    assert 3 <= sum(slide.asset_role != "none" for slide in normalized.slides) <= 5


def test_normalizer_preserves_approved_edge_slide_types() -> None:
    slides = [
        slide_payload("problem", 3),
        slide_payload("process", 4),
    ]

    normalized = normalize_design_program(
        repeated_program(len(slides)),
        slides,
        media_policy="minimal",
        preserve_slide_types=True,
    )

    assert normalized.slides[0].composition_id == "editorial-split"
    assert normalized.slides[-1].composition_id in {"process-horizontal", "timeline"}


def test_normalizer_breaks_long_background_runs_without_single_color_lock() -> None:
    slides = launch_slides()
    candidate = repeated_program(len(slides))
    for index, direction in enumerate(candidate.slides):
        mode = "dark" if index in {0, 8, 9} else "light"
        direction.background_mode = mode
        direction.variant = mode
    candidate.background_sequence = [
        direction.background_mode for direction in candidate.slides
    ]

    normalized = normalize_design_program(
        candidate,
        slides,
        media_policy="hybrid",
        media_budget=4,
    )

    assert set(normalized.background_sequence) == {"light", "dark"}
    assert max(
        len(list(group))
        for _, group in groupby(normalized.background_sequence)
    ) <= 4


def test_hybrid_media_budget_preserves_official_evidence_and_ai_atmosphere() -> None:
    slides = launch_slides()
    slides[6]["officialSourceAvailable"] = True

    normalized = normalize_design_program(
        repeated_program(len(slides)),
        slides,
        media_policy="hybrid",
        media_budget=4,
    )

    evidence = [
        direction for direction in normalized.slides if direction.asset_role == "evidence"
    ]
    atmosphere = [
        direction
        for direction in normalized.slides
        if direction.asset_role == "atmosphere"
    ]
    assert len(evidence) == 1
    assert evidence[0].order == 7
    assert COMPOSITION_SPECS[evidence[0].composition_id].media_requirement != "none"
    assert atmosphere
    assert 3 <= len(evidence) + len(atmosphere) <= 4


def test_hybrid_media_budget_reserves_ai_atmosphere_when_official_sources_repeat() -> None:
    slides = launch_slides()
    for slide in slides[:6]:
        slide["officialSourceAvailable"] = True

    normalized = normalize_design_program(
        repeated_program(len(slides)),
        slides,
        media_policy="hybrid",
        media_budget=4,
    )

    evidence = [
        direction for direction in normalized.slides if direction.asset_role == "evidence"
    ]
    atmosphere = [
        direction
        for direction in normalized.slides
        if direction.asset_role == "atmosphere"
    ]
    assert len(evidence) == 1
    assert len(atmosphere) >= 2
    assert normalized.slides[0].asset_role == "none"
    assert 3 <= len(evidence) + len(atmosphere) <= 4


def test_hybrid_official_metric_uses_required_image_evidence() -> None:
    slides = [
        slide_payload("cover", 2),
        slide_payload("data", 1),
        slide_payload("summary", 2),
    ]
    slides[1]["message"] = "2026년 7월 23일 출시"
    slides[1]["contentItems"] = [
        {"contentItemId": "release-date", "text": "2026년 7월 23일 출시"}
    ]
    slides[1]["officialSourceAvailable"] = True

    normalized = normalize_design_program(
        repeated_program(len(slides)),
        slides,
        media_policy="hybrid",
        media_budget=3,
    )
    evidence = normalized.slides[1]

    assert evidence.composition_id == "image-evidence"
    assert evidence.asset_role == "evidence"
    assert evidence.required_asset is True


def test_hybrid_media_budget_promotes_a_no_media_body_composition() -> None:
    definitions = [
        ("cover", 2),
        ("comparison", 4),
        ("process", 3),
        ("architecture", 3),
        ("process", 3),
        ("data", 1),
        ("quote", 1),
        ("data", 1),
        ("process", 3),
        ("summary", 2),
    ]
    slides = [slide_payload(slide_type, count) for slide_type, count in definitions]

    normalized = normalize_design_program(
        repeated_program(len(slides)),
        slides,
        media_policy="hybrid",
        media_budget=4,
    )
    media_slides = [
        direction for direction in normalized.slides if direction.asset_role != "none"
    ]

    assert 3 <= len(media_slides) <= 4
    assert any(1 < direction.order < len(slides) for direction in media_slides)


def test_qualitative_chart_uses_a_general_feature_composition() -> None:
    slides = [
        slide_payload("cover", 2),
        slide_payload("chart", 3),
        slide_payload("summary", 2),
    ]
    slides[1]["message"] = "핵심 경험은 탐험과 협력으로 구성된다"
    slides[1]["contentItems"] = [
        {"contentItemId": "explore", "text": "섬 탐험"},
        {"contentItemId": "cooperate", "text": "로컬 협력"},
        {"contentItemId": "customize", "text": "장비 조합"},
    ]

    normalized = normalize_design_program(
        repeated_program(len(slides)),
        slides,
        media_policy="minimal",
        media_budget=0,
    )
    body = normalized.slides[1]

    assert body.composition_id not in {"metric-poster", "kpi-strip-evidence"}
    assert compile_composition(body, slides[1], normalized).elements


def test_normalizer_reserves_comparison_options_for_constrained_later_slides() -> None:
    definitions = [
        ("cover", 2, "minimal-cover"),
        ("comparison", 4, "feature-comparison"),
        ("feature-grid", 4, "editorial-split"),
        ("comparison", 3, "feature-comparison"),
        ("feature-grid", 4, "editorial-split"),
        ("data", 4, "kpi-strip-evidence"),
        ("comparison", 3, "feature-comparison"),
        ("summary", 2, "cta-closing"),
    ]
    slides = [slide_payload(slide_type, count) for slide_type, count, _ in definitions]
    data_items = [
        "탐험: 신비로운 섬 자유 탐험",
        "액션: 다양한 잉크 무기와 기계 장비 활용",
        "커스터마이즈: 외모와 장비 구성 자유",
        "협동: 온라인 및 로컬 3인 협동 지원",
    ]
    slides[5]["contentItems"] = [
        {"contentItemId": f"data-{index}", "text": value}
        for index, value in enumerate(data_items, start=1)
    ]
    slides[5]["message"] = "\n".join(data_items)
    design_program = program(
        [
            {
                "order": index,
                "compositionId": composition_id,
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "text",
                "assetRole": "none",
                "requiredAsset": False,
            }
            for index, (_, _, composition_id) in enumerate(definitions, start=1)
        ]
    )

    normalized = normalize_design_program(
        design_program,
        slides,
        media_policy="hybrid",
        media_budget=4,
    )
    composition_ids = [slide.composition_id for slide in normalized.slides]
    silhouettes = [COMPOSITION_SPECS[value].silhouette for value in composition_ids]

    assert max(Counter(composition_ids).values()) <= 2
    assert all(left != right for left, right in zip(silhouettes, silhouettes[1:]))
    assert composition_ids[4] in {"kpi-strip-evidence", "diagram-hub"}
    assert composition_ids[5] in {"metric-poster", "editorial-split"}

    compiled = compile_composition(normalized.slides[5], slides[5], normalized)
    visible_text = [
        element["props"]["text"]
        for element in compiled.elements
        if element.get("type") == "text"
    ]
    assert "\n".join(data_items) not in visible_text


def test_normalizer_meets_body_layout_diversity_gate() -> None:
    definitions = [
        ("cover", 2, "minimal-cover", "none"),
        ("feature-grid", 3, "feature-comparison", "none"),
        ("solution", 3, "editorial-split", "evidence"),
        ("feature-grid", 3, "feature-comparison", "none"),
        ("data", 3, "metric-poster", "none"),
        ("process", 3, "process-horizontal", "none"),
        ("solution", 2, "editorial-split", "evidence"),
        ("summary", 2, "cta-closing", "atmosphere"),
    ]
    slides = [
        slide_payload(slide_type, count)
        for slide_type, count, _, _ in definitions
    ]
    design_program = program(
        [
            {
                "order": index,
                "compositionId": composition_id,
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "text",
                "assetRole": asset_role,
                "requiredAsset": False,
            }
            for index, (_, _, composition_id, asset_role) in enumerate(
                definitions,
                start=1,
            )
        ]
    )

    normalized = normalize_design_program(
        design_program,
        slides,
        force_light=True,
        media_policy="hybrid",
    )
    body_compositions = [
        slide.composition_id for slide in normalized.slides[1:-1]
    ]
    body_silhouettes = [
        COMPOSITION_SPECS[value].silhouette for value in body_compositions
    ]

    assert len(set(body_compositions)) >= 5
    assert all(
        left != right
        for left, right in zip(body_silhouettes, body_silhouettes[1:])
    )


def test_normalizer_preserves_explicit_dark_palette_across_compositions() -> None:
    definitions = [
        ("cover", 2, "hero-split"),
        ("feature-grid", 3, "feature-comparison"),
        ("summary", 2, "cta-closing"),
    ]
    slides = [slide_payload(slide_type, count) for slide_type, count, _ in definitions]
    design_program = program(
        [
            {
                "order": index,
                "compositionId": composition_id,
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "text",
                "assetRole": "none",
                "requiredAsset": False,
            }
            for index, (_, _, composition_id) in enumerate(definitions, start=1)
        ]
    )
    design_program.palette_roles.dominant = "#050505"
    design_program.palette_roles.surface = "#111827"
    design_program.palette_roles.text = "#F8FAFC"

    normalized = normalize_design_program(
        design_program,
        slides,
        force_dark=True,
        media_policy="minimal",
    )
    compiled = compile_composition(normalized.slides[1], slides[1], normalized)
    background = next(
        element for element in compiled.elements if element["role"] == "background"
    )

    assert normalized.background_sequence == ["dark", "dark", "dark"]
    assert all(slide.background_mode == "dark" for slide in normalized.slides)
    assert background["props"]["fill"] == "#050505"


def test_two_item_comparison_uses_distinct_even_and_odd_geometry() -> None:
    directions = [
        {
            "order": order,
            "compositionId": "feature-comparison",
            "variant": "light",
            "backgroundMode": "light",
            "focalType": "comparison",
            "assetRole": "none",
            "requiredAsset": False,
        }
        for order in range(1, 4)
    ]
    design_program = program(directions)
    slide = slide_payload("comparison", 2)

    even = compile_composition(design_program.slides[1], slide, design_program)
    odd = compile_composition(design_program.slides[2], slide, design_program)
    even_frames = [
        (element["x"], element["y"], element["width"], element["height"])
        for element in even.elements
        if str(element.get("elementId", "")).endswith("_field")
    ]
    odd_frames = [
        (element["x"], element["y"], element["width"], element["height"])
        for element in odd.elements
        if str(element.get("elementId", "")).endswith("_field")
    ]

    assert even_frames != odd_frames


def test_feature_comparison_uses_focal_field_and_distinct_accent_rules() -> None:
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "feature-comparison",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "comparison",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )
    design_program.palette_roles.surface = "#FFFFFF"
    compiled = compile_composition(
        design_program.slides[0],
        slide_payload("feature-grid", 4),
        design_program,
    )
    fields = [
        element
        for element in compiled.elements
        if str(element.get("elementId", "")).endswith("_field")
    ]
    rules = [
        element
        for element in compiled.elements
        if re.search(r"_comparison_\d+_rule$", str(element.get("elementId", "")))
    ]

    assert [field["props"]["fill"] for field in fields] == ["#6D28D9"]
    assert [rule["props"]["fill"] for rule in rules] == [
        "#6D28D9",
        "#06B6D4",
        "#6D28D9",
    ]


def test_three_item_timeline_uses_alternating_grid_track() -> None:
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "timeline",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "timeline",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )
    compiled = compile_composition(
        design_program.slides[0],
        slide_payload("process", 3),
        design_program,
    )
    labels = [
        element
        for element in compiled.elements
        if element.get("role") == "body"
    ]
    markers = [
        element
        for element in compiled.elements
        if "_timeline_marker_" in str(element.get("elementId", ""))
        and element.get("type") == "rect"
    ]

    assert [(label["x"], label["y"], label["width"]) for label in labels] == [
        (120, 360, 544),
        (688, 736, 544),
        (1256, 360, 544),
    ]
    assert all(label["props"]["fontSize"] >= 36 for label in labels)
    assert len(markers) == 3
    assert all((marker["width"], marker["height"]) == (64, 64) for marker in markers)


def test_three_step_process_uses_dominant_first_stage_and_stacked_followups() -> None:
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "process-horizontal",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "process",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )
    slide = slide_payload("process", 3)
    slide["message"] = "\n".join(item["text"] for item in slide["contentItems"])

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    fields = [
        element
        for element in compiled.elements
        if re.search(r"_step_\d+_field$", element["elementId"])
    ]
    connectors = [
        element
        for element in compiled.elements
        if "_step_connector_" in element["elementId"]
    ]
    labels = [element for element in compiled.elements if element["role"] == "body"]

    assert len(fields) == 3
    assert [
        (field["x"], field["y"], field["width"], field["height"])
        for field in fields
    ] == [
        (120, 304, 828, 552),
        (972, 304, 828, 264),
        (972, 592, 828, 264),
    ]
    assert [field["props"]["fill"] for field in fields] == [
        "#6D28D9",
        "#111827",
        "#06B6D4",
    ]
    assert len(connectors) == 2
    assert all(label["props"]["fontSize"] >= 36 for label in labels)
    assert labels[0]["props"]["fontSize"] > labels[1]["props"]["fontSize"]


def test_process_label_without_sequence_semantics_uses_feature_composition() -> None:
    slides = [
        slide_payload("cover", 1),
        {
            **slide_payload("process", 3),
            "title": "Four-player cooperation",
            "message": "The game supports flexible cooperative play.",
            "contentItems": [
                {"contentItemId": "solo", "text": "Solo-first adventure"},
                {"contentItemId": "party", "text": "Up to four players"},
                {"contentItemId": "difficulty", "text": "Adaptive difficulty"},
            ],
        },
        slide_payload("summary", 1),
    ]
    candidate = program(
        [
            {
                "order": 1,
                "compositionId": "minimal-cover",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "title",
                "assetRole": "none",
                "requiredAsset": False,
            },
            {
                "order": 2,
                "compositionId": "process-horizontal",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "process",
                "assetRole": "none",
                "requiredAsset": False,
            },
            {
                "order": 3,
                "compositionId": "cta-closing",
                "variant": "dark",
                "backgroundMode": "dark",
                "focalType": "cta",
                "assetRole": "none",
                "requiredAsset": False,
            },
        ]
    )

    normalized = normalize_design_program(candidate, slides, media_policy="minimal")

    assert normalized.slides[1].composition_id in {
        "editorial-split",
        "feature-comparison",
        "diagram-hub",
    }


def test_release_date_mislabeled_as_process_does_not_use_metric_composition() -> None:
    slides = [
        slide_payload("cover", 1),
        {
            **slide_payload("process", 3),
            "title": "Release date and purchase channels",
            "message": "The launch package is ready for purchase.",
            "contentItems": [
                {"contentItemId": "date", "text": "July 23, 2026 release"},
                {"contentItemId": "package", "text": "Physical and digital editions"},
                {"contentItemId": "store", "text": "Official store availability"},
            ],
        },
        slide_payload("summary", 1),
    ]
    candidate = program(
        [
            {
                "order": 1,
                "compositionId": "minimal-cover",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "title",
                "assetRole": "none",
                "requiredAsset": False,
            },
            {
                "order": 2,
                "compositionId": "process-horizontal",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "process",
                "assetRole": "none",
                "requiredAsset": False,
            },
            {
                "order": 3,
                "compositionId": "cta-closing",
                "variant": "dark",
                "backgroundMode": "dark",
                "focalType": "cta",
                "assetRole": "none",
                "requiredAsset": False,
            },
        ]
    )

    normalized = normalize_design_program(candidate, slides, media_policy="minimal")

    assert normalized.slides[1].composition_id not in {
        "metric-poster",
        "kpi-strip-evidence",
    }


def test_single_release_fact_mislabeled_as_process_uses_statement() -> None:
    slides = [
        slide_payload("cover", 1),
        {
            **slide_payload("process", 1),
            "title": "Launch package availability",
            "message": "The official package is ready for purchase.",
            "contentItems": [
                {"contentItemId": "package", "text": "Physical and digital editions"},
            ],
        },
        slide_payload("summary", 1),
    ]
    candidate = program(
        [
            {
                "order": 1,
                "compositionId": "minimal-cover",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "title",
                "assetRole": "none",
                "requiredAsset": False,
            },
            {
                "order": 2,
                "compositionId": "process-horizontal",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "process",
                "assetRole": "none",
                "requiredAsset": False,
            },
            {
                "order": 3,
                "compositionId": "cta-closing",
                "variant": "dark",
                "backgroundMode": "dark",
                "focalType": "cta",
                "assetRole": "none",
                "requiredAsset": False,
            },
        ]
    )

    normalized = normalize_design_program(candidate, slides, media_policy="minimal")

    assert normalized.slides[1].composition_id == "statement-poster"


def test_closing_keeps_unique_action_after_duplicate_message_item() -> None:
    direction = {
        "order": 1,
        "compositionId": "cta-closing",
        "variant": "dark",
        "backgroundMode": "dark",
        "focalType": "cta",
        "assetRole": "none",
        "requiredAsset": False,
    }
    design_program = program([direction])
    slide = {
        **slide_payload("summary", 0),
        "message": "감사 인사와 기대 소감",
        "contentItems": [
            {"contentItemId": "duplicate", "text": "감사 인사와 기대 소감"},
            {
                "contentItemId": "action",
                "text": "출시 정보를 확인하고 다음 행동을 선택하세요.",
            },
        ],
    }

    compiled = compile_composition(design_program.slides[0], slide, design_program)
    visible_text = [
        element["props"]["text"]
        for element in compiled.elements
        if element.get("type") == "text"
    ]
    message = next(
        element
        for element in compiled.elements
        if element["elementId"].endswith("_closing_message")
    )
    action = next(
        element
        for element in compiled.elements
        if element["elementId"].endswith("_closing_action_1")
    )

    assert visible_text.count("감사 인사와 기대 소감") == 1
    assert "출시 정보를 확인하고 다음 행동을 선택하세요." in visible_text
    assert message["_contentItemIds"] == ["duplicate"]
    assert action["_contentItemIds"] == ["action"]
    assert compiled.primary_focal_element_id == "el_1_program_v2_closing_message"


def test_no_media_closing_uses_large_cta_field_and_numbered_actions() -> None:
    direction = {
        "order": 1,
        "compositionId": "cta-closing",
        "variant": "dark",
        "backgroundMode": "dark",
        "focalType": "cta",
        "assetRole": "none",
        "requiredAsset": False,
    }
    design_program = program([direction])
    slide = {
        **slide_payload("summary", 0),
        "title": "Keep following the official channels",
        "message": "Get the next update from the official site.",
        "contentItems": [
            {"contentItemId": "site", "text": "Visit the official site"},
            {"contentItemId": "social", "text": "Follow the social channel"},
            {"contentItemId": "share", "text": "Share the launch update"},
        ],
    }

    compiled = compile_composition(design_program.slides[0], slide, design_program)
    message_field = next(
        element
        for element in compiled.elements
        if element["elementId"].endswith("_closing_message_field")
    )
    action_texts = [
        element
        for element in compiled.elements
        if re.search(r"_closing_action_\d+$", element["elementId"])
    ]

    assert (message_field["x"], message_field["width"], message_field["height"]) == (
        120,
        970,
        400,
    )
    assert len(action_texts) == 3
    assert all(element["props"]["fontSize"] >= 36 for element in action_texts)
    assert compiled.primary_focal_element_id == "el_1_program_v2_closing_message"


def test_statement_poster_uses_a_content_backed_full_width_field() -> None:
    direction = {
        "order": 1,
        "compositionId": "statement-poster",
        "variant": "dark",
        "backgroundMode": "dark",
        "focalType": "statement",
        "assetRole": "none",
        "requiredAsset": False,
    }
    design_program = program([direction])

    compiled = compile_composition(
        design_program.slides[0],
        slide_payload("solution", 1),
        design_program,
    )
    panel = next(
        element
        for element in compiled.elements
        if str(element.get("elementId", "")).endswith("_poster_block")
    )
    statement = next(
        element
        for element in compiled.elements
        if str(element.get("elementId", "")).endswith("_statement")
    )

    assert (panel["x"], panel["width"], panel["height"]) == (120, 1680, 584)
    assert statement["width"] >= 1500
    assert statement["props"]["fontSize"] >= 64
    assert statement["props"]["color"] == "#FFFFFF"


def test_statement_poster_promotes_trailer_with_native_play_focal() -> None:
    direction = {
        "order": 1,
        "compositionId": "statement-poster",
        "variant": "light",
        "backgroundMode": "light",
        "focalType": "statement",
        "assetRole": "none",
        "requiredAsset": False,
    }
    design_program = program([direction])
    slide = slide_payload("quote", 1)
    slide["title"] = "공식 공개 트레일러"
    slide["message"] = slide["contentItems"][0]["text"]

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )

    statement = next(
        element for element in compiled.elements if element["elementId"].endswith("_statement")
    )
    play_field = next(
        element
        for element in compiled.elements
        if element["elementId"].endswith("_statement_play_field")
    )
    play_icon = next(
        element
        for element in compiled.elements
        if element["elementId"].endswith("_statement_play_icon")
    )

    assert statement["width"] == 1120
    assert statement["props"]["verticalAlign"] == "middle"
    assert (play_field["width"], play_field["height"]) == (184, 184)
    assert play_icon["props"]["text"] == "▶"


def test_statement_poster_promotes_reservation_with_action_focal() -> None:
    direction = {
        "order": 1,
        "compositionId": "statement-poster",
        "variant": "light",
        "backgroundMode": "light",
        "focalType": "statement",
        "assetRole": "none",
        "requiredAsset": False,
    }
    design_program = program([direction])
    slide = slide_payload("quote", 1)
    slide["title"] = "지금 바로 예약 주문하세요"
    slide["message"] = slide["contentItems"][0]["text"]

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    action_icon = next(
        element
        for element in compiled.elements
        if element["elementId"].endswith("_statement_action_icon")
    )
    action_label = next(
        element
        for element in compiled.elements
        if element["elementId"].endswith("_statement_action_label")
    )

    assert action_icon["props"]["text"] == "→"
    assert action_label["props"]["text"] == "NEXT ACTION"


def test_closing_media_uses_equal_content_and_image_columns() -> None:
    direction = {
        "order": 1,
        "compositionId": "cta-closing",
        "variant": "dark",
        "backgroundMode": "dark",
        "focalType": "cta",
        "assetRole": "atmosphere",
        "requiredAsset": False,
    }
    design_program = program([direction])

    compiled = compile_composition(
        design_program.slides[0],
        slide_payload("summary", 2),
        design_program,
    )
    title = next(element for element in compiled.elements if element["role"] == "title")
    media = next(element for element in compiled.elements if element["role"] == "media")

    assert title["width"] == 828
    assert media["x"] == 972
    assert media["width"] == 828


def test_hybrid_required_evidence_without_official_source_uses_atmosphere() -> None:
    slides = [
        slide_payload("cover", 2),
        {
            **slide_payload("data", 2),
            "officialSourceAvailable": False,
        },
        slide_payload("summary", 2),
    ]
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "hero-split",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "title",
                "assetRole": "atmosphere",
                "requiredAsset": False,
            },
            {
                "order": 2,
                "compositionId": "image-evidence",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "image",
                "assetRole": "evidence",
                "requiredAsset": True,
            },
            {
                "order": 3,
                "compositionId": "cta-closing",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "cta",
                "assetRole": "atmosphere",
                "requiredAsset": False,
            },
        ]
    )

    normalized = normalize_design_program(
        design_program,
        slides,
        media_policy="hybrid",
    )
    body = normalized.slides[1]

    assert body.composition_id != "image-evidence"
    assert body.asset_role == "atmosphere"
    assert body.required_asset is False


def test_editorial_split_pair_uses_full_height_statement_panels() -> None:
    slide = slide_payload("solution", 2)
    slide["message"] = "\n".join(
        item["text"] for item in slide["contentItems"]
    )
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "editorial-split",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "text",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    body_elements = [
        element for element in compiled.elements if element.get("role") == "body"
    ]

    assert len(body_elements) == 2
    assert all(element["height"] >= 392 for element in body_elements)
    assert all(element["props"]["fontSize"] >= 30 for element in body_elements)
    assert all(element["props"]["verticalAlign"] == "middle" for element in body_elements)


def test_editorial_split_three_items_use_side_focal_and_evidence_rows() -> None:
    slide = slide_payload("solution", 3)
    slide["message"] = "\n".join(item["text"] for item in slide["contentItems"])
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "editorial-split",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "text",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    rails = [
        element
        for element in compiled.elements
        if element["elementId"].endswith("_item_1_field")
    ]
    body = [element for element in compiled.elements if element["role"] == "body"]

    assert len(rails) == 1
    assert (rails[0]["x"], rails[0]["width"], rails[0]["height"]) == (
        120,
        686,
        584,
    )
    assert (body[0]["x"], body[0]["width"]) == (168, 590)
    assert all((element["x"], element["width"]) == (972, 828) for element in body[1:])
    assert body[0]["props"]["fontSize"] > body[1]["props"]["fontSize"]
    assert all(element["props"]["verticalAlign"] == "middle" for element in body)


def test_editorial_split_distinct_message_meets_no_media_height() -> None:
    slide = slide_payload("data", 2)
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "editorial-split",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "text",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    message = next(
        element
        for element in compiled.elements
        if element["elementId"].endswith("_message")
    )

    assert message["height"] >= 376


def test_short_hero_with_media_uses_balanced_six_column_split() -> None:
    slide = slide_payload("cover", 2)
    slide["title"] = "스플래툰 레이더스 공개"
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "hero-split",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "image",
                "assetRole": "atmosphere",
                "requiredAsset": False,
            }
        ]
    )

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    title = next(element for element in compiled.elements if element["role"] == "title")
    media = next(element for element in compiled.elements if element["role"] == "media")

    assert (title["x"], title["width"]) == (120, 828)
    assert (media["x"], media["width"], media["height"]) == (972, 828, 840)


def test_long_mixed_script_hero_reserves_vertical_title_flow() -> None:
    slide = slide_payload("cover", 2)
    slide["title"] = (
        "Splatoon Raiders 발표: Nintendo Switch 2 전용 첫 스핀오프 게임"
    )
    slide["message"] = "\n".join(item["text"] for item in slide["contentItems"])
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "hero-split",
                "variant": "dark",
                "backgroundMode": "dark",
                "focalType": "image",
                "assetRole": "atmosphere",
                "requiredAsset": False,
            }
        ]
    )

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    title = next(element for element in compiled.elements if element["role"] == "title")
    message = next(
        element
        for element in compiled.elements
        if element["elementId"].endswith("_message")
    )

    assert title["props"]["fontSize"] <= 52
    assert title["height"] >= 320
    assert title["y"] + title["height"] + 32 <= message["y"]
    assert not any(
        element["elementId"].endswith("_support")
        for element in compiled.elements
    )


def test_editorial_atmosphere_media_uses_five_seven_split() -> None:
    slide = slide_payload("solution", 3)
    slide["message"] = "\n".join(
        item["text"] for item in slide["contentItems"]
    )
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "editorial-split",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "image",
                "assetRole": "atmosphere",
                "requiredAsset": False,
            }
        ]
    )

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    support = [
        element
        for element in compiled.elements
        if element["role"] == "body"
    ]
    media = next(element for element in compiled.elements if element["role"] == "media")

    assert len(support) == 3
    assert all((element["x"], element["width"]) == (262, 544) for element in support)
    assert all(element["props"]["fontSize"] >= 24 for element in support)
    assert all(element["props"]["verticalAlign"] == "middle" for element in support)
    assert (media["x"], media["width"]) == (830, 970)


def test_repeated_three_item_comparison_uses_alternate_silhouette() -> None:
    slide = slide_payload("feature-grid", 3)
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "feature-comparison",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "comparison",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )
    even_direction = design_program.slides[0].model_copy(update={"order": 2})
    odd_direction = design_program.slides[0].model_copy(update={"order": 7})

    even = compile_composition(even_direction, slide, design_program)
    odd = compile_composition(odd_direction, slide, design_program)
    even_field = next(
        element
        for element in even.elements
        if element["elementId"].endswith("_comparison_1_field")
    )
    odd_field = next(
        element
        for element in odd.elements
        if element["elementId"].endswith("_comparison_1_field")
    )
    body = [element for element in even.elements + odd.elements if element["role"] == "body"]

    assert (even_field["x"], even_field["y"], even_field["width"]) == (830, 344, 970)
    assert (odd_field["x"], odd_field["y"], odd_field["width"]) == (120, 344, 970)
    assert all(element["props"]["fontSize"] >= 24 for element in body)
    assert all(element["props"]["verticalAlign"] == "middle" for element in body)


def test_editorial_split_four_items_uses_side_focal_and_three_rows() -> None:
    slide = slide_payload("feature-grid", 4)
    slide["message"] = "\n".join(item["text"] for item in slide["contentItems"])
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "editorial-split",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "statement",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    rails = [
        element
        for element in compiled.elements
        if element["elementId"].endswith("_item_1_field")
    ]
    dividers = [
        element
        for element in compiled.elements
        if element["elementId"].endswith("_divider")
    ]
    bodies = [element for element in compiled.elements if element["role"] == "body"]

    assert len(rails) == 1
    assert (rails[0]["x"], rails[0]["width"], rails[0]["height"]) == (
        120,
        686,
        584,
    )
    assert len(dividers) == 2
    assert (bodies[0]["x"], bodies[0]["width"]) == (168, 590)
    assert all((body["x"], body["width"]) == (972, 828) for body in bodies[1:])
    assert bodies[0]["props"]["fontSize"] > bodies[1]["props"]["fontSize"]


def test_four_item_comparison_uses_one_focal_band_and_three_columns() -> None:
    slide = slide_payload("comparison", 4)
    slide["message"] = "\n".join(item["text"] for item in slide["contentItems"])
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "feature-comparison",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "comparison",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    fields = [
        element
        for element in compiled.elements
        if re.search(r"_comparison_\d+_field$", element["elementId"])
    ]
    bodies = [element for element in compiled.elements if element["role"] == "body"]

    assert len(fields) == 1
    assert (fields[0]["x"], fields[0]["width"], fields[0]["height"]) == (
        120,
        1680,
        216,
    )
    assert len(bodies) == 4
    assert [body["x"] for body in bodies[1:]] == [120, 688, 1256]
    assert all(body["width"] == 544 for body in bodies[1:])


def test_process_and_comparison_do_not_repeat_segmented_silhouette() -> None:
    slides = [
        slide_payload("cover", 1),
        slide_payload("process", 3),
        slide_payload("comparison", 3),
        slide_payload("summary", 1),
    ]
    candidate = program(
        [
            {
                "order": 1,
                "compositionId": "minimal-cover",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "title",
                "assetRole": "none",
                "requiredAsset": False,
            },
            {
                "order": 2,
                "compositionId": "process-horizontal",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "process",
                "assetRole": "none",
                "requiredAsset": False,
            },
            {
                "order": 3,
                "compositionId": "feature-comparison",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "comparison",
                "assetRole": "none",
                "requiredAsset": False,
            },
            {
                "order": 4,
                "compositionId": "cta-closing",
                "variant": "dark",
                "backgroundMode": "dark",
                "focalType": "cta",
                "assetRole": "none",
                "requiredAsset": False,
            },
        ]
    )

    normalized = normalize_design_program(
        candidate,
        slides,
        media_policy="minimal",
    )
    silhouettes = [
        COMPOSITION_SPECS[direction.composition_id].silhouette
        for direction in normalized.slides
    ]

    assert all(left != right for left, right in zip(silhouettes, silhouettes[1:]))
    assert normalized.slides[1].composition_id == "process-horizontal"
    assert normalized.slides[2].composition_id == "editorial-split"


def test_sequence_allows_third_use_when_five_process_slides_require_it() -> None:
    slides = [
        slide_payload("cover", 1),
        *[slide_payload("process", 3) for _ in range(5)],
        slide_payload("summary", 1),
    ]
    candidate = program(
        [
            {
                "order": index,
                "compositionId": (
                    "minimal-cover"
                    if index == 1
                    else "cta-closing"
                    if index == len(slides)
                    else "process-horizontal"
                ),
                "variant": "dark" if index in {1, len(slides)} else "light",
                "backgroundMode": "dark" if index in {1, len(slides)} else "light",
                "focalType": "process",
                "assetRole": "none",
                "requiredAsset": False,
            }
            for index in range(1, len(slides) + 1)
        ]
    )

    normalized = normalize_design_program(candidate, slides, media_policy="minimal")
    body = [direction.composition_id for direction in normalized.slides[1:-1]]
    silhouettes = [COMPOSITION_SPECS[value].silhouette for value in body]

    assert set(body) == {"process-horizontal", "timeline"}
    assert max(Counter(body).values()) == 3
    assert all(left != right for left, right in zip(silhouettes, silhouettes[1:]))


def test_sequence_allows_unavoidable_repeated_silhouette_for_valid_slides() -> None:
    slides = [
        slide_payload("cover", 1),
        slide_payload("problem", 1),
        slide_payload("problem", 1),
        slide_payload("solution", 2),
        slide_payload("data", 2),
        slide_payload("summary", 1),
    ]
    candidate = program(
        [
            {
                "order": index,
                "compositionId": (
                    "minimal-cover"
                    if index == 1
                    else "cta-closing"
                    if index == len(slides)
                    else "statement-poster"
                ),
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "statement",
                "assetRole": "none",
                "requiredAsset": False,
            }
            for index in range(1, len(slides) + 1)
        ]
    )

    normalized = normalize_design_program(candidate, slides, media_policy="minimal")

    assert len(normalized.slides) == len(slides)
    assert normalized.slides[1].composition_id == "statement-poster"
    assert normalized.slides[2].composition_id == "statement-poster"


def test_body_hero_split_without_media_uses_native_content_composition() -> None:
    slides = [
        slide_payload("cover", 1),
        slide_payload("feature-grid", 3),
        slide_payload("summary", 1),
    ]
    candidate = program(
        [
            {
                "order": 1,
                "compositionId": "minimal-cover",
                "variant": "dark",
                "backgroundMode": "dark",
                "focalType": "title",
                "assetRole": "none",
                "requiredAsset": False,
            },
            {
                "order": 2,
                "compositionId": "hero-split",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "title",
                "assetRole": "none",
                "requiredAsset": False,
            },
            {
                "order": 3,
                "compositionId": "cta-closing",
                "variant": "dark",
                "backgroundMode": "dark",
                "focalType": "cta",
                "assetRole": "none",
                "requiredAsset": False,
            },
        ]
    )

    normalized = normalize_design_program(candidate, slides, media_policy="minimal")

    assert normalized.slides[1].composition_id in {
        "editorial-split",
        "feature-comparison",
        "kpi-strip-evidence",
        "diagram-hub",
    }


def test_two_item_comparison_uses_asymmetric_contrasting_statement_panels() -> None:
    slide = slide_payload("comparison", 2)
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "feature-comparison",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "comparison",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    fields = [
        element
        for element in compiled.elements
        if element["elementId"].endswith("_field")
    ]
    body = [element for element in compiled.elements if element["role"] == "body"]

    assert len(fields) == 2
    assert [(field["x"], field["y"], field["width"], field["height"]) for field in fields] == [
        (120, 344, 970, 528),
        (1114, 440, 686, 336),
    ]
    assert fields[0]["props"]["fill"] == "#6D28D9"
    assert fields[1]["props"]["fill"] == "#111827"
    assert all(element["props"]["fontSize"] >= 38 for element in body)


def test_metric_poster_requires_grounded_typed_metric() -> None:
    qualitative = slide_payload("data", 2)
    qualitative["contentItems"] = [
        {"contentItemId": "item-a", "text": "긴장감 있는 전투"},
        {"contentItemId": "item-b", "text": "다양한 적 구성"},
    ]
    numeric = slide_payload("data", 2)
    numeric["contentItems"][0]["text"] = "2026년 7월 23일 출시"
    grounded = slide_payload("data", 2)
    grounded["typedMetrics"] = typed_metrics()

    assert content_supports_composition("metric-poster", qualitative) is False
    assert content_supports_composition("metric-poster", numeric) is False
    assert content_supports_composition("metric-poster", grounded) is True


def test_metric_poster_renders_value_and_unit_from_typed_metric() -> None:
    slide = slide_payload("data", 2)
    slide["contentItems"][0]["text"] = "2026년 7월 23일 출시"
    slide["typedMetrics"] = [
        {
            "value": "42",
            "unit": "%",
            "label": "전환율",
            "sourceRef": "source:metric",
        }
    ]
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "metric-poster",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "metric",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    metric = next(
        element
        for element in compiled.elements
        if element["elementId"].endswith("_metric")
    )

    assert metric["props"]["text"] == "42 %"
    assert metric["width"] == 1396
    assert metric["props"]["lineHeight"] == 1.2


def test_duplicate_kpi_strip_uses_full_height_primary_frames() -> None:
    slide = slide_payload("data", 4)
    slide["typedMetrics"] = typed_metrics(4)
    slide["contentItems"] = [
        {
            "contentItemId": f"kpi-{index}",
            "text": value,
        }
        for index, value in enumerate(
            ["2026년 7월 23일", "$49.99", "$59.99", "Switch 2 전용"],
            start=1,
        )
    ]
    slide["message"] = "\n".join(
        item["text"] for item in slide["contentItems"]
    )
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "kpi-strip-evidence",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "kpi",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    kpis = [element for element in compiled.elements if element["role"] == "highlight"]

    assert len(kpis) == 4
    assert all(element["height"] == 388 for element in kpis)
    assert all(element["props"]["verticalAlign"] == "middle" for element in kpis)


def test_two_item_kpi_strip_uses_filled_asymmetric_focal_fields() -> None:
    slide = slide_payload("data", 2)
    slide["typedMetrics"] = typed_metrics(2)
    slide["message"] = "\n".join(item["text"] for item in slide["contentItems"])
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "kpi-strip-evidence",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "kpi",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    fields = [
        element
        for element in compiled.elements
        if element["elementId"].endswith("_field")
    ]
    kpis = [element for element in compiled.elements if element["role"] == "highlight"]

    assert [
        (field["x"], field["y"], field["width"], field["height"])
        for field in fields
    ] == [
        (120, 330, 970, 460),
        (1114, 394, 686, 332),
    ]
    assert [field["props"]["fill"] for field in fields] == ["#6D28D9", "#111827"]
    assert all(field["props"]["strokeWidth"] == 0 for field in fields)
    assert kpis[0]["props"]["fontSize"] > kpis[1]["props"]["fontSize"]


def test_diagram_hub_uses_grid_width_for_korean_focal_copy() -> None:
    slide = slide_payload("feature-grid", 3)
    slide["title"] = "딥컷 아미보 피규어 출시 예고"
    slide["message"] = "\n".join(
        item["text"] for item in slide["contentItems"]
    )
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "diagram-hub",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "diagram",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    hub = next(
        element for element in compiled.elements if element["elementId"].endswith("_hub")
    )
    hub_field = next(
        element
        for element in compiled.elements
        if element["elementId"].endswith("_hub_field")
    )
    nodes = [element for element in compiled.elements if element["role"] == "body"]

    assert hub["x"] == 724
    assert hub["width"] == 472
    assert hub["props"]["fontSize"] == 56
    assert hub["props"]["color"] == "#FFFFFF"
    assert hub["props"]["text"] == "3가지\n핵심 축"
    assert hub_field["props"]["fill"] == "#6D28D9"
    assert all(element["props"]["fontSize"] >= 38 for element in nodes)
    assert all(element["width"] == 480 for element in nodes)
    assert [element["height"] for element in nodes] == [296, 296, 80]
    assert sum(
        "_connector_" in element["elementId"] for element in compiled.elements
    ) == 3


@pytest.mark.parametrize("item_count", [4, 6])
def test_diagram_hub_connects_every_outer_node(item_count: int) -> None:
    slide = slide_payload("architecture", item_count)
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "diagram-hub",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "diagram",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    connectors = [
        element
        for element in compiled.elements
        if "_connector_" in element["elementId"]
    ]

    assert len(connectors) == item_count
    assert all(connector["zIndex"] == 2 for connector in connectors)


def test_cta_closing_duplicate_message_uses_single_full_height_focal() -> None:
    slide = slide_payload("summary", 1)
    slide["message"] = slide["contentItems"][0]["text"]
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "cta-closing",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "cta",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )

    compiled = compile_composition(
        design_program.slides[0],
        slide,
        design_program,
    )
    focal = next(
        element
        for element in compiled.elements
        if element["elementId"] == compiled.primary_focal_element_id
    )
    visible_matches = [
        element
        for element in compiled.elements
        if element.get("type") == "text"
        and element.get("props", {}).get("text") == slide["message"]
    ]

    assert focal["elementId"].endswith("_message")
    assert focal["role"] == "highlight"
    assert focal["height"] >= 376
    assert focal["props"]["verticalAlign"] == "middle"
    assert len(visible_matches) == 1
    assert not any(
        element["elementId"].endswith("_closing_field")
        for element in compiled.elements
    )


def test_white_canvas_forces_light_variants() -> None:
    slides = launch_slides()
    normalized = normalize_design_program(
        repeated_program(len(slides)),
        slides,
        force_light=True,
        media_policy="hybrid",
    )

    assert set(normalized.background_sequence) == {"light"}
    assert all(slide.variant == "light" for slide in normalized.slides)
    assert all(slide.composition_id != "hero-full-bleed" for slide in normalized.slides)


def test_snapshot_records_composition_sequence() -> None:
    design_program = program(
        [
            {
                "order": 1,
                "compositionId": "minimal-cover",
                "variant": "light",
                "backgroundMode": "light",
                "focalType": "title",
                "assetRole": "none",
                "requiredAsset": False,
            }
        ]
    )

    assert design_program_snapshot(design_program)["compositionIds"] == [
        "minimal-cover"
    ]
