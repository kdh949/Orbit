import { activityResponseRetentionJobPayloadSchema } from "@orbit/shared/activities";
import {
  challengeQnaAnswerAnalysisJobPayloadSchema,
  challengeQnaGenerationJobPayloadSchema,
  focusedPracticeAnalysisJobPayloadSchema,
  slidePracticeAnalysisJobPayloadSchema,
} from "@orbit/shared/coaching";
import {
  deckExportFormatSchema,
  deckSchema,
  designImageGenerationJobPayloadSchema,
  generateDeckRequestSchema,
  semanticCueExtractionJobPayloadSchema,
  speakerNotesSuggestionJobPayloadSchema,
} from "@orbit/shared/deck";
import {
  type AiDeckGenerationStageMessage,
  aiDeckGenerationStageMessageSchema,
} from "@orbit/shared/jobs";
import { presentationAnalysisJobPayloadSchema } from "@orbit/shared/presentation";
import { rehearsalSemanticEvaluationJobPayloadSchema } from "@orbit/shared/rehearsals";
import { slideQuestionGuideJobPayloadSchema } from "@orbit/shared/slide-practice";
import { Queue } from "bullmq";

import {
  activityResponseRetentionJobName,
  activityResponseRetentionQueueName,
  aiDeckGenerationStageJobId,
  aiDeckGenerationStageQueueName,
  challengeQnaAnswerAnalysisJobName,
  challengeQnaAnswerAnalysisQueueName,
  challengeQnaGenerationJobName,
  challengeQnaGenerationQueueName,
  deckExportJobName,
  deckExportQueueName,
  designImageGenerationJobName,
  designImageGenerationQueueName,
  focusedPracticeAnalysisJobName,
  focusedPracticeAnalysisQueueName,
  generateDeckJobName,
  generateDeckQueueName,
  generateDeckStagedCoordinatorJobName,
  pptxOoxmlGenerationJobName,
  pptxOoxmlGenerationQueueName,
  pptxOoxmlSyncJobName,
  pptxOoxmlSyncQueueName,
  presentationAnalysisJobName,
  presentationAnalysisQueueName,
  referenceExtractJobName,
  referenceExtractQueueName,
  rehearsalSemanticEvaluationJobName,
  rehearsalSemanticEvaluationQueueName,
  rehearsalSttJobName,
  rehearsalSttQueueName,
  semanticCueExtractionJobName,
  semanticCueExtractionQueueName,
  slidePracticeAnalysisJobName,
  slidePracticeAnalysisQueueName,
  slideQuestionGuideGenerationJobName,
  slideQuestionGuideGenerationQueueName,
  speakerNotesSuggestionJobName,
  speakerNotesSuggestionQueueName,
  workerHealthCheckJobName,
  workerHealthCheckQueueName,
} from "../../names";
import type {
  AiDeckGenerationStageEnqueueResult,
  AiDeckStagedCoordinatorBullMqPayload,
  DeckExportBullMqPayload,
  EnqueueActivityResponseRetentionJobInput,
  EnqueueAiDeckGenerationStageJobInput,
  EnqueueChallengeQnaAnswerAnalysisJobInput,
  EnqueueChallengeQnaGenerationJobInput,
  EnqueueDeckExportJobInput,
  EnqueueDesignImageGenerationJobInput,
  EnqueueFocusedPracticeAnalysisJobInput,
  EnqueueGenerateDeckJobInput,
  EnqueuePptxOoxmlGenerationJobInput,
  EnqueuePptxOoxmlSyncJobInput,
  EnqueuePresentationAnalysisJobInput,
  EnqueueReferenceExtractJobInput,
  EnqueueRehearsalSemanticEvaluationJobInput,
  EnqueueRehearsalSttJobInput,
  EnqueueSemanticCueExtractionJobInput,
  EnqueueSlidePracticeAnalysisJobInput,
  EnqueueSlideQuestionGuideGenerationJobInput,
  EnqueueSpeakerNotesSuggestionJobInput,
  EnqueueWorkerHealthCheckJobInput,
  GenerateDeckBullMqPayload,
  PptxOoxmlGenerationBullMqPayload,
  PptxOoxmlSyncBullMqPayload,
  ReferenceExtractBullMqPayload,
  RehearsalSttBullMqPayload,
  WorkerHealthCheckBullMqPayload,
} from "../../payloads";
import { redisConnectionOptions } from "../../redis";

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
    await queue.add(
      referenceExtractJobName,
      {
        jobId: input.jobId,
        projectId: input.projectId,
        files: input.files,
      } satisfies ReferenceExtractBullMqPayload,
      canonicalJobOptions(input.jobId),
    );
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
    await queue.add(
      rehearsalSttJobName,
      {
        jobId: input.jobId,
        projectId: input.projectId,
        runId: input.runId,
        deckId: input.deckId,
        audioFileId: input.audioFileId,
        liveTranscript: input.liveTranscript ?? null,
        slideTranscriptSnapshots: input.slideTranscriptSnapshots ?? [],
      } satisfies RehearsalSttBullMqPayload,
      canonicalJobOptions(input.jobId),
    );
  } finally {
    await queue.close();
  }
}

export async function enqueuePresentationAnalysisJob(
  input: EnqueuePresentationAnalysisJobInput,
): Promise<void> {
  if (input.driver === "sqs") {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }

  const queue = new Queue(presentationAnalysisQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });

  try {
    await queue.add(
      presentationAnalysisJobName,
      presentationAnalysisJobPayloadSchema.parse({
        jobId: input.jobId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        runId: input.runId,
        deckId: input.deckId,
        audioFileId: input.audioFileId,
        liveTranscript: input.liveTranscript ?? null,
        slideTranscriptSnapshots: input.slideTranscriptSnapshots ?? [],
      }),
      canonicalJobOptions(input.jobId),
    );
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
    connection: redisConnectionOptions(input.redisUrl),
  });
  try {
    const existing = await queue.getJob(input.jobId);
    if (existing && (await existing.getState()) === "failed") {
      await existing.remove();
    }
    await queue.add(
      generateDeckStagedCoordinatorJobName,
      { jobId: input.jobId, projectId: input.projectId },
      { ...canonicalJobOptions(input.jobId), removeOnFail: false },
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
  if (input.driver === "sqs")
    throw new Error("SqsJobQueue adapter is not implemented yet.");
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
  if (input.driver === "sqs")
    throw new Error("SqsJobQueue adapter is not implemented yet.");
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

export async function enqueueChallengeQnaGenerationJob(
  input: EnqueueChallengeQnaGenerationJobInput,
): Promise<void> {
  if (input.driver === "sqs")
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  const queue = new Queue(challengeQnaGenerationQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });
  try {
    await queue.add(
      challengeQnaGenerationJobName,
      challengeQnaGenerationJobPayloadSchema.parse({
        jobId: input.jobId,
        projectId: input.projectId,
        qnaSessionId: input.qnaSessionId,
        generationRevision: input.generationRevision,
      }),
      canonicalJobOptions(input.jobId),
    );
  } finally {
    await queue.close();
  }
}

export async function enqueueChallengeQnaAnswerAnalysisJob(
  input: EnqueueChallengeQnaAnswerAnalysisJobInput,
): Promise<void> {
  if (input.driver === "sqs")
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  const queue = new Queue(challengeQnaAnswerAnalysisQueueName, {
    connection: redisConnectionOptions(input.redisUrl),
  });
  try {
    await queue.add(
      challengeQnaAnswerAnalysisJobName,
      challengeQnaAnswerAnalysisJobPayloadSchema.parse({
        jobId: input.jobId,
        projectId: input.projectId,
        answerAttemptId: input.answerAttemptId,
      }),
      canonicalJobOptions(input.jobId),
    );
  } finally {
    await queue.close();
  }
}

export async function enqueueSlideQuestionGuideGenerationJob(
  input: EnqueueSlideQuestionGuideGenerationJobInput,
): Promise<void> {
  if (input.driver === "sqs")
    throw new Error("SqsJobQueue adapter is not implemented yet.");
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
    await queue.add(
      deckExportJobName,
      {
        jobId: input.jobId,
        projectId: input.projectId,
        deck: deckSchema.parse(input.deck),
        format: deckExportFormatSchema.parse(input.format),
        ...(input.presentationSessionId
          ? { presentationSessionId: input.presentationSessionId }
          : {}),
      } satisfies DeckExportBullMqPayload,
      canonicalJobOptions(input.jobId),
    );
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
    await queue.add(
      semanticCueExtractionJobName,
      semanticCueExtractionJobPayloadSchema.parse({
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
    await queue.add(
      pptxOoxmlGenerationJobName,
      {
        jobId: input.jobId,
        projectId: input.projectId,
        request: input.request,
      } satisfies PptxOoxmlGenerationBullMqPayload,
      pptxOoxmlJobOptions(input.jobId),
    );
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
    await queue.add(
      pptxOoxmlSyncJobName,
      {
        jobId: input.jobId,
        projectId: input.projectId,
        deckId: input.deckId,
        changeId: input.changeId,
        targetDeckVersion: input.targetDeckVersion,
        syncCapabilityVersion: input.syncCapabilityVersion,
      } satisfies PptxOoxmlSyncBullMqPayload,
      pptxOoxmlJobOptions(input.jobId),
    );
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
    await queue.add(
      workerHealthCheckJobName,
      {
        jobId: input.jobId,
        projectId: input.projectId,
      } satisfies WorkerHealthCheckBullMqPayload,
      canonicalJobOptions(input.jobId),
    );
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

function canonicalJobOptions(jobId: string) {
  return { jobId, attempts: 5, removeOnComplete: 1000, removeOnFail: 1000 };
}

function pptxOoxmlJobOptions(jobId: string) {
  return {
    ...canonicalJobOptions(jobId),
    backoff: { type: "exponential" as const, delay: 2_000 },
    removeOnFail: false,
  };
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
