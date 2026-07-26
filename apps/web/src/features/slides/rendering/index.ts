export {
  ReadOnlySlideCanvas,
  type SlideRuntimeHighlight
} from "./ReadOnlySlideCanvas";
export type { ElementPresentationState } from "../../../runtime/presentation/slideshow/elementPresentationState";
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
  diagnoseImportedDeckFonts,
  type ImportedFontAvailabilityDiagnostic
} from "./fontAvailability";
export {
  getRenderableSlideElements,
  normalizeRenderableElement,
  usesSourceSlideSnapshot
} from "../../../runtime/presentation/slideshow/elementNormalization";
export {
  clearProjectSlideImageCache,
  collectSlideAssetUrls,
  getReadySlideImage,
  loadSlideImage,
  preloadSlideAssets,
  prepareSlideAssets,
  retainSlideAssetWindow,
  type SlideAssetPreparationResult,
  type SlideImagePriority
} from "./slideImageCache";
