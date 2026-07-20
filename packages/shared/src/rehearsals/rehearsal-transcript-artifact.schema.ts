import { z } from "zod";

export const rehearsalTranscriptArtifactSegmentSchema = z
  .object({
    text: z.string(),
    start: z.number().finite().nonnegative().nullable(),
    end: z.number().finite().nonnegative().nullable(),
  })
  .strict();

export const rehearsalTranscriptArtifactSchema = z
  .object({
    text: z.string(),
    liveTranscript: z.string().nullable().optional(),
    language: z.string().min(1),
    duration: z.number().finite().nonnegative(),
    provider: z.string().min(1),
    segments: z.array(rehearsalTranscriptArtifactSegmentSchema),
  })
  .strict();

export type RehearsalTranscriptArtifact = z.infer<
  typeof rehearsalTranscriptArtifactSchema
>;
