import {
  communityTemplateElementSchema,
  communityTemplateFontFamilySchema,
  communityTemplatePatternPresetSchema,
  communityTemplateSnapshotSchema,
  maxCommunityTemplateSlides,
  maxCommunityTemplateSnapshotBytes,
} from "@orbit/shared/community-templates";
import { deckSchema } from "@orbit/shared/deck";
import type {
  CommunityTemplateElement,
  CommunityTemplateSnapshot,
} from "@orbit/shared/community-templates";
import type {
  Deck,
  DeckElement,
  DeckElementPaint,
  DeckTheme,
  ShapeElementProps,
} from "@orbit/shared/deck";

export type CommunityTemplateSanitizationErrorCode =
  | "COMMUNITY_TEMPLATE_ACTIVITY_UNSUPPORTED"
  | "COMMUNITY_TEMPLATE_SANITIZATION_FAILED"
  | "COMMUNITY_TEMPLATE_SNAPSHOT_TOO_LARGE";

export class CommunityTemplateSanitizationError extends Error {
  constructor(
    readonly code: CommunityTemplateSanitizationErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "CommunityTemplateSanitizationError";
  }
}

export function sanitizeCommunityTemplate(
  sourceDeck: Deck,
): CommunityTemplateSnapshot {
  let deck: Deck;
  try {
    deck = deckSchema.parse(sourceDeck);
  } catch (error) {
    throw new CommunityTemplateSanitizationError(
      "COMMUNITY_TEMPLATE_SANITIZATION_FAILED",
      { cause: error },
    );
  }

  if (
    deck.slides.some(
      (slide) => slide.kind === "activity" || slide.kind === "activity-results",
    )
  ) {
    throw new CommunityTemplateSanitizationError(
      "COMMUNITY_TEMPLATE_ACTIVITY_UNSUPPORTED",
    );
  }

  if (deck.slides.length > maxCommunityTemplateSlides) {
    throw new CommunityTemplateSanitizationError(
      "COMMUNITY_TEMPLATE_SNAPSHOT_TOO_LARGE",
    );
  }

  try {
    const snapshot = communityTemplateSnapshotSchema.parse({
      schemaVersion: 1,
      canvas: deck.canvas,
      theme: sanitizeTheme(deck.theme),
      targetDurationMinutes: deck.targetDurationMinutes,
      slides: deck.slides.map((slide) => {
        if (slide.kind !== "content") {
          throw new CommunityTemplateSanitizationError(
            "COMMUNITY_TEMPLATE_ACTIVITY_UNSUPPORTED",
          );
        }

        return {
          kind: "content",
          slideId: slide.slideId,
          order: slide.order,
          title: "슬라이드 제목",
          style: {
            ...(slide.style.layout ? { layout: slide.style.layout } : {}),
            ...(slide.style.fontFamily
              ? { fontFamily: normalizeFontFamily(slide.style.fontFamily) }
              : {}),
            ...(slide.style.backgroundColor
              ? { backgroundColor: slide.style.backgroundColor }
              : {}),
            ...(slide.style.textColor
              ? { textColor: slide.style.textColor }
              : {}),
            ...(slide.style.accentColor
              ? { accentColor: slide.style.accentColor }
              : {}),
          },
          elements: sanitizeElements(slide.elements, deck.theme),
        };
      }),
    });

    if (
      new TextEncoder().encode(JSON.stringify(snapshot)).byteLength >
      maxCommunityTemplateSnapshotBytes
    ) {
      throw new CommunityTemplateSanitizationError(
        "COMMUNITY_TEMPLATE_SNAPSHOT_TOO_LARGE",
      );
    }

    return snapshot;
  } catch (error) {
    if (error instanceof CommunityTemplateSanitizationError) throw error;
    throw new CommunityTemplateSanitizationError(
      "COMMUNITY_TEMPLATE_SANITIZATION_FAILED",
      { cause: error },
    );
  }
}

function sanitizeTheme(theme: DeckTheme) {
  return {
    name: "Community Template" as const,
    fontFamily: normalizeFontFamily(theme.fontFamily),
    backgroundColor: theme.backgroundColor,
    textColor: theme.textColor,
    accentColor: theme.accentColor,
    palette: { ...theme.palette },
    typography: {
      ...theme.typography,
      headingFontFamily: normalizeFontFamily(
        theme.typography.headingFontFamily,
      ),
      bodyFontFamily: normalizeFontFamily(theme.typography.bodyFontFamily),
    },
    effects: {
      borderRadius: theme.effects.borderRadius,
      ...(theme.effects.shadow ? { shadow: { ...theme.effects.shadow } } : {}),
    },
  };
}

function sanitizeElements(
  elements: DeckElement[],
  theme: DeckTheme,
): CommunityTemplateElement[] {
  const converted = new Map<string, CommunityTemplateElement>();
  const groups = elements.filter((element) => element.type === "group");

  for (const element of elements) {
    if (element.type === "group") continue;
    const sanitized = sanitizeElement(element, theme);
    converted.set(sanitized.elementId, sanitized);
  }

  let retainedGroupIds = new Set(
    groups
      .filter((group) => group.props.childElementIds.length > 0)
      .map((group) => group.elementId),
  );
  let changed = true;
  while (changed) {
    changed = false;
    const availableIds = new Set([...converted.keys(), ...retainedGroupIds]);
    for (const group of groups) {
      if (!retainedGroupIds.has(group.elementId)) continue;
      if (
        !group.props.childElementIds.some(
          (childId) => childId !== group.elementId && availableIds.has(childId),
        )
      ) {
        retainedGroupIds.delete(group.elementId);
        changed = true;
      }
    }
  }

  const availableIds = new Set([...converted.keys(), ...retainedGroupIds]);
  for (const group of groups) {
    if (!retainedGroupIds.has(group.elementId)) continue;
    converted.set(
      group.elementId,
      communityTemplateElementSchema.parse({
        ...sanitizeElementBase(group),
        type: "group",
        props: {
          childElementIds: group.props.childElementIds.filter(
            (childId) =>
              childId !== group.elementId && availableIds.has(childId),
          ),
        },
      }),
    );
  }

  return elements.flatMap((element) => {
    const sanitized = converted.get(element.elementId);
    return sanitized ? [sanitized] : [];
  });
}

function sanitizeElement(
  element: Exclude<DeckElement, { type: "group" }>,
  theme: DeckTheme,
): CommunityTemplateElement {
  const base = sanitizeElementBase(element);

  if (
    element.type === "image" ||
    element.type === "svg" ||
    element.type === "activity-qr" ||
    element.type === "activity-copy" ||
    element.type === "presentation-passcode"
  ) {
    return createNeutralPlaceholder(base, theme);
  }

  if (element.type === "text") {
    return communityTemplateElementSchema.parse({
      ...base,
      type: "text",
      props: {
        text:
          element.role === "title" || element.role === "subtitle"
            ? "제목을 입력하세요"
            : "내용을 입력하세요",
        ...(element.props.bodyInset
          ? { bodyInset: { ...element.props.bodyInset } }
          : {}),
        ...(element.props.fontFamily
          ? { fontFamily: normalizeFontFamily(element.props.fontFamily) }
          : {}),
        fontSize: element.props.fontSize,
        fontWeight: element.props.fontWeight,
        ...(element.props.italic !== undefined
          ? { italic: element.props.italic }
          : {}),
        ...(element.props.underline !== undefined
          ? { underline: element.props.underline }
          : {}),
        ...(element.props.color ? { color: element.props.color } : {}),
        align: element.props.align,
        verticalAlign: element.props.verticalAlign,
        ...(element.props.writingMode
          ? { writingMode: element.props.writingMode }
          : {}),
        lineHeight: element.props.lineHeight,
        ...(element.props.bullet
          ? {
              bullet: {
                enabled: element.props.bullet.enabled,
                character: "•",
                indent: element.props.bullet.indent,
              },
            }
          : {}),
      },
    });
  }

  if (element.type === "table") {
    return communityTemplateElementSchema.parse({
      ...base,
      type: "table",
      props: {
        rows: element.props.rows.map((row) =>
          row.map((cell) => ({
            ...cell,
            text: "내용",
            ...(cell.fontFamily
              ? { fontFamily: normalizeFontFamily(cell.fontFamily) }
              : {}),
          })),
        ),
        ...(element.props.columnWidths
          ? { columnWidths: [...element.props.columnWidths] }
          : {}),
        ...(element.props.rowHeights
          ? { rowHeights: [...element.props.rowHeights] }
          : {}),
        borderColor: element.props.borderColor,
        borderWidth: element.props.borderWidth,
      },
    });
  }

  if (element.type === "chart") {
    return communityTemplateElementSchema.parse({
      ...base,
      type: "chart",
      props: sanitizeChart(element.props),
    });
  }

  if (element.type === "customShape") {
    const candidate = communityTemplateElementSchema.safeParse({
      ...base,
      type: "customShape",
      props: {
        pathData: element.props.pathData,
        viewBoxWidth: element.props.viewBoxWidth,
        viewBoxHeight: element.props.viewBoxHeight,
        fill: sanitizePaint(element.props.fill),
        stroke: sanitizePaint(element.props.stroke),
        strokeWidth: element.props.strokeWidth,
        ...(element.props.dash ? { dash: [...element.props.dash] } : {}),
        ...(element.props.lineCap ? { lineCap: element.props.lineCap } : {}),
        ...(element.props.lineJoin ? { lineJoin: element.props.lineJoin } : {}),
        ...(element.props.shadow
          ? { shadow: { ...element.props.shadow } }
          : {}),
        closed: element.props.closed,
        nodes: element.props.nodes.map((node) => ({ ...node })),
      },
    });
    return candidate.success
      ? candidate.data
      : createNeutralPlaceholder(base, theme);
  }

  return communityTemplateElementSchema.parse({
    ...base,
    type: element.type,
    props: sanitizeShapeProps(element.props),
  });
}

function sanitizeElementBase(element: DeckElement) {
  return {
    elementId: element.elementId,
    ...(element.role ? { role: element.role } : {}),
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation,
    opacity: element.opacity,
    zIndex: element.zIndex,
    locked: element.locked,
    visible: element.visible,
  };
}

function sanitizeShapeProps(props: ShapeElementProps) {
  return {
    fill: sanitizePaint(props.fill),
    stroke: sanitizePaint(props.stroke),
    strokeWidth: props.strokeWidth,
    borderRadius: props.borderRadius,
    ...(props.sides ? { sides: props.sides } : {}),
    ...(props.dash ? { dash: [...props.dash] } : {}),
    ...(props.lineCap ? { lineCap: props.lineCap } : {}),
    ...(props.lineJoin ? { lineJoin: props.lineJoin } : {}),
    ...(props.shadow ? { shadow: { ...props.shadow } } : {}),
  };
}

function sanitizePaint(paint: DeckElementPaint): unknown {
  if (typeof paint === "string") return paint;
  if (paint.type === "linear-gradient") {
    return {
      type: paint.type,
      angle: paint.angle,
      stops: paint.stops.map((stop) => ({ ...stop })),
    };
  }
  return {
    type: paint.type,
    preset: communityTemplatePatternPresetSchema.safeParse(paint.preset).success
      ? paint.preset
      : "pct20",
    foreground: paint.foreground,
    background: paint.background,
  };
}

function sanitizeChart(
  chart: Extract<DeckElement, { type: "chart" }>["props"],
) {
  const style = {
    ...chart.style,
    ...(chart.style.fontFamily
      ? { fontFamily: normalizeFontFamily(chart.style.fontFamily) }
      : {}),
    xAxisTitle: "항목",
    yAxisTitle: "값",
    unit: "",
  };
  const cartesianData = [
    { label: "항목 1", series: "시리즈 1", value: 10 },
    { label: "항목 2", series: "시리즈 1", value: 20 },
    { label: "항목 3", series: "시리즈 1", value: 30 },
  ] as const;
  const radialData = [
    { label: "항목 1", value: 10 },
    { label: "항목 2", value: 20 },
    { label: "항목 3", value: 30 },
  ] as const;
  const scatterData = [
    { label: "항목 1", x: 1, y: 10 },
    { label: "항목 2", x: 2, y: 20 },
    { label: "항목 3", x: 3, y: 30 },
  ] as const;

  if (chart.type === "scatter") {
    return { type: chart.type, title: "샘플 차트", style, data: scatterData };
  }
  if (chart.type === "pie" || chart.type === "doughnut") {
    return { type: chart.type, title: "샘플 차트", style, data: radialData };
  }
  return { type: chart.type, title: "샘플 차트", style, data: cartesianData };
}

function createNeutralPlaceholder(
  base: ReturnType<typeof sanitizeElementBase>,
  theme: DeckTheme,
) {
  return communityTemplateElementSchema.parse({
    ...base,
    type: "rect",
    props: {
      fill: theme.palette.muted,
      stroke: theme.palette.border,
      strokeWidth: 1,
      borderRadius: theme.effects.borderRadius,
    },
  });
}

function normalizeFontFamily(fontFamily: string) {
  const result = communityTemplateFontFamilySchema.safeParse(fontFamily);
  return result.success ? result.data : "Pretendard";
}
