from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
import zipfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Annotated, Any, Literal
from xml.etree import ElementTree as ET

from PIL import Image, ImageChops, ImageDraw, ImageOps
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
from app.ai.ooxml_reference_templates.private_generation_runtime import (  # noqa: E402
    PrivateGenerationRuntimeError,
    _locked_snapshot,
    _slot_mask_png,
)
from app.ai.ooxml_reference_templates.package import (  # noqa: E402
    validate_cloned_package,
)
from scripts.run_ooxml_reference_checkpoint_c import (  # noqa: E402
    LibreOfficeRenderResult,
    render_with_libreoffice,
)


TemplateId = Annotated[
    str,
    Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=1),
]
SourceSlideId = Annotated[str, Field(min_length=1, max_length=200)]


class FidelityArtifactRunnerError(ValueError):
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


class TemplateArtifactFixture(_StrictModel):
    template_id: TemplateId
    template_version: Literal[1]
    source_path: Path
    manifest_path: Path
    generated_pptx_path: Path
    source_slide_ids: list[SourceSlideId] = Field(min_length=8, max_length=10)


class FidelityArtifactPlan(_StrictModel):
    schema_version: Literal[1]
    templates: list[TemplateArtifactFixture] = Field(min_length=7, max_length=7)

    @model_validator(mode="after")
    def validate_exact_catalog(self) -> FidelityArtifactPlan:
        identities = [
            (template.template_id, template.template_version)
            for template in self.templates
        ]
        if len(identities) != len(set(identities)):
            raise ValueError("template identities must be unique")
        if {template_id for template_id, _ in identities} != EXPECTED_TEMPLATE_IDS:
            raise ValueError("artifact plan must contain the exact seven templates")
        return self


RenderDeck = Callable[[bytes, str], LibreOfficeRenderResult]


@dataclass(frozen=True)
class SlideArtifact:
    source_slide_id: str
    source_png: bytes
    generated_png: bytes
    mask_png: bytes
    mask_pixel_count: int
    locked_diff_png: bytes
    locked_diff_pixel_count: int
    geometry_drift_count: int
    style_drift_count: int
    relationship_drift_count: int


def run_fidelity_artifacts(
    plan_path: Path,
    output_directory: Path,
    *,
    render_deck: RenderDeck = render_with_libreoffice,
) -> dict[str, Any]:
    _require_outside_repository(plan_path, "FIDELITY_ARTIFACT_PLAN_INVALID")
    _require_outside_repository(
        output_directory,
        "FIDELITY_ARTIFACT_OUTPUT_INVALID",
    )
    _require_fresh_output_directory(output_directory)
    plan = _load_model(plan_path, FidelityArtifactPlan)
    output_directory.mkdir(parents=True, exist_ok=True)
    reports: list[dict[str, Any]] = []
    for fixture in sorted(plan.templates, key=lambda item: item.template_id):
        try:
            report, artifacts, package_manifest, font_manifest = _evaluate_fixture(
                fixture,
                render_deck,
            )
            _write_artifacts(
                output_directory,
                fixture,
                report,
                artifacts,
                package_manifest,
                font_manifest,
            )
        except FidelityArtifactRunnerError as error:
            report = _failed_report(fixture, error.code)
            _write_report(
                output_directory
                / fixture.template_id
                / f"v{fixture.template_version}",
                report,
            )
        reports.append(report)
    generated_count = sum(report["status"] == "generated" for report in reports)
    summary = {
        "schemaVersion": 1,
        "status": "generated" if generated_count == 7 else "failed",
        "approvalStatus": "pending",
        "templateCount": len(reports),
        "generatedTemplateCount": generated_count,
        "slideCount": sum(int(report["slideCount"]) for report in reports),
        "issueCodes": sorted(
            {code for report in reports for code in report["issueCodes"]}
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
    return summary


def _evaluate_fixture(
    fixture: TemplateArtifactFixture,
    render_deck: RenderDeck,
) -> tuple[
    dict[str, Any],
    tuple[SlideArtifact, ...],
    dict[str, Any],
    dict[str, Any],
]:
    for path in (
        fixture.source_path,
        fixture.manifest_path,
        fixture.generated_pptx_path,
    ):
        _require_outside_repository(path, "FIDELITY_ARTIFACT_INPUT_INVALID")
    manifest_value = _load_json(fixture.manifest_path)
    try:
        manifest = validate_source_slide_annotations(
            fixture.source_path,
            manifest_value,
        )
    except (OSError, AnnotationValidationError, ValidationError):
        raise FidelityArtifactRunnerError("SOURCE_MANIFEST_VALIDATION_FAILED") from None
    if (
        manifest.template_id != fixture.template_id
        or manifest.version != fixture.template_version
        or manifest.provenance.authorization_status != "approved"
    ):
        raise FidelityArtifactRunnerError("SOURCE_MANIFEST_IDENTITY_MISMATCH")

    source_by_id = {slide.source_slide_id: slide for slide in manifest.source_slides}
    try:
        selected = [
            source_by_id[source_slide_id]
            for source_slide_id in fixture.source_slide_ids
        ]
    except KeyError:
        raise FidelityArtifactRunnerError("SOURCE_SLIDE_SEQUENCE_INVALID") from None

    source_package = _read_bytes(fixture.source_path)
    generated_package = _read_bytes(fixture.generated_pptx_path)
    try:
        source_clone = clone_source_slides(
            source_package,
            source_slide_parts=[slide.source_slide_part for slide in selected],
        )
    except Exception:
        raise FidelityArtifactRunnerError("SOURCE_CLONE_FAILED") from None
    source_package_warnings = validate_cloned_package(source_clone.package_bytes)
    generated_package_warnings = validate_cloned_package(generated_package)

    source_render = render_deck(
        source_clone.package_bytes, manifest.canvas.aspect_ratio
    )
    generated_render = render_deck(
        generated_package,
        manifest.canvas.aspect_ratio,
    )
    expected_count = len(selected)
    if (
        source_render.status != "passed"
        or generated_render.status != "passed"
        or len(source_render.pngs) != expected_count
        or len(generated_render.pngs) != expected_count
    ):
        raise FidelityArtifactRunnerError("FIDELITY_ARTIFACT_RENDER_FAILED")
    if (
        not source_render.version
        or source_render.version != generated_render.version
    ):
        raise FidelityArtifactRunnerError("FIDELITY_RENDERER_VERSION_MISMATCH")

    artifacts: list[SlideArtifact] = []
    for order, (slide, source_png, generated_png) in enumerate(
        zip(
            selected,
            source_render.pngs,
            generated_render.pngs,
            strict=True,
        ),
        start=1,
    ):
        slot_shape_ids = {slot.locator.shape_id for slot in slide.slots}
        try:
            mask_png = _slot_mask_png(
                source_package,
                slide.source_slide_part,
                slot_shape_ids,
                manifest.canvas.width_emu,
                manifest.canvas.height_emu,
                source_png,
            )
            source_locked = _locked_snapshot(
                source_package,
                slide.source_slide_part,
                slot_shape_ids,
            )
            generated_locked = _locked_snapshot(
                generated_package,
                f"ppt/slides/slide{order}.xml",
                slot_shape_ids,
            )
        except PrivateGenerationRuntimeError as error:
            raise FidelityArtifactRunnerError(error.code) from None
        except (KeyError, ValueError):
            raise FidelityArtifactRunnerError(
                "FIDELITY_ARTIFACT_SNAPSHOT_FAILED"
            ) from None
        geometry, style, relationships = _locked_snapshot_drift(
            source_locked,
            generated_locked,
        )
        locked_diff_png, locked_diff_pixel_count = _locked_diff(
            source_png,
            generated_png,
            mask_png,
        )
        artifacts.append(
            SlideArtifact(
                source_slide_id=slide.source_slide_id,
                source_png=source_png,
                generated_png=generated_png,
                mask_png=mask_png,
                mask_pixel_count=_nonzero_pixel_count(mask_png),
                locked_diff_png=locked_diff_png,
                locked_diff_pixel_count=locked_diff_pixel_count,
                geometry_drift_count=geometry,
                style_drift_count=style,
                relationship_drift_count=relationships,
            )
        )

    structural_issue_codes: list[str] = []
    if source_package_warnings or generated_package_warnings:
        structural_issue_codes.append("OOXML_REFERENCE_PACKAGE_VALIDATION_FAILED")
    if any(artifact.geometry_drift_count for artifact in artifacts):
        structural_issue_codes.append("OOXML_REFERENCE_FIDELITY_LOCKED_GEOMETRY_DRIFT")
    if any(artifact.style_drift_count for artifact in artifacts):
        structural_issue_codes.append("OOXML_REFERENCE_FIDELITY_LOCKED_STYLE_DRIFT")
    if any(artifact.relationship_drift_count for artifact in artifacts):
        structural_issue_codes.append(
            "OOXML_REFERENCE_FIDELITY_LOCKED_RELATIONSHIP_DRIFT"
        )
    report = {
        "schemaVersion": 1,
        "templateId": fixture.template_id,
        "templateVersion": fixture.template_version,
        "status": "failed" if structural_issue_codes else "generated",
        "approvalStatus": "pending",
        "renderer": "libreoffice-pdf-pymupdf",
        "rendererVersion": source_render.version,
        "sourcePackageSha256": _sha256(source_package),
        "generatedPackageSha256": _sha256(generated_package),
        "manifestSha256": _canonical_json_sha256(manifest_value),
        "slideCount": len(artifacts),
        "structuralStatus": "failed" if structural_issue_codes else "passed",
        "issueCodes": sorted(
            {
                *structural_issue_codes,
                "FONT_AVAILABILITY_VALIDATION_PENDING",
                "HUMAN_FIDELITY_REVIEW_PENDING",
            }
        ),
        "slides": [
            {
                "order": order,
                "sourceSlideId": artifact.source_slide_id,
                "sourcePngSha256": _sha256(artifact.source_png),
                "generatedPngSha256": _sha256(artifact.generated_png),
                "intendedSlotMaskPngSha256": _sha256(artifact.mask_png),
                "intendedSlotMaskPixelCount": artifact.mask_pixel_count,
                "lockedDiffPngSha256": _sha256(artifact.locked_diff_png),
                "lockedDiffPixelCount": artifact.locked_diff_pixel_count,
                "lockedGeometryDriftCount": artifact.geometry_drift_count,
                "lockedStyleDriftCount": artifact.style_drift_count,
                "lockedRelationshipDriftCount": artifact.relationship_drift_count,
            }
            for order, artifact in enumerate(artifacts, start=1)
        ],
    }
    package_manifest = {
        "schemaVersion": 1,
        "templateId": fixture.template_id,
        "templateVersion": fixture.template_version,
        "sourcePackageSha256": _sha256(source_package),
        "sourceClonePackageSha256": _sha256(source_clone.package_bytes),
        "generatedPackageSha256": _sha256(generated_package),
        "templateManifestSha256": _canonical_json_sha256(manifest_value),
        "sourceSlideCount": len(selected),
        "generatedSlideCount": len(artifacts),
        "sourcePackageWarningCodes": source_package_warnings,
        "generatedPackageWarningCodes": generated_package_warnings,
    }
    font_manifest = _font_manifest(
        source_clone.package_bytes,
        generated_package,
        fixture.template_id,
        fixture.template_version,
        source_render.version,
    )
    report["packageManifestSha256"] = _canonical_json_sha256(package_manifest)
    report["fontManifestSha256"] = _canonical_json_sha256(font_manifest)
    report["fontStatus"] = font_manifest["status"]
    return report, tuple(artifacts), package_manifest, font_manifest


def _locked_diff(
    source_png: bytes,
    generated_png: bytes,
    mask_png: bytes,
) -> tuple[bytes, int]:
    try:
        with Image.open(BytesIO(source_png)) as image:
            source = image.convert("RGB")
        with Image.open(BytesIO(generated_png)) as image:
            generated = image.convert("RGB")
        with Image.open(BytesIO(mask_png)) as image:
            slot_mask = image.convert("L")
    except OSError:
        raise FidelityArtifactRunnerError("FIDELITY_ARTIFACT_IMAGE_INVALID") from None
    if source.size != generated.size or source.size != slot_mask.size:
        raise FidelityArtifactRunnerError("FIDELITY_ARTIFACT_IMAGE_SIZE_MISMATCH")
    difference = ImageChops.difference(source, generated)
    red, green, blue = difference.split()
    channel_maximum = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    difference_mask = channel_maximum.point(lambda value: 255 if value else 0)
    locked_mask = ImageOps.invert(slot_mask)
    locked_difference = ImageChops.multiply(difference_mask, locked_mask)
    pixel_count = sum(locked_difference.histogram()[1:])
    overlay = generated.convert("RGBA")
    red = Image.new("RGBA", source.size, (255, 0, 0, 0))
    red.putalpha(locked_difference.point(lambda value: 176 if value else 0))
    overlay.alpha_composite(red)
    outline = Image.new("RGBA", source.size, (0, 0, 0, 0))
    outline_draw = ImageDraw.Draw(outline)
    outline_draw.bitmap((0, 0), slot_mask, fill=(0, 190, 255, 90))
    overlay.alpha_composite(outline)
    return _png_bytes(overlay), pixel_count


def _nonzero_pixel_count(image_png: bytes) -> int:
    try:
        with Image.open(BytesIO(image_png)) as image:
            grayscale = image.convert("L")
    except OSError:
        raise FidelityArtifactRunnerError("FIDELITY_ARTIFACT_IMAGE_INVALID") from None
    return sum(grayscale.histogram()[1:])


def _write_artifacts(
    output_directory: Path,
    fixture: TemplateArtifactFixture,
    report: dict[str, Any],
    artifacts: tuple[SlideArtifact, ...],
    package_manifest: Mapping[str, Any],
    font_manifest: Mapping[str, Any],
) -> None:
    root = (
        output_directory
        / fixture.template_id
        / f"v{fixture.template_version}"
    )
    groups: dict[str, list[bytes]] = {
        "baseline": [artifact.source_png for artifact in artifacts],
        "generated": [artifact.generated_png for artifact in artifacts],
    }
    for name, contents in groups.items():
        directory = root / name
        directory.mkdir(parents=True, exist_ok=True)
        for order, content in enumerate(contents, start=1):
            prefix = "source-slide" if name == "baseline" else "generated-slide"
            (directory / f"{prefix}-{order:02d}.png").write_bytes(content)
    diff_directory = root / "diff"
    diff_directory.mkdir(parents=True, exist_ok=True)
    for order, artifact in enumerate(artifacts, start=1):
        (diff_directory / f"intended-slot-mask-slide-{order:02d}.png").write_bytes(
            artifact.mask_png
        )
        (diff_directory / f"locked-overlay-slide-{order:02d}.png").write_bytes(
            artifact.locked_diff_png
        )
    montage_directory = root / "montage"
    montage_directory.mkdir(parents=True, exist_ok=True)
    montage_checksums: dict[str, str] = {}
    montage_groups = {
        "source": groups["baseline"],
        "generated": groups["generated"],
        "locked-diff": [artifact.locked_diff_png for artifact in artifacts],
    }
    for name, contents in montage_groups.items():
        montage = _render_montage(contents)
        (montage_directory / f"{name}.png").write_bytes(montage)
        checksum_key = {
            "source": "sourceMontageSha256",
            "generated": "generatedMontageSha256",
            "locked-diff": "lockedDiffMontageSha256",
        }[name]
        montage_checksums[checksum_key] = _sha256(montage)
    report["montages"] = montage_checksums
    manifests_directory = root / "manifests"
    manifests_directory.mkdir(parents=True, exist_ok=True)
    _write_json(manifests_directory / "package.json", package_manifest)
    _write_json(manifests_directory / "font.json", font_manifest)
    _write_json(manifests_directory / "fidelity-report.json", report)


def _write_report(root: Path, report: Mapping[str, Any]) -> None:
    root.mkdir(parents=True, exist_ok=True)
    manifests_directory = root / "manifests"
    manifests_directory.mkdir(parents=True, exist_ok=True)
    _write_json(manifests_directory / "fidelity-report.json", report)


def _render_montage(contents: Sequence[bytes]) -> bytes:
    images: list[Image.Image] = []
    for content in contents:
        with Image.open(BytesIO(content)) as image:
            preview = image.convert("RGB")
        preview.thumbnail((480, 270))
        images.append(preview)
    columns = 2
    rows = math.ceil(len(images) / columns)
    montage = Image.new("RGB", (960, rows * 270), "#111827")
    for index, image in enumerate(images):
        x = (index % columns) * 480 + (480 - image.width) // 2
        y = (index // columns) * 270 + (270 - image.height) // 2
        montage.paste(image, (x, y))
    return _png_bytes(montage)


def _font_manifest(
    source_package: bytes,
    generated_package: bytes,
    template_id: str,
    template_version: int,
    renderer_version: str | None,
) -> dict[str, Any]:
    family_roles: dict[str, set[str]] = {}
    for role, package in (
        ("source-clone", source_package),
        ("generated", generated_package),
    ):
        for family in _explicit_font_families(package):
            family_roles.setdefault(family, set()).add(role)
    if len(family_roles) > 256:
        raise FidelityArtifactRunnerError("FIDELITY_FONT_INVENTORY_INVALID")
    font_match = shutil.which("fc-match")
    fonts = [
        _font_resolution(family, sorted(roles), font_match)
        for family, roles in sorted(family_roles.items(), key=lambda item: item[0].casefold())
    ]
    passed = bool(fonts) and all(font["status"] == "exact" for font in fonts)
    return {
        "schemaVersion": 1,
        "templateId": template_id,
        "templateVersion": template_version,
        "renderer": "libreoffice-pdf-pymupdf",
        "rendererVersion": renderer_version,
        "status": "passed" if passed else "pending",
        "fontCount": len(fonts),
        "issueCodes": [] if passed else ["FONT_AVAILABILITY_VALIDATION_PENDING"],
        "fonts": fonts,
    }


def _explicit_font_families(package_bytes: bytes) -> set[str]:
    requested: set[str] = set()
    try:
        with zipfile.ZipFile(BytesIO(package_bytes), "r") as package:
            for name in package.namelist():
                if not name.startswith("ppt/") or not name.endswith(".xml"):
                    continue
                root = ET.fromstring(package.read(name))
                for element in root.iter():
                    typeface = element.get("typeface")
                    if (
                        typeface
                        and typeface.strip()
                        and not typeface.startswith("+")
                    ):
                        family = typeface.strip()
                        if len(family) > 200:
                            raise FidelityArtifactRunnerError(
                                "FIDELITY_FONT_INVENTORY_INVALID"
                            )
                        requested.add(family)
    except (OSError, KeyError, zipfile.BadZipFile, ET.ParseError):
        raise FidelityArtifactRunnerError(
            "FIDELITY_FONT_INVENTORY_INVALID"
        ) from None
    return requested


def _font_resolution(
    requested_family: str,
    roles: list[str],
    font_match: str | None,
) -> dict[str, Any]:
    base: dict[str, Any] = {
        "requestedFamily": requested_family,
        "roles": roles,
        "status": "unavailable",
        "resolvedFamily": None,
        "sha256": None,
    }
    if font_match is None:
        return base
    try:
        result = subprocess.run(
            [font_match, requested_family, "--format", "%{family}\n%{file}\n"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        if len(lines) < 2:
            return base
        resolved_family = lines[0][:500]
        resolved_families = {
            family.strip().casefold()
            for family in resolved_family.split(",")
            if family.strip()
        }
        if requested_family.casefold() not in resolved_families:
            return {
                **base,
                "status": "substituted",
                "resolvedFamily": resolved_family,
            }
        checksum = _sha256(Path(lines[1]).read_bytes())
    except (
        OSError,
        subprocess.CalledProcessError,
        subprocess.TimeoutExpired,
    ):
        return base
    return {
        **base,
        "status": "exact",
        "resolvedFamily": resolved_family,
        "sha256": checksum,
    }


def _failed_report(
    fixture: TemplateArtifactFixture,
    issue_code: str,
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "templateId": fixture.template_id,
        "templateVersion": fixture.template_version,
        "status": "failed",
        "approvalStatus": "pending",
        "slideCount": 0,
        "structuralStatus": "not-run",
        "issueCodes": [issue_code],
        "slides": [],
    }


def _load_model(path: Path, model: type[BaseModel]) -> Any:
    value = _load_json(path)
    try:
        return model.model_validate(value)
    except ValidationError:
        raise FidelityArtifactRunnerError("FIDELITY_ARTIFACT_PLAN_INVALID") from None


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise FidelityArtifactRunnerError("FIDELITY_ARTIFACT_JSON_INVALID") from None
    if not isinstance(value, dict):
        raise FidelityArtifactRunnerError("FIDELITY_ARTIFACT_JSON_INVALID")
    return value


def _read_bytes(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except OSError:
        raise FidelityArtifactRunnerError("FIDELITY_ARTIFACT_BINARY_INVALID") from None


def _require_outside_repository(path: Path, code: str) -> None:
    try:
        path.resolve().relative_to(REPOSITORY_ROOT)
    except ValueError:
        return
    raise FidelityArtifactRunnerError(code)


def _require_fresh_output_directory(path: Path) -> None:
    try:
        if path.exists() and (not path.is_dir() or any(path.iterdir())):
            raise FidelityArtifactRunnerError(
                "FIDELITY_ARTIFACT_OUTPUT_NOT_EMPTY"
            )
    except OSError:
        raise FidelityArtifactRunnerError(
            "FIDELITY_ARTIFACT_OUTPUT_INVALID"
        ) from None


def _canonical_json_sha256(value: Mapping[str, Any]) -> str:
    content = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return _sha256(content)


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _png_bytes(image: Image.Image) -> bytes:
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate private OOXML reference fidelity review artifacts",
    )
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--output-directory", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        summary = run_fidelity_artifacts(args.plan, args.output_directory)
    except FidelityArtifactRunnerError as error:
        print(error.code, file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "status": summary["status"],
                "approvalStatus": summary["approvalStatus"],
                "templateCount": summary["templateCount"],
                "slideCount": summary["slideCount"],
            },
            ensure_ascii=False,
        )
    )
    return 0 if summary["status"] == "generated" else 2


if __name__ == "__main__":
    raise SystemExit(main())
