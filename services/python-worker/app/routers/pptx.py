from typing import Any, cast
from uuid import uuid4

from fastapi import File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.ai.pptx_design_importer import (
    ImportedDesignAsset,
    PptxDesignImportResult,
)
from app.ai.pptx.facade import (
    PptxImportPreference,
    PptxOoxmlGenerationError,
    PptxOoxmlGenerationResult,
    PptxOoxmlSyncResult,
    UnsupportedPptxAspectRatioError,
    generate_pptx_ooxml,
    sync_pptx_ooxml,
)
from app.ai.pptx_ooxml_asset_storage import (
    StoredPptxOoxmlGenerationResult,
    StoredPptxOoxmlSyncResult,
    store_generation_assets,
    store_sync_assets,
)
from app.ai.pptx_ooxml_read_locators import (
    PptxOoxmlReadLocator,
    load_pptx_package_locator,
    materialize_asset_locators,
)
from app.ai.pptx_ooxml_sync_transport import (
    AUTHORED_ELEMENT_FALLBACKS_MAX_BYTES,
    DECK_CANVAS_MAX_BYTES,
    OPERATIONS_MAX_BYTES,
    SLIDE_MOTION_MAX_BYTES,
    TEMPLATE_BLUEPRINT_MAX_BYTES,
    PptxOoxmlSyncTransportError,
    parse_json_part,
    read_pptx_package,
    validate_authored_element_fallbacks,
)
from app.ai.pptx_ooxml_vector_importer import (
    import_pptx_design_with_optional_ooxml_vector,
)
from app.ai.pptx_package_security import PptxPackageSecurityError
from app.config import load_config as load_config
from app.routers.health import health as health


from fastapi import APIRouter
from app.routers.dependencies import config_from_request as _config

router = APIRouter()


@router.post("/design/import-pptx", response_model=PptxDesignImportResult)
async def import_pptx_design_endpoint(
    files: list[UploadFile] = File(...),
    project_id: str = Form("default"),
    file_ids: list[str] | None = Form(None),
) -> PptxDesignImportResult:
    if not files:
        raise HTTPException(status_code=400, detail="At least one file is required.")

    from pathlib import Path
    from tempfile import TemporaryDirectory

    slides: list[dict[str, Any]] = []
    assets: list[ImportedDesignAsset] = []
    warnings: list[str] = []
    theme: dict[str, Any] | None = None
    template_blueprint: dict[str, Any] | None = None
    quality_report: dict[str, Any] | None = None

    with TemporaryDirectory(prefix="orbit-design-") as temp_dir:
        temp_path = Path(temp_dir)

        for index, upload in enumerate(files):
            safe_name = Path(upload.filename or "upload.pptx").name
            source_path = temp_path / safe_name
            source_path.write_bytes(await upload.read())
            file_id = (
                file_ids[index]
                if file_ids and index < len(file_ids) and file_ids[index].strip()
                else f"file_{uuid4()}"
            )
            try:
                result = await run_in_threadpool(
                    import_pptx_design_with_optional_ooxml_vector,
                    source_path,
                    file_id,
                )
            except PptxPackageSecurityError as error:
                raise HTTPException(status_code=400, detail=error.code) from error
            remapped = _remap_import_asset_ids(result, len(assets))
            slides.extend(
                cast(list[dict[str, Any]], remapped.blueprint.get("slides", []))
            )
            assets.extend(remapped.assets)
            warnings.extend(remapped.warnings)
            if theme is None and isinstance(remapped.blueprint.get("theme"), dict):
                theme = cast(dict[str, Any], remapped.blueprint["theme"])
            if template_blueprint is None:
                template_blueprint = remapped.template_blueprint
            if quality_report is None:
                quality_report = remapped.quality_report

    return PptxDesignImportResult(
        blueprint={
            "projectId": project_id,
            "canvas": {"width": 1920, "height": 1080},
            "theme": theme or {},
            "slides": slides,
            "warnings": warnings,
        },
        templateBlueprint=template_blueprint or {},
        qualityReport=quality_report or {},
        assets=assets,
        warnings=warnings,
    )


@router.post(
    "/ai/pptx-ooxml-generation",
    response_model=PptxOoxmlGenerationResult | StoredPptxOoxmlGenerationResult,
)
async def generate_pptx_ooxml_endpoint(
    request: Request,
    file: UploadFile = File(...),
    file_id: str = Form(...),
    import_preference: PptxImportPreference = Form("editability-first"),
    storage_prefix: str | None = Form(None),
) -> PptxOoxmlGenerationResult | StoredPptxOoxmlGenerationResult:
    from pathlib import Path
    from tempfile import TemporaryDirectory

    with TemporaryDirectory(prefix="orbit-ooxml-") as temp_dir:
        source_path = Path(temp_dir) / Path(file.filename or "upload.pptx").name
        source_path.write_bytes(await file.read())
        try:
            generated = await run_in_threadpool(
                generate_pptx_ooxml,
                source_path,
                file_id,
                import_preference=import_preference,
            )
            if storage_prefix is None:
                return generated
            return await run_in_threadpool(
                store_generation_assets,
                generated,
                config=_config(request),
                storage_prefix=storage_prefix,
            )
        except UnsupportedPptxAspectRatioError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except PptxPackageSecurityError as error:
            raise HTTPException(status_code=400, detail=error.code) from error
        except PptxOoxmlGenerationError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error


@router.post(
    "/ai/pptx-ooxml-sync",
    response_model=PptxOoxmlSyncResult | StoredPptxOoxmlSyncResult,
    response_model_exclude_none=True,
)
async def sync_pptx_ooxml_endpoint(
    request: Request,
    file: UploadFile | None = File(None),
    source_locator_file: UploadFile | None = File(None),
    asset_locators_file: UploadFile | None = File(None),
    template_blueprint_file: UploadFile | None = File(None),
    operations_file: UploadFile | None = File(None),
    slide_motion_file: UploadFile | None = File(None),
    deck_canvas_file: UploadFile | None = File(None),
    authored_element_fallbacks_file: UploadFile | None = File(None),
    template_blueprint: str | None = Form(None),
    operations: str | None = Form(None),
    slide_motion: str | None = Form(None),
    deck_canvas: str | None = Form(None),
    synced_deck_version: int = Form(...),
    render: bool = Form(True),
    storage_prefix: str | None = Form(None),
) -> PptxOoxmlSyncResult | StoredPptxOoxmlSyncResult:
    from pathlib import Path
    from tempfile import TemporaryDirectory

    source_locator: PptxOoxmlReadLocator | None = None
    try:
        if (file is None) == (source_locator_file is None):
            raise ValueError("exactly one OOXML package source is required")
        source_locator = (
            PptxOoxmlReadLocator.model_validate(
                await parse_json_part(
                    field="source_locator",
                    upload=source_locator_file,
                    legacy_text=None,
                    max_bytes=16 * 1024,
                    expected="object",
                )
            )
            if source_locator_file is not None
            else None
        )
        package_bytes = (
            await run_in_threadpool(
                load_pptx_package_locator,
                source_locator,
                config=_config(request),
            )
            if source_locator is not None
            else await read_pptx_package(cast(UploadFile, file))
        )
        parsed_template_blueprint = cast(
            dict[str, Any],
            await parse_json_part(
                field="template_blueprint",
                upload=template_blueprint_file,
                legacy_text=template_blueprint,
                max_bytes=TEMPLATE_BLUEPRINT_MAX_BYTES,
                expected="object",
            ),
        )
        parsed_operations = cast(
            list[dict[str, Any]],
            await parse_json_part(
                field="operations",
                upload=operations_file,
                legacy_text=operations,
                max_bytes=OPERATIONS_MAX_BYTES,
                expected="operations",
            ),
        )
        parsed_slide_motion = cast(
            list[dict[str, Any]],
            await parse_json_part(
                field="slide_motion",
                upload=slide_motion_file,
                legacy_text=slide_motion,
                max_bytes=SLIDE_MOTION_MAX_BYTES,
                expected="operations",
            )
            if slide_motion_file is not None or slide_motion is not None
            else [],
        )
        parsed_deck_canvas = cast(
            dict[str, Any],
            await parse_json_part(
                field="deck_canvas",
                upload=deck_canvas_file,
                legacy_text=deck_canvas,
                max_bytes=DECK_CANVAS_MAX_BYTES,
                expected="object",
            ),
        )
        parsed_authored_element_fallbacks = validate_authored_element_fallbacks(
            await parse_json_part(
                field="authored_element_fallbacks",
                upload=authored_element_fallbacks_file,
                legacy_text=None,
                max_bytes=AUTHORED_ELEMENT_FALLBACKS_MAX_BYTES,
                expected="object",
            )
            if authored_element_fallbacks_file is not None
            else {"theme": {}, "elements": []}
        )
        asset_locators = (
            [
                PptxOoxmlReadLocator.model_validate(item)
                for item in cast(
                    list[dict[str, Any]],
                    await parse_json_part(
                        field="asset_locators",
                        upload=asset_locators_file,
                        legacy_text=None,
                        max_bytes=1024 * 1024,
                        expected="operations",
                    ),
                )
            ]
            if asset_locators_file is not None
            else []
        )
        if asset_locators:
            materialized = cast(
                dict[str, Any],
                await run_in_threadpool(
                    materialize_asset_locators,
                    {
                        "operations": parsed_operations,
                        "authoredElementFallbacks": parsed_authored_element_fallbacks,
                    },
                    asset_locators,
                    config=_config(request),
                ),
            )
            parsed_operations = cast(
                list[dict[str, Any]],
                materialized["operations"],
            )
            parsed_authored_element_fallbacks = validate_authored_element_fallbacks(
                materialized["authoredElementFallbacks"]
            )
    except PptxOoxmlSyncTransportError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail=error.detail(),
        ) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    with TemporaryDirectory(prefix="orbit-ooxml-sync-") as temp_dir:
        source_name = (
            source_locator.file_name
            if source_locator
            else cast(UploadFile, file).filename
        )
        source_path = Path(temp_dir) / Path(source_name or "current.pptx").name
        source_path.write_bytes(package_bytes)
        try:
            synced = await run_in_threadpool(
                sync_pptx_ooxml,
                source_path,
                template_blueprint=parsed_template_blueprint,
                operations=parsed_operations,
                slide_motion=parsed_slide_motion,
                deck_canvas=parsed_deck_canvas,
                authored_element_fallbacks=parsed_authored_element_fallbacks,
                synced_deck_version=synced_deck_version,
                render=render,
            )
            if storage_prefix is None:
                return synced
            return await run_in_threadpool(
                store_sync_assets,
                synced,
                config=_config(request),
                storage_prefix=storage_prefix,
            )
        except (TypeError, ValueError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except PptxPackageSecurityError as error:
            raise HTTPException(status_code=400, detail=error.code) from error
        except PptxOoxmlGenerationError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error


def _remap_import_asset_ids(
    result: PptxDesignImportResult,
    offset: int,
) -> PptxDesignImportResult:
    if offset == 0:
        return result

    replacements: dict[str, str] = {}
    assets: list[ImportedDesignAsset] = []
    for index, asset in enumerate(result.assets, start=1):
        next_id = f"image_{offset + index}"
        replacements[f"asset:{asset.asset_id}"] = f"asset:{next_id}"
        assets.append(
            ImportedDesignAsset(
                assetId=next_id,
                fileName=asset.file_name.replace(asset.asset_id, next_id, 1),
                mimeType=asset.mime_type,
                contentBase64=asset.content_base64,
            )
        )

    return PptxDesignImportResult(
        blueprint=cast(
            dict[str, Any],
            _replace_import_asset_refs(result.blueprint, replacements),
        ),
        templateBlueprint=result.template_blueprint,
        qualityReport=result.quality_report,
        assets=assets,
        warnings=result.warnings,
    )


def _replace_import_asset_refs(value: Any, replacements: dict[str, str]) -> Any:
    if isinstance(value, str):
        return replacements.get(value, value)
    if isinstance(value, list):
        return [_replace_import_asset_refs(item, replacements) for item in value]
    if isinstance(value, dict):
        return {
            key: _replace_import_asset_refs(item, replacements)
            for key, item in value.items()
        }
    return value
