from __future__ import annotations

import argparse
from pathlib import Path

from app.ai.deck_generation.design_pack_evaluation import (
    evaluate_golden_briefs,
    load_golden_briefs,
    report_json,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate current and System Design Pack golden silhouettes."
    )
    parser.add_argument(
        "--fixtures",
        type=Path,
        default=Path("tests/fixtures/design-pack-golden"),
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = evaluate_golden_briefs(load_golden_briefs(args.fixtures))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(report_json(report), encoding="utf-8")
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
