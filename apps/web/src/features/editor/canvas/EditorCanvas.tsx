import { normalizeRichTextProps } from "@orbit/editor-core";
import {
  maxAssetUploadSizeBytes,
  type CustomShapeNode,
  type Deck,
  type DeckCanvas,
  type DeckElement,
  type Slide,
  type TextElementProps,
} from "@orbit/shared";
import type Konva from "konva";
import type { Box as TransformerBox } from "konva/lib/shapes/Transformer";
import {
  Layer as KonvaLayer,
  Line as KonvaLine,
  Rect as KonvaRect,
  Stage as KonvaStage,
  Transformer as KonvaTransformer,
} from "react-konva";
import type { ComponentType, MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { CustomShapeInsertOverlay } from "./components/CustomShapeOverlays";
import { EditableElementNode } from "./components/EditableElementNode";
import { type CanvasPoint } from "./custom-shape/geometry";
import { useCanvasBackgroundPointerCapture } from "./hooks/useCanvasBackgroundPointerCapture";
import { useCanvasKeyboardShortcuts } from "./hooks/useCanvasKeyboardShortcuts";
import { useCanvasStageInteractions } from "./hooks/useCanvasStageInteractions";
import { useSyncCustomShapeEditDraft } from "./hooks/useSyncCustomShapeEditDraft";
import { ImageCropOverlay } from "./image/ImageCropOverlay";
import { InlineDataEditorOverlay } from "./data/InlineDataEditorOverlay";
import {
  InlineTextEditorOverlay,
  type InlineTextEditorController,
} from "./text/InlineTextEditorOverlay";
import { TextContextToolbar } from "./text/TextContextToolbar";
import {
  type CanvasSnapGuide,
  commitCustomShapeEditGeometry,
  getElementsIntersectingSelectionRect,
  normalizeDraftRect,
} from "./utils/canvasInteractionUtils";
import { getSelectionTransformerConfig } from "./utils/selectionTransformer";
import {
  getHighlightOverlayElements,
  HighlightOverlay,
  ReadOnlySlideCanvas,
  type ElementPresentationState,
} from "../../slides/rendering";
import { resolveRedesignPalette } from "../../../styles/redesignPalette";
import { isEditorKeyboardCommandSuppressedTarget } from "../shell/editorKeyboardCommands";

export { getRenderableSlideElements } from "../../slides/rendering";

type KonvaComponent = ComponentType<any>;

const Layer = KonvaLayer as unknown as KonvaComponent;
const Line = KonvaLine as unknown as KonvaComponent;
const Rect = KonvaRect as unknown as KonvaComponent;
const Stage = KonvaStage as unknown as KonvaComponent;
const Transformer = KonvaTransformer as unknown as KonvaComponent;

const defaultImageInsertFrame = {
  height: 240,
  width: 420,
  x: 260,
  y: 220,
};
const editorImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

type InsertTool =
  | "select"
  | "text"
  | "rect"
  | "ellipse"
  | "line"
  | "customShape";
type DrawableInsertTool = Exclude<InsertTool, "select" | "customShape">;
type CustomShapeInsertDraft = {
  activeNodeIndex: number | null;
  nodes: CustomShapeNode[];
  pointer: CanvasPoint | null;
};
type CustomShapeEditDraft = {
  closed: boolean;
  elementId: string;
  nodes: CustomShapeNode[];
  selectedNodeIndex: number | null;
};

export function HiddenSlideRenderStages(props: {
  deck: Deck;
  stageRefs: MutableRefObject<Map<string, Konva.Stage>>;
}) {
  const { deck, stageRefs } = props;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: -10000,
        left: -10000,
        width: deck.canvas.width,
        height: deck.canvas.height,
        pointerEvents: "none",
        opacity: 0,
      }}
    >
      {deck.slides.map((slide) => {
        return (
          <ReadOnlySlideCanvas
            deck={deck}
            key={slide.slideId}
            slide={slide}
            stageRef={(stage: Konva.Stage | null) => {
              if (stage) {
                stageRefs.current.set(slide.slideId, stage);
              } else {
                stageRefs.current.delete(slide.slideId);
              }
            }}
          />
        );
      })}
    </div>
  );
}

export function getNextElementZIndex(elements: DeckElement[]) {
  return (
    elements.reduce(
      (currentMaxZIndex, element) => Math.max(currentMaxZIndex, element.zIndex),
      0,
    ) + 1
  );
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
      Math.max(
        viewportPadding,
        window.innerWidth - args.width - viewportPadding,
      ),
    ),
    top: Math.min(
      Math.max(viewportPadding, args.clientY),
      Math.max(
        viewportPadding,
        window.innerHeight - args.height - viewportPadding,
      ),
    ),
  };
}

export function getEditorImageValidationMessage(
  file: Pick<File, "name" | "size" | "type">,
) {
  if (!isSupportedEditorImageFile(file)) {
    return "JPG, PNG, WebP 이미지 파일만 업로드할 수 있습니다.";
  }

  if (file.size > maxAssetUploadSizeBytes) {
    return `이미지 크기는 최대 ${formatBytes(maxAssetUploadSizeBytes)}까지 가능합니다.`;
  }

  if (file.size <= 0) {
    return "빈 파일은 업로드할 수 없습니다.";
  }

  return "";
}

function isSupportedEditorImageFile(file: Pick<File, "name" | "type">) {
  if (editorImageMimeTypes.has(file.type.toLowerCase())) {
    return true;
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return (
    extension === "jpg" ||
    extension === "jpeg" ||
    extension === "png" ||
    extension === "webp"
  );
}

function formatBytes(bytes: number) {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function toEditorErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "알 수 없는 오류가 발생했습니다.";
}

export async function readImageNaturalSize(file: File) {
  if (typeof window === "undefined") {
    return {
      height: defaultImageInsertFrame.height,
      width: defaultImageInsertFrame.width,
    };
  }

  const objectUrl = window.URL.createObjectURL(file);

  try {
    return await new Promise<{ height: number; width: number }>(
      (resolve, reject) => {
        const image = new window.Image();

        image.onload = () => {
          resolve({
            height: image.naturalHeight || defaultImageInsertFrame.height,
            width: image.naturalWidth || defaultImageInsertFrame.width,
          });
        };
        image.onerror = () =>
          reject(new Error("이미지 크기를 읽지 못했습니다."));
        image.src = objectUrl;
      },
    );
  } finally {
    window.URL.revokeObjectURL(objectUrl);
  }
}

export function getDefaultImageInsertFrame(
  canvas: DeckCanvas,
  imageSize: { height: number; width: number },
) {
  const safeWidth = Math.max(
    1,
    imageSize.width || defaultImageInsertFrame.width,
  );
  const safeHeight = Math.max(
    1,
    imageSize.height || defaultImageInsertFrame.height,
  );
  const scale = Math.min(520 / safeWidth, 320 / safeHeight, 1);
  const width = Math.max(140, Math.round(safeWidth * scale));
  const height = Math.max(96, Math.round(safeHeight * scale));

  return {
    height,
    width,
    x: Math.max(40, Math.round((canvas.width - width) / 2)),
    y: Math.max(40, Math.round((canvas.height - height) / 2)),
  };
}

export function EditableCanvas(props: {
  customShapeEditElementId: string | null;
  deck: Deck;
  disableInteractions?: boolean;
  editingElementId: string | null;
  imageCropElementId?: string | null;
  insertTool: InsertTool;
  elementStates?: Record<string, ElementPresentationState> | null;
  selectedElementIds: string[];
  showIds: boolean;
  slide: Slide;
  stageScale: number;
  stageRef: MutableRefObject<Konva.Stage | null>;
  validationHighlightElementIds?: string[];
  visibleElements: DeckElement[];
  onClearSelection: () => void;
  onCommitElementProps: (
    elementId: string,
    props: Record<string, unknown>,
  ) => void;
  onCommitElementFrame: (
    slideId: string,
    elementId: string,
    frame: {
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
    },
  ) => void;
  onCreateElement: (
    draft:
      | { type: "text"; x: number; y: number; width: number; height: number }
      | {
          type: "rect" | "ellipse" | "line";
          x: number;
          y: number;
          width: number;
          height: number;
        },
  ) => void;
  onCreateCustomShape: (nodes: CustomShapeNode[], closed: boolean) => void;
  onCommitCustomShapeGeometry: (
    elementId: string,
    nodes: CustomShapeNode[],
    closed: boolean,
  ) => void;
  onDoubleClickElement: (elementId: string) => void;
  onFinishEditing: () => void;
  onFinishImageCrop?: () => void;
  onOpenElementContextMenu: (args: {
    clientX: number;
    clientY: number;
    element: DeckElement;
    slideId: string;
  }) => void;
  onSetCustomShapeEditElementId: (elementId: string | null) => void;
  onSetInsertTool: (tool: InsertTool) => void;
  onSelectElement: (elementId: string, options?: { append?: boolean }) => void;
  onSelectElements: (elementIds: string[]) => void;
}) {
  const {
    customShapeEditElementId,
    deck,
    disableInteractions = false,
    editingElementId,
    imageCropElementId = null,
    elementStates,
    insertTool,
    selectedElementIds,
    showIds,
    slide,
    stageScale,
    stageRef,
    validationHighlightElementIds = [],
    visibleElements,
    onClearSelection,
    onCommitElementProps,
    onCommitElementFrame,
    onCreateElement,
    onCreateCustomShape,
    onCommitCustomShapeGeometry,
    onDoubleClickElement,
    onFinishEditing,
    onFinishImageCrop = () => {},
    onOpenElementContextMenu,
    onSetCustomShapeEditElementId,
    onSetInsertTool,
    onSelectElement,
    onSelectElements,
  } = props;
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const inlineTextEditorRef = useRef<InlineTextEditorController | null>(null);
  const nodeRefs = useRef<Record<string, Konva.Group | null>>({});
  const [containerElement, setContainerElement] =
    useState<HTMLDivElement | null>(null);
  const [editorPrimaryColor, setEditorPrimaryColor] = useState(
    () => deck.theme.palette.primary,
  );
  const pendingTextBlurActionRef = useRef<"clear-selection" | null>(null);
  const [draftElement, setDraftElement] = useState<{
    end: CanvasPoint;
    start: CanvasPoint;
    type: DrawableInsertTool;
  } | null>(null);
  const [customShapeInsertDraft, setCustomShapeInsertDraft] =
    useState<CustomShapeInsertDraft | null>(null);
  const [customShapeEditDraft, setCustomShapeEditDraft] =
    useState<CustomShapeEditDraft | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<{
    start: CanvasPoint;
    end: CanvasPoint;
  } | null>(null);
  const [snapGuides, setSnapGuides] = useState<CanvasSnapGuide[]>([]);
  const imageCropElement =
    !disableInteractions &&
    imageCropElementId &&
    selectedElementIds.length === 1 &&
    selectedElementIds[0] === imageCropElementId
      ? (visibleElements.find(
          (candidate): candidate is Extract<DeckElement, { type: "image" }> =>
            candidate.elementId === imageCropElementId &&
            candidate.type === "image",
        ) ?? null)
      : null;
  const canvasInteractionDisabled =
    disableInteractions || Boolean(imageCropElement);
  const [activeTextRange, setActiveTextRange] = useState<{
    elementId: string;
    end: number;
    start: number;
  } | null>(null);
  const [editingTextDraft, setEditingTextDraft] = useState<{
    elementId: string;
    props: TextElementProps;
  } | null>(null);
  const selectedTextElement =
    selectedElementIds.length === 1
      ? (visibleElements.find(
          (candidate): candidate is Extract<DeckElement, { type: "text" }> =>
            candidate.elementId === selectedElementIds[0] &&
            candidate.type === "text",
        ) ?? null)
      : null;
  const textToolbarElement =
    selectedTextElement &&
    editingTextDraft?.elementId === selectedTextElement.elementId
      ? { ...selectedTextElement, props: editingTextDraft.props }
      : selectedTextElement;
  const textEditCompositeId = editingElementId
    ? `inline-text-edit-${editingElementId}`
    : undefined;
  const editingCustomShapeElement =
    customShapeEditElementId && customShapeEditElementId !== editingElementId
      ? (visibleElements.find(
          (candidate) =>
            candidate.elementId === customShapeEditElementId &&
            candidate.type === "customShape",
        ) ?? null)
      : null;
  const validationHighlightElementIdSet = new Set(
    validationHighlightElementIds,
  );
  const validationHighlightElements = getHighlightOverlayElements({
    activeHighlightElementIds: validationHighlightElementIdSet,
    deck,
    elementStates: elementStates ?? undefined,
    slide,
  });
  const editorPrimarySoftColor = withColorAlpha(editorPrimaryColor, 0.08);
  const editorPrimaryMediumColor = withColorAlpha(editorPrimaryColor, 0.55);
  const selectedElementIdSet = new Set(selectedElementIds);
  const transformerConfig = getSelectionTransformerConfig({
    disableInteractions: canvasInteractionDisabled,
    selectedElements: visibleElements.filter((element) =>
      selectedElementIdSet.has(element.elementId),
    ),
    stageScale,
  });

  useEffect(() => {
    const editorShell = containerElement?.closest<HTMLElement>(
      ".orbit-shell.editor-professional",
    );
    if (!editorShell) return;

    const palette = resolveRedesignPalette(editorShell);
    if (palette) {
      setEditorPrimaryColor(palette.primary);
    }
  }, [containerElement]);

  useEffect(() => {
    const transformer = transformerRef.current;

    if (!transformer) {
      return;
    }

    if (canvasInteractionDisabled || customShapeEditElementId) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }

    const selectedNodes = selectedElementIds
      .map((elementId) => nodeRefs.current[elementId])
      .filter((node): node is Konva.Group => Boolean(node));

    transformer.nodes(selectedNodes);
    transformer.getLayer()?.batchDraw();
  }, [
    canvasInteractionDisabled,
    customShapeEditElementId,
    selectedElementIds,
    visibleElements,
  ]);

  useEffect(() => {
    if (insertTool !== "customShape") {
      setCustomShapeInsertDraft(null);
    }
  }, [insertTool]);

  useEffect(() => {
    pendingTextBlurActionRef.current = null;
    setActiveTextRange(null);
    setEditingTextDraft(null);
  }, [editingElementId]);

  useSyncCustomShapeEditDraft({
    editingCustomShapeElement,
    setCustomShapeEditDraft,
  });

  function commitCustomShapeEdit(nextDraft: CustomShapeEditDraft) {
    if (!editingCustomShapeElement) {
      return;
    }

    const nextGeometry = commitCustomShapeEditGeometry({
      draft: nextDraft,
      element: editingCustomShapeElement,
    });

    onCommitCustomShapeGeometry(
      nextGeometry.elementId,
      nextGeometry.nodes,
      nextGeometry.closed,
    );
  }

  function handleInlineTextEditingFinish(options?: {
    clearSelection?: boolean;
  }) {
    const shouldClearSelection =
      options?.clearSelection ||
      pendingTextBlurActionRef.current === "clear-selection";

    pendingTextBlurActionRef.current = null;

    if (shouldClearSelection) {
      onClearSelection();
      return;
    }

    onFinishEditing();
  }

  function handleTextToolbarCommit(
    elementId: string,
    props: Record<string, unknown>,
  ) {
    if (editingElementId === elementId && inlineTextEditorRef.current) {
      const nextProps = normalizeRichTextProps({
        ...inlineTextEditorRef.current.getDraftProps(),
        ...props,
      } as TextElementProps);
      inlineTextEditorRef.current.applyDraftProps(nextProps);
      setEditingTextDraft({ elementId, props: nextProps });
      return;
    }
    onCommitElementProps(elementId, props);
  }

  useCanvasKeyboardShortcuts({
    customShapeEditDraft,
    customShapeInsertDraft,
    editingCustomShapeElement,
    insertTool,
    isKeyboardEditableTarget: isEditorKeyboardCommandSuppressedTarget,
    onCommitCustomShapeGeometry,
    onCreateCustomShape,
    onSetCustomShapeEditElementId,
    onSetInsertTool,
    setCustomShapeEditDraft,
    setCustomShapeInsertDraft,
  });

  useCanvasBackgroundPointerCapture({
    customShapeEditDraft,
    deck,
    editingElementId,
    insertTool,
    isKeyboardEditableTarget: isEditorKeyboardCommandSuppressedTarget,
    onClearSelection,
    onSelectionDragStart: (point) =>
      setSelectionDraft({ start: point, end: point }),
    onSelectionDragMove: (point) =>
      setSelectionDraft((current) =>
        current ? { ...current, end: point } : current,
      ),
    onSelectionDragEnd: () => {
        const rect = selectionDraft
          ? normalizeDraftRect(selectionDraft.start, selectionDraft.end)
          : null;
      setSelectionDraft(null);
        if (rect) {
          onSelectElements(
            getElementsIntersectingSelectionRect(visibleElements, rect),
          );
        }
      },
    onMarkTextBlurForClear: () => {
      pendingTextBlurActionRef.current = "clear-selection";
    },
    selectedElementIds,
    setCustomShapeEditDraft,
    slide,
    stageRef,
    stageScale,
    visibleElements,
  });

  const stageMouseHandlers = useCanvasStageInteractions({
    customShapeEditDraft,
    draftElement,
    editingElementId,
    insertTool,
    normalizeDraftRect,
    onClearSelection,
    onCreateElement,
    onCreateCustomShape,
    onMarkTextBlurForClear: () => {
      pendingTextBlurActionRef.current = "clear-selection";
    },
    setCustomShapeEditDraft,
    setCustomShapeInsertDraft,
    setDraftElement,
    stageScale,
  });

  return (
    <div
      className="konva-editor-stage"
      data-testid="editor-canvas-stage"
      ref={setContainerElement}
      onContextMenu={(event) => {
        if (selectedElementIds.length > 1) event.preventDefault();
      }}
    >
      <Stage
        className="konva-canvas-layer"
        height={deck.canvas.height * stageScale}
        ref={stageRef}
        scaleX={stageScale}
        scaleY={stageScale}
        width={deck.canvas.width * stageScale}
        onMouseDown={
          canvasInteractionDisabled ? undefined : stageMouseHandlers.onMouseDown
        }
        onMouseMove={
          canvasInteractionDisabled ? undefined : stageMouseHandlers.onMouseMove
        }
        onMouseUp={
          canvasInteractionDisabled ? undefined : stageMouseHandlers.onMouseUp
        }
        onContextMenu={(event: Konva.KonvaEventObject<PointerEvent>) => {
          if (canvasInteractionDisabled || selectedElementIds.length < 2)
            return;
          const selectedElement = visibleElements.find((element) =>
            selectedElementIds.includes(element.elementId),
          );
          if (!selectedElement) return;

          event.evt.preventDefault();
          event.cancelBubble = true;
          onOpenElementContextMenu({
            clientX: event.evt.clientX,
            clientY: event.evt.clientY,
            element: selectedElement,
            slideId: slide.slideId,
          });
        }}
      >
        <Layer>
          {visibleElements.map((element) => (
            <EditableElementNode
              key={element.elementId}
              accentColor={slide.style.accentColor ?? deck.theme.accentColor}
              editorPrimaryColor={editorPrimaryColor}
              editorPrimaryMediumColor={editorPrimaryMediumColor}
              editorPrimarySoftColor={editorPrimarySoftColor}
              deck={deck}
              disablePointerEvents={
                canvasInteractionDisabled || insertTool !== "select"
              }
              element={element}
              hideContent={
                element.type === "text" &&
                element.elementId === editingElementId
              }
              isSelected={selectedElementIds.includes(element.elementId)}
              presentationState={elementStates?.[element.elementId]}
              selectedCount={selectedElementIds.length}
              showIds={showIds}
              slide={slide}
              stageScale={stageScale}
              customShapeEditDraft={
                customShapeEditDraft?.elementId === element.elementId
                  ? customShapeEditDraft
                  : null
              }
              onCommitFrame={(frame) =>
                onCommitElementFrame(slide.slideId, element.elementId, frame)
              }
              onChangeCustomShapeEditDraft={setCustomShapeEditDraft}
              onCommitCustomShapeEditDraft={(nextDraft) => {
                setCustomShapeEditDraft(nextDraft);
                commitCustomShapeEdit(nextDraft);
              }}
              onDoubleClick={() => onDoubleClickElement(element.elementId)}
              onMountNode={(node) => {
                nodeRefs.current[element.elementId] = node;
              }}
              onOpenContextMenu={(clientX, clientY) =>
                onOpenElementContextMenu({
                  clientX,
                  clientY,
                  element,
                  slideId: slide.slideId,
                })
              }
              onSnapGuidesChange={setSnapGuides}
              snapThreshold={8 / Math.max(stageScale, 0.01)}
              onSelect={(append) =>
                onSelectElement(element.elementId, { append })
              }
            />
          ))}
          {snapGuides.map((guide) => (
            <Line
              dash={[
                8 / Math.max(stageScale, 0.01),
                5 / Math.max(stageScale, 0.01),
              ]}
              key={`${guide.axis}-${guide.position}`}
              listening={false}
              points={
                guide.axis === "x"
                  ? [guide.position, 0, guide.position, deck.canvas.height]
                  : [0, guide.position, deck.canvas.width, guide.position]
              }
              stroke="#ec4899"
              strokeWidth={1.5 / Math.max(stageScale, 0.01)}
            />
          ))}
          {validationHighlightElements.map((element) => (
              <HighlightOverlay
                color={editorPrimaryColor}
                element={element}
                key={`validation-highlight-${element.elementId}`}
                state={elementStates?.[element.elementId]}
              />
            ))}
          {customShapeInsertDraft ? (
            <CustomShapeInsertOverlay
              draft={customShapeInsertDraft}
              primaryColor={editorPrimaryColor}
              primaryMediumColor={editorPrimaryMediumColor}
              primarySoftColor={editorPrimarySoftColor}
              onClosePath={() => {
                if (customShapeInsertDraft.nodes.length < 3) {
                  return;
                }
                onCreateCustomShape(customShapeInsertDraft.nodes, true);
                setCustomShapeInsertDraft(null);
              }}
            />
          ) : null}
          {draftElement ? (
            <Rect
              dash={[10, 6]}
              fill={editorPrimarySoftColor}
              stroke={editorPrimaryColor}
              strokeWidth={2}
              {...(normalizeDraftRect(draftElement.start, draftElement.end) ?? {
                x: draftElement.start.x,
                y: draftElement.start.y,
                width: 1,
                height: 1,
              })}
            />
          ) : null}
          {selectionDraft ? (
            <Rect
              dash={[8, 5]}
              fill="rgba(37, 99, 235, 0.1)"
              listening={false}
              stroke="#2563eb"
              strokeWidth={1.5}
              {...(normalizeDraftRect(
                selectionDraft.start,
                selectionDraft.end,
              ) ?? {
                x: selectionDraft.start.x,
                y: selectionDraft.start.y,
                width: 1,
                height: 1,
              })}
            />
          ) : null}
          <Transformer
            ref={transformerRef}
            anchorCornerRadius={transformerConfig.anchorCornerRadius}
            anchorFill="#ffffff"
            anchorSize={transformerConfig.anchorSize}
            anchorStroke={editorPrimaryColor}
            anchorStrokeWidth={transformerConfig.anchorStrokeWidth}
            anchorStyleFunc={(anchor: Konva.Rect) => {
              anchor.hitStrokeWidth(transformerConfig.anchorHitStrokeWidth);
            }}
            borderStroke={editorPrimaryColor}
            borderStrokeWidth={transformerConfig.borderStrokeWidth}
            boundBoxFunc={(
              _oldBox: TransformerBox,
              nextBox: TransformerBox,
            ) => ({
              ...nextBox,
              width: Math.max(1, nextBox.width),
              height: Math.max(1, nextBox.height),
            })}
            enabledAnchors={transformerConfig.enabledAnchors}
            flipEnabled={false}
            ignoreStroke
            keepRatio={transformerConfig.keepRatio}
            padding={transformerConfig.padding}
            rotateAnchorOffset={transformerConfig.rotateAnchorOffset}
            rotateEnabled={!canvasInteractionDisabled}
            rotationSnapTolerance={6}
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
          />
        </Layer>
      </Stage>
      {imageCropElement ? (
        <ImageCropOverlay
          frame={{
            x: imageCropElement.x,
            y: imageCropElement.y,
            width: imageCropElement.width,
            height: imageCropElement.height,
            rotation: imageCropElement.rotation,
          }}
          imageProps={imageCropElement.props}
          stageScale={stageScale}
          onApply={(crop) => {
            onCommitElementProps(imageCropElement.elementId, { crop });
            onFinishImageCrop();
          }}
          onCancel={onFinishImageCrop}
          onReset={() => {
            onCommitElementProps(imageCropElement.elementId, { crop: null });
            onFinishImageCrop();
          }}
        />
      ) : null}
      {textToolbarElement &&
      !imageCropElement &&
      insertTool === "select" &&
      !customShapeEditElementId ? (
        <TextContextToolbar
          deck={deck}
          editCompositeId={
            editingElementId === textToolbarElement.elementId
              ? textEditCompositeId
              : undefined
          }
          element={textToolbarElement}
          range={
            activeTextRange?.elementId === textToolbarElement.elementId
              ? activeTextRange
              : null
          }
          readOnly={disableInteractions}
          slide={slide}
          stageElement={containerElement}
          stageScale={stageScale}
          onCommitProps={handleTextToolbarCommit}
          onEditCompositeBlur={(nextTarget) =>
            inlineTextEditorRef.current?.handleCompositeBlur(nextTarget)
          }
          onPreserveRange={() => inlineTextEditorRef.current?.preserveRange()}
        />
      ) : null}
      {!canvasInteractionDisabled && editingElementId ? (
        <>
          <InlineTextEditorOverlay
            deck={deck}
            editCompositeId={textEditCompositeId}
            element={
              visibleElements.find(
                (candidate) => candidate.elementId === editingElementId,
              ) ?? null
            }
            key={editingElementId}
            ref={inlineTextEditorRef}
            slide={slide}
            stageScale={stageScale}
            onCommitProps={onCommitElementProps}
            onDraftPropsChange={(props) =>
              setEditingTextDraft({ elementId: editingElementId, props })
            }
            onFinishEditing={handleInlineTextEditingFinish}
            onRangeChange={(range) =>
              setActiveTextRange(
                range ? { elementId: editingElementId, ...range } : null,
              )
            }
          />
          <InlineDataEditorOverlay
            element={
              visibleElements.find(
                (candidate) => candidate.elementId === editingElementId,
              ) ?? null
            }
            stageScale={stageScale}
            onCommitProps={onCommitElementProps}
            onFinishEditing={handleInlineTextEditingFinish}
          />
        </>
      ) : null}
      {insertTool === "customShape" ? (
        <div className="canvas-mode-hint">
          클릭으로 점 추가, 드래그로 곡선 손잡이 생성, 첫 점 클릭 또는 Enter로
          완료, Esc 취소
        </div>
      ) : customShapeEditDraft ? (
        <div className="canvas-mode-hint">
          점을 드래그해 도형을 다듬고, 더블클릭으로 코너와 곡선을 전환합니다
        </div>
      ) : null}
    </div>
  );
}

function withColorAlpha(color: string, alpha: number) {
  const normalizedHex = color.trim().match(/^#([0-9a-f]{6})$/i)?.[1];
  if (normalizedHex) {
    const red = Number.parseInt(normalizedHex.slice(0, 2), 16);
    const green = Number.parseInt(normalizedHex.slice(2, 4), 16);
    const blue = Number.parseInt(normalizedHex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  const rgbChannels = color
    .trim()
    .match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbChannels) {
    return `rgba(${rgbChannels[1]}, ${rgbChannels[2]}, ${rgbChannels[3]}, ${alpha})`;
  }

  return color;
}
