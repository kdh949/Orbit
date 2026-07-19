import { z } from "zod";

import {
  activityDefinitionSchema,
  activityResultDefinitionSchema
} from "../activity/activity-definition.schema";
import { isoDateTimeSchema } from "../common/time.schema";
import {
  animationEasingSchema,
  animationSchema,
  animationStartModeSchema,
  animationTypeSchema
} from "./animation.schema";
import {
  deckThumbnailSourceSchema,
  slideBackgroundImageFitSchema,
  slideKeywordsSchema,
  slideLayoutSchema,
  slideOrderSchema,
  slideSchema,
  slideTransitionSchema
} from "./deck.schema";
import {
  deckAnimationIdSchema,
  deckActionIdSchema,
  deckChangeIdSchema,
  deckElementIdSchema,
  deckIdSchema,
  deckSlideIdSchema
} from "./id.schema";
import { semanticCueSchema } from "./semantic-cue.schema";
import { slideActionPatchSchema, slideActionSchema } from "./slide-action.schema";
import {
  deckElementCoordinateSchema,
  deckElementRoleSchema,
  deckElementSchema,
  deckElementSizeSchema
} from "./slide-object.schema";
import { themeColorSchema } from "./theme.schema";

export const deckPatchSourceSchema = z.enum([
  "user",
  "ai",
  "import",
  "system"
]);

export const deckPatchOperationTypeSchema = z.enum([
  "update_deck",
  "add_slide",
  "update_slide",
  "update_slide_transition",
  "delete_slide",
  "reorder_slides",
  "update_theme",
  "update_slide_style",
  "add_element",
  "update_element_frame",
  "update_element_props",
  "delete_element",
  "update_speaker_notes",
  "replace_keywords",
  "replace_semantic_cues",
  "add_animation",
  "update_animation",
  "delete_animation",
  "add_slide_action",
  "update_slide_action",
  "delete_slide_action",
  "update_activity_definition",
  "update_activity_result_definition"
]);

export const themePalettePatchSchema = z.object({
  primary: themeColorSchema.optional(),
  secondary: themeColorSchema.optional(),
  surface: themeColorSchema.optional(),
  muted: themeColorSchema.optional(),
  border: themeColorSchema.optional()
});

export const themeTypographyPatchSchema = z.object({
  headingFontFamily: z.string().min(1).optional(),
  bodyFontFamily: z.string().min(1).optional(),
  titleSize: z.number().finite().positive().optional(),
  headingSize: z.number().finite().positive().optional(),
  bodySize: z.number().finite().positive().optional(),
  captionSize: z.number().finite().positive().optional()
});

export const themeShadowPatchSchema = z.object({
  color: themeColorSchema.optional(),
  blur: z.number().finite().nonnegative().optional(),
  offsetX: z.number().finite().optional(),
  offsetY: z.number().finite().optional(),
  opacity: z.number().finite().min(0).max(1).optional()
});

export const themeEffectsPatchSchema = z.object({
  borderRadius: z.number().finite().nonnegative().optional(),
  shadow: z.union([themeShadowPatchSchema, z.null()]).optional()
});

export const deckThemePatchSchema = z.object({
  name: z.string().min(1).optional(),
  fontFamily: z.string().min(1).optional(),
  backgroundColor: themeColorSchema.optional(),
  textColor: themeColorSchema.optional(),
  accentColor: themeColorSchema.optional(),
  palette: themePalettePatchSchema.optional(),
  typography: themeTypographyPatchSchema.optional(),
  effects: themeEffectsPatchSchema.optional()
});

export const deckMetadataPatchSchema = z.object({
  thumbnailSource: z
    .union([deckThumbnailSourceSchema, z.null()])
    .optional()
});

export const slideBackgroundImagePatchSchema = z.object({
  src: z.string().min(1).optional(),
  alt: z.string().optional(),
  fit: slideBackgroundImageFitSchema.optional(),
  opacity: z.number().finite().min(0).max(1).optional()
});

export const slideStylePatchSchema = z.object({
  layout: z.union([slideLayoutSchema, z.null()]).optional(),
  fontFamily: z.union([z.string().min(1), z.null()]).optional(),
  backgroundColor: z.union([themeColorSchema, z.null()]).optional(),
  textColor: z.union([themeColorSchema, z.null()]).optional(),
  accentColor: z.union([themeColorSchema, z.null()]).optional(),
  backgroundImage: z
    .union([slideBackgroundImagePatchSchema, z.null()])
    .optional()
});

export const elementFramePatchSchema = z.object({
  role: z.union([deckElementRoleSchema, z.null()]).optional(),
  x: deckElementCoordinateSchema.optional(),
  y: deckElementCoordinateSchema.optional(),
  width: deckElementSizeSchema.optional(),
  height: deckElementSizeSchema.optional(),
  rotation: z.number().finite().optional(),
  opacity: z.number().finite().min(0).max(1).optional(),
  zIndex: z.number().int().nonnegative().optional(),
  locked: z.boolean().optional(),
  visible: z.boolean().optional()
});

export const animationPatchSchema = z.object({
  elementId: deckElementIdSchema.optional(),
  type: animationTypeSchema.optional(),
  order: z.number().int().positive().optional(),
  startMode: animationStartModeSchema.optional(),
  durationMs: z.number().int().positive().optional(),
  delayMs: z.number().int().nonnegative().optional(),
  easing: animationEasingSchema.optional()
});

export const updateDeckOperationSchema = z.object({
  type: z.literal("update_deck"),
  title: z.string().min(1).optional(),
  metadata: deckMetadataPatchSchema.optional()
});

export const addSlideOperationSchema = z.object({
  type: z.literal("add_slide"),
  slide: slideSchema
});

export const updateSlideOperationSchema = z.object({
  type: z.literal("update_slide"),
  slideId: deckSlideIdSchema,
  title: z.string().optional(),
  thumbnailUrl: z.string().optional()
});

export const updateSlideTransitionOperationSchema = z.object({
  type: z.literal("update_slide_transition"),
  slideId: deckSlideIdSchema,
  transition: slideTransitionSchema.nullable()
});

export const deleteSlideOperationSchema = z.object({
  type: z.literal("delete_slide"),
  slideId: deckSlideIdSchema
});

export const reorderSlidesOperationSchema = z.object({
  type: z.literal("reorder_slides"),
  slideOrders: z
    .array(
      z.object({
        slideId: deckSlideIdSchema,
        order: slideOrderSchema
      })
    )
    .min(1)
});

export const updateThemeOperationSchema = z.object({
  type: z.literal("update_theme"),
  theme: deckThemePatchSchema
});

export const updateSlideStyleOperationSchema = z.object({
  type: z.literal("update_slide_style"),
  slideId: deckSlideIdSchema,
  style: slideStylePatchSchema
});

export const addElementOperationSchema = z.object({
  type: z.literal("add_element"),
  slideId: deckSlideIdSchema,
  element: deckElementSchema
});

export const updateElementFrameOperationSchema = z.object({
  type: z.literal("update_element_frame"),
  slideId: deckSlideIdSchema,
  elementId: deckElementIdSchema,
  frame: elementFramePatchSchema
});

export const updateElementPropsOperationSchema = z.object({
  type: z.literal("update_element_props"),
  slideId: deckSlideIdSchema,
  elementId: deckElementIdSchema,
  props: z.record(z.unknown())
});

export const deleteElementOperationSchema = z.object({
  type: z.literal("delete_element"),
  slideId: deckSlideIdSchema,
  elementId: deckElementIdSchema
});

export const updateSpeakerNotesOperationSchema = z.object({
  type: z.literal("update_speaker_notes"),
  slideId: deckSlideIdSchema,
  speakerNotes: z.string()
});

export const replaceKeywordsOperationSchema = z.object({
  type: z.literal("replace_keywords"),
  slideId: deckSlideIdSchema,
  keywords: slideKeywordsSchema
});

export const replaceSemanticCuesOperationSchema = z.object({
  type: z.literal("replace_semantic_cues"),
  slideId: deckSlideIdSchema,
  semanticCues: z.array(semanticCueSchema)
});

export const addAnimationOperationSchema = z.object({
  type: z.literal("add_animation"),
  slideId: deckSlideIdSchema,
  animation: animationSchema
});

export const updateAnimationOperationSchema = z.object({
  type: z.literal("update_animation"),
  slideId: deckSlideIdSchema,
  animationId: deckAnimationIdSchema,
  animation: animationPatchSchema
});

export const deleteAnimationOperationSchema = z.object({
  type: z.literal("delete_animation"),
  slideId: deckSlideIdSchema,
  animationId: deckAnimationIdSchema
});

export const addSlideActionOperationSchema = z.object({
  type: z.literal("add_slide_action"),
  slideId: deckSlideIdSchema,
  action: slideActionSchema
});

export const updateSlideActionOperationSchema = z.object({
  type: z.literal("update_slide_action"),
  slideId: deckSlideIdSchema,
  actionId: deckActionIdSchema,
  action: slideActionPatchSchema
});

export const deleteSlideActionOperationSchema = z.object({
  type: z.literal("delete_slide_action"),
  slideId: deckSlideIdSchema,
  actionId: deckActionIdSchema
});

export const updateActivityDefinitionOperationSchema = z
  .object({
    type: z.literal("update_activity_definition"),
    slideId: deckSlideIdSchema,
    activity: activityDefinitionSchema
  })
  .strict();

export const updateActivityResultDefinitionOperationSchema = z
  .object({
    type: z.literal("update_activity_result_definition"),
    slideId: deckSlideIdSchema,
    activityResult: activityResultDefinitionSchema
  })
  .strict();

const deckPatchOperationSchemaInternal = z.discriminatedUnion("type", [
  updateDeckOperationSchema,
  addSlideOperationSchema,
  updateSlideOperationSchema,
  updateSlideTransitionOperationSchema,
  deleteSlideOperationSchema,
  reorderSlidesOperationSchema,
  updateThemeOperationSchema,
  updateSlideStyleOperationSchema,
  addElementOperationSchema,
  updateElementFrameOperationSchema,
  updateElementPropsOperationSchema,
  deleteElementOperationSchema,
  updateSpeakerNotesOperationSchema,
  replaceKeywordsOperationSchema,
  replaceSemanticCuesOperationSchema,
  addAnimationOperationSchema,
  updateAnimationOperationSchema,
  deleteAnimationOperationSchema,
  addSlideActionOperationSchema,
  updateSlideActionOperationSchema,
  deleteSlideActionOperationSchema,
  updateActivityDefinitionOperationSchema,
  updateActivityResultDefinitionOperationSchema
]);

export type DeckPatchOperation = z.infer<
  typeof deckPatchOperationSchemaInternal
>;

export const deckPatchOperationSchema: z.ZodType<
  DeckPatchOperation,
  z.ZodTypeDef,
  unknown
> = deckPatchOperationSchemaInternal;

export const deckPatchSchema = z.object({
  deckId: deckIdSchema,
  baseVersion: z.number().int().positive(),
  source: deckPatchSourceSchema.default("user"),
  actorUserId: z.string().min(1).optional(),
  operations: z.array(deckPatchOperationSchema).min(1)
});

const deckChangeRecordSchemaInternal = z
  .object({
    changeId: deckChangeIdSchema,
    deckId: deckIdSchema,
    beforeVersion: z.number().int().positive(),
    afterVersion: z.number().int().positive(),
    source: deckPatchSourceSchema,
    actorUserId: z.string().min(1).optional(),
    createdAt: isoDateTimeSchema,
    operations: z.array(deckPatchOperationSchema).min(1)
  })
  .refine((record) => record.afterVersion > record.beforeVersion, {
    message: "afterVersion must be greater than beforeVersion",
    path: ["afterVersion"]
  });

export type DeckChangeRecord = z.infer<typeof deckChangeRecordSchemaInternal>;

export const deckChangeRecordSchema: z.ZodType<
  DeckChangeRecord,
  z.ZodTypeDef,
  unknown
> = deckChangeRecordSchemaInternal;

export type DeckPatchSource = z.infer<typeof deckPatchSourceSchema>;
export type DeckPatchOperationType = z.infer<
  typeof deckPatchOperationTypeSchema
>;
export type ThemePalettePatch = z.infer<typeof themePalettePatchSchema>;
export type ThemeTypographyPatch = z.infer<typeof themeTypographyPatchSchema>;
export type ThemeShadowPatch = z.infer<typeof themeShadowPatchSchema>;
export type ThemeEffectsPatch = z.infer<typeof themeEffectsPatchSchema>;
export type DeckThemePatch = z.infer<typeof deckThemePatchSchema>;
export type DeckMetadataPatch = z.infer<typeof deckMetadataPatchSchema>;
export type SlideBackgroundImagePatch = z.infer<
  typeof slideBackgroundImagePatchSchema
>;
export type SlideStylePatch = z.infer<typeof slideStylePatchSchema>;
export type ElementFramePatch = z.infer<typeof elementFramePatchSchema>;
export type AnimationPatch = z.infer<typeof animationPatchSchema>;
export type DeckPatch = z.infer<typeof deckPatchSchema>;
