from __future__ import annotations

import json
from pathlib import Path
from time import perf_counter
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.ai.deck_generation.design_pack_registry import (
    SystemDesignPackLayout,
    load_design_pack_catalog,
)
from app.ai.deck_generation.design_pack_selector import (
    DESIGN_PACK_DIRECTORY,
    select_system_design_pack,
)
from app.ai.deck_generation.models import (
    DesignProfile,
    GenerateDeckRequest,
    MediaPolicy,
    PresentationProfile,
    Purpose,
    RawInput,
)
from app.ai.deck_generation.pipeline import analyze_input


class StrictModel(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="forbid",
    )


class GoldenSlide(StrictModel):
    slide_type: str = Field(alias="slideType", min_length=1)
    title: str = Field(min_length=1)
    item_count: int = Field(alias="itemCount", ge=0, le=12)
    typed_metric_count: int = Field(default=0, alias="typedMetricCount", ge=0, le=6)


class DesignPackGoldenBrief(StrictModel):
    fixture_id: str = Field(
        alias="fixtureId", pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
    )
    expected_pack_id: str = Field(
        alias="expectedPackId", pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
    )
    topic: str = Field(min_length=1)
    prompt: str = ""
    purpose: Purpose
    presentation_profile: PresentationProfile = Field(alias="presentationProfile")
    design_profile: DesignProfile | None = Field(default=None, alias="designProfile")
    media_policy: MediaPolicy = Field(default="minimal", alias="mediaPolicy")
    slides: list[GoldenSlide] = Field(min_length=8, max_length=10)
    current_silhouettes: list[str] = Field(alias="currentSilhouettes", min_length=8)
    current_capacity_violations: int = Field(
        default=0, alias="currentCapacityViolations", ge=0
    )
    current_grounding_violations: int = Field(
        default=0, alias="currentGroundingViolations", ge=0
    )

    @model_validator(mode="after")
    def validate_baseline_length(self) -> DesignPackGoldenBrief:
        if len(self.slides) != len(self.current_silhouettes):
            raise ValueError("currentSilhouettes must match golden slide count")
        return self


def load_golden_briefs(directory: Path) -> list[DesignPackGoldenBrief]:
    return [
        DesignPackGoldenBrief.model_validate_json(path.read_text(encoding="utf-8"))
        for path in sorted(directory.glob("*.json"))
    ]


def evaluate_golden_briefs(
    briefs: list[DesignPackGoldenBrief],
) -> dict[str, Any]:
    registry = load_design_pack_catalog(DESIGN_PACK_DIRECTORY)
    layouts = {layout.layout_id: layout for layout in registry.layouts}
    results: list[dict[str, Any]] = []
    for brief in briefs:
        slides = slide_payloads(brief)
        started = perf_counter()
        selection = select_system_design_pack(raw_input(brief), slides, registry=registry)
        latency_ms = round((perf_counter() - started) * 1000, 3)
        selected_layouts = [layouts[layout_id] for layout_id in selection.layout_ids]
        new_silhouettes = [layout.silhouette_id for layout in selected_layouts]
        capacity_violations = sum(
            not capacity_matches(slide, layout)
            for slide, layout in zip(slides, selected_layouts)
        )
        grounding_violations = sum(
            layout.data_requirement in {"grounded-metrics", "chart"}
            and not slide.get("typedMetrics")
            for slide, layout in zip(slides, selected_layouts)
        )
        current = rubric_result(
            brief.current_silhouettes,
            brief.current_capacity_violations,
            brief.current_grounding_violations,
        )
        proposed = rubric_result(
            new_silhouettes,
            capacity_violations,
            grounding_violations,
        )
        results.append(
            {
                "fixtureId": brief.fixture_id,
                "expectedPackId": brief.expected_pack_id,
                "selectedPackId": selection.pack_id,
                "selectionLatencyMs": latency_ms,
                "current": current,
                "new": proposed,
                "passed": (
                    selection.pack_id == brief.expected_pack_id
                    and proposed["publicationP0"] == 0
                    and proposed["publicationP1"] == 0
                    and proposed["score"] >= 85
                ),
            }
        )
    return {
        "schemaVersion": 1,
        "rubricVersion": "system-design-pack-v1",
        "fixtureCount": len(results),
        "passed": bool(results) and all(result["passed"] for result in results),
        "families": results,
        "humanEvaluation": {
            "blindPreferencePercent": None,
            "presentationReadyRating": None,
            "status": "not-measured",
        },
    }


def raw_input(brief: DesignPackGoldenBrief) -> RawInput:
    request = GenerateDeckRequest.model_validate(
        {
            "projectId": "project_design_pack_golden",
            "topic": brief.topic,
            "prompt": brief.prompt,
            "metadata": {"purpose": brief.purpose},
            "design": {
                "profile": brief.design_profile,
                "mediaPolicy": brief.media_policy,
            },
            "slideCountRange": {
                "min": len(brief.slides),
                "max": len(brief.slides),
            },
        }
    )
    return analyze_input(request).model_copy(
        update={"presentation_profile": brief.presentation_profile}
    )


def slide_payloads(brief: DesignPackGoldenBrief) -> list[dict[str, Any]]:
    return [
        {
            "title": slide.title,
            "message": "검증 가능한 하나의 핵심 메시지",
            "slideType": slide.slide_type,
            "contentItems": [
                {
                    "contentItemId": f"{brief.fixture_id}-{order}-{index}",
                    "text": f"근거 항목 {index}",
                }
                for index in range(1, slide.item_count + 1)
            ],
            "typedMetrics": [
                {
                    "value": str(10 + index),
                    "unit": "%",
                    "label": f"KPI {index}",
                    "sourceRef": f"{brief.fixture_id}:source:{index}",
                }
                for index in range(1, slide.typed_metric_count + 1)
            ],
            "mediaIntent": {"kind": "none"},
        }
        for order, slide in enumerate(brief.slides, start=1)
    ]


def capacity_matches(
    slide: dict[str, Any], layout: SystemDesignPackLayout
) -> bool:
    if "cover" in layout.slide_roles or "closing" in layout.slide_roles:
        return True
    item_count = len(slide.get("contentItems", []))
    return bool(
        layout.content_capacity.item_min
        <= item_count
        <= layout.content_capacity.item_max
    )


def rubric_result(
    silhouettes: list[str],
    capacity_violations: int,
    grounding_violations: int,
) -> dict[str, Any]:
    adjacent_duplicates = sum(
        left == right for left, right in zip(silhouettes, silhouettes[1:])
    )
    unique_silhouettes = len(set(silhouettes))
    publication_p0 = capacity_violations + grounding_violations
    publication_p1 = adjacent_duplicates + int(unique_silhouettes < 4)
    score = max(0, 100 - publication_p0 * 20 - publication_p1 * 5)
    return {
        "slideCount": len(silhouettes),
        "uniqueSilhouetteCount": unique_silhouettes,
        "adjacentDuplicateCount": adjacent_duplicates,
        "capacityViolationCount": capacity_violations,
        "groundingViolationCount": grounding_violations,
        "publicationP0": publication_p0,
        "publicationP1": publication_p1,
        "score": score,
    }


def report_json(report: dict[str, Any]) -> str:
    return json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
