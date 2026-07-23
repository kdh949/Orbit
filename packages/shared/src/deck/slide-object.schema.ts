import { z } from "zod";

import { chartSchema } from "./chart.schema";
import { deckElementIdSchema } from "./id.schema";
import { themeColorSchema } from "./theme.schema";

export const deckElementTypeSchema = z.enum([
  "text",
  "rect",
  "ellipse",
  "line",
  "arrow",
  "polygon",
  "star",
  "ring",
  "image",
  "activity-qr",
  "activity-copy",
  "presentation-passcode",
  "svg",
  "group",
  "customShape",
  "chart",
  "table",
]);

export const deckElementRoleSchema = z.enum([
  "background",
  "decoration",
  "title",
  "subtitle",
  "body",
  "caption",
  "media",
  "chart",
  "table",
  "highlight",
  "footer",
]);

export const deckElementCoordinateLimit = 1_000_000;
export const deckElementCoordinateSchema = z
  .number()
  .finite()
  .min(-deckElementCoordinateLimit)
  .max(deckElementCoordinateLimit);
export const deckElementSizeSchema = z.number().finite().positive();

export const ooxmlOriginSchema = z.enum(["imported", "authored"]);

export const ooxmlRichTextEditCapabilitySchema = z.enum([
  "none",
  "style-only",
  "full",
]);

export const ooxmlCropEditCapabilitySchema = z.enum([
  "none",
  "picture",
  "picture-fill",
]);

export const ooxmlElementEditCapabilitiesSchema = z.object({
  richText: ooxmlRichTextEditCapabilitySchema,
  crop: ooxmlCropEditCapabilitySchema,
  tableCellText: z.boolean(),
  frame: z.boolean().optional(),
  delete: z.boolean().optional(),
  imageSource: z.boolean().optional(),
});

export const deckElementBaseSchema = z.object({
  elementId: deckElementIdSchema,
  ooxmlOrigin: ooxmlOriginSchema.optional(),
  ooxmlEditCapabilities: ooxmlElementEditCapabilitiesSchema.optional(),
  role: deckElementRoleSchema.optional(),
  x: deckElementCoordinateSchema,
  y: deckElementCoordinateSchema,
  width: deckElementSizeSchema,
  height: deckElementSizeSchema,
  rotation: z.number().finite().default(0),
  opacity: z.number().finite().min(0).max(1).default(1),
  zIndex: z.number().int().nonnegative().default(0),
  locked: z.boolean().default(false),
  visible: z.boolean().default(true),
});

export const deckElementGradientStopSchema = z.object({
  offset: z.number().finite().min(0).max(1),
  color: themeColorSchema,
  opacity: z.number().finite().min(0).max(1).default(1),
});

export const deckElementLinearGradientPaintSchema = z.object({
  type: z.literal("linear-gradient"),
  angle: z.number().finite().default(0),
  stops: z.array(deckElementGradientStopSchema).min(2),
});

export const deckElementPatternPaintSchema = z.object({
  type: z.literal("pattern"),
  preset: z.string().min(1).default("pct20"),
  foreground: themeColorSchema,
  background: themeColorSchema.default("#FFFFFF"),
});

export const deckElementPaintSchema = z.union([
  themeColorSchema,
  z.literal("transparent"),
  deckElementLinearGradientPaintSchema,
  deckElementPatternPaintSchema,
]);

export const deckElementShadowSchema = z.object({
  color: themeColorSchema.default("#000000"),
  blur: z.number().finite().nonnegative().default(0),
  offsetX: z.number().finite().default(0),
  offsetY: z.number().finite().default(0),
  opacity: z.number().finite().min(0).max(1).default(0.25),
});

export const shapeElementPropsSchema = z
  .object({
    fill: deckElementPaintSchema.default("transparent"),
    stroke: deckElementPaintSchema.default("transparent"),
    strokeWidth: z.number().finite().nonnegative().default(0),
    borderRadius: z.number().finite().nonnegative().default(0),
    sides: z.number().int().min(3).max(12).optional(),
    dash: z.array(z.number().finite().positive()).optional(),
    lineCap: z.enum(["butt", "round", "square"]).optional(),
    lineJoin: z.enum(["miter", "round", "bevel"]).optional(),
    shadow: deckElementShadowSchema.optional(),
  })
  .default({});

export const textAlignSchema = z.enum(["left", "center", "right", "justify"]);

export const textVerticalAlignSchema = z.enum(["top", "middle", "bottom"]);
export const textWritingModeSchema = z.enum(["horizontal", "vertical-270"]);

export const textFontWeightSchema = z.union([
  z.enum(["normal", "medium", "semibold", "bold"]),
  z.number().int().min(100).max(900),
]);

export const textElementRunSchema = z.object({
  text: z.string().default(""),
  fontFamily: z.string().min(1).optional(),
  fontSize: z.number().finite().positive().optional(),
  fontWeight: textFontWeightSchema.optional(),
  letterSpacing: z.number().finite().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: themeColorSchema.optional(),
  baseline: z.enum(["normal", "superscript", "subscript"]).default("normal"),
});

export const textElementBulletSchema = z.object({
  enabled: z.boolean().default(false),
  character: z.string().min(1).default("\u2022"),
  indent: z.number().finite().nonnegative().default(0),
});

export const textElementParagraphSchema = z.object({
  text: z.string().default(""),
  runs: z.array(textElementRunSchema).optional(),
  fontFamily: z.string().min(1).optional(),
  fontSize: z.number().finite().positive().optional(),
  fontWeight: textFontWeightSchema.optional(),
  letterSpacing: z.number().finite().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: themeColorSchema.optional(),
  align: textAlignSchema.default("left"),
  lineHeight: z.number().finite().positive().default(1.2),
  spaceBefore: z.number().finite().nonnegative().default(0),
  spaceAfter: z.number().finite().nonnegative().default(0),
  indent: z.number().finite().default(0),
  bullet: textElementBulletSchema.optional(),
});

export const textElementBodyInsetSchema = z.object({
  left: z.number().finite().nonnegative().default(0),
  right: z.number().finite().nonnegative().default(0),
  top: z.number().finite().nonnegative().default(0),
  bottom: z.number().finite().nonnegative().default(0),
});

export const textElementPropsSchema = z
  .object({
    text: z.string().default(""),
    runs: z.array(textElementRunSchema).optional(),
    paragraphs: z.array(textElementParagraphSchema).optional(),
    bodyInset: textElementBodyInsetSchema.optional(),
    fontFamily: z.string().min(1).optional(),
    fontSize: z.number().finite().positive().default(24),
    fontWeight: textFontWeightSchema.default("normal"),
    letterSpacing: z.number().finite().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    color: themeColorSchema.optional(),
    align: textAlignSchema.default("left"),
    verticalAlign: textVerticalAlignSchema.default("top"),
    writingMode: textWritingModeSchema.optional(),
    autoFit: z.enum(["none", "shrink-text", "resize-shape"]).optional(),
    fontScale: z.number().finite().positive().max(1).optional(),
    lineSpaceReduction: z.number().finite().min(0).max(1).optional(),
    lineHeight: z.number().finite().positive().default(1.2),
    bullet: textElementBulletSchema.optional(),
  })
  .superRefine((props, ctx) => {
    if (
      props.autoFit !== "shrink-text" &&
      (props.fontScale !== undefined || props.lineSpaceReduction !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "fontScale and lineSpaceReduction require autoFit=shrink-text",
      });
    }
  })
  .default({});

export const imageFitSchema = z.enum(["contain", "cover", "stretch"]);

export const imageCropSchema = z
  .object({
    left: z.number().finite().min(0).max(1).default(0),
    top: z.number().finite().min(0).max(1).default(0),
    right: z.number().finite().min(0).max(1).default(0),
    bottom: z.number().finite().min(0).max(1).default(0),
  })
  .superRefine((crop, ctx) => {
    if (crop.left + crop.right >= 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "image crop left and right must leave visible width",
      });
    }
    if (crop.top + crop.bottom >= 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "image crop top and bottom must leave visible height",
      });
    }
  });

export const imageElementPropsSchema = z.object({
  src: z.string().min(1),
  alt: z.string().default(""),
  fit: imageFitSchema.default("contain"),
  focusX: z.number().finite().min(0).max(1).default(0.5),
  focusY: z.number().finite().min(0).max(1).default(0.5),
  crop: imageCropSchema.optional(),
});

/**
 * A stable reference to an activity whose participant URL is resolved at
 * presentation time. The URL and rendered QR bitmap are deliberately not
 * persisted in Deck JSON because both are scoped to a presentation session.
 */
export const activityQrElementPropsSchema = z.object({
  activityId: z.string().trim().min(1),
});

export const activityCopyFieldSchema = z.enum(["title", "description"]);

export const activityCopyElementPropsSchema = z.object({
  activityId: z.string().trim().min(1),
  field: activityCopyFieldSchema,
  fallbackText: z.string().default(""),
  textStyle: textElementPropsSchema.default({}),
});

export const presentationPasscodeElementPropsSchema = z.object({
  label: z.string().default("입장 코드"),
  unavailableText: z.string().default("발표 시작 후 표시"),
  publicAccessText: z.string().default("비밀번호 없이 바로 참여"),
  legacyUnavailableText: z.string().default("입장 코드를 다시 설정해 주세요"),
  labelTextStyle: textElementPropsSchema.default({
    fontSize: 22,
    fontWeight: "medium",
  }),
  codeTextStyle: textElementPropsSchema.default({
    fontSize: 64,
    fontWeight: "bold",
    letterSpacing: 12,
    align: "center",
    verticalAlign: "middle",
  }),
  fill: deckElementPaintSchema.default("transparent"),
  stroke: deckElementPaintSchema.default("transparent"),
  strokeWidth: z.number().finite().nonnegative().default(0),
  borderRadius: z.number().finite().nonnegative().default(0),
});

export const svgElementPropsSchema = imageElementPropsSchema;

export const groupElementPropsSchema = z
  .object({
    childElementIds: z.array(deckElementIdSchema).default([]),
  })
  .default({});

export const tableCellPropsSchema = z.object({
  text: z.string().default(""),
  fill: deckElementPaintSchema.default("transparent"),
  textColor: themeColorSchema.optional(),
  fontFamily: z.string().min(1).optional(),
  fontSize: z.number().finite().positive().default(18),
  fontWeight: textFontWeightSchema.default("normal"),
  align: textAlignSchema.default("left"),
  verticalAlign: textVerticalAlignSchema.default("middle"),
  borderColor: themeColorSchema.default("#CBD5E1"),
  borderWidth: z.number().finite().nonnegative().default(1),
  colSpan: z.number().int().positive().default(1),
  rowSpan: z.number().int().positive().default(1),
});

export const tableElementPropsSchema = z
  .object({
    rows: z.array(z.array(tableCellPropsSchema)).default([]),
    columnWidths: z.array(z.number().finite().positive()).optional(),
    rowHeights: z.array(z.number().finite().positive()).optional(),
    borderColor: themeColorSchema.default("#CBD5E1"),
    borderWidth: z.number().finite().nonnegative().default(1),
  })
  .default({});

export const customShapeNodeModeSchema = z.enum(["corner", "smooth"]);

export const customShapeNodeSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  inX: z.number().finite().optional(),
  inY: z.number().finite().optional(),
  outX: z.number().finite().optional(),
  outY: z.number().finite().optional(),
  mode: customShapeNodeModeSchema.default("corner"),
});

export const customShapeElementPropsSchema = z.object({
  pathData: z.string().min(1),
  viewBoxWidth: z.number().finite().positive(),
  viewBoxHeight: z.number().finite().positive(),
  fill: deckElementPaintSchema.default("transparent"),
  stroke: deckElementPaintSchema.default("transparent"),
  strokeWidth: z.number().finite().nonnegative().default(0),
  dash: z.array(z.number().finite().positive()).optional(),
  lineCap: z.enum(["butt", "round", "square"]).optional(),
  lineJoin: z.enum(["miter", "round", "bevel"]).optional(),
  shadow: deckElementShadowSchema.optional(),
  closed: z.boolean().default(true),
  nodes: z.array(customShapeNodeSchema).default([]),
});

type ShapeElementType =
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "polygon"
  | "star"
  | "ring";

const createShapeElementSchema = <TElementType extends ShapeElementType>(
  type: TElementType,
) =>
  deckElementBaseSchema.extend({
    type: z.literal(type),
    props: shapeElementPropsSchema,
  });

export const textElementSchema = deckElementBaseSchema.extend({
  type: z.literal("text"),
  props: textElementPropsSchema,
});

export const rectElementSchema = createShapeElementSchema("rect");
export const ellipseElementSchema = createShapeElementSchema("ellipse");
export const lineElementSchema = createShapeElementSchema("line");
export const arrowElementSchema = createShapeElementSchema("arrow");
export const polygonElementSchema = createShapeElementSchema("polygon");
export const starElementSchema = createShapeElementSchema("star");
export const ringElementSchema = createShapeElementSchema("ring");

export const imageElementSchema = deckElementBaseSchema.extend({
  type: z.literal("image"),
  props: imageElementPropsSchema,
});

export const activityQrElementSchema = deckElementBaseSchema.extend({
  type: z.literal("activity-qr"),
  props: activityQrElementPropsSchema,
});

export const activityCopyElementSchema = deckElementBaseSchema.extend({
  type: z.literal("activity-copy"),
  props: activityCopyElementPropsSchema,
});

export const presentationPasscodeElementSchema = deckElementBaseSchema.extend({
  type: z.literal("presentation-passcode"),
  props: presentationPasscodeElementPropsSchema,
});

export const svgElementSchema = deckElementBaseSchema.extend({
  type: z.literal("svg"),
  props: svgElementPropsSchema,
});

export const groupElementSchema = deckElementBaseSchema.extend({
  type: z.literal("group"),
  props: groupElementPropsSchema,
});

export const customShapeElementSchema = deckElementBaseSchema.extend({
  type: z.literal("customShape"),
  props: customShapeElementPropsSchema,
});

export const chartElementSchema = deckElementBaseSchema.extend({
  type: z.literal("chart"),
  props: chartSchema,
});

export const tableElementSchema = deckElementBaseSchema.extend({
  type: z.literal("table"),
  props: tableElementPropsSchema,
});

export const deckElementSchema = z.discriminatedUnion("type", [
  textElementSchema,
  rectElementSchema,
  ellipseElementSchema,
  lineElementSchema,
  arrowElementSchema,
  polygonElementSchema,
  starElementSchema,
  ringElementSchema,
  imageElementSchema,
  activityQrElementSchema,
  activityCopyElementSchema,
  presentationPasscodeElementSchema,
  svgElementSchema,
  groupElementSchema,
  customShapeElementSchema,
  chartElementSchema,
  tableElementSchema,
]);

export type DeckElementType = z.infer<typeof deckElementTypeSchema>;
export type DeckElementRole = z.infer<typeof deckElementRoleSchema>;
export type DeckElementPaint = z.infer<typeof deckElementPaintSchema>;
export type DeckElementLinearGradientPaint = z.infer<
  typeof deckElementLinearGradientPaintSchema
>;
export type DeckElementPatternPaint = z.infer<
  typeof deckElementPatternPaintSchema
>;
export type DeckElementShadow = z.infer<typeof deckElementShadowSchema>;
export type ShapeElementProps = z.infer<typeof shapeElementPropsSchema>;
export type TextElementRun = z.infer<typeof textElementRunSchema>;
export type TextElementBullet = z.infer<typeof textElementBulletSchema>;
export type TextElementParagraph = z.infer<typeof textElementParagraphSchema>;
export type TextAlign = z.infer<typeof textAlignSchema>;
export type TextVerticalAlign = z.infer<typeof textVerticalAlignSchema>;
export type TextFontWeight = z.infer<typeof textFontWeightSchema>;
export type TextElementProps = z.infer<typeof textElementPropsSchema>;
export type ImageFit = z.infer<typeof imageFitSchema>;
export type ImageElementProps = z.infer<typeof imageElementPropsSchema>;
export type ActivityQrElementProps = z.infer<
  typeof activityQrElementPropsSchema
>;
export type ActivityCopyField = z.infer<typeof activityCopyFieldSchema>;
export type ActivityCopyElementProps = z.infer<
  typeof activityCopyElementPropsSchema
>;
export type PresentationPasscodeElementProps = z.infer<
  typeof presentationPasscodeElementPropsSchema
>;
export type SvgElementProps = z.infer<typeof svgElementPropsSchema>;
export type GroupElementProps = z.infer<typeof groupElementPropsSchema>;
export type TableCellProps = z.infer<typeof tableCellPropsSchema>;
export type TableElementProps = z.infer<typeof tableElementPropsSchema>;
export type CustomShapeNodeMode = z.infer<typeof customShapeNodeModeSchema>;
export type CustomShapeNode = z.infer<typeof customShapeNodeSchema>;
export type CustomShapeElementProps = z.infer<
  typeof customShapeElementPropsSchema
>;
export type DeckElement = z.infer<typeof deckElementSchema>;
