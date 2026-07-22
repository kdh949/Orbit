from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.ai.ooxml_reference_templates.chart_sync import (
    ChartDataSyncError,
    build_chart_data_locator,
)

from app.ai.ooxml_reference_templates.models import (
    OoxmlReferenceTemplateManifest,
    OoxmlTemplateSnapshot,
)
from app.ai.pptx_ooxml_generation import generate_pptx_ooxml


class MaterializationError(ValueError):
    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


@dataclass(frozen=True)
class ReferenceMaterialization:
    canvas: dict[str, Any]
    blueprint: dict[str, Any]
    template_blueprint: dict[str, Any]
    quality_report: dict[str, Any]
    warnings: list[str]


def materialize_reference_package(
    package_path: Path,
    *,
    baseline_file_id: str,
    current_file_id: str,
    manifest: OoxmlReferenceTemplateManifest,
    snapshot: OoxmlTemplateSnapshot,
    render: bool = True,
) -> ReferenceMaterialization:
    package_bytes = _read_package(package_path)
    checksum = hashlib.sha256(package_bytes).hexdigest()
    if checksum != manifest.source_sha256 or checksum != snapshot.source_sha256:
        raise MaterializationError(
            "PACKAGE_SNAPSHOT_CHECKSUM_MISMATCH",
            "generated package does not match manifest and snapshot",
        )
    manifest_source_ids = {
        slide.source_slide_id for slide in manifest.source_slides
    }
    if not set(snapshot.source_slide_ids).issubset(manifest_source_ids):
        raise MaterializationError(
            "SOURCE_SLIDE_SNAPSHOT_MISMATCH",
            "snapshot references source slides outside the manifest",
        )
    manifest_slots = [
        slot for slide in manifest.source_slides for slot in slide.slots
    ]
    if snapshot.slot_assignment_count != len(manifest_slots):
        raise MaterializationError(
            "SLOT_ASSIGNMENT_COUNT_MISMATCH",
            "snapshot slot assignment count does not match manifest",
        )

    imported = generate_pptx_ooxml(
        package_path,
        baseline_file_id,
        render=render,
    )
    blueprint = imported.blueprint
    template_blueprint = imported.template_blueprint
    template_blueprint["sourceFileId"] = baseline_file_id
    template_blueprint["sourcePackageFileId"] = baseline_file_id
    template_blueprint["currentPackageFileId"] = current_file_id
    template_blueprint["referenceTemplateSnapshot"] = snapshot.model_dump(
        by_alias=True, mode="json"
    )

    sources = [
        source
        for slide in template_blueprint.get("slides", [])
        for source in slide.get("elementSources", [])
        if isinstance(source, dict)
    ]
    elements = [
        element
        for slide in blueprint.get("slides", [])
        for element in slide.get("elements", [])
        if isinstance(element, dict)
    ]
    for source in sources:
        source["writable"] = False
    for element in elements:
        element["locked"] = True

    policies: list[dict[str, Any]] = []
    used_element_ids: set[str] = set()
    for slot in manifest_slots:
        matches = [
            source
            for source in sources
            if source.get("slidePart") == slot.locator.slide_part
            and str(source.get("shapeId", "")) == slot.locator.shape_id
            and (
                slot.locator.relationship_id is None
                or source.get("relationshipId") == slot.locator.relationship_id
            )
        ]
        if len(matches) != 1:
            raise MaterializationError(
                "SLOT_LOCATOR_UNRESOLVED",
                "slot locator must resolve to exactly one imported element",
            )
        element_id = str(matches[0].get("elementId", ""))
        matching_elements = [
            element for element in elements if element.get("elementId") == element_id
        ]
        if (
            not element_id
            or element_id in used_element_ids
            or len(matching_elements) != 1
        ):
            raise MaterializationError(
                "SLOT_LOCATOR_UNRESOLVED",
                "slot element identity is missing, duplicate, or reused",
            )
        used_element_ids.add(element_id)
        matches[0]["writable"] = True
        if slot.content_type == "chart":
            matches[0]["sourceType"] = "chart"
            try:
                chart_locator = build_chart_data_locator(
                    package_bytes,
                    source=matches[0],
                )
            except ChartDataSyncError as error:
                raise MaterializationError(
                    error.code,
                    "chart slot cannot prove an authoritative workbook mapping",
                ) from error
            if chart_locator["chartType"] != slot.capacity.chart_type:
                raise MaterializationError(
                    "CHART_TYPE_UNSUPPORTED",
                    "materialized chart type differs from the approved slot",
                )
            matches[0]["chartDataLocator"] = chart_locator
            capabilities = matches[0].get("ooxmlEditCapabilities")
            if not isinstance(capabilities, dict):
                capabilities = {
                    "richText": "none",
                    "crop": "none",
                    "tableCellText": False,
                }
            capabilities["chartData"] = True
            capabilities["frame"] = False
            matches[0]["ooxmlEditCapabilities"] = capabilities
        matching_elements[0]["locked"] = False
        policies.append(
            {
                "slotId": slot.slot_id,
                "elementId": element_id,
                "mutationPolicy": list(slot.mutation_policy),
                "frameLocked": True,
            }
        )
    template_blueprint["slotEditPolicies"] = policies

    return ReferenceMaterialization(
        canvas=imported.canvas,
        blueprint=blueprint,
        template_blueprint=template_blueprint,
        quality_report=imported.quality_report,
        warnings=list(imported.warnings),
    )


def _read_package(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except OSError as error:
        raise MaterializationError(
            "PACKAGE_UNAVAILABLE", "generated package cannot be read"
        ) from error
