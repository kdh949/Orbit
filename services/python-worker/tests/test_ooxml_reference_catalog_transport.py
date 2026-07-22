from __future__ import annotations

from fastapi.testclient import TestClient

from app.ai.ooxml_reference_templates.options import (
    OoxmlReferenceTemplateOptionsResponse,
)
from app.main import app


class CatalogRuntime:
    def list_options(self) -> OoxmlReferenceTemplateOptionsResponse:
        return OoxmlReferenceTemplateOptionsResponse.model_validate(
            {
                "options": [
                    {
                        "templateId": "operating-review",
                        "version": 1,
                        "name": "Operating Review",
                        "description": "운영 지표와 실행 과제 보고",
                        "preview": {
                            "coverAssetId": "cover",
                            "bodyAssetId": "body",
                        },
                        "editableRanges": [
                            {
                                "contentType": "text",
                                "mutationPolicy": "text-content",
                                "slotCount": 4,
                            }
                        ],
                    }
                ]
            }
        )

    def read_preview(
        self,
        template_id: str,
        version: int,
        asset_id: str,
    ) -> bytes:
        assert (template_id, version, asset_id) == (
            "operating-review",
            1,
            "cover",
        )
        return b"\x89PNG\r\n\x1a\nfixture"


def test_unconfigured_catalog_is_empty_and_preview_is_not_found() -> None:
    if hasattr(app.state, "ooxml_reference_template_catalog"):
        del app.state.ooxml_reference_template_catalog
    client = TestClient(app)

    assert client.get("/internal/ai/ooxml-reference-templates/options").json() == {
        "options": []
    }
    assert (
        client.get(
            "/internal/ai/ooxml-reference-templates/operating-review/versions/1/previews/cover"
        ).status_code
        == 404
    )


def test_catalog_runtime_exposes_only_projection_and_png_bytes() -> None:
    app.state.ooxml_reference_template_catalog = CatalogRuntime()
    try:
        client = TestClient(app)
        options = client.get("/internal/ai/ooxml-reference-templates/options")
        preview = client.get(
            "/internal/ai/ooxml-reference-templates/operating-review/versions/1/previews/cover"
        )

        assert options.status_code == 200
        assert options.json()["options"][0]["preview"] == {
            "coverAssetId": "cover",
            "bodyAssetId": "body",
        }
        assert preview.status_code == 200
        assert preview.headers["content-type"] == "image/png"
        assert preview.content.startswith(b"\x89PNG\r\n\x1a\n")
    finally:
        del app.state.ooxml_reference_template_catalog
