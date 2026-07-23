from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image, ImageDraw

from app.ai.ooxml_reference_templates.fidelity import (
    evaluate_ooxml_reference_fidelity,
)
from app.ai.ooxml_reference_templates.font_aliases import (
    approved_font_alias_policy,
)


TEMPLATE_IDS = [
    "simple-light",
    "simple-dark",
    "operating-review",
    "business-review",
    "project-kickoff",
    "team-alignment",
    "market-trends-report",
]
SHA256 = "a" * 64


def _png(*, slot_color: str = "#2563EB") -> bytes:
    image = Image.new("RGB", (160, 90), "#FFFFFF")
    draw = ImageDraw.Draw(image)
    draw.rectangle((8, 8, 152, 82), outline="#111827", width=2)
    draw.rectangle((48, 28, 112, 62), fill=slot_color)
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _mask(*, includes_slot: bool) -> bytes:
    image = Image.new("L", (160, 90), 0)
    if includes_slot:
        ImageDraw.Draw(image).rectangle((48, 28, 112, 62), fill=255)
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _environment(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "renderer": "libreoffice",
        "rendererVersion": "25.2.3.2",
        "fontFiles": [
            {
                "family": "Noto Sans CJK KR",
                "role": "resolved",
                "sha256": SHA256,
            }
        ],
        "sourceSha256": SHA256,
        "templateManifestSha256": "b" * 64,
        "artifactSha256": "c" * 64,
    }
    value.update(overrides)
    return value


def _calibration(template_ids: list[str] | None = None) -> dict[str, object]:
    selected = template_ids if template_ids is not None else TEMPLATE_IDS
    return {
        "status": "calibrated",
        "lockedRegionSsimThreshold": 0.998,
        "geometryEdgeTolerancePx": 0,
        "rationale": "7개 identity-control baseline의 deterministic renderer 분포",
        "fontAliasPolicy": approved_font_alias_policy().model_dump(
            by_alias=True,
            mode="json",
        ),
        "identityBaselines": [
            {
                "templateId": template_id,
                "version": 1,
                "renderer": "libreoffice",
                "rendererVersion": "25.2.3.2",
                "reportSha256": chr(97 + index) * 64,
            }
            for index, template_id in enumerate(selected)
        ],
    }


def _locked_snapshot() -> dict[str, object]:
    return {
        "relationships": {
            "layout": {"part": "ppt/slideLayouts/slideLayout1.xml", "sha256": SHA256},
            "master": {"part": "ppt/slideMasters/slideMaster1.xml", "sha256": SHA256},
            "theme": {"part": "ppt/theme/theme1.xml", "sha256": SHA256},
        },
        "shapes": [
            {
                "shapeId": "7",
                "geometry": {"x": 10, "y": 10, "cx": 120, "cy": 60, "zIndex": 1},
                "style": {
                    "fill": "#FFFFFF",
                    "line": "#111827",
                    "shadow": None,
                    "fontFamily": "Noto Sans CJK KR",
                    "fontSize": 24,
                    "fontWeight": "bold",
                },
            }
        ]
    }


def _evaluate(
    *,
    mode: str = "identity-control",
    source_png: bytes | None = None,
    generated_png: bytes | None = None,
    mask_png: bytes | None = None,
    source_locked: dict[str, object] | None = None,
    generated_locked: dict[str, object] | None = None,
    package_warnings: list[str] | None = None,
    environment: dict[str, object] | None = None,
    calibration: dict[str, object] | None = None,
) -> dict[str, object]:
    return evaluate_ooxml_reference_fidelity(
        template_id="operating-review",
        template_version=1,
        mode=mode,
        slides=[
            {
                "sourceSlideId": "operating-review-slide-01",
                "sourcePng": source_png or _png(),
                "generatedPng": generated_png or _png(),
                "intendedSlotMaskPng": mask_png or _mask(includes_slot=False),
                "sourceLockedSnapshot": source_locked or _locked_snapshot(),
                "generatedLockedSnapshot": generated_locked or _locked_snapshot(),
            }
        ],
        package_warnings=package_warnings or [],
        environment=environment or _environment(),
        calibration=calibration or _calibration(),
    )


def test_noop_identity_control_passes_exact_locked_region_gate() -> None:
    report = _evaluate()

    assert report["status"] == "passed"
    assert report["structuralGate"] == {"passed": True, "issueCodes": []}
    assert report["identityControl"]["status"] == "passed"
    assert report["identityControl"]["lockedGeometryDriftCount"] == 0
    assert report["slides"][0]["wholeImageSsim"] == 1.0
    assert report["slides"][0]["lockedRegionSsim"] == 1.0
    assert report["slides"][0]["intendedSlotMaskPixelCount"] == 0


def test_generated_comparison_excludes_intended_slot_mask_from_locked_region() -> None:
    report = _evaluate(
        mode="generated-comparison",
        generated_png=_png(slot_color="#DC2626"),
        mask_png=_mask(includes_slot=True),
    )

    assert report["status"] == "passed"
    assert report["generatedComparison"]["status"] == "passed"
    assert report["slides"][0]["wholeImageSsim"] < 1.0
    assert report["slides"][0]["lockedRegionSsim"] == 1.0
    assert report["slides"][0]["intendedSlotMaskPixelCount"] > 0
    assert report["slides"][0]["lockedRegionDriftCount"] == 0


@pytest.mark.parametrize(
    ("drift", "issue_code"),
    [
        ("geometry", "OOXML_REFERENCE_FIDELITY_LOCKED_GEOMETRY_DRIFT"),
        ("style", "OOXML_REFERENCE_FIDELITY_LOCKED_STYLE_DRIFT"),
        (
            "relationship",
            "OOXML_REFERENCE_FIDELITY_LOCKED_RELATIONSHIP_DRIFT",
        ),
        ("package", "OOXML_REFERENCE_PACKAGE_VALIDATION_FAILED"),
    ],
)
def test_known_drift_fixture_is_a_hard_failure(drift: str, issue_code: str) -> None:
    generated = _locked_snapshot()
    warnings: list[str] = []
    if drift == "geometry":
        generated["shapes"][0]["geometry"]["x"] = 11
    elif drift == "style":
        generated["shapes"][0]["style"]["fill"] = "#F8FAFC"
    elif drift == "relationship":
        generated["relationships"]["theme"]["sha256"] = "d" * 64
    else:
        warnings = ["UNRESOLVED_RELATIONSHIP"]

    report = _evaluate(generated_locked=generated, package_warnings=warnings)

    assert report["status"] == "failed"
    assert report["structuralGate"]["passed"] is False
    assert issue_code in report["structuralGate"]["issueCodes"]


@pytest.mark.parametrize(
    "missing_field",
    [
        "renderer",
        "rendererVersion",
        "fontFiles",
        "sourceSha256",
        "templateManifestSha256",
        "artifactSha256",
    ],
)
def test_missing_renderer_font_version_or_checksum_is_never_passed(
    missing_field: str,
) -> None:
    environment = _environment()
    del environment[missing_field]

    report = _evaluate(environment=environment)

    assert report["status"] == "not-run"
    assert report["structuralGate"]["passed"] is False
    assert "OOXML_REFERENCE_FIDELITY_ENVIRONMENT_INCOMPLETE" in report["warningCodes"]


def test_threshold_is_unapproved_until_all_seven_identity_baselines_exist() -> None:
    report = _evaluate(calibration=_calibration(TEMPLATE_IDS[:6]))

    assert report["status"] == "not-run"
    assert report["threshold"]["status"] == "not-calibrated"
    assert report["threshold"]["applied"] is False
    assert report["threshold"]["identityBaselineTemplateCount"] == 6
    assert "OOXML_REFERENCE_FIDELITY_THRESHOLD_UNCALIBRATED" in report["warningCodes"]
