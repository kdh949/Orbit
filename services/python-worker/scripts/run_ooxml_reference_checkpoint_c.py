from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
import zipfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Annotated, Any, Literal

from PIL import Image
from pptx import Presentation
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
from app.ai.ooxml_reference_templates.fidelity import (  # noqa: E402
    EXPECTED_TEMPLATE_IDS,
)
from app.ai.ooxml_reference_templates.font_aliases import (  # noqa: E402
    reference_fontconfig_subprocess_environment,
)
from app.ai.ooxml_reference_templates.package import (  # noqa: E402
    validate_cloned_package,
)
from app.ai.pptx_ooxml_generation import (  # noqa: E402
    CanvasSpec,
    PptxRenderUnavailableError,
    render_pptx_to_png_assets,
)


Sha256 = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
IssueCode = Annotated[str, Field(pattern=r"^[A-Z][A-Z0-9_]*$")]
TemplateId = Annotated[
    str,
    Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=1),
]
Status = Literal["not-run", "passed", "failed"]


class CheckpointRunnerError(ValueError):
    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


class _StrictModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        str_strip_whitespace=True,
    )


class TemplateFixture(_StrictModel):
    template_id: TemplateId
    template_version: int = Field(gt=0)
    source_path: Path
    manifest_path: Path
    generated_pptx_path: Path
    quality_evidence_path: Path
    power_point_evidence_path: Path | None = None


class FixturePlan(_StrictModel):
    schema_version: Literal[1]
    templates: list[TemplateFixture] = Field(min_length=7, max_length=7)

    @model_validator(mode="after")
    def validate_exact_catalog(self) -> FixturePlan:
        identities = [
            (template.template_id, template.template_version)
            for template in self.templates
        ]
        if len(identities) != len(set(identities)):
            raise ValueError("template identities must be unique")
        if {template_id for template_id, _ in identities} != EXPECTED_TEMPLATE_IDS:
            raise ValueError("fixture plan must contain the exact seven templates")
        return self


class QualityEvidence(_StrictModel):
    schema_version: Literal[1]
    template_id: TemplateId
    template_version: int = Field(gt=0)
    generated_package_sha256: Sha256
    generated_slide_count: int = Field(ge=8, le=10)
    required_unique_source_count: int = Field(gt=0, le=10)
    selected_unique_source_count: int = Field(gt=0, le=10)
    eligible_unique_source_count: int = Field(gt=0, le=500)
    required_unique_layout_count: int = Field(gt=0, le=10)
    selected_unique_layout_count: int = Field(gt=0, le=10)
    eligible_unique_layout_count: int = Field(gt=0, le=500)
    adjacent_repeat_count: int = Field(ge=0, le=10)
    slot_overflow_count: int = Field(ge=0, le=10_000)
    overlap_count: int = Field(ge=0, le=10_000)
    crop_error_count: int = Field(ge=0, le=10_000)
    warning_codes: list[IssueCode] = Field(max_length=500)
    unsupported_object_codes: list[IssueCode] = Field(max_length=500)
    font_substitution_risk_codes: list[IssueCode] = Field(max_length=500)
    supported_fixture_types: list[
        Literal["text", "image", "table", "chart"]
    ] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def validate_sequence_evidence(self) -> QualityEvidence:
        expected_required = min(
            math.ceil(self.generated_slide_count * 0.8),
            self.eligible_unique_source_count,
        )
        if self.required_unique_source_count != expected_required:
            raise ValueError("required unique source count must use the bounded rule")
        if not (
            self.selected_unique_source_count <= self.generated_slide_count
            and self.selected_unique_source_count <= self.eligible_unique_source_count
        ):
            raise ValueError("selected unique source count exceeds its bounds")
        expected_layouts = min(
            math.ceil(self.generated_slide_count * 0.4),
            self.eligible_unique_layout_count,
        )
        if self.required_unique_layout_count != expected_layouts:
            raise ValueError("required unique layout count must use the bounded rule")
        if not (
            self.selected_unique_layout_count <= self.generated_slide_count
            and self.selected_unique_layout_count <= self.eligible_unique_layout_count
        ):
            raise ValueError("selected unique layout count exceeds its bounds")
        if len(self.supported_fixture_types) != len(
            set(self.supported_fixture_types)
        ):
            raise ValueError("supported fixture types must be unique")
        return self


class PowerPointEvidence(_StrictModel):
    schema_version: Literal[1]
    application: Literal["Microsoft PowerPoint"]
    application_version: Annotated[
        str,
        Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$"),
    ]
    template_id: TemplateId
    template_version: int = Field(gt=0)
    generated_package_sha256: Sha256
    evaluated_slide_count: int = Field(ge=8, le=10)
    reopen_status: Literal["passed", "failed"]
    render_status: Literal["passed", "failed"]
    render_artifact_sha256: Sha256
    warning_codes: list[IssueCode] = Field(max_length=500)


@dataclass(frozen=True)
class LibreOfficeRenderResult:
    status: Status
    version: str | None
    pngs: tuple[bytes, ...]
    issue_codes: tuple[str, ...]


RenderDeck = Callable[[bytes, str], LibreOfficeRenderResult]


def render_with_libreoffice(
    package_bytes: bytes,
    aspect_ratio: str,
) -> LibreOfficeRenderResult:
    executable = shutil.which("libreoffice") or shutil.which("soffice")
    if executable is None:
        return LibreOfficeRenderResult(
            status="not-run",
            version=None,
            pngs=(),
            issue_codes=("LIBREOFFICE_UNAVAILABLE",),
        )
    try:
        subprocess_environment = reference_fontconfig_subprocess_environment()
        version_result = subprocess.run(
            [executable, "--version"],
            check=True,
            capture_output=True,
            env=subprocess_environment,
            text=True,
            timeout=30,
        )
        version = _bounded_version(version_result.stdout)
        width, height = (1600, 900) if aspect_ratio == "16:9" else (1200, 900)
        assets = render_pptx_to_png_assets(
            package_bytes,
            CanvasSpec(
                preset="checkpoint-c",
                width=width,
                height=height,
                aspect_ratio=aspect_ratio,
            ),
            subprocess_environment,
        )
        pngs = tuple(
            base64.b64decode(asset.content_base64, validate=True)
            for asset in assets
        )
    except (
        OSError,
        ValueError,
        subprocess.CalledProcessError,
        subprocess.TimeoutExpired,
        PptxRenderUnavailableError,
    ):
        return LibreOfficeRenderResult(
            status="failed",
            version=None,
            pngs=(),
            issue_codes=("LIBREOFFICE_RENDER_FAILED",),
        )
    return LibreOfficeRenderResult(
        status="passed",
        version=version,
        pngs=pngs,
        issue_codes=(),
    )


def run_checkpoint_c(
    plan_path: Path,
    output_directory: Path,
    *,
    render_deck: RenderDeck = render_with_libreoffice,
) -> dict[str, Any]:
    _require_outside_repository(plan_path, "FIXTURE_PLAN_INVALID")
    _require_outside_repository(output_directory, "OUTPUT_DIRECTORY_INVALID")
    plan = _load_model(plan_path, FixturePlan, "FIXTURE_PLAN_INVALID")
    output_directory.mkdir(parents=True, exist_ok=True)

    reports: list[dict[str, Any]] = []
    for fixture in sorted(plan.templates, key=lambda item: item.template_id):
        try:
            report, render_pngs = _evaluate_fixture(fixture, render_deck)
        except CheckpointRunnerError as error:
            report = _failed_report(fixture, error.code)
            render_pngs = ()
        _write_template_artifacts(
            output_directory,
            report,
            render_pngs,
        )
        reports.append(report)

    summary = _build_summary(reports)
    _write_json(output_directory / "summary.json", summary)
    (output_directory / "summary.md").write_text(
        _summary_markdown(summary),
        encoding="utf-8",
    )
    return summary


def _evaluate_fixture(
    fixture: TemplateFixture,
    render_deck: RenderDeck,
) -> tuple[dict[str, Any], tuple[bytes, ...]]:
    for path in (
        fixture.source_path,
        fixture.manifest_path,
        fixture.generated_pptx_path,
        fixture.quality_evidence_path,
    ):
        _require_outside_repository(path, "PRIVATE_INPUT_INVALID")
    if fixture.power_point_evidence_path is not None:
        _require_outside_repository(
            fixture.power_point_evidence_path,
            "POWERPOINT_EVIDENCE_INVALID",
        )

    manifest_value = _load_json(fixture.manifest_path, "MANIFEST_INVALID")
    try:
        manifest = validate_source_slide_annotations(
            fixture.source_path,
            manifest_value,
        )
    except (OSError, AnnotationValidationError, ValidationError):
        raise CheckpointRunnerError(
            "SOURCE_MANIFEST_VALIDATION_FAILED",
            "source and manifest validation failed",
        ) from None
    if (
        manifest.template_id != fixture.template_id
        or manifest.version != fixture.template_version
        or manifest.provenance.authorization_status != "approved"
    ):
        raise CheckpointRunnerError(
            "SOURCE_MANIFEST_IDENTITY_MISMATCH",
            "source manifest identity or authorization mismatched",
        )

    package_bytes = _read_bytes(
        fixture.generated_pptx_path,
        "GENERATED_PACKAGE_READ_FAILED",
    )
    package_sha256 = _sha256(package_bytes)
    package_warnings = validate_cloned_package(package_bytes)
    reopen_status, reopened_slide_count = _python_pptx_reopen(package_bytes)
    if reopen_status != "passed":
        failed_report = _failed_report(fixture, "PYTHON_PPTX_REOPEN_FAILED")
        failed_report.update(
            {
                "generatedPackageSha256": package_sha256,
                "manifestSha256": _canonical_json_sha256(manifest_value),
                "sourceManifest": {"status": "passed"},
                "packageValidation": {
                    "status": "failed",
                    "warningCodes": package_warnings,
                },
                "pythonPptxReopen": {
                    "status": "failed",
                    "slideCount": reopened_slide_count,
                },
                "issueCodes": sorted(
                    {
                        "PYTHON_PPTX_REOPEN_FAILED",
                        *(
                            ["OOXML_REFERENCE_PACKAGE_VALIDATION_FAILED"]
                            if package_warnings
                            else []
                        ),
                    }
                ),
            }
        )
        return failed_report, ()
    quality = _load_model(
        fixture.quality_evidence_path,
        QualityEvidence,
        "QUALITY_EVIDENCE_INVALID",
    )
    if (
        quality.template_id != fixture.template_id
        or quality.template_version != fixture.template_version
        or quality.generated_package_sha256 != package_sha256
        or quality.generated_slide_count != reopened_slide_count
    ):
        raise CheckpointRunnerError(
            "QUALITY_EVIDENCE_IDENTITY_MISMATCH",
            "quality evidence is not bound to the generated package",
        )

    libreoffice = render_deck(package_bytes, manifest.canvas.aspect_ratio)
    libreoffice_issue_codes = list(libreoffice.issue_codes)
    if libreoffice.status == "passed" and len(libreoffice.pngs) != reopened_slide_count:
        libreoffice = LibreOfficeRenderResult(
            status="failed",
            version=libreoffice.version,
            pngs=(),
            issue_codes=("LIBREOFFICE_SLIDE_COUNT_MISMATCH",),
        )
        libreoffice_issue_codes = list(libreoffice.issue_codes)

    power_point = _power_point_report(
        fixture,
        package_sha256,
        reopened_slide_count,
    )
    quality_issue_codes = _quality_issue_codes(quality)
    issue_codes = sorted(
        set(
            quality_issue_codes
            + libreoffice_issue_codes
            + power_point["issueCodes"]
            + (
                ["OOXML_REFERENCE_PACKAGE_VALIDATION_FAILED"]
                if package_warnings
                else []
            )
            + (
                ["PYTHON_PPTX_REOPEN_FAILED"]
                if reopen_status != "passed"
                else []
            )
        )
    )
    automated_status = _combined_status(
        [
            "failed" if package_warnings else "passed",
            reopen_status,
            libreoffice.status,
            "failed" if quality_issue_codes else "passed",
        ]
    )
    status = _combined_status([automated_status, power_point["status"]])
    render_checksums = [_sha256(content) for content in libreoffice.pngs]
    report: dict[str, Any] = {
        "schemaVersion": 1,
        "templateId": fixture.template_id,
        "templateVersion": fixture.template_version,
        "status": status,
        "automatedStatus": automated_status,
        "generatedPackageSha256": package_sha256,
        "manifestSha256": _canonical_json_sha256(manifest_value),
        "generatedSlideCount": reopened_slide_count,
        "sourceManifest": {"status": "passed"},
        "packageValidation": {
            "status": "failed" if package_warnings else "passed",
            "warningCodes": package_warnings,
        },
        "pythonPptxReopen": {
            "status": reopen_status,
            "slideCount": reopened_slide_count,
        },
        "qualityMetrics": {
            "status": "failed" if quality_issue_codes else "passed",
            "requiredUniqueSourceCount": quality.required_unique_source_count,
            "selectedUniqueSourceCount": quality.selected_unique_source_count,
            "eligibleUniqueSourceCount": quality.eligible_unique_source_count,
            "requiredUniqueLayoutCount": quality.required_unique_layout_count,
            "selectedUniqueLayoutCount": quality.selected_unique_layout_count,
            "eligibleUniqueLayoutCount": quality.eligible_unique_layout_count,
            "adjacentRepeatCount": quality.adjacent_repeat_count,
            "slotOverflowCount": quality.slot_overflow_count,
            "overlapCount": quality.overlap_count,
            "cropErrorCount": quality.crop_error_count,
            "warningCodes": quality.warning_codes,
            "unsupportedObjectCodes": quality.unsupported_object_codes,
            "fontSubstitutionRiskCodes": quality.font_substitution_risk_codes,
            "supportedFixtureTypes": quality.supported_fixture_types,
        },
        "libreOffice": {
            "status": libreoffice.status,
            "version": libreoffice.version,
            "renderedSlideCount": len(libreoffice.pngs),
            "renderArtifactSha256": _aggregate_sha256(render_checksums)
            if render_checksums
            else None,
            "issueCodes": libreoffice_issue_codes,
        },
        "powerPoint": power_point,
        "issueCodes": issue_codes,
    }
    return report, libreoffice.pngs


def _power_point_report(
    fixture: TemplateFixture,
    package_sha256: str,
    slide_count: int,
) -> dict[str, Any]:
    evidence_path = fixture.power_point_evidence_path
    if evidence_path is None:
        return {
            "status": "not-run",
            "applicationVersion": None,
            "evaluatedSlideCount": 0,
            "renderArtifactSha256": None,
            "warningCodes": [],
            "issueCodes": ["POWERPOINT_QA_NOT_RUN"],
        }
    try:
        evidence = _load_model(
            evidence_path,
            PowerPointEvidence,
            "POWERPOINT_EVIDENCE_INVALID",
        )
    except CheckpointRunnerError:
        return {
            "status": "failed",
            "applicationVersion": None,
            "evaluatedSlideCount": 0,
            "renderArtifactSha256": None,
            "warningCodes": [],
            "issueCodes": ["POWERPOINT_EVIDENCE_INVALID"],
        }
    bound = (
        evidence.template_id == fixture.template_id
        and evidence.template_version == fixture.template_version
        and evidence.generated_package_sha256 == package_sha256
        and evidence.evaluated_slide_count == slide_count
    )
    passed = (
        bound
        and evidence.reopen_status == "passed"
        and evidence.render_status == "passed"
        and not evidence.warning_codes
    )
    return {
        "status": "passed" if passed else "failed",
        "applicationVersion": evidence.application_version,
        "evaluatedSlideCount": evidence.evaluated_slide_count,
        "renderArtifactSha256": evidence.render_artifact_sha256,
        "warningCodes": evidence.warning_codes,
        "issueCodes": [] if passed else ["POWERPOINT_QA_FAILED"],
    }


def _quality_issue_codes(evidence: QualityEvidence) -> list[str]:
    issues: list[str] = []
    if evidence.selected_unique_source_count < evidence.required_unique_source_count:
        issues.append("OOXML_REFERENCE_SOURCE_UNIQUENESS_FAILED")
    if evidence.selected_unique_layout_count < evidence.required_unique_layout_count:
        issues.append("OOXML_REFERENCE_LAYOUT_UNIQUENESS_FAILED")
    if evidence.adjacent_repeat_count:
        issues.append("OOXML_REFERENCE_ADJACENT_REPEAT")
    if evidence.slot_overflow_count:
        issues.append("OOXML_REFERENCE_SLOT_OVERFLOW")
    if evidence.overlap_count:
        issues.append("OOXML_REFERENCE_RENDER_OVERLAP")
    if evidence.crop_error_count:
        issues.append("OOXML_REFERENCE_CROP_ERROR")
    if evidence.warning_codes:
        issues.append("OOXML_REFERENCE_GENERATION_WARNING")
    if evidence.font_substitution_risk_codes:
        issues.append("OOXML_REFERENCE_FONT_SUBSTITUTION_RISK")
    return issues


def _python_pptx_reopen(package_bytes: bytes) -> tuple[Status, int]:
    try:
        presentation = Presentation(BytesIO(package_bytes))
        slide_count = len(presentation.slides)
    except (KeyError, OSError, ValueError, zipfile.BadZipFile):
        return "failed", 0
    if not 8 <= slide_count <= 10:
        return "failed", slide_count
    return "passed", slide_count


def _failed_report(fixture: TemplateFixture, issue_code: str) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "templateId": fixture.template_id,
        "templateVersion": fixture.template_version,
        "status": "failed",
        "automatedStatus": "failed",
        "generatedPackageSha256": None,
        "manifestSha256": None,
        "generatedSlideCount": 0,
        "sourceManifest": {"status": "failed"},
        "packageValidation": {"status": "not-run", "warningCodes": []},
        "pythonPptxReopen": {"status": "not-run", "slideCount": 0},
        "qualityMetrics": {
            "status": "not-run",
            "requiredUniqueSourceCount": 0,
            "selectedUniqueSourceCount": 0,
            "eligibleUniqueSourceCount": 0,
            "requiredUniqueLayoutCount": 0,
            "selectedUniqueLayoutCount": 0,
            "eligibleUniqueLayoutCount": 0,
            "adjacentRepeatCount": 0,
            "slotOverflowCount": 0,
            "overlapCount": 0,
            "cropErrorCount": 0,
            "warningCodes": [],
            "unsupportedObjectCodes": [],
            "fontSubstitutionRiskCodes": [],
            "supportedFixtureTypes": [],
        },
        "libreOffice": {
            "status": "not-run",
            "version": None,
            "renderedSlideCount": 0,
            "renderArtifactSha256": None,
            "issueCodes": [],
        },
        "powerPoint": {
            "status": "not-run",
            "applicationVersion": None,
            "evaluatedSlideCount": 0,
            "renderArtifactSha256": None,
            "warningCodes": [],
            "issueCodes": ["POWERPOINT_QA_NOT_RUN"],
        },
        "issueCodes": [issue_code],
    }


def _write_template_artifacts(
    output_directory: Path,
    report: Mapping[str, Any],
    render_pngs: tuple[bytes, ...],
) -> None:
    template_directory = output_directory / str(report["templateId"])
    template_directory.mkdir(parents=True, exist_ok=True)
    if render_pngs:
        render_directory = template_directory / "libreoffice"
        render_directory.mkdir(parents=True, exist_ok=True)
        for index, content in enumerate(render_pngs, start=1):
            (render_directory / f"slide-{index:02d}.png").write_bytes(content)
        montage = _render_montage(render_pngs)
        montage_path = render_directory / "montage.png"
        montage_path.write_bytes(montage)
        report = dict(report)
        report["libreOffice"] = dict(report["libreOffice"])
        report["libreOffice"]["montageSha256"] = _sha256(montage)
    _write_json(template_directory / "report.json", report)
    (template_directory / "report.md").write_text(
        _template_markdown(report),
        encoding="utf-8",
    )


def _render_montage(pngs: tuple[bytes, ...]) -> bytes:
    images: list[Image.Image] = []
    for content in pngs:
        with Image.open(BytesIO(content)) as image:
            preview = image.convert("RGB")
        preview.thumbnail((480, 270))
        images.append(preview)
    columns = 2
    cell_width = 480
    cell_height = 270
    rows = math.ceil(len(images) / columns)
    montage = Image.new(
        "RGB",
        (columns * cell_width, rows * cell_height),
        "#111827",
    )
    for index, image in enumerate(images):
        x = (index % columns) * cell_width + (cell_width - image.width) // 2
        y = (index // columns) * cell_height + (cell_height - image.height) // 2
        montage.paste(image, (x, y))
    output = BytesIO()
    montage.save(output, format="PNG")
    return output.getvalue()


def _build_summary(reports: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    statuses = [str(report["status"]) for report in reports]
    quality_totals = {
        key: sum(int(report["qualityMetrics"][key]) for report in reports)
        for key in (
            "slotOverflowCount",
            "overlapCount",
            "cropErrorCount",
        )
    }
    quality_totals["warningCount"] = sum(
        len(report["qualityMetrics"]["warningCodes"])
        + len(report["packageValidation"]["warningCodes"])
        for report in reports
    )
    return {
        "schemaVersion": 1,
        "checkpoint": "C",
        "status": _combined_status(statuses),
        "templateCount": len(reports),
        "passedTemplateCount": sum(status == "passed" for status in statuses),
        "automatedPassedTemplateCount": sum(
            report["automatedStatus"] == "passed" for report in reports
        ),
        "powerPointPassedTemplateCount": sum(
            report["powerPoint"]["status"] == "passed" for report in reports
        ),
        "qualityTotals": quality_totals,
        "templates": [
            {
                "templateId": report["templateId"],
                "templateVersion": report["templateVersion"],
                "status": report["status"],
                "automatedStatus": report["automatedStatus"],
                "powerPointStatus": report["powerPoint"]["status"],
                "issueCodes": report["issueCodes"],
            }
            for report in reports
        ],
    }


def _combined_status(statuses: list[str]) -> Status:
    if any(status == "failed" for status in statuses):
        return "failed"
    if any(status != "passed" for status in statuses):
        return "not-run"
    return "passed"


def _template_markdown(report: Mapping[str, Any]) -> str:
    quality = report["qualityMetrics"]
    libreoffice = report["libreOffice"]
    power_point = report["powerPoint"]
    issues = ", ".join(report["issueCodes"]) or "없음"
    return (
        f"# `{report['templateId']}@{report['templateVersion']}` Checkpoint C report\n\n"
        f"- 전체 상태: `{report['status']}`\n"
        f"- 자동 검증: `{report['automatedStatus']}`\n"
        f"- 생성 슬라이드: {report['generatedSlideCount']}\n"
        f"- package warning: {len(report['packageValidation']['warningCodes'])}\n"
        f"- overflow/overlap/crop: {quality['slotOverflowCount']}/"
        f"{quality['overlapCount']}/{quality['cropErrorCount']}\n"
        f"- LibreOffice render/reopen: `{libreoffice['status']}`\n"
        f"- Microsoft PowerPoint evidence: `{power_point['status']}`\n"
        f"- issue codes: {issues}\n\n"
        "LibreOffice 결과는 Microsoft PowerPoint evidence를 대체하지 않는다.\n"
    )


def _summary_markdown(summary: Mapping[str, Any]) -> str:
    lines = [
        "# OOXML reference Checkpoint C summary",
        "",
        f"- 상태: `{summary['status']}`",
        f"- template: {summary['templateCount']}",
        f"- 자동 검증 통과: {summary['automatedPassedTemplateCount']}",
        f"- PowerPoint evidence 통과: {summary['powerPointPassedTemplateCount']}",
        "",
        "| template | automated | PowerPoint | overall |",
        "| --- | --- | --- | --- |",
    ]
    lines.extend(
        f"| `{template['templateId']}@{template['templateVersion']}` | "
        f"`{template['automatedStatus']}` | `{template['powerPointStatus']}` | "
        f"`{template['status']}` |"
        for template in summary["templates"]
    )
    lines.extend(
        [
            "",
            "LibreOffice 결과는 Microsoft PowerPoint evidence를 대체하지 않는다.",
        ]
    )
    return "\n".join(lines) + "\n"


def _load_model(
    path: Path,
    model: type[BaseModel],
    error_code: str,
) -> Any:
    value = _load_json(path, error_code)
    try:
        return model.model_validate(value)
    except ValidationError:
        raise CheckpointRunnerError(error_code, "strict evidence is invalid") from None


def _load_json(path: Path, error_code: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise CheckpointRunnerError(error_code, "private JSON input is invalid") from None
    if not isinstance(value, dict):
        raise CheckpointRunnerError(error_code, "private JSON input must be an object")
    return value


def _read_bytes(path: Path, error_code: str) -> bytes:
    try:
        return path.read_bytes()
    except OSError:
        raise CheckpointRunnerError(error_code, "private binary input is unavailable") from None


def _require_outside_repository(path: Path, error_code: str) -> None:
    resolved = path.resolve()
    try:
        resolved.relative_to(REPOSITORY_ROOT)
    except ValueError:
        return
    raise CheckpointRunnerError(
        error_code,
        "private input and output must stay outside the repository",
    )


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _bounded_version(value: str) -> str:
    match = re.search(r"\d+(?:\.\d+){1,4}", value)
    return match.group(0) if match else "unknown"


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _canonical_json_sha256(value: Mapping[str, Any]) -> str:
    content = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return _sha256(content)


def _aggregate_sha256(checksums: list[str]) -> str:
    return _canonical_json_sha256({"checksums": checksums})


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run bounded private OOXML reference Checkpoint C QA",
    )
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--output-directory", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        summary = run_checkpoint_c(args.plan, args.output_directory)
    except CheckpointRunnerError as error:
        print(error.code, file=sys.stderr)
        return 1
    except OSError:
        print("CHECKPOINT_RUNNER_IO_FAILED", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "checkpoint": summary["checkpoint"],
                "status": summary["status"],
                "templateCount": summary["templateCount"],
            },
            ensure_ascii=False,
        )
    )
    return 0 if summary["status"] == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
