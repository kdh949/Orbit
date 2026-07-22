import { z } from "zod";

const designPackIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const systemDesignPackSelectionSchema = z.discriminatedUnion("id", [
  z.object({ id: z.literal("neutral-light"), version: z.literal(1) }).strict(),
  z.object({ id: z.literal("neutral-dark"), version: z.literal(1) }).strict(),
  z.object({ id: z.literal("executive-review"), version: z.literal(1) }).strict(),
  z.object({ id: z.literal("kickoff-alignment"), version: z.literal(1) }).strict(),
  z.object({ id: z.literal("editorial-insight"), version: z.literal(1) }).strict()
]);

export const designPackOptionsRequestSchema = z
  .object({
    topic: z.string().trim().min(1).max(500),
    purpose: z.enum(["inform", "persuade", "teach", "report"]).default("inform"),
    profile: z
      .enum([
        "executive-report",
        "startup-pitch",
        "editorial",
        "technical",
        "training"
      ])
      .optional(),
    tone: z
      .enum(["professional", "friendly", "confident", "concise"])
      .default("professional"),
    slideCount: z.number().int().min(1).max(20).default(8),
    mediaPolicy: z
      .enum([
        "avoid",
        "balanced",
        "placeholder-ok",
        "provided-only",
        "public-assets",
        "ai-generated",
        "hybrid",
        "minimal"
      ])
      .default("balanced")
  })
  .strict();

export const designPackPreviewSchema = z
  .object({
    manifestId: designPackIdSchema,
    coverPreviewId: designPackIdSchema,
    bodyPreviewId: designPackIdSchema
  })
  .strict();

export const designPackOptionSchema = z
  .object({
    id: designPackIdSchema,
    version: z.number().int().positive(),
    name: z.string().trim().min(1),
    family: z.enum([
      "neutral",
      "executive-review",
      "kickoff-alignment",
      "editorial-insight"
    ]),
    rationale: z.string().trim().min(1),
    preview: designPackPreviewSchema
  })
  .strict();

export const designPackOptionsResponseSchema = z
  .object({
    catalogVersion: z.number().int().positive(),
    options: z.array(designPackOptionSchema).min(1).max(3),
    fallbackUsed: z.boolean()
  })
  .strict();

export type SystemDesignPackSelection = z.infer<
  typeof systemDesignPackSelectionSchema
>;
export type DesignPackOptionsRequest = z.infer<
  typeof designPackOptionsRequestSchema
>;
export type DesignPackOption = z.infer<typeof designPackOptionSchema>;
export type DesignPackOptionsResponse = z.infer<
  typeof designPackOptionsResponseSchema
>;
