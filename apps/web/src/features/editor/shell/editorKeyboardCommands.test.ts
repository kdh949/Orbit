import { describe, expect, it } from "vitest";

import {
  isEditorKeyboardCommandSuppressedTarget,
  resolveEditorKeyboardCommand,
  type EditorKeyboardCommandInput,
} from "./editorKeyboardCommands";

function targetInside(matchedSelector: string | null, contentEditable?: string) {
  const matchedElement = {
    closest: () => null,
    getAttribute: (name: string) =>
      name === "contenteditable" ? (contentEditable ?? null) : null,
  };
  return {
    closest: (selector: string) => {
      if (matchedSelector === "contenteditable") {
        return selector === "[contenteditable]" ? matchedElement : null;
      }
      return matchedSelector && selector.includes(matchedSelector)
        ? matchedElement
        : null;
    },
  } as unknown as EventTarget;
}

function resolve(overrides: Partial<EditorKeyboardCommandInput> = {}) {
  return resolveEditorKeyboardCommand({
    canMutateDeck: true,
    key: "ArrowRight",
    ...overrides,
  });
}

describe("isEditorKeyboardCommandSuppressedTarget", () => {
  it.each([
    "input",
    "textarea",
    "select",
    "dialog",
    "[role='dialog']",
    "[role='menu']",
    "[data-editor-keyboard-owner]",
    "[data-editor-keyboard-scope]",
  ])(
    "suppresses commands inside %s",
    (selector) => {
      expect(isEditorKeyboardCommandSuppressedTarget(targetInside(selector))).toBe(true);
    },
  );

  it("suppresses editable content but not contenteditable=false", () => {
    expect(
      isEditorKeyboardCommandSuppressedTarget(targetInside("contenteditable", "true")),
    ).toBe(true);
    expect(
      isEditorKeyboardCommandSuppressedTarget(targetInside("contenteditable", "")),
    ).toBe(true);
    expect(
      isEditorKeyboardCommandSuppressedTarget(targetInside("contenteditable", "false")),
    ).toBe(false);
  });

  it("supports text-node targets through parentElement and permits canvas targets", () => {
    const parentElement = targetInside("[role='menu']") as unknown as {
      closest: (selector: string) => unknown;
    };
    const textNode = { parentElement } as unknown as EventTarget;

    expect(isEditorKeyboardCommandSuppressedTarget(textNode)).toBe(true);
    expect(isEditorKeyboardCommandSuppressedTarget(targetInside(null))).toBe(false);
    expect(isEditorKeyboardCommandSuppressedTarget(null)).toBe(false);
  });
});

describe("resolveEditorKeyboardCommand", () => {
  it.each([
    ["ArrowLeft", false, { deltaX: -1, deltaY: 0, type: "nudge-selection" }],
    ["ArrowRight", true, { deltaX: 10, deltaY: 0, type: "nudge-selection" }],
    ["ArrowUp", false, { deltaX: 0, deltaY: -1, type: "nudge-selection" }],
    ["ArrowDown", true, { deltaX: 0, deltaY: 10, type: "nudge-selection" }],
  ] as const)("maps %s with shift=%s to a nudge", (key, shiftKey, command) => {
    expect(resolve({ hasSelection: true, key, shiftKey })).toEqual(command);
  });

  it.each([
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
  ])("does not nudge with unsupported modifiers: %o", (modifier) => {
    expect(resolve({ hasSelection: true, ...modifier })).toBeNull();
  });

  it("reserves Cmd/Ctrl+S for all roles but only authorizes mutation roles", () => {
    expect(resolve({ key: "s", metaKey: true })).toEqual({
      canExecute: true,
      type: "save",
    });
    expect(
      resolve({ canMutateDeck: false, ctrlKey: true, key: "S" }),
    ).toEqual({ canExecute: false, type: "save" });
    expect(
      resolve({
        canMutateDeck: false,
        canSaveDeck: true,
        ctrlKey: true,
        isInlineTextEditing: true,
        key: "S",
      }),
    ).toEqual({ canExecute: true, type: "save" });
    expect(
      resolve({
        key: "s",
        metaKey: true,
        target: targetInside("[data-editor-keyboard-scope]"),
      }),
    ).toEqual({ canExecute: true, type: "save" });
    expect(
      resolve({
        hasOpenMenu: true,
        key: "s",
        metaKey: true,
        target: targetInside("[data-editor-keyboard-scope]"),
      }),
    ).toEqual({ canExecute: false, type: "save" });
    expect(
      resolve({ isInlineTextEditing: true, key: "s", metaKey: true }),
    ).toEqual({ canExecute: true, type: "save" });
    expect(
      resolve({ ctrlKey: true, key: "s", repeat: true }),
    ).toEqual({ canExecute: false, type: "save" });
  });

  it("allows role-neutral PageUp and PageDown navigation", () => {
    expect(resolve({ canMutateDeck: false, key: "PageUp" })).toEqual({
      direction: "previous",
      type: "navigate-slide",
    });
    expect(resolve({ canMutateDeck: false, key: "PageDown" })).toEqual({
      direction: "next",
      type: "navigate-slide",
    });
  });

  it("suppresses every command for handled events and dialog/menu targets", () => {
    expect(resolve({ defaultPrevented: true, hasSelection: true })).toBeNull();
    expect(
      resolve({ key: "PageDown", target: targetInside("[role='dialog']") }),
    ).toBeNull();
    expect(
      resolve({ key: "PageDown", target: targetInside("[role='menu']") }),
    ).toBeNull();
    expect(resolve({ hasOpenModal: true, key: "PageDown" })).toBeNull();
    expect(resolve({ hasOpenMenu: true, key: "PageDown" })).toBeNull();
  });

  it.each([
    { isCropEditing: true },
    { isCustomShapeEditing: true },
  ])("suppresses mutation shortcuts during an editing mode: %o", (editingMode) => {
    expect(resolve({ hasSelection: true, ...editingMode })).toBeNull();
    expect(resolve({ key: "s", metaKey: true, ...editingMode })).toEqual({
      canExecute: false,
      type: "save",
    });
    expect(resolve({ key: "z", metaKey: true, ...editingMode })).toBeNull();
    expect(resolve({ hasSelection: true, key: "Delete", ...editingMode })).toBeNull();
  });

  it("allows Save to commit an inline draft while suppressing other mutation shortcuts", () => {
    const editingMode = { isInlineTextEditing: true };
    expect(resolve({ key: "s", metaKey: true, ...editingMode })).toEqual({
      canExecute: true,
      type: "save",
    });
    expect(resolve({ key: "z", metaKey: true, ...editingMode })).toBeNull();
    expect(
      resolve({ hasSelection: true, key: "Delete", ...editingMode }),
    ).toBeNull();
  });

  it("denies Viewer mutation commands", () => {
    expect(
      resolve({ canMutateDeck: false, hasSelection: true, key: "ArrowRight" }),
    ).toBeNull();
    expect(
      resolve({ canMutateDeck: false, hasSelection: true, key: "Delete" }),
    ).toBeNull();
    expect(
      resolve({ canMutateDeck: false, key: "z", metaKey: true }),
    ).toBeNull();
  });

  it("maps existing selection shortcuts behind capability and selection state", () => {
    expect(resolve({ key: "z", metaKey: true })).toEqual({ type: "undo" });
    expect(resolve({ key: "z", metaKey: true, shiftKey: true })).toEqual({
      type: "redo",
    });
    expect(resolve({ hasSelection: true, key: "Delete" })).toEqual({
      type: "delete-selection",
    });
    expect(resolve({ ctrlKey: true, hasSingleSelection: true, key: "d" })).toEqual({
      type: "duplicate-selection",
    });
    expect(resolve({ canPaste: true, ctrlKey: true, key: "v" })).toEqual({
      type: "paste-selection",
    });
  });

  it("resolves only the highest Escape ownership layer", () => {
    const allLayers = {
      hasOpenMenu: true,
      hasOpenModal: true,
      hasSelection: true,
      isCropEditing: true,
      isCustomShapeEditing: true,
      isInlineTextEditing: true,
      isInsertToolActive: true,
      key: "Escape",
    };

    expect(resolve(allLayers)).toEqual({ type: "dismiss-layer", layer: "modal" });
    expect(resolve({ ...allLayers, hasOpenModal: false })).toEqual({
      type: "dismiss-layer",
      layer: "menu",
    });
    expect(resolve({
      ...allLayers,
      hasOpenMenu: false,
      hasOpenModal: false,
    })).toEqual({ type: "dismiss-layer", layer: "crop-edit" });
    expect(resolve({
      ...allLayers,
      hasOpenMenu: false,
      hasOpenModal: false,
      isCropEditing: false,
    })).toEqual({ type: "dismiss-layer", layer: "custom-shape-edit" });
  });

  it("preserves editable target ownership unless a known layer is open", () => {
    expect(resolve({
      hasSelection: true,
      key: "Escape",
      target: targetInside("input"),
    })).toBeNull();
    expect(resolve({
      hasOpenModal: true,
      key: "Escape",
      target: targetInside("[role='dialog']"),
    })).toEqual({ type: "dismiss-layer", layer: "modal" });
  });

  it("leaves Escape handling to a focused popup or inspector scope", () => {
    expect(
      resolve({
        hasOpenMenu: true,
        hasSelection: true,
        key: "Escape",
        target: targetInside("[data-editor-keyboard-scope]"),
      }),
    ).toBeNull();
    expect(
      resolve({
        hasSelection: true,
        key: "Escape",
        target: targetInside("[data-editor-keyboard-scope]"),
      }),
    ).toBeNull();
  });
});
