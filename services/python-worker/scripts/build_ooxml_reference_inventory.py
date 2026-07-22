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


def parse_source(value: str) -> ReferenceSource:
    template_id, separator, raw_path = value.partition("=")
    if not separator or not template_id or not raw_path:
        raise argparse.ArgumentTypeError(
            "source must use template-id=/path/reference.pptx"
        )
    return ReferenceSource(template_id=template_id, path=Path(raw_path))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a bounded, security-preflighted OOXML reference inventory"
    )
    parser.add_argument(
        "--source",
        action="append",
        required=True,
        type=parse_source,
        help="Stable template ID and local read-only PPTX path",
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate all sources and print the bounded report without writing a file",
    )
    args = parser.parse_args(argv)
    if not args.dry_run and args.output is None:
        parser.error("--output is required unless --dry-run is used")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        report = build_reference_inventory(args.source)
    except InventoryValidationError as error:
        print(str(error), file=sys.stderr)
        return 1

    serialized = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.dry_run:
        print(serialized, end="")
    else:
        args.output.write_text(serialized, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
