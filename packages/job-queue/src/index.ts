import {
  Job,
  type ActiveJobType,
  type AiDeckExecutionMode,
  type AiDeckGenerationStage,
  type AiDeckGenerationStageMessage,
  aiDeckGenerationStageMessageSchema,
  deckSchema,
  demoIds,
  deckExportFormatSchema,
  generateDeckRequestSchema,
  jobSchema,
  semanticCueExtractionJobPayloadSchema,
  speakerNotesSuggestionJobPayloadSchema,
  rehearsalSemanticEvaluationJobPayloadSchema,
  focusedPracticeAnalysisJobPayloadSchema,
  slidePracticeAnalysisJobPayloadSchema,
  challengeQnaGenerationJobPayloadSchema,
  challengeQnaAnswerAnalysisJobPayloadSchema,
  slideQuestionGuideJobPayloadSchema,
  designImageGenerationJobPayloadSchema,
  activityResponseRetentionJobPayloadSchema,
  nowIso,
  type Deck,
  type DeckExportFormat,
  type PptxOoxmlGenerationRequest,
  type GenerateDeckRequest,
  type SavedDesignPackSnapshot,
  type SemanticCueExtractionJobPayload,
  type SpeakerNotesSuggestionJobPayload,
  type RehearsalSemanticEvaluationJobPayload,
  type DesignImageGenerationJobPayload,
  type ActivityResponseRetentionJobPayload,
} from "@orbit/shared";
import { Queue } from "bullmq";

export interface EnqueueJobInput {
  projectId?: string;
  type: ActiveJobType;
  payload?: Record<string, unknown>;
}

export interface JobQueuePort {
  enqueue(input: EnqueueJobInput): Promise<Job>;
  update(jobId: string, patch: UpdateJobInput): Promise<Job | null>;
  get(jobId: string): Promise<Job | null>;
}

export type UpdateJobInput = Partial<
  Pick<Job, "status" | "progress" | "message" | "result" | "error">
>;

export const referenceExtractQueueName = "reference-extract";
export const referenceExtractJobName = "reference-extract";
export const rehearsalSttQueueName = "rehearsal-stt";
export const rehearsalSttJobName = "rehearsal-stt";
export const rehearsalSemanticEvaluationQueueName =
  "rehearsal-semantic-evaluation";
export const rehearsalSemanticEvaluationJobName =
  "rehearsal-semantic-evaluation";
export const focusedPracticeAnalysisQueueName = "focused-practice-analysis";
export const focusedPracticeAnalysisJobName = "focused-practice-analysis";
export const slidePracticeAnalysisQueueName = "slide-practice-analysis";
export const slidePracticeAnalysisJobName = "slide-practice-analysis";
export const challengeQnaGenerationQueueName = "challenge-qna-generation";
export const challengeQnaGenerationJobName = "challenge-qna-generation";
export const challengeQnaAnswerAnalysisQueueName = "challenge-qna-answer-analysis";
export const challengeQnaAnswerAnalysisJobName = "challenge-qna-answer-analysis";
export const slideQuestionGuideGenerationQueueName = "slide-question-guide-generation";
export const slideQuestionGuideGenerationJobName = "slide-question-guide-generation";
export const generateDeckQueueName = "generate-deck";
export const generateDeckJobName = "generate-deck";
export const generateDeckStagedCoordinatorJobName =
  "generate-deck-staged-coordinator";
export const aiDeckResearchContentQueueName = "ai-deck-research-content";
export const aiDeckDesignLayoutQueueName = "ai-deck-design-layout";
export const aiDeckImageQueueName = "ai-deck-image";
export const aiDeckQaFinalizeQueueName = "ai-deck-qa-finalize";
export const deckExportQueueName = "deck-export";
export const deckExportJobName = "deck-export";
export const semanticCueExtractionQueueName = "semantic-cue-extraction";
export const semanticCueExtractionJobName = "semantic-cue-extraction";
export const speakerNotesSuggestionQueueName = "speaker-notes-suggestion";
export const speakerNotesSuggestionJobName = "speaker-notes-suggestion";
export const designImageGenerationQueueName = "design-image-generation";
export const designImageGenerationJobName = "design-image-generation";
export const pptxOoxmlGenerationQueueName = "pptx-ooxml-generation";
export const pptxOoxmlGenerationJobName = "pptx-ooxml-generation";
export const pptxOoxmlSyncQueueName = "pptx-ooxml-sync";
export const pptxOoxmlSyncJobName = "pptx-ooxml-sync";
export const workerHealthCheckQueueName = "worker-health-check";
export const workerHealthCheckJobName = "worker-health-check";
export const activityResponseRetentionQueueName = "activity-response-retention";
export const activityResponseRetentionJobName = "activity-response-retention";

export function aiDeckGenerationStageJobId(
  input: AiDeckGenerationStageMessage,
): string {
  const message = aiDeckGenerationStageMessageSchema.parse(input);
  return `${message.pipelineJobId}:${message.stage}:${message.shardKey}`;
}

export interface ReferenceExtractBullMqFile {
  fileId: string;
  originalName: string;
  mimeType: string;
  contentBase64: string;
}

export interface ReferenceExtractBullMqPayload {
  jobId: string;
  projectId: string;
  files: ReferenceExtractBullMqFile[];
}

export interface EnqueueReferenceExtractJobInput extends ReferenceExtractBullMqPayload {
  driver: "bullmq" | "sqs";
  redisUrl: string;
}

export interface RehearsalSttBullMqPayload {
  jobId: string;
  projectId: string;
  runId: string;
  deckId: string;
  audioFileId: string;
  liveTranscript?: string | null;
}

export interface EnqueueRehearsalSttJobInput extends RehearsalSttBullMqPayload {
  driver: "bullmq" | "sqs";
  redisUrl: string;
}

export type RehearsalSemanticEvaluationBullMqPayload =
  RehearsalSemanticEvaluationJobPayload;

export type EnqueueRehearsalSemanticEvaluationJobInput =
  RehearsalSemanticEvaluationBullMqPayload & {
    driver: "bullmq" | "sqs";
    redisUrl: string;
  };

export type EnqueueFocusedPracticeAnalysisJobInput = {
  driver: "bullmq" | "sqs";
  redisUrl: string;
  jobId: string;
  projectId: string;
  practiceSessionId: string;
  attemptId: string;
  audioFileId: string;
};

export type EnqueueSlidePracticeAnalysisJobInput = {
  driver: "bullmq" | "sqs";
  redisUrl: string;
  jobId: string;
  projectId: string;
  analysisId: string;
};

export type EnqueueChallengeQnaGenerationJobInput = {
  driver: "bullmq" | "sqs"; redisUrl: string; jobId: string; projectId: string;
  qnaSessionId: string; generationRevision: number;
};

export type EnqueueChallengeQnaAnswerAnalysisJobInput = {
  driver: "bullmq" | "sqs"; redisUrl: string; jobId: string; projectId: string;
  answerAttemptId: string;
};

export type EnqueueSlideQuestionGuideGenerationJobInput = {
  driver: "bullmq" | "sqs";
  redisUrl: string;
  jobId: string;
  projectId: string;
  guideId: string;
};

export interface GenerateDeckBullMqPayload {
  jobId: string;
  projectId: string;
  request: GenerateDeckRequest;
  designPackSnapshot?: SavedDesignPackSnapshot;
  requestedByUserId?: string;
  imageAssetScope?: {
    userId: string;
  };
}

export interface EnqueueGenerateDeckJobInput extends GenerateDeckBullMqPayload {
  driver: "bullmq" | "sqs";
  executionMode?: AiDeckExecutionMode;
  redisUrl: string;
}

export interface AiDeckStagedCoordinatorBullMqPayload {
  jobId: string;
  projectId: string;
}

export interface EnqueueAiDeckGenerationStageJobInput {
  driver: "bullmq" | "sqs";
  redisUrl: string;
  message: AiDeckGenerationStageMessage;
}

export interface AiDeckGenerationStageEnqueueResult {
  jobId: string;
  state: string;
}

export interface DeckExportBullMqPayload {
  jobId: string;
  projectId: string;
  deck: Deck;
  format: DeckExportFormat;
  presentationSessionId?: string;
}

export interface EnqueueDeckExportJobInput extends DeckExportBullMqPayload {
  driver: "bullmq" | "sqs";
  redisUrl: string;
}

export type SemanticCueExtractionBullMqPayload = SemanticCueExtractionJobPayload;

export type EnqueueSemanticCueExtractionJobInput =
  SemanticCueExtractionBullMqPayload & {
  driver: "bullmq" | "sqs";
  redisUrl: string;
};

export type SpeakerNotesSuggestionBullMqPayload =
  SpeakerNotesSuggestionJobPayload;

export type EnqueueSpeakerNotesSuggestionJobInput =
  SpeakerNotesSuggestionBullMqPayload & {
    driver: "bullmq" | "sqs";
    redisUrl: string;
  };

export type DesignImageGenerationBullMqPayload =
  DesignImageGenerationJobPayload;

export type EnqueueDesignImageGenerationJobInput =
  DesignImageGenerationBullMqPayload & {
    driver: "bullmq" | "sqs";
    redisUrl: string;
  };

export interface PptxOoxmlGenerationBullMqPayload {
  jobId: string;
  projectId: string;
  request: PptxOoxmlGenerationRequest;
}

export interface EnqueuePptxOoxmlGenerationJobInput extends PptxOoxmlGenerationBullMqPayload {
  driver: "bullmq" | "sqs";
  redisUrl: string;
}

export interface PptxOoxmlSyncBullMqPayload {
  jobId: string;
  projectId: string;
  deckId: string;
  changeId: string;
  targetDeckVersion: number;
  syncCapabilityVersion: number;
}

export interface EnqueuePptxOoxmlSyncJobInput extends PptxOoxmlSyncBullMqPayload {
  driver: "bullmq" | "sqs";
  redisUrl: string;
}

export interface WorkerHealthCheckBullMqPayload {
  jobId: string;
  projectId: string;
}

export interface EnqueueWorkerHealthCheckJobInput extends WorkerHealthCheckBullMqPayload {
  driver: "bullmq" | "sqs";
  redisUrl: string;
}

export type ActivityResponseRetentionBullMqPayload =
  ActivityResponseRetentionJobPayload;

export type EnqueueActivityResponseRetentionJobInput =
  ActivityResponseRetentionBullMqPayload & {
    driver: "bullmq" | "sqs";
    redisUrl: string;
  };

export async function enqueueReferenceExtractJob(
  input: EnqueueReferenceExtractJobInput,
): Promise<void> {
  if (input.driver === "sqs") {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }

  const queue = new Queue(referenceExtractQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });

  try {
    await queue.add(referenceExtractJobName, {
      jobId: input.jobId,
      projectId: input.projectId,
      files: input.files,
    } satisfies ReferenceExtractBullMqPayload, canonicalJobOptions(input.jobId));
  } finally {
    await queue.close();
  }
}

export async function enqueueRehearsalSttJob(
  input: EnqueueRehearsalSttJobInput,
): Promise<void> {
  if (input.driver === "sqs") {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }

  const queue = new Queue(rehearsalSttQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });

  try {
    await queue.add(rehearsalSttJobName, {
      jobId: input.jobId,
      projectId: input.projectId,
      runId: input.runId,
      deckId: input.deckId,
      audioFileId: input.audioFileId,
      liveTranscript: input.liveTranscript ?? null,
    } satisfies RehearsalSttBullMqPayload, canonicalJobOptions(input.jobId));
  } finally {
    await queue.close();
  }
}

export async function enqueueRehearsalSemanticEvaluationJob(
  input: EnqueueRehearsalSemanticEvaluationJobInput,
): Promise<void> {
  if (input.driver === "sqs") {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }

  const queue = new Queue(rehearsalSemanticEvaluationQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });

  try {
    await queue.add(
      rehearsalSemanticEvaluationJobName,
      rehearsalSemanticEvaluationJobPayloadSchema.parse({
        jobId: input.jobId,
        projectId: input.projectId,
        runId: input.runId,
      }),
      canonicalJobOptions(input.jobId),
    );
  } finally {
    await queue.close();
  }
}

export async function enqueueGenerateDeckJob(
  input: EnqueueGenerateDeckJobInput,
): Promise<void> {
  if (input.driver === "sqs") {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }
  const executionMode = input.executionMode ?? "monolith";
  if (executionMode === "sqs") {
    throw new Error("AI Deck SQS transport is not implemented yet.");
  }
  if (executionMode === "pg") return;

  const queue = new Queue(generateDeckQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });

  try {
    if (executionMode === "bullmq") {
      await queue.add(
        generateDeckStagedCoordinatorJobName,
        {
          jobId: input.jobId,
          projectId: input.projectId,
        } satisfies AiDeckStagedCoordinatorBullMqPayload,
        {
          ...canonicalJobOptions(input.jobId),
          removeOnFail: false,
        },
      );
      return;
    }

    await queue.add(
      generateDeckJobName,
      {
        jobId: input.jobId,
        projectId: input.projectId,
        request: generateDeckRequestSchema.parse(input.request),
        ...(input.designPackSnapshot
          ? { designPackSnapshot: input.designPackSnapshot }
          : {}),
        ...(input.imageAssetScope
          ? { imageAssetScope: input.imageAssetScope }
          : {}),
        ...(input.requestedByUserId
          ? { requestedByUserId: input.requestedByUserId }
          : {}),
      } satisfies GenerateDeckBullMqPayload,
      canonicalJobOptions(input.jobId),
    );
  } finally {
    await queue.close();
  }
}

export async function retryAiDeckStagedCoordinatorJob(input: {
  redisUrl: string;
  jobId: string;
  projectId: string;
}): Promise<void> {
  const queue = new Queue(generateDeckQueueName, {
    connection: redisConnectionOptions(input.redisUrl)
  });
  try {
    const existing = await queue.getJob(input.jobId);
    if (existing && (await existing.getState()) === "failed") {
      await existing.remove();
    }
    await queue.add(
      generateDeckStagedCoordinatorJobName,
      { jobId: input.jobId, projectId: input.projectId },
      { ...canonicalJobOptions(input.jobId), removeOnFail: false }
    );
  } finally {
    await queue.close();
  }
}

export async function enqueueAiDeckGenerationStageJob(
  input: EnqueueAiDeckGenerationStageJobInput,
): Promise<AiDeckGenerationStageEnqueueResult> {
  if (input.driver === "sqs") {
    throw new Error("AI Deck SQS transport is not implemented yet.");
  }
  const message = aiDeckGenerationStageMessageSchema.parse(input.message);
  const queue = new Queue(aiDeckGenerationStageQueueName(message.stage), {
    connection: redisConnectionOptions(input.redisUrl),
  });

  try {
    const job = await queue.add(
      message.stage,
      message,
      aiDeckGenerationStageJobOptions(message),
    );
    return {
      jobId: String(job.id ?? aiDeckGenerationStageJobId(message)),
      state: await job.getState(),
    };
  } finally {
    await queue.close();
  }
}

export async function enqueueFocusedPracticeAnalysisJob(
  input: EnqueueFocusedPracticeAnalysisJobInput,
): Promise<void> {
  if (input.driver === "sqs") throw new Error("SqsJobQueue adapter is not implemented yet.");
  const queue = new Queue(focusedPracticeAnalysisQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });
  try {
    await queue.add(
      focusedPracticeAnalysisJobName,
      focusedPracticeAnalysisJobPayloadSchema.parse({
        jobId: input.jobId,
        projectId: input.projectId,
        attemptId: input.attemptId,
      }),
      canonicalJobOptions(input.jobId),
    );
  } finally {
    await queue.close();
  }
}

export async function enqueueSlidePracticeAnalysisJob(
  input: EnqueueSlidePracticeAnalysisJobInput,
): Promise<void> {
  if (input.driver === "sqs") throw new Error("SqsJobQueue adapter is not implemented yet.");
  const queue = new Queue(slidePracticeAnalysisQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });
  try {
    await queue.add(
      slidePracticeAnalysisJobName,
      slidePracticeAnalysisJobPayloadSchema.parse({
        jobId: input.jobId,
        projectId: input.projectId,
        analysisId: input.analysisId,
      }),
      canonicalJobOptions(input.jobId),
    );
  } finally {
    await queue.close();
  }
}

export async function enqueueChallengeQnaGenerationJob(input: EnqueueChallengeQnaGenerationJobInput): Promise<void> {
  if (input.driver === "sqs") throw new Error("SqsJobQueue adapter is not implemented yet.");
  const queue = new Queue(challengeQnaGenerationQueueName, { connection: redisConnectionOptions(input.redisUrl) });
  try {
    await queue.add(challengeQnaGenerationJobName, challengeQnaGenerationJobPayloadSchema.parse({
      jobId: input.jobId, projectId: input.projectId, qnaSessionId: input.qnaSessionId,
      generationRevision: input.generationRevision,
    }), canonicalJobOptions(input.jobId));
  } finally { await queue.close(); }
}

export async function enqueueChallengeQnaAnswerAnalysisJob(input: EnqueueChallengeQnaAnswerAnalysisJobInput): Promise<void> {
  if (input.driver === "sqs") throw new Error("SqsJobQueue adapter is not implemented yet.");
  const queue = new Queue(challengeQnaAnswerAnalysisQueueName, { connection: redisConnectionOptions(input.redisUrl) });
  try {
    await queue.add(challengeQnaAnswerAnalysisJobName, challengeQnaAnswerAnalysisJobPayloadSchema.parse({
      jobId: input.jobId, projectId: input.projectId, answerAttemptId: input.answerAttemptId,
    }), canonicalJobOptions(input.jobId));
  } finally { await queue.close(); }
}

export async function enqueueSlideQuestionGuideGenerationJob(
  input: EnqueueSlideQuestionGuideGenerationJobInput,
): Promise<void> {
  if (input.driver === "sqs") throw new Error("SqsJobQueue adapter is not implemented yet.");
  const queue = new Queue(slideQuestionGuideGenerationQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });
  try {
    await queue.add(
      slideQuestionGuideGenerationJobName,
      slideQuestionGuideJobPayloadSchema.parse({
        jobId: input.jobId,
        projectId: input.projectId,
        guideId: input.guideId,
      }),
      canonicalJobOptions(input.jobId),
    );
  } finally {
    await queue.close();
  }
}

export async function enqueueDeckExportJob(
  input: EnqueueDeckExportJobInput,
): Promise<void> {
  if (input.driver === "sqs") {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }

  const queue = new Queue(deckExportQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });

  try {
    await queue.add(deckExportJobName, {
      jobId: input.jobId,
      projectId: input.projectId,
      deck: deckSchema.parse(input.deck),
      format: deckExportFormatSchema.parse(input.format),
      ...(input.presentationSessionId
        ? { presentationSessionId: input.presentationSessionId }
        : {}),
    } satisfies DeckExportBullMqPayload, canonicalJobOptions(input.jobId));
  } finally {
    await queue.close();
  }
}

export async function enqueueSemanticCueExtractionJob(
  input: EnqueueSemanticCueExtractionJobInput,
): Promise<void> {
  if (input.driver === "sqs") {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }

  const queue = new Queue(semanticCueExtractionQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });

  try {
    await queue.add(semanticCueExtractionJobName, semanticCueExtractionJobPayloadSchema.parse({
      jobId: input.jobId,
      projectId: input.projectId,
      request: input.request,
    }), canonicalJobOptions(input.jobId));
  } finally {
    await queue.close();
  }
}

export async function enqueueSpeakerNotesSuggestionJob(
  input: EnqueueSpeakerNotesSuggestionJobInput,
): Promise<void> {
  if (input.driver === "sqs") {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }

  const queue = new Queue(speakerNotesSuggestionQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });

  try {
    await queue.add(
      speakerNotesSuggestionJobName,
      speakerNotesSuggestionJobPayloadSchema.parse({
        jobId: input.jobId,
        projectId: input.projectId,
        request: input.request,
      }),
      canonicalJobOptions(input.jobId),
    );
  } finally {
    await queue.close();
  }
}

export async function enqueueDesignImageGenerationJob(
  input: EnqueueDesignImageGenerationJobInput,
): Promise<void> {
  if (input.driver === "sqs") {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }

  const queue = new Queue(designImageGenerationQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });

  try {
    await queue.add(
      designImageGenerationJobName,
      designImageGenerationJobPayloadSchema.parse(input),
      canonicalJobOptions(input.jobId),
    );
  } finally {
    await queue.close();
  }
}

export async function enqueuePptxOoxmlGenerationJob(
  input: EnqueuePptxOoxmlGenerationJobInput,
): Promise<void> {
  if (input.driver === "sqs") {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }

  const queue = new Queue(pptxOoxmlGenerationQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });

  try {
    await queue.add(pptxOoxmlGenerationJobName, {
      jobId: input.jobId,
      projectId: input.projectId,
      request: input.request,
    } satisfies PptxOoxmlGenerationBullMqPayload, canonicalJobOptions(input.jobId));
  } finally {
    await queue.close();
  }
}

export async function enqueuePptxOoxmlSyncJob(
  input: EnqueuePptxOoxmlSyncJobInput,
): Promise<void> {
  if (input.driver === "sqs") {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }

  const queue = new Queue(pptxOoxmlSyncQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });

  try {
    await queue.add(pptxOoxmlSyncJobName, {
      jobId: input.jobId,
      projectId: input.projectId,
      deckId: input.deckId,
      changeId: input.changeId,
      targetDeckVersion: input.targetDeckVersion,
      syncCapabilityVersion: input.syncCapabilityVersion,
    } satisfies PptxOoxmlSyncBullMqPayload, canonicalJobOptions(input.jobId));
  } finally {
    await queue.close();
  }
}

export async function enqueueWorkerHealthCheckJob(
  input: EnqueueWorkerHealthCheckJobInput,
): Promise<void> {
  if (input.driver === "sqs") {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }

  const queue = new Queue(workerHealthCheckQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });

  try {
    await queue.add(workerHealthCheckJobName, {
      jobId: input.jobId,
      projectId: input.projectId,
    } satisfies WorkerHealthCheckBullMqPayload, canonicalJobOptions(input.jobId));
  } finally {
    await queue.close();
  }
}

export async function enqueueActivityResponseRetentionJob(
  input: EnqueueActivityResponseRetentionJobInput,
): Promise<void> {
  if (input.driver === "sqs") {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }

  const queue = new Queue(activityResponseRetentionQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });

  try {
    await queue.add(
      activityResponseRetentionJobName,
      activityResponseRetentionJobPayloadSchema.parse({
        jobId: input.jobId,
        projectId: input.projectId,
        presentationSessionId: input.presentationSessionId,
      }),
      {
        ...canonicalJobOptions(input.jobId),
        backoff: { type: "exponential", delay: 1_000 },
      },
    );
  } finally {
    await queue.close();
  }
}

export function redisConnectionOptions(redisUrl: string) {
  const url = new URL(redisUrl);
  if (!["redis:", "rediss:"].includes(url.protocol)) {
    throw new Error("REDIS_URL must use redis:// or rediss://.");
  }

  const db =
    url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined;
  if (db !== undefined && !Number.isInteger(db)) {
    throw new Error("REDIS_URL database index must be an integer.");
  }

  return {
    db,
    host: url.hostname,
    maxRetriesPerRequest: null,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    port: url.port ? Number(url.port) : 6379,
    tls: url.protocol === "rediss:" ? {} : undefined,
    username: url.username ? decodeURIComponent(url.username) : undefined,
  };
}

function canonicalJobOptions(jobId: string) {
  return { jobId, attempts: 5, removeOnComplete: 1000, removeOnFail: 1000 };
}

export function aiDeckGenerationStageQueueName(
  stage: AiDeckGenerationStage,
): string {
  switch (stage) {
    case "reference-extract-file":
      return referenceExtractQueueName;
    case "source-grounding":
    case "content-planning":
      return aiDeckResearchContentQueueName;
    case "design-planning":
    case "layout-compile":
      return aiDeckDesignLayoutQueueName;
    case "cover-slide":
    case "image-slide":
      return aiDeckImageQueueName;
    case "semantic-quality":
    case "rendered-visual-quality":
    case "publication":
      return aiDeckQaFinalizeQueueName;
  }
}

function aiDeckGenerationStageJobOptions(
  message: AiDeckGenerationStageMessage,
) {
  return {
    jobId: aiDeckGenerationStageJobId(message),
    attempts: 5,
    backoff: { type: "exponential" as const, delay: 1_000 },
    priority: message.stage === "cover-slide" ? 1 : 10,
    removeOnComplete: true,
    removeOnFail: true,
  };
}

export class InMemoryJobQueue implements JobQueuePort {
  private readonly jobs = new Map<string, Job>();
  private jobSequence = 0;

  async enqueue(input: EnqueueJobInput): Promise<Job> {
    const now = nowIso();
    this.jobSequence += 1;
    const job = jobSchema.parse({
      jobId: `job_${Date.now()}_${this.jobSequence}`,
      projectId: input.projectId ?? demoIds.projectId,
      type: input.type,
      status: "queued",
      progress: 0,
      message: "작업 대기 중",
      result: input.payload ?? null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });

    this.jobs.set(job.jobId, job);
    return job;
  }

  async get(jobId: string): Promise<Job | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async update(jobId: string, patch: UpdateJobInput): Promise<Job | null> {
    const current = this.jobs.get(jobId);
    if (!current) {
      return null;
    }

    const job = jobSchema.parse({
      ...current,
      ...patch,
      updatedAt: nowIso(),
    });
    this.jobs.set(jobId, job);
    return job;
  }
}

export class BullMqJobQueue extends InMemoryJobQueue {
  readonly driver = "bullmq" as const;
}

export class SqsJobQueue implements JobQueuePort {
  async enqueue(_input: EnqueueJobInput): Promise<Job> {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }

  async get(_jobId: string): Promise<Job | null> {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }

  async update(_jobId: string, _patch: UpdateJobInput): Promise<Job | null> {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }
}
