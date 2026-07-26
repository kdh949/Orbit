import type { Job as OrbitJob } from "@orbit/shared/jobs";
import type { Job as BullMqJob } from "bullmq";
import type { PinoLogger } from "nestjs-pino";
import type { DataSource } from "typeorm";

import { recoverAiDeckBullMqFinalFailure } from "../generate-deck/transport-failure-recovery";
import { serializeLogError } from "../logging";
import { recoverPptxOoxmlFinalFailure } from "../pptx-ooxml-failure-recovery";
import {
  isFinalBullMqAttempt,
  isStalledFailure,
  jobPayloadFields,
} from "./bullmq-worker-runtime";
import type { WorkerTerminalRecovery } from "./worker-descriptor";

export function createAiDeckTerminalRecovery(
  dataSource: DataSource,
  logger: PinoLogger,
  queueName: string,
): WorkerTerminalRecovery {
  return {
    async recover(job, _error, trigger) {
      if (trigger !== "handler-error" || !isFinalBullMqAttempt(job)) return;
      try {
        const result = await recoverAiDeckBullMqFinalFailure(dataSource, {
          queueName,
          jobName: job.name,
          data: job.data,
        });
        if (result.outcome === "ignored") return;
        logTerminalFailures(
          logger,
          result.terminalJob ? [result.terminalJob] : [],
        );
        logger.warn(
          {
            event: "ai_deck.transport_failure.recovered",
            queueName,
            bullJobId: job.id,
            attemptsMade: job.attemptsMade,
            recovery: result.outcome,
            ...jobPayloadFields(job.data),
          },
          "AI deck transport failure recovered.",
        );
      } catch (recoveryError) {
        logger.error(
          {
            event: "ai_deck.transport_failure.recovery_failed",
            queueName,
            bullJobId: job.id,
            attemptsMade: job.attemptsMade,
            ...jobPayloadFields(job.data),
            error: serializeLogError(recoveryError),
          },
          "AI deck transport failure recovery failed.",
        );
      }
    },
  };
}

export function createPptxTerminalRecovery(
  dataSource: DataSource,
  logger: PinoLogger,
  queueName: string,
): WorkerTerminalRecovery {
  return {
    async recover(job: BullMqJob, error: Error) {
      if (!isFinalBullMqAttempt(job) && !isStalledFailure(error)) return;
      try {
        const result = await recoverPptxOoxmlFinalFailure(dataSource, {
          queueName,
          data: job.data,
        });
        if (result.outcome !== "recovered") return;
        logger.warn(
          {
            event: "pptx_ooxml.transport_failure.recovered",
            queueName,
            bullJobId: job.id,
            attemptsMade: job.attemptsMade,
            ...jobPayloadFields(job.data),
          },
          "PPTX OOXML terminal transport failure recovered.",
        );
      } catch (recoveryError) {
        logger.error(
          {
            event: "pptx_ooxml.transport_failure.recovery_failed",
            queueName,
            bullJobId: job.id,
            attemptsMade: job.attemptsMade,
            ...jobPayloadFields(job.data),
            error: serializeLogError(recoveryError),
          },
          "PPTX OOXML transport failure recovery failed.",
        );
      }
    },
  };
}

export function logTerminalFailures(
  logger: PinoLogger,
  jobs: OrbitJob[],
): void {
  for (const job of jobs) {
    if (job.status !== "failed") continue;
    logger.error(
      {
        event: "job.failed",
        jobId: job.jobId,
        jobType: job.type,
        projectId: job.projectId,
        status: job.status,
        error: job.error ?? undefined,
      },
      "Job finished.",
    );
  }
}
