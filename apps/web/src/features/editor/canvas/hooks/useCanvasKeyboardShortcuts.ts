import type { CustomShapeElementProps, DeckElement } from "@orbit/shared/deck";
import { useEffect } from "react";

import { commitCustomShapeEditGeometry } from "../utils/canvasInteractionUtils";
import type { CustomShapeEditDraft, CustomShapeInsertDraft } from "./types";

export function useCanvasKeyboardShortcuts(args: {
  customShapeEditDraft: CustomShapeEditDraft | null;
  customShapeInsertDraft: CustomShapeInsertDraft | null;
  editingCustomShapeElement: DeckElement | null;
  insertTool: "select" | "text" | "rect" | "ellipse" | "line" | "customShape";
  onCommitCustomShapeGeometry: (
    elementId: string,
    nodes: CustomShapeElementProps["nodes"],
    closed: boolean
  ) => void;
  onCreateCustomShape: (nodes: CustomShapeElementProps["nodes"], closed: boolean) => void;
  onSetCustomShapeEditElementId: (elementId: string | null) => void;
  onSetInsertTool: (tool: "select" | "text" | "rect" | "ellipse" | "line" | "customShape") => void;
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
  isKeyboardEditableTarget: (target: EventTarget | null) => boolean;
}) {
  const {
    customShapeEditDraft,
    customShapeInsertDraft,
    editingCustomShapeElement,
    insertTool,
    onCommitCustomShapeGeometry,
    onCreateCustomShape,
    onSetCustomShapeEditElementId,
    onSetInsertTool,
    setCustomShapeEditDraft,
    setCustomShapeInsertDraft,
    isKeyboardEditableTarget
  } = args;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isKeyboardEditableTarget(event.target)) {
        return;
      }

      if (insertTool === "customShape") {
        if (event.key === "Escape") {
          event.preventDefault();
          setCustomShapeInsertDraft(null);
          onSetInsertTool("select");
        }

        if (
          (event.key === "Delete" || event.key === "Backspace") &&
          customShapeInsertDraft &&
          customShapeInsertDraft.nodes.length > 0
        ) {
          event.preventDefault();
          setCustomShapeInsertDraft((current) =>
            current
              ? {
                  ...current,
                  activeNodeIndex: null,
                  nodes: current.nodes.slice(0, -1)
                }
              : current
          );
        }

        if (
          event.key === "Enter" &&
          customShapeInsertDraft &&
          customShapeInsertDraft.nodes.length > 1
        ) {
          event.preventDefault();
          onCreateCustomShape(customShapeInsertDraft.nodes, false);
          setCustomShapeInsertDraft(null);
        }

        return;
      }

      if (!customShapeEditDraft || !editingCustomShapeElement) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();

        if (customShapeEditDraft.selectedNodeIndex !== null) {
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

        onSetCustomShapeEditElementId(null);
        return;
      }

      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        customShapeEditDraft.selectedNodeIndex !== null &&
        customShapeEditDraft.nodes.length > 2
      ) {
        event.preventDefault();
        const nextNodes = customShapeEditDraft.nodes.filter(
          (_, index) => index !== customShapeEditDraft.selectedNodeIndex
        );
        const nextClosed = customShapeEditDraft.closed && nextNodes.length > 2;
        const nextDraft = {
          ...customShapeEditDraft,
          closed: nextClosed,
          nodes: nextNodes,
          selectedNodeIndex:
            nextNodes.length === 0
              ? null
              : Math.min(customShapeEditDraft.selectedNodeIndex, nextNodes.length - 1)
        };

        setCustomShapeEditDraft(nextDraft);
        const nextGeometry = commitCustomShapeEditGeometry({
          draft: nextDraft,
          element: editingCustomShapeElement
        });
        onCommitCustomShapeGeometry(
          nextGeometry.elementId,
          nextGeometry.nodes,
          nextGeometry.closed
        );
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    customShapeEditDraft,
    customShapeInsertDraft,
    editingCustomShapeElement,
    insertTool,
    isKeyboardEditableTarget,
    onCommitCustomShapeGeometry,
    onCreateCustomShape,
    onSetCustomShapeEditElementId,
    onSetInsertTool,
    setCustomShapeEditDraft,
    setCustomShapeInsertDraft
  ]);
}
