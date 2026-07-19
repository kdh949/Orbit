import { z } from "zod";

import { jobSchema } from "../jobs/job.schema";
import { deckIdSchema } from "./id.schema";

export const deckExportFormatSchema = z.enum(["pptx", "png"]);

export const deckExportRequestSchema = z
  .object({
    format: deckExportFormatSchema.default("pptx"),
    presentationSessionId: z.string().trim().min(1).optional(),
  })
  .strict()
  .default({});

export const deckExportJobResultSchema = z.object({
  deckId: deckIdSchema,
  fileId: z.string().trim().min(1),
  url: z.string().trim().min(1),
  format: deckExportFormatSchema,
  warnings: z.array(z.string()).default([])
});

export const deckExportEnqueueErrorSchema = z
  .object({
    code: z.literal("DECK_EXPORT_ENQUEUE_FAILED"),
    message: z.string().min(1),
    job: jobSchema,
  })
  .strict();

export type DeckExportFormat = z.infer<typeof deckExportFormatSchema>;
export type DeckExportRequest = z.infer<typeof deckExportRequestSchema>;
export type DeckExportJobResult = z.infer<typeof deckExportJobResultSchema>;
export type DeckExportEnqueueError = z.infer<
  typeof deckExportEnqueueErrorSchema
>;
