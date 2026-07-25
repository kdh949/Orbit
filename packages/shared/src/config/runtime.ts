import { z } from "zod";

export const nodeEnvSchema = z.enum(["development", "test", "production"]);
export const appEnvSchema = z.enum(["local", "test", "staging", "production"]);
export const storageDriverSchema = z.enum(["minio", "s3"]);
export const jobQueueDriverSchema = z.enum(["bullmq", "sqs"]);
export const liveSttProviderSchema = z.literal("sherpa");
export const reportSttProviderSchema = z.enum(["openai", "whisperx"]);
export const openAiRealtimeTranscriptionDelaySchema = z.enum([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
]);
export const ocrProviderSchema = z.enum(["python", "textract"]);
export const llmProviderSchema = z.literal("openai");

export const openAiRehearsalAudioMaxBytes = 25_000_000;
export const defaultRehearsalAudioMaxBytes = openAiRehearsalAudioMaxBytes;

export const openAiModelDefaults = {
  model: "gpt-4.1-mini",
  embeddingModel: "text-embedding-3-small",
  realtimeTranscriptionModel: "gpt-realtime-whisper",
  realtimeTranscriptionDelay: "minimal",
  realtimeClientSecretTtlSeconds: 600
} as const;

export type NodeEnv = z.infer<typeof nodeEnvSchema>;
export type AppEnv = z.infer<typeof appEnvSchema>;
export type StorageDriver = z.infer<typeof storageDriverSchema>;
export type JobQueueDriver = z.infer<typeof jobQueueDriverSchema>;
export type LiveSttProvider = z.infer<typeof liveSttProviderSchema>;
export type ReportSttProvider = z.infer<typeof reportSttProviderSchema>;
export type OpenAiRealtimeTranscriptionDelay = z.infer<
  typeof openAiRealtimeTranscriptionDelaySchema
>;
export type OcrProvider = z.infer<typeof ocrProviderSchema>;
export type LlmProvider = z.infer<typeof llmProviderSchema>;
