import type { DeckElement } from "@orbit/shared";

export type FormatPainterPayload = {
  category: "image" | "shape" | "text";
  opacity: number;
  props: Record<string, unknown>;
};

const textStyleKeys = ["align", "color", "fontFamily", "fontSize", "fontWeight", "italic", "lineHeight", "underline", "verticalAlign", "writingMode"] as const;
const shapeStyleKeys = ["dash", "fill", "stroke", "strokeWidth"] as const;
const imageStyleKeys = ["fit", "focusX", "focusY"] as const;

export function createFormatPainterPayload(element: DeckElement): FormatPainterPayload | null {
  const category = getFormatCategory(element);
  if (!category) return null;
  const keys = category === "text" ? textStyleKeys : category === "image" ? imageStyleKeys : shapeStyleKeys;
  const source = element.props as Record<string, unknown>;
  const props = Object.fromEntries(
    keys.filter((key) => key in source).map((key) => [key, structuredClone(source[key])]),
  );
  return { category, opacity: element.opacity, props };
}

export function canApplyFormatPainter(payload: FormatPainterPayload, target: DeckElement) {
  return payload.category === getFormatCategory(target);
}

function getFormatCategory(element: DeckElement): FormatPainterPayload["category"] | null {
  if (element.type === "text") return "text";
  if (element.type === "image" || element.type === "svg") return "image";
  if (["rect", "ellipse", "line", "arrow", "polygon", "star", "ring", "customShape"].includes(element.type)) return "shape";
  return null;
}
