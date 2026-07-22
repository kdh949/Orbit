from __future__ import annotations

from typing import Protocol

from app.ai.ooxml_reference_templates.options import (
    OoxmlReferenceTemplateOptionsResponse,
)


class OoxmlReferenceTemplateCatalogRuntime(Protocol):
    def list_options(self) -> OoxmlReferenceTemplateOptionsResponse: ...

    def read_preview(
        self,
        template_id: str,
        version: int,
        asset_id: str,
    ) -> bytes: ...


class CatalogPreviewNotFoundError(LookupError):
    pass


class UnconfiguredOoxmlReferenceTemplateCatalogRuntime:
    """Fail-closed default until private managed storage is configured."""

    def list_options(self) -> OoxmlReferenceTemplateOptionsResponse:
        return OoxmlReferenceTemplateOptionsResponse(options=[])

    def read_preview(
        self,
        template_id: str,
        version: int,
        asset_id: str,
    ) -> bytes:
        del template_id, version, asset_id
        raise CatalogPreviewNotFoundError


def require_png_preview(content: bytes) -> bytes:
    if (
        len(content) < 8
        or len(content) > 10_485_760
        or not content.startswith(b"\x89PNG\r\n\x1a\n")
    ):
        raise CatalogPreviewNotFoundError
    return content
