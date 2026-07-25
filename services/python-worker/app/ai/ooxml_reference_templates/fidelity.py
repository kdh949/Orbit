from __future__ import annotations

import hashlib
import json
from io import BytesIO
from statistics import fmean
from typing import Any, Literal, Mapping, cast

from PIL import Image
from pydantic import ValidationError

from app.ai.ooxml_reference_templates.font_aliases import (
    ApprovedFontAliasPolicy,
    canonical_font_alias_policy_sha256,
)
from app.ai.pptx_quality import image_ssim


EXPECTED_TEMPLATE_IDS = {
    "simple-light",
    "simple-dark",
    "operating-review",
    "business-review",
    "project-kickoff",
    "team-alignment",
    "market-trends-report",
}
Mode = Literal["identity-control", "generated-comparison"]


class FidelityEvaluationError(ValueError):
    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


def evaluate_ooxml_reference_fidelity(
    *,
    template_id: str,
    template_version: int,
    mode: str,
    slides: list[Mapping[str, Any]],
    package_warnings: list[str],
    environment: Mapping[str, Any],
    calibration: Mapping[str, Any],
) -> dict[str, Any]:
    if mode not in {"identity-control", "generated-comparison"}:
        raise FidelityEvaluationError(
            "OOXML_REFERENCE_FIDELITY_MODE_INVALID", "evaluation mode is invalid"
        )
    selected_mode = cast(Mode, mode)
    warning_codes: list[str] = []
    environment_complete = _environment_complete(environment)
    threshold = _threshold_report(calibration, environment)
    if not environment_complete:
        warning_codes.append("OOXML_REFERENCE_FIDELITY_ENVIRONMENT_INCOMPLETE")
    if threshold["status"] != "calibrated":
        warning_codes.append("OOXML_REFERENCE_FIDELITY_THRESHOLD_UNCALIBRATED")
    if environment.get("localDemo") is True:
        warning_codes.append("OOXML_REFERENCE_LOCAL_DEMO_UNCALIBRATED")

    if not environment_complete or not threshold["applied"]:
        return _not_run_report(
            selected_mode,
            len(slides),
            package_warnings,
            warning_codes,
            threshold,
            template_id,
            template_version,
            environment,
        )

    structural_issues: list[str] = []
    if package_warnings:
        structural_issues.append("OOXML_REFERENCE_PACKAGE_VALIDATION_FAILED")
    slide_reports: list[dict[str, Any]] = []
    geometry_drift_count = 0
    style_drift_count = 0
    relationship_drift_count = 0
    locked_region_drift_count = 0
    locked_scores: list[float] = []
    whole_scores: list[float] = []
    for slide in slides:
        report = _evaluate_slide(
            slide,
            threshold=float(threshold["lockedRegionSsimThreshold"]),
            mode=selected_mode,
        )
        slide_reports.append(report)
        whole_scores.append(float(report["wholeImageSsim"]))
        locked_scores.append(float(report["lockedRegionSsim"]))
        geometry_drift_count += int(report["lockedGeometryDriftCount"])
        style_drift_count += int(report["lockedStyleDriftCount"])
        relationship_drift_count += int(report["lockedRelationshipDriftCount"])
        locked_region_drift_count += int(report["lockedRegionDriftCount"])
    if geometry_drift_count:
        structural_issues.append(
            "OOXML_REFERENCE_FIDELITY_LOCKED_GEOMETRY_DRIFT"
        )
    if style_drift_count:
        structural_issues.append("OOXML_REFERENCE_FIDELITY_LOCKED_STYLE_DRIFT")
    if relationship_drift_count:
        structural_issues.append(
            "OOXML_REFERENCE_FIDELITY_LOCKED_RELATIONSHIP_DRIFT"
        )
    if any(score < float(threshold["lockedRegionSsimThreshold"]) for score in locked_scores):
        structural_issues.append("OOXML_REFERENCE_FIDELITY_LOCKED_PIXEL_DRIFT")

    structural_issues = sorted(set(structural_issues))
    passed = not structural_issues
    status = "passed" if passed else "failed"
    identity_status = status if selected_mode == "identity-control" else "not-run"
    generated_status = (
        status if selected_mode == "generated-comparison" else "not-run"
    )
    return {
        "schemaVersion": 1,
        "templateId": template_id,
        "templateVersion": template_version,
        "mode": selected_mode,
        "status": status,
        "structuralGate": {
            "passed": passed,
            "issueCodes": structural_issues,
        },
        "identityControl": {
            "status": identity_status,
            "evaluatedSlideCount": len(slide_reports)
            if selected_mode == "identity-control"
            else 0,
            "packageWarningCount": len(package_warnings),
            "lockedGeometryDriftCount": geometry_drift_count,
        },
        "generatedComparison": {
            "status": generated_status,
            "evaluatedSlideCount": len(slide_reports)
            if selected_mode == "generated-comparison"
            else 0,
            "lockedRegionDriftCount": locked_region_drift_count,
            "slotOverflowCount": 0,
        },
        "warningCodes": sorted(set(warning_codes)),
        "packageWarningCodes": sorted(set(package_warnings)),
        "threshold": threshold,
        "environment": _bounded_environment(environment),
        "slides": slide_reports,
        "deckMetrics": {
            "evaluatedSlideCount": len(slide_reports),
            "missingSlideCount": 0,
            "minimumLockedRegionSsim": min(locked_scores),
            "averageLockedRegionSsim": round(fmean(locked_scores), 6),
            "averageWholeImageSsim": round(fmean(whole_scores), 6),
        },
    }


def _evaluate_slide(
    slide: Mapping[str, Any], *, threshold: float, mode: Mode
) -> dict[str, Any]:
    try:
        source_png = bytes(slide["sourcePng"])
        generated_png = bytes(slide["generatedPng"])
        mask_png = bytes(slide["intendedSlotMaskPng"])
        source_locked = dict(slide["sourceLockedSnapshot"])
        generated_locked = dict(slide["generatedLockedSnapshot"])
    except (KeyError, TypeError, ValueError) as error:
        raise FidelityEvaluationError(
            "OOXML_REFERENCE_FIDELITY_SLIDE_INVALID",
            "slide comparison artifact is incomplete",
        ) from error
    source_image, generated_image, mask_image = _comparison_images(
        source_png, generated_png, mask_png
    )
    whole_ssim = image_ssim(
        _png_bytes(source_image), _png_bytes(generated_image)
    )
    locked_generated = generated_image.copy()
    locked_generated.paste(source_image, mask=mask_image)
    locked_ssim = image_ssim(
        _png_bytes(source_image), _png_bytes(locked_generated)
    )
    mask_pixels = sum(mask_image.histogram()[1:])
    geometry_drift, style_drift, relationship_drift = _locked_snapshot_drift(
        source_locked, generated_locked
    )
    pixel_drift = int(locked_ssim < threshold)
    return {
        "sourceSlideId": str(slide.get("sourceSlideId", "")),
        "mode": mode,
        "sourceArtifactSha256": hashlib.sha256(source_png).hexdigest(),
        "generatedArtifactSha256": hashlib.sha256(generated_png).hexdigest(),
        "intendedSlotMaskSha256": hashlib.sha256(mask_png).hexdigest(),
        "intendedSlotMaskPixelCount": mask_pixels,
        "wholeImageSsim": whole_ssim,
        "lockedRegionSsim": locked_ssim,
        "lockedGeometryDriftCount": geometry_drift,
        "lockedStyleDriftCount": style_drift,
        "lockedRelationshipDriftCount": relationship_drift,
        "lockedRegionDriftCount": (
            geometry_drift + style_drift + relationship_drift + pixel_drift
        ),
    }


def _comparison_images(
    source_png: bytes, generated_png: bytes, mask_png: bytes
) -> tuple[Image.Image, Image.Image, Image.Image]:
    try:
        with Image.open(BytesIO(source_png)) as image:
            source = image.convert("RGB")
        with Image.open(BytesIO(generated_png)) as image:
            generated = image.convert("RGB")
        with Image.open(BytesIO(mask_png)) as image:
            mask = image.convert("L")
    except (OSError, ValueError) as error:
        raise FidelityEvaluationError(
            "OOXML_REFERENCE_FIDELITY_ARTIFACT_INVALID",
            "render or slot mask PNG cannot be decoded",
        ) from error
    if source.size != generated.size or source.size != mask.size:
        raise FidelityEvaluationError(
            "OOXML_REFERENCE_FIDELITY_ARTIFACT_SIZE_MISMATCH",
            "source, generated, and mask dimensions must match",
        )
    return source, generated, mask


def _locked_snapshot_drift(
    source_snapshot: Mapping[str, Any], generated_snapshot: Mapping[str, Any]
) -> tuple[int, int, int]:
    source_shapes = _shape_map(source_snapshot)
    generated_shapes = _shape_map(generated_snapshot)
    identities = set(source_shapes) | set(generated_shapes)
    geometry = 0
    style = 0
    for shape_id in identities:
        source = source_shapes.get(shape_id)
        generated = generated_shapes.get(shape_id)
        if source is None or generated is None:
            geometry += 1
            style += 1
            continue
        geometry += int(source.get("geometry") != generated.get("geometry"))
        style += int(source.get("style") != generated.get("style"))
    relationship = int(
        source_snapshot.get("relationships")
        != generated_snapshot.get("relationships")
    )
    return geometry, style, relationship


def _shape_map(snapshot: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    shapes = snapshot.get("shapes")
    if not isinstance(shapes, list):
        raise FidelityEvaluationError(
            "OOXML_REFERENCE_FIDELITY_LOCKED_SNAPSHOT_INVALID",
            "locked snapshot must contain shapes",
        )
    result: dict[str, Mapping[str, Any]] = {}
    for shape in shapes:
        if not isinstance(shape, Mapping) or not isinstance(shape.get("shapeId"), str):
            raise FidelityEvaluationError(
                "OOXML_REFERENCE_FIDELITY_LOCKED_SNAPSHOT_INVALID",
                "locked shape identity is invalid",
            )
        shape_id = str(shape["shapeId"])
        if shape_id in result:
            raise FidelityEvaluationError(
                "OOXML_REFERENCE_FIDELITY_LOCKED_SNAPSHOT_INVALID",
                "locked shape identity is duplicated",
            )
        result[shape_id] = shape
    return result


def _environment_complete(environment: Mapping[str, Any]) -> bool:
    required_strings = (
        "renderer",
        "rendererVersion",
        "sourceSha256",
        "templateManifestSha256",
        "artifactSha256",
    )
    if any(not isinstance(environment.get(key), str) or not environment[key] for key in required_strings):
        return False
    fonts = environment.get("fontFiles")
    return bool(
        isinstance(fonts, list)
        and fonts
        and all(
            isinstance(font, Mapping)
            and isinstance(font.get("family"), str)
            and isinstance(font.get("role"), str)
            and isinstance(font.get("sha256"), str)
            and len(str(font["sha256"])) == 64
            for font in fonts
        )
    )


def _threshold_report(
    calibration: Mapping[str, Any], environment: Mapping[str, Any]
) -> dict[str, Any]:
    try:
        alias_policy = ApprovedFontAliasPolicy.model_validate(
            calibration.get("fontAliasPolicy")
        )
    except ValidationError:
        alias_policy = None
    baselines = calibration.get("identityBaselines")
    valid_baselines = [
        baseline
        for baseline in baselines
        if isinstance(baseline, Mapping)
        and baseline.get("version") == 1
        and baseline.get("renderer") == environment.get("renderer")
        and baseline.get("rendererVersion") == environment.get("rendererVersion")
        and isinstance(baseline.get("reportSha256"), str)
        and len(str(baseline["reportSha256"])) == 64
    ] if isinstance(baselines, list) else []
    template_ids = {
        str(baseline.get("templateId")) for baseline in valid_baselines
    }
    calibrated = (
        calibration.get("status") == "calibrated"
        and template_ids == EXPECTED_TEMPLATE_IDS
        and len(valid_baselines) == len(EXPECTED_TEMPLATE_IDS)
        and isinstance(calibration.get("lockedRegionSsimThreshold"), (int, float))
        and isinstance(calibration.get("geometryEdgeTolerancePx"), int)
        and isinstance(calibration.get("rationale"), str)
        and bool(calibration.get("rationale"))
        and alias_policy is not None
    )
    return {
        "status": "calibrated" if calibrated else "not-calibrated",
        "applied": calibrated,
        "identityBaselineTemplateCount": len(template_ids),
        "lockedRegionSsimThreshold": calibration.get(
            "lockedRegionSsimThreshold"
        ) if calibrated else None,
        "geometryEdgeTolerancePx": calibration.get(
            "geometryEdgeTolerancePx"
        ) if calibrated else None,
        "rationale": calibration.get("rationale") if calibrated else None,
        "fontAliasPolicySha256": (
            canonical_font_alias_policy_sha256(alias_policy)
            if calibrated and alias_policy is not None
            else None
        ),
    }


def _not_run_report(
    mode: Mode,
    slide_count: int,
    package_warnings: list[str],
    warning_codes: list[str],
    threshold: Mapping[str, Any],
    template_id: str,
    template_version: int,
    environment: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "templateId": template_id,
        "templateVersion": template_version,
        "mode": mode,
        "status": "not-run",
        "structuralGate": {
            "passed": False,
            "issueCodes": [],
        },
        "identityControl": {
            "status": "not-run",
            "evaluatedSlideCount": 0,
            "packageWarningCount": len(package_warnings),
            "lockedGeometryDriftCount": 0,
        },
        "generatedComparison": {
            "status": "not-run",
            "evaluatedSlideCount": 0,
            "lockedRegionDriftCount": 0,
            "slotOverflowCount": 0,
        },
        "warningCodes": sorted(set(warning_codes)),
        "packageWarningCodes": sorted(set(package_warnings)),
        "threshold": dict(threshold),
        "environment": _bounded_environment(environment),
        "slides": [],
        "deckMetrics": {
            "evaluatedSlideCount": 0,
            "missingSlideCount": slide_count,
            "minimumLockedRegionSsim": None,
            "averageLockedRegionSsim": None,
            "averageWholeImageSsim": None,
        },
    }


def _bounded_environment(environment: Mapping[str, Any]) -> dict[str, Any]:
    return {
        key: environment[key]
        for key in (
            "renderer",
            "rendererVersion",
            "fontFiles",
            "sourceSha256",
            "templateManifestSha256",
            "artifactSha256",
        )
        if key in environment
    }


def _png_bytes(image: Image.Image) -> bytes:
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def canonical_fidelity_report_sha256(report: Mapping[str, Any]) -> str:
    content = json.dumps(
        report, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(content).hexdigest()
