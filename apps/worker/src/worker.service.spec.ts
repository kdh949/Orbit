import {
  generateDeckJobName,
  generateDeckQueueName,
  generateDeckStagedCoordinatorJobName,
  pptxOoxmlGenerationQueueName,
  referenceExtractJobName,
  referenceExtractQueueName,
  aiDeckResearchContentQueueName,
  aiDeckDesignLayoutQueueName,
  aiDeckImageQueueName,
  aiDeckQaFinalizeQueueName,
  designImageGenerationQueueName,
  slideQuestionGuideGenerationQueueName,
} from "@orbit/job-queue";
import type { Job } from "@orbit/shared";
import type { PinoLogger } from "nestjs-pino";
import type { DataSource } from "typeorm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiDeckBullMqFailureRecoveryResult } from "./generate-deck/transport-failure-recovery";
import { WorkerService } from "./worker.service";

const bullMq = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  queues: [] as string[],
  options: new Map<string, Record<string, unknown>>(),
  handlers: new Map<string, (job: FakeBullJob) => Promise<unknown>>(),
  failedHandlers: new Map<
    string,
    (job: FakeBullJob | undefined, error: Error) => void
  >(),
}));

const configState = vi.hoisted(() => ({
  JOB_QUEUE_DRIVER: "bullmq" as "bullmq" | "sqs",
  AI_DECK_EXECUTION_MODE: "monolith" as
    | "monolith"
    | "bullmq"
    | "pg"
    | "sqs",
  AI_DECK_WORKER_QUEUE: "all" as
    | "all"
    | "reference-extract"
    | "research-content"
    | "design-layout"
    | "image"
    | "qa-finalize",
  AI_DECK_WORKER_CONCURRENCY: 5,
  AI_DECK_USER_CONCURRENCY: 5,
  PRIVATE_EVIDENCE_REDIS_URL: "redis://localhost:6380",
  PYTHON_WORKER_URL: "http://localhost:8000",
  REDIS_URL: "redis://localhost:6379",
}));

const processors = vi.hoisted(() => ({
  generateDeck: vi.fn(async () => orbitJob("succeeded")),
  stagedCoordinator: vi.fn(async () => orbitJob("running")),
  referenceExtract: vi.fn(async () =>
    orbitJob("succeeded", "reference-extract"),
  ),
  referenceExtractStage: vi.fn<() => Promise<Job | void>>(
    async () => undefined,
  ),
  planningStage: vi.fn<(...args: unknown[]) => Promise<Job | void>>(
    async () => undefined,
  ),
  executionStage: vi.fn<(...args: unknown[]) => Promise<Job | void>>(
    async () => undefined,
  ),
}));

const maintenance = vi.hoisted(() => ({
  initialize: vi.fn(async () => ({ scanned: 0, initialized: 0 })),
  coordinator: vi.fn(async () => ({
    scanned: 0,
    recovered: 0,
    resumed: 0,
    removed: 0,
    terminalJobs: [] as Job[],
    nextCursor: { redisCursor: "0", pendingJobIds: [] as string[] },
  })),
  dispatch: vi.fn(async () => ({ scanned: 0, dispatched: 0 })),
  reconcile: vi.fn(async () => ({
    scanned: 0,
    requeued: 0,
    failed: 0,
    terminalJobs: [] as Job[],
  })),
}));

const postgresRunner = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
  start: vi.fn(),
  stop: vi.fn(async () => undefined),
}));

const transportRecovery = vi.hoisted(() => ({
  recover: vi.fn<
    (...args: unknown[]) => Promise<AiDeckBullMqFailureRecoveryResult>
  >(async () => ({ outcome: "ignored", terminalJob: null })),
}));

vi.mock("bullmq", () => ({
  Worker: class {
    readonly queueName: string;

    constructor(
      queueName: string,
      handler: (job: FakeBullJob) => Promise<unknown>,
      options: Record<string, unknown>,
    ) {
      this.queueName = queueName;
      bullMq.queues.push(queueName);
      bullMq.handlers.set(queueName, handler);
      bullMq.options.set(queueName, options);
    }

    close = bullMq.close;
    on = vi.fn(
      (
        event: string,
        handler: (job: FakeBullJob | undefined, error: Error) => void,
      ) => {
        if (event === "failed")
          bullMq.failedHandlers.set(this.queueName, handler);
      },
    );
  },
}));

vi.mock("@orbit/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@orbit/config")>();
  return {
    ...actual,
    loadOrbitConfig: vi.fn(() => ({ ...configState })),
  };
});

vi.mock("./generate-deck.processor", () => ({
  processGenerateDeckJob: processors.generateDeck,
}));
vi.mock("./generate-deck/staged-coordinator", () => ({
  processAiDeckStagedCoordinatorJob: processors.stagedCoordinator,
  initializePendingAiDeckGenerationJobs: maintenance.initialize,
}));
vi.mock("./generate-deck/postgres-stage-runner", () => ({
  AiDeckPostgresStageRunner: class {
    constructor(options: Record<string, unknown>) {
      postgresRunner.options.push(options);
    }
    start = postgresRunner.start;
    stop = postgresRunner.stop;
  },
}));
vi.mock("./reference-extract.processor", () => ({
  processReferenceExtractJob: processors.referenceExtract,
}));
vi.mock("./generate-deck/reference-extract-stage", () => ({
  processAiDeckReferenceExtractionStage: processors.referenceExtractStage,
}));
vi.mock("./generate-deck/planning-stage.processor", () => ({
  processAiDeckPlanningStage: processors.planningStage,
}));
vi.mock("./generate-deck/execution-stage.processor", () => ({
  processAiDeckExecutionStage: processors.executionStage,
}));
vi.mock("./generate-deck/stage-dispatcher", () => ({
  dispatchAiDeckGenerationStages: maintenance.dispatch,
}));
vi.mock("./generate-deck/coordinator-failure-reconciler", () => ({
  reconcileFailedAiDeckCoordinatorJobs: maintenance.coordinator,
}));
vi.mock("./generate-deck/stage-reconciler", () => ({
  reconcileExpiredAiDeckStageLeases: maintenance.reconcile,
}));
vi.mock("./generate-deck/transport-failure-recovery", () => ({
  recoverAiDeckBullMqFinalFailure: transportRecovery.recover,
}));
vi.mock("./image-providers", () => ({
  createImageAssetRuntime: vi.fn(() => undefined),
}));
vi.mock("./storage", () => ({
  workerStorage: vi.fn(() => ({ getSignedReadUrl: vi.fn() })),
}));
vi.mock("./storage-deletion-reconciler", () => ({
  enqueueExpiredRehearsalAudioDeletions: vi.fn(async () => undefined),
  reconcileStorageDeletionOutbox: vi.fn(async () => undefined),
}));
vi.mock("./rehearsal-transcript-cache", () => ({
  RedisRehearsalTranscriptCache: class {
    close = vi.fn(async () => undefined);
  },
}));
vi.mock("./challenge-qna-evidence-cache", () => ({
  ChallengeQnaEvidenceCache: class {
    close = vi.fn(async () => undefined);
  },
}));

beforeEach(() => {
  configState.JOB_QUEUE_DRIVER = "bullmq";
  configState.AI_DECK_EXECUTION_MODE = "monolith";
  configState.AI_DECK_WORKER_QUEUE = "all";
  configState.AI_DECK_WORKER_CONCURRENCY = 5;
  configState.AI_DECK_USER_CONCURRENCY = 5;
  bullMq.queues.length = 0;
  bullMq.handlers.clear();
  bullMq.options.clear();
  bullMq.failedHandlers.clear();
  postgresRunner.options.length = 0;
  vi.clearAllMocks();
  vi.spyOn(globalThis, "setInterval").mockReturnValue(1 as never);
  vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WorkerService queue subscriptions", () => {
  it("uses PostgreSQL stage polling with five shared slots and no AI BullMQ queues", async () => {
    configState.AI_DECK_EXECUTION_MODE = "pg";
    const { service } = createService();

    service.onModuleInit();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(bullMq.queues).not.toContain(generateDeckQueueName);
    expect(bullMq.queues).not.toContain(aiDeckResearchContentQueueName);
    expect(bullMq.queues).not.toContain(aiDeckDesignLayoutQueueName);
    expect(bullMq.queues).not.toContain(aiDeckImageQueueName);
    expect(bullMq.queues).not.toContain(aiDeckQaFinalizeQueueName);
    expect(bullMq.queues).toContain(referenceExtractQueueName);
    expect(postgresRunner.options).toHaveLength(1);
    expect(postgresRunner.options[0]).toMatchObject({
      concurrency: 5,
      userConcurrency: 5,
    });
    expect(postgresRunner.start).toHaveBeenCalledTimes(1);
    expect(maintenance.initialize).toHaveBeenCalledTimes(1);
    expect(maintenance.reconcile).toHaveBeenCalledTimes(1);
    expect(maintenance.dispatch).not.toHaveBeenCalled();
    expect(maintenance.coordinator).not.toHaveBeenCalled();

    await service.onModuleDestroy();
    expect(postgresRunner.stop).toHaveBeenCalledTimes(1);
  });

  it("registers every active queue in the default all role", async () => {
    const { service } = createService();

    service.onModuleInit();

    expect(bullMq.queues).toContain(generateDeckQueueName);
    expect(bullMq.queues).toContain(referenceExtractQueueName);
    expect(bullMq.queues).toContain(pptxOoxmlGenerationQueueName);
    expect(bullMq.queues).toContain(aiDeckResearchContentQueueName);
    expect(bullMq.queues).toContain(aiDeckDesignLayoutQueueName);
    expect(bullMq.queues).toContain(aiDeckImageQueueName);
    expect(bullMq.queues).toContain(aiDeckQaFinalizeQueueName);
    expect(bullMq.queues).not.toContain("pptx-import");
    expect(bullMq.queues).not.toContain("ai-template-deck-generation");
    expect(bullMq.options.get(slideQuestionGuideGenerationQueueName)).toMatchObject({
      concurrency: 2,
    });
    expect(bullMq.options.get(referenceExtractQueueName)).not.toHaveProperty("concurrency");

    await service.onModuleDestroy();
  });

  it("routes shared queues by job.name and logs staged work as progress", async () => {
    configState.AI_DECK_EXECUTION_MODE = "bullmq";
    const { service, logger } = createService();
    processors.referenceExtractStage.mockResolvedValueOnce({
      ...orbitJob("failed"),
      error: {
        code: "SOURCE_GROUNDING_REQUIRED",
        message: "The selected reference policy requires usable grounding.",
        failedStage: "reference-extract-file",
        retryable: false,
      },
    });
    service.onModuleInit();

    const generateHandler = requiredHandler(generateDeckQueueName);
    const referenceHandler = requiredHandler(referenceExtractQueueName);
    await generateHandler(
      bullJob(generateDeckStagedCoordinatorJobName, {
        jobId: "job-ai-deck-1",
        projectId: "project-a",
      }),
    );
    await referenceHandler(
      bullJob("reference-extract-file", {
        pipelineJobId: "job-ai-deck-1",
        projectId: "project-a",
        stage: "reference-extract-file",
        shardKey: "file-a",
      }),
    );
    await generateHandler(bullJob(generateDeckJobName, { jobId: "legacy" }));
    await referenceHandler(
      bullJob(referenceExtractJobName, { jobId: "legacy-ref" }),
    );

    expect(processors.stagedCoordinator).toHaveBeenCalledTimes(1);
    expect(processors.referenceExtractStage).toHaveBeenCalledTimes(1);
    expect(processors.generateDeck).toHaveBeenCalledTimes(1);
    expect(processors.referenceExtract).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "job.progressed" }),
      "Job progressed.",
    );
    expect(
      logger.info.mock.calls.filter(
        ([fields]) =>
          typeof fields === "object" &&
          fields !== null &&
          "event" in fields &&
          fields.event === "job.progressed",
      ),
    ).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "job.failed",
        error: expect.objectContaining({ code: "SOURCE_GROUNDING_REQUIRED" }),
      }),
      "Job finished.",
    );
    expect(maintenance.dispatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        driver: "bullmq",
        redisUrl: configState.REDIS_URL,
      }),
    );
    expect(maintenance.coordinator).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        redisUrl: configState.REDIS_URL,
        cursor: { redisCursor: "0", pendingJobIds: [] },
      }),
    );
    expect(maintenance.reconcile).toHaveBeenCalled();

    await expect(
      generateHandler(bullJob("unknown-generate-deck-job", {})),
    ).rejects.toThrow("Unsupported BullMQ job name");
    await expect(
      referenceHandler(bullJob("unknown-reference-job", {})),
    ).rejects.toThrow("Unsupported BullMQ job name");
    await service.onModuleDestroy();
  });

  it("logs a terminal lease reconciliation only after it commits", async () => {
    configState.AI_DECK_EXECUTION_MODE = "bullmq";
    const terminalJob: Job = {
      ...orbitJob("failed"),
      result: { privateArtifact: "must-not-be-logged" },
      error: {
        code: "SOURCE_GROUNDING_REQUIRED",
        message: "The selected reference policy requires usable grounding.",
        failedStage: "reference-extract-file",
        retryable: false,
      },
    };
    let resolveReconciliation!: (result: {
      scanned: number;
      requeued: number;
      failed: number;
      terminalJobs: Job[];
    }) => void;
    maintenance.reconcile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReconciliation = resolve;
        }),
    );
    const { service, logger } = createService();

    service.onModuleInit();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(maintenance.reconcile).toHaveBeenCalledTimes(1);
    expect(
      logger.error.mock.calls.filter(
        ([fields]) =>
          typeof fields === "object" &&
          fields !== null &&
          "event" in fields &&
          fields.event === "job.failed",
      ),
    ).toEqual([]);

    resolveReconciliation({
      scanned: 1,
      requeued: 0,
      failed: 1,
      terminalJobs: [terminalJob],
    });
    await service.onModuleDestroy();

    expect(
      logger.error.mock.calls.filter(
        ([fields]) =>
          typeof fields === "object" &&
          fields !== null &&
          "event" in fields &&
          fields.event === "job.failed",
      ),
    ).toEqual([
      [
        {
          event: "job.failed",
          jobId: terminalJob.jobId,
          jobType: terminalJob.type,
          projectId: terminalJob.projectId,
          status: terminalJob.status,
          error: terminalJob.error,
        },
        "Job finished.",
      ],
    ]);
  });

  it("logs a failed stalled-coordinator resume only after it commits", async () => {
    configState.AI_DECK_EXECUTION_MODE = "bullmq";
    const terminalJob: Job = {
      ...orbitJob("failed"),
      result: { privateArtifact: "must-not-be-logged" },
      error: {
        code: "SOURCE_GROUNDING_REQUIRED",
        message: "The selected reference policy requires usable grounding.",
        failedStage: "reference-extract-file",
        retryable: false,
      },
    };
    let resolveReconciliation!: (result: {
      scanned: number;
      recovered: number;
      resumed: number;
      removed: number;
      terminalJobs: Job[];
      nextCursor: { redisCursor: string; pendingJobIds: string[] };
    }) => void;
    maintenance.coordinator.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReconciliation = resolve;
        }),
    );
    const { service, logger } = createService();

    service.onModuleInit();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(maintenance.coordinator).toHaveBeenCalledTimes(1);
    expect(failedJobLogCalls(logger)).toEqual([]);

    resolveReconciliation({
      scanned: 1,
      recovered: 0,
      resumed: 1,
      removed: 1,
      terminalJobs: [terminalJob],
      nextCursor: { redisCursor: "0", pendingJobIds: [] },
    });
    await service.onModuleDestroy();

    expect(failedJobLogCalls(logger)).toEqual([
      [
        {
          event: "job.failed",
          jobId: terminalJob.jobId,
          jobType: terminalJob.type,
          projectId: terminalJob.projectId,
          status: terminalJob.status,
          error: terminalJob.error,
        },
        "Job finished.",
      ],
    ]);
  });

  it("limits a dedicated reference worker to coordinator and OCR queues", async () => {
    configState.AI_DECK_EXECUTION_MODE = "bullmq";
    configState.AI_DECK_WORKER_QUEUE = "reference-extract";
    const { service } = createService();

    service.onModuleInit();

    expect([...bullMq.queues].sort()).toEqual(
      [generateDeckQueueName, referenceExtractQueueName].sort(),
    );
    await service.onModuleDestroy();
  });

  it.each([
    ["research-content", aiDeckResearchContentQueueName, "source-grounding"],
    ["design-layout", aiDeckDesignLayoutQueueName, "design-planning"],
  ] as const)(
    "limits the %s role and routes its planning stages",
    async (role, queueName, stage) => {
      configState.AI_DECK_EXECUTION_MODE = "bullmq";
      configState.AI_DECK_WORKER_QUEUE = role;
      const { service, logger } = createService();

      service.onModuleInit();

      expect(bullMq.queues).toEqual([queueName]);
      await requiredHandler(queueName)(
        bullJob(stage, {
          pipelineJobId: "job-ai-deck-1",
          projectId: "project-a",
          stage,
          shardKey: "",
        }),
      );
      expect(processors.planningStage).toHaveBeenCalledTimes(1);
      const options = processors.planningStage.mock.calls[0]?.[4] as {
        eventLogger: (event: string, fields: Record<string, unknown>) => void;
      };
      options.eventLogger("ai-ppt.stage.attempt-failed", { terminal: false });
      options.eventLogger("ai-ppt.stage.failed", { terminal: true });
      options.eventLogger("ai-ppt.stage.succeeded", {});
      expect(logger.warn).toHaveBeenCalledWith(
        { event: "ai-ppt.stage.attempt-failed", terminal: false },
        "AI PPT generation event.",
      );
      expect(logger.error).toHaveBeenCalledWith(
        { event: "ai-ppt.stage.failed", terminal: true },
        "AI PPT generation event.",
      );
      expect(logger.info).toHaveBeenCalledWith(
        { event: "ai-ppt.stage.succeeded" },
        "AI PPT generation event.",
      );
      await service.onModuleDestroy();
    },
  );

  it("logs AI deck retry signals as warn without serializing the signal error", async () => {
    configState.AI_DECK_EXECUTION_MODE = "bullmq";
    configState.AI_DECK_WORKER_QUEUE = "research-content";
    const retrySignal = Object.assign(new Error("AI_DECK_STAGE_RETRY"), {
      name: "AiDeckStageRetrySignal",
    });
    processors.planningStage.mockRejectedValueOnce(retrySignal);
    const { service, logger } = createService();
    service.onModuleInit();
    const job = bullJob("content-planning", {
      pipelineJobId: "job-ai-deck-1",
      projectId: "project-a",
      stage: "content-planning",
      shardKey: "",
    });

    await expect(
      requiredHandler(aiDeckResearchContentQueueName)(job),
    ).rejects.toBe(retrySignal);
    bullMq.failedHandlers.get(aiDeckResearchContentQueueName)?.(
      job,
      retrySignal,
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "bullmq.job.retry-scheduled",
        pipelineJobId: "job-ai-deck-1",
        stage: "content-planning",
      }),
      "BullMQ job retry scheduled.",
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "bullmq.job.failed" }),
      "BullMQ job failed.",
    );
    await service.onModuleDestroy();
  });

  it.each([
    ["image", aiDeckImageQueueName, "image-slide", "slide-1"],
    ["qa-finalize", aiDeckQaFinalizeQueueName, "semantic-quality", ""],
  ] as const)(
    "limits the %s role and routes its execution stages",
    async (role, queueName, stage, shardKey) => {
      configState.AI_DECK_EXECUTION_MODE = "bullmq";
      configState.AI_DECK_WORKER_QUEUE = role;
      const { service } = createService();
      service.onModuleInit();
      expect(bullMq.queues).toEqual(
        role === "image"
          ? [queueName, designImageGenerationQueueName]
          : [queueName],
      );
      await requiredHandler(queueName)(
        bullJob(stage, {
          pipelineJobId: "job-ai-deck-1",
          projectId: "project-a",
          stage,
          shardKey,
        }),
      );
      expect(processors.executionStage).toHaveBeenCalledTimes(1);
      expect(
        (
          processors.executionStage.mock.calls[0]?.[6] as {
            eventLogger?: unknown;
          }
        ).eventLogger,
      ).toEqual(expect.any(Function));
      await service.onModuleDestroy();
    },
  );

  it("awaits DB recovery for final coordinator and OCR transport attempts", async () => {
    configState.AI_DECK_EXECUTION_MODE = "bullmq";
    const { service } = createService();
    service.onModuleInit();
    const generateHandler = requiredHandler(generateDeckQueueName);
    const referenceHandler = requiredHandler(referenceExtractQueueName);
    processors.stagedCoordinator.mockRejectedValueOnce(
      new Error("coordinator transport failure"),
    );
    processors.referenceExtractStage.mockRejectedValueOnce(
      new Error("stage transport failure"),
    );

    await expect(
      generateHandler(
        bullJob(
          generateDeckStagedCoordinatorJobName,
          { jobId: "job-ai-deck-1", projectId: "project-a" },
          4,
        ),
      ),
    ).rejects.toThrow("coordinator transport failure");
    await expect(
      referenceHandler(
        bullJob(
          "reference-extract-file",
          {
            pipelineJobId: "job-ai-deck-1",
            projectId: "project-a",
            stage: "reference-extract-file",
            shardKey: "file-a",
          },
          4,
        ),
      ),
    ).rejects.toThrow("stage transport failure");

    expect(transportRecovery.recover).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      {
        queueName: generateDeckQueueName,
        jobName: generateDeckStagedCoordinatorJobName,
        data: { jobId: "job-ai-deck-1", projectId: "project-a" },
      },
    );
    expect(transportRecovery.recover).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      {
        queueName: referenceExtractQueueName,
        jobName: "reference-extract-file",
        data: {
          pipelineJobId: "job-ai-deck-1",
          projectId: "project-a",
          stage: "reference-extract-file",
          shardKey: "file-a",
        },
      },
    );
    await service.onModuleDestroy();
  });

  it("logs a final coordinator recovery only after its parent commit", async () => {
    configState.AI_DECK_EXECUTION_MODE = "bullmq";
    const terminalJob: Job = {
      ...orbitJob("failed"),
      result: { privateArtifact: "must-not-be-logged" },
      error: {
        code: "AI_DECK_COORDINATOR_FAILED",
        message: "AI deck staged coordinator retries were exhausted.",
        failedStage: "reference-extract-file",
        retryable: true,
      },
    };
    let resolveRecovery!: (result: {
      outcome: "coordinator-failed";
      terminalJob: Job;
    }) => void;
    transportRecovery.recover.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRecovery = resolve;
        }),
    );
    const { service, logger } = createService();
    service.onModuleInit();
    processors.stagedCoordinator.mockRejectedValueOnce(
      new Error("final coordinator transport failure"),
    );

    const completion = requiredHandler(generateDeckQueueName)(
      bullJob(
        generateDeckStagedCoordinatorJobName,
        { jobId: "job-ai-deck-1", projectId: "project-a" },
        4,
      ),
    ).catch((error: unknown) => error);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(transportRecovery.recover).toHaveBeenCalledTimes(1);
    expect(failedJobLogCalls(logger)).toEqual([]);

    resolveRecovery({ outcome: "coordinator-failed", terminalJob });
    await expect(completion).resolves.toEqual(
      new Error("final coordinator transport failure"),
    );

    expect(failedJobLogCalls(logger)).toEqual([
      [
        {
          event: "job.failed",
          jobId: terminalJob.jobId,
          jobType: terminalJob.type,
          projectId: terminalJob.projectId,
          status: terminalJob.status,
          error: terminalJob.error,
        },
        "Job finished.",
      ],
    ]);
    await service.onModuleDestroy();
  });

  it("does not recover an intermediate BullMQ attempt", async () => {
    configState.AI_DECK_EXECUTION_MODE = "bullmq";
    const { service } = createService();
    service.onModuleInit();
    processors.stagedCoordinator.mockRejectedValueOnce(
      new Error("retryable coordinator failure"),
    );

    await expect(
      requiredHandler(generateDeckQueueName)(
        bullJob(
          generateDeckStagedCoordinatorJobName,
          { jobId: "job-ai-deck-1", projectId: "project-a" },
          3,
        ),
      ),
    ).rejects.toThrow("retryable coordinator failure");

    expect(transportRecovery.recover).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  it("preserves the original failure when final DB recovery also fails", async () => {
    configState.AI_DECK_EXECUTION_MODE = "bullmq";
    const { service, logger } = createService();
    service.onModuleInit();
    const originalError = new Error("original stage failure");
    processors.referenceExtractStage.mockRejectedValueOnce(originalError);
    transportRecovery.recover.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(
      requiredHandler(referenceExtractQueueName)(
        bullJob(
          "reference-extract-file",
          {
            pipelineJobId: "job-ai-deck-1",
            projectId: "project-a",
            stage: "reference-extract-file",
            shardKey: "file-a",
          },
          4,
        ),
      ),
    ).rejects.toBe(originalError);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai_deck.transport_failure.recovery_failed",
      }),
      "AI deck transport failure recovery failed.",
    );
    await service.onModuleDestroy();
  });

  it.each([
    ["sqs", "all"],
    ["monolith", "reference-extract"],
  ] as const)(
    "fails startup for an unavailable mode %s/%s",
    (executionMode, workerQueue) => {
      configState.AI_DECK_EXECUTION_MODE = executionMode;
      configState.AI_DECK_WORKER_QUEUE = workerQueue;
      const { service, logger } = createService();

      expect(() => service.onModuleInit()).toThrow(/not implemented/i);
      expect(bullMq.queues).toEqual([]);
      expect(maintenance.dispatch).not.toHaveBeenCalled();
      expect(maintenance.coordinator).not.toHaveBeenCalled();
      expect(maintenance.reconcile).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: "worker.ready" }),
        "Worker ready.",
      );
    },
  );
});

interface FakeBullJob {
  id: string;
  name: string;
  data: unknown;
  attemptsMade: number;
  opts: { attempts: number };
}

function bullJob(
  name: string,
  data: unknown,
  attemptsMade = 0,
  attempts = 5,
): FakeBullJob {
  return { id: `bull-${name}`, name, data, attemptsMade, opts: { attempts } };
}

function requiredHandler(queueName: string) {
  const handler = bullMq.handlers.get(queueName);
  if (!handler) throw new Error(`Missing handler for ${queueName}`);
  return handler;
}

function createService() {
  const logger = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  } as unknown as PinoLogger;
  return {
    service: new WorkerService({} as DataSource, logger),
    logger: logger as unknown as {
      error: ReturnType<typeof vi.fn>;
      info: ReturnType<typeof vi.fn>;
      warn: ReturnType<typeof vi.fn>;
    },
  };
}

function failedJobLogCalls(logger: { error: ReturnType<typeof vi.fn> }) {
  return logger.error.mock.calls.filter(
    ([fields, message]) =>
      typeof fields === "object" &&
      fields !== null &&
      "event" in fields &&
      fields.event === "job.failed" &&
      message === "Job finished.",
  );
}

function orbitJob(
  status: Job["status"],
  type: Job["type"] = "ai-deck-generation",
): Job {
  return {
    jobId: "job-ai-deck-1",
    projectId: "project-a",
    type,
    status,
    progress: status === "succeeded" ? 100 : 10,
    message: status,
    result: null,
    error: null,
    createdAt: "2026-07-15T01:00:00.000Z",
    updatedAt: "2026-07-15T01:00:00.000Z",
  };
}
