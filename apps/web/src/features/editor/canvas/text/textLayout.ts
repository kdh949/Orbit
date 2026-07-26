import type {
  Deck,
  Slide,
  TextElementParagraph,
  TextElementProps,
} from "@orbit/shared/deck";
import { Text as KonvaTextShape } from "konva/lib/shapes/Text";
import type { RichTextFontStyle } from "../../../slides/rendering/richTextLayout";
import {
  getRichTextFontStyle,
  hasRichTextLayout,
  resolveTextBodyInset,
  richTextLayout
} from "../../../slides/rendering/richTextLayout";

export function getCssFontWeight(fontWeight: TextElementProps["fontWeight"]) {
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

export function getKonvaFontStyle(
  fontWeight: TextElementProps["fontWeight"]
): "normal" | "bold" {
  return getCssFontWeight(fontWeight) >= 600 ? "bold" : "normal";
}

export function getTextElementText(props: TextElementProps) {
  if (props.paragraphs !== undefined) {
    return props.paragraphs.map(getParagraphText).join("\n");
  }

  if (props.runs?.length) {
    return props.runs.map((run) => run.text).join("");
  }

  return props.text;
}

export function getPrimaryTextRun(props: TextElementProps) {
  const paragraph = props.paragraphs?.find((item) => getParagraphText(item).trim());
  const paragraphRun =
    paragraph?.runs?.find((run) => run.text.trim().length > 0) ??
    paragraph?.runs?.[0];
  if (paragraphRun) {
    return {
      ...paragraphRun,
      color: paragraphRun.color ?? paragraph?.color,
      fontFamily: paragraphRun.fontFamily ?? paragraph?.fontFamily,
      fontSize: paragraphRun.fontSize ?? paragraph?.fontSize,
      fontWeight: paragraphRun.fontWeight ?? paragraph?.fontWeight,
      italic: paragraphRun.italic ?? paragraph?.italic,
      underline: paragraphRun.underline ?? paragraph?.underline
    };
  }

  return props.runs?.find((run) => run.text.trim().length > 0) ?? props.runs?.[0];
}

function getParagraphText(paragraph: TextElementParagraph) {
  if (paragraph.runs?.length) {
    return paragraph.runs.map((run) => run.text).join("");
  }

  return paragraph.text;
}

export function getTextElementLayout(args: {
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
  props: TextElementProps;
  slide: Slide;
  theme: Deck["theme"];
}) {
  const { frame, props, slide, theme } = args;
  const useRichText =
    props.writingMode !== "vertical-270" && hasRichTextLayout(props);
  const primaryRun = useRichText ? undefined : getPrimaryTextRun(props);
  const fontFamily =
    primaryRun?.fontFamily ??
    props.fontFamily ??
    slide.style.fontFamily ??
    theme.typography.bodyFontFamily;
  const color = primaryRun?.color ?? props.color ?? slide.style.textColor ?? theme.textColor;
  const sourceFontSize = primaryRun?.fontSize ?? props.fontSize;
  const fontScale =
    props.autoFit === "shrink-text" ? (props.fontScale ?? 1) : 1;
  const fontSize = sourceFontSize * fontScale;
  const fontWeight = primaryRun?.fontWeight ?? props.fontWeight;
  const letterSpacing = primaryRun?.letterSpacing ?? props.letterSpacing ?? 0;
  const lineHeight = Math.max(
    0.5,
    props.lineHeight *
      (props.autoFit === "shrink-text"
        ? 1 - (props.lineSpaceReduction ?? 0)
        : 1)
  );
  const italic = primaryRun?.italic ?? props.italic ?? false;
  const underline = primaryRun?.underline ?? props.underline ?? false;
  const fontStyle = getRichTextFontStyle(fontWeight, italic);
  const text = getTextElementText(props);
  const bodyInset = resolveTextBodyInset(props);
  const width = Math.max(1, frame.width - bodyInset.left - bodyInset.right);
  const availableHeight = Math.max(
    1,
    frame.height - bodyInset.top - bodyInset.bottom
  );

  if (useRichText) {
    const richText = richTextLayout({
      baseStyle: {
        color,
        fontFamily,
        fontSize: sourceFontSize,
        fontWeight,
        italic,
        letterSpacing,
        underline
      },
      frame,
      props
    });

    return {
      availableHeight,
      color,
      contentHeight: richText.contentHeight,
      contentWidth: richText.contentWidth,
      contentX: richText.contentX,
      fontFamily,
      fontSize,
      fontStyle,
      letterSpacing,
      lineHeight,
      richText,
      text,
      textDecoration: underline ? ("underline" as const) : undefined,
      totalContentHeight: richText.totalContentHeight,
      width: richText.innerWidth,
      x: richText.innerX,
      y: richText.contentY
    };
  }

  const contentMetrics = measureTextContentBounds({
    align: props.align,
    fontFamily,
    fontSize,
    fontStyle,
    letterSpacing,
    lineHeight,
    text,
    width
  });
  const contentHeight = Math.min(contentMetrics.height, availableHeight);
  const spareHeight = Math.max(0, availableHeight - contentHeight);
  const contentWidth =
    props.align === "justify"
      ? width
      : Math.max(1, Math.min(contentMetrics.width, width));
  let y = bodyInset.top;
  let contentX = bodyInset.left;

  if (props.verticalAlign === "middle") {
    y += spareHeight / 2;
  } else if (props.verticalAlign === "bottom") {
    y += spareHeight;
  }

  if (props.align === "center") {
    contentX += Math.max(0, (width - contentWidth) / 2);
  } else if (props.align === "right") {
    contentX += Math.max(0, width - contentWidth);
  }

  return {
    availableHeight,
    color,
    contentHeight,
    contentWidth,
    contentX,
    fontFamily,
    fontSize,
    fontStyle,
    letterSpacing,
    lineHeight,
    richText: null,
    text,
    textDecoration: underline ? ("underline" as const) : undefined,
    totalContentHeight: contentMetrics.height,
    width,
    x: bodyInset.left,
    y
  };
}

export function isTextElementOverflowing(args: {
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
  props: TextElementProps;
  slide: Slide;
  theme: Deck["theme"];
}) {
  const layout = getTextElementLayout(args);

  if (args.props.writingMode !== "vertical-270") {
    return layout.totalContentHeight > layout.availableHeight;
  }

  const metrics = measureTextContentBounds({
    align: args.props.align,
    fontFamily: layout.fontFamily,
    fontSize: layout.fontSize,
    fontStyle: layout.fontStyle,
    letterSpacing: layout.letterSpacing,
    lineHeight: layout.lineHeight,
    text: layout.text,
    width: Math.max(1, args.frame.height)
  });

  return metrics.height > Math.max(1, args.frame.width);
}

export function estimateTextContentBounds(args: {
  text: string;
  width: number;
  fontSize: number;
  letterSpacing?: number;
  lineHeight: number;
}) {
  const { text, width, fontSize, lineHeight } = args;
  const characterWidth = Math.max(
    fontSize * 0.55 + (args.letterSpacing ?? 0),
    1
  );
  const charsPerLine = Math.max(1, Math.floor(width / characterWidth));
  const paragraphs = text.replace(/\r\n/g, "\n").split("\n");
  const estimatedLineLengths: number[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      estimatedLineLengths.push(0);
      continue;
    }

    for (let start = 0; start < paragraph.length; start += charsPerLine) {
      estimatedLineLengths.push(Math.min(charsPerLine, paragraph.length - start));
    }
  }

  const maxCharsInLine = Math.max(0, ...estimatedLineLengths);
  const lineCount = Math.max(1, estimatedLineLengths.length);

  return {
    height: lineCount * fontSize * lineHeight,
    lineCount,
    width: Math.min(width, maxCharsInLine * characterWidth)
  };
}

export function measureTextContentBounds(args: {
  align: TextElementProps["align"];
  fontFamily: string;
  fontSize: number;
  fontStyle: RichTextFontStyle;
  letterSpacing?: number;
  lineHeight: number;
  text: string;
  width: number;
}) {
  if (typeof document === "undefined") {
    return estimateTextContentBounds({
      text: args.text,
      width: args.width,
      fontSize: args.fontSize,
      letterSpacing: args.letterSpacing,
      lineHeight: args.lineHeight
    });
  }

  const measureNode = new KonvaTextShape({
    align: args.align,
    fontFamily: args.fontFamily,
    fontSize: args.fontSize,
    fontStyle: args.fontStyle,
    letterSpacing: args.letterSpacing ?? 0,
    lineHeight: args.lineHeight,
    padding: 0,
    text: args.text,
    width: args.width,
    wrap: "word"
  });
  const contentHeight = measureNode.height();
  const contentWidth = Math.min(
    args.width,
    measureNode.textArr.reduce((maxWidth, line) => Math.max(maxWidth, line.width), 0)
  );
  const lineCount = Math.max(1, measureNode.textArr.length);

  measureNode.destroy();

  return {
    height: contentHeight,
    lineCount,
    width: contentWidth
  };
}
