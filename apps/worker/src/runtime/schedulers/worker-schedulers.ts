import type { OrbitConfig } from "@orbit/config";
import { enqueueActivityResponseRetentionJob } from "@orbit/job-queue";
import type { StoragePort } from "@orbit/storage";
import type { PinoLogger } from "nestjs-pino";
import type { DataSource } from "typeorm";

import { dispatchDueActivityRetentionJobs } from "../../activity-retention.dispatcher";
import type { ImageAssetRuntime } from "../../image-asset-pipeline";
import { serializeLogError } from "../../logging";
import { deleteExpiredSlidePracticeData } from "../../slide-practice-retention";
import {
  enqueueExpiredRehearsalAudioDeletions,
  enqueueExpiredSlidePracticeAudioDeletions,
  reconcileStorageDeletionOutbox,
} from "../../storage-deletion-reconciler";
import { AiDeckMaintenanceScheduler } from "./ai-deck-maintenance-scheduler";
import type { WorkerScheduler } from "./worker-scheduler";

interface WorkerSchedulerContext {
  config: OrbitConfig;
  dataSource: DataSource;
  eventLogger(event: string, fields: Record<string, unknown>): void;
  imageRuntime: ImageAssetRuntime;
  logger: PinoLogger;
  storage: StoragePort;
  workerId: string;
}

export function createWorkerSchedulers(
  context: WorkerSchedulerContext,
): WorkerScheduler[] {
  const schedulers: WorkerScheduler[] = [
    new AiDeckMaintenanceScheduler(context),
  ];
  if (context.config.AI_DECK_WORKER_QUEUE !== "all") {
    return schedulers;
  }
  return [
    createStorageDeletionScheduler(context),
    createActivityRetentionScheduler(context),
    ...schedulers,
  ];
}

function createStorageDeletionScheduler(
  context: WorkerSchedulerContext,
): WorkerScheduler {
  return new IntervalWorkerScheduler(
    "storage-deletion",
    30_000,
    async () => {
      await enqueueExpiredRehearsalAudioDeletions(context.dataSource);
      await enqueueExpiredSlidePracticeAudioDeletions(context.dataSource);
      await reconcileStorageDeletionOutbox(context.dataSource, context.storage);
      const deleted = await deleteExpiredSlidePracticeData(context.dataSource);
      if (
        deleted.analysisCount > 0 ||
        deleted.reportCount > 0 ||
        deleted.baselineCount > 0
      ) {
        context.logger.info(
          {
            event: "slide_practice.retention_deleted",
            analysisCount: deleted.analysisCount,
            reportCount: deleted.reportCount,
            baselineCount: deleted.baselineCount,
          },
          "Expired slide practice data deleted.",
        );
      }
    },
    (error) =>
      context.logger.error(
        {
          event: "storage_deletion.reconcile_failed",
          error: serializeLogError(error),
        },
        "Storage deletion reconciliation failed.",
      ),
  );
}

function createActivityRetentionScheduler(
  context: WorkerSchedulerContext,
): WorkerScheduler {
  return new IntervalWorkerScheduler(
    "activity-retention",
    30_000,
    async () => {
      const result = await dispatchDueActivityRetentionJobs(
        context.dataSource,
        (payload) =>
          enqueueActivityResponseRetentionJob({
            ...payload,
            driver: context.config.JOB_QUEUE_DRIVER,
            redisUrl: context.config.REDIS_URL,
          }),
      );
      if (result.scanned === 0 && result.normalizedExpired === 0) return;
      context.logger.info(
        { event: "activity_retention.dispatched", ...result },
        "Activity response retention jobs dispatched.",
      );
    },
    (error) =>
      context.logger.error(
        {
          event: "activity_retention.dispatch_failed",
          error: serializeLogError(error),
        },
        "Activity response retention dispatch failed.",
      ),
  );
}

class IntervalWorkerScheduler implements WorkerScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly name: string,
    private readonly intervalMs: number,
    private readonly task: () => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  start(): void {
    this.run();
    this.timer = setInterval(() => this.run(), this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  private run(): void {
    void this.task().catch(this.onError);
  }
}
