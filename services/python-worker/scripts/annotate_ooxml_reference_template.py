from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.ai.ooxml_reference_templates.annotation import (  # noqa: E402
    AnnotationValidationError,
    build_image_slot_candidate_report,
    build_source_slide_catalog,
    render_source_slide_montage,
    validate_source_slide_annotations,
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate an OOXML source-slide annotation for human review"
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--catalog-output", type=Path)
    parser.add_argument("--image-slot-candidate-output", type=Path)
    parser.add_argument("--preview-directory", type=Path)
    parser.add_argument("--montage-output", type=Path)
    parser.add_argument("--target-slide-count", type=int, default=10)
    args = parser.parse_args(argv)
    if (args.preview_directory is None) != (args.montage_output is None):
        parser.error(
            "--preview-directory and --montage-output must be provided together"
        )
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        manifest_value = json.loads(args.manifest.read_text(encoding="utf-8"))
        manifest = validate_source_slide_annotations(args.source, manifest_value)
        catalog = (
            build_source_slide_catalog(
                manifest, target_slide_count=args.target_slide_count
            )
            if (
                args.catalog_output is not None
                or args.image_slot_candidate_output is None
                or args.preview_directory is not None
            )
            else None
        )
        image_slot_candidate_report = (
            build_image_slot_candidate_report(args.source, manifest)
            if args.image_slot_candidate_output is not None
            else None
        )
        if args.preview_directory is not None and args.montage_output is not None:
            assert catalog is not None
            render_source_slide_montage(
                catalog, args.preview_directory, args.montage_output
            )
    except (OSError, json.JSONDecodeError, AnnotationValidationError) as error:
        print(str(error), file=sys.stderr)
        return 1

    if catalog is not None:
        serialized = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
        if args.catalog_output is None:
            print(serialized, end="")
        else:
            args.catalog_output.parent.mkdir(parents=True, exist_ok=True)
            args.catalog_output.write_text(serialized, encoding="utf-8")
    if (
        args.image_slot_candidate_output is not None
        and image_slot_candidate_report is not None
    ):
        args.image_slot_candidate_output.parent.mkdir(parents=True, exist_ok=True)
        args.image_slot_candidate_output.write_text(
            json.dumps(
                image_slot_candidate_report,
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
