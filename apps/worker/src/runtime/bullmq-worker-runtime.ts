import { redisConnectionOptions } from "@orbit/job-queue";
import { semanticCueExtractionQueueName } from "@orbit/job-queue";
import type { Job as OrbitJob } from "@orbit/shared/jobs";
import { type Job as BullMqJob, Worker as BullMqWorker } from "bullmq";
import type { PinoLogger } from "nestjs-pino";

import { serializeLogError } from "../logging";
import type { WorkerDescriptor } from "./worker-descriptor";

export class BullMqWorkerRuntime {
  private workers: BullMqWorker[] = [];

  constructor(
    private readonly redisUrl: string,
    private readonly logger: PinoLogger,
  ) {}

  start(descriptors: WorkerDescriptor[]): void {
    this.workers = descriptors.map((descriptor) =>
      this.createWorker(descriptor),
    );
  }

  async stop(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    this.workers = [];
  }

  private createWorker(descriptor: WorkerDescriptor): BullMqWorker {
    const worker = new BullMqWorker(
      descriptor.queueName,
      (job) =>
        this.processJob(descriptor, job, () => {
          if (!descriptor.acceptedJobNames.includes(job.name)) {
            throw new Error(`Unsupported BullMQ job name: ${job.name}`);
          }
          return descriptor.handler(job);
        }),
      {
        connection: redisConnectionOptions(this.redisUrl),
        ...descriptor.runtimeOptions,
      },
    );

    worker.on("failed", (job, error) => {
      if (isAiDeckStageRetrySignal(error)) {
        this.logger.warn(
          {
            event: "bullmq.job.retry-scheduled",
            queueName: descriptor.queueName,
            bullJobId: job?.id,
            attemptsMade: job?.attemptsMade,
            ...jobPayloadFields(job?.data),
          },
          "BullMQ job retry scheduled.",
        );
        return;
      }
      if (job && descriptor.terminalRecovery) {
        void descriptor.terminalRecovery.recover(job, error, "failed-event");
      }
      this.logger.error(
        {
          event: "bullmq.job.failed",
          queueName: descriptor.queueName,
          bullJobId: job?.id,
          attemptsMade: job?.attemptsMade,
          ...jobPayloadFields(job?.data),
          error: serializeLogError(error),
        },
        "BullMQ job failed.",
      );
    });

    return worker;
  }

  private async processJob(
    descriptor: WorkerDescriptor,
    job: BullMqJob,
    handler: () => Promise<OrbitJob | void>,
  ): Promise<OrbitJob | void> {
    const startedAt = Date.now();
    const baseFields = {
      queueName: descriptor.queueName,
      bullJobId: job.id,
      attemptsMade: job.attemptsMade,
      ...jobPayloadFields(job.data),
    };

    this.logger.info(
      {
        event: "job.started",
        ...baseFields,
        ...processMemoryFields(),
      },
      "Job started.",
    );

    try {
      const result = await handler();
      const durationMs = Date.now() - startedAt;
      if (
        !result ||
        result.status === "queued" ||
        result.status === "running"
      ) {
        this.logger.info(
          {
            event: "job.progressed",
            ...baseFields,
            jobId: result?.jobId,
            jobType: result?.type,
            projectId: result?.projectId,
            status: result?.status,
            durationMs,
            ...processMemoryFields(),
          },
          "Job progressed.",
        );
        return result;
      }
      const event = result.status === "failed" ? "job.failed" : "job.succeeded";
      const level = result.status === "failed" ? "error" : "info";

      this.logger[level](
        {
          event,
          ...baseFields,
          jobId: result.jobId,
          jobType: result.type,
          projectId: result.projectId,
          status: result.status,
          durationMs,
          ...processMemoryFields(),
          ...jobDiagnosticFields(result.result),
          error: result.error ?? undefined,
        },
        "Job finished.",
      );
      if (descriptor.queueName === semanticCueExtractionQueueName) {
        this.logSemanticCueResult(result, baseFields, durationMs);
      }
      return result;
    } catch (error) {
      if (isAiDeckStageRetrySignal(error)) throw error;
      if (descriptor.terminalRecovery) {
        await descriptor.terminalRecovery.recover(
          job,
          toError(error),
          "handler-error",
        );
      }
      this.logger.error(
        {
          event: "job.failed",
          ...baseFields,
          durationMs: Date.now() - startedAt,
          ...processMemoryFields(),
          error: serializeLogError(error),
        },
        "Job failed.",
      );
      throw error;
    }
  }

  private logSemanticCueResult(
    result: OrbitJob,
    baseFields: Record<string, unknown>,
    durationMs: number,
  ): void {
    const versionConflict =
      result.error?.code === "SEMANTIC_CUE_DECK_VERSION_CONFLICT";
    const semanticEvent =
      result.status === "succeeded"
        ? "semantic_cue.extraction.succeeded"
        : versionConflict
          ? "semantic_cue.extraction.version_conflict"
          : "semantic_cue.extraction.failed";
    const semanticLevel =
      result.status === "succeeded"
        ? "info"
        : versionConflict
          ? "warn"
          : "error";
    this.logger[semanticLevel](
      {
        event: semanticEvent,
        ...baseFields,
        jobId: result.jobId,
        jobType: result.type,
        projectId: result.projectId,
        status: result.status,
        durationMs,
        reason: result.error?.code,
      },
      "Semantic cue extraction finished.",
    );
  }
}

export function isFinalBullMqAttempt(job: BullMqJob): boolean {
  const configuredAttempts =
    typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
  return job.attemptsMade + 1 >= Math.max(1, configuredAttempts);
}

export function isStalledFailure(error: Error): boolean {
  return error.message.toLowerCase().includes("stalled more than allowable");
}

export function isAiDeckStageRetrySignal(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "AiDeckStageRetrySignal" &&
    error.message === "AI_DECK_STAGE_RETRY"
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function jobPayloadFields(data: unknown) {
  const payload = isRecord(data) ? data : {};
  const request = isRecord(payload.request) ? payload.request : {};
  return {
    jobId: readString(payload, "jobId"),
    jobType: readString(payload, "type"),
    projectId: readString(payload, "projectId"),
    runId: readString(payload, "runId"),
    deckId: readString(payload, "deckId") ?? readString(request, "deckId"),
    deckVersion: readNumber(request, "baseVersion"),
    force: readBoolean(request, "force"),
    audioFileId: readString(payload, "audioFileId"),
    fileId: readString(payload, "fileId"),
    pipelineJobId: readString(payload, "pipelineJobId"),
    stage: readString(payload, "stage"),
    shardKey: readString(payload, "shardKey"),
    fileCount: Array.isArray(payload.files) ? payload.files.length : undefined,
  };
}

function jobDiagnosticFields(result: unknown) {
  if (!isRecord(result) || !isRecord(result.diagnostics)) return {};
  const diagnostics = result.diagnostics;
  return {
    referencePolicy: readString(diagnostics, "referencePolicy"),
    uploadedSourceCount: readNonNegativeNumber(
      diagnostics,
      "uploadedSourceCount",
    ),
    webSourceCount: readNonNegativeNumber(diagnostics, "webSourceCount"),
    repairAttempted:
      typeof diagnostics.repairAttempted === "boolean"
        ? diagnostics.repairAttempted
        : undefined,
    validationIssueCount: readNonNegativeNumber(
      diagnostics,
      "validationIssueCount",
    ),
    visualQaStatus: readString(diagnostics, "visualQaStatus"),
    visualReviewAttempts: readNonNegativeNumber(
      diagnostics,
      "visualReviewAttempts",
    ),
    visualRepairAttempts: readNonNegativeNumber(
      diagnostics,
      "visualRepairAttempts",
    ),
    visualIssueCodes: readStringArray(diagnostics, "visualIssueCodes"),
  };
}

function processMemoryFields() {
  const memory = process.memoryUsage();
  return {
    memoryRssBytes: memory.rss,
    memoryHeapUsedBytes: memory.heapUsed,
    memoryExternalBytes: memory.external,
    memoryArrayBuffersBytes: memory.arrayBuffers,
    memoryMaxRssBytes: process.resourceUsage().maxRSS * 1024,
  };
}

function readNonNegativeNumber(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  return typeof candidate === "number" && candidate >= 0
    ? candidate
    : undefined;
}

function readString(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function readStringArray(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) {
    return undefined;
  }
  return raw;
}

function readNumber(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function readBoolean(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === "boolean" ? raw : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
