"""Stable public boundary for PPTX generation and synchronization."""

from app.ai.pptx.facade import (
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
