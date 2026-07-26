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
import { describe, expect, it } from "vitest";

import type { ChallengeQnaEvidenceCache } from "../../challenge-qna-evidence-cache";
import { createPracticeWorkerRegistrations } from "./practice-worker-registrations";

describe("practice worker registrations", () => {
  it("declares each practice and retention queue exactly once", () => {
    const registrations = createPracticeWorkerRegistrations({
      challengeQnaEvidenceCache: {} as ChallengeQnaEvidenceCache,
      config: { PYTHON_WORKER_URL: "http://python-worker:8000" },
      dataSource: {} as DataSource,
      logger: {} as PinoLogger,
      storage: {} as StoragePort,
    });

    expect(registrations.map(({ queueName }) => queueName)).toEqual([
      focusedPracticeAnalysisQueueName,
      slidePracticeAnalysisQueueName,
      challengeQnaGenerationQueueName,
      challengeQnaAnswerAnalysisQueueName,
      slideQuestionGuideGenerationQueueName,
      activityResponseRetentionQueueName,
    ]);
    expect(new Set(registrations.map(({ queueName }) => queueName)).size).toBe(
      registrations.length,
    );
  });
});
