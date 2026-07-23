from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections.abc import Callable, Mapping, Sequence
from io import BytesIO
from pathlib import Path
from statistics import fmean
from typing import Annotated, Any, Literal

from PIL import Image, ImageChops
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from pydantic.alias_generators import to_camel

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = SERVICE_ROOT.parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.ai.ooxml_reference_templates.annotation import (  # noqa: E402
    AnnotationValidationError,
    validate_source_slide_annotations,
)
from app.ai.ooxml_reference_templates.clone import (  # noqa: E402
    clone_source_slides,
)
from app.ai.ooxml_reference_templates.fidelity import (  # noqa: E402
    EXPECTED_TEMPLATE_IDS,
    _locked_snapshot_drift,
)
from app.ai.ooxml_reference_templates.font_aliases import (  # noqa: E402
    approved_font_alias_policy,
)
from app.ai.ooxml_reference_templates.package import (  # noqa: E402
    validate_cloned_package,
)
from app.ai.ooxml_reference_templates.private_generation_runtime import (  # noqa: E402
    _locked_snapshot,
)
from app.ai.pptx_quality import image_ssim  # noqa: E402
from scripts.run_ooxml_reference_checkpoint_c import (  # noqa: E402
    LibreOfficeRenderResult,
    render_with_libreoffice,
)
from scripts.run_ooxml_reference_fidelity_artifacts import (  # noqa: E402
    FidelityArtifactRunnerError,
    _font_manifest,
    _render_montage,
)


TemplateId = Annotated[
    str,
    Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=1),
]
RenderDeck = Callable[[bytes, str], LibreOfficeRenderResult]


class IdentityCalibrationRunnerError(ValueError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class _StrictModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        str_strip_whitespace=True,
    )


class IdentityCalibrationFixture(_StrictModel):
    template_id: TemplateId
    template_version: Literal[1]
    source_path: Path
    manifest_path: Path


class IdentityCalibrationPlan(_StrictModel):
    schema_version: Literal[1]
    templates: list[IdentityCalibrationFixture] = Field(min_length=7, max_length=7)

    @model_validator(mode="after")
    def validate_exact_catalog(self) -> IdentityCalibrationPlan:
        identities = [
            (template.template_id, template.template_version)
            for template in self.templates
        ]
        if len(identities) != len(set(identities)):
            raise ValueError("template identities must be unique")
        if {template_id for template_id, _ in identities} != EXPECTED_TEMPLATE_IDS:
            raise ValueError("identity plan must contain the exact seven templates")
        return self


def run_identity_calibration(
    plan_path: Path,
    output_directory: Path,
    *,
    render_deck: RenderDeck = render_with_libreoffice,
) -> dict[str, Any]:
    _require_outside_repository(plan_path, "IDENTITY_CALIBRATION_PLAN_INVALID")
    _require_outside_repository(
        output_directory,
        "IDENTITY_CALIBRATION_OUTPUT_INVALID",
    )
    _require_fresh_output_directory(output_directory)
    plan = _load_plan(plan_path)
    output_directory.mkdir(parents=True, exist_ok=True)
    reports: list[dict[str, Any]] = []
    baselines: list[dict[str, Any]] = []
    issue_codes: set[str] = set()
    for fixture in sorted(plan.templates, key=lambda item: item.template_id):
        try:
            report, source_pngs, clone_pngs, diff_pngs, package_manifest, font_manifest = (
                _evaluate_fixture(fixture, render_deck)
            )
            report_path = _write_fixture(
                output_directory,
                fixture,
                report,
                source_pngs,
                clone_pngs,
                diff_pngs,
                package_manifest,
                font_manifest,
            )
            baselines.append(
                _candidate_baseline(
                    report,
                    package_manifest,
                    font_manifest,
                    _sha256(report_path.read_bytes()),
                )
            )
        except IdentityCalibrationRunnerError as error:
            report = _failed_report(fixture, error.code)
            _write_failed_report(output_directory, fixture, report)
        reports.append(report)
        issue_codes.update(str(code) for code in report["issueCodes"])

    generated = len(baselines) == len(EXPECTED_TEMPLATE_IDS)
    candidate: dict[str, Any] | None = None
    if generated:
        candidate = _calibration_candidate(baselines)
        _write_json(output_directory / "calibration-candidate.json", candidate)
        issue_codes.update(str(code) for code in candidate["issueCodes"])
    summary = {
        "schemaVersion": 1,
        "status": "generated" if generated else "failed",
        "approvalStatus": "pending",
        "runtimeEligible": False,
        "templateCount": len(reports),
        "generatedTemplateCount": len(baselines),
        "slideCount": sum(int(report["slideCount"]) for report in reports),
        "issueCodes": sorted(issue_codes),
        "candidateSha256": (
            _sha256((output_directory / "calibration-candidate.json").read_bytes())
            if candidate is not None
            else None
        ),
        "templates": [
            {
                "templateId": report["templateId"],
                "templateVersion": report["templateVersion"],
                "status": report["status"],
                "approvalStatus": report["approvalStatus"],
                "slideCount": report["slideCount"],
                "issueCodes": report["issueCodes"],
            }
            for report in reports
        ],
    }
    _write_json(output_directory / "summary.json", summary)
    _write_checksums(output_directory)
    _restrict_permissions(output_directory)
    return summary


def _evaluate_fixture(
    fixture: IdentityCalibrationFixture,
    render_deck: RenderDeck,
) -> tuple[
    dict[str, Any],
    tuple[bytes, ...],
    tuple[bytes, ...],
    tuple[bytes, ...],
    dict[str, Any],
    dict[str, Any],
]:
    for path in (fixture.source_path, fixture.manifest_path):
        _require_outside_repository(path, "IDENTITY_CALIBRATION_INPUT_INVALID")
    manifest_value = _load_json(fixture.manifest_path)
    try:
        manifest = validate_source_slide_annotations(
            fixture.source_path,
            manifest_value,
        )
    except (OSError, AnnotationValidationError, ValidationError):
        raise IdentityCalibrationRunnerError(
            "SOURCE_MANIFEST_VALIDATION_FAILED"
        ) from None
    source_package = _read_bytes(fixture.source_path)
    if (
        manifest.template_id != fixture.template_id
        or manifest.version != fixture.template_version
        or manifest.source_sha256 != _sha256(source_package)
        or manifest.provenance.authorization_status != "approved"
    ):
        raise IdentityCalibrationRunnerError(
            "SOURCE_MANIFEST_IDENTITY_MISMATCH"
        )
    source_slides = list(manifest.source_slides)
    if not source_slides:
        raise IdentityCalibrationRunnerError("SOURCE_SLIDE_SEQUENCE_INVALID")
    try:
        clone = clone_source_slides(
            source_package,
            source_slide_parts=[
                slide.source_slide_part for slide in source_slides
            ],
        )
    except Exception:
        raise IdentityCalibrationRunnerError("SOURCE_CLONE_FAILED") from None
    source_warnings = validate_cloned_package(source_package)
    clone_warnings = validate_cloned_package(clone.package_bytes)
    if source_warnings or clone_warnings:
        raise IdentityCalibrationRunnerError(
            "OOXML_REFERENCE_PACKAGE_VALIDATION_FAILED"
        )
    source_render = render_deck(source_package, manifest.canvas.aspect_ratio)
    clone_render = render_deck(clone.package_bytes, manifest.canvas.aspect_ratio)
    expected_count = len(source_slides)
    if (
        source_render.status != "passed"
        or clone_render.status != "passed"
        or len(source_render.pngs) != expected_count
        or len(clone_render.pngs) != expected_count
    ):
        raise IdentityCalibrationRunnerError(
            "IDENTITY_CALIBRATION_RENDER_FAILED"
        )
    if not source_render.version or source_render.version != clone_render.version:
        raise IdentityCalibrationRunnerError(
            "IDENTITY_CALIBRATION_RENDERER_VERSION_MISMATCH"
        )

    slide_reports: list[dict[str, Any]] = []
    diff_pngs: list[bytes] = []
    structural_issue_codes: set[str] = set()
    for order, (slide, source_png, clone_png) in enumerate(
        zip(
            source_slides,
            source_render.pngs,
            clone_render.pngs,
            strict=True,
        ),
        start=1,
    ):
        source_snapshot = _locked_snapshot(
            source_package,
            slide.source_slide_part,
            set(),
        )
        clone_snapshot = _locked_snapshot(
            clone.package_bytes,
            f"ppt/slides/slide{order}.xml",
            set(),
        )
        geometry_drift, style_drift, relationship_drift = _locked_snapshot_drift(
            source_snapshot,
            clone_snapshot,
        )
        if geometry_drift:
            structural_issue_codes.add(
                "OOXML_REFERENCE_FIDELITY_LOCKED_GEOMETRY_DRIFT"
            )
        if style_drift:
            structural_issue_codes.add(
                "OOXML_REFERENCE_FIDELITY_LOCKED_STYLE_DRIFT"
            )
        if relationship_drift:
            structural_issue_codes.add(
                "OOXML_REFERENCE_FIDELITY_LOCKED_RELATIONSHIP_DRIFT"
            )
        diff_png, changed_pixel_count, max_channel_delta = _identity_diff(
            source_png,
            clone_png,
        )
        score = image_ssim(source_png, clone_png)
        diff_pngs.append(diff_png)
        slide_reports.append(
            {
                "sourceSlideId": slide.source_slide_id,
                "order": order,
                "sourcePngSha256": _sha256(source_png),
                "identityClonePngSha256": _sha256(clone_png),
                "diffPngSha256": _sha256(diff_png),
                "wholeImageSsim": score,
                "lockedRegionSsim": score,
                "changedPixelCount": changed_pixel_count,
                "maxChannelDelta": max_channel_delta,
                "lockedGeometryDriftCount": geometry_drift,
                "lockedStyleDriftCount": style_drift,
                "lockedRelationshipDriftCount": relationship_drift,
            }
        )
    if structural_issue_codes:
        raise IdentityCalibrationRunnerError(sorted(structural_issue_codes)[0])

    scores = [float(slide["lockedRegionSsim"]) for slide in slide_reports]
    changed_pixels = sum(
        int(slide["changedPixelCount"]) for slide in slide_reports
    )
    max_channel_delta = max(
        int(slide["maxChannelDelta"]) for slide in slide_reports
    )
    font_manifest = _identity_font_manifest(
        source_package,
        clone.package_bytes,
        fixture.template_id,
        fixture.template_version,
        source_render.version,
    )
    issue_codes = set(str(code) for code in font_manifest["issueCodes"])
    issue_codes.add("HUMAN_FIDELITY_REVIEW_PENDING")
    if changed_pixels:
        issue_codes.add("IDENTITY_PIXEL_DIFF_REVIEW_PENDING")
    package_manifest = {
        "schemaVersion": 1,
        "templateId": fixture.template_id,
        "templateVersion": fixture.template_version,
        "sourcePackageSha256": _sha256(source_package),
        "identityClonePackageSha256": _sha256(clone.package_bytes),
        "templateManifestSha256": _canonical_json_sha256(manifest_value),
        "sourceSlideCount": expected_count,
        "identityCloneSlideCount": expected_count,
        "sourcePackageWarningCodes": source_warnings,
        "identityClonePackageWarningCodes": clone_warnings,
    }
    report = {
        "schemaVersion": 1,
        "templateId": fixture.template_id,
        "templateVersion": fixture.template_version,
        "mode": "identity-control",
        "status": "generated",
        "approvalStatus": "pending",
        "calibrationStatus": "not-calibrated",
        "applied": False,
        "renderer": "libreoffice-pdf-pymupdf",
        "rendererVersion": source_render.version,
        "slideCount": expected_count,
        "structuralStatus": "passed",
        "packageManifestSha256": _canonical_json_sha256(package_manifest),
        "fontManifestSha256": _canonical_json_sha256(font_manifest),
        "fontStatus": font_manifest["status"],
        "issueCodes": sorted(issue_codes),
        "deckMetrics": {
            "minimumLockedRegionSsim": min(scores),
            "averageLockedRegionSsim": round(fmean(scores), 6),
            "maximumLockedRegionSsim": max(scores),
            "totalChangedPixelCount": changed_pixels,
            "maxChannelDelta": max_channel_delta,
            "outlierSourceSlideIds": [
                str(slide["sourceSlideId"])
                for slide in slide_reports
                if float(slide["lockedRegionSsim"]) < 1.0
            ],
        },
        "slides": slide_reports,
    }
    return (
        report,
        tuple(source_render.pngs),
        tuple(clone_render.pngs),
        tuple(diff_pngs),
        package_manifest,
        font_manifest,
    )


def _identity_font_manifest(
    source_package: bytes,
    identity_package: bytes,
    template_id: str,
    template_version: int,
    renderer_version: str | None,
) -> dict[str, Any]:
    manifest = _font_manifest(
        source_package,
        identity_package,
        template_id,
        template_version,
        renderer_version,
    )
    for font in manifest["fonts"]:
        font["roles"] = sorted(
            "source" if role == "source-clone" else "identity-clone"
            for role in font["roles"]
        )
    return manifest


def _identity_diff(
    source_png: bytes,
    clone_png: bytes,
) -> tuple[bytes, int, int]:
    try:
        with Image.open(BytesIO(source_png)) as source_image:
            source = source_image.convert("RGB")
        with Image.open(BytesIO(clone_png)) as clone_image:
            clone = clone_image.convert("RGB")
    except OSError:
        raise IdentityCalibrationRunnerError(
            "IDENTITY_CALIBRATION_IMAGE_INVALID"
        ) from None
    if source.size != clone.size:
        raise IdentityCalibrationRunnerError(
            "IDENTITY_CALIBRATION_IMAGE_SIZE_MISMATCH"
        )
    difference = ImageChops.difference(source, clone)
    red, green, blue = difference.split()
    maximum = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    histogram = maximum.histogram()
    changed_pixel_count = sum(histogram[1:])
    max_channel_delta = next(
        (index for index in range(255, 0, -1) if histogram[index]),
        0,
    )
    return _png_bytes(difference), changed_pixel_count, max_channel_delta


def _write_fixture(
    output_directory: Path,
    fixture: IdentityCalibrationFixture,
    report: dict[str, Any],
    source_pngs: Sequence[bytes],
    clone_pngs: Sequence[bytes],
    diff_pngs: Sequence[bytes],
    package_manifest: Mapping[str, Any],
    font_manifest: Mapping[str, Any],
) -> Path:
    root = output_directory / fixture.template_id / f"v{fixture.template_version}"
    for directory_name, prefix, contents in (
        ("baseline", "source-slide", source_pngs),
        ("identity-clone", "identity-clone-slide", clone_pngs),
        ("diff", "identity-diff-slide", diff_pngs),
    ):
        directory = root / directory_name
        directory.mkdir(parents=True, exist_ok=True)
        for order, content in enumerate(contents, start=1):
            (directory / f"{prefix}-{order:03d}.png").write_bytes(content)
    montage_directory = root / "montage"
    montage_directory.mkdir(parents=True, exist_ok=True)
    montage_hashes: dict[str, str] = {}
    for name, contents in (
        ("source", source_pngs),
        ("identity-clone", clone_pngs),
        ("identity-diff", diff_pngs),
    ):
        montage = _render_montage(contents)
        (montage_directory / f"{name}.png").write_bytes(montage)
        montage_hashes[f"{_camel(name)}MontageSha256"] = _sha256(montage)
    report["montages"] = montage_hashes
    manifests = root / "manifests"
    manifests.mkdir(parents=True, exist_ok=True)
    _write_json(manifests / "package.json", package_manifest)
    _write_json(manifests / "font.json", font_manifest)
    report_path = manifests / "identity-control-report.json"
    _write_json(report_path, report)
    return report_path


def _write_failed_report(
    output_directory: Path,
    fixture: IdentityCalibrationFixture,
    report: Mapping[str, Any],
) -> None:
    path = (
        output_directory
        / fixture.template_id
        / f"v{fixture.template_version}"
        / "manifests"
        / "identity-control-report.json"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    _write_json(path, report)


def _candidate_baseline(
    report: Mapping[str, Any],
    package_manifest: Mapping[str, Any],
    font_manifest: Mapping[str, Any],
    report_sha256: str,
) -> dict[str, Any]:
    metrics = MappingProxy(report["deckMetrics"])
    exact_count = sum(
        font.get("status") == "exact" for font in font_manifest["fonts"]
    )
    substituted_count = sum(
        font.get("status") == "substituted" for font in font_manifest["fonts"]
    )
    approved_alias_count = sum(
        font.get("status") == "approved-alias" for font in font_manifest["fonts"]
    )
    unavailable_count = sum(
        font.get("status") == "unavailable" for font in font_manifest["fonts"]
    )
    return {
        "templateId": report["templateId"],
        "version": report["templateVersion"],
        "renderer": report["renderer"],
        "rendererVersion": report["rendererVersion"],
        "reportSha256": report_sha256,
        "sourcePackageSha256": package_manifest["sourcePackageSha256"],
        "identityClonePackageSha256": package_manifest[
            "identityClonePackageSha256"
        ],
        "templateManifestSha256": package_manifest["templateManifestSha256"],
        "fontManifestSha256": report["fontManifestSha256"],
        "fontStatus": report["fontStatus"],
        "exactFontCount": exact_count,
        "substitutedFontCount": substituted_count,
        "approvedAliasFontCount": approved_alias_count,
        "unavailableFontCount": unavailable_count,
        "slideCount": report["slideCount"],
        "minimumLockedRegionSsim": metrics["minimumLockedRegionSsim"],
        "averageLockedRegionSsim": metrics["averageLockedRegionSsim"],
        "maximumLockedRegionSsim": metrics["maximumLockedRegionSsim"],
        "totalChangedPixelCount": metrics["totalChangedPixelCount"],
        "maxChannelDelta": metrics["maxChannelDelta"],
        "outlierSourceSlideIds": metrics["outlierSourceSlideIds"],
        "structuralStatus": report["structuralStatus"],
    }


class MappingProxy:
    def __init__(self, value: object) -> None:
        if not isinstance(value, Mapping):
            raise IdentityCalibrationRunnerError(
                "IDENTITY_CALIBRATION_REPORT_INVALID"
            )
        self._value = value

    def __getitem__(self, key: str) -> object:
        return self._value[key]


def _calibration_candidate(
    baselines: list[dict[str, Any]],
) -> dict[str, Any]:
    renderer_identities = {
        (baseline["renderer"], baseline["rendererVersion"])
        for baseline in baselines
    }
    if len(renderer_identities) != 1:
        raise IdentityCalibrationRunnerError(
            "IDENTITY_CALIBRATION_RENDERER_VERSION_MISMATCH"
        )
    measured_minimum = min(
        float(baseline["minimumLockedRegionSsim"])
        for baseline in baselines
    )
    approved_fonts = all(
        baseline["fontStatus"] == "passed" for baseline in baselines
    )
    issue_codes = {"HUMAN_FIDELITY_REVIEW_PENDING"}
    if not approved_fonts:
        issue_codes.add("FONT_AVAILABILITY_VALIDATION_PENDING")
    if any(int(baseline["totalChangedPixelCount"]) for baseline in baselines):
        issue_codes.add("IDENTITY_PIXEL_DIFF_REVIEW_PENDING")
    renderer, renderer_version = next(iter(renderer_identities))
    return {
        "schemaVersion": 1,
        "status": "pending-approval",
        "applied": False,
        "approvalStatus": "pending",
        "runtimeEligible": False,
        "renderer": renderer,
        "rendererVersion": renderer_version,
        "measuredMinimumLockedRegionSsim": measured_minimum,
        "proposedLockedRegionSsimThreshold": (
            measured_minimum if approved_fonts else None
        ),
        "geometryEdgeTolerancePx": 0,
        "rationale": (
            "Machine-derived from the minimum of seven no-op identity baselines; "
            "exact-font and human approval are still required."
        ),
        "rationaleApprovalStatus": "pending",
        "fontAliasPolicy": approved_font_alias_policy().model_dump(
            by_alias=True,
            mode="json",
        ),
        "issueCodes": sorted(issue_codes),
        "identityBaselines": baselines,
    }


def _failed_report(
    fixture: IdentityCalibrationFixture,
    issue_code: str,
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "templateId": fixture.template_id,
        "templateVersion": fixture.template_version,
        "mode": "identity-control",
        "status": "failed",
        "approvalStatus": "pending",
        "calibrationStatus": "not-calibrated",
        "applied": False,
        "slideCount": 0,
        "structuralStatus": "failed",
        "issueCodes": [issue_code],
        "slides": [],
    }


def _load_plan(path: Path) -> IdentityCalibrationPlan:
    try:
        return IdentityCalibrationPlan.model_validate(_load_json(path))
    except ValidationError:
        raise IdentityCalibrationRunnerError(
            "IDENTITY_CALIBRATION_PLAN_INVALID"
        ) from None


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_bytes())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        raise IdentityCalibrationRunnerError(
            "IDENTITY_CALIBRATION_INPUT_INVALID"
        ) from None
    if not isinstance(value, dict):
        raise IdentityCalibrationRunnerError(
            "IDENTITY_CALIBRATION_INPUT_INVALID"
        )
    return value


def _read_bytes(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except OSError:
        raise IdentityCalibrationRunnerError(
            "IDENTITY_CALIBRATION_INPUT_INVALID"
        ) from None


def _require_outside_repository(path: Path, code: str) -> None:
    try:
        path.resolve().relative_to(REPOSITORY_ROOT.resolve())
    except ValueError:
        return
    raise IdentityCalibrationRunnerError(code)


def _require_fresh_output_directory(path: Path) -> None:
    if path.exists() and (not path.is_dir() or any(path.iterdir())):
        raise IdentityCalibrationRunnerError(
            "IDENTITY_CALIBRATION_OUTPUT_NOT_EMPTY"
        )


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _write_checksums(output_directory: Path) -> None:
    checksums = {
        path.relative_to(output_directory).as_posix(): _sha256(path.read_bytes())
        for path in sorted(output_directory.rglob("*"))
        if path.is_file() and path.name != "checksums.json"
    }
    _write_json(
        output_directory / "checksums.json",
        {"schemaVersion": 1, "files": checksums},
    )


def _restrict_permissions(output_directory: Path) -> None:
    for path in output_directory.rglob("*"):
        os.chmod(path, 0o700 if path.is_dir() else 0o600)
    os.chmod(output_directory, 0o700)


def _canonical_json_sha256(value: Mapping[str, Any]) -> str:
    return _sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    )


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _png_bytes(image: Image.Image) -> bytes:
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _camel(value: str) -> str:
    first, *rest = value.split("-")
    return "".join([first, *[part[:1].upper() + part[1:] for part in rest]])


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Build a fail-closed OOXML reference identity calibration candidate."
        )
    )
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--output-directory", type=Path, required=True)
    return parser


def main() -> None:
    args = _parser().parse_args()
    try:
        summary = run_identity_calibration(
            args.plan,
            args.output_directory,
        )
    except (IdentityCalibrationRunnerError, FidelityArtifactRunnerError) as error:
        code = getattr(error, "code", "IDENTITY_CALIBRATION_FAILED")
        print(json.dumps({"status": "failed", "issueCodes": [code]}))
        raise SystemExit(1) from None
    print(json.dumps(summary, ensure_ascii=True, sort_keys=True))
    if summary["status"] != "generated":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
