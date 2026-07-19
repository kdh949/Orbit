import { describe, expect, it, vi } from "vitest";

import { createTableCellEditSession } from "./TableCellEditorOverlay";

function keyEvent(
  overrides: Partial<{
    ctrlKey: boolean;
    isComposing: boolean;
    key: string;
    keyCode: number;
    metaKey: boolean;
  }> = {}
) {
  return {
    ctrlKey: false,
    isComposing: false,
    key: "Enter",
    keyCode: 13,
    metaKey: false,
    preventDefault: vi.fn(),
    ...overrides
  };
}

describe("TableCellEditorOverlay IME-safe edit session", () => {
  it("commits the latest Korean composition exactly once on Cmd+Enter", () => {
    const onCommit = vi.fn();
    const onFinish = vi.fn();
    const session = createTableCellEditSession({
      initialText: "초기",
      onCommit,
      onFinish
    });

    session.handleCompositionStart();
    session.replaceText("한");
    session.handleKeyDown(
      keyEvent({ isComposing: true, keyCode: 229, metaKey: true })
    );
    expect(onCommit).not.toHaveBeenCalled();

    session.replaceText("한글");
    session.handleCompositionEnd();
    session.handleKeyDown(keyEvent({ metaKey: true }));
    session.handleBlur();

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("한글");
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("cancels without committing on Escape", () => {
    const onCommit = vi.fn();
    const onFinish = vi.fn();
    const session = createTableCellEditSession({
      initialText: "before",
      onCommit,
      onFinish
    });

    session.replaceText("after");
    session.handleKeyDown(keyEvent({ key: "Escape", keyCode: 27 }));
    session.handleBlur();

    expect(onCommit).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("commits once when focus leaves the editor", () => {
    const onCommit = vi.fn();
    const session = createTableCellEditSession({
      initialText: "before",
      onCommit,
      onFinish: vi.fn()
    });

    session.replaceText("after");
    session.handleBlur();
    session.handleBlur();

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("after");
  });
});
