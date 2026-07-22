from __future__ import annotations

import base64
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Mapping, Protocol, cast
from urllib.parse import quote
from xml.etree import ElementTree as ET

from PIL import Image, ImageDraw

from app.ai.ooxml_reference_templates.catalog_transport import (
    OoxmlReferenceTemplateCatalogRuntime,
    S3ObjectClient,
    create_s3_object_client,
)
from app.ai.ooxml_reference_templates.clone import clone_source_slides
from app.ai.deck_generation.models import (
    ContentPlan,
    GenerateDeckRequest,
    ReferenceContext,
)
from app.ai.deck_generation.stage_runtime import (
    ContentPlanningStageInput,
    SourceGroundingStageInput,
    run_content_planning_stage,
    run_source_grounding_stage,
)
from app.ai.ooxml_reference_templates.content_adapter import (
    ReferenceContentPlan,
    adapt_content_plan,
)
from app.ai.ooxml_reference_templates.generation_runtime import (
    GeneratedAsset,
    LoadedReferenceTemplate,
    ReferenceInput,
    RenderValidationInput,
)
from app.ai.ooxml_reference_templates.models import (
    OoxmlReferenceTemplateGenerationRequest,
)
from app.config import PythonWorkerConfig
from app.ai.pptx_design_importer import ImportedDesignAsset
from app.ai.pptx_ooxml_generation import (
    CanvasSpec,
    render_pptx_to_png_assets,
)
from app.references import (
    EmbeddingClient,
    PostgresReferenceRepository,
    ReferenceRepository,
    search_reference_chunks_by_file,
)


PPTX_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
)
PNG_CONTENT_TYPE = "image/png"
MAX_GENERATED_OBJECT_BYTES = 209_715_200
MAX_IMAGE_OBJECT_BYTES = 50_000_000
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,200}$")
RenderDeck = Callable[[bytes, CanvasSpec], list[ImportedDesignAsset]]
RenderEnvironment = Callable[[], Mapping[str, Any]]


class PrivateS3ObjectClient(Protocol):
    def head_object(self, **kwargs: object) -> dict[str, object]: ...

    def get_object(self, **kwargs: object) -> dict[str, object]: ...

    def put_object(self, **kwargs: object) -> dict[str, object]: ...


@dataclass(frozen=True)
class ProjectImageAsset:
    storage_key: str
    mime_type: str
    size: int
    sha256: str | None = None


class PostgresProjectAssetReader:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    def get_image_asset(self, project_id: str, file_id: str) -> ProjectImageAsset:
        try:
            import psycopg

            with psycopg.connect(self._database_url) as connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT storage_key, mime_type, size, content_hash
                        FROM project_assets
                        WHERE project_id = %s
                          AND file_id = %s
                          AND status = 'uploaded'
                        """,
                        (project_id, file_id),
                    )
                    row = cursor.fetchone()
        except Exception as error:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_IMAGE_ASSET_UNAVAILABLE",
                "project image metadata cannot be read",
            ) from error
        if row is None:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_IMAGE_ASSET_UNAVAILABLE",
                "project image metadata is missing",
            )
        return ProjectImageAsset(
            storage_key=str(row[0]),
            mime_type=str(row[1]),
            size=int(row[2]),
            sha256=str(row[3]) if row[3] is not None else None,
        )


class PrivateGenerationRuntimeError(RuntimeError):
    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


def generated_storage_key(
    project_id: str,
    generation_id: str,
    file_id: str,
    original_name: str,
) -> str:
    for label, value in (
        ("projectId", project_id),
        ("generationId", generation_id),
        ("fileId", file_id),
    ):
        if SAFE_ID.fullmatch(value) is None:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_ID_INVALID",
                f"{label} is invalid",
            )
    if not original_name or "/" in original_name or "\\" in original_name:
        raise PrivateGenerationRuntimeError(
            "OOXML_REFERENCE_GENERATED_ASSET_NAME_INVALID",
            "generated asset name is invalid",
        )
    encoded_name = quote(original_name, safe="-_.!~*'()")
    return (
        f"projects/{project_id}/ooxml-reference-generations/{generation_id}/"
        f"{file_id}/{encoded_name}"
    )


class PrivateOoxmlReferenceGenerationRuntime:
    def __init__(
        self,
        *,
        catalog: OoxmlReferenceTemplateCatalogRuntime,
        storage_client: PrivateS3ObjectClient,
        bucket: str,
        database_url: str,
        embedding_model: str,
        content_model: str,
        api_key: str | None,
        fidelity_calibration: Mapping[str, Any] | None = None,
        reference_repository: ReferenceRepository | object | None = None,
        embedding_client: EmbeddingClient | object | None = None,
        content_plan_runner: Callable[[GenerateDeckRequest], ContentPlan]
        | object
        | None = None,
        render_deck: RenderDeck | object | None = None,
        render_environment: RenderEnvironment | object | None = None,
        project_asset_reader: object | None = None,
    ) -> None:
        if not bucket.strip():
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_RUNTIME_UNAVAILABLE",
                "private generated storage is not configured",
            )
        self._catalog = catalog
        self._storage_client = storage_client
        self._bucket = bucket
        self._database_url = database_url
        self._embedding_model = embedding_model
        self._content_model = content_model
        self._api_key = api_key
        self._fidelity_calibration = dict(fidelity_calibration or {})
        self._reference_repository = cast(
            ReferenceRepository,
            reference_repository or PostgresReferenceRepository(database_url),
        )
        self._embedding_client = cast(EmbeddingClient | None, embedding_client)
        self._content_plan_runner = cast(
            Callable[[GenerateDeckRequest], ContentPlan] | None,
            content_plan_runner,
        )
        self._render_deck = cast(RenderDeck, render_deck or render_pptx_to_png_assets)
        self._render_environment = cast(
            RenderEnvironment,
            render_environment or _libreoffice_render_environment,
        )
        self._project_asset_reader = cast(
            Any,
            project_asset_reader or PostgresProjectAssetReader(database_url),
        )
        self._available_fonts: set[str] | None = None

    def __repr__(self) -> str:
        return "PrivateOoxmlReferenceGenerationRuntime(private=True)"

    def load_template(
        self,
        template_id: str,
        template_version: int,
    ) -> LoadedReferenceTemplate:
        source = self._catalog.read_source(template_id, template_version)
        manifest_bytes = json.dumps(
            source.manifest.model_dump(by_alias=True, mode="json"),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        source_id = _generated_file_id(
            template_id,
            str(template_version),
            "catalog-source",
        )
        return LoadedReferenceTemplate(
            manifest=source.manifest,
            catalog_version=f"manifest-{_sha256(manifest_bytes)[:16]}",
            source_package=source.content,
            source_asset=GeneratedAsset(
                file_id=source_id,
                original_name=f"{template_id}-source.pptx",
                size=len(source.content),
            ),
        )

    def extract_references(
        self,
        project_id: str,
        request: OoxmlReferenceTemplateGenerationRequest,
    ) -> list[ReferenceInput]:
        if request.reference_policy in {"topic-only", "user-input-only"}:
            return []
        file_ids = list(dict.fromkeys(request.reference_file_ids))
        if not file_ids:
            if request.reference_policy in {"references-only", "references-first"}:
                raise PrivateGenerationRuntimeError(
                    "OOXML_REFERENCE_SOURCE_GROUNDING_REQUIRED",
                    "selected reference files are required",
                )
            return []
        results, embedding = search_reference_chunks_by_file(
            repository=self._reference_repository,
            project_id=project_id,
            query=" ".join(
                value for value in (request.topic, request.prompt or "") if value
            ),
            file_ids=file_ids,
            limit_per_file=3,
            embedding_client=self._embedding_client,
            model=self._embedding_model,
            api_key=self._api_key,
        )
        if embedding.status != "succeeded":
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_SOURCE_GROUNDING_UNAVAILABLE",
                "reference chunk search is unavailable",
            )
        by_file: dict[str, list[Any]] = {file_id: [] for file_id in file_ids}
        for result in results:
            if result.project_id == project_id and result.file_id in by_file:
                by_file[result.file_id].append(result)
        missing = [file_id for file_id in file_ids if not by_file[file_id]]
        if missing and request.reference_policy == "references-only":
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_SOURCE_GROUNDING_REQUIRED",
                "every selected reference requires an indexed chunk",
            )
        if (
            len(missing) == len(file_ids)
            and request.reference_policy == "references-first"
        ):
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_SOURCE_GROUNDING_REQUIRED",
                "at least one selected reference requires an indexed chunk",
            )
        references: list[ReferenceInput] = []
        for file_id in file_ids:
            chunks = sorted(
                by_file[file_id],
                key=lambda item: (item.chunk_index, item.chunk_id),
            )
            if not chunks:
                continue
            references.append(
                ReferenceInput(
                    file_id=file_id,
                    content="\n\n".join(item.content for item in chunks),
                    metadata={
                        "chunkIds": [item.chunk_id for item in chunks],
                        "chunkCount": len(chunks),
                    },
                )
            )
        return references

    def plan_content(
        self,
        project_id: str,
        request: OoxmlReferenceTemplateGenerationRequest,
        references: list[ReferenceInput],
    ) -> ReferenceContentPlan:
        validated_references = [
            ReferenceInput.model_validate(reference) for reference in references
        ]
        generation_request = GenerateDeckRequest.model_validate(
            {
                "projectId": project_id,
                "topic": request.topic,
                "prompt": request.prompt or "",
                "targetDurationMinutes": request.target_duration_minutes,
                "slideCountRange": request.slide_count_range.model_dump(mode="json"),
                "metadata": request.metadata.model_dump(mode="json"),
                "referencePolicy": request.reference_policy,
                "referenceFileIds": [
                    reference.file_id for reference in validated_references
                ],
                "references": [
                    {"fileId": reference.file_id} for reference in validated_references
                ],
                "referenceContext": [
                    ReferenceContext(
                        fileId=reference.file_id,
                        sourceId=f"uploaded:{reference.file_id}",
                        content=reference.content,
                    ).model_dump(by_alias=True, mode="json")
                    for reference in validated_references
                ],
            }
        )
        try:
            if self._content_plan_runner is not None:
                grounded_plan = self._content_plan_runner(generation_request)
            else:
                grounding = run_source_grounding_stage(
                    SourceGroundingStageInput(request=generation_request),
                    model=self._content_model,
                    api_key=self._api_key,
                )
                grounded_plan = run_content_planning_stage(
                    ContentPlanningStageInput(groundingResult=grounding),
                    model=self._content_model,
                    api_key=self._api_key,
                ).content_plan
            adapted = adapt_content_plan(ContentPlan.model_validate(grounded_plan))
        except Exception as error:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_CONTENT_PLANNING_FAILED",
                "grounded content planning failed",
            ) from error
        selection = request.template_selection.root
        if selection.mode != "user":
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_SINGLE_TEMPLATE_REQUIRED",
                "content planning requires an exact template selection",
            )
        return adapted.model_copy(update={"template_id": selection.template_id})

    def available_fonts(self) -> set[str]:
        if self._available_fonts is None:
            self._available_fonts = _font_families()
        return set(self._available_fonts)

    def font_fallbacks(self) -> dict[str, str]:
        return {}

    def read_image_asset(
        self,
        project_id: str,
        file_id: str,
    ) -> tuple[bytes, str]:
        if SAFE_ID.fullmatch(project_id) is None or SAFE_ID.fullmatch(file_id) is None:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_IMAGE_ASSET_UNAVAILABLE",
                "project image identity is invalid",
            )
        asset = self._project_asset_reader.get_image_asset(project_id, file_id)
        if not isinstance(asset, ProjectImageAsset):
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_IMAGE_ASSET_UNAVAILABLE",
                "project image metadata is invalid",
            )
        if (
            not asset.storage_key.startswith(f"projects/{project_id}/")
            or asset.mime_type not in {"image/png", "image/jpeg"}
            or not 0 < asset.size <= MAX_IMAGE_OBJECT_BYTES
            or (
                asset.sha256 is not None
                and re.fullmatch(r"[a-f0-9]{64}", asset.sha256) is None
            )
        ):
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_IMAGE_ASSET_UNAVAILABLE",
                "project image metadata is invalid",
            )
        metadata = self._head_generated_object(asset.storage_key)
        if metadata is None:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_IMAGE_ASSET_UNAVAILABLE",
                "project image content is missing",
            )
        try:
            declared_size = int(cast(Any, metadata["ContentLength"]))
            declared_type = str(metadata["ContentType"])
        except (KeyError, TypeError, ValueError) as error:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_IMAGE_ASSET_UNAVAILABLE",
                "project image metadata is invalid",
            ) from error
        if declared_size != asset.size or declared_type != asset.mime_type:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_IMAGE_ASSET_UNAVAILABLE",
                "project image metadata drifted",
            )
        content = self._read_object(asset.storage_key, asset.size)
        if asset.sha256 is not None and _sha256(content) != asset.sha256:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_IMAGE_ASSET_UNAVAILABLE",
                "project image checksum drifted",
            )
        return content, asset.mime_type

    def store_current_package(
        self,
        job_id: str,
        project_id: str,
        template_id: str,
        content: bytes,
    ) -> GeneratedAsset:
        return self._store_generated_asset(
            project_id=project_id,
            generation_id=job_id,
            file_id=_generated_file_id(project_id, job_id, "current-package"),
            original_name=f"{template_id}-generated.pptx",
            content=content,
            content_type=PPTX_CONTENT_TYPE,
        )

    def stage_baseline_package(
        self,
        job_id: str,
        project_id: str,
        template_id: str,
        content: bytes,
    ) -> GeneratedAsset:
        return self._store_generated_asset(
            project_id=project_id,
            generation_id=job_id,
            file_id=_generated_file_id(project_id, job_id, "baseline-package"),
            original_name=f"{template_id}-source.pptx",
            content=content,
            content_type=PPTX_CONTENT_TYPE,
        )

    def read_current_package(
        self,
        job_id: str,
        project_id: str,
        template_id: str,
        file_id: str,
    ) -> bytes:
        expected_file_id = _generated_file_id(project_id, job_id, "current-package")
        if file_id != expected_file_id:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_IDENTITY_MISMATCH",
                "generated package identity does not match this generation",
            )
        original_name = f"{template_id}-generated.pptx"
        size = self._generated_object_size(
            project_id,
            job_id,
            file_id,
            original_name,
            PPTX_CONTENT_TYPE,
        )
        return self._read_generated_asset(
            project_id=project_id,
            generation_id=job_id,
            asset=GeneratedAsset(
                file_id=file_id,
                original_name=original_name,
                size=size,
            ),
            content_type=PPTX_CONTENT_TYPE,
        )

    def render_and_prepare_fidelity(
        self,
        job_id: str,
        project_id: str,
        template_id: str,
        template_version: int,
        package_file_id: str,
        package_bytes: bytes,
        source_slide_ids: list[str],
    ) -> RenderValidationInput:
        expected_file_id = _generated_file_id(project_id, job_id, "current-package")
        if package_file_id != expected_file_id:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_IDENTITY_MISMATCH",
                "render package identity does not match this generation",
            )
        loaded = self.load_template(template_id, template_version)
        source_by_id = {
            slide.source_slide_id: slide for slide in loaded.manifest.source_slides
        }
        try:
            selected = [source_by_id[source_id] for source_id in source_slide_ids]
        except KeyError as error:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_SOURCE_IDENTITY_MISMATCH",
                "render source slide is outside the selected template",
            ) from error
        source_clone = clone_source_slides(
            loaded.source_package,
            source_slide_parts=[slide.source_slide_part for slide in selected],
        )
        canvas = _render_canvas(loaded)
        try:
            source_renders = self._render_deck(source_clone.package_bytes, canvas)
            generated_renders = self._render_deck(package_bytes, canvas)
        except Exception as error:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_RENDER_UNAVAILABLE",
                "LibreOffice failed to render the reference package",
            ) from error
        source_pngs = _render_pngs(source_renders, len(selected))
        generated_pngs = _render_pngs(generated_renders, len(selected))
        assets: list[GeneratedAsset] = []
        slides: list[Mapping[str, Any]] = []
        for order, (slide, source_png, generated_png) in enumerate(
            zip(selected, source_pngs, generated_pngs, strict=True),
            start=1,
        ):
            asset = self._store_generated_asset(
                project_id=project_id,
                generation_id=job_id,
                file_id=_generated_file_id(
                    project_id,
                    job_id,
                    f"render-{order:03d}",
                ),
                original_name=f"slide-{order:03d}.png",
                content=generated_png,
                content_type=PNG_CONTENT_TYPE,
            )
            assets.append(asset)
            slot_ids = {slot.locator.shape_id for slot in slide.slots}
            slides.append(
                {
                    "sourceSlideId": slide.source_slide_id,
                    "sourcePng": source_png,
                    "generatedPng": generated_png,
                    "intendedSlotMaskPng": _slot_mask_png(
                        loaded.source_package,
                        slide.source_slide_part,
                        slot_ids,
                        loaded.manifest.canvas.width_emu,
                        loaded.manifest.canvas.height_emu,
                        source_png,
                    ),
                    "sourceLockedSnapshot": _locked_snapshot(
                        loaded.source_package,
                        slide.source_slide_part,
                        slot_ids,
                    ),
                    "generatedLockedSnapshot": _locked_snapshot(
                        package_bytes,
                        f"ppt/slides/slide{order}.xml",
                        slot_ids,
                    ),
                }
            )
        try:
            environment = dict(self._render_environment())
        except Exception as error:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_RENDER_ENVIRONMENT_UNAVAILABLE",
                "deterministic render environment cannot be resolved",
            ) from error
        environment.update(
            {
                "sourceSha256": loaded.manifest.source_sha256,
                "templateManifestSha256": _manifest_sha256(loaded),
                "artifactSha256": _sha256(package_bytes),
            }
        )
        return RenderValidationInput(
            assets=tuple(assets),
            slides=slides,
            environment=environment,
            calibration=dict(self._fidelity_calibration),
        )

    def render_assets(
        self,
        job_id: str,
        project_id: str,
        package_file_id: str,
        assets: list[GeneratedAsset],
    ) -> tuple[GeneratedAsset, ...]:
        expected_package_id = _generated_file_id(
            project_id,
            job_id,
            "current-package",
        )
        if package_file_id != expected_package_id:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_IDENTITY_MISMATCH",
                "render package identity does not match this generation",
            )
        verified: list[GeneratedAsset] = []
        for order, raw_asset in enumerate(assets, start=1):
            asset = GeneratedAsset.model_validate(raw_asset)
            if (
                asset.file_id
                != _generated_file_id(
                    project_id,
                    job_id,
                    f"render-{order:03d}",
                )
                or asset.original_name != f"slide-{order:03d}.png"
            ):
                raise PrivateGenerationRuntimeError(
                    "OOXML_REFERENCE_RENDER_ASSET_MISMATCH",
                    "render asset identity does not match this generation",
                )
            self._read_generated_asset(
                project_id=project_id,
                generation_id=job_id,
                asset=asset,
                content_type=PNG_CONTENT_TYPE,
            )
            verified.append(asset)
        return tuple(verified)

    def _generated_object_size(
        self,
        project_id: str,
        generation_id: str,
        file_id: str,
        original_name: str,
        content_type: str,
    ) -> int:
        key = generated_storage_key(
            project_id,
            generation_id,
            file_id,
            original_name,
        )
        metadata = self._head_generated_object(key)
        if metadata is None:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_UNAVAILABLE",
                "private generated asset is missing",
            )
        try:
            size = int(cast(Any, metadata["ContentLength"]))
            stored_type = str(metadata["ContentType"])
        except (KeyError, TypeError, ValueError) as error:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_READ_FAILED",
                "private generated asset metadata is invalid",
            ) from error
        if not 0 < size <= MAX_GENERATED_OBJECT_BYTES or stored_type != content_type:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_READ_FAILED",
                "private generated asset metadata is invalid",
            )
        return size

    def _read_generated_asset(
        self,
        *,
        project_id: str,
        generation_id: str,
        asset: GeneratedAsset,
        content_type: str,
    ) -> bytes:
        key = generated_storage_key(
            project_id,
            generation_id,
            asset.file_id,
            asset.original_name,
        )
        metadata = self._head_generated_object(key)
        if metadata is None:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_UNAVAILABLE",
                "private generated asset is missing",
            )
        try:
            declared_metadata = cast(Mapping[str, object], metadata["Metadata"])
            digest = str(declared_metadata["sha256"])
            declared_size = int(cast(Any, metadata["ContentLength"]))
            declared_type = str(metadata["ContentType"])
        except (KeyError, TypeError, ValueError) as error:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_READ_FAILED",
                "private generated asset metadata is invalid",
            ) from error
        if declared_size != asset.size or declared_type != content_type:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_CONFLICT",
                "private generated asset metadata drifted",
            )
        content = self._read_object(key, asset.size)
        if _sha256(content) != digest:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_CONFLICT",
                "private generated asset checksum drifted",
            )
        return content

    def _store_generated_asset(
        self,
        *,
        project_id: str,
        generation_id: str,
        file_id: str,
        original_name: str,
        content: bytes,
        content_type: str,
    ) -> GeneratedAsset:
        if not content or len(content) > MAX_GENERATED_OBJECT_BYTES:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_SIZE_INVALID",
                "generated asset size is invalid",
            )
        key = generated_storage_key(
            project_id,
            generation_id,
            file_id,
            original_name,
        )
        digest = _sha256(content)
        existing = self._head_generated_object(key)
        if existing is not None:
            self._require_same_object(key, existing, content, content_type, digest)
        else:
            try:
                self._storage_client.put_object(
                    Bucket=self._bucket,
                    Key=key,
                    Body=content,
                    ContentType=content_type,
                    Metadata={"sha256": digest},
                    IfNoneMatch="*",
                )
            except Exception as error:
                if not _is_precondition_failure(error):
                    raise PrivateGenerationRuntimeError(
                        "OOXML_REFERENCE_GENERATED_ASSET_WRITE_FAILED",
                        "private generated asset cannot be stored",
                    ) from error
                raced = self._head_generated_object(key)
                if raced is None:
                    raise PrivateGenerationRuntimeError(
                        "OOXML_REFERENCE_GENERATED_ASSET_WRITE_FAILED",
                        "private generated asset cannot be stored",
                    ) from error
                self._require_same_object(key, raced, content, content_type, digest)
        return GeneratedAsset(
            file_id=file_id,
            original_name=original_name,
            size=len(content),
        )

    def _head_generated_object(self, key: str) -> dict[str, object] | None:
        try:
            return self._storage_client.head_object(Bucket=self._bucket, Key=key)
        except Exception as error:
            if _is_missing_object(error):
                return None
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_READ_FAILED",
                "private generated asset metadata cannot be read",
            ) from error

    def _require_same_object(
        self,
        key: str,
        metadata: Mapping[str, object],
        content: bytes,
        content_type: str,
        digest: str,
    ) -> None:
        try:
            declared_metadata = cast(Mapping[str, object], metadata["Metadata"])
            declared_digest = str(declared_metadata["sha256"])
            declared_size = int(cast(Any, metadata["ContentLength"]))
            declared_type = str(metadata["ContentType"])
        except (KeyError, TypeError, ValueError) as error:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_CONFLICT",
                "existing generated asset metadata does not match",
            ) from error
        if (
            declared_digest != digest
            or declared_size != len(content)
            or declared_type != content_type
        ):
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_CONFLICT",
                "existing generated asset differs from retry content",
            )
        actual = self._read_object(key, len(content))
        if actual != content:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_CONFLICT",
                "existing generated asset differs from retry content",
            )

    def _read_object(self, key: str, expected_size: int) -> bytes:
        try:
            response = self._storage_client.get_object(
                Bucket=self._bucket,
                Key=key,
            )
            body = response["Body"]
            read = getattr(body, "read")
            content = read(expected_size + 1)
            close = getattr(body, "close", None)
            if callable(close):
                close()
        except Exception as error:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_READ_FAILED",
                "private generated asset cannot be read",
            ) from error
        if not isinstance(content, bytes) or len(content) != expected_size:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_GENERATED_ASSET_CONFLICT",
                "existing generated asset differs from retry content",
            )
        return content


def build_private_generation_runtime(
    config: PythonWorkerConfig,
    *,
    catalog: OoxmlReferenceTemplateCatalogRuntime,
    client: S3ObjectClient | None = None,
) -> PrivateOoxmlReferenceGenerationRuntime | None:
    if (
        not config.ai_ppt_ooxml_reference_templates_enabled
        or not config.ooxml_reference_template_allowlist
    ):
        return None
    return PrivateOoxmlReferenceGenerationRuntime(
        catalog=catalog,
        storage_client=cast(
            PrivateS3ObjectClient,
            client or create_s3_object_client(config),
        ),
        bucket=config.s3_bucket,
        database_url=config.database_url,
        embedding_model=config.openai_embedding_model,
        content_model=config.openai_model,
        api_key=config.openai_api_key,
    )


def _generated_file_id(project_id: str, generation_id: str, kind: str) -> str:
    digest = _sha256(
        f"ooxml-reference:{project_id}:{generation_id}:{kind}".encode("utf-8")
    )
    return f"file_{digest[:32]}"


def _render_canvas(loaded: LoadedReferenceTemplate) -> CanvasSpec:
    aspect_ratio = loaded.manifest.canvas.aspect_ratio
    width, height = (1600, 900) if aspect_ratio == "16:9" else (1200, 900)
    return CanvasSpec(
        preset="ooxml-reference-fidelity",
        width=width,
        height=height,
        aspect_ratio=aspect_ratio,
    )


def _render_pngs(
    assets: list[ImportedDesignAsset],
    expected_count: int,
) -> list[bytes]:
    if len(assets) != expected_count:
        raise PrivateGenerationRuntimeError(
            "OOXML_REFERENCE_RENDER_SLIDE_COUNT_MISMATCH",
            "rendered slide count does not match the generated package",
        )
    pngs: list[bytes] = []
    for asset in assets:
        if asset.mime_type != PNG_CONTENT_TYPE:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_RENDER_ASSET_INVALID",
                "renderer returned a non-PNG slide asset",
            )
        try:
            content = base64.b64decode(asset.content_base64, validate=True)
            with Image.open(BytesIO(content)) as image:
                image.verify()
        except (OSError, ValueError) as error:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_RENDER_ASSET_INVALID",
                "renderer returned an invalid PNG slide asset",
            ) from error
        pngs.append(content)
    return pngs


def _slot_mask_png(
    package_bytes: bytes,
    slide_part: str,
    slot_shape_ids: set[str],
    canvas_width_emu: int,
    canvas_height_emu: int,
    render_png: bytes,
) -> bytes:
    with Image.open(BytesIO(render_png)) as rendered:
        width, height = rendered.size
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    root = ET.fromstring(_read_package_part(package_bytes, slide_part))
    found: set[str] = set()
    for element in _shape_elements(root):
        shape_id = _shape_id(element)
        if shape_id not in slot_shape_ids:
            continue
        transform = _shape_transform(element)
        if transform is None:
            raise PrivateGenerationRuntimeError(
                "OOXML_REFERENCE_SLOT_MASK_UNAVAILABLE",
                "annotated slot has no explicit source geometry",
            )
        x, y, cx, cy = transform
        left = round(x * width / canvas_width_emu)
        top = round(y * height / canvas_height_emu)
        right = round((x + cx) * width / canvas_width_emu)
        bottom = round((y + cy) * height / canvas_height_emu)
        draw.rectangle((left, top, right, bottom), fill=255)
        found.add(shape_id)
    if found != slot_shape_ids:
        raise PrivateGenerationRuntimeError(
            "OOXML_REFERENCE_SLOT_MASK_UNAVAILABLE",
            "annotated slot shape is missing from the source slide",
        )
    output = BytesIO()
    mask.save(output, format="PNG")
    return output.getvalue()


def _locked_snapshot(
    package_bytes: bytes,
    slide_part: str,
    slot_shape_ids: set[str],
) -> dict[str, Any]:
    root = ET.fromstring(_read_package_part(package_bytes, slide_part))
    shapes: list[dict[str, Any]] = []
    for z_index, element in enumerate(_shape_elements(root)):
        shape_id = _shape_id(element)
        if not shape_id or shape_id in slot_shape_ids:
            continue
        shapes.append(
            {
                "shapeId": shape_id,
                "geometry": {
                    "transform": _shape_transform(element),
                    "zIndex": z_index,
                },
                "style": _locked_style_sha256(element),
            }
        )
    return {"shapes": shapes}


def _read_package_part(package_bytes: bytes, part: str) -> bytes:
    try:
        with zipfile.ZipFile(BytesIO(package_bytes), "r") as package:
            return package.read(part)
    except (KeyError, OSError, zipfile.BadZipFile) as error:
        raise PrivateGenerationRuntimeError(
            "OOXML_REFERENCE_PACKAGE_VALIDATION_FAILED",
            "fidelity package part cannot be read",
        ) from error


def _shape_elements(root: ET.Element) -> list[ET.Element]:
    sp_tree = next(
        (element for element in root.iter() if _local_name(element.tag) == "spTree"),
        None,
    )
    if sp_tree is None:
        return []
    return [
        child
        for child in list(sp_tree)
        if _shape_id(child) is not None
        and _local_name(child.tag) not in {"nvGrpSpPr", "grpSpPr"}
    ]


def _shape_id(element: ET.Element) -> str | None:
    for child in element.iter():
        if _local_name(child.tag) == "cNvPr" and child.get("id"):
            return child.get("id")
    return None


def _shape_transform(element: ET.Element) -> tuple[int, int, int, int] | None:
    for transform in element.iter():
        if _local_name(transform.tag) != "xfrm":
            continue
        offset = next(
            (child for child in transform if _local_name(child.tag) == "off"),
            None,
        )
        extent = next(
            (child for child in transform if _local_name(child.tag) == "ext"),
            None,
        )
        if offset is None or extent is None:
            continue
        try:
            return (
                int(offset.attrib["x"]),
                int(offset.attrib["y"]),
                int(extent.attrib["cx"]),
                int(extent.attrib["cy"]),
            )
        except (KeyError, ValueError):
            return None
    return None


def _locked_style_sha256(element: ET.Element) -> str:
    clone = ET.fromstring(ET.tostring(element, encoding="utf-8"))
    for parent in clone.iter():
        for child in list(parent):
            if _local_name(child.tag) in {"txBody", "xfrm"}:
                parent.remove(child)
    return _sha256(ET.tostring(clone, encoding="utf-8"))


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _manifest_sha256(loaded: LoadedReferenceTemplate) -> str:
    content = json.dumps(
        loaded.manifest.model_dump(by_alias=True, mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return _sha256(content)


def _libreoffice_render_environment() -> Mapping[str, Any]:
    office = shutil.which("libreoffice") or shutil.which("soffice")
    font_match = shutil.which("fc-match")
    if office is None or font_match is None:
        raise RuntimeError("LibreOffice and fontconfig are required")
    office_result = subprocess.run(
        [office, "--version"],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    font_result = subprocess.run(
        [font_match, "sans-serif", "--format", "%{family}\n%{file}\n"],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    lines = [line.strip() for line in font_result.stdout.splitlines() if line.strip()]
    if len(lines) < 2:
        raise RuntimeError("resolved font metadata is incomplete")
    font_path = Path(lines[1])
    return {
        "renderer": "libreoffice-pdf-pymupdf",
        "rendererVersion": office_result.stdout.strip(),
        "fontFiles": [
            {
                "family": lines[0],
                "role": "body",
                "sha256": _sha256(font_path.read_bytes()),
            }
        ],
    }


def _font_families() -> set[str]:
    executable = shutil.which("fc-list")
    if executable is None:
        return set()
    try:
        result = subprocess.run(
            [executable, ":", "--format", "%{family}\n"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return set()
    return {
        family.strip()
        for line in result.stdout.splitlines()
        for family in line.split(",")
        if family.strip()
    }


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _error_code(error: Exception) -> str:
    response = getattr(error, "response", None)
    if not isinstance(response, Mapping):
        return ""
    value = response.get("Error")
    if not isinstance(value, Mapping):
        return ""
    return str(value.get("Code", ""))


def _is_missing_object(error: Exception) -> bool:
    return _error_code(error) in {"404", "NoSuchKey", "NotFound"}


def _is_precondition_failure(error: Exception) -> bool:
    return _error_code(error) in {
        "409",
        "412",
        "ConditionalRequestConflict",
        "PreconditionFailed",
    }
