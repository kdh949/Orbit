import type { OrbitConfig } from "@orbit/config";
import {
  activityResponseRetentionQueueName,
  challengeQnaAnswerAnalysisQueueName,
  challengeQnaGenerationQueueName,
  focusedPracticeAnalysisQueueName,
  slidePracticeAnalysisQueueName,
  slideQuestionGuideGenerationQueueName,
} from "@orbit/job-queue";
import type { StoragePort } from "@orbit/storage";
import type { PinoLogger } from "nestjs-pino";
import type { DataSource } from "typeorm";

import { processActivityResponseRetentionJob } from "../../activity-retention.processor";
import type { ChallengeQnaEvidenceCache } from "../../challenge-qna-evidence-cache";
import { processChallengeQnaAnswerJob } from "../../challenge-qna-answer.processor";
import { processChallengeQnaGenerationJob } from "../../challenge-qna-generation.processor";
import { processFocusedPracticeAnalysisJob } from "../../focused-practice-analysis.processor";
import { processSlidePracticeAnalysisJob } from "../../slide-practice-analysis.processor";
import { processSlideQuestionGuideGenerationJob } from "../../slide-question-guide-generation.processor";
import type { WorkerRegistration } from "../worker-registration";

interface PracticeWorkerRegistrationContext {
  challengeQnaEvidenceCache: ChallengeQnaEvidenceCache;
  config: Pick<OrbitConfig, "PYTHON_WORKER_URL">;
  dataSource: DataSource;
  logger: PinoLogger;
  storage: StoragePort;
}

export function createPracticeWorkerRegistrations(
  context: PracticeWorkerRegistrationContext,
): WorkerRegistration[] {
  return [
    {
      queueName: focusedPracticeAnalysisQueueName,
      handler: (job) =>
        processFocusedPracticeAnalysisJob(
          context.dataSource,
          context.storage,
          context.config.PYTHON_WORKER_URL,
          job.data,
        ),
    },
    {
      queueName: slidePracticeAnalysisQueueName,
      handler: (job) =>
        processSlidePracticeAnalysisJob(
          context.dataSource,
          context.storage,
          context.config.PYTHON_WORKER_URL,
          job.data,
          (event) => {
            const level = event.status === "unavailable" ? "warn" : "info";
            context.logger[level](event, "Slide practice coaching completed.");
          },
        ),
    },
    {
      queueName: challengeQnaGenerationQueueName,
      handler: (job) =>
        processChallengeQnaGenerationJob(
          context.dataSource,
          context.config.PYTHON_WORKER_URL,
          job.data,
        ),
    },
    {
      queueName: challengeQnaAnswerAnalysisQueueName,
      handler: (job) =>
        processChallengeQnaAnswerJob(
          context.dataSource,
          context.storage,
          context.challengeQnaEvidenceCache,
          context.config.PYTHON_WORKER_URL,
          job.data,
        ),
    },
    {
      queueName: slideQuestionGuideGenerationQueueName,
      handler: (job) =>
        processSlideQuestionGuideGenerationJob(
          context.dataSource,
          context.config.PYTHON_WORKER_URL,
          job.data,
          (event) => {
            if (event.event === "slide_question_guide.generation.failed") {
              context.logger.error(
                event,
                "Slide question guide generation failed.",
              );
              return;
            }
            context.logger.info(
              event,
              "Slide question guide web research completed.",
            );
          },
        ),
    },
    {
      queueName: activityResponseRetentionQueueName,
      handler: (job) =>
        processActivityResponseRetentionJob(context.dataSource, job.data),
    },
  ];
}
