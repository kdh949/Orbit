import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.ai.deck_generation.design_pack_registry import SystemDesignPackRegistry


FIXTURE = (
    Path(__file__).parents[3]
    / "packages/shared/src/deck/fixtures/system-design-pack-registry.json"
)


def registry_fixture() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_accepts_shared_versioned_catalog_fixture() -> None:
    registry = SystemDesignPackRegistry.model_validate(registry_fixture())

    assert registry.catalog_version == 1
    assert registry.packs[0].id == "neutral-light"


@pytest.mark.parametrize("mutation", ["unknown", "duplicate", "capacity", "license"])
def test_rejects_invalid_catalog(mutation: str) -> None:
    candidate = registry_fixture()
    if mutation == "unknown":
        candidate["arbitrary"] = True
    elif mutation == "duplicate":
        layouts = candidate["layouts"]
        assert isinstance(layouts, list)
        layouts.append(dict(layouts[0]))
    elif mutation == "capacity":
        layouts = candidate["layouts"]
        assert isinstance(layouts, list)
        layouts[0]["contentCapacity"] = {
            "titleMaxLines": 2,
            "messageMaxChars": 120,
            "itemMin": 4,
            "itemMax": 1,
        }
    else:
        packs = candidate["packs"]
        assert isinstance(packs, list)
        packs[0]["provenance"]["licenseStatus"] = "pending"

    with pytest.raises(ValidationError):
        SystemDesignPackRegistry.model_validate(candidate)
