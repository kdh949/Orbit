import inspect

from app.ai import pptx_ooxml_generation as implementation
from app.ai.pptx import facade
from app.ai.pptx_ooxml import (
    common,
    import_capabilities,
    media,
    models,
    motion,
    notes,
    operations,
    orchestration,
    rendering,
    routing,
    shapes,
    text,
    validation,
)

EXPECTED_FACADE_EXPORTS = [
    "PptxImportPreference",
    "PptxOoxmlGenerationError",
    "PptxOoxmlGenerationResult",
    "PptxOoxmlSyncResult",
    "PptxRenderUnavailableError",
    "UnsupportedPptxAspectRatioError",
    "generate_pptx_ooxml",
    "sync_pptx_ooxml",
]


def test_pptx_facade_preserves_the_existing_public_contract() -> None:
    assert facade.__all__ == EXPECTED_FACADE_EXPORTS
    assert facade.PptxImportPreference is implementation.PptxImportPreference
    assert facade.generate_pptx_ooxml is implementation.generate_pptx_ooxml
    assert facade.sync_pptx_ooxml is implementation.sync_pptx_ooxml
    assert facade.PptxOoxmlGenerationError is implementation.PptxOoxmlGenerationError
    assert (
        facade.PptxRenderUnavailableError is implementation.PptxRenderUnavailableError
    )
    assert (
        facade.UnsupportedPptxAspectRatioError
        is implementation.UnsupportedPptxAspectRatioError
    )
    assert facade.PptxOoxmlGenerationResult is implementation.PptxOoxmlGenerationResult
    assert facade.PptxOoxmlSyncResult is implementation.PptxOoxmlSyncResult


def test_pptx_internal_capability_modules_remain_bounded() -> None:
    modules = [
        common,
        import_capabilities,
        media,
        models,
        motion,
        notes,
        operations,
        orchestration,
        rendering,
        routing,
        shapes,
        text,
        validation,
    ]

    assert all(len(inspect.getsource(module).splitlines()) <= 1_200 for module in modules)
