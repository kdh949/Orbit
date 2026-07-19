from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
FONT_CHECK_PATH = (
    REPOSITORY_ROOT / "packages/font-assets/scripts/check_worker_fonts.py"
)


def load_font_check_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_worker_fonts", FONT_CHECK_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("font check module could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_worker_font_manifest_contains_fifteen_families() -> None:
    module = load_font_check_module()
    fonts = module.load_manifest(
        REPOSITORY_ROOT / "packages/font-assets/assets/manifest.json"
    )

    assert len(fonts) == 15
    assert module.normalize_font_name("Noto Serif KR") == "notoserifkr"
