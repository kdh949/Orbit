from __future__ import annotations

import base64
import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

from app.ai.deck_generation.design_pack_evaluation import (
    DesignPackGoldenBrief,
    raw_input,
    slide_payloads,
)
from app.ai.deck_generation.design_pack_registry import load_design_pack_catalog
from app.ai.deck_generation.design_pack_rollout import (
    DesignPackRolloutPolicy,
    KNOWN_SYSTEM_DESIGN_PACK_IDS,
    compile_with_design_pack_rollout,
)
from app.ai.deck_generation.design_pack_selector import (
    DESIGN_PACK_DIRECTORY,
    select_system_design_pack,
)
from app.ai.deck_generation.quality import (
    detect_text_overlap_candidates,
    validate_design,
    validate_layout,
)
from app.ai.deck_pptx_export import DeckPptxExportRequest, export_deck_pptx
from app.ai.design_pack_layouts.editorial_insight import (
    LAYOUT_TO_COMPOSITION as EDITORIAL_COMPOSITIONS,
)
from app.ai.design_pack_layouts.executive_review import (
    LAYOUT_TO_COMPOSITION as EXECUTIVE_COMPOSITIONS,
)
from app.ai.design_pack_layouts.kickoff_alignment import (
    LAYOUT_TO_COMPOSITION as KICKOFF_COMPOSITIONS,
)
from app.ai.design_pack_layouts.neutral import (
    LAYOUT_TO_COMPOSITION as NEUTRAL_COMPOSITIONS,
)
from app.ai.design_program import DeckDesignProgram
from app.ai.pptx_ooxml_generation import CanvasSpec, render_pptx_to_png_assets
from app.ai.visual_qa import build_montage


CANVAS = CanvasSpec(
    preset="LAYOUT_WIDE",
    width=1920,
    height=1080,
    aspect_ratio="16:9",
)


def build_golden_deck(brief: DesignPackGoldenBrief) -> dict[str, Any]:
    registry = load_design_pack_catalog(DESIGN_PACK_DIRECTORY)
    slides = slide_payloads(brief)
    selection = select_system_design_pack(raw_input(brief), slides, registry=registry)
    palette = palette_for_pack(selection.pack_id)
    program = DeckDesignProgram.model_validate(
        {
            "visualConcept": f"{selection.pack_id} golden evaluation",
            "paletteRoles": palette,
            "typography": {
                "headingFont": "Pretendard",
                "bodyFont": "Pretendard",
                "pptxFontFamily": "Noto Sans CJK KR",
                "fallbackFontFamily": "Arial",
                "typeScale": {
                    "cover": 64,
                    "title": 40,
                    "body": 22,
                    "caption": 16,
                },
            },
            "backgroundSequence": ["light" for _ in slides],
            "imageStyle": "No-media grounded golden fixture",
            "surfaceStyle": "Orbit-native editable surfaces",
            "designPackId": selection.pack_id,
            "designPackVersion": selection.pack_version,
            "selectionMode": selection.selection_mode,
            "selectionReason": selection.reason,
            "selectionFallbackUsed": selection.fallback_used,
            "layoutIds": selection.layout_ids,
            "layoutCatalogVersion": selection.catalog_version,
            "slides": [
                {
                    "order": order,
                    "compositionId": "editorial-split",
                    "variant": "light",
                    "backgroundMode": "light",
                    "focalType": "metric" if slide.get("typedMetrics") else "message",
                    "assetRole": "none",
                    "requiredAsset": False,
                }
                for order, slide in enumerate(slides, start=1)
            ],
        }
    )
    compiled_slides: list[dict[str, Any]] = []
    policy = DesignPackRolloutPolicy(
        enabled=True,
        enabled_pack_ids=KNOWN_SYSTEM_DESIGN_PACK_IDS,
    )
    for payload, direction in zip(slides, program.slides):
        layout_id = selection.layout_ids[direction.order - 1]
        compiled = compile_with_design_pack_rollout(
            direction,
            payload,
            program,
            policy=policy,
        )
        compiled_slides.append(
            {
                "slideId": f"slide_{brief.fixture_id}_{direction.order}",
                "order": direction.order,
                "title": payload["title"],
                "style": {
                    "backgroundColor": compiled.background_color,
                    "layout": (
                        "chart-focus" if compiled.layout == "chart" else compiled.layout
                    ),
                },
                "speakerNotes": "이 장표의 핵심 메시지와 근거 항목을 차례로 설명합니다.",
                "elements": compiled.elements,
                "aiNotes": {
                    "compositionPlan": {
                        **direction.model_dump(by_alias=True),
                        "compositionId": composition_for_layout(layout_id),
                    },
                    "layoutId": layout_id,
                },
            }
        )
    return {
        "canvas": CANVAS.payload(),
        "theme": {
            "backgroundColor": palette["dominant"],
            "textColor": palette["text"],
            "fontFamily": "Pretendard",
        },
        "metadata": {
            "presentationProfile": brief.presentation_profile,
            "designProgramSnapshot": program.model_dump(by_alias=True),
        },
        "slides": compiled_slides,
    }


def render_golden_artifacts(
    briefs: list[DesignPackGoldenBrief],
    output_directory: Path,
) -> dict[str, Any]:
    output_directory.mkdir(parents=True, exist_ok=False)
    render_environment = resolve_render_environment()
    results: list[dict[str, Any]] = []
    for brief in briefs:
        deck = build_golden_deck(brief)
        export = export_deck_pptx(DeckPptxExportRequest(deck=deck))
        package_bytes = base64.b64decode(export.content_base64)
        rendered = render_pptx_to_png_assets(package_bytes, CANVAS)
        montage = build_montage(rendered)
        family_directory = output_directory / brief.fixture_id
        slide_directory = family_directory / "slides"
        slide_directory.mkdir(parents=True)
        pptx_path = family_directory / f"{brief.fixture_id}.pptx"
        montage_path = family_directory / f"{brief.fixture_id}-montage.png"
        pptx_path.write_bytes(package_bytes)
        montage_path.write_bytes(montage)
        slide_files: list[dict[str, Any]] = []
        for asset in rendered:
            slide_path = slide_directory / asset.file_name
            slide_bytes = base64.b64decode(asset.content_base64)
            slide_path.write_bytes(slide_bytes)
            slide_files.append(
                {
                    "path": str(slide_path.relative_to(output_directory)),
                    "sha256": digest(slide_bytes),
                }
            )
        layout_issues = validate_layout(deck)
        design_issues = validate_design(deck)
        overlap_candidates = detect_text_overlap_candidates(deck)
        passed = (
            len(rendered) == len(brief.slides)
            and not export.warnings
            and not layout_issues
            and not design_issues
            and not overlap_candidates
        )
        results.append(
            {
                "fixtureId": brief.fixture_id,
                "expectedPackId": brief.expected_pack_id,
                "slideCount": len(rendered),
                "pptx": {
                    "path": str(pptx_path.relative_to(output_directory)),
                    "sha256": digest(package_bytes),
                    "warningCount": len(export.warnings),
                },
                "montage": {
                    "path": str(montage_path.relative_to(output_directory)),
                    "sha256": digest(montage),
                },
                "slides": slide_files,
                "layoutIssues": issue_payloads(layout_issues),
                "designIssues": issue_payloads(design_issues),
                "textOverlapCandidateCount": len(overlap_candidates),
                "passed": passed,
            }
        )
    manifest = {
        "schemaVersion": 1,
        "renderer": "libreoffice-pdf-pymupdf",
        "renderEnvironment": render_environment,
        "fixtureCount": len(results),
        "passed": bool(results) and all(result["passed"] for result in results),
        "families": results,
    }
    (output_directory / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def palette_for_pack(pack_id: str) -> dict[str, str]:
    if pack_id == "kickoff-alignment":
        return {
            "dominant": "#FFFFFF",
            "surface": "#EEF2FF",
            "text": "#172554",
            "focal": "#4F46E5",
            "secondary": "#C2410C",
        }
    if pack_id == "editorial-insight":
        return {
            "dominant": "#FFFCF7",
            "surface": "#F5EFE6",
            "text": "#1F2937",
            "focal": "#BE123C",
            "secondary": "#1E3A5F",
        }
    return {
        "dominant": "#FFFFFF",
        "surface": "#F1F5F9",
        "text": "#0F172A",
        "focal": "#2563EB",
        "secondary": "#0F766E",
    }


def composition_for_layout(layout_id: str) -> str:
    native_compositions = {
        **NEUTRAL_COMPOSITIONS,
        **EXECUTIVE_COMPOSITIONS,
        **KICKOFF_COMPOSITIONS,
        **EDITORIAL_COMPOSITIONS,
        "executive-table-01": "feature-comparison",
        "executive-chart-01": "kpi-strip-evidence",
        "kickoff-roles-01": "feature-comparison",
        "kickoff-schedule-01": "timeline",
    }
    return native_compositions[layout_id]


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def resolve_render_environment() -> dict[str, str]:
    font_match = shutil.which("fc-match")
    office = shutil.which("libreoffice") or shutil.which("soffice")
    if font_match is None or office is None:
        raise RuntimeError("LibreOffice and fontconfig are required for golden render")
    font_result = subprocess.run(
        [font_match, "Noto Sans CJK KR", "--format", "%{family}\n%{file}\n"],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    font_lines = [line.strip() for line in font_result.stdout.splitlines() if line.strip()]
    if len(font_lines) < 2 or "Noto Sans CJK KR" not in font_lines[0]:
        raise RuntimeError("Noto Sans CJK KR is required for Korean golden render")
    font_path = Path(font_lines[1])
    office_result = subprocess.run(
        [office, "--version"],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return {
        "fontFamily": font_lines[0],
        "fontFile": font_path.name,
        "fontSha256": digest(font_path.read_bytes()),
        "libreOfficeVersion": office_result.stdout.strip(),
    }


def issue_payloads(issues: list[Any]) -> list[dict[str, Any]]:
    return [
        {
            "code": issue.code,
            "path": issue.path,
            "blocking": issue.blocking,
            "message": issue.message,
        }
        for issue in issues
    ]
