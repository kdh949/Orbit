import json
import logging
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

import app.main as api_module
from app.ai.pptx_ooxml_generation import PptxOoxmlSyncResult


PPTX_MIME_TYPE = (
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
)


@pytest.fixture
def captured_sync(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    captured: dict[str, Any] = {}

    def fake_sync(
        path: Path,
        *,
        template_blueprint: dict[str, Any],
        operations: list[dict[str, Any]],
        slide_motion: list[dict[str, Any]],
        deck_canvas: dict[str, Any],
        synced_deck_version: int,
        render: bool,
    ) -> PptxOoxmlSyncResult:
        captured.update(
            {
                "package": path.read_bytes(),
                "template_blueprint": template_blueprint,
                "operations": operations,
                "slide_motion": slide_motion,
                "deck_canvas": deck_canvas,
                "synced_deck_version": synced_deck_version,
                "render": render,
            }
        )
        return PptxOoxmlSyncResult()

    monkeypatch.setattr(api_module, "sync_pptx_ooxml", fake_sync)
    return captured


def test_large_json_file_parts_bypass_starlette_text_field_limit(
    captured_sync: dict[str, Any],
) -> None:
    large_blueprint_value = "b" * (1024 * 1024 + 32)
    large_operation_value = "o" * (1024 * 1024 + 32)

    response = post_sync(
        template_blueprint={"large": large_blueprint_value},
        operations=[{"type": "test", "large": large_operation_value}],
    )

    assert response.status_code == 200
    assert captured_sync["template_blueprint"] == {"large": large_blueprint_value}
    assert captured_sync["operations"] == [
        {"type": "test", "large": large_operation_value}
    ]


def test_small_legacy_text_fields_remain_compatible(
    captured_sync: dict[str, Any],
) -> None:
    response = TestClient(api_module.app).post(
        "/ai/pptx-ooxml-sync",
        files={"file": ("current.pptx", b"pptx", PPTX_MIME_TYPE)},
        data={
            "template_blueprint": json.dumps({"templateId": "template_a"}),
            "operations": "[]",
            "deck_canvas": json.dumps(deck_canvas()),
            "synced_deck_version": "2",
            "render": "false",
        },
    )

    assert response.status_code == 200
    assert captured_sync["package"] == b"pptx"
    assert captured_sync["synced_deck_version"] == 2
    assert captured_sync["render"] is False
    assert captured_sync["slide_motion"] == []


def test_slide_motion_json_uses_a_bounded_file_part(
    captured_sync: dict[str, Any],
) -> None:
    motion = [
        {
            "slideId": "slide_1",
            "sourceSlidePart": "ppt/slides/slide1.xml",
            "transition": {"type": "fade", "durationMs": 700},
            "animations": [],
            "capabilities": {
                "transitionWritable": True,
                "importedMainSequenceCoverage": "absent",
            },
            "touched": {"transition": True, "animations": False},
        }
    ]

    response = post_sync(slide_motion=motion)

    assert response.status_code == 200
    assert captured_sync["slide_motion"] == motion


def test_reorder_acknowledgment_omits_element_locator_nulls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_sync(*args: Any, **kwargs: Any) -> PptxOoxmlSyncResult:
        del args, kwargs
        return PptxOoxmlSyncResult(
            appliedOperations=[{"operationType": "reorder_slides"}],
        )

    monkeypatch.setattr(api_module, "sync_pptx_ooxml", fake_sync)

    response = post_sync(
        operations=[
            {
                "type": "reorder_slides",
                "slideOrders": [{"slideId": "slide_1", "order": 1}],
            }
        ],
    )

    assert response.status_code == 200
    assert response.json()["appliedOperations"] == [
        {"operationType": "reorder_slides"}
    ]


def test_json_file_part_over_explicit_limit_is_bounded(
    monkeypatch: pytest.MonkeyPatch,
    captured_sync: dict[str, Any],
) -> None:
    del captured_sync
    monkeypatch.setattr(api_module, "TEMPLATE_BLUEPRINT_MAX_BYTES", 128)

    response = post_sync(template_blueprint={"large": "x" * 256})

    assert response.status_code == 413
    assert response.json() == {
        "detail": {
            "code": "PPTX_OOXML_SYNC_PART_TOO_LARGE",
            "field": "template_blueprint",
            "maxBytes": 128,
        }
    }


@pytest.mark.parametrize(
    ("files_override", "expected_code", "expected_status"),
    [
        (
            {"operations_file": None},
            "PPTX_OOXML_SYNC_PART_MISSING",
            400,
        ),
        (
            {
                "operations_file": (
                    "operations.json",
                    b"not-json",
                    "application/json",
                )
            },
            "PPTX_OOXML_SYNC_JSON_INVALID",
            400,
        ),
        (
            {
                "operations_file": (
                    "operations.json",
                    b"[]",
                    "text/plain",
                )
            },
            "PPTX_OOXML_SYNC_PART_MIME_INVALID",
            415,
        ),
        (
            {
                "operations_file": (
                    "operations.json",
                    b"{}",
                    "application/json",
                )
            },
            "PPTX_OOXML_SYNC_JSON_SCHEMA_INVALID",
            400,
        ),
    ],
)
def test_invalid_json_parts_fail_closed(
    captured_sync: dict[str, Any],
    files_override: dict[str, tuple[str, bytes, str] | None],
    expected_code: str,
    expected_status: int,
) -> None:
    response = post_sync(files_override=files_override)

    assert response.status_code == expected_status
    assert response.json()["detail"] == {
        "code": expected_code,
        "field": "operations",
    }
    assert captured_sync == {}


def test_malformed_json_does_not_expose_payload_in_response_or_logs(
    captured_sync: dict[str, Any],
    caplog: pytest.LogCaptureFixture,
) -> None:
    private_payload = "private-blueprint-payload"
    caplog.set_level(logging.DEBUG)

    response = post_sync(
        files_override={
            "template_blueprint_file": (
                "template-blueprint.json",
                f'{{"private":"{private_payload}"'.encode(),
                "application/json",
            )
        }
    )

    assert response.status_code == 400
    assert private_payload not in response.text
    assert private_payload not in caplog.text
    assert captured_sync == {}


def post_sync(
    *,
    template_blueprint: dict[str, Any] | None = None,
    operations: list[dict[str, Any]] | None = None,
    slide_motion: list[dict[str, Any]] | None = None,
    files_override: dict[str, tuple[str, bytes, str] | None] | None = None,
) -> Any:
    files: dict[str, tuple[str, bytes, str]] = {
        "file": ("current.pptx", b"pptx", PPTX_MIME_TYPE),
        "template_blueprint_file": (
            "template-blueprint.json",
            json.dumps(template_blueprint or {"templateId": "template_a"}).encode(),
            "application/json",
        ),
        "operations_file": (
            "operations.json",
            json.dumps(operations if operations is not None else []).encode(),
            "application/json",
        ),
        "slide_motion_file": (
            "slide-motion.json",
            json.dumps(slide_motion if slide_motion is not None else []).encode(),
            "application/json",
        ),
        "deck_canvas_file": (
            "deck-canvas.json",
            json.dumps(deck_canvas()).encode(),
            "application/json",
        ),
    }
    for key, value in (files_override or {}).items():
        if value is None:
            files.pop(key, None)
        else:
            files[key] = value
    return TestClient(api_module.app).post(
        "/ai/pptx-ooxml-sync",
        files=files,
        data={"synced_deck_version": "2", "render": "false"},
    )


def deck_canvas() -> dict[str, str | int]:
    return {
        "preset": "wide-16-9",
        "width": 1920,
        "height": 1080,
        "aspectRatio": "16:9",
    }
