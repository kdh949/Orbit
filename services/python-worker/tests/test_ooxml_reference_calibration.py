from __future__ import annotations

import hashlib
import json
from io import BytesIO
from typing import Any

import pytest

from app.ai.ooxml_reference_templates.calibration import (
    CALIBRATION_CONTENT_TYPE,
    CALIBRATION_OBJECT_KEY,
    PrivateFidelityCalibrationError,
    load_private_fidelity_calibration,
)
from app.ai.ooxml_reference_templates.fidelity import EXPECTED_TEMPLATE_IDS
from app.ai.ooxml_reference_templates.font_aliases import (
    approved_font_alias_policy,
)


class CalibrationClient:
    def __init__(self, content: bytes, *, declared_sha256: str | None = None) -> None:
        self.content = content
        self.declared_sha256 = declared_sha256 or hashlib.sha256(content).hexdigest()
        self.keys: list[str] = []

    def head_object(self, **kwargs: object) -> dict[str, object]:
        self.keys.append(str(kwargs["Key"]))
        return {
            "ContentLength": len(self.content),
            "ContentType": CALIBRATION_CONTENT_TYPE,
            "Metadata": {"sha256": self.declared_sha256},
        }

    def get_object(self, **kwargs: object) -> dict[str, object]:
        self.keys.append(str(kwargs["Key"]))
        return {"Body": BytesIO(self.content)}


def test_private_calibration_requires_exact_seven_template_renderer_baselines() -> None:
    content = _content(_calibration())
    client = CalibrationClient(content)

    calibration = load_private_fidelity_calibration(client, "private-bucket")

    assert calibration["status"] == "calibrated"
    assert len(calibration["identityBaselines"]) == 7
    assert client.keys == [CALIBRATION_OBJECT_KEY, CALIBRATION_OBJECT_KEY]


@pytest.mark.parametrize(
    "mutation",
    [
        lambda value: value.update({"geometryEdgeTolerancePx": 1}),
        lambda value: value["identityBaselines"].pop(),
        lambda value: value["identityBaselines"][0].update(
            {"rendererVersion": "different"}
        ),
        lambda value: value.update({"storageKey": "private/path"}),
        lambda value: value["fontAliasPolicy"]["aliases"][0].update(
            {"targetFamily": "Fallback"}
        ),
        lambda value: value.update(
            {"font_alias_policy": value.pop("fontAliasPolicy")}
        ),
        lambda value: value.update({"geometryEdgeTolerancePx": False}),
        lambda value: value["identityBaselines"][0].update({"version": True}),
    ],
)
def test_private_calibration_rejects_incomplete_or_unknown_contract(
    mutation: Any,
) -> None:
    value = _calibration()
    mutation(value)

    with pytest.raises(PrivateFidelityCalibrationError) as caught:
        load_private_fidelity_calibration(
            CalibrationClient(_content(value)),
            "private-bucket",
        )

    assert caught.value.code == "OOXML_REFERENCE_FIDELITY_CALIBRATION_INVALID"
    assert CALIBRATION_OBJECT_KEY not in str(caught.value)


def test_private_calibration_rejects_checksum_drift_without_exposing_locator() -> None:
    with pytest.raises(PrivateFidelityCalibrationError) as caught:
        load_private_fidelity_calibration(
            CalibrationClient(_content(_calibration()), declared_sha256="0" * 64),
            "private-bucket",
        )

    assert (
        caught.value.code
        == "OOXML_REFERENCE_FIDELITY_CALIBRATION_CHECKSUM_MISMATCH"
    )
    assert "system/" not in str(caught.value)


def _calibration() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "status": "calibrated",
        "lockedRegionSsimThreshold": 0.998,
        "geometryEdgeTolerancePx": 0,
        "rationale": "approved deterministic LibreOffice identity baselines",
        "fontAliasPolicy": approved_font_alias_policy().model_dump(
            by_alias=True,
            mode="json",
        ),
        "identityBaselines": [
            {
                "templateId": template_id,
                "version": 1,
                "renderer": "libreoffice-pdf-pymupdf",
                "rendererVersion": "26.8.0.0",
                "reportSha256": "0123456"[index] * 64,
            }
            for index, template_id in enumerate(sorted(EXPECTED_TEMPLATE_IDS))
        ],
    }


def _content(value: dict[str, Any]) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
