from __future__ import annotations

import hashlib
import json
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, cast

from pydantic import TypeAdapter

from app.ai.ooxml_reference_templates.chart_slots import (
    ChartSeriesData,
    replace_chart_slot,
)
from app.ai.ooxml_reference_templates.clone import CloneResult, clone_source_slides
from app.ai.ooxml_reference_templates.content_adapter import ReferenceContentPlan
from app.ai.ooxml_reference_templates.fidelity import (
    evaluate_ooxml_reference_fidelity,
)
from app.ai.ooxml_reference_templates.generation_runtime import (
    GeneratedAsset,
    LoadedReferenceTemplate,
    OoxmlReferenceGenerationRuntime,
    ReferenceInput,
)
from app.ai.ooxml_reference_templates.image_slots import replace_image_slot
from app.ai.ooxml_reference_templates.materialize import (
    materialize_reference_package,
)
from app.ai.ooxml_reference_templates.models import (
    OoxmlReferenceTemplateGenerationJobResult,
    OoxmlReferenceTemplateManifest,
    OoxmlSourceSlide,
    OoxmlTemplateFidelityReport,
    OoxmlTemplateSlot,
    OoxmlTemplateSnapshot,
)
from app.ai.ooxml_reference_templates.package import validate_cloned_package
from app.ai.ooxml_reference_templates.planner import (
    OoxmlReferenceContentPlan,
    plan_reference_template,
)
from app.ai.ooxml_reference_templates.table_slots import replace_table_slot
from app.ai.ooxml_reference_templates.text_slots import replace_text_slot


@dataclass(frozen=True)
class StageExecutionResult:
    artifact: dict[str, Any]
    source_slide_count: int
    slot_count: int
    issue_codes: list[str]


class GenerationPipelineError(ValueError):
    def __init__(self, code: str, detail: str, *, retryable: bool = False) -> None:
        self.code = code
        self.retryable = retryable
        super().__init__(f"{code}: {detail}")


def execute_generation_stage(
    payload: Any,
    *,
    runtime: OoxmlReferenceGenerationRuntime,
) -> StageExecutionResult:
    loaded = _load_template(payload, runtime)
    handlers = {
        "reference-extract-file": _reference_extract,
        "source-grounding": _source_grounding,
        "content-planning": _content_planning,
        "template-planning": _template_planning,
        "package-generation": _package_generation,
        "render-validation": _render_validation,
        "materialization": _materialization,
    }
    return handlers[payload.stage](payload, runtime, loaded)


def _reference_extract(
    payload: Any,
    runtime: OoxmlReferenceGenerationRuntime,
    loaded: LoadedReferenceTemplate,
) -> StageExecutionResult:
    del loaded
    references = [
        ReferenceInput.model_validate(item)
        for item in runtime.extract_references(
            payload.project_id,
            payload.request,
        )
    ]
    expected_file_ids = (
        []
        if payload.request.reference_policy in {"topic-only", "user-input-only"}
        else payload.request.reference_file_ids
    )
    if [item.file_id for item in references] != expected_file_ids:
        raise GenerationPipelineError(
            "OOXML_REFERENCE_SOURCE_IDENTITY_MISMATCH",
            "reference extraction must preserve exact requested file order",
        )
    artifact = {
        "references": [
            item.model_dump(by_alias=True, mode="json") for item in references
        ]
    }
    return StageExecutionResult(artifact, 0, 0, [])


def _source_grounding(
    payload: Any,
    runtime: OoxmlReferenceGenerationRuntime,
    loaded: LoadedReferenceTemplate,
) -> StageExecutionResult:
    del runtime, loaded
    references = _references(payload)
    source_refs = [
        {
            "fileId": item.file_id,
            "contentSha256": _sha256(item.content.encode("utf-8")),
        }
        for item in references
    ]
    artifact = {
        "sourceRefs": source_refs,
        "groundingSha256": _canonical_sha256(source_refs),
    }
    return StageExecutionResult(artifact, 0, 0, [])


def _content_planning(
    payload: Any,
    runtime: OoxmlReferenceGenerationRuntime,
    loaded: LoadedReferenceTemplate,
) -> StageExecutionResult:
    del loaded
    references = _references(payload)
    _verify_source_grounding(payload, references)
    content_plan = runtime.plan_content(
        payload.project_id,
        payload.request,
        references,
    )
    content_plan = ReferenceContentPlan.model_validate(content_plan)
    selection = payload.request.template_selection.root
    if content_plan.template_id != selection.template_id:
        raise GenerationPipelineError(
            "OOXML_REFERENCE_SINGLE_TEMPLATE_REQUIRED",
            "content planning crossed the selected template boundary",
        )
    slide_count = len(content_plan.slides)
    slide_range = payload.request.slide_count_range
    if slide_count < slide_range.min or slide_count > slide_range.max:
        raise GenerationPipelineError(
            "OOXML_REFERENCE_SLIDE_COUNT_INVALID",
            "content plan is outside the requested slide range",
        )
    return StageExecutionResult(
        {"contentPlan": content_plan.model_dump(by_alias=True, mode="json")},
        slide_count,
        sum(len(slide.values) for slide in content_plan.slides),
        [],
    )


def _template_planning(
    payload: Any,
    runtime: OoxmlReferenceGenerationRuntime,
    loaded: LoadedReferenceTemplate,
) -> StageExecutionResult:
    del runtime
    content_plan = ReferenceContentPlan.model_validate(
        _dependency_data(payload, "content-planning")["contentPlan"]
    )
    plan = plan_reference_template(
        content_plan,
        manifest=loaded.manifest,
        catalog_version=loaded.catalog_version,
    )
    return StageExecutionResult(
        {"templatePlan": plan.model_dump(by_alias=True, mode="json")},
        len(plan.slides),
        sum(len(slide.slot_assignments) for slide in plan.slides),
        [],
    )


def _package_generation(
    payload: Any,
    runtime: OoxmlReferenceGenerationRuntime,
    loaded: LoadedReferenceTemplate,
) -> StageExecutionResult:
    plan = _template_plan(payload, loaded)
    source_by_id = {
        slide.source_slide_id: slide for slide in loaded.manifest.source_slides
    }
    source_slides = [source_by_id[slide.source_slide_id] for slide in plan.slides]
    clone = clone_source_slides(
        loaded.source_package,
        source_slide_parts=[slide.source_slide_part for slide in source_slides],
    )
    package_bytes = _apply_slot_assignments(
        clone.package_bytes,
        plan=plan,
        source_slides=source_slides,
        clone=clone,
        runtime=runtime,
        project_id=payload.project_id,
    )
    warnings = validate_cloned_package(package_bytes)
    if warnings:
        raise GenerationPipelineError(
            "OOXML_REFERENCE_PACKAGE_VALIDATION_FAILED",
            "generated package failed structural validation",
        )
    asset = runtime.store_current_package(
        payload.job_id,
        payload.project_id,
        payload.template_id,
        package_bytes,
    )
    asset = GeneratedAsset.model_validate(asset)
    if (
        asset.size != len(package_bytes)
        or asset.original_name != f"{payload.template_id}-generated.pptx"
        or asset.file_id == loaded.source_asset.file_id
    ):
        raise GenerationPipelineError(
            "OOXML_REFERENCE_PACKAGE_ASSET_MISMATCH",
            "stored current package size does not match generated bytes",
        )
    slot_count = sum(len(slide.slot_assignments) for slide in plan.slides)
    return StageExecutionResult(
        {
            "currentPackage": asset.model_dump(by_alias=True, mode="json"),
            "packageSha256": _sha256(package_bytes),
            "sourceSlideIds": [slide.source_slide_id for slide in plan.slides],
            "slotAssignmentCount": slot_count,
        },
        len(plan.slides),
        slot_count,
        [],
    )


def _render_validation(
    payload: Any,
    runtime: OoxmlReferenceGenerationRuntime,
    loaded: LoadedReferenceTemplate,
) -> StageExecutionResult:
    package_artifact = _dependency_data(payload, "package-generation")
    current = GeneratedAsset.model_validate(package_artifact["currentPackage"])
    package_bytes = runtime.read_current_package(
        payload.job_id,
        payload.project_id,
        payload.template_id,
        current.file_id,
    )
    _require_package_identity(package_bytes, current, package_artifact)
    source_slide_ids = _string_list(package_artifact["sourceSlideIds"])
    plan = _template_plan(payload, loaded)
    expected_source_slide_ids = [slide.source_slide_id for slide in plan.slides]
    expected_slot_count = sum(len(slide.slot_assignments) for slide in plan.slides)
    if (
        source_slide_ids != expected_source_slide_ids
        or package_artifact.get("slotAssignmentCount") != expected_slot_count
    ):
        raise GenerationPipelineError(
            "OOXML_REFERENCE_PACKAGE_PLAN_MISMATCH",
            "package artifact differs from the deterministic template plan",
        )
    validation = runtime.render_and_prepare_fidelity(
        payload.job_id,
        payload.project_id,
        payload.template_id,
        payload.template_version,
        current.file_id,
        package_bytes,
        source_slide_ids,
    )
    assets = [GeneratedAsset.model_validate(asset) for asset in validation.assets]
    rendered_source_ids = [slide.get("sourceSlideId") for slide in validation.slides]
    if (
        len(assets) != len(source_slide_ids)
        or len({asset.file_id for asset in assets}) != len(assets)
        or rendered_source_ids != source_slide_ids
        or any(
            asset.original_name != f"slide-{order:03d}.png"
            or not isinstance(slide.get("generatedPng"), bytes)
            or asset.size != len(slide["generatedPng"])
            for order, (asset, slide) in enumerate(
                zip(assets, validation.slides, strict=True),
                start=1,
            )
        )
    ):
        raise GenerationPipelineError(
            "OOXML_REFERENCE_RENDER_COUNT_MISMATCH",
            "render assets must map one-to-one to generated slides",
        )
    report = evaluate_ooxml_reference_fidelity(
        template_id=loaded.manifest.template_id,
        template_version=loaded.manifest.version,
        mode="generated-comparison",
        slides=validation.slides,
        package_warnings=validate_cloned_package(package_bytes),
        environment=validation.environment,
        calibration=validation.calibration,
    )
    summary = OoxmlTemplateFidelityReport.model_validate(
        {
            key: report[key]
            for key in (
                "status",
                "structuralGate",
                "identityControl",
                "generatedComparison",
                "warningCodes",
            )
        }
    )
    if summary.status != "passed" or not summary.structural_gate.passed:
        raise GenerationPipelineError(
            "OOXML_REFERENCE_FIDELITY_FAILED",
            "generated package did not pass the calibrated fidelity gate",
        )
    return StageExecutionResult(
        {
            "fidelityReport": summary.model_dump(by_alias=True, mode="json"),
            "renderAssets": [
                asset.model_dump(by_alias=True, mode="json") for asset in assets
            ],
        },
        len(plan.slides),
        sum(len(slide.slot_assignments) for slide in plan.slides),
        [],
    )


def _materialization(
    payload: Any,
    runtime: OoxmlReferenceGenerationRuntime,
    loaded: LoadedReferenceTemplate,
) -> StageExecutionResult:
    plan = _template_plan(payload, loaded)
    package_artifact = _dependency_data(payload, "package-generation")
    render_artifact = _dependency_data(payload, "render-validation")
    current = GeneratedAsset.model_validate(package_artifact["currentPackage"])
    package_bytes = runtime.read_current_package(
        payload.job_id,
        payload.project_id,
        payload.template_id,
        current.file_id,
    )
    _require_package_identity(package_bytes, current, package_artifact)
    baseline = GeneratedAsset.model_validate(
        runtime.stage_baseline_package(
            payload.job_id,
            payload.project_id,
            payload.template_id,
            loaded.source_package,
        )
    )
    if (
        baseline.size != len(loaded.source_package)
        or baseline.original_name != f"{payload.template_id}-source.pptx"
        or baseline.file_id == current.file_id
    ):
        raise GenerationPipelineError(
            "OOXML_REFERENCE_BASELINE_ASSET_MISMATCH",
            "staged baseline package does not match the approved source package",
        )
    clone = _clone_identity(loaded, plan)
    internal_manifest = _materialization_manifest(
        loaded.manifest,
        plan,
        clone,
        package_bytes,
    )
    internal_snapshot = OoxmlTemplateSnapshot(
        catalog_template_id=loaded.manifest.template_id,
        catalog_template_version=loaded.manifest.version,
        source_sha256=_sha256(package_bytes),
        source_slide_ids=[
            slide.source_slide_id for slide in internal_manifest.source_slides
        ],
        slot_assignment_count=sum(
            len(slide.slots) for slide in internal_manifest.source_slides
        ),
    )
    with tempfile.TemporaryDirectory(prefix="orbit-ooxml-reference-") as directory:
        package_path = Path(directory) / "generated.pptx"
        package_path.write_bytes(package_bytes)
        materialized = materialize_reference_package(
            package_path,
            baseline_file_id=baseline.file_id,
            current_file_id=current.file_id,
            manifest=internal_manifest,
            snapshot=internal_snapshot,
            render=False,
        )

    source_slide_ids = list(
        dict.fromkeys(slide.source_slide_id for slide in plan.slides)
    )
    slot_count = sum(len(slide.slot_assignments) for slide in plan.slides)
    snapshot = OoxmlTemplateSnapshot(
        catalog_template_id=loaded.manifest.template_id,
        catalog_template_version=loaded.manifest.version,
        source_sha256=loaded.manifest.source_sha256,
        source_slide_ids=source_slide_ids,
        slot_assignment_count=slot_count,
    )
    snapshot_json = snapshot.model_dump(by_alias=True, mode="json")
    materialized.template_blueprint["referenceTemplateSnapshot"] = snapshot_json
    deck = _deck(
        payload,
        materialized.blueprint,
        materialized.canvas,
        title=_content_plan(payload).title,
    )
    fidelity = OoxmlTemplateFidelityReport.model_validate(
        render_artifact["fidelityReport"]
    )
    if fidelity.status != "passed" or not fidelity.structural_gate.passed:
        raise GenerationPipelineError(
            "OOXML_REFERENCE_FIDELITY_FAILED",
            "materialization requires a passed fidelity report",
        )
    render_assets = [
        GeneratedAsset.model_validate(asset)
        for asset in render_artifact["renderAssets"]
    ]
    runtime_assets = runtime.render_assets(
        payload.job_id,
        payload.project_id,
        current.file_id,
        render_assets,
    )
    if render_assets != list(runtime_assets):
        raise GenerationPipelineError(
            "OOXML_REFERENCE_RENDER_ASSET_MISMATCH",
            "materialization render assets drifted from private runtime state",
        )
    if materialized.warnings:
        raise GenerationPipelineError(
            "OOXML_REFERENCE_MATERIALIZATION_WARNING",
            "materialization emitted a warning",
        )
    job_result = OoxmlReferenceTemplateGenerationJobResult(
        deck_id=deck["deckId"],
        template_id=materialized.template_blueprint["templateId"],
        current_package_file_id=current.file_id,
        render_asset_file_ids=[asset.file_id for asset in render_assets],
        template_snapshot=snapshot,
        fidelity_report=fidelity,
        warning_codes=[],
    )
    artifact = {
        "deck": deck,
        "templateBlueprint": materialized.template_blueprint,
        "templateSnapshot": snapshot_json,
        "baselinePackage": baseline.model_dump(by_alias=True, mode="json"),
        "currentPackage": current.model_dump(by_alias=True, mode="json"),
        "renderAssets": [
            asset.model_dump(by_alias=True, mode="json") for asset in render_assets
        ],
        "qualityReport": materialized.quality_report,
        "jobResult": job_result.model_dump(by_alias=True, mode="json"),
    }
    return StageExecutionResult(artifact, len(plan.slides), slot_count, [])


def _load_template(
    payload: Any,
    runtime: OoxmlReferenceGenerationRuntime,
) -> LoadedReferenceTemplate:
    loaded = runtime.load_template(payload.template_id, payload.template_version)
    manifest = loaded.manifest
    if (
        manifest.template_id != payload.template_id
        or manifest.version != payload.template_version
        or manifest.status != "active"
        or manifest.provenance.authorization_status != "approved"
    ):
        raise GenerationPipelineError(
            "OOXML_REFERENCE_TEMPLATE_UNAVAILABLE",
            "runtime template identity is not active and approved",
        )
    if _sha256(loaded.source_package) != manifest.source_sha256:
        raise GenerationPipelineError(
            "OOXML_REFERENCE_SOURCE_CHECKSUM_MISMATCH",
            "runtime source package differs from the approved manifest",
        )
    source_asset = GeneratedAsset.model_validate(loaded.source_asset)
    if (
        source_asset.size != len(loaded.source_package)
        or source_asset.original_name != f"{manifest.template_id}-source.pptx"
    ):
        raise GenerationPipelineError(
            "OOXML_REFERENCE_SOURCE_ASSET_MISMATCH",
            "runtime source asset size differs from the source package",
        )
    if not loaded.catalog_version:
        raise GenerationPipelineError(
            "OOXML_REFERENCE_CATALOG_VERSION_INVALID",
            "runtime catalog version is missing",
        )
    return loaded


def _references(payload: Any) -> list[ReferenceInput]:
    data = _dependency_data(payload, "reference-extract-file")
    return TypeAdapter(list[ReferenceInput]).validate_python(data["references"])


def _content_plan(payload: Any) -> ReferenceContentPlan:
    return ReferenceContentPlan.model_validate(
        _dependency_data(payload, "content-planning")["contentPlan"]
    )


def _template_plan(
    payload: Any,
    loaded: LoadedReferenceTemplate,
) -> OoxmlReferenceContentPlan:
    plan = OoxmlReferenceContentPlan.model_validate(
        _dependency_data(payload, "template-planning")["templatePlan"]
    )
    expected = plan_reference_template(
        _content_plan(payload),
        manifest=loaded.manifest,
        catalog_version=loaded.catalog_version,
    )
    if plan.model_dump(mode="json") != expected.model_dump(mode="json"):
        raise GenerationPipelineError(
            "OOXML_REFERENCE_TEMPLATE_PLAN_DRIFT",
            "template plan differs from deterministic recomputation",
        )
    return plan


def _verify_source_grounding(
    payload: Any,
    references: list[ReferenceInput],
) -> None:
    source_refs = [
        {
            "fileId": item.file_id,
            "contentSha256": _sha256(item.content.encode("utf-8")),
        }
        for item in references
    ]
    expected = {
        "sourceRefs": source_refs,
        "groundingSha256": _canonical_sha256(source_refs),
    }
    if _dependency_data(payload, "source-grounding") != expected:
        raise GenerationPipelineError(
            "OOXML_REFERENCE_SOURCE_GROUNDING_DRIFT",
            "source grounding differs from deterministic reference hashes",
        )


def _dependency_data(payload: Any, stage: str) -> dict[str, Any]:
    dependency = next(item for item in payload.dependencies if item.stage == stage)
    outer = dict(dependency.payload)
    data = outer.get("data", outer)
    if not isinstance(data, dict):
        raise GenerationPipelineError(
            "OOXML_REFERENCE_STAGE_DEPENDENCY_INVALID",
            "stage dependency data must be an object",
        )
    return cast(dict[str, Any], data)


def _apply_slot_assignments(
    package_bytes: bytes,
    *,
    plan: OoxmlReferenceContentPlan,
    source_slides: list[OoxmlSourceSlide],
    clone: CloneResult,
    runtime: OoxmlReferenceGenerationRuntime,
    project_id: str,
) -> bytes:
    current = package_bytes
    for planned, source, cloned in zip(
        plan.slides,
        source_slides,
        clone.clones,
        strict=True,
    ):
        slots = {slot.slot_id: slot for slot in source.slots}
        for assignment in planned.slot_assignments:
            slot = slots[assignment.slot_id].model_copy(
                update={
                    "locator": slots[assignment.slot_id].locator.model_copy(
                        update={"slide_part": cloned.cloned_slide_part}
                    )
                }
            )
            if slot.content_type != assignment.content_type:
                raise GenerationPipelineError(
                    "OOXML_REFERENCE_SLOT_TYPE_MISMATCH",
                    "planned slot type differs from the approved manifest",
                )
            current = _apply_assignment(
                current,
                slot=slot,
                content=assignment.content,
                runtime=runtime,
                project_id=project_id,
            )
    return current


def _apply_assignment(
    package_bytes: bytes,
    *,
    slot: OoxmlTemplateSlot,
    content: str,
    runtime: OoxmlReferenceGenerationRuntime,
    project_id: str,
) -> bytes:
    if slot.content_type == "text":
        text_result = replace_text_slot(
            package_bytes,
            slot=slot,
            text=content,
            available_fonts=runtime.available_fonts(),
            font_fallbacks=runtime.font_fallbacks(),
        )
        return _replacement_package(
            text_result.package_bytes, text_result.warning_codes
        )
    if slot.content_type == "image":
        image_bytes, mime_type = runtime.read_image_asset(project_id, content)
        image_result = replace_image_slot(
            package_bytes,
            slot=slot,
            image_bytes=image_bytes,
            mime_type=mime_type,
        )
        return _replacement_package(
            image_result.package_bytes, image_result.warning_codes
        )
    if slot.content_type == "table":
        data = _json_object(content, "OOXML_REFERENCE_TABLE_DATA_INVALID")
        rows = data.get("rows")
        if not isinstance(rows, list):
            raise GenerationPipelineError(
                "OOXML_REFERENCE_TABLE_DATA_INVALID",
                "table slot content must contain rows",
            )
        table_result = replace_table_slot(
            package_bytes,
            slot=slot,
            rows=rows,
        )
        return _replacement_package(
            table_result.package_bytes, table_result.warning_codes
        )
    data = _json_object(content, "OOXML_REFERENCE_CHART_DATA_INVALID")
    categories = data.get("categories")
    series = data.get("series")
    if not isinstance(categories, list) or not isinstance(series, list):
        raise GenerationPipelineError(
            "OOXML_REFERENCE_CHART_DATA_INVALID",
            "chart slot content must contain categories and series",
        )
    chart_result = replace_chart_slot(
        package_bytes,
        slot=slot,
        categories=categories,
        series=[
            ChartSeriesData(
                name=str(item["name"]),
                values=tuple(item["values"]),
            )
            for item in series
            if isinstance(item, dict) and isinstance(item.get("values"), list)
        ],
    )
    return _replacement_package(chart_result.package_bytes, chart_result.warning_codes)


def _replacement_package(package_bytes: bytes, warning_codes: list[str]) -> bytes:
    if warning_codes:
        raise GenerationPipelineError(
            "OOXML_REFERENCE_PACKAGE_WARNING",
            "slot replacement emitted a package warning",
        )
    return package_bytes


def _clone_identity(
    loaded: LoadedReferenceTemplate,
    plan: OoxmlReferenceContentPlan,
) -> CloneResult:
    source_by_id = {
        slide.source_slide_id: slide for slide in loaded.manifest.source_slides
    }
    return clone_source_slides(
        loaded.source_package,
        source_slide_parts=[
            source_by_id[slide.source_slide_id].source_slide_part
            for slide in plan.slides
        ],
    )


def _materialization_manifest(
    manifest: OoxmlReferenceTemplateManifest,
    plan: OoxmlReferenceContentPlan,
    clone: CloneResult,
    package_bytes: bytes,
) -> OoxmlReferenceTemplateManifest:
    source_by_id = {slide.source_slide_id: slide for slide in manifest.source_slides}
    instance_slides = []
    for planned, cloned in zip(plan.slides, clone.clones, strict=True):
        source = source_by_id[planned.source_slide_id]
        instance_id = f"{source.source_slide_id}-instance-{planned.order:03d}"
        slots = [
            slot.model_copy(
                update={
                    "slot_id": f"{slot.slot_id}-instance-{planned.order:03d}",
                    "locator": slot.locator.model_copy(
                        update={"slide_part": cloned.cloned_slide_part}
                    ),
                }
            )
            for slot in source.slots
        ]
        instance_slides.append(
            source.model_copy(
                update={
                    "source_slide_id": instance_id,
                    "source_slide_part": cloned.cloned_slide_part,
                    "source_order": planned.order,
                    "relationships": source.relationships.model_copy(
                        update={
                            "layout_part": cloned.layout_part,
                            "master_part": cloned.master_part,
                            "theme_part": cloned.theme_part,
                        }
                    ),
                    "slots": slots,
                }
            )
        )
    return manifest.model_copy(
        update={
            "source_sha256": _sha256(package_bytes),
            "slide_count": len(instance_slides),
            "source_slides": instance_slides,
        }
    )


def _deck(
    payload: Any,
    blueprint: Mapping[str, Any],
    canvas: Mapping[str, Any],
    *,
    title: str,
) -> dict[str, Any]:
    content_plan = _content_plan(payload)
    slides = []
    for order, (imported, content) in enumerate(
        zip(blueprint["slides"], content_plan.slides, strict=True),
        start=1,
    ):
        title_value = content.value_for("title")
        slides.append(
            {
                "slideId": f"slide_{payload.job_id}_{order}",
                "order": order,
                "kind": "content",
                "title": title_value.content if title_value else "",
                "thumbnailUrl": "",
                "style": imported["style"],
                "speakerNotes": "",
                "elements": imported["elements"],
                "keywords": [],
                "semanticCues": [],
                "animations": [],
                "actions": [],
            }
        )
    metadata = payload.request.metadata
    return {
        "deckId": f"deck_{payload.job_id}",
        "projectId": payload.project_id,
        "title": title,
        "version": 1,
        "metadata": {
            "language": "ko",
            "locale": "ko-KR",
            "sourceType": "import",
            "generatedBy": "ai",
            "audience": metadata.audience,
            "purpose": metadata.purpose,
            "tone": metadata.tone,
            "createdFrom": {
                "topic": payload.request.topic,
                "references": [
                    {"fileId": file_id}
                    for file_id in payload.request.reference_file_ids
                ],
                "designReferences": [],
            },
        },
        "targetDurationMinutes": payload.request.target_duration_minutes,
        "canvas": dict(canvas),
        "theme": dict(blueprint["theme"]),
        "slides": slides,
    }


def _require_package_identity(
    package_bytes: bytes,
    asset: GeneratedAsset,
    artifact: Mapping[str, Any],
) -> None:
    if asset.size != len(package_bytes) or artifact.get("packageSha256") != _sha256(
        package_bytes
    ):
        raise GenerationPipelineError(
            "OOXML_REFERENCE_PACKAGE_ASSET_MISMATCH",
            "private package bytes differ from the bounded artifact identity",
        )


def _json_object(content: str, code: str) -> dict[str, Any]:
    try:
        value = json.loads(content)
    except json.JSONDecodeError as error:
        raise GenerationPipelineError(
            code, "slot content is not strict JSON"
        ) from error
    if not isinstance(value, dict):
        raise GenerationPipelineError(code, "slot content must be a JSON object")
    return cast(dict[str, Any], value)


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise GenerationPipelineError(
            "OOXML_REFERENCE_STAGE_DEPENDENCY_INVALID",
            "expected a bounded list of identifiers",
        )
    return value


def _canonical_sha256(value: Any) -> str:
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
