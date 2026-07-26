import type {
  CustomShapeElementProps,
  CustomShapeNode,
} from "@orbit/shared/deck";
import type Konva from "konva";
import {
  Circle as KonvaCircle,
  Group as KonvaGroup,
  Line as KonvaLine,
  Shape as KonvaShape
} from "react-konva";
import type { ComponentType } from "react";

import {
  buildCustomShapePathDataFromNodes,
  createCustomShapeNode,
  getCustomShapeDimension,
  moveCustomShapeNode,
  toggleCustomShapeNodeMode,
  type CanvasPoint,
  updateCustomShapeNodeHandle
} from "../custom-shape/geometry";
import { drawCustomShapeScene, getCustomShapeDataArray } from "../custom-shape/render";

type KonvaComponent = ComponentType<any>;

const Circle = KonvaCircle as unknown as KonvaComponent;
const Group = KonvaGroup as unknown as KonvaComponent;
const Line = KonvaLine as unknown as KonvaComponent;
const Shape = KonvaShape as unknown as KonvaComponent;

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

export function CustomShapeInsertOverlay(props: {
  draft: CustomShapeInsertDraft;
  primaryColor: string;
  primaryMediumColor: string;
  primarySoftColor: string;
  onClosePath: () => void;
}) {
  const {
    draft,
    onClosePath,
    primaryColor,
    primaryMediumColor,
    primarySoftColor
  } = props;
  const previewNodes =
    draft.pointer && draft.activeNodeIndex === null && draft.nodes.length > 0
      ? [...draft.nodes, createCustomShapeNode(draft.pointer)]
      : draft.nodes;
  const previewPathData = buildCustomShapePathDataFromNodes(previewNodes, false);
  const previewDataArray = getCustomShapeDataArray(previewPathData);

  return (
    <>
      {previewDataArray.length > 0 ? (
        <Shape
          fillEnabled={false}
          lineCap="round"
          lineJoin="round"
          sceneFunc={(context: Konva.Context, shape: Konva.Shape) =>
            drawCustomShapeScene(context, shape, previewDataArray)
          }
          stroke={primaryColor}
          strokeWidth={2}
        />
      ) : null}
      {draft.nodes.map((node, index) => {
        const isClosableStart = index === 0 && draft.nodes.length > 2;

        return (
          <Group key={`draft-node-${index}`}>
            {typeof node.outX === "number" && typeof node.outY === "number" ? (
              <Line
                dash={[4, 4]}
                points={[node.x, node.y, node.outX, node.outY]}
                stroke={primaryMediumColor}
                strokeWidth={1}
              />
            ) : null}
            {typeof node.outX === "number" && typeof node.outY === "number" ? (
              <Circle
                fill={primarySoftColor}
                listening={false}
                radius={4}
                stroke={primaryColor}
                strokeWidth={1.5}
                x={node.outX}
                y={node.outY}
              />
            ) : null}
            <Circle
              fill={isClosableStart ? "#dcfce7" : "#ffffff"}
              radius={isClosableStart ? 7 : 6}
              stroke={isClosableStart ? "#16a34a" : primaryColor}
              strokeWidth={2}
              x={node.x}
              y={node.y}
              onClick={(event: Konva.KonvaEventObject<MouseEvent>) => {
                if (!isClosableStart) {
                  return;
                }
                event.cancelBubble = true;
                onClosePath();
              }}
            />
          </Group>
        );
      })}
    </>
  );
}

export function CustomShapeEditOverlay(props: {
  draft: CustomShapeEditDraft;
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
  primaryColor: string;
  primaryMediumColor: string;
  primarySoftColor: string;
  onChangeDraft: (draft: CustomShapeEditDraft | null) => void;
  onCommitDraft: (draft: CustomShapeEditDraft) => void;
  viewBoxHeight: number;
  viewBoxWidth: number;
}) {
  const {
    draft,
    frame,
    onChangeDraft,
    onCommitDraft,
    primaryColor,
    primaryMediumColor,
    primarySoftColor,
    viewBoxHeight,
    viewBoxWidth
  } = props;
  const scaleX = frame.width / Math.max(1, viewBoxWidth);
  const scaleY = frame.height / Math.max(1, viewBoxHeight);
  const handleLength = Math.max(18, Math.min(viewBoxWidth, viewBoxHeight) * 0.08);

  function toDisplayPoint(point: CanvasPoint) {
    return {
      x: point.x * scaleX,
      y: point.y * scaleY
    };
  }

  function toLocalPoint(point: CanvasPoint) {
    return {
      x: point.x / Math.max(scaleX, 0.0001),
      y: point.y / Math.max(scaleY, 0.0001)
    };
  }

  function updateDraft(
    updater: (current: CustomShapeEditDraft) => CustomShapeEditDraft,
    options?: { commit?: boolean }
  ) {
    const nextDraft = updater(draft);
    onChangeDraft(nextDraft);

    if (options?.commit) {
      onCommitDraft(nextDraft);
    }
  }

  return (
    <Group>
      {draft.nodes.map((node, index) => {
        const displayNode = toDisplayPoint({ x: node.x, y: node.y });
        const displayIn =
          typeof node.inX === "number" && typeof node.inY === "number"
            ? toDisplayPoint({ x: node.inX, y: node.inY })
            : null;
        const displayOut =
          typeof node.outX === "number" && typeof node.outY === "number"
            ? toDisplayPoint({ x: node.outX, y: node.outY })
            : null;
        const isSelected = draft.selectedNodeIndex === index;

        return (
          <Group key={`${draft.elementId}-node-${index}`}>
            {displayIn ? (
              <Line
                dash={[4, 4]}
                points={[displayNode.x, displayNode.y, displayIn.x, displayIn.y]}
                stroke={primaryMediumColor}
                strokeWidth={1}
              />
            ) : null}
            {displayOut ? (
              <Line
                dash={[4, 4]}
                points={[displayNode.x, displayNode.y, displayOut.x, displayOut.y]}
                stroke={primaryMediumColor}
                strokeWidth={1}
              />
            ) : null}
            {displayIn ? (
              <Circle
                draggable
                fill={primarySoftColor}
                radius={4.5}
                stroke={primaryColor}
                strokeWidth={1.5}
                x={displayIn.x}
                y={displayIn.y}
                onClick={(event: Konva.KonvaEventObject<MouseEvent>) => {
                  event.cancelBubble = true;
                  updateDraft((current) => ({
                    ...current,
                    selectedNodeIndex: index
                  }));
                }}
                onDragMove={(event: Konva.KonvaEventObject<DragEvent>) => {
                  event.cancelBubble = true;
                  updateDraft((current) => ({
                    ...current,
                    selectedNodeIndex: index,
                    nodes: current.nodes.map((currentNode, currentIndex) =>
                      currentIndex === index
                        ? updateCustomShapeNodeHandle(
                            currentNode,
                            "in",
                            toLocalPoint({
                              x: event.target.x(),
                              y: event.target.y()
                            })
                          )
                        : currentNode
                    )
                  }));
                }}
                onDragEnd={(event: Konva.KonvaEventObject<DragEvent>) => {
                  event.cancelBubble = true;
                  updateDraft(
                    (current) => ({
                      ...current,
                      selectedNodeIndex: index,
                      nodes: current.nodes.map((currentNode, currentIndex) =>
                        currentIndex === index
                          ? updateCustomShapeNodeHandle(
                              currentNode,
                              "in",
                              toLocalPoint({
                                x: event.target.x(),
                                y: event.target.y()
                              })
                            )
                          : currentNode
                      )
                    }),
                    { commit: true }
                  );
                }}
              />
            ) : null}
            {displayOut ? (
              <Circle
                draggable
                fill={primarySoftColor}
                radius={4.5}
                stroke={primaryColor}
                strokeWidth={1.5}
                x={displayOut.x}
                y={displayOut.y}
                onClick={(event: Konva.KonvaEventObject<MouseEvent>) => {
                  event.cancelBubble = true;
                  updateDraft((current) => ({
                    ...current,
                    selectedNodeIndex: index
                  }));
                }}
                onDragMove={(event: Konva.KonvaEventObject<DragEvent>) => {
                  event.cancelBubble = true;
                  updateDraft((current) => ({
                    ...current,
                    selectedNodeIndex: index,
                    nodes: current.nodes.map((currentNode, currentIndex) =>
                      currentIndex === index
                        ? updateCustomShapeNodeHandle(
                            currentNode,
                            "out",
                            toLocalPoint({
                              x: event.target.x(),
                              y: event.target.y()
                            })
                          )
                        : currentNode
                    )
                  }));
                }}
                onDragEnd={(event: Konva.KonvaEventObject<DragEvent>) => {
                  event.cancelBubble = true;
                  updateDraft(
                    (current) => ({
                      ...current,
                      selectedNodeIndex: index,
                      nodes: current.nodes.map((currentNode, currentIndex) =>
                        currentIndex === index
                          ? updateCustomShapeNodeHandle(
                              currentNode,
                              "out",
                              toLocalPoint({
                                x: event.target.x(),
                                y: event.target.y()
                              })
                            )
                          : currentNode
                      )
                    }),
                    { commit: true }
                  );
                }}
              />
            ) : null}
            <Circle
              draggable
              fill={isSelected ? primaryColor : "#ffffff"}
              radius={7}
              stroke={primaryColor}
              strokeWidth={2}
              x={displayNode.x}
              y={displayNode.y}
              onClick={(event: Konva.KonvaEventObject<MouseEvent>) => {
                event.cancelBubble = true;
                updateDraft((current) => ({
                  ...current,
                  selectedNodeIndex: index
                }));
              }}
              onDblClick={(event: Konva.KonvaEventObject<MouseEvent>) => {
                event.cancelBubble = true;
                updateDraft(
                  (current) => ({
                    ...current,
                    selectedNodeIndex: index,
                    nodes: current.nodes.map((currentNode, currentIndex) =>
                      currentIndex === index
                        ? toggleCustomShapeNodeMode(currentNode, handleLength)
                        : currentNode
                    )
                  }),
                  { commit: true }
                );
              }}
              onDragMove={(event: Konva.KonvaEventObject<DragEvent>) => {
                event.cancelBubble = true;
                updateDraft((current) => ({
                  ...current,
                  selectedNodeIndex: index,
                  nodes: current.nodes.map((currentNode, currentIndex) =>
                    currentIndex === index
                      ? moveCustomShapeNode(
                          currentNode,
                          toLocalPoint({
                            x: event.target.x(),
                            y: event.target.y()
                          })
                        )
                      : currentNode
                  )
                }));
              }}
              onDragEnd={(event: Konva.KonvaEventObject<DragEvent>) => {
                event.cancelBubble = true;
                updateDraft(
                  (current) => ({
                    ...current,
                    selectedNodeIndex: index,
                    nodes: current.nodes.map((currentNode, currentIndex) =>
                      currentIndex === index
                        ? moveCustomShapeNode(
                            currentNode,
                            toLocalPoint({
                              x: event.target.x(),
                              y: event.target.y()
                            })
                          )
                        : currentNode
                    )
                  }),
                  { commit: true }
                );
              }}
            />
          </Group>
        );
      })}
    </Group>
  );
}

export function getCustomShapeOverlayViewBox(args: {
  elementProps: CustomShapeElementProps;
  frame: { width: number; height: number };
}) {
  return {
    viewBoxHeight: getCustomShapeDimension(
      args.elementProps,
      "viewBoxHeight",
      args.frame.height
    ),
    viewBoxWidth: getCustomShapeDimension(
      args.elementProps,
      "viewBoxWidth",
      args.frame.width
    )
  };
}
