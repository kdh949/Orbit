from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.ai.ooxml_reference_templates.inventory import (  # noqa: E402
    InventoryValidationError,
    ReferenceSource,
    build_reference_inventory,
)
from app.ai.ooxml_reference_templates.registry import (  # noqa: E402
    RegistryError,
    load_repository_catalog,
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


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate private OOXML reference catalog ingestion inputs"
    )
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--source", action="append", type=parse_source, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if not args.dry_run:
        parser.error(
            "production ingestion is blocked: "
            "PRIVATE_MANAGED_STORAGE_ADAPTER_UNCONFIGURED"
        )
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        catalog = load_repository_catalog(args.catalog)
        inventory = build_reference_inventory(args.source)
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
    except (InventoryValidationError, RegistryError) as error:
        print(str(error), file=sys.stderr)
        return 1

    report = {
        "schemaVersion": 1,
        "dryRun": True,
        "sourceCount": inventory["sourceCount"],
        "slideCount": inventory["slideCount"],
        "privateManagedStorageConfigured": False,
        "readyForPrivateIngestion": False,
        "blockerCodes": [
            "SOURCE_AUTHORIZATION_PENDING",
            "SOURCE_SLIDE_ANNOTATION_MISSING",
            "COVER_BODY_PREVIEW_BASELINE_MISSING",
            "PRIVATE_MANAGED_STORAGE_ADAPTER_UNCONFIGURED",
        ],
        "templates": [
            {
                "templateId": template.template_id,
                "version": template.version,
                "sourceSha256": template.source_sha256,
                "slideCount": template.slide_count,
                "status": template.status,
            }
            for template in catalog.templates
        ],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
