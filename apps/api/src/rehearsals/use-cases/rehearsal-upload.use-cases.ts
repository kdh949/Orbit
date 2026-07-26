import {
  completeRehearsalAudioUploadRequestSchema,
  completeRehearsalAudioUploadResponseSchema,
  createRehearsalAudioUploadUrlRequestSchema,
  createRehearsalAudioUploadUrlResponseSchema,
} from "@orbit/shared/rehearsals";
import { BadRequestException } from "@nestjs/common";
import { parseRequest } from "../../common/zod-request";
import { serializeLogError } from "../../logging";
import { toRehearsalRun } from "../mappers/rehearsal-run.mapper";
import { RehearsalCreationUseCases } from "./rehearsal-creation.use-cases";
import { rehearsalAudioRetentionMs } from "./rehearsal-use-cases.base";

export class RehearsalUploadUseCases extends RehearsalCreationUseCases {
  async createAudioUploadUrl(runId: string, body: unknown) {
    const request = parseRequest(
      createRehearsalAudioUploadUrlRequestSchema,
      body,
    );
    const run = await this.getRunEntity(runId);

    if (!["created", "uploading"].includes(run.status)) {
      throw new BadRequestException("Rehearsal run is not accepting uploads.");
    }

    const upload = await this.filesService.createRehearsalAudioUploadUrl(
      run.projectId,
      parseRequest(this.rehearsalAudioUploadRequestSchema, {
        ...request,
        purpose: "rehearsal-audio",
      }),
      { runId: run.runId, createdAt: run.createdAt },
    );

    run.audioFileId = upload.fileId;
    run.status = "uploading";
    run.error = null;
    run.updatedAt = new Date();
    const savedRun = await this.rehearsalRuns.save(run);

    return createRehearsalAudioUploadUrlResponseSchema.parse({
      run: toRehearsalRun(savedRun),
      upload,
    });
  }

  async completeAudioUpload(runId: string, body: unknown) {
    const request = parseRequest(
      completeRehearsalAudioUploadRequestSchema,
      body,
    );
    const run = await this.getRunEntity(runId);

    if (run.status !== "uploading") {
      throw new BadRequestException(
        "Rehearsal run has no pending audio upload.",
      );
    }

    if (run.audioFileId !== request.fileId) {
      throw new BadRequestException("fileId does not match the rehearsal run.");
    }

    await this.filesService.completeUpload(
      run.projectId,
      {
        fileId: request.fileId,
      },
      "rehearsal-audio",
    );
    await this.filesService.getUploadedAsset(
      run.projectId,
      request.fileId,
      "rehearsal-audio",
    );

    const rawAudioDeleteDeadlineAt = new Date(
      Date.now() + rehearsalAudioRetentionMs,
    );
    const claimedRun = await this.claimAudioUpload(
      run,
      request.fileId,
      rawAudioDeleteDeadlineAt,
    );
    if (!claimedRun) {
      throw new BadRequestException(
        "Rehearsal run has no pending audio upload.",
      );
    }

    const queuedJob = await this.jobsService.create({
      projectId: run.projectId,
      type: "rehearsal-stt",
      payload: {
        audioFileId: request.fileId,
        deckId: run.deckId,
        runId: run.runId,
      },
    });

    claimedRun.jobId = queuedJob.jobId;
    claimedRun.updatedAt = new Date();
    await this.rehearsalRuns.save(claimedRun);

    try {
      await this.enqueueJob({
        driver: this.config.JOB_QUEUE_DRIVER,
        redisUrl: this.config.REDIS_URL,
        jobId: queuedJob.jobId,
        projectId: run.projectId,
        runId: run.runId,
        deckId: run.deckId,
        audioFileId: request.fileId,
        liveTranscript: request.liveTranscript,
        slideTranscriptSnapshots: request.slideTranscriptSnapshots,
      });

      this.logger.info(
        {
          event: "job.enqueued",
          jobId: queuedJob.jobId,
          jobType: queuedJob.type,
          projectId: claimedRun.projectId,
          runId: claimedRun.runId,
          deckId: claimedRun.deckId,
          audioFileId: request.fileId,
          driver: this.config.JOB_QUEUE_DRIVER,
        },
        "Rehearsal STT job enqueued.",
      );

      return completeRehearsalAudioUploadResponseSchema.parse({
        run: toRehearsalRun(claimedRun),
        job: queuedJob,
      });
    } catch (error) {
      const failure = await this.cleanupAfterEnqueueFailure(
        claimedRun,
        request.fileId,
        error,
      );
      await this.jobsService.update(queuedJob.jobId, {
        status: "failed",
        progress: 0,
        message: failure.jobMessage,
        error: failure.error,
      });
      claimedRun.status = "failed";
      claimedRun.error = failure.error;
      claimedRun.rawAudioDeletedAt = failure.rawAudioDeletedAt;
      claimedRun.updatedAt = new Date();
      await this.rehearsalRuns.save(claimedRun);
      this.logger.error(
        {
          event: "job.enqueue_failed",
          jobId: queuedJob.jobId,
          jobType: queuedJob.type,
          projectId: claimedRun.projectId,
          runId: claimedRun.runId,
          deckId: claimedRun.deckId,
          audioFileId: request.fileId,
          driver: this.config.JOB_QUEUE_DRIVER,
          cleanupError: failure.cleanupError
            ? serializeLogError(failure.cleanupError)
            : undefined,
          error: serializeLogError(error),
        },
        "Rehearsal STT enqueue failed.",
      );
      throw error;
    }
  }
}
