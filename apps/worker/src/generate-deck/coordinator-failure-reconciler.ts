import {
  generateDeckQueueName,
  generateDeckStagedCoordinatorJobName,
  redisConnectionOptions,
} from "@orbit/job-queue";
import { bullMqTelemetry } from "@orbit/observability";
import type { Job } from "@orbit/shared/jobs";
import { Queue } from "bullmq";
import type Redis from "ioredis";
import type { DataSource } from "typeorm";
import { z } from "zod";

import {
  recoverAiDeckBullMqFinalFailure,
  type AiDeckBullMqFailureRecoveryOutcome,
  type AiDeckBullMqFailureRecoveryResult,
} from "./transport-failure-recovery";
import { processAiDeckStagedCoordinatorJob } from "./staged-coordinator";

const reconcileLimitSchema = z.number().int().min(1).max(100);
const redisScanCursorSchema = z.string().regex(/^\d+$/);
const failedCoordinatorScanCursorSchema = z
  .object({
    redisCursor: redisScanCursorSchema,
    pendingJobIds: z.array(z.string().min(1)),
  })
  .strict();
const transportBoundaryFailureReasons = new Set([
  "job stalled more than allowable limit",
  "job started more than allowable limit",
]);

export interface FailedCoordinatorScanCursor {
  redisCursor: string;
  pendingJobIds: string[];
}

export interface FailedAiDeckCoordinatorJob {
  id?: string;
  name: string;
  data: unknown;
  attemptsMade: number;
  failedReason?: string;
  opts: { attempts?: number };
  remove(): Promise<void>;
}

interface FailedCoordinatorQueue {
  scanFailed(
    cursor: string,
    count: number,
  ): Promise<{ nextCursor: string; jobIds: string[] }>;
  getJob(
    jobId: string,
  ): Promise<FailedAiDeckCoordinatorJob | null | undefined>;
  close(): Promise<void>;
}

type RecoveryFunction = (
  dataSource: DataSource,
  input: {
    queueName: string;
    jobName: string;
    data: unknown;
  },
) => Promise<
  AiDeckBullMqFailureRecoveryResult | AiDeckBullMqFailureRecoveryOutcome
>;

type ResumeFunction = (
  dataSource: DataSource,
  data: unknown,
) => Promise<Job>;

export interface FailedAiDeckCoordinatorReconcilerOptions {
  redisUrl: string;
  cursor?: FailedCoordinatorScanCursor;
  limit?: number;
  queueFactory?: (redisUrl: string) => FailedCoordinatorQueue;
  recover?: RecoveryFunction;
  resume?: ResumeFunction;
  onError?: (error: unknown, job: FailedAiDeckCoordinatorJob) => void;
}

export async function reconcileFailedAiDeckCoordinatorJobs(
  dataSource: DataSource,
  options: FailedAiDeckCoordinatorReconcilerOptions,
): Promise<{
  scanned: number;
  recovered: number;
  resumed: number;
  removed: number;
  terminalJobs: Job[];
  nextCursor: FailedCoordinatorScanCursor;
}> {
  const limit = reconcileLimitSchema.parse(options.limit ?? 25);
  const cursor = failedCoordinatorScanCursorSchema.parse(
    options.cursor ?? initialScanCursor(),
  );
  const queue = (options.queueFactory ?? createQueue)(options.redisUrl);
  let scanned = 0;
  let recovered = 0;
  let resumed = 0;
  let removed = 0;
  const terminalJobs: Job[] = [];
  try {
    let redisCursor = cursor.redisCursor;
    let pendingJobIds = [...cursor.pendingJobIds];
    if (pendingJobIds.length === 0) {
      const scan = await queue.scanFailed(redisCursor, limit);
      redisCursor = redisScanCursorSchema.parse(scan.nextCursor);
      pendingJobIds = uniqueJobIds(scan.jobIds);
    }

    const currentJobIds = pendingJobIds.splice(0, limit);
    const jobs: FailedAiDeckCoordinatorJob[] = [];
    for (const jobId of currentJobIds) {
      const job = await queue.getJob(jobId);
      if (isFailedCoordinatorJob(job)) jobs.push(job);
    }
    scanned = jobs.length;
    const candidates = jobs.filter(isStagedCoordinator);

    for (const job of candidates) {
      try {
        if (hasExhaustedConfiguredAttempts(job)) {
          const recovery = normalizeRecoveryResult(
            await (
              options.recover ?? recoverAiDeckBullMqFinalFailure
            )(dataSource, {
              queueName: generateDeckQueueName,
              jobName: job.name,
              data: job.data,
            }),
          );
          if (recovery.outcome === "coordinator-failed") recovered += 1;
          if (recovery.terminalJob?.status === "failed") {
            terminalJobs.push(recovery.terminalJob);
          }
        } else {
          const parentJob = await (
            options.resume ?? processAiDeckStagedCoordinatorJob
          )(
            dataSource,
            job.data,
          );
          resumed += 1;
          if (parentJob.status === "failed") terminalJobs.push(parentJob);
        }
        await job.remove();
        removed += 1;
      } catch (error) {
        options.onError?.(error, job);
      }
    }
    return {
      scanned,
      recovered,
      resumed,
      removed,
      terminalJobs,
      nextCursor: { redisCursor, pendingJobIds },
    };
  } finally {
    await queue.close();
  }
}

function isFailedCoordinatorJob(
  job: FailedAiDeckCoordinatorJob | null | undefined,
): job is FailedAiDeckCoordinatorJob {
  return job !== null && job !== undefined;
}

function createQueue(redisUrl: string): FailedCoordinatorQueue {
  const queue = new Queue(generateDeckQueueName, {
    connection: redisConnectionOptions(redisUrl),
    skipMetasUpdate: true,
    telemetry: bullMqTelemetry,
  });
  return {
    async scanFailed(cursor, count) {
      const client = (await queue.client) as unknown as Redis;
      const [nextCursor, elements] = await client.zscan(
        queue.toKey("failed"),
        cursor,
        "COUNT",
        count,
      );
      return {
        nextCursor,
        jobIds: elements.filter((_, index) => index % 2 === 0),
      };
    },
    async getJob(jobId) {
      return (await queue.getJob(jobId)) as unknown as
        | FailedAiDeckCoordinatorJob
        | undefined;
    },
    async close() {
      await queue.close();
    },
  };
}

function isStagedCoordinator(job: FailedAiDeckCoordinatorJob): boolean {
  return job.name === generateDeckStagedCoordinatorJobName;
}

function hasExhaustedConfiguredAttempts(
  job: FailedAiDeckCoordinatorJob,
): boolean {
  if (
    typeof job.failedReason === "string" &&
    transportBoundaryFailureReasons.has(job.failedReason)
  ) {
    return false;
  }
  const configuredAttempts =
    typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
  return job.attemptsMade >= Math.max(1, configuredAttempts);
}

function initialScanCursor(): FailedCoordinatorScanCursor {
  return { redisCursor: "0", pendingJobIds: [] };
}

function uniqueJobIds(jobIds: string[]): string[] {
  return [...new Set(jobIds.filter((jobId) => jobId.length > 0))];
}

function normalizeRecoveryResult(
  result: AiDeckBullMqFailureRecoveryResult | AiDeckBullMqFailureRecoveryOutcome,
): {
  outcome: AiDeckBullMqFailureRecoveryOutcome;
  terminalJob: Job | null;
} {
  return typeof result === "string"
    ? { outcome: result, terminalJob: null }
    : result;
}
