from __future__ import annotations


import copy


import zipfile


from io import BytesIO

from pathlib import Path


from typing import Any

from xml.etree import ElementTree as ET


from pptx import Presentation


from app.ai.pptx_design_importer import (
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    ImportedDesignAsset,
    build_quality_report,
)

from app.ai.pptx_ooxml_vector_importer import (
    import_pptx_design_with_optional_ooxml_vector,
)


from app.ai.pptx_package_security import (
    inspect_pptx_package,
    sanitize_pptx_package_for_render,
)

from app.ai.pptx_rendering import (
    PptxNotesRenderError,
    PptxNotesRenderErrorCode,
    render_pptx_notes_to_png_assets,
)


from typing import TYPE_CHECKING

from app.ai.pptx_ooxml.common import (
    PML_NS,
    PptxImportPreference,
    REL_NS,
)

if TYPE_CHECKING:
    from app.ai.pptx_ooxml.models import (
        PptxOoxmlGenerationResult,
        PptxOoxmlNotesPageUpdate,
        PptxOoxmlSyncResult,
    )


def generate_pptx_ooxml(
    path: Path,
    file_id: str,
    *,
    import_preference: PptxImportPreference = "editability-first",
    render: bool = True,
) -> PptxOoxmlGenerationResult:
    # PR9 consumes this validated policy when selecting each slide render mode.
    from app.ai.pptx_ooxml.import_capabilities import (
        add_imported_ooxml_capabilities,
        detect_canvas,
        prepare_template_blueprint,
    )
    from app.ai.pptx_ooxml.models import (
        PptxOoxmlGenerationResult,
    )
    from app.ai.pptx_ooxml.rendering import (
        blueprint_has_shape_fallbacks,
        package_asset,
        render_pptx_to_png_assets,
        safe_file_stem,
        shape_fallback_assets,
        strip_text_from_pptx_package,
    )

    del import_preference
    package_bytes = path.read_bytes()
    security_report = inspect_pptx_package(package_bytes)
    render_package_bytes = sanitize_pptx_package_for_render(
        package_bytes,
        security_report,
    )
    canvas = detect_canvas(path)
    imported = import_pptx_design_with_optional_ooxml_vector(
        path,
        file_id,
        canvas_width=canvas.width,
        canvas_height=canvas.height,
    )
    template_blueprint = prepare_template_blueprint(
        imported.template_blueprint,
        canvas,
        source_file_id=file_id,
        source_canvas=imported.blueprint.get("canvas", {}),
    )
    for index, slide in enumerate(template_blueprint.get("slides", [])):
        imported_slides = imported.blueprint.get("slides", [])
        imported_slide = (
            imported_slides[index]
            if isinstance(imported_slides, list) and index < len(imported_slides)
            else None
        )
        if (
            isinstance(slide, dict)
            and isinstance(imported_slide, dict)
            and isinstance(imported_slide.get("slideId"), str)
        ):
            slide["slideId"] = imported_slide["slideId"]
    warnings = list(
        dict.fromkeys([*security_report.diagnostic_codes, *imported.warnings])
    )
    add_imported_ooxml_capabilities(
        imported.blueprint,
        template_blueprint,
        package_bytes,
    )

    assets = [
        package_asset("current_package", package_bytes, f"{safe_file_stem(path)}.pptx")
    ]
    assets.extend(imported.assets)
    if render:
        slide_render_assets = render_pptx_to_png_assets(render_package_bytes, canvas)
        assets.extend(slide_render_assets)
        fallback_render_assets = slide_render_assets
        if blueprint_has_shape_fallbacks(imported.blueprint):
            fallback_render_assets = render_pptx_to_png_assets(
                strip_text_from_pptx_package(render_package_bytes),
                canvas,
            )
        assets.extend(
            shape_fallback_assets(imported.blueprint, fallback_render_assets, warnings)
        )

    quality_report = dict(imported.quality_report)
    quality_report["notes"] = [
        note
        for note in quality_report.get("notes", [])
        if note != "pixel renderer unavailable"
    ]
    if render:
        metrics = dict(quality_report.get("metrics", {}))
        metrics["pixelSimilarity"] = None
        quality_report["metrics"] = metrics
        quality_report["notes"].append("OOXML package rendered to slide PNG")
    else:
        quality_report = build_quality_report(
            [{"elements": []} for _slide in template_blueprint["slides"]],
            warnings,
        )
        for diagnostic_field in ("motionDiagnostics", "notesDiagnostics"):
            if diagnostic_field in imported.quality_report:
                quality_report[diagnostic_field] = copy.deepcopy(
                    imported.quality_report[diagnostic_field]
                )

    if render:
        attach_notes_preview_assets(
            render_package_bytes,
            template_blueprint,
            quality_report,
            assets,
        )

    return PptxOoxmlGenerationResult(
        canvas=canvas.payload(),
        blueprint=imported.blueprint,
        templateBlueprint=template_blueprint,
        qualityReport=quality_report,
        assets=assets,
        warnings=warnings,
    )


def attach_notes_preview_assets(
    package_bytes: bytes,
    template_blueprint: dict[str, Any],
    quality_report: dict[str, Any],
    assets: list[ImportedDesignAsset],
) -> None:
    slides = [
        slide
        for slide in template_blueprint.get("slides", [])
        if isinstance(slide, dict)
    ]
    notes_slides = [
        (index, slide, notes_page)
        for index, slide in enumerate(slides, start=1)
        if isinstance((notes_page := slide.get("notesPage")), dict)
        and notes_page.get("status") == "preserved"
        and notes_page.get("sourceNotesPart")
    ]
    if not notes_slides:
        return

    try:
        width, height = notes_preview_dimensions_for_slides(notes_slides)
        if not notes_preview_order_is_proven(slides):
            raise PptxNotesRenderError("PPTX_NOTES_PAGE_COUNT_MISMATCH")
        rendered_assets = render_pptx_notes_to_png_assets(
            package_bytes,
            notes_width_emu=width,
            notes_height_emu=height,
            expected_page_count=len(slides),
        )
        assets_by_id = {asset.asset_id: asset for asset in rendered_assets}
        selected_assets: list[ImportedDesignAsset] = []
        for page_index, _slide, notes_page in notes_slides:
            asset_id = f"notes_render_{page_index}"
            asset = assets_by_id.get(asset_id)
            if asset is None:
                raise PptxNotesRenderError("PPTX_NOTES_PREVIEW_ASSET_FAILED")
            notes_page["status"] = "rendered"
            notes_page["renderAssetFileId"] = f"asset:{asset_id}"
            selected_assets.append(asset)
        assets.extend(selected_assets)
    except PptxNotesRenderError as error:
        for _page_index, _slide, notes_page in notes_slides:
            notes_page["status"] = "render-unavailable"
            notes_page.pop("renderAssetFileId", None)
        add_notes_render_warning(
            quality_report,
            error.code,
            len(notes_slides),
        )
        return

    diagnostics = quality_report.setdefault(
        "notesDiagnostics",
        {
            "total": len(slides),
            "imported": len(notes_slides),
            "rendered": 0,
            "writable": 0,
            "warnings": [],
        },
    )
    diagnostics["rendered"] = len(notes_slides)


def notes_preview_dimensions_for_slides(
    notes_slides: list[tuple[int, dict[str, Any], dict[str, Any]]],
) -> tuple[int, int]:
    dimensions = {
        (
            int(notes_page.get("notesWidthEmu", 0)),
            int(notes_page.get("notesHeightEmu", 0)),
        )
        for _index, _slide, notes_page in notes_slides
    }
    if len(dimensions) != 1:
        raise PptxNotesRenderError("PPTX_NOTES_PREVIEW_ASSET_FAILED")
    width, height = next(iter(dimensions))
    if width <= 0 or height <= 0:
        raise PptxNotesRenderError("PPTX_NOTES_PREVIEW_ASSET_FAILED")
    return width, height


def notes_preview_order_is_proven(slides: list[dict[str, Any]]) -> bool:
    from app.ai.pptx_ooxml.rendering import (
        int_value,
    )

    return all(
        int_value(slide.get("sourceSlideIndex"), 0) == index
        for index, slide in enumerate(slides, start=1)
    )


def add_notes_render_warning(
    quality_report: dict[str, Any],
    code: PptxNotesRenderErrorCode,
    count: int,
) -> None:
    diagnostics = quality_report.setdefault(
        "notesDiagnostics",
        {
            "total": count,
            "imported": count,
            "rendered": 0,
            "writable": 0,
            "warnings": [],
        },
    )
    warnings_by_code = {
        str(warning.get("code")): int(warning.get("count", 0))
        for warning in diagnostics.get("warnings", [])
        if isinstance(warning, dict) and warning.get("code")
    }
    warnings_by_code[code] = warnings_by_code.get(code, 0) + max(1, count)
    diagnostics["rendered"] = 0
    diagnostics["warnings"] = [
        {"code": warning_code, "count": warning_count}
        for warning_code, warning_count in sorted(warnings_by_code.items())
    ]


def render_notes_preview_assets_for_sync(
    package_bytes: bytes,
    template_blueprint: dict[str, Any],
    warnings: list[str],
) -> list[ImportedDesignAsset]:
    from app.ai.pptx_ooxml.routing import (
        is_safe_slide_part,
    )

    slides = [
        slide
        for slide in template_blueprint.get("slides", [])
        if isinstance(slide, dict)
    ]
    slide_parts = package_slide_parts_in_order(package_bytes)
    if slide_parts is None:
        warnings.append(
            "PPTX_NOTES_PREVIEW_REFRESH_FAILED:PPTX_NOTES_PAGE_COUNT_MISMATCH"
        )
        return []
    slides_by_part = {
        str(slide.get("sourceSlidePart", "")): slide
        for slide in slides
        if is_safe_slide_part(str(slide.get("sourceSlidePart", "")))
    }
    if len(slides_by_part) != len(slides):
        warnings.append(
            "PPTX_NOTES_PREVIEW_REFRESH_FAILED:PPTX_NOTES_PAGE_COUNT_MISMATCH"
        )
        return []
    notes_slides = [
        (page_index, slide, notes_page)
        for page_index, slide_part in enumerate(slide_parts, start=1)
        if (slide := slides_by_part.get(slide_part)) is not None
        if isinstance((notes_page := slide.get("notesPage")), dict)
        and notes_page.get("sourceNotesPart")
    ]
    if not notes_slides:
        return []
    try:
        width, height = notes_preview_dimensions_for_slides(notes_slides)
        rendered_assets = render_pptx_notes_to_png_assets(
            package_bytes,
            notes_width_emu=width,
            notes_height_emu=height,
            expected_page_count=len(slide_parts),
        )
        assets_by_id = {asset.asset_id: asset for asset in rendered_assets}
        selected_assets = [
            assets_by_id[f"notes_render_{page_index}"]
            for page_index, _slide, _notes_page in notes_slides
            if f"notes_render_{page_index}" in assets_by_id
        ]
        if len(selected_assets) != len(notes_slides):
            raise PptxNotesRenderError("PPTX_NOTES_PREVIEW_ASSET_FAILED")
        return selected_assets
    except PptxNotesRenderError as error:
        warnings.append(f"PPTX_NOTES_PREVIEW_REFRESH_FAILED:{error.code}")
        return []


def package_slide_parts_in_order(package_bytes: bytes) -> list[str] | None:
    from app.ai.pptx_ooxml.operations import (
        resolve_relationship_part,
    )
    from app.ai.pptx_ooxml.routing import (
        is_safe_slide_part,
    )

    try:
        with zipfile.ZipFile(BytesIO(package_bytes), "r") as package:
            presentation_root = ET.fromstring(package.read("ppt/presentation.xml"))
            relationships_root = ET.fromstring(
                package.read("ppt/_rels/presentation.xml.rels")
            )
            source_names = set(package.namelist())
    except (KeyError, OSError, ET.ParseError, zipfile.BadZipFile):
        return None
    relationships_by_id = {
        str(relationship.get("Id", "")): relationship
        for relationship in relationships_root
        if str(relationship.get("Type", "")).endswith("/slide")
    }
    slide_id_list = presentation_root.find(f"{{{PML_NS}}}sldIdLst")
    if slide_id_list is None:
        return None
    slide_parts: list[str] = []
    for slide_id in list(slide_id_list):
        relationship_id = str(slide_id.get(f"{{{REL_NS}}}id", ""))
        relationship = relationships_by_id.get(relationship_id)
        if relationship is None:
            return None
        slide_part = resolve_relationship_part(
            "ppt/presentation.xml",
            str(relationship.get("Target", "")),
        )
        if not is_safe_slide_part(slide_part) or slide_part not in source_names:
            return None
        slide_parts.append(slide_part)
    return slide_parts if len(slide_parts) == len(set(slide_parts)) else None


def sync_pptx_ooxml(
    path: Path,
    *,
    template_blueprint: dict[str, Any],
    operations: list[dict[str, Any]],
    deck_canvas: dict[str, Any],
    synced_deck_version: int,
    slide_motion: list[dict[str, Any]] | None = None,
    authored_element_fallbacks: dict[str, Any] | None = None,
    render: bool = True,
) -> PptxOoxmlSyncResult:
    from app.ai.pptx_ooxml.import_capabilities import (
        detect_canvas,
    )
    from app.ai.pptx_ooxml.models import (
        PackageFrameScale,
        PptxOoxmlSyncResult,
        PptxRenderUnavailableError,
    )
    from app.ai.pptx_ooxml.motion import (
        apply_patch_operations_to_package,
    )
    from app.ai.pptx_ooxml.rendering import (
        int_value,
        package_asset,
        render_pptx_to_png_assets,
        safe_file_stem,
    )

    del synced_deck_version
    source_package_bytes = path.read_bytes()
    source_security_report = inspect_pptx_package(source_package_bytes)

    absent_notes_slide_ids = {
        str(slide.get("slideId", ""))
        for slide in template_blueprint.get("slides", [])
        if isinstance(slide, dict)
        and isinstance((notes_page := slide.get("notesPage")), dict)
        and notes_page.get("status") == "absent"
        and slide.get("slideId")
    }

    presentation = Presentation(str(path))
    scale = PackageFrameScale(
        canvas_width=int_value(deck_canvas.get("width"), CANVAS_WIDTH),
        canvas_height=int_value(deck_canvas.get("height"), CANVAS_HEIGHT),
        slide_width_emu=max(1, int(presentation.slide_width or 1)),
        slide_height_emu=max(1, int(presentation.slide_height or 1)),
    )
    (
        package_bytes,
        patch_warnings,
        updated_element_sources,
        applied_operations,
        unsupported_operations,
        applied_slide_motion,
        unsupported_slide_motion,
    ) = apply_patch_operations_to_package(
        source_package_bytes,
        template_blueprint,
        operations,
        scale,
        slide_motion=slide_motion or [],
        authored_element_fallbacks=authored_element_fallbacks or {},
    )
    assets = [
        package_asset("current_package", package_bytes, f"{safe_file_stem(path)}.pptx")
    ]
    warnings: list[str] = [
        *source_security_report.diagnostic_codes,
        *patch_warnings,
    ]

    if render:
        render_package_bytes = sanitize_pptx_package_for_render(
            package_bytes,
            inspect_pptx_package(package_bytes),
        )
        try:
            assets.extend(
                render_pptx_to_png_assets(render_package_bytes, detect_canvas(path))
            )
        except PptxRenderUnavailableError as error:
            warnings.append(str(error))
        if any(
            operation.operation_type == "update_speaker_notes"
            for operation in applied_operations
        ):
            assets.extend(
                render_notes_preview_assets_for_sync(
                    render_package_bytes,
                    template_blueprint,
                    warnings,
                )
            )

    return PptxOoxmlSyncResult(
        assets=assets,
        elementSources=updated_element_sources,
        appliedOperations=applied_operations,
        unsupportedOperations=unsupported_operations,
        notesPages=(
            notes_page_updates(
                template_blueprint,
                absent_notes_slide_ids,
            )
            if not unsupported_operations
            else []
        ),
        appliedSlideMotion=applied_slide_motion,
        unsupportedSlideMotion=unsupported_slide_motion,
        warnings=warnings,
    )


def notes_page_updates(
    template_blueprint: dict[str, Any],
    slide_ids: set[str],
) -> list[PptxOoxmlNotesPageUpdate]:
    from app.ai.pptx_ooxml.models import (
        PptxOoxmlNotesPage,
        PptxOoxmlNotesPageUpdate,
    )

    updates: list[PptxOoxmlNotesPageUpdate] = []
    for slide in template_blueprint.get("slides", []):
        if not isinstance(slide, dict) or slide.get("slideId") not in slide_ids:
            continue
        notes_page = slide.get("notesPage")
        if (
            not isinstance(notes_page, dict)
            or notes_page.get("status") not in {"preserved", "rendered"}
            or notes_page.get("bodyWritable") is not True
        ):
            continue
        updates.append(
            PptxOoxmlNotesPageUpdate(
                slideId=str(slide["slideId"]),
                notesPage=PptxOoxmlNotesPage.model_validate(notes_page),
            )
        )
    return updates
