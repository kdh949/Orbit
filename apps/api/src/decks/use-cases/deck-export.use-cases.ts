import { loadOrbitConfig } from "@orbit/config";
import {
  deckExportEnqueueErrorSchema,
  deckExportRequestSchema,
} from "@orbit/shared/deck";
import { jobSchema } from "@orbit/shared/jobs";
import { HttpException, HttpStatus } from "@nestjs/common";
import { serializeLogError } from "../../logging";
import { DeckPptxUseCases } from "./deck-pptx.use-cases";

export class DeckExportUseCases extends DeckPptxUseCases {
  async createExportJob(projectId: string, body: unknown) {
    if (!this.jobsService) {
      throw new HttpException(
        "Deck export job service is unavailable",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const request = deckExportRequestSchema.parse(body ?? {});
    const { deck } = await this.getDeck(projectId);
    if (request.format === "pptx") {
      const syncState = await this.readOoxmlSyncState(projectId, deck);
      if (
        syncState.status !== "not-applicable" &&
        syncState.status !== "synced"
      ) {
        throw new HttpException(
          {
            code: "DECK_EXPORT_OOXML_SYNC_NOT_READY",
            message:
              "최신 편집 내용의 PPTX 동기화가 완료되지 않았습니다. 동기화 재시도 후 다시 내보내세요.",
            ooxmlSyncState: syncState,
          },
          HttpStatus.CONFLICT,
        );
      }
    }
    if (request.presentationSessionId) {
      await this.assertExportSession(
        projectId,
        deck.deckId,
        request.presentationSessionId,
      );
    }
    const queuedJob = await this.jobsService.create({
      projectId,
      type: "deck-export",
      payload: {
        deckId: deck.deckId,
        format: request.format,
        ...(request.presentationSessionId
          ? { presentationSessionId: request.presentationSessionId }
          : {}),
      },
    });

    try {
      const config = loadOrbitConfig(process.env, { service: "api" });
      await this.enqueueDeckExport({
        driver: config.JOB_QUEUE_DRIVER,
        redisUrl: config.REDIS_URL,
        jobId: queuedJob.jobId,
        projectId,
        deck,
        format: request.format,
        ...(request.presentationSessionId
          ? { presentationSessionId: request.presentationSessionId }
          : {}),
      });
      this.logger?.info(
        {
          event: "deck_export.enqueued",
          jobId: queuedJob.jobId,
          projectId,
          deckId: deck.deckId,
          format: request.format,
          presentationSessionId: request.presentationSessionId,
        },
        "Deck export job enqueued.",
      );
    } catch (error) {
      const publicMessage = "Deck export queue is unavailable.";
      const failedJobPatch = {
        status: "failed",
        progress: 0,
        message: publicMessage,
        error: {
          code: "DECK_EXPORT_ENQUEUE_FAILED",
          message: publicMessage,
          retryable: true,
        },
      } as const;
      const updatedJob = await this.jobsService.update(
        queuedJob.jobId,
        failedJobPatch,
      );
      const failedJob = jobSchema.parse(
        updatedJob ?? { ...queuedJob, ...failedJobPatch },
      );
      this.logger?.error(
        {
          event: "deck_export.enqueue_failed",
          jobId: queuedJob.jobId,
          projectId,
          deckId: deck.deckId,
          format: request.format,
          presentationSessionId: request.presentationSessionId,
          error: serializeLogError(error),
        },
        "Deck export job enqueue failed.",
      );
      throw new HttpException(
        deckExportEnqueueErrorSchema.parse({
          code: "DECK_EXPORT_ENQUEUE_FAILED",
          message: publicMessage,
          job: failedJob,
        }),
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { job: jobSchema.parse(queuedJob) };
  }
}
