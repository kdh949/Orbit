import {
  rehearsalReportSchema,
  retryRehearsalSemanticEvaluationResponseSchema,
} from "@orbit/shared/rehearsals";
import { ConflictException } from "@nestjs/common";
import { RehearsalComparisonUseCases } from "./rehearsal-comparison.use-cases";

export class RehearsalRetryUseCases extends RehearsalComparisonUseCases {
  async retrySemanticEvaluation(runId: string) {
    const run = await this.getRunEntity(runId);
    if (
      run.status !== "succeeded" ||
      run.rehearsalReport === null ||
      run.semanticEvaluationMode !== "full" ||
      run.evaluationSnapshot === null
    ) {
      throw new ConflictException({
        code: "REHEARSAL_SEMANTIC_EVALUATION_NOT_READY",
        message: "Rehearsal semantic evaluation is not ready for retry.",
        retryable: false,
      });
    }

    const hasEvidence = await this.transcriptCache.hasSemanticEvidence(
      run.runId,
    );
    if (!hasEvidence) {
      throw new ConflictException({
        code: "REHEARSAL_SEMANTIC_EVIDENCE_EXPIRED",
        message: "Rehearsal semantic evidence has expired.",
        retryable: false,
      });
    }

    const report = rehearsalReportSchema.safeParse(run.rehearsalReport);
    if (!report.success || !report.data.semanticEvaluation.retryable) {
      throw new ConflictException({
        code: "REHEARSAL_SEMANTIC_EVALUATION_NOT_READY",
        message: "Rehearsal semantic evaluation is not retryable.",
        retryable: false,
      });
    }

    const queuedJob = await this.jobsService.create({
      projectId: run.projectId,
      type: "rehearsal-semantic-evaluation",
      payload: { runId: run.runId },
    });

    try {
      await this.enqueueSemanticEvaluationJob({
        driver: this.config.JOB_QUEUE_DRIVER,
        redisUrl: this.config.REDIS_URL,
        jobId: queuedJob.jobId,
        projectId: run.projectId,
        runId: run.runId,
      });
      this.logger.info(
        {
          event: "job.enqueued",
          jobId: queuedJob.jobId,
          jobType: queuedJob.type,
          projectId: run.projectId,
          runId: run.runId,
          deckId: run.deckId,
          driver: this.config.JOB_QUEUE_DRIVER,
        },
        "Rehearsal semantic evaluation retry enqueued.",
      );
    } catch (error) {
      const failure = {
        code: "REHEARSAL_SEMANTIC_EVALUATION_ENQUEUE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Rehearsal semantic evaluation retry enqueue failed.",
      };
      await this.jobsService.update(queuedJob.jobId, {
        status: "failed",
        progress: 0,
        message: "Rehearsal semantic evaluation retry enqueue failed.",
        error: failure,
      });
      this.logger.error(
        {
          event: "rehearsal.semantic_evaluation.retry_failed",
          projectId: run.projectId,
          deckId: run.deckId,
          deckVersion: run.deckVersion ?? undefined,
          runId: run.runId,
          jobId: queuedJob.jobId,
          reason: failure.code,
        },
        "Rehearsal semantic evaluation retry enqueue failed.",
      );
      throw error;
    }

    return retryRehearsalSemanticEvaluationResponseSchema.parse({
      job: queuedJob,
    });
  }
}
