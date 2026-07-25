import type { ImageElementProps } from "@orbit/shared";
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
import {
  resizeImageCropDraft,
  type ImageCropDraft,
  type ImageCropFrame,
  type ImageCropHandle,
} from "./imageCropResize";
import "./image-crop.css";

type ImageCropAction = "apply" | "cancel";

const cropHandles: ImageCropHandle[] = [
  "top-left",
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
];

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
  draft: ImageCropDraft;
  onApply: (draft: ImageCropDraft) => void;
  onCancel: () => void;
}) {
  if (args.completed) {
    return true;
  }

  if (args.action === "apply") {
    args.onApply({
      frame: args.draft.frame,
      crop: normalizeImageCrop(args.draft.crop),
    });
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
  canResizeFrame: boolean;
  frame: ImageCropFrame;
  imageProps: ImageElementProps;
  resizeDisabledReason?: string | null;
  stageScale: number;
  onApply: (draft: ImageCropDraft) => void;
  onCancel: () => void;
}) {
  const {
    canResizeFrame,
    frame,
    imageProps,
    resizeDisabledReason,
    stageScale,
    onApply,
    onCancel,
  } = props;
  const [draftFrame, setDraftFrame] = useState<ImageCropFrame>(() => frame);
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
    handle?: ImageCropHandle;
    localX: number;
    localY: number;
    mode: "pan" | "resize";
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
    : { height: draftFrame.height, width: draftFrame.width };

  const getResetCrop = useCallback(
    () =>
      imageReady
        ? getInitialImageCrop({
            imageProps,
            frameHeight: frame.height,
            frameWidth: frame.width,
            imageHeight: imageSize.height,
            imageWidth: imageSize.width,
          })
        : normalizeImageCrop(imageProps.crop),
    [frame.height, frame.width, imageProps, imageReady, imageSize.height, imageSize.width],
  );

  useEffect(() => {
    completedRef.current = false;
    setDraftFrame(frame);
    if (!imageReady) {
      setDraftCrop(normalizeImageCrop(imageProps.crop));
      return;
    }
    setDraftCrop(
      getResetCrop()
    );
  }, [
    frame,
    imageProps.crop?.bottom,
    imageProps.crop?.left,
    imageProps.crop?.right,
    imageProps.crop?.top,
    imageProps.fit,
    imageProps.focusX,
    imageProps.focusY,
    imageProps.src,
    imageReady,
    getResetCrop,
  ]);

  const finish = useCallback(
    (action: ImageCropAction) => {
      completedRef.current = completeImageCropDraft({
        action,
        completed: completedRef.current,
        draft: { frame: draftFrame, crop: draftCrop },
        onApply,
        onCancel
      });
    },
    [draftCrop, draftFrame, onApply, onCancel]
  );

  finishRef.current = finish;

  useEffect(() => {
    cancelButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab") {
        const buttons = Array.from(
          overlayRef.current?.querySelectorAll<HTMLButtonElement>(
            ".image-crop-toolbar button:not(:disabled)"
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
        frameHeight: draftFrame.height,
        frameWidth: draftFrame.width,
        imageHeight: imageSize.height,
        imageWidth: imageSize.width
      }),
    [
      draftCrop,
      draftFrame.height,
      draftFrame.width,
      imageProps.fit,
      imageProps.focusX,
      imageProps.focusY,
      imageSize.height,
      imageSize.width
    ]
  );
  const previewLayout = getImageElementCssLayout({
    frameHeight: draftFrame.height,
    frameWidth: draftFrame.width,
    imageHeight: imageSize.height,
    imageWidth: imageSize.width,
    layout
  });
  const frameStyle = getImageCropOverlayFrameStyle(draftFrame, safeStageScale);

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
      frame: draftFrame,
      rootLeft: rootBounds?.left ?? 0,
      rootTop: rootBounds?.top ?? 0,
      stageScale: safeStageScale
    });
    activePointerRef.current = {
      localX: pointer.x,
      localY: pointer.y,
      mode: "pan",
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
      frame: draftFrame,
      rootLeft: rootBounds?.left ?? 0,
      rootTop: rootBounds?.top ?? 0,
      stageScale: safeStageScale
    });
    const deltaX = pointer.x - activePointer.localX;
    const deltaY = pointer.y - activePointer.localY;
    activePointerRef.current = {
      ...activePointer,
      localX: pointer.x,
      localY: pointer.y,
      pointerId: event.pointerId
    };
    if (activePointer.mode === "resize" && activePointer.handle) {
      const resized = resizeImageCropDraft({
        draft: { frame: draftFrame, crop: draftCrop },
        handle: activePointer.handle,
        deltaX: deltaX / safeStageScale,
        deltaY: deltaY / safeStageScale,
        minimumFrameSize: 8 / safeStageScale,
      });
      setDraftFrame(resized.frame);
      setDraftCrop(resized.crop);
      return;
    }
    setDraftCrop((crop) =>
      panImageCrop({
        crop,
        deltaX,
        deltaY,
        frameHeight: draftFrame.height * safeStageScale,
        frameWidth: draftFrame.width * safeStageScale
      })
    );
  }

  function handleResizePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    handle: ImageCropHandle,
  ) {
    if (event.button !== 0 || !imageReady || !canResizeFrame) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rootBounds = overlayRef.current?.getBoundingClientRect();
    const pointer = getImageCropLocalPointer({
      clientX: event.clientX,
      clientY: event.clientY,
      frame: draftFrame,
      rootLeft: rootBounds?.left ?? 0,
      rootTop: rootBounds?.top ?? 0,
      stageScale: safeStageScale,
    });
    activePointerRef.current = {
      handle,
      localX: pointer.x,
      localY: pointer.y,
      mode: "resize",
      pointerId: event.pointerId,
    };
    setIsDragging(true);
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
      frame: draftFrame,
      rootLeft: rootBounds?.left ?? 0,
      rootTop: rootBounds?.top ?? 0,
      stageScale: safeStageScale
    });
    const anchorX = pointer.x / (draftFrame.width * safeStageScale);
    const anchorY = pointer.y / (draftFrame.height * safeStageScale);

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

  function resetDraft() {
    completedRef.current = false;
    setDraftFrame(frame);
    setDraftCrop(getResetCrop());
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
        aria-hidden="true"
        className="image-crop-source-layer"
        style={frameStyle}
      >
        <img
          alt=""
          className="image-crop-preview is-source"
          draggable={false}
          src={imageSource}
          style={{
            height: previewLayout.height * safeStageScale,
            left: previewLayout.left * safeStageScale,
            top: previewLayout.top * safeStageScale,
            width: previewLayout.width * safeStageScale,
          }}
        />
      </div>
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
        {cropHandles.map((handle) => (
          <button
            aria-label={`${handle} 자르기 핸들`}
            className={`image-crop-handle is-${handle}`}
            data-crop-handle={handle}
            disabled={!canResizeFrame}
            key={handle}
            tabIndex={-1}
            type="button"
            onPointerDown={(event) => handleResizePointerDown(event, handle)}
          />
        ))}
      </div>
      <div
        className="image-crop-toolbar"
        style={{
          left: frameStyle.left,
          top: frameStyle.top + frameStyle.height
        }}
      >
        <span className="image-crop-instructions" id="image-crop-instructions">
          이미지를 드래그하거나 검은 핸들로 범위를 조절한 뒤 적용하세요.
        </span>
        {!canResizeFrame && resizeDisabledReason ? (
          <span className="image-crop-capability-reason" role="status">
            {resizeDisabledReason}
          </span>
        ) : null}
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
        <button type="button" onClick={resetDraft}>
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
