from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.ai.ooxml_reference_templates.clone import (  # noqa: E402
    CloneError,
    clone_source_slides,
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Clone selected source slide parts into a bounded OOXML package"
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--slide-part", action="append", required=True)
    parser.add_argument("--identity-control", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        result = clone_source_slides(
            args.source.read_bytes(),
            source_slide_parts=args.slide_part,
            identity_control=args.identity_control,
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(result.package_bytes)
    except (OSError, CloneError) as error:
        print(str(error), file=sys.stderr)
        return 1
    report = {
        "slideCount": len(result.clones),
        "identityControlSlideCount": result.identity_control_slide_count,
        "outputSha256": hashlib.sha256(result.package_bytes).hexdigest(),
        "packageValidationWarnings": [],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
