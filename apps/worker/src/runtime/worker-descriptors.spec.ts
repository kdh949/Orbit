import {
  generateDeckQueueName,
  pptxOoxmlGenerationQueueName,
  pptxOoxmlSyncQueueName,
  referenceExtractQueueName,
  slideQuestionGuideGenerationQueueName,
} from "@orbit/job-queue";
import type { StoragePort } from "@orbit/storage";
import type { PinoLogger } from "nestjs-pino";
import type { DataSource } from "typeorm";
import { describe, expect, it } from "vitest";

import type { ImageAssetRuntime } from "../image-asset-pipeline";
import { allWorkerQueueNames } from "./worker-queue-policy";
import { createWorkerDescriptors } from "./worker-descriptors";

describe("worker descriptors", () => {
  it("owns every queue, accepted job, runtime option, and recovery policy", () => {
    const descriptors = createWorkerDescriptors({
      challengeQnaEvidenceCache: null,
      config: {
        APP_ENV: "test",
        PYTHON_WORKER_URL: "http://python-worker:8000",
      } as never,
      dataSource: {} as DataSource,
      eventLogger: () => undefined,
      imageRuntime: {} as ImageAssetRuntime,
      logger: {} as PinoLogger,
      storage: {} as StoragePort,
      transcriptCache: null,
      workerId: "worker-test",
    });
    const queueNames = descriptors.map(({ queueName }) => queueName);

    expect([...queueNames].sort()).toEqual([...allWorkerQueueNames].sort());
    expect(new Set(queueNames).size).toBe(queueNames.length);
    expect(
      descriptors.every(({ acceptedJobNames }) => acceptedJobNames.length > 0),
    ).toBe(true);
    expect(
      descriptor(descriptors, pptxOoxmlGenerationQueueName).runtimeOptions,
    ).toEqual({ maxStalledCount: 4 });
    expect(
      descriptor(descriptors, pptxOoxmlSyncQueueName).runtimeOptions,
    ).toEqual({ maxStalledCount: 4 });
    expect(
      descriptor(descriptors, slideQuestionGuideGenerationQueueName)
        .runtimeOptions,
    ).toEqual({ concurrency: 2 });
    expect(
      descriptor(descriptors, referenceExtractQueueName).terminalRecovery,
    ).toBeDefined();
    expect(
      descriptor(descriptors, generateDeckQueueName).terminalRecovery,
    ).toBeDefined();
  });
});

function descriptor(
  descriptors: ReturnType<typeof createWorkerDescriptors>,
  queueName: string,
) {
  const value = descriptors.find(
    (descriptor) => descriptor.queueName === queueName,
  );
  expect(value).toBeDefined();
  return value!;
}
