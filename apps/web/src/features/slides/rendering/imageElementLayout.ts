import type { ImageElementProps } from "@orbit/shared/deck";

export type ImageCrop = NonNullable<ImageElementProps["crop"]>;

export type ImageElementLayout = {
  crop:
    | {
        height: number;
        width: number;
        x: number;
        y: number;
      }
    | undefined;
  height: number;
  width: number;
  x: number;
  y: number;
};

export const minimumImageCropVisibleFraction = 0.1;
export const minimumImageCropVisibleArea =
  minimumImageCropVisibleFraction * minimumImageCropVisibleFraction;

const cropBoundaryEpsilon = 1e-9;

export function normalizeImageCrop(
  crop: ImageElementProps["crop"] | null | undefined,
): ImageCrop {
  const horizontal = normalizeCropAxis(crop?.left, crop?.right);
  const vertical = normalizeCropAxis(crop?.top, crop?.bottom);

  return {
    left: horizontal.start,
    top: vertical.start,
    right: horizontal.end,
    bottom: vertical.end,
  };
}

export function normalizeInteractiveImageCrop(
  crop: ImageElementProps["crop"] | null | undefined,
): ImageCrop {
  const normalizedCrop = normalizeImageCrop(crop);
  const visibleWidth = getCropVisibleWidth(normalizedCrop);
  const visibleHeight = getCropVisibleHeight(normalizedCrop);
  const visibleArea = visibleWidth * visibleHeight;

  if (visibleArea >= minimumImageCropVisibleArea) {
    return normalizedCrop;
  }

  const maximumScale = Math.min(1 / visibleWidth, 1 / visibleHeight);
  const minimumAreaScale = Math.sqrt(minimumImageCropVisibleArea / visibleArea);

  return scaleImageCropAroundAnchor({
    anchorX: 0.5,
    anchorY: 0.5,
    crop: normalizedCrop,
    scale: Math.min(maximumScale, minimumAreaScale),
  });
}

export function panImageCrop(args: {
  crop: ImageElementProps["crop"] | null | undefined;
  deltaX: number;
  deltaY: number;
  frameHeight: number;
  frameWidth: number;
}): ImageCrop {
  const crop = normalizeInteractiveImageCrop(args.crop);
  const visibleWidth = 1 - crop.left - crop.right;
  const visibleHeight = 1 - crop.top - crop.bottom;
  const frameWidth = positiveFiniteOr(args.frameWidth, 1);
  const frameHeight = positiveFiniteOr(args.frameHeight, 1);
  const left = clamp(
    crop.left - (finiteOr(args.deltaX, 0) / frameWidth) * visibleWidth,
    0,
    1 - visibleWidth,
  );
  const top = clamp(
    crop.top - (finiteOr(args.deltaY, 0) / frameHeight) * visibleHeight,
    0,
    1 - visibleHeight,
  );

  return normalizeImageCrop({
    left,
    top,
    right: Math.max(0, 1 - visibleWidth - left),
    bottom: Math.max(0, 1 - visibleHeight - top),
  });
}

export function zoomImageCrop(args: {
  anchorX: number;
  anchorY: number;
  crop: ImageElementProps["crop"] | null | undefined;
  scale: number;
}): ImageCrop {
  const crop = normalizeImageCrop(args.crop);
  const anchorX = clamp(finiteOr(args.anchorX, 0.5), 0, 1);
  const anchorY = clamp(finiteOr(args.anchorY, 0.5), 0, 1);
  const scale = positiveFiniteOr(args.scale, 1);
  const visibleWidth = getCropVisibleWidth(crop);
  const visibleHeight = getCropVisibleHeight(crop);
  const visibleArea = visibleWidth * visibleHeight;
  const maximumScale = Math.min(1 / visibleWidth, 1 / visibleHeight);
  const minimumAreaScale = Math.min(
    maximumScale,
    Math.sqrt(minimumImageCropVisibleArea / visibleArea),
  );
  const boundedScale = clamp(1 / scale, minimumAreaScale, maximumScale);

  return scaleImageCropAroundAnchor({
    anchorX,
    anchorY,
    crop,
    scale: boundedScale,
  });
}

export function getImageElementLayout(args: {
  crop: ImageElementProps["crop"];
  fit: ImageElementProps["fit"];
  focusX: number;
  focusY: number;
  frameHeight: number;
  frameWidth: number;
  imageHeight: number;
  imageWidth: number;
}): ImageElementLayout {
  const frameWidth = positiveFiniteOr(args.frameWidth, 1);
  const frameHeight = positiveFiniteOr(args.frameHeight, 1);
  const imageWidth = positiveFiniteOr(args.imageWidth, 1);
  const imageHeight = positiveFiniteOr(args.imageHeight, 1);

  if (args.crop) {
    const crop = normalizeImageCrop(args.crop);

    return {
      crop: {
        height: imageHeight * (1 - crop.top - crop.bottom),
        width: imageWidth * (1 - crop.left - crop.right),
        x: imageWidth * crop.left,
        y: imageHeight * crop.top,
      },
      height: frameHeight,
      width: frameWidth,
      x: 0,
      y: 0,
    };
  }

  if (args.fit === "stretch") {
    return {
      crop: undefined,
      height: frameHeight,
      width: frameWidth,
      x: 0,
      y: 0,
    };
  }

  if (args.fit === "contain") {
    const scale = Math.min(frameWidth / imageWidth, frameHeight / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;

    return {
      crop: undefined,
      height,
      width,
      x: (frameWidth - width) / 2,
      y: (frameHeight - height) / 2,
    };
  }

  const frameRatio = frameWidth / frameHeight;
  const imageRatio = imageWidth / imageHeight;

  if (imageRatio > frameRatio) {
    const cropWidth = imageHeight * frameRatio;
    const maxCropX = Math.max(0, imageWidth - cropWidth);

    return {
      crop: {
        height: imageHeight,
        width: cropWidth,
        x: maxCropX * clamp(finiteOr(args.focusX, 0.5), 0, 1),
        y: 0,
      },
      height: frameHeight,
      width: frameWidth,
      x: 0,
      y: 0,
    };
  }

  const cropHeight = imageWidth / frameRatio;
  const maxCropY = Math.max(0, imageHeight - cropHeight);

  return {
    crop: {
      height: cropHeight,
      width: imageWidth,
      x: 0,
      y: maxCropY * clamp(finiteOr(args.focusY, 0.5), 0, 1),
    },
    height: frameHeight,
    width: frameWidth,
    x: 0,
    y: 0,
  };
}

export function getImageElementCssLayout(args: {
  frameHeight: number;
  frameWidth: number;
  imageHeight: number;
  imageWidth: number;
  layout: ImageElementLayout;
}) {
  const { layout } = args;

  if (!layout.crop) {
    return {
      height: layout.height,
      left: layout.x,
      top: layout.y,
      width: layout.width,
    };
  }

  const cropWidth = positiveFiniteOr(layout.crop.width, 1);
  const cropHeight = positiveFiniteOr(layout.crop.height, 1);
  const width =
    layout.width * (positiveFiniteOr(args.imageWidth, 1) / cropWidth);
  const height =
    layout.height * (positiveFiniteOr(args.imageHeight, 1) / cropHeight);

  return {
    height,
    left: layout.x - (layout.width * layout.crop.x) / cropWidth,
    top: layout.y - (layout.height * layout.crop.y) / cropHeight,
    width,
  };
}

export function getInitialImageCrop(args: {
  imageProps: Pick<ImageElementProps, "crop" | "fit" | "focusX" | "focusY">;
  frameHeight: number;
  frameWidth: number;
  imageHeight: number;
  imageWidth: number;
}): ImageCrop {
  if (args.imageProps.crop) {
    return normalizeImageCrop(args.imageProps.crop);
  }

  const layout = getImageElementLayout({
    crop: undefined,
    fit: args.imageProps.fit === "stretch" ? "stretch" : "cover",
    focusX: args.imageProps.focusX,
    focusY: args.imageProps.focusY,
    frameHeight: args.frameHeight,
    frameWidth: args.frameWidth,
    imageHeight: args.imageHeight,
    imageWidth: args.imageWidth,
  });

  if (!layout.crop) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }

  const imageWidth = positiveFiniteOr(args.imageWidth, 1);
  const imageHeight = positiveFiniteOr(args.imageHeight, 1);

  return normalizeImageCrop({
    left: layout.crop.x / imageWidth,
    top: layout.crop.y / imageHeight,
    right: 1 - (layout.crop.x + layout.crop.width) / imageWidth,
    bottom: 1 - (layout.crop.y + layout.crop.height) / imageHeight,
  });
}

function normalizeCropAxis(
  startValue: number | undefined,
  endValue: number | undefined,
) {
  let start = clamp(finiteOr(startValue, 0), 0, 1);
  let end = clamp(finiteOr(endValue, 0), 0, 1);
  const croppedFraction = start + end;

  if (croppedFraction >= 1) {
    const maximumCroppedFraction = 1 - cropBoundaryEpsilon;
    const scale = maximumCroppedFraction / croppedFraction;
    start *= scale;
    end *= scale;
  }

  return { start, end };
}

function scaleImageCropAroundAnchor(args: {
  anchorX: number;
  anchorY: number;
  crop: ImageCrop;
  scale: number;
}): ImageCrop {
  const visibleWidth = getCropVisibleWidth(args.crop);
  const visibleHeight = getCropVisibleHeight(args.crop);
  const nextVisibleWidth = visibleWidth * args.scale;
  const nextVisibleHeight = visibleHeight * args.scale;

  if (
    nextVisibleWidth >= 1 - cropBoundaryEpsilon &&
    nextVisibleHeight >= 1 - cropBoundaryEpsilon
  ) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }

  const sourceAnchorX = args.crop.left + visibleWidth * args.anchorX;
  const sourceAnchorY = args.crop.top + visibleHeight * args.anchorY;
  const left = clamp(
    sourceAnchorX - nextVisibleWidth * args.anchorX,
    0,
    1 - nextVisibleWidth,
  );
  const top = clamp(
    sourceAnchorY - nextVisibleHeight * args.anchorY,
    0,
    1 - nextVisibleHeight,
  );

  return normalizeImageCrop({
    left,
    top,
    right: Math.max(0, 1 - nextVisibleWidth - left),
    bottom: Math.max(0, 1 - nextVisibleHeight - top),
  });
}

function getCropVisibleWidth(crop: ImageCrop) {
  return 1 - crop.left - crop.right;
}

function getCropVisibleHeight(crop: ImageCrop) {
  return 1 - crop.top - crop.bottom;
}

function finiteOr(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveFiniteOr(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
