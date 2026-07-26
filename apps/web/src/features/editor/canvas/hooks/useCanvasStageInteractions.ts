import type { CustomShapeElementProps } from "@orbit/shared/deck";
import type Konva from "konva";
import { useMemo } from "react";

import {
  createCustomShapeNode,
  type CanvasPoint,
  updateCustomShapeNodeHandle
} from "../custom-shape/geometry";
import type { CustomShapeEditDraft, CustomShapeInsertDraft } from "./types";

export function useCanvasStageInteractions(args: {
  customShapeEditDraft: CustomShapeEditDraft | null;
  draftElement: {
    end: CanvasPoint;
    start: CanvasPoint;
    type: "text" | "rect" | "ellipse" | "line";
  } | null;
  editingElementId: string | null;
  insertTool: "select" | "text" | "rect" | "ellipse" | "line" | "customShape";
  onClearSelection: () => void;
  onCreateElement: (
    draft:
      | { type: "text"; x: number; y: number; width: number; height: number }
      | {
          type: "rect" | "ellipse" | "line";
          x: number;
          y: number;
          width: number;
          height: number;
        }
  ) => void;
  onCreateCustomShape: (nodes: CustomShapeElementProps["nodes"], closed: boolean) => void;
  onMarkTextBlurForClear: () => void;
  normalizeDraftRect: (
    start: { x: number; y: number },
    end: { x: number; y: number }
  ) => { x: number; y: number; width: number; height: number } | null;
  setCustomShapeEditDraft: (
    updater:
      | CustomShapeEditDraft
      | null
      | ((current: CustomShapeEditDraft | null) => CustomShapeEditDraft | null)
  ) => void;
  setCustomShapeInsertDraft: (
    updater:
      | CustomShapeInsertDraft
      | null
      | ((current: CustomShapeInsertDraft | null) => CustomShapeInsertDraft | null)
  ) => void;
  setDraftElement: (
    updater:
      | {
          end: CanvasPoint;
          start: CanvasPoint;
          type: "text" | "rect" | "ellipse" | "line";
        }
      | null
      | ((
          current: {
            end: CanvasPoint;
            start: CanvasPoint;
            type: "text" | "rect" | "ellipse" | "line";
          } | null
        ) =>
          | {
              end: CanvasPoint;
              start: CanvasPoint;
              type: "text" | "rect" | "ellipse" | "line";
            }
          | null)
  ) => void;
  stageScale: number;
}) {
  const {
    customShapeEditDraft,
    draftElement,
    editingElementId,
    insertTool,
    onClearSelection,
    onCreateElement,
    onCreateCustomShape,
    onMarkTextBlurForClear,
    normalizeDraftRect,
    setCustomShapeEditDraft,
    setCustomShapeInsertDraft,
    setDraftElement,
    stageScale
  } = args;

  function getCanvasPointerPosition(event: Konva.KonvaEventObject<MouseEvent>) {
    const pointer = event.target.getStage()?.getPointerPosition();

    if (!pointer) {
      return null;
    }

    return {
      x: pointer.x / stageScale,
      y: pointer.y / stageScale
    };
  }

  return useMemo(
    () => ({
      onMouseDown(event: Konva.KonvaEventObject<MouseEvent>) {
        if (event.target !== event.target.getStage()) {
          return;
        }

        const pointer = getCanvasPointerPosition(event);

        if (!pointer) {
          return;
        }

        if (editingElementId) {
          onMarkTextBlurForClear();
          return;
        }

        if (insertTool === "customShape") {
          setCustomShapeInsertDraft((current) => {
            const nextNodes = [...(current?.nodes ?? []), createCustomShapeNode(pointer)];

            return {
              activeNodeIndex: nextNodes.length - 1,
              nodes: nextNodes,
              pointer
            };
          });
          return;
        }

        if (insertTool !== "select") {
          setDraftElement({
            type: insertTool as "text" | "rect" | "ellipse" | "line",
            start: pointer,
            end: pointer
          });
          return;
        }

        if (customShapeEditDraft?.selectedNodeIndex !== null) {
          setCustomShapeEditDraft((current) =>
            current
              ? {
                  ...current,
                  selectedNodeIndex: null
                }
              : current
          );
          return;
        }

        onClearSelection();
      },
      onMouseMove(event: Konva.KonvaEventObject<MouseEvent>) {
        const pointer = getCanvasPointerPosition(event);

        if (insertTool === "customShape") {
          if (!pointer) {
            return;
          }

          setCustomShapeInsertDraft((current) => {
            if (!current) {
              return current;
            }

            if (current.activeNodeIndex === null) {
              return {
                ...current,
                pointer
              };
            }

            return {
              ...current,
              nodes: current.nodes.map((node, index) =>
                index === current.activeNodeIndex
                  ? updateCustomShapeNodeHandle(node, "out", pointer)
                  : node
              ),
              pointer
            };
          });
          return;
        }

        if (!draftElement || !pointer) {
          return;
        }

        setDraftElement((current) =>
          current
            ? {
                ...current,
                end: pointer
              }
            : current
        );
      },
      onMouseUp() {
        if (insertTool === "customShape") {
          setCustomShapeInsertDraft((current) =>
            current
              ? {
                  ...current,
                  activeNodeIndex: null
                }
              : current
          );
          return;
        }

        if (!draftElement) {
          return;
        }

        const rect = normalizeDraftRect(draftElement.start, draftElement.end);
        setDraftElement(null);

        if (!rect) {
          return;
        }

        onCreateElement({
          type: draftElement.type,
          ...rect
        } as
          | { type: "text"; x: number; y: number; width: number; height: number }
          | {
              type: "rect" | "ellipse" | "line";
              x: number;
              y: number;
              width: number;
              height: number;
            });
      }
    }),
    [
      customShapeEditDraft,
      draftElement,
      editingElementId,
      insertTool,
      onClearSelection,
      onCreateElement,
      onCreateCustomShape,
      onMarkTextBlurForClear,
      normalizeDraftRect,
      setCustomShapeEditDraft,
      setCustomShapeInsertDraft,
      setDraftElement,
      stageScale
    ]
  );
}
