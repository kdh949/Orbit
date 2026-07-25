import type { ImageCrop } from "../../../slides/rendering/imageElementLayout";

export type ImageCropFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type ImageCropDraft = {
  frame: ImageCropFrame;
  crop: ImageCrop;
};

export type ImageCropHandle =
  | "top-left"
  | "top"
  | "top-right"
  | "right"
  | "bottom-right"
  | "bottom"
  | "bottom-left"
  | "left";

const minimumVisibleFraction = 0.1;

export function resizeImageCropDraft(args: {
  draft: ImageCropDraft;
  handle: ImageCropHandle;
  deltaX: number;
  deltaY: number;
  minimumFrameSize: number;
}): ImageCropDraft {
  const { draft, handle } = args;
  const resizeLeft = handle === "left" || handle.includes("left");
  const resizeRight = handle === "right" || handle.includes("right");
  const resizeTop = handle === "top" || handle.startsWith("top-");
  const resizeBottom = handle === "bottom" || handle.startsWith("bottom-");
  const horizontal = resizeAxis({
    delta: finiteOr(args.deltaX, 0),
    endCrop: draft.crop.right,
    minimumSize: args.minimumFrameSize,
    resizeEnd: resizeRight,
    resizeStart: resizeLeft,
    size: draft.frame.width,
    startCrop: draft.crop.left,
  });
  const vertical = resizeAxis({
    delta: finiteOr(args.deltaY, 0),
    endCrop: draft.crop.bottom,
    minimumSize: args.minimumFrameSize,
    resizeEnd: resizeBottom,
    resizeStart: resizeTop,
    size: draft.frame.height,
    startCrop: draft.crop.top,
  });
  const radians = (draft.frame.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    frame: {
      ...draft.frame,
      x:
        draft.frame.x +
        horizontal.originShift * cos -
        vertical.originShift * sin,
      y:
        draft.frame.y +
        horizontal.originShift * sin +
        vertical.originShift * cos,
      width: horizontal.size,
      height: vertical.size,
    },
    crop: {
      left: horizontal.startCrop,
      top: vertical.startCrop,
      right: horizontal.endCrop,
      bottom: vertical.endCrop,
    },
  };
}

function resizeAxis(args: {
  delta: number;
  endCrop: number;
  minimumSize: number;
  resizeEnd: boolean;
  resizeStart: boolean;
  size: number;
  startCrop: number;
}) {
  const size = Math.max(1e-9, finiteOr(args.size, 1));
  const startCrop = clamp(args.startCrop, 0, 1);
  const endCrop = clamp(args.endCrop, 0, 1);
  const visible = Math.max(1e-9, 1 - startCrop - endCrop);
  const minimumVisible = Math.min(visible, minimumVisibleFraction);
  const minimumSize = Math.max(
    1e-9,
    finiteOr(args.minimumSize, 8),
    (size * minimumVisible) / visible,
  );

  if (args.resizeStart) {
    const maximumSize = (size * (visible + startCrop)) / visible;
    const nextSize = clamp(size - args.delta, minimumSize, maximumSize);
    const appliedDelta = size - nextSize;
    return {
      endCrop,
      originShift: appliedDelta,
      size: nextSize,
      startCrop: clamp(startCrop + (appliedDelta * visible) / size, 0, 1),
    };
  }

  if (args.resizeEnd) {
    const maximumSize = (size * (visible + endCrop)) / visible;
    const nextSize = clamp(size + args.delta, minimumSize, maximumSize);
    const appliedDelta = nextSize - size;
    return {
      endCrop: clamp(endCrop - (appliedDelta * visible) / size, 0, 1),
      originShift: 0,
      size: nextSize,
      startCrop,
    };
  }

  return { endCrop, originShift: 0, size, startCrop };
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
