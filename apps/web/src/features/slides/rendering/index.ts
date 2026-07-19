export {
  ReadOnlySlideCanvas,
  type ElementPresentationState,
  type SlideRuntimeHighlight
} from "./ReadOnlySlideCanvas";
export {
  SlideBackground,
  buildSlideBackgroundStyle,
  clampBackgroundOverlayOpacity,
  getSlideBackgroundSize
} from "./SlideBackground";
export {
  ElementNodeContent,
  verticalAxisTitleText,
  type SlideElementFrame,
} from "./elementRendering";
export { getActiveHighlightElementIds, HighlightOverlay } from "./highlightOverlay";
export { getHighlightOverlayElements } from "./highlightOverlayElements";
export {
  getRenderableSlideElements,
  normalizeRenderableElement
} from "./elementNormalization";
