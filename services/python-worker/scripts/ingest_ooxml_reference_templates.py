from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from pydantic import ValidationError

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.ai.ooxml_reference_templates.inventory import (  # noqa: E402
    InventoryValidationError,
    ReferenceSource,
    build_reference_inventory,
)
from app.ai.ooxml_reference_templates.registry import (  # noqa: E402
    IngestionResult,
    LocalDirectoryObjectStorage,
    ObjectStorage,
    RepositoryCatalog,
    RegistryError,
    ingest_reference_template,
    load_repository_catalog,
)
from app.ai.ooxml_reference_templates.models import (  # noqa: E402
    OoxmlReferenceTemplateManifest,
)
from app.ai.ooxml_reference_templates.catalog_storage_writer import (  # noqa: E402
    build_s3_immutable_catalog_writer,
)


DEFAULT_CATALOG = (
    SERVICE_ROOT
    / "app/ai/design_library/ooxml-reference-templates/catalog.json"
)


def parse_source(value: str) -> ReferenceSource:
    template_id, separator, raw_path = value.partition("=")
    if not separator or not template_id or not raw_path:
        raise argparse.ArgumentTypeError(
            "source must use template-id=/path/reference.pptx"
        )
    return ReferenceSource(template_id=template_id, path=Path(raw_path))


@dataclass(frozen=True)
class PrivateCatalogInput:
    template_id: str
    path: Path


def parse_private_input(value: str) -> PrivateCatalogInput:
    template_id, separator, raw_path = value.partition("=")
    if not separator or not template_id or not raw_path:
        raise argparse.ArgumentTypeError(
            "private input must use template-id=/path/input"
        )
    return PrivateCatalogInput(template_id=template_id, path=Path(raw_path))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate private OOXML reference catalog ingestion inputs"
    )
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--source", action="append", type=parse_source, required=True)
    parser.add_argument("--manifest", action="append", type=parse_private_input)
    parser.add_argument(
        "--cover-preview",
        action="append",
        type=parse_private_input,
    )
    parser.add_argument(
        "--body-preview",
        action="append",
        type=parse_private_input,
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    if args.apply and not all(
        (args.manifest, args.cover_preview, args.body_preview)
    ):
        parser.error(
            "--apply requires --manifest, --cover-preview and --body-preview"
        )
    return args


def build_dry_run_report(
    catalog: RepositoryCatalog,
    inventory: dict[str, object],
) -> dict[str, object]:
    blockers = sorted(
        {
            blocker
            for template in catalog.templates
            for blocker in template.activation_blockers
        }
    )
    return {
        "schemaVersion": 1,
        "catalogSchemaVersion": catalog.schema_version,
        "dryRun": True,
        "sourceCount": inventory["sourceCount"],
        "slideCount": inventory["slideCount"],
        "approvalSummary": {
            "sourceAuthorizationApproved": all(
                template.provenance.authorization_status == "approved"
                for template in catalog.templates
            ),
            "annotationReviewApproved": all(
                template.annotation_review.status == "approved"
                for template in catalog.templates
            ),
            "reviewedSlideCount": sum(
                template.annotation_review.slide_count
                for template in catalog.templates
            ),
            "reviewedTextSlotCount": sum(
                template.annotation_review.slot_count
                for template in catalog.templates
            ),
        },
        "privateManagedStorageConfigured": False,
        "readyForPrivateIngestion": False,
        "blockerCodes": blockers,
        "templates": [
            {
                "templateId": template.template_id,
                "version": template.version,
                "sourceSha256": template.source_sha256,
                "slideCount": template.slide_count,
                "status": template.status,
                "authorizationStatus": template.provenance.authorization_status,
                "annotationReview": {
                    "status": template.annotation_review.status,
                    "reviewedOn": template.annotation_review.reviewed_on.isoformat(),
                    "slideCount": template.annotation_review.slide_count,
                    "slotCount": template.annotation_review.slot_count,
                    "contentTypes": template.annotation_review.content_types,
                },
                "activationBlockers": template.activation_blockers,
            }
            for template in catalog.templates
        ],
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        catalog = load_repository_catalog(args.catalog)
        inventory = build_reference_inventory(
            args.source,
            expected_slide_counts={
                template.template_id: template.slide_count
                for template in catalog.templates
            },
        )
        inventory_by_id = {
            source["templateId"]: source for source in inventory["sources"]
        }
        for template in catalog.templates:
            source = inventory_by_id.get(template.template_id)
            if (
                source is None
                or source["sha256"] != template.source_sha256
                or source["slideCount"] != template.slide_count
            ):
                raise RegistryError(
                    "REPOSITORY_CATALOG_DRIFT",
                    f"{template.template_id} does not match bounded source inventory",
                )
        if args.dry_run:
            report = build_dry_run_report(catalog, inventory)
        else:
            assert args.manifest is not None
            assert args.cover_preview is not None
            assert args.body_preview is not None
            inputs = _load_apply_inputs(
                catalog,
                args.source,
                args.manifest,
                args.cover_preview,
                args.body_preview,
            )
            _validate_all_before_remote_write(inputs)
            results = _apply_inputs(
                build_s3_immutable_catalog_writer(),
                inputs,
            )
            report = _build_apply_report(inventory, results)
    except (InventoryValidationError, RegistryError) as error:
        print(str(error), file=sys.stderr)
        return 1

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


@dataclass(frozen=True)
class ValidatedIngestionInput:
    manifest: OoxmlReferenceTemplateManifest
    source_path: Path
    cover_preview_path: Path
    body_preview_path: Path


def _load_apply_inputs(
    catalog: RepositoryCatalog,
    sources: list[ReferenceSource],
    manifests: list[PrivateCatalogInput],
    cover_previews: list[PrivateCatalogInput],
    body_previews: list[PrivateCatalogInput],
) -> list[ValidatedIngestionInput]:
    expected_ids = {template.template_id for template in catalog.templates}
    source_by_id = _unique_paths(sources, expected_ids, "source")
    manifest_by_id = _unique_paths(manifests, expected_ids, "manifest")
    cover_by_id = _unique_paths(cover_previews, expected_ids, "cover preview")
    body_by_id = _unique_paths(body_previews, expected_ids, "body preview")
    catalog_by_id = {
        template.template_id: template for template in catalog.templates
    }
    validated: list[ValidatedIngestionInput] = []
    for template_id in sorted(expected_ids):
        manifest = _read_strict_manifest(manifest_by_id[template_id])
        template = catalog_by_id[template_id]
        if (
            manifest.template_id != template.template_id
            or manifest.version != template.version
            or manifest.source_sha256 != template.source_sha256
            or manifest.slide_count != template.slide_count
            or manifest.preview.cover_preview_id
            != template.preview.cover_preview_id
            or manifest.preview.body_preview_id != template.preview.body_preview_id
            or manifest.provenance.authorization_status != "approved"
            or manifest.status != "active"
        ):
            raise RegistryError(
                "PRIVATE_MANIFEST_CATALOG_MISMATCH",
                f"{template_id} private manifest does not match approved catalog metadata",
            )
        if (
            template.preview.cover_preview_sha256 is not None
            and template.preview.cover_preview_sha256
            != manifest.preview.cover_preview_sha256
        ) or (
            template.preview.body_preview_sha256 is not None
            and template.preview.body_preview_sha256
            != manifest.preview.body_preview_sha256
        ):
            raise RegistryError(
                "PRIVATE_MANIFEST_CATALOG_MISMATCH",
                f"{template_id} preview checksum does not match catalog metadata",
            )
        validated.append(
            ValidatedIngestionInput(
                manifest=manifest,
                source_path=source_by_id[template_id],
                cover_preview_path=cover_by_id[template_id],
                body_preview_path=body_by_id[template_id],
            )
        )
    return validated


def _validate_all_before_remote_write(
    inputs: list[ValidatedIngestionInput],
) -> None:
    with TemporaryDirectory(prefix="orbit-ooxml-ingestion-preflight-") as root:
        storage = LocalDirectoryObjectStorage(Path(root))
        for value in inputs:
            ingest_reference_template(
                storage,
                value.manifest,
                value.source_path,
                value.cover_preview_path,
                value.body_preview_path,
            )


def _apply_inputs(
    storage: ObjectStorage,
    inputs: list[ValidatedIngestionInput],
) -> list[IngestionResult]:
    return [
        ingest_reference_template(
            storage,
            value.manifest,
            value.source_path,
            value.cover_preview_path,
            value.body_preview_path,
        )
        for value in inputs
    ]


def _build_apply_report(
    inventory: dict[str, object],
    results: list[IngestionResult],
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "dryRun": False,
        "sourceCount": inventory["sourceCount"],
        "slideCount": inventory["slideCount"],
        "privateManagedStorageConfigured": True,
        "ingestionApplied": True,
        "createdObjectCount": sum(
            result.created_object_count for result in results
        ),
        "templates": [
            {
                "templateId": result.template_id,
                "version": result.version,
                "manifestSha256": result.manifest_sha256,
                "createdObjectCount": result.created_object_count,
            }
            for result in results
        ],
    }


def _unique_paths(
    values: list[ReferenceSource] | list[PrivateCatalogInput],
    expected_ids: set[str],
    label: str,
) -> dict[str, Path]:
    mapped = {value.template_id: value.path for value in values}
    if len(mapped) != len(values) or set(mapped) != expected_ids:
        raise RegistryError(
            "PRIVATE_INGESTION_INPUT_SET_INVALID",
            f"{label} identities must exactly match catalog identities",
        )
    return mapped


def _read_strict_manifest(path: Path) -> OoxmlReferenceTemplateManifest:
    try:
        content = path.read_bytes()
        return OoxmlReferenceTemplateManifest.model_validate_json(content)
    except (OSError, ValidationError) as error:
        raise RegistryError(
            "PRIVATE_MANIFEST_INVALID",
            "private manifest cannot be read or is not strict",
        ) from error


if __name__ == "__main__":
    raise SystemExit(main())
