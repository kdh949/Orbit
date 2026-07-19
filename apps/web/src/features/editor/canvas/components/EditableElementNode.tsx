import type {
  CustomShapeElementProps,
  Deck,
  DeckElement,
  GroupElementProps,
  Slide,
  TextElementProps,
} from "@orbit/shared";
import { getGroupChildElements } from "../../../../../../../packages/editor-core/src/index";
import type Konva from "konva";
import {
  Group as KonvaGroup,
  Rect as KonvaRect,
  Text as KonvaText,
} from "react-konva";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import type { ElementPresentationState } from "../../../slides/rendering";

import {
  CustomShapeEditOverlay,
  getCustomShapeOverlayViewBox,
} from "./CustomShapeOverlays";
import { ElementNodeContent } from "./ElementNodeContent";
import { useEditorShellUiStore } from "../../shell/editorShellUiStore";
import { TableCellHitTargets } from "../table/TableCellHitTargets";
import { getTextElementLayout } from "../text/textLayout";
import {
  CANVAS_ID_BADGE_FONT_SIZE,
  CANVAS_ID_BADGE_HEIGHT,
  CANVAS_ID_BADGE_PADDING,
  getCanvasIdBadgeOffset,
  getCanvasIdBadgeWidth,
  getDisplayIdLabel,
  getGroupedChildPreviewFrame,
} from "../utils/canvasElementUtils";
import {
  canDragCanvasElement,
  getSnappedElementPosition,
  type CanvasSnapGuide
} from "../utils/canvasInteractionUtils";
import { resolveTransformedElementFrame } from "../utils/selectionTransformer";

type KonvaComponent = ComponentType<any>;

const Group = KonvaGroup as unknown as KonvaComponent;
const Rect = KonvaRect as unknown as KonvaComponent;
const Text = KonvaText as unknown as KonvaComponent;

type CustomShapeEditDraft = {
  closed: boolean;
  elementId: string;
  nodes: CustomShapeElementProps["nodes"];
  selectedNodeIndex: number | null;
};

export function EditableElementNode(props: {
  accentColor: string;
  customShapeEditDraft: CustomShapeEditDraft | null;
  deck: Deck;
  disablePointerEvents: boolean;
  element: DeckElement;
  hideContent?: boolean;
  editorPrimaryColor: string;
  editorPrimaryMediumColor: string;
  editorPrimarySoftColor: string;
  isSelected: boolean;
  presentationState?: ElementPresentationState;
  selectedCount: number;
  showIds: boolean;
  slide: Slide;
  stageScale: number;
  onChangeCustomShapeEditDraft: (draft: CustomShapeEditDraft | null) => void;
  onDoubleClick: () => void;
  onCommitCustomShapeEditDraft: (draft: CustomShapeEditDraft) => void;
  onCommitFrame: (frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  }) => void;
  onMountNode: (node: Konva.Group | null) => void;
  onOpenContextMenu: (clientX: number, clientY: number) => void;
  onSelect: (append: boolean) => void;
  onSnapGuidesChange: (guides: CanvasSnapGuide[]) => void;
  snapThreshold: number;
}) {
  const {
    accentColor,
    customShapeEditDraft,
    deck,
    disablePointerEvents,
    element,
    hideContent = false,
    editorPrimaryColor,
    editorPrimaryMediumColor,
    editorPrimarySoftColor,
    isSelected,
    presentationState,
    selectedCount,
    showIds,
    slide,
    stageScale,
    onChangeCustomShapeEditDraft,
    onDoubleClick,
    onCommitCustomShapeEditDraft,
    onCommitFrame,
    onMountNode,
    onOpenContextMenu,
    onSelect,
    onSnapGuidesChange,
    snapThreshold,
  } = props;
  const editingElementId = useEditorShellUiStore(
    (state) => state.editingElementId
  );
  const [previewFrame, setPreviewFrame] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  } | null>(null);
  const frame = previewFrame ?? {
    x: presentationState?.x ?? element.x,
    y: presentationState?.y ?? element.y,
    width: presentationState?.width ?? element.width,
    height: presentationState?.height ?? element.height,
    rotation: presentationState?.rotation ?? element.rotation
  };
  const isMultiSelected = isSelected && selectedCount > 1;
  const selectionStroke = isSelected ? editorPrimaryColor : "transparent";
  const selectionStrokeWidth = isSelected ? (isMultiSelected ? 3 : 2) : 0;
  const selectionDash = isMultiSelected ? [12, 6] : undefined;
  const elementIdLabel = getDisplayIdLabel(element.elementId);
  const canvasIdBadgeWidth = getCanvasIdBadgeWidth(elementIdLabel);
  const canvasIdBadgeOffset = getCanvasIdBadgeOffset({
    badgeHeight: CANVAS_ID_BADGE_HEIGHT,
    badgeWidth: canvasIdBadgeWidth,
    canvas: deck.canvas,
    frame,
  });

  useEffect(() => {
    setPreviewFrame(null);
  }, [element.height, element.rotation, element.width, element.x, element.y]);

  function handlePointerSelect(append: boolean) {
    if (
      !append &&
      element.type === "text" &&
      isSelected &&
      selectedCount === 1
    ) {
      onDoubleClick();
      return;
    }

    onSelect(append);
  }

  return (
    <Group
      draggable={
        canDragCanvasElement({
          interactionDisabled: disablePointerEvents,
          isCustomShapeEditing:
            Boolean(customShapeEditDraft) ||
            (element.type === "table" && editingElementId === element.elementId),
          isSelected,
          locked: element.locked
        })
      }
      listening={!disablePointerEvents}
      opacity={
        (presentationState?.visible ?? element.visible)
          ? (presentationState?.opacity ?? element.opacity)
          : 0
      }
      ref={onMountNode}
      rotation={frame.rotation}
      scaleX={presentationState?.scaleX ?? 1}
      scaleY={presentationState?.scaleY ?? 1}
      x={frame.x}
      y={frame.y}
      onClick={(event: Konva.KonvaEventObject<MouseEvent>) => {
        if (event.evt.button !== 0) return;
        handlePointerSelect(Boolean(event.evt.shiftKey));
      }}
      onMouseDown={(event: Konva.KonvaEventObject<MouseEvent>) => {
        if (event.evt.button !== 0 || isSelected) return;
        onSelect(Boolean(event.evt.shiftKey));
      }}
      onContextMenu={(event: Konva.KonvaEventObject<PointerEvent>) => {
        const shouldKeepSelection = isSelected && selectedCount > 1;

        if (
          element.type !== "image" &&
          element.type !== "group" &&
          element.type !== "table" &&
          !shouldKeepSelection
        ) {
          return;
        }

        event.evt.preventDefault();
        event.cancelBubble = true;
        if (!shouldKeepSelection) {
          onSelect(false);
        }
        onOpenContextMenu(event.evt.clientX, event.evt.clientY);
      }}
      onDblClick={() => {
        if (element.type === "text" || element.type === "chart") {
          onDoubleClick();
        }
      }}
      onDragMove={(event: Konva.KonvaEventObject<DragEvent>) => {
        if (event.evt.altKey) {
          onSnapGuidesChange([]);
          return;
        }
        const snapped = getSnappedElementPosition({
          canvas: deck.canvas,
          elementId: element.elementId,
          elements: slide.elements,
          frame: {
            x: event.target.x(),
            y: event.target.y(),
            width: frame.width,
            height: frame.height
          },
          threshold: snapThreshold
        });
        event.target.position({ x: snapped.x, y: snapped.y });
        onSnapGuidesChange(snapped.guides);
      }}
      onDragEnd={(event: Konva.KonvaEventObject<DragEvent>) => {
        onSnapGuidesChange([]);
        setPreviewFrame(null);
        onCommitFrame({
          x: event.target.x(),
          y: event.target.y(),
          width: frame.width,
          height: frame.height,
          rotation: event.target.rotation(),
        });
      }}
      onTap={() => handlePointerSelect(false)}
      onTransform={(event: Konva.KonvaEventObject<Event>) => {
        if (element.type !== "text") {
          return;
        }

        const node = event.target;
        const nextFrame = resolveTransformedElementFrame({
          frame,
          transform: {
            x: node.x(),
            y: node.y(),
            scaleX: node.scaleX(),
            scaleY: node.scaleY(),
            rotation: node.rotation(),
          },
        });

        node.scaleX(1);
        node.scaleY(1);
        setPreviewFrame(nextFrame);
      }}
      onTransformEnd={(event: Konva.KonvaEventObject<Event>) => {
        const node = event.target;
        const nextFrame = resolveTransformedElementFrame({
          frame,
          transform: {
            x: node.x(),
            y: node.y(),
            scaleX: node.scaleX(),
            scaleY: node.scaleY(),
            rotation: node.rotation(),
          },
        });

        node.scaleX(1);
        node.scaleY(1);

        setPreviewFrame(null);
        onCommitFrame(nextFrame);
      }}
    >
      <Rect
        cornerRadius={10}
        dash={selectionDash}
        fill="transparent"
        listening={false}
        stroke={selectionStroke}
        strokeWidth={selectionStrokeWidth}
        width={frame.width}
        height={frame.height}
      />
      {hideContent ? null : (
        <ElementNodeContent
          accentColor={accentColor}
          customShapePreview={customShapeEditDraft}
          deck={deck}
          element={element}
          frame={frame}
          slide={slide}
        />
      )}
      {element.type === "table" ? (
        <TableCellHitTargets
          deck={deck}
          disabled={disablePointerEvents}
          element={element}
          frame={frame}
          isSelected={isSelected}
          selectionColor={editorPrimaryColor}
          slide={slide}
          stageScale={stageScale}
          onOpenContextMenu={onOpenContextMenu}
          onSelect={onSelect}
        />
      ) : (
        <ElementInteractionHitTargets
          deck={deck}
          element={element}
          frame={frame}
          slide={slide}
        />
      )}
      {customShapeEditDraft && element.type === "customShape" ? (
        <CustomShapeEditOverlay
          draft={customShapeEditDraft}
          frame={frame}
          primaryColor={editorPrimaryColor}
          primaryMediumColor={editorPrimaryMediumColor}
          primarySoftColor={editorPrimarySoftColor}
          onChangeDraft={onChangeCustomShapeEditDraft}
          onCommitDraft={onCommitCustomShapeEditDraft}
          {...getCustomShapeOverlayViewBox({
            elementProps: element.props as CustomShapeElementProps,
            frame,
          })}
        />
      ) : null}
      {showIds ? (
        <Group
          listening={false}
          rotation={-frame.rotation}
          x={canvasIdBadgeOffset.x}
          y={canvasIdBadgeOffset.y}
        >
          <Rect
            cornerRadius={18}
            fill="rgba(255, 255, 255, 0.98)"
            height={CANVAS_ID_BADGE_HEIGHT}
            shadowBlur={14}
            shadowColor="rgba(15, 23, 42, 0.18)"
            shadowOpacity={0.28}
            stroke={editorPrimaryColor}
            strokeWidth={1.5}
            width={canvasIdBadgeWidth}
          />
          <Text
            fill="#0f172a"
            fontSize={CANVAS_ID_BADGE_FONT_SIZE}
            fontStyle="bold"
            padding={CANVAS_ID_BADGE_PADDING}
            text={elementIdLabel}
            width={canvasIdBadgeWidth}
          />
        </Group>
      ) : null}
    </Group>
  );
}

function ElementInteractionHitTargets(props: {
  deck: Deck;
  element: DeckElement;
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
  slide: Slide;
}) {
  const { deck, element, frame, slide } = props;
  const hitFill = "rgba(15, 23, 42, 0.001)";

  if (element.type === "group") {
    const groupProps = element.props as GroupElementProps;
    const childElements = getGroupChildElements(
      slide,
      groupProps.childElementIds,
    );

    return (
      <>
        {childElements.map((childElement) => {
          const childFrame = getGroupedChildPreviewFrame({
            childElement,
            currentGroupFrame: element,
            previewGroupFrame: frame,
          });

          return (
            <Group
              key={`group-hit-${childElement.elementId}`}
              rotation={childFrame.rotation}
              x={childFrame.x}
              y={childFrame.y}
            >
              <Rect
                fill={hitFill}
                width={Math.max(1, childFrame.width)}
                height={Math.max(1, childFrame.height)}
              />
            </Group>
          );
        })}
      </>
    );
  }

  if (element.type === "text") {
    const textLayout = getTextElementLayout({
      frame,
      props: element.props as TextElementProps,
      slide,
      theme: deck.theme,
    });

    return (
      <Rect
        fill={hitFill}
        x={textLayout.contentX}
        y={textLayout.y}
        width={Math.max(24, textLayout.contentWidth)}
        height={Math.max(1, textLayout.contentHeight)}
      />
    );
  }

  return (
    <Rect
      fill={hitFill}
      width={Math.max(1, frame.width)}
      height={Math.max(1, frame.height)}
    />
  );
}
