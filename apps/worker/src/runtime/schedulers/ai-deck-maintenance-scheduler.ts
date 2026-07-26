import type { OrbitConfig } from "@orbit/config";
import type { Job as OrbitJob } from "@orbit/shared/jobs";
import type { StoragePort } from "@orbit/storage";
import type { PinoLogger } from "nestjs-pino";
import type { DataSource } from "typeorm";

import {
  type FailedCoordinatorScanCursor,
  reconcileFailedAiDeckCoordinatorJobs,
} from "../../generate-deck/coordinator-failure-reconciler";
import { AiDeckPostgresStageRunner } from "../../generate-deck/postgres-stage-runner";
import { dispatchAiDeckGenerationStages } from "../../generate-deck/stage-dispatcher";
import { AiDeckGenerationStageCheckpointRepository } from "../../generate-deck/stage-checkpoint-repository";
import { reconcileExpiredAiDeckStageLeases } from "../../generate-deck/stage-reconciler";
import { initializePendingAiDeckGenerationJobs } from "../../generate-deck/staged-coordinator";
import type { ImageAssetRuntime } from "../../image-asset-pipeline";
import { serializeLogError } from "../../logging";
import {
  isAiDeckStageRetrySignal,
  jobPayloadFields,
} from "../bullmq-worker-runtime";
import { logTerminalFailures } from "../terminal-recoveries";
import type { WorkerScheduler } from "./worker-scheduler";

interface AiDeckMaintenanceSchedulerContext {
  config: OrbitConfig;
  dataSource: DataSource;
  eventLogger(event: string, fields: Record<string, unknown>): void;
  imageRuntime: ImageAssetRuntime;
  logger: PinoLogger;
  storage: StoragePort;
  workerId: string;
}

export class AiDeckMaintenanceScheduler implements WorkerScheduler {
  readonly name = "ai-deck-maintenance";
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private postgresRunner: AiDeckPostgresStageRunner | null = null;
  private failedCoordinatorScanCursor: FailedCoordinatorScanCursor = {
    redisCursor: "0",
    pendingJobIds: [],
  };

  constructor(private readonly context: AiDeckMaintenanceSchedulerContext) {}

  start(): void {
    if (this.context.config.AI_DECK_EXECUTION_MODE === "pg") {
      this.startPostgresRunner();
    }
    if (
      this.context.config.AI_DECK_EXECUTION_MODE !== "bullmq" &&
      this.context.config.AI_DECK_EXECUTION_MODE !== "pg"
    ) {
      return;
    }
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 5_000);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.postgresRunner?.stop();
    await this.inFlight;
  }

  private startPostgresRunner(): void {
    const { config, dataSource, eventLogger, imageRuntime, logger, storage } =
      this.context;
    if (
      config.AI_DECK_WORKER_CONCURRENCY === 1 ||
      config.AI_DECK_USER_CONCURRENCY === 1
    ) {
      logger.warn(
        {
          event: "ai_ppt.cover_preview.concurrency_limited",
          workerConcurrency: config.AI_DECK_WORKER_CONCURRENCY,
          userConcurrency: config.AI_DECK_USER_CONCURRENCY,
        },
        "AI deck cover preview can be delayed when PostgreSQL stage concurrency is 1.",
      );
    }
    this.postgresRunner = new AiDeckPostgresStageRunner({
      dataSource,
      storage,
      pythonWorkerUrl: config.PYTHON_WORKER_URL,
      workerId: this.context.workerId,
      concurrency: config.AI_DECK_WORKER_CONCURRENCY,
      userConcurrency: config.AI_DECK_USER_CONCURRENCY,
      imageRuntime,
      eventLogger,
      onError: (error, claimed) => {
        const retryScheduled = isAiDeckStageRetrySignal(error);
        logger[retryScheduled ? "warn" : "error"](
          {
            event: retryScheduled
              ? "ai-ppt.stage.retry-scheduled"
              : "ai-ppt.stage.runner-failed",
            pipelineJobId: claimed.message.pipelineJobId,
            projectId: claimed.message.projectId,
            stage: claimed.message.stage,
            shardKey: claimed.message.shardKey,
            ...(retryScheduled ? {} : { error: serializeLogError(error) }),
          },
          retryScheduled
            ? "PostgreSQL AI deck stage retry scheduled."
            : "PostgreSQL AI deck stage runner failed.",
        );
      },
    });
    this.postgresRunner.start();
  }

  private schedule(): void {
    if (this.inFlight) return;
    const task = this.run();
    this.inFlight = task;
    void task.finally(() => {
      if (this.inFlight === task) this.inFlight = null;
    });
  }

  private async run(): Promise<void> {
    if (this.context.config.AI_DECK_EXECUTION_MODE === "pg") {
      await this.runPostgresMaintenance();
      return;
    }
    await this.runBullMqMaintenance();
  }

  private async runBullMqMaintenance(): Promise<void> {
    const { config, dataSource, logger } = this.context;
    const repository = new AiDeckGenerationStageCheckpointRepository(
      dataSource,
    );
    try {
      const result = await reconcileFailedAiDeckCoordinatorJobs(dataSource, {
        redisUrl: config.REDIS_URL,
        cursor: this.failedCoordinatorScanCursor,
        onError: (error, job) =>
          logger.error(
            {
              event: "ai_deck.coordinator.reconcile_failed",
              bullJobId: job.id,
              attemptsMade: job.attemptsMade,
              ...jobPayloadFields(job.data),
              error: serializeLogError(error),
            },
            "AI deck coordinator reconciliation failed.",
          ),
      });
      this.failedCoordinatorScanCursor = result.nextCursor;
      logTerminalFailures(logger, result.terminalJobs);
      if (result.recovered > 0 || result.removed > 0) {
        logger.warn(
          {
            event: "ai_deck.coordinator.reconciled",
            scanned: result.scanned,
            recovered: result.recovered,
            resumed: result.resumed,
            removed: result.removed,
            redisCursor: result.nextCursor.redisCursor,
            pendingJobCount: result.nextCursor.pendingJobIds.length,
          },
          "AI deck failed coordinators reconciled.",
        );
      }
    } catch (error) {
      logger.error(
        {
          event: "ai_deck.coordinator.reconcile_scan_failed",
          error: serializeLogError(error),
        },
        "AI deck coordinator reconciliation scan failed.",
      );
    }

    try {
      await dispatchAiDeckGenerationStages(repository, {
        driver: "bullmq",
        redisUrl: config.REDIS_URL,
        onError: (error, message) =>
          logger.error(
            {
              event: "ai_deck.stage.dispatch_failed",
              pipelineJobId: message.pipelineJobId,
              projectId: message.projectId,
              stage: message.stage,
              shardKey: message.shardKey,
              error: serializeLogError(error),
            },
            "AI deck stage dispatch failed.",
          ),
      });
    } catch (error) {
      logger.error(
        {
          event: "ai_deck.stage.dispatch_scan_failed",
          error: serializeLogError(error),
        },
        "AI deck stage dispatch scan failed.",
      );
    }
    await this.reconcileExpiredLeases();
  }

  private async runPostgresMaintenance(): Promise<void> {
    const { dataSource, logger } = this.context;
    try {
      const result = await initializePendingAiDeckGenerationJobs(dataSource, {
        onError: (error, parent) =>
          logger.error(
            {
              event: "ai_deck.postgres_initialization_failed",
              jobId: parent.jobId,
              projectId: parent.projectId,
              error: serializeLogError(error),
            },
            "PostgreSQL AI deck parent initialization failed.",
          ),
      });
      if (result.initialized > 0) {
        logger.info(
          {
            event: "ai_deck.postgres_initialized",
            scanned: result.scanned,
            initialized: result.initialized,
          },
          "PostgreSQL AI deck parents initialized.",
        );
      }
    } catch (error) {
      logger.error(
        {
          event: "ai_deck.postgres_initialization_scan_failed",
          error: serializeLogError(error),
        },
        "PostgreSQL AI deck parent initialization scan failed.",
      );
    }
    await this.reconcileExpiredLeases();
  }

  private async reconcileExpiredLeases(): Promise<void> {
    const { dataSource, logger } = this.context;
    try {
      const result = await reconcileExpiredAiDeckStageLeases(dataSource, {
        onError: (error, message) =>
          logger.error(
            {
              event: "ai_deck.stage.reconcile_failed",
              pipelineJobId: message.pipelineJobId,
              projectId: message.projectId,
              stage: message.stage,
              shardKey: message.shardKey,
              error: serializeLogError(error),
            },
            "AI deck stage reconciliation failed.",
          ),
      });
      logTerminalFailures(logger, result.terminalJobs as OrbitJob[]);
    } catch (error) {
      logger.error(
        {
          event: "ai_deck.stage.reconcile_scan_failed",
          error: serializeLogError(error),
        },
        "AI deck stage reconciliation scan failed.",
      );
    }
  }
}
