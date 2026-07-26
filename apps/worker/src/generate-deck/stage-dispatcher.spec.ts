import type { AiDeckGenerationStageMessage } from "@orbit/shared/jobs";
import { describe, expect, it, vi } from "vitest";

import { dispatchAiDeckGenerationStages } from "./stage-dispatcher";

const referenceMessage: AiDeckGenerationStageMessage = {
  pipelineJobId: "job-ai-deck-1",
  projectId: "project-a",
  stage: "reference-extract-file",
  shardKey: "file-a",
};

describe("dispatchAiDeckGenerationStages", () => {
  it.each(["waiting", "delayed", "prioritized"] as const)(
    "marks the observed checkpoint generation after a %s disposition",
    async (state) => {
      const repository = {
        recoverStaleDispatches: vi.fn(async () => 1),
        listUndispatched: vi.fn(async () => [
          { message: referenceMessage, attempt: 2 },
        ]),
        markDispatched: vi.fn(async () => ({})),
      };
      const enqueue = vi.fn(async () => ({
        jobId: "job-ai-deck-1:reference-extract-file:file-a",
        state,
      }));

      await expect(
        dispatchAiDeckGenerationStages(repository, {
          driver: "bullmq",
          redisUrl: "redis://localhost:6379",
          enqueue,
        }),
      ).resolves.toEqual({ scanned: 1, dispatched: 1 });
      expect(repository.recoverStaleDispatches).toHaveBeenCalledWith(100);
      expect(repository.markDispatched).toHaveBeenCalledWith(
        referenceMessage,
        2,
      );
    },
  );

  it.each(["active", "completed", "failed", "unknown"] as const)(
    "does not mark a %s duplicate as durably dispatched",
    async (state) => {
      const repository = {
        recoverStaleDispatches: vi.fn(async () => 0),
        listUndispatched: vi.fn(async () => [
          { message: referenceMessage, attempt: 1 },
        ]),
        markDispatched: vi.fn(),
      };

      await expect(
        dispatchAiDeckGenerationStages(repository, {
          driver: "bullmq",
          redisUrl: "redis://localhost:6379",
          enqueue: vi.fn(async () => ({
            jobId: "job-ai-deck-1:reference-extract-file:file-a",
            state,
          })),
        }),
      ).resolves.toEqual({ scanned: 1, dispatched: 0 });
      expect(repository.markDispatched).not.toHaveBeenCalled();
    },
  );

  it("dispatches the 338-2 source-grounding checkpoint", async () => {
    const sourceMessage: AiDeckGenerationStageMessage = {
      pipelineJobId: "job-ai-deck-1",
      projectId: "project-a",
      stage: "source-grounding",
      shardKey: "",
    };
    const repository = {
      recoverStaleDispatches: vi.fn(async () => 0),
      listUndispatched: vi.fn(async () => [
        { message: sourceMessage, attempt: 0 },
      ]),
      markDispatched: vi.fn(async () => ({})),
    };
    const enqueue = vi.fn(async () => ({
      jobId: "job-ai-deck-1:source-grounding:",
      state: "waiting" as const,
    }));

    await expect(
      dispatchAiDeckGenerationStages(repository, {
        driver: "bullmq",
        redisUrl: "redis://localhost:6379",
        enqueue,
      }),
    ).resolves.toEqual({ scanned: 1, dispatched: 1 });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ message: sourceMessage }),
    );
    expect(repository.markDispatched).toHaveBeenCalledWith(sourceMessage, 0);
  });

  it("dispatches 338-3 image checkpoints", async () => {
    const imageMessage: AiDeckGenerationStageMessage = {
      pipelineJobId: "job-ai-deck-1",
      projectId: "project-a",
      stage: "image-slide",
      shardKey: "slide-a",
    };
    const repository = {
      recoverStaleDispatches: vi.fn(async () => 0),
      listUndispatched: vi.fn(async () => [
        { message: imageMessage, attempt: 0 },
      ]),
      markDispatched: vi.fn(async () => ({ status: "queued" })),
    };
    const enqueue = vi.fn(async () => ({
      jobId: "job-ai-deck-1:image-slide:slide-a",
      state: "waiting" as const,
    }));

    await expect(
      dispatchAiDeckGenerationStages(repository, {
        driver: "bullmq",
        redisUrl: "redis://localhost:6379",
        enqueue,
      }),
    ).resolves.toEqual({ scanned: 1, dispatched: 1 });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ message: imageMessage }),
    );
  });

  it("leaves a failed send undispatched and continues with the next row", async () => {
    const secondMessage = { ...referenceMessage, shardKey: "file-b" };
    const repository = {
      recoverStaleDispatches: vi.fn(async () => 0),
      listUndispatched: vi.fn(async () => [
        { message: referenceMessage, attempt: 0 },
        { message: secondMessage, attempt: 1 },
      ]),
      markDispatched: vi.fn(async () => ({})),
    };
    const enqueue = vi
      .fn()
      .mockRejectedValueOnce(new Error("Redis unavailable"))
      .mockResolvedValueOnce({
        jobId: "job-ai-deck-1:reference-extract-file:file-b",
        state: "waiting",
      });

    await expect(
      dispatchAiDeckGenerationStages(repository, {
        driver: "bullmq",
        redisUrl: "redis://localhost:6379",
        enqueue,
      }),
    ).resolves.toEqual({ scanned: 2, dispatched: 1 });
    expect(repository.markDispatched).toHaveBeenCalledTimes(1);
    expect(repository.markDispatched).toHaveBeenCalledWith(secondMessage, 1);
  });
});
