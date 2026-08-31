import { loadOrbitConfig } from "@orbit/config";
import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";

import { ChallengeQnaEvidenceCache } from "./challenge-qna-evidence-cache";
import { createImageAssetRuntime } from "./image-providers";
import { RedisRehearsalTranscriptCache } from "./rehearsal-transcript-cache";
import { BullMqWorkerRuntime } from "./runtime/bullmq-worker-runtime";
import { selectWorkerQueueNames } from "./runtime/worker-queue-policy";
import { createWorkerDescriptors } from "./runtime/worker-descriptors";
import type { WorkerScheduler } from "./runtime/schedulers/worker-scheduler";
import { createWorkerSchedulers } from "./runtime/schedulers/worker-schedulers";
import { workerStorage } from "./storage";

type WorkerRuntimeMetrics = {
  recordJobStarted(queueName: string, jobName: string): void;
  recordJobCompleted(
    queueName: string,
    jobName: string,
    outcome: "succeeded" | "failed" | "progressed",
    durationSeconds: number,
  ): void;
  start(input: { queueNames: string[]; redisUrl: string; port: number }): void;
  stop(): Promise<void>;
};

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly config = loadOrbitConfig(process.env, { service: "worker" });
  private readonly workerId = `worker-${randomUUID()}`;
  private queueNames: string[] = [];
  private runtime: BullMqWorkerRuntime | null = null;
  private schedulers: WorkerScheduler[] = [];
  private transcriptCache: RedisRehearsalTranscriptCache | null = null;
  private challengeQnaEvidenceCache: ChallengeQnaEvidenceCache | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectPinoLogger(WorkerService.name)
    private readonly logger: PinoLogger,
    @Optional()
    @Inject("WORKER_METRICS")
    private readonly metrics?: WorkerRuntimeMetrics,
  ) {}

  onModuleInit(): void {
    validateWorkerConfig(this.config);
    this.queueNames = selectWorkerQueueNames(this.config);

    const storage = workerStorage();
    const imageRuntime = createImageAssetRuntime(this.config);
    if (this.config.AI_DECK_WORKER_QUEUE === "all") {
      this.transcriptCache = new RedisRehearsalTranscriptCache(
        this.config.PRIVATE_EVIDENCE_REDIS_URL,
      );
      this.challengeQnaEvidenceCache = new ChallengeQnaEvidenceCache(
        this.config.PRIVATE_EVIDENCE_REDIS_URL,
      );
    }

    const eventLogger = (event: string, fields: Record<string, unknown>) => {
      const level =
        event === "ai-ppt.stage.failed"
          ? "error"
          : event === "ai-ppt.stage.attempt-failed" ||
              event === "ai-ppt.image-asset.fallback"
            ? "warn"
            : "info";
      this.logger[level]({ event, ...fields }, "AI PPT generation event.");
    };
    const context = {
      challengeQnaEvidenceCache: this.challengeQnaEvidenceCache,
      config: this.config,
      dataSource: this.dataSource,
      eventLogger,
      imageRuntime,
      logger: this.logger,
      storage,
      transcriptCache: this.transcriptCache,
      workerId: this.workerId,
    };
    const selectedQueues = new Set(this.queueNames);
    const descriptors = createWorkerDescriptors(context).filter(
      ({ queueName }) => selectedQueues.has(queueName),
    );

    this.runtime = new BullMqWorkerRuntime(
      this.config.REDIS_URL,
      this.logger,
      this.metrics,
    );
    this.runtime.start(descriptors);
    this.metrics?.start({
      queueNames: this.queueNames,
      redisUrl: this.config.REDIS_URL,
      port: this.config.WORKER_PORT,
    });
    this.schedulers = createWorkerSchedulers(context);
    for (const scheduler of this.schedulers) scheduler.start();

    this.logger.info(
      {
        event: "worker.ready",
        workerId: this.workerId,
        driver: this.config.JOB_QUEUE_DRIVER,
        aiDeckExecutionMode: this.config.AI_DECK_EXECUTION_MODE,
        aiDeckWorkerQueue: this.config.AI_DECK_WORKER_QUEUE,
        aiDeckWorkerConcurrency:
          this.config.AI_DECK_EXECUTION_MODE === "pg"
            ? this.config.AI_DECK_WORKER_CONCURRENCY
            : undefined,
        aiDeckUserConcurrency:
          this.config.AI_DECK_EXECUTION_MODE === "pg"
            ? this.config.AI_DECK_USER_CONCURRENCY
            : undefined,
        queueNames: this.queueNames,
      },
      "Worker ready.",
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.schedulers.map((scheduler) => scheduler.stop()));
    await this.runtime?.stop();
    await this.metrics?.stop();
    await this.transcriptCache?.close();
    await this.challengeQnaEvidenceCache?.close();
    this.logger.info(
      {
        event: "worker.stopped",
        queueNames: this.queueNames,
      },
      "Worker stopped.",
    );
  }
}

function validateWorkerConfig(
  config: ReturnType<typeof loadOrbitConfig>,
): void {
  if (config.JOB_QUEUE_DRIVER === "sqs") {
    throw new Error("SqsJobQueue adapter is not implemented yet.");
  }
  if (config.AI_DECK_EXECUTION_MODE === "sqs") {
    throw new Error("AI Deck SQS transport is not implemented yet.");
  }
  if (
    config.AI_DECK_WORKER_QUEUE !== "all" &&
    ![
      "reference-extract",
      "research-content",
      "design-layout",
      "image",
      "qa-finalize",
    ].includes(config.AI_DECK_WORKER_QUEUE)
  ) {
    throw new Error(
      `AI Deck worker role ${config.AI_DECK_WORKER_QUEUE} is not implemented.`,
    );
  }
  if (
    config.AI_DECK_WORKER_QUEUE !== "all" &&
    config.AI_DECK_EXECUTION_MODE !== "bullmq"
  ) {
    throw new Error(
      "Dedicated AI Deck worker roles are not implemented outside bullmq execution mode.",
    );
  }
}
