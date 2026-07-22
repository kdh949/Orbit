from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.ai.ooxml_reference_templates.fidelity import (  # noqa: E402
    FidelityEvaluationError,
    canonical_fidelity_report_sha256,
    evaluate_ooxml_reference_fidelity,
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate a private OOXML reference fidelity input manifest"
    )
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        payload = json.loads(args.input.read_text(encoding="utf-8"))
        report = evaluate_ooxml_reference_fidelity(**payload)
        report["reportSha256"] = canonical_fidelity_report_sha256(report)
        serialized = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    except (OSError, TypeError, json.JSONDecodeError, FidelityEvaluationError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
