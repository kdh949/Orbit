import type { Deck, Slide } from "@orbit/shared";
import type Konva from "konva";
import type {
  ComponentProps,
  DragEvent as ReactDragEvent,
  MutableRefObject,
  ReactNode,
  RefObject
} from "react";
import { useEffect, useState } from "react";

import {
  ActivityResultSlideRenderer,
  ActivitySlidePreview,
  findActivityResultSource
} from "../../../activity-slides";
import {
  EditableCanvas,
  HiddenSlideRenderStages
} from "../../canvas/EditorCanvas";
import {
  getCanvasDropPlacement,
  getDroppedFiles,
  type ImageInsertPlacement
} from "../hooks/useEditorFileTransfer";
import { buildSlideBackgroundStyle } from "../utils/editorLayout";
import { EmptyCanvasState } from "./EditorStateNotice";

type EditorCanvasStageProps = {
  assistantDialog: ReactNode;
  canvasViewportRef: RefObject<HTMLDivElement | null>;
  currentSlide: Slide | null;
  deck: Deck;
  editableCanvasProps: Omit<ComponentProps<typeof EditableCanvas>, "deck" | "slide">;
  imageDropEnabled: boolean;
  imageTransferMessage: { kind: "error" | "status"; message: string } | null;
  onImageFilesDrop: (files: File[], placement: ImageInsertPlacement) => void;
  renderingDeck: Deck | null;
  slideRenderStageRefs: MutableRefObject<Map<string, Konva.Stage>>;
  stageScale: number;
  zoomMode: "fit" | "manual";
};

export function EditorCanvasStage(props: EditorCanvasStageProps) {
  const [isImageDragActive, setIsImageDragActive] = useState(false);

  useEffect(() => {
    if (!props.imageDropEnabled) setIsImageDragActive(false);
  }, [props.imageDropEnabled]);

  function handleDragEnter(event: ReactDragEvent<HTMLDivElement>) {
    if (!hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    if (props.imageDropEnabled) setIsImageDragActive(true);
  }

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    const acceptsFiles =
      props.imageDropEnabled && hasFileDrag(event.dataTransfer);
    event.dataTransfer.dropEffect = acceptsFiles ? "copy" : "none";
  }

  function handleDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    const relatedTarget = event.relatedTarget;
    if (
      relatedTarget instanceof Node &&
      event.currentTarget.contains(relatedTarget)
    ) {
      return;
    }
    setIsImageDragActive(false);
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsImageDragActive(false);
    const files = getDroppedFiles(event.dataTransfer);
    if (!props.imageDropEnabled || files.length === 0) return;

    props.onImageFilesDrop(
      files,
      getCanvasDropPlacement({
        clientX: event.clientX,
        clientY: event.clientY,
        rect: event.currentTarget.getBoundingClientRect(),
        stageScale: props.stageScale
      })
    );
  }

  return (
    <div
      aria-label="슬라이드 캔버스 작업 영역"
      className="canvas-scroll"
      data-testid="editor-canvas-pane"
      data-zoom-mode={props.zoomMode}
      data-zoom-percent={Math.round(props.stageScale * 100)}
      ref={props.canvasViewportRef}
      role="region"
      tabIndex={0}
    >
      {props.imageTransferMessage ? (
        <div
          aria-live="polite"
          className={`editor-image-transfer-notice ${props.imageTransferMessage.kind}`}
          role={
            props.imageTransferMessage.kind === "error" ? "alert" : "status"
          }
        >
          {props.imageTransferMessage.message}
        </div>
      ) : null}
      {props.currentSlide ? (
        <div className="konva-wrap">
          <div
            className={`konva-stage-shell orbit-stage-shell ${
              isImageDragActive && props.imageDropEnabled
                ? "is-image-drop-target"
                : ""
            }`}
            data-testid="editor-stage-shell"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            style={{
              width: props.deck.canvas.width * props.stageScale,
              height: props.deck.canvas.height * props.stageScale,
              color: props.currentSlide.style.textColor ?? props.deck.theme.textColor,
              ...buildSlideBackgroundStyle(props.currentSlide, props.deck)
            }}
          >
            {props.currentSlide.kind === "activity" ? (
              <div aria-label="잠긴 시스템 레이어" className="activity-editor-system-layer">
                <ActivitySlidePreview
                  role="audience"
                  slide={props.currentSlide}
                  theme={props.deck.theme}
                />
              </div>
            ) : props.currentSlide.kind === "activity-results" ? (
              <div aria-label="잠긴 시스템 레이어" className="activity-editor-system-layer">
                <ActivityResultSlideRenderer
                  presenterResult={null}
                  publicResult={null}
                  role="presenter"
                  run={null}
                  scale={props.stageScale}
                  slide={props.currentSlide}
                  source={findActivityResultSource(
                    props.deck,
                    props.currentSlide.activityResult.sourceActivityId
                  )}
                  theme={props.deck.theme}
                />
              </div>
            ) : (
              <EditableCanvas
                {...props.editableCanvasProps}
                deck={props.deck}
                slide={props.currentSlide}
              />
            )}
            {isImageDragActive && props.imageDropEnabled ? (
              <div className="editor-image-drop-overlay" aria-hidden="true">
                <strong>여기에 놓아 이미지 추가</strong>
                <span>JPG, PNG, WebP · 한 번에 1개</span>
              </div>
            ) : null}
          </div>
          {props.renderingDeck ? (
            <HiddenSlideRenderStages deck={props.renderingDeck} stageRefs={props.slideRenderStageRefs} />
          ) : null}
        </div>
      ) : (
        <EmptyCanvasState canvas={props.deck.canvas} />
      )}
      {props.assistantDialog}
    </div>
  );
}

function hasFileDrag(dataTransfer: DataTransfer) {
  return (
    dataTransfer.files.length > 0 ||
    Array.from(dataTransfer.types).includes("Files")
  );
}
