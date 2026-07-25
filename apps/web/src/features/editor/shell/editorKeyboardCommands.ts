export type EditorKeyboardCommand =
  | { type: "copy-selection" }
  | { type: "delete-selection" }
  | { type: "dismiss-layer"; layer: EditorEscapeLayer }
  | { type: "duplicate-selection" }
  | { type: "navigate-slide"; direction: "next" | "previous" }
  | { type: "nudge-selection"; deltaX: number; deltaY: number }
  | { type: "paste-selection" }
  | { type: "redo" }
  | { type: "save"; canExecute: boolean }
  | { type: "undo" };

export type EditorEscapeLayer =
  | "modal"
  | "menu"
  | "crop-edit"
  | "custom-shape-edit"
  | "inline-text-edit"
  | "insert-tool"
  | "selection";

export type EditorKeyboardCommandInput = {
  altKey?: boolean;
  canMutateDeck: boolean;
  canSaveDeck?: boolean;
  canPaste?: boolean;
  ctrlKey?: boolean;
  defaultPrevented?: boolean;
  hasOpenMenu?: boolean;
  hasOpenModal?: boolean;
  hasSelection?: boolean;
  hasSingleSelection?: boolean;
  isCropEditing?: boolean;
  isCustomShapeEditing?: boolean;
  isInlineTextEditing?: boolean;
  isInsertToolActive?: boolean;
  key: string;
  metaKey?: boolean;
  repeat?: boolean;
  shiftKey?: boolean;
  target?: EventTarget | null;
};

export function resolveEditorKeyboardCommand(
  input: EditorKeyboardCommandInput,
): EditorKeyboardCommand | null {
  if (input.defaultPrevented) {
    return null;
  }

  const isSuppressedTarget = isEditorKeyboardCommandSuppressedTarget(
    input.target ?? null,
  );
  const key = input.key.toLowerCase();
  const hasCommandModifier = Boolean(input.metaKey || input.ctrlKey);
  const isMutationEditingBlocked = Boolean(
    input.isCropEditing ||
      input.isInlineTextEditing ||
      input.isCustomShapeEditing,
  );

  if (input.key === "Escape") {
    const escapeLayer = resolveEditorEscapeLayer(input, isSuppressedTarget);
    return escapeLayer ? { type: "dismiss-layer", layer: escapeLayer } : null;
  }

  if (!input.altKey && hasCommandModifier && key === "s") {
    return {
      canExecute: Boolean(
        (input.canSaveDeck ?? input.canMutateDeck) &&
          !input.repeat &&
          !input.hasOpenModal &&
          !input.hasOpenMenu &&
          !input.isCropEditing &&
          !input.isCustomShapeEditing,
      ),
      type: "save",
    };
  }

  if (isSuppressedTarget || input.hasOpenModal || input.hasOpenMenu) {
    return null;
  }

  const hasUnsupportedNavigationModifier = Boolean(
    input.altKey || input.metaKey || input.ctrlKey,
  );

  if (!hasUnsupportedNavigationModifier && !input.shiftKey) {
    if (input.key === "PageUp") {
      return { direction: "previous", type: "navigate-slide" };
    }
    if (input.key === "PageDown") {
      return { direction: "next", type: "navigate-slide" };
    }
  }

  if (!input.canMutateDeck || isMutationEditingBlocked) {
    return null;
  }

  if (
    input.hasSelection &&
    !input.altKey &&
    !input.metaKey &&
    !input.ctrlKey
  ) {
    const distance = input.shiftKey ? 10 : 1;
    switch (input.key) {
      case "ArrowLeft":
        return { deltaX: -distance, deltaY: 0, type: "nudge-selection" };
      case "ArrowRight":
        return { deltaX: distance, deltaY: 0, type: "nudge-selection" };
      case "ArrowUp":
        return { deltaX: 0, deltaY: -distance, type: "nudge-selection" };
      case "ArrowDown":
        return { deltaX: 0, deltaY: distance, type: "nudge-selection" };
    }
  }

  if (!input.altKey && hasCommandModifier && key === "z") {
    return input.shiftKey ? { type: "redo" } : { type: "undo" };
  }

  if (
    input.hasSelection &&
    !hasCommandModifier &&
    !input.altKey &&
    (input.key === "Delete" || input.key === "Backspace")
  ) {
    return { type: "delete-selection" };
  }

  if (
    input.hasSingleSelection &&
    !input.altKey &&
    hasCommandModifier &&
    key === "d"
  ) {
    return { type: "duplicate-selection" };
  }

  if (!input.altKey && hasCommandModifier && key === "c" && input.hasSingleSelection) {
    return { type: "copy-selection" };
  }

  if (!input.altKey && hasCommandModifier && key === "v" && input.canPaste) {
    return { type: "paste-selection" };
  }

  return null;
}

function resolveEditorEscapeLayer(
  input: EditorKeyboardCommandInput,
  isSuppressedTarget: boolean,
): EditorEscapeLayer | null {
  if (isEditorKeyboardScopeTarget(input.target ?? null)) return null;
  if (input.hasOpenModal) return "modal";
  if (input.hasOpenMenu) return "menu";
  if (input.isCropEditing) return "crop-edit";
  if (input.isCustomShapeEditing) return "custom-shape-edit";
  if (input.isInlineTextEditing) return "inline-text-edit";
  if (input.isInsertToolActive) return "insert-tool";
  if (!isSuppressedTarget && input.hasSelection) return "selection";
  return null;
}

function isEditorKeyboardScopeTarget(target: EventTarget | null) {
  return Boolean(
    getClosestCapableElement(target)?.closest("[data-editor-keyboard-scope]"),
  );
}

export function isEditorKeyboardCommandSuppressedTarget(
  target: EventTarget | null,
) {
  const element = getClosestCapableElement(target);
  if (!element) {
    return false;
  }

  if (element.isContentEditable === true) {
    return true;
  }

  if (
    element.closest(
      "input, textarea, select, dialog, [role='dialog'], [role='menu'], [data-editor-keyboard-owner], [data-editor-keyboard-scope]",
    )
  ) {
    return true;
  }

  const contentEditableAncestor = element.closest("[contenteditable]");
  if (!contentEditableAncestor) {
    return false;
  }

  return contentEditableAncestor.getAttribute?.("contenteditable") !== "false";
}

type ClosestCapableElement = {
  closest: (selector: string) => ClosestCapableElement | null;
  getAttribute?: (name: string) => string | null;
  isContentEditable?: boolean;
};

function getClosestCapableElement(
  target: EventTarget | null,
): ClosestCapableElement | null {
  if (!target || typeof target !== "object") {
    return null;
  }

  const candidate = target as unknown as {
    closest?: ClosestCapableElement["closest"];
    getAttribute?: ClosestCapableElement["getAttribute"];
    isContentEditable?: boolean;
    parentElement?: ClosestCapableElement | null;
  };
  if (typeof candidate.closest === "function") {
    return candidate as ClosestCapableElement;
  }

  return candidate.parentElement?.closest ? candidate.parentElement : null;
}
