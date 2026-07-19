import { normalizeRichTextProps } from "@orbit/editor-core";
import type {
  TextElementParagraph,
  TextElementProps,
  TextElementRun,
} from "@orbit/shared";

export type ContentEditableLogicalRange = { end: number; start: number };

type ContentEditableDomRange = {
  endContainer: Node;
  endOffset: number;
  startContainer: Node;
  startOffset: number;
};

type ContentEditableKeyEvent = {
  ctrlKey: boolean;
  isComposing: boolean;
  key: string;
  keyCode: number;
  metaKey: boolean;
  preventDefault: () => void;
};

type ContentEditableEditSession = {
  getDraft: () => TextElementProps;
  handleBlur: (args: { nextTargetInsideComposite: boolean }) => void;
  handleCompositionEnd: () => void;
  handleCompositionStart: () => void;
  handleKeyDown: (event: ContentEditableKeyEvent) => void;
  replaceDraft: (props: TextElementProps) => TextElementProps;
};

type TextNodeSegment = {
  end: number;
  node: Node;
  start: number;
};

export function saveContentEditableRange(
  root: HTMLElement,
  range: ContentEditableDomRange,
): ContentEditableLogicalRange {
  const segments = collectTextNodeSegments(root);
  return normalizeLogicalRange(
    getLogicalOffset(root, segments, range.startContainer, range.startOffset),
    getLogicalOffset(root, segments, range.endContainer, range.endOffset),
    getContentEditableLogicalLength(root),
  );
}

export function restoreContentEditableRange(
  root: HTMLElement,
  range: ContentEditableLogicalRange,
): ContentEditableDomRange | null {
  const segments = collectTextNodeSegments(root);
  if (segments.length === 0) {
    return {
      endContainer: root,
      endOffset: 0,
      startContainer: root,
      startOffset: 0,
    };
  }

  const safeRange = normalizeLogicalRange(
    range.start,
    range.end,
    getContentEditableLogicalLength(root),
  );
  const start = findDomBoundary(segments, safeRange.start);
  const end = findDomBoundary(segments, safeRange.end);
  return {
    endContainer: end.node,
    endOffset: end.offset,
    startContainer: start.node,
    startOffset: start.offset,
  };
}

export function isContentEditableCompositeTarget(
  target: Node | null,
  compositeRoots: readonly HTMLElement[],
) {
  return Boolean(
    target && compositeRoots.some((candidate) => candidate.contains(target)),
  );
}

export function createContentEditableEditSession(args: {
  initialProps: TextElementProps;
  onCommit: (props: TextElementProps) => void;
  onFinish: () => void;
}): ContentEditableEditSession {
  let draft = normalizeRichTextProps(args.initialProps);
  const initialDraftJson = JSON.stringify(draft);
  let composing = false;
  let dirty = false;
  let terminalAction: "cancel" | "commit" | null = null;

  function commit() {
    if (terminalAction) return;
    terminalAction = "commit";
    if (dirty) {
      args.onCommit(structuredClone(draft));
    }
    args.onFinish();
  }

  function cancel() {
    if (terminalAction) return;
    terminalAction = "cancel";
    args.onFinish();
  }

  return {
    getDraft: () => structuredClone(draft),
    handleBlur: ({ nextTargetInsideComposite }) => {
      if (!nextTargetInsideComposite) commit();
    },
    handleCompositionEnd: () => {
      composing = false;
    },
    handleCompositionStart: () => {
      composing = true;
    },
    handleKeyDown: (event) => {
      if (composing || event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        commit();
      }
    },
    replaceDraft: (props) => {
      draft = normalizeRichTextProps(props);
      dirty = JSON.stringify(draft) !== initialDraftJson;
      return structuredClone(draft);
    },
  };
}

export function applyContentEditablePlainTextPaste(args: {
  clipboardData: Pick<DataTransfer, "getData">;
  preventDefault: () => void;
  props: TextElementProps;
  range: ContentEditableLogicalRange;
}) {
  args.preventDefault();
  return replaceContentEditableTextRange(
    args.props,
    args.range,
    normalizePlainText(args.clipboardData.getData("text/plain")),
  );
}

export function applyContentEditablePlainTextInput(
  props: TextElementProps,
  nextTextInput: string,
) {
  const current = normalizeRichTextProps(props);
  const previousText = current.text;
  const nextText = normalizePlainText(nextTextInput);
  if (previousText === nextText) return current;

  let prefixLength = 0;
  const maximumPrefix = Math.min(previousText.length, nextText.length);
  while (
    prefixLength < maximumPrefix &&
    previousText.charCodeAt(prefixLength) === nextText.charCodeAt(prefixLength)
  ) {
    prefixLength += 1;
  }
  prefixLength = snapUtf16Start(previousText, prefixLength);
  prefixLength = snapUtf16Start(nextText, prefixLength);

  let previousSuffixStart = previousText.length;
  let nextSuffixStart = nextText.length;
  while (
    previousSuffixStart > prefixLength &&
    nextSuffixStart > prefixLength &&
    previousText.charCodeAt(previousSuffixStart - 1) ===
      nextText.charCodeAt(nextSuffixStart - 1)
  ) {
    previousSuffixStart -= 1;
    nextSuffixStart -= 1;
  }
  previousSuffixStart = snapUtf16End(previousText, previousSuffixStart);
  nextSuffixStart = snapUtf16End(nextText, nextSuffixStart);

  return replaceContentEditableTextRange(
    current,
    { end: previousSuffixStart, start: prefixLength },
    nextText.slice(prefixLength, nextSuffixStart),
  );
}

export function replaceContentEditableTextRange(
  props: TextElementProps,
  range: ContentEditableLogicalRange,
  replacementInput: string,
): TextElementProps {
  const current = normalizeRichTextProps(props);
  const safeRange = normalizeLogicalRange(
    range.start,
    range.end,
    current.text.length,
  );
  const replacement = normalizePlainText(replacementInput);
  const paragraphs = current.paragraphs ?? [];
  const startPoint = getParagraphPoint(paragraphs, safeRange.start);
  const endPoint = getParagraphPoint(paragraphs, safeRange.end);
  const startParagraph = paragraphs[startPoint.paragraphIndex] ??
    createFallbackParagraph(current);
  const endParagraph = paragraphs[endPoint.paragraphIndex] ?? startParagraph;
  const startRuns = startParagraph.runs ?? [];
  const endRuns = endParagraph.runs ?? [];
  const prefixRuns = sliceRuns(startRuns, 0, startPoint.offset);
  const suffixRuns = sliceRuns(
    endRuns,
    endPoint.offset,
    endParagraph.text.length,
  );
  const insertionStyle =
    prefixRuns[prefixRuns.length - 1] ??
    runAtOffset(startRuns, startPoint.offset) ??
    suffixRuns[0] ??
    endRuns[0] ??
    ({ baseline: "normal", text: "" } satisfies TextElementRun);
  const insertedParagraphText = replacement.split("\n");
  const insertedParagraphs: TextElementParagraph[] = [];

  if (insertedParagraphText.length === 1) {
    insertedParagraphs.push(
      createParagraph(
        startParagraph,
        joinRuns(
          prefixRuns,
          createInsertedRuns(insertedParagraphText[0]!, insertionStyle),
          suffixRuns,
        ),
      ),
    );
  } else {
    insertedParagraphs.push(
      createParagraph(
        startParagraph,
        joinRuns(
          prefixRuns,
          createInsertedRuns(insertedParagraphText[0]!, insertionStyle),
        ),
      ),
    );
    for (let index = 1; index < insertedParagraphText.length - 1; index += 1) {
      insertedParagraphs.push(
        createParagraph(
          startParagraph,
          createInsertedRuns(insertedParagraphText[index]!, insertionStyle),
        ),
      );
    }
    insertedParagraphs.push(
      createParagraph(
        endParagraph,
        joinRuns(
          createInsertedRuns(
            insertedParagraphText[insertedParagraphText.length - 1]!,
            insertionStyle,
          ),
          suffixRuns,
        ),
      ),
    );
  }

  return normalizeRichTextProps({
    ...current,
    paragraphs: [
      ...paragraphs.slice(0, startPoint.paragraphIndex),
      ...insertedParagraphs,
      ...paragraphs.slice(endPoint.paragraphIndex + 1),
    ],
    text: "",
  });
}

export function readContentEditablePlainText(root: HTMLElement) {
  const children = Array.from(root.childNodes);
  const hasOnlyParagraphBlocks =
    children.length > 0 &&
    children.every(
      (node) =>
        node.nodeType === 1 &&
        (node.nodeName === "DIV" || node.nodeName === "P"),
    );
  const renderedText = hasOnlyParagraphBlocks
    ? children.map(readEditableNodeText).join("\n")
    : (root.innerText ?? root.textContent ?? "");
  return normalizePlainText(renderedText.replace(/\u00a0/g, " "));
}

function collectTextNodeSegments(root: HTMLElement) {
  const paragraphs = getParagraphNodes(root);
  const segments: TextNodeSegment[] = [];
  let offset = 0;
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const textNodes = collectTextNodes(paragraph);
    if (textNodes.length === 0) {
      segments.push({ end: offset, node: paragraph, start: offset });
    }
    for (const textNode of textNodes) {
      const length = textNode.nodeValue?.length ?? 0;
      segments.push({ end: offset + length, node: textNode, start: offset });
      offset += length;
    }
    if (paragraphIndex < paragraphs.length - 1) offset += 1;
  });
  return segments;
}

function getParagraphNodes(root: HTMLElement): Node[] {
  const children = Array.from(root.childNodes);
  return children.length > 0 ? children : [root];
}

function collectTextNodes(node: Node): Node[] {
  if (node.nodeType === 3) return [node];
  return Array.from(node.childNodes).flatMap(collectTextNodes);
}

function getLogicalOffset(
  root: HTMLElement,
  segments: TextNodeSegment[],
  container: Node,
  domOffset: number,
) {
  const direct = segments.find((segment) => segment.node === container);
  if (direct) {
    return direct.start + clamp(domOffset, 0, direct.end - direct.start);
  }

  const descendants = segments.filter((segment) => containsNode(container, segment.node));
  if (descendants.length > 0) {
    const children = Array.from(container.childNodes);
    const nextChild = children[clamp(domOffset, 0, children.length)];
    if (nextChild) {
      const nextSegment = segments.find((segment) => containsNode(nextChild, segment.node));
      if (nextSegment) return nextSegment.start;
    }
    return descendants[descendants.length - 1]!.end;
  }

  if (container === root) {
    const paragraphs = getParagraphNodes(root);
    const nextParagraph = paragraphs[clamp(domOffset, 0, paragraphs.length)];
    const nextSegment = nextParagraph
      ? segments.find((segment) => containsNode(nextParagraph, segment.node))
      : undefined;
    return nextSegment?.start ?? getContentEditableLogicalLength(root);
  }
  return 0;
}

function findDomBoundary(segments: TextNodeSegment[], offset: number) {
  for (const segment of segments) {
    if (offset <= segment.end) {
      return {
        node: segment.node,
        offset: clamp(offset - segment.start, 0, segment.end - segment.start),
      };
    }
  }
  const last = segments[segments.length - 1]!;
  return { node: last.node, offset: last.end - last.start };
}

function getContentEditableLogicalLength(root: HTMLElement) {
  const paragraphs = getParagraphNodes(root);
  return paragraphs.reduce(
    (length, paragraph, index) =>
      length + (paragraph.textContent?.length ?? 0) + (index > 0 ? 1 : 0),
    0,
  );
}

function containsNode(container: Node, candidate: Node) {
  return container === candidate || container.contains?.(candidate) === true;
}

function normalizeLogicalRange(start: number, end: number, length: number) {
  const first = clamp(Math.min(start, end), 0, length);
  const last = clamp(Math.max(start, end), 0, length);
  return { end: last, start: first };
}

function getParagraphPoint(
  paragraphs: TextElementParagraph[],
  logicalOffset: number,
) {
  let paragraphStart = 0;
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]!;
    const paragraphEnd = paragraphStart + paragraph.text.length;
    if (logicalOffset <= paragraphEnd) {
      return { offset: logicalOffset - paragraphStart, paragraphIndex: index };
    }
    paragraphStart = paragraphEnd + 1;
  }
  const lastIndex = Math.max(0, paragraphs.length - 1);
  return {
    offset: paragraphs[lastIndex]?.text.length ?? 0,
    paragraphIndex: lastIndex,
  };
}

function createFallbackParagraph(props: TextElementProps): TextElementParagraph {
  return {
    align: props.align,
    indent: 0,
    lineHeight: props.lineHeight,
    runs: [],
    spaceAfter: 0,
    spaceBefore: 0,
    text: "",
  };
}

function createParagraph(
  template: TextElementParagraph,
  runs: TextElementRun[],
): TextElementParagraph {
  return {
    ...structuredClone(template),
    runs,
    text: runs.map((run) => run.text).join(""),
  };
}

function sliceRuns(runs: TextElementRun[], start: number, end: number) {
  const result: TextElementRun[] = [];
  let runStart = 0;
  for (const run of runs) {
    const runEnd = runStart + run.text.length;
    const localStart = Math.max(0, start - runStart);
    const localEnd = Math.min(run.text.length, end - runStart);
    if (localStart < localEnd) {
      result.push({
        ...structuredClone(run),
        text: run.text.slice(localStart, localEnd),
      });
    }
    runStart = runEnd;
  }
  return result;
}

function runAtOffset(runs: TextElementRun[], offset: number) {
  let runEnd = 0;
  for (const run of runs) {
    runEnd += run.text.length;
    if (offset <= runEnd) return run;
  }
  return runs[runs.length - 1];
}

function createInsertedRuns(text: string, template: TextElementRun) {
  if (!text) return [];
  return [{ ...structuredClone(template), text }];
}

function joinRuns(...groups: TextElementRun[][]) {
  return groups.flat().filter((run) => run.text.length > 0);
}

function normalizePlainText(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

function readEditableNodeText(node: Node): string {
  if (node.nodeType === 3) return node.nodeValue ?? "";
  if (node.nodeName === "BR") return "\n";
  return Array.from(node.childNodes).map(readEditableNodeText).join("");
}

function snapUtf16Start(text: string, offset: number) {
  return isInsideSurrogatePair(text, offset) ? offset - 1 : offset;
}

function snapUtf16End(text: string, offset: number) {
  return isInsideSurrogatePair(text, offset) ? offset + 1 : offset;
}

function isInsideSurrogatePair(text: string, offset: number) {
  if (offset <= 0 || offset >= text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return (
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(Math.max(Math.trunc(value), minimum), maximum);
}
