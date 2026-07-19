import type {
  TextElementBullet,
  TextElementParagraph,
  TextElementProps,
  TextElementRun
} from "@orbit/shared";

export type RichTextRange = { end: number; start: number };

export type RichTextCharacterStylePatch = {
  baseline?: TextElementRun["baseline"];
  color?: TextElementRun["color"];
  fontFamily?: TextElementRun["fontFamily"];
  fontSize?: TextElementRun["fontSize"];
  fontWeight?: TextElementRun["fontWeight"];
  highlightColor?: TextElementRun["highlightColor"] | null;
  hyperlink?: TextElementRun["hyperlink"] | null;
  italic?: TextElementRun["italic"];
  underline?: TextElementRun["underline"];
};

export type RichTextParagraphStylePatch = {
  align?: TextElementParagraph["align"];
  bullet?: TextElementBullet;
  indent?: TextElementParagraph["indent"];
  lineHeight?: TextElementParagraph["lineHeight"];
  spaceAfter?: TextElementParagraph["spaceAfter"];
  spaceBefore?: TextElementParagraph["spaceBefore"];
};

export type RichTextSelectionValue<T> =
  | { mixed: false; value: T }
  | { mixed: true; value: undefined };

export type RichTextSelectionCharacterStyle = {
  baseline: RichTextSelectionValue<TextElementRun["baseline"]>;
  color: RichTextSelectionValue<TextElementRun["color"]>;
  fontFamily: RichTextSelectionValue<TextElementRun["fontFamily"]>;
  fontSize: RichTextSelectionValue<number>;
  fontWeight: RichTextSelectionValue<TextElementProps["fontWeight"]>;
  highlightColor: RichTextSelectionValue<TextElementRun["highlightColor"]>;
  hyperlink: RichTextSelectionValue<TextElementRun["hyperlink"]>;
  italic: RichTextSelectionValue<boolean>;
  underline: RichTextSelectionValue<boolean>;
};

export type RichTextSelectionParagraphStyle = {
  align: RichTextSelectionValue<TextElementParagraph["align"]>;
  bullet: RichTextSelectionValue<TextElementBullet | undefined>;
  indent: RichTextSelectionValue<number>;
  lineHeight: RichTextSelectionValue<number>;
  spaceAfter: RichTextSelectionValue<number>;
  spaceBefore: RichTextSelectionValue<number>;
};

type EffectiveCharacterStyle = {
  baseline: TextElementRun["baseline"];
  color: TextElementRun["color"];
  fontFamily: TextElementRun["fontFamily"];
  fontSize: number;
  fontWeight: TextElementProps["fontWeight"];
  highlightColor: TextElementRun["highlightColor"];
  hyperlink: TextElementRun["hyperlink"];
  italic: boolean;
  underline: boolean;
};

type EffectiveParagraphStyle = {
  align: TextElementParagraph["align"];
  bullet: TextElementBullet | undefined;
  indent: number;
  lineHeight: number;
  spaceAfter: number;
  spaceBefore: number;
};

const characterStyleKeys = [
  "baseline",
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "highlightColor",
  "hyperlink",
  "italic",
  "underline"
] as const;

export function normalizeRichTextProps(
  input: TextElementProps
): TextElementProps {
  const source = structuredClone(input);
  const paragraphs =
    source.paragraphs !== undefined
      ? source.paragraphs.map(normalizeParagraph)
      : [normalizeLegacyParagraph(source)];
  return synchronizeRichTextProps(source, paragraphs);
}

export function getRichTextSemanticText(input: TextElementProps): string {
  if (input.paragraphs !== undefined) {
    return input.paragraphs
      .map((paragraph) =>
        paragraph.runs?.length ? projectRuns(paragraph.runs) : paragraph.text
      )
      .join("\n");
  }
  return input.runs?.length ? projectRuns(input.runs) : input.text;
}

export function applyRichTextCharacterStyle(
  input: TextElementProps,
  range: RichTextRange,
  patch: RichTextCharacterStylePatch
): TextElementProps {
  const normalized = normalizeRichTextProps(input);
  const safeRange = normalizeUtf16Range(normalized.text, range);
  if (safeRange.start === safeRange.end) {
    return normalized;
  }

  let paragraphStart = 0;
  const paragraphs = normalized.paragraphs!.map((paragraph) => {
    const paragraphEnd = paragraphStart + paragraph.text.length;
    const localStart = Math.max(0, safeRange.start - paragraphStart);
    const localEnd = Math.min(
      paragraph.text.length,
      safeRange.end - paragraphStart
    );
    paragraphStart = paragraphEnd + 1;
    if (localStart >= localEnd) {
      return paragraph;
    }
    const runs = applyStyleToRuns(
      paragraph.runs ?? [],
      { end: localEnd, start: localStart },
      patch
    );
    return { ...paragraph, runs, text: projectRuns(runs) };
  });

  return synchronizeRichTextProps(normalized, paragraphs);
}

export function applyRichTextParagraphStyle(
  input: TextElementProps,
  range: RichTextRange,
  patch: RichTextParagraphStylePatch
): TextElementProps {
  const normalized = normalizeRichTextProps(input);
  const touched = new Set(getTouchedParagraphIndexes(normalized, range));
  const paragraphs = normalized.paragraphs!.map((paragraph, index) => {
    if (!touched.has(index)) {
      return paragraph;
    }
    const next = { ...paragraph };
    if (patch.align !== undefined) {
      next.align = patch.align;
    }
    if (patch.lineHeight !== undefined) {
      next.lineHeight = patch.lineHeight;
    }
    if (patch.indent !== undefined) next.indent = patch.indent;
    if (patch.spaceAfter !== undefined) next.spaceAfter = patch.spaceAfter;
    if (patch.spaceBefore !== undefined) next.spaceBefore = patch.spaceBefore;
    if (hasOwn(patch, "bullet")) {
      if (patch.bullet === undefined) {
        delete next.bullet;
      } else {
        next.bullet = structuredClone(patch.bullet);
      }
    }
    return next;
  });
  return synchronizeRichTextProps(normalized, paragraphs);
}

export function getRichTextSelectionCharacterStyle(
  input: TextElementProps,
  range: RichTextRange
): RichTextSelectionCharacterStyle {
  const normalized = normalizeRichTextProps(input);
  const safeRange = normalizeUtf16Range(normalized.text, range);
  const styles = getSelectedEffectiveCharacterStyles(normalized, safeRange);

  return {
    baseline: summarizeValues(styles.map((style) => style.baseline)),
    color: summarizeValues(styles.map((style) => style.color)),
    fontFamily: summarizeValues(styles.map((style) => style.fontFamily)),
    fontSize: summarizeValues(styles.map((style) => style.fontSize)),
    fontWeight: summarizeValues(styles.map((style) => style.fontWeight)),
    highlightColor: summarizeValues(styles.map((style) => style.highlightColor)),
    hyperlink: summarizeValues(styles.map((style) => style.hyperlink)),
    italic: summarizeValues(styles.map((style) => style.italic)),
    underline: summarizeValues(styles.map((style) => style.underline))
  };
}

export function getRichTextSelectionParagraphStyle(
  input: TextElementProps,
  range: RichTextRange
): RichTextSelectionParagraphStyle {
  const normalized = normalizeRichTextProps(input);
  const indexes = getTouchedParagraphIndexes(normalized, range);
  const styles = indexes.map((index) =>
    getEffectiveParagraphStyle(normalized, normalized.paragraphs![index] ?? null)
  );

  return {
    align: summarizeValues(styles.map((style) => style.align)),
    bullet: summarizeValues(
      styles.map((style) => style.bullet),
      equalBullets
    ),
    indent: summarizeValues(styles.map((style) => style.indent)),
    lineHeight: summarizeValues(styles.map((style) => style.lineHeight)),
    spaceAfter: summarizeValues(styles.map((style) => style.spaceAfter)),
    spaceBefore: summarizeValues(styles.map((style) => style.spaceBefore))
  };
}

function normalizeLegacyParagraph(
  props: TextElementProps
): TextElementParagraph {
  const runs = props.runs?.length
    ? normalizeRuns(props.runs)
    : normalizeRuns([createPlainRun(props.text)]);
  const paragraph: TextElementParagraph = {
    align: props.align,
    indent: 0,
    lineHeight: props.lineHeight,
    runs,
    spaceAfter: 0,
    spaceBefore: 0,
    text: projectRuns(runs)
  };
  if (props.bullet) {
    paragraph.bullet = structuredClone(props.bullet);
  }
  return paragraph;
}

function normalizeParagraph(
  paragraph: TextElementParagraph
): TextElementParagraph {
  const next = structuredClone(paragraph);
  const runs = next.runs?.length
    ? normalizeRuns(next.runs)
    : next.text.length > 0
      ? [createPlainRun(next.text)]
      : [];
  return { ...next, runs, text: projectRuns(runs) };
}

function synchronizeRichTextProps(
  source: TextElementProps,
  paragraphs: TextElementParagraph[]
): TextElementProps {
  const synchronizedParagraphs = paragraphs.map((paragraph) => {
    const runs = normalizeRuns(paragraph.runs ?? []);
    return { ...paragraph, runs, text: projectRuns(runs) };
  });
  const next: TextElementProps = {
    ...structuredClone(source),
    paragraphs: synchronizedParagraphs,
    text: synchronizedParagraphs.map((paragraph) => paragraph.text).join("\n")
  };
  if (synchronizedParagraphs.length === 1) {
    next.runs = structuredClone(synchronizedParagraphs[0]!.runs ?? []);
  } else {
    delete next.runs;
  }
  return next;
}

function applyStyleToRuns(
  runs: TextElementRun[],
  range: RichTextRange,
  patch: RichTextCharacterStylePatch
) {
  let runStart = 0;
  const split: TextElementRun[] = [];
  for (const run of runs) {
    const runEnd = runStart + run.text.length;
    const selectedStart = Math.max(runStart, range.start);
    const selectedEnd = Math.min(runEnd, range.end);
    if (selectedStart >= selectedEnd) {
      split.push(structuredClone(run));
      runStart = runEnd;
      continue;
    }

    const before = run.text.slice(0, selectedStart - runStart);
    const selected = run.text.slice(
      selectedStart - runStart,
      selectedEnd - runStart
    );
    const after = run.text.slice(selectedEnd - runStart);
    if (before) {
      split.push({ ...structuredClone(run), text: before });
    }
    split.push(applyRunStylePatch({ ...structuredClone(run), text: selected }, patch));
    if (after) {
      split.push({ ...structuredClone(run), text: after });
    }
    runStart = runEnd;
  }
  return normalizeRuns(split);
}

function applyRunStylePatch(
  run: TextElementRun,
  patch: RichTextCharacterStylePatch
) {
  const next = { ...run };
  if (patch.baseline !== undefined) next.baseline = patch.baseline;
  if (patch.color !== undefined) next.color = patch.color;
  if (patch.fontFamily !== undefined) next.fontFamily = patch.fontFamily;
  if (patch.fontSize !== undefined) next.fontSize = patch.fontSize;
  if (patch.fontWeight !== undefined) next.fontWeight = patch.fontWeight;
  if (hasOwn(patch, "highlightColor")) {
    if (patch.highlightColor === null) delete next.highlightColor;
    else next.highlightColor = patch.highlightColor;
  }
  if (hasOwn(patch, "hyperlink")) {
    if (patch.hyperlink === null) delete next.hyperlink;
    else next.hyperlink = patch.hyperlink;
  }
  if (patch.italic !== undefined) next.italic = patch.italic;
  if (patch.underline !== undefined) next.underline = patch.underline;
  return next;
}

function normalizeRuns(runs: TextElementRun[]) {
  const normalized: TextElementRun[] = [];
  for (const source of runs) {
    if (!source.text) {
      continue;
    }
    const run = { ...structuredClone(source), baseline: source.baseline ?? "normal" };
    const previous = normalized[normalized.length - 1];
    if (previous && equalRunStyles(previous, run)) {
      previous.text += run.text;
    } else {
      normalized.push(run);
    }
  }
  return normalized;
}

function equalRunStyles(left: TextElementRun, right: TextElementRun) {
  return characterStyleKeys.every((key) => left[key] === right[key]);
}

function projectRuns(runs: TextElementRun[]) {
  return runs.map((run) => run.text).join("");
}

function createPlainRun(text: string): TextElementRun {
  return { baseline: "normal", text };
}

function normalizeUtf16Range(text: string, range: RichTextRange): RichTextRange {
  const first = clampOffset(Math.min(range.start, range.end), text.length);
  const last = clampOffset(Math.max(range.start, range.end), text.length);
  if (first === last) {
    const caret = snapStartBoundary(text, first);
    return { end: caret, start: caret };
  }
  return {
    end: snapEndBoundary(text, last),
    start: snapStartBoundary(text, first)
  };
}

function clampOffset(value: number, length: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(length, Math.trunc(value)));
}

function snapStartBoundary(text: string, offset: number) {
  return isInsideSurrogatePair(text, offset) ? offset - 1 : offset;
}

function snapEndBoundary(text: string, offset: number) {
  return isInsideSurrogatePair(text, offset) ? offset + 1 : offset;
}

function isInsideSurrogatePair(text: string, offset: number) {
  if (offset <= 0 || offset >= text.length) {
    return false;
  }
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

function getSelectedEffectiveCharacterStyles(
  props: TextElementProps,
  range: RichTextRange
): EffectiveCharacterStyle[] {
  if (range.start === range.end) {
    return [getCaretEffectiveCharacterStyle(props, range.start)];
  }

  const selected: EffectiveCharacterStyle[] = [];
  let paragraphStart = 0;
  for (const paragraph of props.paragraphs!) {
    let runStart = paragraphStart;
    for (const run of paragraph.runs ?? []) {
      const runEnd = runStart + run.text.length;
      if (range.start < runEnd && range.end > runStart) {
        selected.push(getEffectiveCharacterStyle(props, paragraph, run));
      }
      runStart = runEnd;
    }
    paragraphStart += paragraph.text.length + 1;
  }
  return selected.length > 0
    ? selected
    : [getCaretEffectiveCharacterStyle(props, range.start)];
}

function getCaretEffectiveCharacterStyle(
  props: TextElementProps,
  offset: number
): EffectiveCharacterStyle {
  let paragraphStart = 0;
  for (const paragraph of props.paragraphs!) {
    const paragraphEnd = paragraphStart + paragraph.text.length;
    if (offset <= paragraphEnd) {
      const localOffset = Math.max(0, offset - paragraphStart);
      const runs = paragraph.runs ?? [];
      let runEnd = 0;
      for (const run of runs) {
        runEnd += run.text.length;
        if (localOffset <= runEnd) {
          return getEffectiveCharacterStyle(props, paragraph, run);
        }
      }
      return getEffectiveCharacterStyle(
        props,
        paragraph,
        runs[runs.length - 1] ?? createPlainRun("")
      );
    }
    paragraphStart = paragraphEnd + 1;
  }
  const lastParagraph = props.paragraphs![props.paragraphs!.length - 1];
  if (lastParagraph) {
    const runs = lastParagraph.runs ?? [];
    return getEffectiveCharacterStyle(
      props,
      lastParagraph,
      runs[runs.length - 1] ?? createPlainRun("")
    );
  }
  return getEffectiveCharacterStyle(props, null, createPlainRun(""));
}

function getEffectiveCharacterStyle(
  props: TextElementProps,
  paragraph: TextElementParagraph | null,
  run: TextElementRun
): EffectiveCharacterStyle {
  return {
    baseline: run.baseline ?? "normal",
    color: run.color ?? paragraph?.color ?? props.color,
    fontFamily: run.fontFamily ?? paragraph?.fontFamily ?? props.fontFamily,
    fontSize: run.fontSize ?? paragraph?.fontSize ?? props.fontSize,
    fontWeight: run.fontWeight ?? paragraph?.fontWeight ?? props.fontWeight,
    highlightColor: run.highlightColor,
    hyperlink: run.hyperlink,
    italic: run.italic ?? paragraph?.italic ?? props.italic ?? false,
    underline: run.underline ?? paragraph?.underline ?? props.underline ?? false
  };
}

function getTouchedParagraphIndexes(
  props: TextElementProps,
  range: RichTextRange
) {
  const safeRange = normalizeUtf16Range(props.text, range);
  const paragraphs = props.paragraphs!;
  if (safeRange.start === safeRange.end) {
    return [getCaretParagraphIndex(paragraphs, safeRange.start)];
  }

  const touched: number[] = [];
  let paragraphStart = 0;
  paragraphs.forEach((paragraph, index) => {
    const contentEnd = paragraphStart + paragraph.text.length;
    const domainStart = index === 0 ? paragraphStart : paragraphStart - 1;
    const domainEnd =
      index === paragraphs.length - 1 ? contentEnd : contentEnd + 1;
    if (safeRange.start < domainEnd && safeRange.end > domainStart) {
      touched.push(index);
    }
    paragraphStart = contentEnd + 1;
  });
  return touched.length > 0 ? touched : [0];
}

function getCaretParagraphIndex(
  paragraphs: TextElementParagraph[],
  offset: number
) {
  let paragraphStart = 0;
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]!;
    const paragraphEnd = paragraphStart + paragraph.text.length;
    if (offset <= paragraphEnd) {
      return index;
    }
    paragraphStart = paragraphEnd + 1;
  }
  return Math.max(0, paragraphs.length - 1);
}

function getEffectiveParagraphStyle(
  props: TextElementProps,
  paragraph: TextElementParagraph | null
): EffectiveParagraphStyle {
  return {
    align: paragraph?.align ?? props.align,
    bullet: paragraph?.bullet ?? props.bullet,
    indent: paragraph?.indent ?? 0,
    lineHeight: paragraph?.lineHeight ?? props.lineHeight,
    spaceAfter: paragraph?.spaceAfter ?? 0,
    spaceBefore: paragraph?.spaceBefore ?? 0
  };
}

function summarizeValues<T>(
  values: T[],
  equals: (left: T, right: T) => boolean = Object.is
): RichTextSelectionValue<T> {
  const first = values[0] as T;
  if (values.some((value) => !equals(first, value))) {
    return { mixed: true, value: undefined };
  }
  return { mixed: false, value: first };
}

function equalBullets(
  left: TextElementBullet | undefined,
  right: TextElementBullet | undefined
) {
  return (
    left?.enabled === right?.enabled &&
    left?.character === right?.character &&
    left?.indent === right?.indent &&
    left?.kind === right?.kind &&
    left?.numberStyle === right?.numberStyle &&
    left?.startAt === right?.startAt
  );
}

function hasOwn<T extends object>(value: T, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
