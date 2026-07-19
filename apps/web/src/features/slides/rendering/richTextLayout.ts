import type {
  TextElementParagraph,
  TextElementProps,
  TextElementRun
} from "@orbit/shared";

const legacyTextPadding = 4;

export type RichTextFontStyle =
  | "normal"
  | "bold"
  | "italic"
  | "bold italic";

export type RichTextFragmentStyle = {
  baseline: TextElementRun["baseline"];
  color: string;
  fontFamily: string;
  fontSize: number;
  fontStyle: RichTextFontStyle;
  fontWeight: TextElementProps["fontWeight"];
  highlightColor?: string;
  hyperlink?: string;
  italic: boolean;
  underline: boolean;
};

export type RichTextFragment = {
  height: number;
  lineIndex: number;
  paragraphIndex: number;
  style: RichTextFragmentStyle;
  text: string;
  width: number;
  x: number;
  y: number;
};

export type RichTextLineBox = {
  align: TextElementProps["align"];
  availableWidth: number;
  fragments: RichTextFragment[];
  hardBreak: boolean;
  height: number;
  lineIndex: number;
  paragraphIndex: number;
  width: number;
  x: number;
  y: number;
};

export type RichTextLayoutResult = {
  contentHeight: number;
  contentWidth: number;
  contentX: number;
  contentY: number;
  fragments: RichTextFragment[];
  innerHeight: number;
  innerWidth: number;
  innerX: number;
  innerY: number;
  lineBoxes: RichTextLineBox[];
  totalContentHeight: number;
};

export type RichTextMeasure = (
  text: string,
  style: RichTextFragmentStyle
) => number;

type RichTextBaseStyle = {
  color: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: TextElementProps["fontWeight"];
  italic?: boolean;
  underline?: boolean;
};

type LayoutParagraph = {
  align: TextElementProps["align"];
  bullet: TextElementParagraph["bullet"];
  indent: number;
  lineHeight: number;
  paragraph: TextElementParagraph | null;
  runs: TextElementRun[];
  spaceAfter: number;
  spaceBefore: number;
  text: string;
};

type DraftFragment = {
  isBullet: boolean;
  isWhitespace: boolean;
  style: RichTextFragmentStyle;
  text: string;
  width: number;
};

type DraftLine = {
  align: TextElementProps["align"];
  availableWidth: number;
  fallbackStyle: RichTextFragmentStyle;
  fragments: DraftFragment[];
  hardBreak: boolean;
  lineHeight: number;
  paragraphIndex: number;
  startX: number;
};

type ResolvedInsets = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

let measurementContext: CanvasRenderingContext2D | null | undefined;

export function hasRichTextLayout(props: TextElementProps) {
  return props.paragraphs !== undefined || Boolean(props.runs?.length);
}

export function resolveTextBodyInset(props: TextElementProps): ResolvedInsets {
  if (props.bodyInset) {
    return props.bodyInset;
  }

  return {
    bottom: legacyTextPadding,
    left: legacyTextPadding,
    right: legacyTextPadding,
    top: legacyTextPadding
  };
}

export function getRichTextFontStyle(
  fontWeight: TextElementProps["fontWeight"],
  italic: boolean
): RichTextFontStyle {
  const bold = getNumericFontWeight(fontWeight) >= 600;
  if (bold && italic) {
    return "bold italic";
  }
  if (bold) {
    return "bold";
  }
  if (italic) {
    return "italic";
  }
  return "normal";
}

export function measureRichTextFragment(
  text: string,
  style: RichTextFragmentStyle
) {
  const context = getMeasurementContext();
  if (!context) {
    return Array.from(text).length * style.fontSize * 0.55;
  }

  context.font = `${style.italic ? "italic " : ""}${getNumericFontWeight(
    style.fontWeight
  )} ${style.fontSize}px ${style.fontFamily}`;
  return context.measureText(text).width;
}

export function richTextLayout(args: {
  baseStyle: RichTextBaseStyle;
  frame: { height: number; width: number };
  measureText?: RichTextMeasure;
  props: TextElementProps;
}): RichTextLayoutResult {
  const { baseStyle, frame, props } = args;
  const measureText = args.measureText ?? measureRichTextFragment;
  const insets = resolveTextBodyInset(props);
  const innerX = insets.left;
  const innerY = insets.top;
  const innerWidth = Math.max(1, frame.width - insets.left - insets.right);
  const innerHeight = Math.max(1, frame.height - insets.top - insets.bottom);
  const innerRight = innerX + innerWidth;
  const paragraphs = getLayoutParagraphs(props);
  const paragraphLines = paragraphs.map((paragraph, paragraphIndex) => {
    const paragraphStyle = resolveParagraphStyle(paragraph.paragraph, baseStyle);
    const bulletEnabled = Boolean(paragraph.bullet?.enabled);
    const indent = bulletEnabled
      ? Math.max(paragraph.indent, paragraph.bullet?.indent ?? 0)
      : paragraph.indent;
    const startX = innerX + indent;
    const availableWidth = Math.max(1, innerRight - startX);
    const lines = wrapParagraph({
      availableWidth,
      baseStyle,
      measureText,
      paragraph,
      paragraphIndex,
      paragraphStyle,
      startX
    });

    return {
      lines,
      spaceAfter: paragraph.spaceAfter,
      spaceBefore: paragraph.spaceBefore
    };
  });

  let cursorY = innerY;
  let lineIndex = 0;
  const lineBoxes: RichTextLineBox[] = [];

  for (const paragraph of paragraphLines) {
    cursorY += paragraph.spaceBefore;
    paragraph.lines.forEach((line, index) => {
      const lineBox = positionLine({
        draft: line,
        isLastParagraphLine: index === paragraph.lines.length - 1,
        lineIndex,
        y: cursorY
      });
      lineBoxes.push(lineBox);
      cursorY += lineBox.height;
      lineIndex += 1;
    });
    cursorY += paragraph.spaceAfter;
  }

  const totalContentHeight = Math.max(0, cursorY - innerY);
  const spareHeight = Math.max(0, innerHeight - totalContentHeight);
  const verticalOffset =
    props.verticalAlign === "middle"
      ? spareHeight / 2
      : props.verticalAlign === "bottom"
        ? spareHeight
        : 0;

  if (verticalOffset > 0) {
    for (const line of lineBoxes) {
      line.y += verticalOffset;
      for (const fragment of line.fragments) {
        fragment.y += verticalOffset;
      }
    }
  }

  const fragments = lineBoxes.flatMap((line) => line.fragments);
  const bounds = getHorizontalBounds(lineBoxes, innerX);

  return {
    contentHeight: Math.min(totalContentHeight, innerHeight),
    contentWidth: bounds.width,
    contentX: bounds.x,
    contentY: innerY + verticalOffset,
    fragments,
    innerHeight,
    innerWidth,
    innerX,
    innerY,
    lineBoxes,
    totalContentHeight
  };
}

function getLayoutParagraphs(props: TextElementProps): LayoutParagraph[] {
  if (props.paragraphs !== undefined) {
    return props.paragraphs.map((paragraph) => ({
      align: paragraph.align ?? props.align,
      bullet: paragraph.bullet,
      indent: paragraph.indent ?? 0,
      lineHeight: paragraph.lineHeight ?? props.lineHeight,
      paragraph,
      runs: paragraph.runs ?? [],
      spaceAfter: paragraph.spaceAfter ?? 0,
      spaceBefore: paragraph.spaceBefore ?? 0,
      text: paragraph.runs?.length
        ? paragraph.runs.map((run) => run.text).join("")
        : paragraph.text
    }));
  }

  return [
    {
      align: props.align,
      bullet: props.bullet,
      indent: 0,
      lineHeight: props.lineHeight,
      paragraph: null,
      runs: props.runs ?? [],
      spaceAfter: 0,
      spaceBefore: 0,
      text: props.runs?.length
        ? props.runs.map((run) => run.text).join("")
        : props.text
    }
  ];
}

function wrapParagraph(args: {
  availableWidth: number;
  baseStyle: RichTextBaseStyle;
  measureText: RichTextMeasure;
  paragraph: LayoutParagraph;
  paragraphIndex: number;
  paragraphStyle: RichTextFragmentStyle;
  startX: number;
}): DraftLine[] {
  const {
    availableWidth,
    baseStyle,
    measureText,
    paragraph,
    paragraphIndex,
    paragraphStyle,
    startX
  } = args;
  const lines: DraftLine[] = [];
  let current = createDraftLine();

  function createDraftLine(): DraftLine {
    return {
      align: paragraph.align,
      availableWidth,
      fallbackStyle: paragraphStyle,
      fragments: [],
      hardBreak: false,
      lineHeight: paragraph.lineHeight,
      paragraphIndex,
      startX
    };
  }

  function finishLine(hardBreak: boolean) {
    trimTrailingWhitespace(current);
    current.hardBreak = hardBreak;
    lines.push(current);
    current = createDraftLine();
  }

  if (paragraph.bullet?.enabled) {
    const bulletRun = paragraph.runs.find((run) => run.text.length > 0);
    const bulletStyle = bulletRun
      ? resolveRunStyle(bulletRun, paragraph.paragraph, baseStyle)
      : paragraphStyle;
    addDraftFragment(
      current,
      `${getListMarker(paragraph.bullet, paragraphIndex)} `,
      bulletStyle,
      measureText,
      true,
      false
    );
  }

  const sourceRuns = paragraph.runs.length
    ? paragraph.runs
    : [{ text: paragraph.text, baseline: "normal" as const }];

  for (const run of sourceRuns) {
    const style = resolveRunStyle(run, paragraph.paragraph, baseStyle);
    for (const token of tokenizeRunText(run.text)) {
      if (token === "\n") {
        finishLine(true);
        continue;
      }
      addWrappedToken({
        finishLine,
        getCurrent: () => current,
        measureText,
        style,
        token
      });
    }
  }

  finishLine(false);
  return lines;
}

function addWrappedToken(args: {
  finishLine: (hardBreak: boolean) => void;
  getCurrent: () => DraftLine;
  measureText: RichTextMeasure;
  style: RichTextFragmentStyle;
  token: string;
}) {
  const { finishLine, getCurrent, measureText, style, token } = args;
  const whitespace = /^\s+$/u.test(token);
  let current = getCurrent();

  const tokenWidth = measureText(token, style);
  if (draftLineWidth(current) + tokenWidth <= current.availableWidth) {
    addDraftFragment(current, token, style, measureText, false, whitespace);
    return;
  }

  if (!whitespace && hasTextFragment(current) && !hasOnlyBullet(current)) {
    finishLine(false);
    current = getCurrent();
    if (tokenWidth <= current.availableWidth) {
      addDraftFragment(current, token, style, measureText, false, false);
      return;
    }
  } else if (whitespace && hasTextFragment(current)) {
    finishLine(false);
    return;
  }

  for (const character of Array.from(token)) {
    current = getCurrent();
    const characterWidth = measureText(character, style);
    if (
      hasTextFragment(current) &&
      draftLineWidth(current) + characterWidth > current.availableWidth
    ) {
      finishLine(false);
      current = getCurrent();
    }
    addDraftFragment(current, character, style, measureText, false, whitespace);
  }
}

function addDraftFragment(
  line: DraftLine,
  text: string,
  style: RichTextFragmentStyle,
  measureText: RichTextMeasure,
  isBullet: boolean,
  isWhitespace: boolean
) {
  if (!text) {
    return;
  }
  const width = measureText(text, style);
  const previous = line.fragments[line.fragments.length - 1];
  if (
    previous &&
    previous.isBullet === isBullet &&
    previous.isWhitespace === isWhitespace &&
    sameStyle(previous.style, style)
  ) {
    previous.text += text;
    previous.width += width;
    return;
  }
  line.fragments.push({ isBullet, isWhitespace, style, text, width });
}

function positionLine(args: {
  draft: DraftLine;
  isLastParagraphLine: boolean;
  lineIndex: number;
  y: number;
}): RichTextLineBox {
  const { draft, isLastParagraphLine, lineIndex, y } = args;
  const styles = draft.fragments.length
    ? draft.fragments.map((fragment) => fragment.style)
    : [emptyLineStyle(draft)];
  const maximumFontSize = Math.max(...styles.map((style) => style.fontSize));
  const rawTops = styles.map(
    (style) =>
      maximumFontSize - style.fontSize + getBaselineOffset(style.baseline, style.fontSize)
  );
  const minimumTop = Math.min(...rawTops);
  const maximumBottom = Math.max(
    ...styles.map((style, index) => rawTops[index]! + style.fontSize)
  );
  const contentSpan = Math.max(1, maximumBottom - minimumTop);
  const height = Math.max(maximumFontSize * draft.lineHeight, contentSpan);
  const verticalOrigin = (height - contentSpan) / 2 - minimumTop;
  const contentWidth = draftLineWidth(draft);
  const justify =
    draft.align === "justify" && !draft.hardBreak && !isLastParagraphLine;
  const whitespaceCount = justify
    ? draft.fragments.filter((fragment) => fragment.isWhitespace).length
    : 0;
  const justifiedExtra =
    whitespaceCount > 0
      ? Math.max(0, draft.availableWidth - contentWidth) / whitespaceCount
      : 0;
  const alignedOffset =
    draft.align === "center"
      ? Math.max(0, (draft.availableWidth - contentWidth) / 2)
      : draft.align === "right"
        ? Math.max(0, draft.availableWidth - contentWidth)
        : 0;
  let x = draft.startX + alignedOffset;
  const positionedFragments = draft.fragments.map((fragment) => {
    const baselineTop =
      maximumFontSize -
      fragment.style.fontSize +
      getBaselineOffset(fragment.style.baseline, fragment.style.fontSize);
    const width =
      fragment.width + (fragment.isWhitespace ? justifiedExtra : 0);
    const positioned: RichTextFragment = {
      height: fragment.style.fontSize,
      lineIndex,
      paragraphIndex: draft.paragraphIndex,
      style: fragment.style,
      text: fragment.text,
      width,
      x,
      y: y + verticalOrigin + baselineTop
    };
    x += width;
    return positioned;
  });
  const fragments = justify
    ? positionedFragments
    : mergeAdjacentPositionedFragments(positionedFragments);
  const width = justify && whitespaceCount > 0 ? draft.availableWidth : contentWidth;

  return {
    align: draft.align,
    availableWidth: draft.availableWidth,
    fragments,
    hardBreak: draft.hardBreak,
    height,
    lineIndex,
    paragraphIndex: draft.paragraphIndex,
    width,
    x: draft.startX + alignedOffset,
    y
  };
}

function mergeAdjacentPositionedFragments(fragments: RichTextFragment[]) {
  const merged: RichTextFragment[] = [];
  for (const fragment of fragments) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      sameStyle(previous.style, fragment.style) &&
      Math.abs(previous.x + previous.width - fragment.x) < 0.001 &&
      Math.abs(previous.y - fragment.y) < 0.001
    ) {
      previous.text += fragment.text;
      previous.width += fragment.width;
      continue;
    }
    merged.push({ ...fragment });
  }
  return merged;
}

function resolveParagraphStyle(
  paragraph: TextElementParagraph | null,
  baseStyle: RichTextBaseStyle
): RichTextFragmentStyle {
  const fontWeight = paragraph?.fontWeight ?? baseStyle.fontWeight;
  const italic = paragraph?.italic ?? baseStyle.italic ?? false;
  return {
    baseline: "normal",
    color: paragraph?.color ?? baseStyle.color,
    fontFamily: paragraph?.fontFamily ?? baseStyle.fontFamily,
    fontSize: paragraph?.fontSize ?? baseStyle.fontSize,
    fontStyle: getRichTextFontStyle(fontWeight, italic),
    fontWeight,
    italic,
    underline: paragraph?.underline ?? baseStyle.underline ?? false
  };
}

function resolveRunStyle(
  run: TextElementRun,
  paragraph: TextElementParagraph | null,
  baseStyle: RichTextBaseStyle
): RichTextFragmentStyle {
  const paragraphStyle = resolveParagraphStyle(paragraph, baseStyle);
  const fontWeight = run.fontWeight ?? paragraphStyle.fontWeight;
  const italic = run.italic ?? paragraphStyle.italic;
  return {
    baseline: run.baseline ?? "normal",
    color: run.color ?? paragraphStyle.color,
    fontFamily: run.fontFamily ?? paragraphStyle.fontFamily,
    fontSize: run.fontSize ?? paragraphStyle.fontSize,
    fontStyle: getRichTextFontStyle(fontWeight, italic),
    fontWeight,
    highlightColor: run.highlightColor,
    hyperlink: run.hyperlink,
    italic,
    underline: run.underline ?? paragraphStyle.underline
  };
}

function tokenizeRunText(text: string) {
  return text.replace(/\r\n?/g, "\n").match(/\n|[^\S\n]+|[^\s\n]+/gu) ?? [];
}

function draftLineWidth(line: DraftLine) {
  return line.fragments.reduce((total, fragment) => total + fragment.width, 0);
}

function hasTextFragment(line: DraftLine) {
  return line.fragments.some((fragment) => !fragment.isBullet);
}

function hasOnlyBullet(line: DraftLine) {
  return line.fragments.length > 0 && !hasTextFragment(line);
}

function trimTrailingWhitespace(line: DraftLine) {
  while (line.fragments[line.fragments.length - 1]?.isWhitespace) {
    line.fragments.pop();
  }
}

function sameStyle(left: RichTextFragmentStyle, right: RichTextFragmentStyle) {
  return (
    left.baseline === right.baseline &&
    left.color === right.color &&
    left.fontFamily === right.fontFamily &&
    left.fontSize === right.fontSize &&
    left.fontStyle === right.fontStyle &&
    left.fontWeight === right.fontWeight &&
    left.highlightColor === right.highlightColor &&
    left.hyperlink === right.hyperlink &&
    left.italic === right.italic &&
    left.underline === right.underline
  );
}

function getListMarker(
  bullet: NonNullable<TextElementParagraph["bullet"]>,
  paragraphIndex: number
) {
  if (bullet.kind !== "number") return bullet.character;
  const value = (bullet.startAt ?? 1) + paragraphIndex;
  if (bullet.numberStyle === "lower-alpha") {
    return `${String.fromCharCode(96 + ((value - 1) % 26) + 1)}.`;
  }
  if (bullet.numberStyle === "upper-alpha") {
    return `${String.fromCharCode(64 + ((value - 1) % 26) + 1)}.`;
  }
  return `${value}.`;
}

function emptyLineStyle(line: DraftLine): RichTextFragmentStyle {
  const bullet = line.fragments.find((fragment) => fragment.isBullet);
  return bullet?.style ?? line.fallbackStyle;
}

function getBaselineOffset(
  baseline: TextElementRun["baseline"],
  fontSize: number
) {
  if (baseline === "superscript") {
    return -fontSize * 0.3;
  }
  if (baseline === "subscript") {
    return fontSize * 0.2;
  }
  return 0;
}

function getHorizontalBounds(lines: RichTextLineBox[], fallbackX: number) {
  if (lines.length === 0) {
    return { width: 0, x: fallbackX };
  }
  const left = Math.min(...lines.map((line) => line.x));
  const right = Math.max(...lines.map((line) => line.x + line.width));
  return { width: Math.max(0, right - left), x: left };
}

function getNumericFontWeight(fontWeight: TextElementProps["fontWeight"]) {
  if (typeof fontWeight === "number") {
    return fontWeight;
  }
  switch (fontWeight) {
    case "medium":
      return 500;
    case "semibold":
      return 600;
    case "bold":
      return 700;
    case "normal":
    default:
      return 400;
  }
}

function getMeasurementContext() {
  if (measurementContext !== undefined) {
    return measurementContext;
  }
  if (typeof document === "undefined") {
    measurementContext = null;
    return measurementContext;
  }
  const canvas = document.createElement("canvas");
  measurementContext = canvas.getContext("2d");
  return measurementContext;
}
