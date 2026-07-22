from __future__ import annotations

from fastapi.testclient import TestClient

from app.ai.deck_generation.design_pack_options import (
    DesignPackOptionsRequest,
    generate_design_pack_options,
)
from app.ai.deck_generation.design_pack_registry import load_design_pack_catalog
from app.ai.deck_generation.design_pack_selector import DESIGN_PACK_DIRECTORY
from app.main import app


def test_returns_at_most_three_versioned_approved_candidates() -> None:
    response = generate_design_pack_options(
        DesignPackOptionsRequest(
            topic="신규 프로젝트 킥오프와 역할 정렬",
            purpose="inform",
            slideCount=8,
            mediaPolicy="minimal",
        )
    )

    assert 1 <= len(response.options) <= 3
    assert response.options[0].id == "kickoff-alignment"
    assert all(option.version >= 1 for option in response.options)
    assert all(option.preview.manifest_id for option in response.options)


def test_disabled_pack_is_not_returned() -> None:
    registry = load_design_pack_catalog(DESIGN_PACK_DIRECTORY)
    disabled = registry.model_copy(
        update={
            "packs": [
                pack.model_copy(update={"status": "disabled"})
                if pack.id == "executive-review"
                else pack
                for pack in registry.packs
            ]
        }
    )
    response = generate_design_pack_options(
        DesignPackOptionsRequest(
            topic="분기 경영 보고",
            purpose="report",
            profile="executive-report",
        ),
        registry=disabled,
    )

    assert all(option.id != "executive-review" for option in response.options)


def test_provider_failure_uses_deterministic_shortlist() -> None:
    request = DesignPackOptionsRequest(
        topic="시장 동향 인사이트",
        purpose="inform",
        profile="editorial",
    )
    expected = generate_design_pack_options(request)

    def unavailable(*_args):
        raise RuntimeError("provider unavailable")

    fallback = generate_design_pack_options(request, ranker=unavailable)

    assert fallback.fallback_used is True
    assert [option.id for option in fallback.options] == [
        option.id for option in expected.options
    ]


def test_internal_endpoint_uses_strict_request_and_alias_response() -> None:
    client = TestClient(app)
    response = client.post(
        "/internal/ai/deck-generation/design-pack-options",
        json={
            "topic": "시장 동향",
            "purpose": "inform",
            "profile": "editorial",
            "tone": "professional",
            "slideCount": 8,
            "mediaPolicy": "minimal",
        },
    )

    assert response.status_code == 200
    assert len(response.json()["options"]) == 3
    invalid = client.post(
        "/internal/ai/deck-generation/design-pack-options",
        json={"topic": "시장 동향", "unknown": True},
    )
    assert invalid.status_code == 422
