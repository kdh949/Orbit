import { z } from "zod";

import { openAiRealtimeTranscriptionDelaySchema } from "../config/runtime";

export const realtimeTranscriptionClientSecretResponseSchema = z
  .object({
    clientSecret: z.string().min(1),
    delay: openAiRealtimeTranscriptionDelaySchema,
    expiresAt: z.number().int().positive(),
    model: z.string().trim().min(1)
  })
  .strict();

export type RealtimeTranscriptionClientSecretResponse = z.infer<
  typeof realtimeTranscriptionClientSecretResponseSchema
>;
