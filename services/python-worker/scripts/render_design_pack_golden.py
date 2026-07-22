from __future__ import annotations

import argparse
from pathlib import Path

from app.ai.deck_generation.design_pack_artifacts import render_golden_artifacts
from app.ai.deck_generation.design_pack_evaluation import load_golden_briefs


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Render System Design Pack golden PPTX, slides, and montages."
    )
    parser.add_argument(
        "--fixtures",
        type=Path,
        default=Path("tests/fixtures/design-pack-golden"),
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    manifest = render_golden_artifacts(
        load_golden_briefs(args.fixtures),
        args.output_dir,
    )
    if not manifest["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
