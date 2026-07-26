import type {
  Deck,
  DeckCanvas,
  DeckElement,
  ImageElementProps,
  Slide,
} from "@orbit/shared/deck";
import type { CSSProperties } from "react";

import { resolveEditorAssetUrl } from "../../shared/editorAssetUrl";

const defaultEditorStageScale = 0.44;
const maximumEditorStageScale = 1;
const compactEditorBreakpoint = 760;
const compactEditorCanvasInset = 32;
const fittedEditorCanvasHorizontalInset = 48;
const fittedEditorCanvasVerticalInset = 96;

export const minimumEditorStageScale = 0.1;
export const maximumManualEditorStageScale = 2;
export const editorStageScaleStep = 0.05;

export const defaultImageInsertFrame = {
  height: 240,
  width: 420,
  x: 260,
  y: 220
};

export function getResponsiveEditorStageScale(
  canvasWidth: number,
  viewportWidth: number | null,
  canvasHeight?: number,
  viewportHeight?: number | null
) {
  if (
    viewportWidth &&
    viewportHeight &&
    canvasWidth > 0 &&
    canvasHeight &&
    canvasHeight > 0
  ) {
    const availableWidth = Math.max(
      0,
      viewportWidth - fittedEditorCanvasHorizontalInset
    );
    const availableHeight = Math.max(
      0,
      viewportHeight - fittedEditorCanvasVerticalInset
    );

    return Math.min(
      maximumEditorStageScale,
      Math.max(
        0.16,
        Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight)
      )
    );
  }

  if (!viewportWidth || viewportWidth > compactEditorBreakpoint || canvasWidth <= 0) {
    return defaultEditorStageScale;
  }

  const availableWidth = Math.max(0, viewportWidth - compactEditorCanvasInset);
  return Math.min(
    defaultEditorStageScale,
    Math.max(0.16, availableWidth / canvasWidth)
  );
}

export function clampEditorStageScale(scale: number) {
  return Math.min(
    maximumManualEditorStageScale,
    Math.max(minimumEditorStageScale, scale)
  );
}

export function getNextEditorStageScale(
  scale: number,
  direction: "in" | "out"
) {
  const delta = direction === "in" ? editorStageScaleStep : -editorStageScaleStep;
  return clampEditorStageScale(Math.round((scale + delta) * 100) / 100);
}

export function buildSlideThumbBackground(
  slide: Slide,
  deck: Deck,
  cachedUrl?: string
) {
  const background = slide.style.backgroundColor ?? deck.theme.backgroundColor;

  if (slide.importRenderMode === "snapshot" && slide.thumbnailUrl) {
    return `url("${resolveEditorAssetUrl(slide.thumbnailUrl)}") center / contain no-repeat, ${background}`;
  }

  if (cachedUrl) {
    return `url("${cachedUrl}") center / contain no-repeat, ${background}`;
  }

  if (!slide.importRenderMode && slide.thumbnailUrl) {
    return `url("${resolveEditorAssetUrl(slide.thumbnailUrl)}") center / contain no-repeat, ${background}`;
  }

  const backgroundImage = slide.style.backgroundImage;

  if (!backgroundImage?.src) {
    return background;
  }

  const size = getSlideBackgroundSize(backgroundImage.fit);
  const overlayOpacity = clampBackgroundOverlayOpacity(backgroundImage.opacity);

  return [
    `linear-gradient(rgba(255,255,255,${overlayOpacity}), rgba(255,255,255,${overlayOpacity}))`,
    `url("${resolveEditorAssetUrl(backgroundImage.src)}") center / ${size} no-repeat`,
    background
  ].join(",");
}

export function buildSlideBackgroundStyle(slide: Slide, deck: Deck): CSSProperties {
  const backgroundColor = slide.style.backgroundColor ?? deck.theme.backgroundColor;
  if (slide.importRenderMode === "snapshot" && slide.thumbnailUrl) {
    return {
      backgroundColor,
      backgroundImage: `url("${resolveEditorAssetUrl(slide.thumbnailUrl)}")`,
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundSize: "100% 100%",
      borderRadius: 0
    };
  }
  const backgroundImage = slide.style.backgroundImage;

  if (!backgroundImage?.src) {
    return { backgroundColor, borderRadius: 0 };
  }

  const size = getSlideBackgroundSize(backgroundImage.fit);
  const overlayOpacity = clampBackgroundOverlayOpacity(backgroundImage.opacity);

  return {
    backgroundColor,
    backgroundImage: `linear-gradient(rgba(255,255,255,${overlayOpacity}), rgba(255,255,255,${overlayOpacity})), url("${resolveEditorAssetUrl(backgroundImage.src)}")`,
    backgroundPosition: "center, center",
    backgroundRepeat: "no-repeat, no-repeat",
    backgroundSize: `100% 100%, ${size}`,
    borderRadius: 0
  };
}

function getSlideBackgroundSize(
  fit: NonNullable<Slide["style"]["backgroundImage"]>["fit"]
) {
  return fit === "stretch" ? "100% 100%" : fit;
}

export function clampBackgroundOverlayOpacity(opacity: number) {
  return Math.max(0, Math.min(1, 1 - opacity));
}

export function getTextAutoFitMaxWidth(
  canvas: DeckCanvas,
  element: Extract<DeckElement, { type: "text" }>
) {
  return Math.max(element.width, canvas.width - 96);
}

export function getCenteredTextAutoFitFrame(
  canvas: DeckCanvas,
  element: Extract<DeckElement, { type: "text" }>,
  width: number
) {
  const maxWidth = getTextAutoFitMaxWidth(canvas, element);
  const nextWidth = Math.min(Math.max(element.width, width), maxWidth);
  const centerX = element.x + element.width / 2;
  const minX = 48;
  const maxX = Math.max(minX, canvas.width - minX - nextWidth);

  return {
    x: Math.min(maxX, Math.max(minX, centerX - nextWidth / 2)),
    width: nextWidth
  };
}

export function getSingleLineTextMinimumFontSize(
  element: Extract<DeckElement, { type: "text" }>
) {
  if (element.role === "title") return 32;
  if (element.role === "subtitle") return 24;
  return 20;
}

export function getNextElementZIndex(elements: DeckElement[]) {
  return (
    elements.reduce(
      (currentMaxZIndex, element) => Math.max(currentMaxZIndex, element.zIndex),
      0
    ) + 1
  );
}

export function getGroupedChildPreviewFrame(args: {
  childElement: DeckElement;
  currentGroupFrame: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
  previewGroupFrame: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
}) {
  const { childElement, currentGroupFrame, previewGroupFrame } = args;
  const scaleX = previewGroupFrame.width / Math.max(1, currentGroupFrame.width);
  const scaleY = previewGroupFrame.height / Math.max(1, currentGroupFrame.height);

  return {
    height: Math.max(1, childElement.height * scaleY),
    rotation: childElement.rotation - currentGroupFrame.rotation,
    width: Math.max(1, childElement.width * scaleX),
    x: (childElement.x - currentGroupFrame.x) * scaleX,
    y: (childElement.y - currentGroupFrame.y) * scaleY
  };
}

export function getContextMenuPosition(args: {
  clientX: number;
  clientY: number;
  width: number;
  height: number;
}) {
  const viewportPadding = 12;

  return {
    left: Math.min(
      Math.max(viewportPadding, args.clientX),
      Math.max(viewportPadding, window.innerWidth - args.width - viewportPadding)
    ),
    top: Math.min(
      Math.max(viewportPadding, args.clientY),
      Math.max(viewportPadding, window.innerHeight - args.height - viewportPadding)
    )
  };
}

export function getDefaultImageInsertFrame(
  canvas: DeckCanvas,
  imageSize: { height: number; width: number }
) {
  const safeWidth = Math.max(1, imageSize.width || defaultImageInsertFrame.width);
  const safeHeight = Math.max(1, imageSize.height || defaultImageInsertFrame.height);
  const scale = Math.min(520 / safeWidth, 320 / safeHeight, 1);
  const width = Math.max(140, Math.round(safeWidth * scale));
  const height = Math.max(96, Math.round(safeHeight * scale));

  return {
    height,
    width,
    x: Math.max(40, Math.round((canvas.width - width) / 2)),
    y: Math.max(40, Math.round((canvas.height - height) / 2))
  };
}

export function getImageElementLayout(args: {
  fit: ImageElementProps["fit"];
  frameHeight: number;
  frameWidth: number;
  imageHeight: number;
  imageWidth: number;
}) {
  const { fit, frameHeight, frameWidth, imageHeight, imageWidth } = args;

  if (fit === "stretch") {
    return { crop: undefined, height: frameHeight, width: frameWidth, x: 0, y: 0 };
  }

  if (fit === "contain") {
    const scale = Math.min(frameWidth / imageWidth, frameHeight / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    return {
      crop: undefined,
      height,
      width,
      x: (frameWidth - width) / 2,
      y: (frameHeight - height) / 2
    };
  }

  const frameRatio = frameWidth / frameHeight;
  const imageRatio = imageWidth / imageHeight;

  if (imageRatio > frameRatio) {
    const cropWidth = imageHeight * frameRatio;
    return {
      crop: {
        height: imageHeight,
        width: cropWidth,
        x: (imageWidth - cropWidth) / 2,
        y: 0
      },
      height: frameHeight,
      width: frameWidth,
      x: 0,
      y: 0
    };
  }

  const cropHeight = imageWidth / frameRatio;
  return {
    crop: {
      height: cropHeight,
      width: imageWidth,
      x: 0,
      y: (imageHeight - cropHeight) / 2
    },
    height: frameHeight,
    width: frameWidth,
    x: 0,
    y: 0
  };
}
