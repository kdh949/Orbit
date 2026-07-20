import { z } from "zod";

import { isoDateTimeSchema } from "../common/time.schema";
import { aiDeckGenerationStageSchema } from "./ai-deck-generation-stage.schema";

export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
]);

export const historicalJobTypeSchema = z.enum([
  "pptx-import",
  "deck-export",
  "reference-extract",
  "ai-deck-generation",
  "ai-template-deck-generation",
  "semantic-cue-extraction",
  "speaker-notes-suggestion",
  "design-image-generation",
  "pptx-ooxml-generation",
  "pptx-ooxml-sync",
  "worker-health-check",
  "rehearsal-stt",
  "rehearsal-semantic-evaluation",
  "final-report-generation",
  "report-pdf-export",
  "focused-practice-analysis",
  "slide-practice-analysis",
  "challenge-qna-generation",
  "challenge-qna-answer-analysis",
  "slide-question-guide-generation",
  "private-audio-cleanup",
  "activity-response-retention",
]);

export const jobTypeSchema = historicalJobTypeSchema;
export const activeJobTypeSchema = historicalJobTypeSchema.exclude([
  "pptx-import",
  "ai-template-deck-generation",
]);

export const internalCoachingJobTypeSchema = z.enum([
  "focused-practice-analysis",
  "slide-practice-analysis",
  "challenge-qna-generation",
  "challenge-qna-answer-analysis",
  "slide-question-guide-generation",
  "private-audio-cleanup",
]);

export const publicCreatableJobTypeSchema = z.enum([
  "deck-export",
  "reference-extract",
  "ai-deck-generation",
  "semantic-cue-extraction",
  "pptx-ooxml-generation",
  "pptx-ooxml-sync",
  "worker-health-check",
  "rehearsal-stt",
  "rehearsal-semantic-evaluation",
  "final-report-generation",
  "report-pdf-export",
]);

export const jobErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  failedStage: aiDeckGenerationStageSchema.optional(),
  retryable: z.boolean().optional(),
  syncCapabilityVersion: z.number().int().positive().optional(),
});

export const jobSchema = z.object({
  jobId: z.string().min(1),
  projectId: z.string().min(1),
  type: historicalJobTypeSchema,
  status: jobStatusSchema,
  progress: z.number().int().min(0).max(100),
  message: z.string().default(""),
  result: z.record(z.unknown()).nullable(),
  error: jobErrorSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type Job = z.infer<typeof jobSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobType = z.infer<typeof jobTypeSchema>;
export type ActiveJobType = z.infer<typeof activeJobTypeSchema>;
export type InternalCoachingJobType = z.infer<typeof internalCoachingJobTypeSchema>;
export type PublicCreatableJobType = z.infer<typeof publicCreatableJobTypeSchema>;
export type JobError = z.infer<typeof jobErrorSchema>;
