"""Compatibility facade for the PPTX OOXML pipeline.

Transport code imports this module so the implementation can be split behind a
stable contract without changing endpoint models or exception mapping.
"""

from app.ai.pptx_ooxml_generation import (
    PptxImportPreference,
    PptxOoxmlGenerationError,
    PptxOoxmlGenerationResult,
    PptxOoxmlSyncResult,
    PptxRenderUnavailableError,
    UnsupportedPptxAspectRatioError,
    generate_pptx_ooxml,
    sync_pptx_ooxml,
)

__all__ = [
    "PptxImportPreference",
    "PptxOoxmlGenerationError",
    "PptxOoxmlGenerationResult",
    "PptxOoxmlSyncResult",
    "PptxRenderUnavailableError",
    "UnsupportedPptxAspectRatioError",
    "generate_pptx_ooxml",
    "sync_pptx_ooxml",
]
