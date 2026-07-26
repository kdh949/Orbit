import {
  generateDeckJobResultSchema,
  generateDeckResponseSchema,
  generateDeckValidationSchema,
  slideSchema,
  type GenerateDeckResponse,
  type GenerateDeckJobResult,
} from "@orbit/shared/deck";
import { type AiDeckGenerationStage } from "@orbit/shared/jobs";
import { z } from "zod";

export const aiDeckExecutionStageSchema = z.enum([
  "cover-slide",
  "image-slide",
  "semantic-quality",
  "rendered-visual-quality",
  "publication",
]);
export type AiDeckExecutionStage = z.infer<typeof aiDeckExecutionStageSchema>;

export const coverSlideArtifactPayloadSchema = z
  .object({
    deck: generateDeckResponseSchema.shape.deck,
    warnings: z.array(z.string()),
    validation: generateDeckValidationSchema,
  })
  .strict();

const legacyImageSlideArtifactPayloadSchema = z
  .object({
    slide: slideSchema,
    warnings: z.array(z.string()),
  })
  .strict();

export const completedSlideV2ArtifactPayloadSchema = z
  .object({
    artifactVersion: z.literal(2),
    sourceOrder: z.number().int().positive(),
    order: z.number().int().positive(),
    slideId: z.string().min(1),
    slide: slideSchema,
    warnings: z.array(z.string()),
    validation: generateDeckValidationSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    if (
      artifact.slideId !== artifact.slide.slideId ||
      artifact.order !== artifact.slide.order
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slide"],
        message: "completed slide identity must match its artifact",
      });
    }
  });

export const imageSlideArtifactPayloadSchema = z.union([
  completedSlideV2ArtifactPayloadSchema,
  legacyImageSlideArtifactPayloadSchema,
]);

export type CompletedSlideV2ArtifactPayload = z.infer<
  typeof completedSlideV2ArtifactPayloadSchema
>;

export function isCompletedSlideV2Artifact(
  payload: unknown,
): payload is CompletedSlideV2ArtifactPayload {
  return completedSlideV2ArtifactPayloadSchema.safeParse(payload).success;
}

export type QualityArtifactPayload = {
  workerPayload: GenerateDeckResponse;
};

type QualityArtifactPayloadInput = {
  workerPayload: z.input<typeof generateDeckResponseSchema>;
};

export const qualityArtifactPayloadSchema: z.ZodType<
  QualityArtifactPayload,
  z.ZodTypeDef,
  QualityArtifactPayloadInput
> = z
  .object({
    workerPayload: generateDeckResponseSchema,
  })
  .strict();

export const publicationArtifactPayloadSchema: z.ZodType<
  { result: GenerateDeckJobResult },
  z.ZodTypeDef,
  { result: z.input<typeof generateDeckJobResultSchema> }
> = z
  .object({
    result: generateDeckJobResultSchema,
  })
  .strict();

export const executionArtifactPayloadSchemas: Record<
  AiDeckExecutionStage,
  z.ZodTypeAny
> = {
  "cover-slide": coverSlideArtifactPayloadSchema,
  "image-slide": imageSlideArtifactPayloadSchema,
  "semantic-quality": qualityArtifactPayloadSchema,
  "rendered-visual-quality": qualityArtifactPayloadSchema,
  publication: publicationArtifactPayloadSchema,
};
export type AiDeckExecutionArtifactPayload =
  | z.infer<typeof coverSlideArtifactPayloadSchema>
  | z.infer<typeof imageSlideArtifactPayloadSchema>
  | QualityArtifactPayload
  | z.infer<typeof publicationArtifactPayloadSchema>;

export function isAiDeckExecutionStage(
  stage: AiDeckGenerationStage,
): stage is AiDeckExecutionStage {
  return executionStages.has(stage);
}

export function parseExecutionArtifactPayload(
  stage: AiDeckExecutionStage,
  payload: unknown,
): AiDeckExecutionArtifactPayload {
  return executionArtifactPayloadSchemas[stage].parse(
    payload,
  ) as AiDeckExecutionArtifactPayload;
}

const executionStages = new Set<AiDeckGenerationStage>([
  "cover-slide",
  "image-slide",
  "semantic-quality",
  "rendered-visual-quality",
  "publication",
]);
