import type { Job as OrbitJob } from "@orbit/shared/jobs";
import type { Job as BullMqJob } from "bullmq";

export interface WorkerRuntimeOptions {
  concurrency?: number;
  maxStalledCount?: number;
}

export type WorkerRecoveryTrigger = "failed-event" | "handler-error";

export interface WorkerTerminalRecovery {
  recover(
    job: BullMqJob,
    error: Error,
    trigger: WorkerRecoveryTrigger,
  ): Promise<void>;
}

export interface WorkerDescriptor {
  acceptedJobNames: readonly string[];
  handler(job: BullMqJob): Promise<OrbitJob | void>;
  queueName: string;
  runtimeOptions?: WorkerRuntimeOptions;
  terminalRecovery?: WorkerTerminalRecovery;
}
