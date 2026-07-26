import {
  aiDeckDesignLayoutQueueName,
  aiDeckImageQueueName,
  aiDeckQaFinalizeQueueName,
  aiDeckResearchContentQueueName,
  designImageGenerationQueueName,
  generateDeckQueueName,
  referenceExtractQueueName,
} from "@orbit/job-queue";
import { describe, expect, it } from "vitest";

import {
  allWorkerQueueNames,
  selectWorkerQueueNames,
} from "./worker-queue-policy";

describe("worker queue policy", () => {
  it.each([
    ["reference-extract", [generateDeckQueueName, referenceExtractQueueName]],
    ["research-content", [aiDeckResearchContentQueueName]],
    ["design-layout", [aiDeckDesignLayoutQueueName]],
    ["image", [aiDeckImageQueueName, designImageGenerationQueueName]],
    ["qa-finalize", [aiDeckQaFinalizeQueueName]],
  ] as const)("selects only the %s role queues", (role, expectedQueues) => {
    expect(
      selectWorkerQueueNames({
        AI_DECK_EXECUTION_MODE: "bullmq",
        AI_DECK_WORKER_QUEUE: role,
      }),
    ).toEqual(expectedQueues);
  });

  it("keeps every registered queue in monolith mode", () => {
    expect(
      selectWorkerQueueNames({
        AI_DECK_EXECUTION_MODE: "monolith",
        AI_DECK_WORKER_QUEUE: "all",
      }),
    ).toEqual(allWorkerQueueNames);
  });

  it("excludes BullMQ AI deck stage queues in PostgreSQL mode", () => {
    const selectedQueues = selectWorkerQueueNames({
      AI_DECK_EXECUTION_MODE: "pg",
      AI_DECK_WORKER_QUEUE: "all",
    });

    expect(selectedQueues).toContain(referenceExtractQueueName);
    expect(selectedQueues).not.toContain(generateDeckQueueName);
    expect(selectedQueues).not.toContain(aiDeckResearchContentQueueName);
    expect(selectedQueues).not.toContain(aiDeckDesignLayoutQueueName);
    expect(selectedQueues).not.toContain(aiDeckImageQueueName);
    expect(selectedQueues).not.toContain(aiDeckQaFinalizeQueueName);
  });
});
