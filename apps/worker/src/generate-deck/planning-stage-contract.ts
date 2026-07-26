import {
  deckShellSchema,
  generateDeckResponseSchema,
  type GenerateDeckResponse,
} from "@orbit/shared/deck";
import { type AiDeckGenerationStage } from "@orbit/shared/jobs";
import { z } from "zod";

export const aiDeckPlanningStageSchema = z.enum([
  "source-grounding",
  "content-planning",
  "design-planning",
  "layout-compile",
]);

const jsonObjectSchema = z.record(z.unknown());

export const sourceGroundingArtifactPayloadSchema = z
  .object({
    rawInput: jsonObjectSchema,
    sourceRecords: z.array(jsonObjectSchema),
    warnings: z.array(z.string()),
    webSourceCount: z.number().int().nonnegative(),
  })
  .strict();

const legacyContentPlanningArtifactPayloadSchema = z
  .object({
    rawInput: jsonObjectSchema,
    contentPlan: jsonObjectSchema,
  })
  .strict();

const contentPlanningV2ArtifactPayloadSchema = z
  .object({
    artifactVersion: z.literal(2),
    rawInput: jsonObjectSchema,
    contentPlan: jsonObjectSchema,
  })
  .strict();

export const contentPlanningArtifactPayloadSchema = z.union([
  contentPlanningV2ArtifactPayloadSchema,
  legacyContentPlanningArtifactPayloadSchema,
]);

export const designPlanningArtifactPayloadSchema = z
  .object({ designPlan: jsonObjectSchema })
  .strict();

type LegacyLayoutCompileArtifactPayload = {
  layoutResult: Record<string, unknown>;
  visualRequirements: Record<string, unknown>;
  workerPayload: GenerateDeckResponse;
};

type LegacyLayoutCompileArtifactPayloadInput = {
  layoutResult: Record<string, unknown>;
  visualRequirements: Record<string, unknown>;
  workerPayload: z.input<typeof generateDeckResponseSchema>;
};

const legacyLayoutCompileArtifactPayloadSchema: z.ZodType<
  LegacyLayoutCompileArtifactPayload,
  z.ZodTypeDef,
  LegacyLayoutCompileArtifactPayloadInput
> = z
  .object({
    layoutResult: jsonObjectSchema,
    visualRequirements: jsonObjectSchema,
    workerPayload: generateDeckResponseSchema,
  })
  .strict();

export const layoutManifestSlideSchema = z
  .object({
    sourceOrder: z.number().int().positive(),
    order: z.number().int().positive(),
    slideId: z.string().min(1),
    shardKey: z.string().regex(/^\d{3,}-slide_\d+$/),
  })
  .strict()
  .superRefine((slide, context) => {
    if (slide.slideId !== `slide_${slide.order}`) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slideId"],
        message: "slideId must match order",
      });
    }
    if (!slide.shardKey.endsWith(`-${slide.slideId}`)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["shardKey"],
        message: "shardKey must end with slideId",
      });
    }
  });

const layoutCompileV2ArtifactPayloadSchema = z
  .object({
    artifactVersion: z.literal(2),
    deckShell: deckShellSchema,
    slides: z.array(layoutManifestSlideSchema).min(1),
    warnings: z.array(z.string()),
  })
  .strict()
  .superRefine((artifact, context) => {
    artifact.slides.forEach((slide, index) => {
      if (slide.order !== index + 1 || slide.sourceOrder !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slides", index, "order"],
          message: "manifest orders must be contiguous",
        });
      }
    });
  });

export type LayoutCompileV2ArtifactPayload = z.infer<
  typeof layoutCompileV2ArtifactPayloadSchema
>;
export type LayoutCompileArtifactPayload =
  | LayoutCompileV2ArtifactPayload
  | LegacyLayoutCompileArtifactPayload;

export const layoutCompileArtifactPayloadSchema: z.ZodType<
  LayoutCompileArtifactPayload,
  z.ZodTypeDef,
  unknown
> = z.union([
  layoutCompileV2ArtifactPayloadSchema,
  legacyLayoutCompileArtifactPayloadSchema,
]);

export function isLayoutCompileV2Artifact(
  payload: LayoutCompileArtifactPayload,
): payload is LayoutCompileV2ArtifactPayload {
  return "artifactVersion" in payload && payload.artifactVersion === 2;
}

export type AiDeckPlanningStage = z.infer<typeof aiDeckPlanningStageSchema>;

type PlanningArtifactPayloadSchemaMap = {
  "source-grounding": typeof sourceGroundingArtifactPayloadSchema;
  "content-planning": typeof contentPlanningArtifactPayloadSchema;
  "design-planning": typeof designPlanningArtifactPayloadSchema;
  "layout-compile": typeof layoutCompileArtifactPayloadSchema;
};

export const planningArtifactPayloadSchemas: PlanningArtifactPayloadSchemaMap = {
  "source-grounding": sourceGroundingArtifactPayloadSchema,
  "content-planning": contentPlanningArtifactPayloadSchema,
  "design-planning": designPlanningArtifactPayloadSchema,
  "layout-compile": layoutCompileArtifactPayloadSchema,
};
export type SourceGroundingArtifactPayload = z.infer<
  typeof sourceGroundingArtifactPayloadSchema
>;
export type ContentPlanningArtifactPayload = z.infer<
  typeof contentPlanningArtifactPayloadSchema
>;
export type DesignPlanningArtifactPayload = z.infer<
  typeof designPlanningArtifactPayloadSchema
>;
export type AiDeckPlanningArtifactPayload =
  | SourceGroundingArtifactPayload
  | ContentPlanningArtifactPayload
  | DesignPlanningArtifactPayload
  | LayoutCompileArtifactPayload;

export function isAiDeckPlanningStage(
  stage: AiDeckGenerationStage,
): stage is AiDeckPlanningStage {
  return planningStages.has(stage);
}

export function parsePlanningArtifactPayload(
  stage: AiDeckPlanningStage,
  payload: unknown,
): AiDeckPlanningArtifactPayload {
  return planningArtifactPayloadSchemas[stage].parse(payload);
}

const planningStages = new Set<AiDeckGenerationStage>([
  "source-grounding",
  "content-planning",
  "design-planning",
  "layout-compile",
]);
