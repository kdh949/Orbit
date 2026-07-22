from __future__ import annotations

from app.ai.deck_generation.design_pack_rollout import (
    DesignPackRolloutPolicy,
    compile_with_design_pack_rollout,
    design_pack_rollout_policy,
)
from app.ai.design_program import DeckDesignProgram


def test_rollout_policy_requires_global_flag_and_pack_allowlist() -> None:
    disabled = design_pack_rollout_policy(
        {
            "AI_PPT_SYSTEM_DESIGN_PACKS_ENABLED": "false",
            "AI_PPT_SYSTEM_DESIGN_PACK_ALLOWLIST": "executive-review",
        }
    )
    enabled = design_pack_rollout_policy(
        {
            "AI_PPT_SYSTEM_DESIGN_PACKS_ENABLED": "true",
            "AI_PPT_SYSTEM_DESIGN_PACK_ALLOWLIST": (
                "executive-review,unknown-pack"
            ),
        }
    )

    assert disabled.applies_to("executive-review") is False
    assert enabled.applies_to("executive-review") is True
    assert enabled.enabled_pack_ids == frozenset({"executive-review"})


def test_empty_env_mapping_does_not_read_process_environment(monkeypatch) -> None:
    monkeypatch.setenv("AI_PPT_SYSTEM_DESIGN_PACKS_ENABLED", "true")
    monkeypatch.setenv(
        "AI_PPT_SYSTEM_DESIGN_PACK_ALLOWLIST", "executive-review"
    )

    policy = design_pack_rollout_policy({})

    assert policy.enabled is False
    assert policy.enabled_pack_ids == frozenset()


def test_enabled_pack_uses_native_chart_and_disabled_pack_uses_safe_fallback() -> None:
    program = design_program()
    direction = program.slides[0]
    slide = {
        "title": "분기 KPI",
        "message": "근거가 있는 세 지표를 비교합니다",
        "slideType": "chart",
        "contentItems": [
            {"contentItemId": f"item-{index}", "text": f"KPI {index}"}
            for index in range(1, 4)
        ],
        "typedMetrics": [
            {
                "value": str(10 + index),
                "unit": "%",
                "label": f"KPI {index}",
                "sourceRef": f"source:{index}",
            }
            for index in range(1, 4)
        ],
        "mediaIntent": {"kind": "none"},
    }

    native = compile_with_design_pack_rollout(
        direction,
        slide,
        program,
        policy=DesignPackRolloutPolicy(True, frozenset({"executive-review"})),
    )
    fallback = compile_with_design_pack_rollout(
        direction,
        slide,
        program,
        policy=DesignPackRolloutPolicy(False, frozenset({"executive-review"})),
    )

    assert native.layout == "chart"
    assert any(element["type"] == "chart" for element in native.elements)
    assert fallback.layout != "chart"
    assert all(element["type"] != "chart" for element in fallback.elements)


def test_invalid_native_layout_falls_back_to_program_v2() -> None:
    program = design_program().model_copy(update={"layout_ids": ["missing-layout"]})
    slide = {
        "title": "운영 근거",
        "message": "안전 경로를 유지합니다",
        "slideType": "chart",
        "contentItems": [
            {"contentItemId": f"item-{index}", "text": f"근거 {index}"}
            for index in range(1, 4)
        ],
        "typedMetrics": [
            {
                "value": str(10 + index),
                "unit": "%",
                "label": f"KPI {index}",
                "sourceRef": f"source:{index}",
            }
            for index in range(1, 4)
        ],
        "mediaIntent": {"kind": "none"},
    }

    compiled = compile_with_design_pack_rollout(
        program.slides[0],
        slide,
        program,
        policy=DesignPackRolloutPolicy(True, frozenset({"executive-review"})),
    )

    assert compiled.layout != "chart"


def test_out_of_range_slide_order_falls_back_to_program_v2() -> None:
    program = design_program()
    direction = program.slides[0].model_copy(update={"order": 2})
    slide = {
        "title": "운영 근거",
        "message": "잘못된 순서에서도 기존 경로를 사용합니다",
        "slideType": "chart",
        "contentItems": [
            {"contentItemId": f"item-{index}", "text": f"근거 {index}"}
            for index in range(1, 4)
        ],
        "typedMetrics": [
            {
                "value": str(10 + index),
                "unit": "%",
                "label": f"KPI {index}",
                "sourceRef": f"source:{index}",
            }
            for index in range(1, 4)
        ],
        "mediaIntent": {"kind": "none"},
    }

    compiled = compile_with_design_pack_rollout(
        direction,
        slide,
        program,
        policy=DesignPackRolloutPolicy(True, frozenset({"executive-review"})),
    )

    assert compiled.layout != "chart"


def design_program() -> DeckDesignProgram:
    return DeckDesignProgram.model_validate(
        {
            "visualConcept": "Executive rollout",
            "paletteRoles": {
                "dominant": "#FFFFFF",
                "surface": "#F1F5F9",
                "text": "#0F172A",
                "focal": "#2563EB",
                "secondary": "#0F766E",
            },
            "typography": {
                "headingFont": "Pretendard",
                "bodyFont": "Pretendard",
                "typeScale": {"cover": 72, "title": 56, "body": 32},
            },
            "backgroundSequence": ["light"],
            "imageStyle": "Evidence-first",
            "surfaceStyle": "Flat executive surfaces",
            "designPackId": "executive-review",
            "designPackVersion": 1,
            "layoutIds": ["executive-chart-01"],
            "slides": [
                {
                    "order": 1,
                    "compositionId": "kpi-strip-evidence",
                    "variant": "light",
                    "backgroundMode": "light",
                    "focalType": "metric",
                    "assetRole": "none",
                    "requiredAsset": False,
                }
            ],
        }
    )
