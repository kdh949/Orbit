import type { DeckElement } from "@orbit/shared/deck";
import { useEffect } from "react";

import {
  isEditorKeyboardCommandSuppressedTarget,
  resolveEditorKeyboardCommand,
  type EditorEscapeLayer,
} from "../editorKeyboardCommands";
import { getEditorClipboardImageFiles } from "../utils/editorClipboard";

export type EditorPasteAction =
  | { type: "native" }
  | { files: File[]; type: "paste-image" }
  | { type: "paste-element" };

export function isEditorKeyboardCompositionEvent(
  event: Pick<KeyboardEvent, "isComposing" | "keyCode">,
) {
  return event.isComposing || event.keyCode === 229;
}

export function isEditorSaveShortcut(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey"> &
    Partial<Pick<KeyboardEvent, "repeat">>,
) {
  return (
    !event.altKey &&
    !event.repeat &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "s"
  );
}

function isEditorSaveKeyCombination(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey">,
) {
  return (
    !event.altKey &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "s"
  );
}

export function resolveEditorPasteAction(input: {
  canMutateDeck: boolean;
  canPasteImage: boolean;
  clipboardData: Pick<DataTransfer, "files" | "items"> | null;
  defaultPrevented: boolean;
  editingElementId: string | null;
  hasCopiedElement: boolean;
  hasOpenMenu: boolean;
  hasOpenModal: boolean;
  isCropEditing: boolean;
  isCustomShapeEditingSelection: boolean;
  target: EventTarget | null;
}): EditorPasteAction {
  if (
    input.defaultPrevented ||
    input.editingElementId ||
    input.hasOpenMenu ||
    input.hasOpenModal ||
    input.isCropEditing ||
    input.isCustomShapeEditingSelection ||
    isEditorKeyboardCommandSuppressedTarget(input.target)
  ) {
    return { type: "native" };
  }

  if (!input.canMutateDeck) return { type: "native" };

  const files = getEditorClipboardImageFiles(input.clipboardData);
  if (files.length > 0) {
    return input.canPasteImage
      ? { files, type: "paste-image" }
      : { type: "native" };
  }

  return input.hasCopiedElement
    ? { type: "paste-element" }
    : { type: "native" };
}

export function useEditorKeyboardShortcuts(args: {
  canMutateDeck: boolean;
  canPasteImage: boolean;
  copiedElementRef: { current: unknown };
  editingElementId: string | null;
  hasOpenMenu: boolean;
  hasOpenModal: boolean;
  insertToolActive: boolean;
  isCropEditing?: boolean;
  isCustomShapeEditingSelection: boolean;
  onCopy: () => void;
  onCommitInlineTextEditing: () => void;
  onDelete: () => void;
  onDismissLayer: (layer: EditorEscapeLayer) => void;
  onDuplicate: () => void;
  onNavigateSlide: (direction: "next" | "previous") => void;
  onNudge: (deltaX: number, deltaY: number) => void;
  onPaste: () => void;
  onPasteImageFiles: (files: File[]) => void;
  onRedo: () => void;
  onSave: () => void;
  onUndo: () => void;
  selectedElement: DeckElement | null;
  selectedElementIds: string[];
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat && isEditorSaveKeyCombination(event)) {
        event.preventDefault();
        return;
      }

      if (isEditorKeyboardCompositionEvent(event)) {
        if (isEditorSaveShortcut(event)) event.preventDefault();
        return;
      }

      const command = resolveEditorKeyboardCommand({
        altKey: event.altKey,
        canMutateDeck: args.canMutateDeck,
        canPaste: Boolean(args.copiedElementRef.current),
        ctrlKey: event.ctrlKey,
        defaultPrevented: event.defaultPrevented,
        hasOpenMenu: args.hasOpenMenu,
        hasOpenModal: args.hasOpenModal,
        hasSelection: args.selectedElementIds.length > 0,
        hasSingleSelection: Boolean(args.selectedElement),
        isCropEditing: args.isCropEditing,
        isCustomShapeEditing: args.isCustomShapeEditingSelection,
        isInlineTextEditing: Boolean(args.editingElementId),
        isInsertToolActive: args.insertToolActive,
        key: event.key,
        metaKey: event.metaKey,
        repeat: event.repeat,
        shiftKey: event.shiftKey,
        target: event.target,
      });

      if (command?.type === "paste-selection") return;
      if (!command) return;

      event.preventDefault();
      switch (command.type) {
        case "copy-selection": args.onCopy(); break;
        case "delete-selection": args.onDelete(); break;
        case "dismiss-layer": args.onDismissLayer(command.layer); break;
        case "duplicate-selection": args.onDuplicate(); break;
        case "navigate-slide": args.onNavigateSlide(command.direction); break;
        case "nudge-selection": args.onNudge(command.deltaX, command.deltaY); break;
        case "redo": args.onRedo(); break;
        case "save":
          if (command.canExecute) {
            if (args.editingElementId) args.onCommitInlineTextEditing();
            args.onSave();
          }
          break;
        case "undo": args.onUndo(); break;
      }
      if (command.type !== "save") event.stopImmediatePropagation();
    }

    function handlePaste(event: ClipboardEvent) {
      const action = resolveEditorPasteAction({
        canMutateDeck: args.canMutateDeck,
        canPasteImage: args.canPasteImage,
        clipboardData: event.clipboardData,
        defaultPrevented: event.defaultPrevented,
        editingElementId: args.editingElementId,
        hasCopiedElement: Boolean(args.copiedElementRef.current),
        hasOpenMenu: args.hasOpenMenu,
        hasOpenModal: args.hasOpenModal,
        isCropEditing: Boolean(args.isCropEditing),
        isCustomShapeEditingSelection: args.isCustomShapeEditingSelection,
        target: event.target
      });
      if (action.type === "native") return;

      event.preventDefault();
      if (action.type === "paste-image") {
        args.onPasteImageFiles(action.files);
      } else {
        args.onPaste();
      }
      event.stopImmediatePropagation();
    }

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("paste", handlePaste, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("paste", handlePaste, true);
    };
  }, [args]);
}
