import { normalizeRichTextProps } from "@orbit/editor-core";
import type { TextElementProps } from "@orbit/shared";
import { describe, expect, it, vi } from "vitest";

import {
  applyContentEditablePlainTextInput,
  applyContentEditablePlainTextPaste,
  createContentEditableEditSession,
  isContentEditableCompositeTarget,
  readContentEditablePlainText,
  replaceContentEditableTextRange,
  restoreContentEditableRange,
  saveContentEditableRange,
} from "./contentEditableRange";

class TestNode {
  readonly childNodes: TestNode[] = [];
  readonly dataset: Record<string, string>;
  readonly nodeName: string;
  readonly nodeType: number;
  readonly nodeValue: string | null;
  parentNode: TestNode | null = null;

  constructor(args: {
    dataset?: Record<string, string>;
    name?: string;
    text?: string;
  }) {
    this.dataset = args.dataset ?? {};
    this.nodeName = args.text === undefined ? (args.name ?? "DIV") : "#text";
    this.nodeType = args.text === undefined ? 1 : 3;
    this.nodeValue = args.text ?? null;
  }

  append(...children: TestNode[]) {
    for (const child of children) {
      child.parentNode = this;
      this.childNodes.push(child);
    }
    return this;
  }

  contains(candidate: unknown): boolean {
    if (candidate === this) {
      return true;
    }
    return this.childNodes.some((child) => child.contains(candidate));
  }

  get textContent(): string {
    return this.nodeValue ?? this.childNodes.map((child) => child.textContent).join("");
  }
}

function text(value: string) {
  return new TestNode({ text: value });
}

function run(index: number, value: string) {
  const textNode = text(value);
  return {
    element: new TestNode({
      dataset: { textRunIndex: String(index) },
      name: "SPAN",
    }).append(textNode),
    textNode,
  };
}

function paragraph(index: number, ...runs: ReturnType<typeof run>[]) {
  return new TestNode({
    dataset: { textParagraphIndex: String(index) },
    name: "DIV",
  }).append(...runs.map((item) => item.element));
}

function asNode(node: TestNode): Node {
  return node as unknown as Node;
}

function asElement(node: TestNode): HTMLElement {
  return node as unknown as HTMLElement;
}

function textProps(textValue: string): TextElementProps {
  const normalizedText = textValue.replace(/\r\n?/g, "\n");
  return normalizeRichTextProps({
    align: "left",
    fontSize: 24,
    fontWeight: "normal",
    lineHeight: 1.2,
    paragraphs: normalizedText.split("\n").map((paragraphText) => ({
      align: "left",
      indent: 0,
      lineHeight: 1.2,
      runs:
        paragraphText.length > 0
          ? [{ baseline: "normal" as const, text: paragraphText }]
          : [],
      spaceAfter: 0,
      spaceBefore: 0,
      text: paragraphText,
    })),
    text: normalizedText,
    verticalAlign: "top",
  });
}

function keyEvent(
  overrides: Partial<{
    ctrlKey: boolean;
    isComposing: boolean;
    key: string;
    keyCode: number;
    metaKey: boolean;
  }> = {},
) {
  return {
    ctrlKey: false,
    isComposing: false,
    key: "Enter",
    keyCode: 13,
    metaKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  };
}

describe("contentEditable logical UTF-16 ranges", () => {
  it("round-trips a range across styled runs, an emoji, and a paragraph newline", () => {
    const firstRun = run(0, "A😀");
    const secondRun = run(1, "B");
    const thirdRun = run(0, "한글");
    const root = new TestNode({ name: "DIV" }).append(
      paragraph(0, firstRun, secondRun),
      paragraph(1, thirdRun),
    );

    const saved = saveContentEditableRange(asElement(root), {
      endContainer: asNode(thirdRun.textNode),
      endOffset: 1,
      startContainer: asNode(firstRun.textNode),
      startOffset: 1,
    });

    expect(saved).toEqual({ end: 6, start: 1 });
    expect(restoreContentEditableRange(asElement(root), saved)).toEqual({
      endContainer: asNode(thirdRun.textNode),
      endOffset: 1,
      startContainer: asNode(firstRun.textNode),
      startOffset: 1,
    });
  });

  it("restores a toolbar pointer-down bookmark after the browser selection is lost", () => {
    const firstRun = run(0, "Bold");
    const secondRun = run(1, "plain");
    const root = new TestNode({ name: "DIV" }).append(
      paragraph(0, firstRun, secondRun),
    );
    const bookmark = saveContentEditableRange(asElement(root), {
      endContainer: asNode(secondRun.textNode),
      endOffset: 3,
      startContainer: asNode(firstRun.textNode),
      startOffset: 1,
    });

    expect(bookmark).toEqual({ end: 7, start: 1 });
    expect(restoreContentEditableRange(asElement(root), bookmark)).toEqual({
      endContainer: asNode(secondRun.textNode),
      endOffset: 3,
      startContainer: asNode(firstRun.textNode),
      startOffset: 1,
    });
  });

  it("preserves an empty paragraph as a selectable logical newline boundary", () => {
    const firstRun = run(0, "A");
    const lastRun = run(0, "B");
    const emptyParagraph = paragraph(1);
    const root = new TestNode({ name: "DIV" }).append(
      paragraph(0, firstRun),
      emptyParagraph,
      paragraph(2, lastRun),
    );
    const bookmark = { end: 2, start: 2 };

    expect(restoreContentEditableRange(asElement(root), bookmark)).toEqual({
      endContainer: asNode(emptyParagraph),
      endOffset: 0,
      startContainer: asNode(emptyParagraph),
      startOffset: 0,
    });
    expect(
      saveContentEditableRange(asElement(root), {
        endContainer: asNode(emptyParagraph),
        endOffset: 0,
        startContainer: asNode(emptyParagraph),
        startOffset: 0,
      }),
    ).toEqual(bookmark);
  });
});

describe("contentEditable edit composite", () => {
  it("recognizes both the editor and toolbar as one focus composite", () => {
    const editorChild = new TestNode({ name: "SPAN" });
    const toolbarButton = new TestNode({ name: "BUTTON" });
    const externalButton = new TestNode({ name: "BUTTON" });
    const editor = new TestNode({ name: "DIV" }).append(editorChild);
    const toolbar = new TestNode({ name: "DIV" }).append(toolbarButton);

    expect(
      isContentEditableCompositeTarget(asNode(editorChild), [
        asElement(editor),
        asElement(toolbar),
      ]),
    ).toBe(true);
    expect(
      isContentEditableCompositeTarget(asNode(toolbarButton), [
        asElement(editor),
        asElement(toolbar),
      ]),
    ).toBe(true);
    expect(
      isContentEditableCompositeTarget(asNode(externalButton), [
        asElement(editor),
        asElement(toolbar),
      ]),
    ).toBe(false);
    expect(
      isContentEditableCompositeTarget(null, [
        asElement(editor),
        asElement(toolbar),
      ]),
    ).toBe(false);
  });

  it("does not commit when focus moves from the editor into its toolbar", () => {
    const onCommit = vi.fn();
    const onFinish = vi.fn();
    const session = createContentEditableEditSession({
      initialProps: textProps("처음"),
      onCommit,
      onFinish,
    });
    session.replaceDraft(textProps("수정"));

    session.handleBlur({ nextTargetInsideComposite: true });

    expect(onCommit).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
  });
});

describe("IME-safe contentEditable session", () => {
  it("does not commit or escape between compositionstart and compositionend", () => {
    const onCommit = vi.fn();
    const onFinish = vi.fn();
    const session = createContentEditableEditSession({
      initialProps: textProps("ㅎ"),
      onCommit,
      onFinish,
    });
    session.handleCompositionStart();
    session.replaceDraft(textProps("한"));

    const commitKey = keyEvent({ key: "Enter", metaKey: true });
    const escapeKey = keyEvent({ key: "Escape" });
    session.handleKeyDown(commitKey);
    session.handleKeyDown(escapeKey);
    session.handleCompositionEnd();

    expect(onCommit).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
    expect(commitKey.preventDefault).not.toHaveBeenCalled();
    expect(escapeKey.preventDefault).not.toHaveBeenCalled();

    const postCompositionCommit = keyEvent({ key: "Enter", metaKey: true });
    session.handleKeyDown(postCompositionCommit);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ paragraphs: expect.any(Array), text: "한" }),
    );
  });

  it.each([
    ["event.isComposing", { isComposing: true }],
    ["legacy keyCode 229", { keyCode: 229 }],
  ])("ignores commit and Escape when %s marks an IME event", (_label, guard) => {
    const onCommit = vi.fn();
    const onFinish = vi.fn();
    const session = createContentEditableEditSession({
      initialProps: textProps("ㅎ"),
      onCommit,
      onFinish,
    });
    session.replaceDraft(textProps("한"));

    session.handleKeyDown(
      keyEvent({ key: "Enter", metaKey: true, ...guard }),
    );
    session.handleKeyDown(keyEvent({ key: "Escape", ...guard }));

    expect(onCommit).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
  });
});

describe("contentEditable paste and terminal actions", () => {
  it("finishes a no-op blur without persisting a deck change", () => {
    const onCommit = vi.fn();
    const onFinish = vi.fn();
    const initialProps = textProps("  unchanged  ");
    const session = createContentEditableEditSession({
      initialProps,
      onCommit,
      onFinish,
    });

    session.handleBlur({ nextTargetInsideComposite: false });

    expect(onCommit).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("prevents rich HTML paste and inserts only normalized plain text", () => {
    const preventDefault = vi.fn();
    const updated = applyContentEditablePlainTextPaste({
      clipboardData: {
        getData: (type: string) =>
          type === "text/plain"
            ? "safe\r\nnext"
            : '<b>safe</b><script>alert("x")</script>',
      },
      preventDefault,
      props: textProps("AB"),
      range: { end: 1, start: 1 },
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(updated.text).toBe("Asafe\nnextB");
    expect(updated.paragraphs?.map((item) => item.text)).toEqual([
      "Asafe",
      "nextB",
    ]);
    expect(JSON.stringify(updated)).not.toContain("<b>");
    expect(JSON.stringify(updated)).not.toContain("<script>");
  });

  it("reads paragraph blocks and line breaks without adding browser-only trailing newlines", () => {
    const root = new TestNode({ name: "DIV" }).append(
      new TestNode({ name: "DIV" }).append(
        text("first"),
        new TestNode({ name: "BR" }),
        text("line"),
      ),
      new TestNode({ name: "DIV" }),
    );

    expect(readContentEditablePlainText(asElement(root))).toBe("first\nline\n");
  });

  it("preserves adjacent run styles while replacing or typing plain text", () => {
    const props = normalizeRichTextProps({
      ...textProps("굵게plain"),
      paragraphs: [
        {
          align: "left",
          indent: 0,
          lineHeight: 1.2,
          runs: [
            { baseline: "normal", fontWeight: "bold", text: "굵게" },
            { baseline: "normal", italic: true, text: "plain" },
          ],
          spaceAfter: 0,
          spaceBefore: 0,
          text: "굵게plain",
        },
      ],
    });
    const replaced = replaceContentEditableTextRange(
      props,
      { end: 2, start: 2 },
      " 추가",
    );

    expect(replaced.paragraphs?.[0]?.runs).toEqual([
      {
        baseline: "normal",
        fontWeight: "bold",
        text: "굵게 추가",
      },
      { baseline: "normal", italic: true, text: "plain" },
    ]);
    expect(applyContentEditablePlainTextInput(replaced, "굵게 추가된plain").text).toBe(
      "굵게 추가된plain",
    );
  });

  it("commits an external blur exactly once with canonical paragraphs and runs", () => {
    const onCommit = vi.fn();
    const onFinish = vi.fn();
    const session = createContentEditableEditSession({
      initialProps: textProps("처음"),
      onCommit,
      onFinish,
    });
    session.replaceDraft(textProps("수정\n둘째"));

    session.handleBlur({ nextTargetInsideComposite: false });
    session.handleBlur({ nextTargetInsideComposite: false });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        paragraphs: [
          expect.objectContaining({
            runs: [{ baseline: "normal", text: "수정" }],
            text: "수정",
          }),
          expect.objectContaining({
            runs: [{ baseline: "normal", text: "둘째" }],
            text: "둘째",
          }),
        ],
        text: "수정\n둘째",
      }),
    );
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Cmd+Enter", { metaKey: true }],
    ["Ctrl+Enter", { ctrlKey: true }],
  ])("commits %s exactly once even if blur follows", (_label, modifier) => {
    const onCommit = vi.fn();
    const onFinish = vi.fn();
    const session = createContentEditableEditSession({
      initialProps: textProps("처음"),
      onCommit,
      onFinish,
    });
    session.replaceDraft(textProps("완료"));
    const event = keyEvent({ key: "Enter", ...modifier });

    session.handleKeyDown(event);
    session.handleBlur({ nextTargetInsideComposite: false });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ paragraphs: expect.any(Array), text: "완료" }),
    );
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape without committing the draft", () => {
    const onCommit = vi.fn();
    const onFinish = vi.fn();
    const session = createContentEditableEditSession({
      initialProps: textProps("시작 snapshot"),
      onCommit,
      onFinish,
    });
    session.replaceDraft(textProps("버릴 draft"));
    const event = keyEvent({ key: "Escape" });

    session.handleKeyDown(event);
    session.handleBlur({ nextTargetInsideComposite: false });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
