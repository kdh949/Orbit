from app.ai import pptx_ooxml_generation as implementation
from app.ai.pptx import facade


def test_pptx_facade_preserves_the_existing_public_contract() -> None:
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
