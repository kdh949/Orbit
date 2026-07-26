import type { ImageElementProps } from "@orbit/shared/deck";
import type { PointerEvent as ReactPointerEvent, WheelEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveEditorAssetUrl } from "../../shared/editorAssetUrl";
import {
  getImageElementCssLayout,
  getImageElementLayout,
  getInitialImageCrop,
  type ImageCrop,
  normalizeImageCrop,
  panImageCrop,
  zoomImageCrop
} from "../../../slides/rendering/imageElementLayout";
import "./image-crop.css";

type ImageCropAction = "apply" | "reset" | "cancel";

type ImageCropFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export function getImageCropLocalPointer(args: {
  clientX: number;
  clientY: number;
  frame: ImageCropFrame;
  rootLeft: number;
  rootTop: number;
  stageScale: number;
}) {
  const scale =
    Number.isFinite(args.stageScale) && args.stageScale > 0
      ? args.stageScale
      : 1;
  const radians = (-args.frame.rotation * Math.PI) / 180;
  const deltaX = args.clientX - args.rootLeft - args.frame.x * scale;
  const deltaY = args.clientY - args.rootTop - args.frame.y * scale;

  return {
    x: deltaX * Math.cos(radians) - deltaY * Math.sin(radians),
    y: deltaX * Math.sin(radians) + deltaY * Math.cos(radians)
  };
}

export function completeImageCropDraft(args: {
  action: ImageCropAction;
  completed: boolean;
  crop: ImageCrop;
  onApply: (crop: ImageCrop) => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  if (args.completed) {
    return true;
  }

  if (args.action === "apply") {
    args.onApply(normalizeImageCrop(args.crop));
  } else if (args.action === "reset") {
    args.onReset();
  } else {
    args.onCancel();
  }

  return true;
}

export function getImageCropOverlayFrameStyle(
  frame: ImageCropFrame,
  stageScale: number
) {
  const scale = Number.isFinite(stageScale) && stageScale > 0 ? stageScale : 1;

  return {
    height: frame.height * scale,
    left: frame.x * scale,
    top: frame.y * scale,
    transform: `rotate(${frame.rotation}deg)`,
    transformOrigin: "top left",
    width: frame.width * scale
  };
}

export function ImageCropOverlay(props: {
  frame: ImageCropFrame;
  imageProps: ImageElementProps;
  stageScale: number;
  onApply: (crop: ImageCrop) => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const { frame, imageProps, stageScale, onApply, onCancel, onReset } = props;
  const [draftCrop, setDraftCrop] = useState<ImageCrop>(() =>
    normalizeImageCrop(imageProps.crop)
  );
  const [loadedImage, setLoadedImage] = useState<{
    height: number;
    src: string;
    width: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const activePointerRef = useRef<{
    localX: number;
    localY: number;
    pointerId: number;
  } | null>(null);
  const completedRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const finishRef = useRef<(action: ImageCropAction) => void>(() => {});
  const safeStageScale =
    Number.isFinite(stageScale) && stageScale > 0 ? stageScale : 1;
  const imageSource = resolveEditorAssetUrl(imageProps.src);
  const imageReady = loadedImage?.src === imageSource;
  const imageSize = imageReady
    ? loadedImage
    : { height: frame.height, width: frame.width };

  useEffect(() => {
    completedRef.current = false;
    if (!imageReady) {
      setDraftCrop(normalizeImageCrop(imageProps.crop));
      return;
    }
    setDraftCrop(
      getInitialImageCrop({
        imageProps,
        frameHeight: frame.height,
        frameWidth: frame.width,
        imageHeight: imageSize.height,
        imageWidth: imageSize.width
      })
    );
  }, [
    frame.height,
    frame.width,
    imageProps.crop?.bottom,
    imageProps.crop?.left,
    imageProps.crop?.right,
    imageProps.crop?.top,
    imageProps.fit,
    imageProps.focusX,
    imageProps.focusY,
    imageProps.src,
    imageReady,
    imageSize.height,
    imageSize.width
  ]);

  const finish = useCallback(
    (action: ImageCropAction) => {
      completedRef.current = completeImageCropDraft({
        action,
        completed: completedRef.current,
        crop: draftCrop,
        onApply,
        onCancel,
        onReset
      });
    },
    [draftCrop, onApply, onCancel, onReset]
  );

  finishRef.current = finish;

  useEffect(() => {
    cancelButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab") {
        const buttons = Array.from(
          overlayRef.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)"
          ) ?? []
        );
        if (buttons.length === 0) return;
        const activeIndex = buttons.indexOf(
          document.activeElement as HTMLButtonElement
        );
        const nextIndex = event.shiftKey
          ? activeIndex <= 0
            ? buttons.length - 1
            : activeIndex - 1
          : activeIndex >= buttons.length - 1
            ? 0
            : activeIndex + 1;
        event.preventDefault();
        buttons[nextIndex]?.focus();
        return;
      }
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      finishRef.current("cancel");
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const layout = useMemo(
    () =>
      getImageElementLayout({
        crop: draftCrop,
        fit: imageProps.fit,
        focusX: imageProps.focusX,
        focusY: imageProps.focusY,
        frameHeight: frame.height,
        frameWidth: frame.width,
        imageHeight: imageSize.height,
        imageWidth: imageSize.width
      }),
    [
      draftCrop,
      frame.height,
      frame.width,
      imageProps.fit,
      imageProps.focusX,
      imageProps.focusY,
      imageSize.height,
      imageSize.width
    ]
  );
  const previewLayout = getImageElementCssLayout({
    frameHeight: frame.height,
    frameWidth: frame.width,
    imageHeight: imageSize.height,
    imageWidth: imageSize.width,
    layout
  });
  const frameStyle = getImageCropOverlayFrameStyle(frame, safeStageScale);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !imageReady) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rootBounds = event.currentTarget.parentElement?.getBoundingClientRect();
    const pointer = getImageCropLocalPointer({
      clientX: event.clientX,
      clientY: event.clientY,
      frame,
      rootLeft: rootBounds?.left ?? 0,
      rootTop: rootBounds?.top ?? 0,
      stageScale: safeStageScale
    });
    activePointerRef.current = {
      localX: pointer.x,
      localY: pointer.y,
      pointerId: event.pointerId
    };
    setIsDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const activePointer = activePointerRef.current;
    if (!activePointer || activePointer.pointerId !== event.pointerId) {
      return;
    }

    const rootBounds = event.currentTarget.parentElement?.getBoundingClientRect();
    const pointer = getImageCropLocalPointer({
      clientX: event.clientX,
      clientY: event.clientY,
      frame,
      rootLeft: rootBounds?.left ?? 0,
      rootTop: rootBounds?.top ?? 0,
      stageScale: safeStageScale
    });
    const deltaX = pointer.x - activePointer.localX;
    const deltaY = pointer.y - activePointer.localY;
    activePointerRef.current = {
      localX: pointer.x,
      localY: pointer.y,
      pointerId: event.pointerId
    };
    setDraftCrop((crop) =>
      panImageCrop({
        crop,
        deltaX,
        deltaY,
        frameHeight: frame.height * safeStageScale,
        frameWidth: frame.width * safeStageScale
      })
    );
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (activePointerRef.current?.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointerRef.current = null;
    setIsDragging(false);
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!imageReady) {
      return;
    }
    const rootBounds = event.currentTarget.parentElement?.getBoundingClientRect();
    const pointer = getImageCropLocalPointer({
      clientX: event.clientX,
      clientY: event.clientY,
      frame,
      rootLeft: rootBounds?.left ?? 0,
      rootTop: rootBounds?.top ?? 0,
      stageScale: safeStageScale
    });
    const anchorX = pointer.x / (frame.width * safeStageScale);
    const anchorY = pointer.y / (frame.height * safeStageScale);

    setDraftCrop((crop) =>
      zoomImageCrop({
        anchorX,
        anchorY,
        crop,
        scale: Math.exp(-event.deltaY * 0.002)
      })
    );
  }

  function zoomFromCenter(scale: number) {
    setDraftCrop((crop) =>
      zoomImageCrop({
        anchorX: 0.5,
        anchorY: 0.5,
        crop,
        scale
      })
    );
  }

  return (
    <div
      aria-describedby="image-crop-instructions"
      aria-label="이미지 자르기"
      aria-modal="true"
      className="image-crop-overlay"
      data-editor-keyboard-owner
      ref={overlayRef}
      role="dialog"
    >
      <div
        className={`image-crop-viewport ${isDragging ? "is-dragging" : ""}`}
        style={frameStyle}
        onPointerCancel={finishPointer}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onWheel={handleWheel}
      >
        <img
          alt={imageProps.alt}
          className="image-crop-preview"
          draggable={false}
          src={imageSource}
          style={{
            height: previewLayout.height * safeStageScale,
            left: previewLayout.left * safeStageScale,
            top: previewLayout.top * safeStageScale,
            width: previewLayout.width * safeStageScale
          }}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
              setLoadedImage({
                height: image.naturalHeight,
                src: imageSource,
                width: image.naturalWidth
              });
            }
          }}
        />
        <div className="image-crop-grid" aria-hidden="true" />
      </div>
      <div
        className="image-crop-toolbar"
        style={{
          left: frameStyle.left,
          top: frameStyle.top + frameStyle.height
        }}
      >
        <span className="image-crop-instructions" id="image-crop-instructions">
          이미지를 드래그해 위치를 바꾸고 확대·축소한 뒤 적용하세요.
        </span>
        <button
          aria-label="축소"
          disabled={!imageReady}
          type="button"
          onClick={() => zoomFromCenter(0.8)}
        >
          −
        </button>
        <button
          aria-label="확대"
          disabled={!imageReady}
          type="button"
          onClick={() => zoomFromCenter(1.25)}
        >
          +
        </button>
        <button type="button" onClick={() => finish("reset")}>
          초기화
        </button>
        <button ref={cancelButtonRef} type="button" onClick={() => finish("cancel")}>
          취소
        </button>
        <button
          className="primary"
          disabled={!imageReady}
          type="button"
          onClick={() => finish("apply")}
        >
          적용
        </button>
      </div>
    </div>
  );
}
