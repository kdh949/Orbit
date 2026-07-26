import type { Job } from "@orbit/shared/jobs";
import type { StoragePort } from "@orbit/storage";
import type { DataSource } from "typeorm";

import type { ImageAssetRuntime } from "../image-asset-pipeline";
import { processAiDeckExecutionStage } from "./execution-stage.processor";
import { processAiDeckPlanningStage } from "./planning-stage.processor";
import { processAiDeckReferenceExtractionStage } from "./reference-extract-stage";
import {
  AiDeckGenerationStageCheckpointRepository,
  type ClaimedAiDeckGenerationStage,
} from "./stage-checkpoint-repository";
import type { AiDeckStageEventLogger } from "./stage-diagnostics";

export interface AiDeckPostgresStageRunnerOptions {
  dataSource: DataSource;
  storage: Pick<StoragePort, "getSignedReadUrl" | "putObject">;
  pythonWorkerUrl: string;
  workerId: string;
  concurrency: number;
  userConcurrency: number;
  imageRuntime?: ImageAssetRuntime;
  eventLogger?: AiDeckStageEventLogger;
  pollIntervalMs?: number;
  onError?: (
    error: unknown,
    claimed: ClaimedAiDeckGenerationStage,
  ) => void;
}

export class AiDeckPostgresStageRunner {
  private readonly repository: AiDeckGenerationStageCheckpointRepository;
  private readonly active = new Set<Promise<void>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fillInFlight: Promise<void> | null = null;
  private started = false;

  constructor(private readonly options: AiDeckPostgresStageRunnerOptions) {
    this.repository = new AiDeckGenerationStageCheckpointRepository(
      options.dataSource,
    );
  }

  get activeCount(): number {
    return this.active.size;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.fillInFlight;
    await Promise.allSettled([...this.active]);
  }

  async runOnce(): Promise<void> {
    if (this.fillInFlight) return this.fillInFlight;
    const fill = this.fillAvailableSlots();
    this.fillInFlight = fill;
    try {
      await fill;
    } finally {
      if (this.fillInFlight === fill) this.fillInFlight = null;
      if (this.started && this.active.size < this.options.concurrency) {
        this.schedule(this.options.pollIntervalMs ?? 250);
      }
    }
  }

  private async fillAvailableSlots(): Promise<void> {
    while (this.active.size < this.options.concurrency) {
      const claimed = await this.repository.claimNext(
        this.options.workerId,
        this.options.userConcurrency,
      );
      if (!claimed) return;

      let task!: Promise<void>;
      task = Promise.resolve()
        .then(() => this.processClaimed(claimed))
        .then(() => undefined)
        .catch((error) => {
          this.options.onError?.(error, claimed);
        })
        .finally(() => {
          this.active.delete(task);
          if (this.started) this.schedule(0);
        });
      this.active.add(task);
    }
  }

  private processClaimed(
    claimed: ClaimedAiDeckGenerationStage,
  ): Promise<Job | void> {
    const { message, checkpoint } = claimed;
    if (message.stage === "reference-extract-file") {
      return processAiDeckReferenceExtractionStage(
        this.options.dataSource,
        this.options.storage,
        this.options.pythonWorkerUrl,
        this.options.workerId,
        message,
        { claimedCheckpoint: checkpoint },
      );
    }
    if (
      message.stage === "source-grounding" ||
      message.stage === "content-planning" ||
      message.stage === "design-planning" ||
      message.stage === "layout-compile"
    ) {
      return processAiDeckPlanningStage(
        this.options.dataSource,
        this.options.pythonWorkerUrl,
        this.options.workerId,
        message,
        {
          eventLogger: this.options.eventLogger,
          claimedCheckpoint: checkpoint,
        },
      );
    }
    return processAiDeckExecutionStage(
      this.options.dataSource,
      this.options.storage,
      this.options.pythonWorkerUrl,
      this.options.workerId,
      message,
      this.options.imageRuntime,
      {
        eventLogger: this.options.eventLogger,
        claimedCheckpoint: checkpoint,
      },
    );
  }

  private schedule(delayMs: number): void {
    if (!this.started || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runOnce();
    }, delayMs);
    this.timer.unref?.();
  }
}
