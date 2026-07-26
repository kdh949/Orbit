import type {
  Chart,
  CustomShapeElementProps,
  Deck,
  DeckElement,
  DeckElementPaint,
  DeckPatch,
  DeckPatchOperation,
  ShapeElementProps,
  TextElementProps,
} from "@orbit/shared/deck";

const bodyTextRoles = new Set<DeckElement["role"]>([
  "body",
  "caption",
  "footer",
  "subtitle"
]);
const shapeTypes = new Set<DeckElement["type"]>([
  "rect",
  "ellipse",
  "line",
  "arrow",
  "polygon",
  "star",
  "ring"
]);
const roundedShapeTypes = new Set<DeckElement["type"]>([
  "rect",
  "polygon",
  "star",
  "ring"
]);

export function createThemeCascadePatch(
  deck: Deck,
  theme: Record<string, unknown>
): DeckPatch {
  const operations: DeckPatchOperation[] = [{ type: "update_theme", theme }];
  const backgroundColor = getHexColor(theme.backgroundColor);
  const textColor = getHexColor(theme.textColor);
  const accentColor =
    getHexColor(theme.accentColor) ?? getHexColor(getRecord(theme.palette)?.primary);
  const bodySize = getPositiveNumber(getRecord(theme.typography)?.bodySize);
  const borderRadius = getNonNegativeNumber(getRecord(theme.effects)?.borderRadius);

  for (const slide of deck.slides) {
    const style: Record<string, string> = {};
    if (backgroundColor) style.backgroundColor = backgroundColor;
    if (textColor) style.textColor = textColor;
    if (accentColor) style.accentColor = accentColor;

    if (Object.keys(style).length > 0) {
      operations.push({
        type: "update_slide_style",
        slideId: slide.slideId,
        style
      });
    }

    const themeTextColors = compactColors([
      deck.theme.textColor,
      slide.style.textColor
    ]);
    const themeAccentColors = compactColors([
      deck.theme.accentColor,
      deck.theme.palette.primary,
      deck.theme.palette.secondary,
      slide.style.accentColor
    ]);

    for (const element of slide.elements) {
      const props = createElementThemeProps({
        accentColor,
        bodySize,
        borderRadius,
        element,
        textColor,
        themeAccentColors,
        themeTextColors
      });

      if (Object.keys(props).length > 0) {
        operations.push({
          type: "update_element_props",
          slideId: slide.slideId,
          elementId: element.elementId,
          props
        });
      }
    }
  }

  return {
    deckId: deck.deckId,
    baseVersion: deck.version,
    source: "user",
    operations
  };
}

function createElementThemeProps(args: {
  accentColor?: string;
  bodySize?: number;
  borderRadius?: number;
  element: DeckElement;
  textColor?: string;
  themeAccentColors: string[];
  themeTextColors: string[];
}) {
  const {
    accentColor,
    bodySize,
    borderRadius,
    element,
    textColor,
    themeAccentColors,
    themeTextColors
  } = args;

  if (element.type === "text") {
    const props: Record<string, unknown> = {};
    const textProps = element.props as TextElementProps;

    if (textColor && followsColor(textProps.color, themeTextColors)) {
      props.color = textColor;
    }

    if (bodySize && bodyTextRoles.has(element.role)) {
      props.fontSize = bodySize;
    }

    return props;
  }

  if (element.type === "chart") {
    const chart = element.props as Chart;
    const style: Partial<Chart["style"]> = {};

    if (accentColor) {
      const colors = chart.style.colors;
      if (colors.length === 0) {
        style.colors = [accentColor];
      } else if (colors.some((color) => followsColor(color, themeAccentColors))) {
        style.colors = colors.map((color) =>
          followsColor(color, themeAccentColors) ? accentColor : color
        );
      }
    }

    if (textColor && followsColor(chart.style.textColor, themeTextColors)) {
      style.textColor = textColor;
    }

    return Object.keys(style).length > 0 ? { style } : {};
  }

  if (element.type === "customShape") {
    const props = createPaintProps(
      element.props as CustomShapeElementProps,
      accentColor,
      themeAccentColors
    );
    return props;
  }

  if (shapeTypes.has(element.type)) {
    const shapeProps = element.props as ShapeElementProps;
    const props = createPaintProps(shapeProps, accentColor, themeAccentColors);

    if (
      borderRadius !== undefined &&
      roundedShapeTypes.has(element.type) &&
      shapeProps.borderRadius !== borderRadius
    ) {
      props.borderRadius = borderRadius;
    }

    return props;
  }

  return {};
}

function createPaintProps(
  props: Pick<ShapeElementProps, "fill" | "stroke">,
  accentColor: string | undefined,
  themeAccentColors: string[]
) {
  const nextProps: Record<string, unknown> = {};

  if (!accentColor) {
    return nextProps;
  }

  if (followsColor(props.fill, themeAccentColors)) {
    nextProps.fill = accentColor;
  }

  if (followsColor(props.stroke, themeAccentColors)) {
    nextProps.stroke = accentColor;
  }

  return nextProps;
}

function followsColor(value: DeckElementPaint | string | undefined, colors: string[]) {
  const color = solidColorForTheme(value);
  return typeof color === "string" && colors.includes(color.toLowerCase());
}

function solidColorForTheme(value: DeckElementPaint | string | undefined) {
  if (!value || value === "transparent") {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  if (value.type === "pattern") {
    return value.foreground;
  }

  return value.stops[0]?.color;
}

function compactColors(colors: Array<string | undefined>) {
  return colors
    .filter((color): color is string => typeof color === "string")
    .map((color) => color.toLowerCase());
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getHexColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value
    : undefined;
}

function getPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function getNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
