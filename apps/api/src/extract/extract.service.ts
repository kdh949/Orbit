import {
  type EnqueueReferenceExtractJobInput
} from "@orbit/job-queue";
import { loadOrbitConfig } from "@orbit/config";
import { jobSchema } from "@orbit/shared/jobs";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { z } from "zod";
import { JobsService } from "../jobs/jobs.service";
import { serializeLogError } from "../logging";

interface UploadedExtractFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

const extractResponseSchema = z.object({
  files: z.array(z.record(z.unknown())),
  job: jobSchema
});

type ExtractResponse = z.infer<typeof extractResponseSchema>;
export type ReferenceExtractEnqueueJob = (
  input: EnqueueReferenceExtractJobInput
) => Promise<void>;

export const REFERENCE_EXTRACT_ENQUEUE_JOB =
  "REFERENCE_EXTRACT_ENQUEUE_JOB";

@Injectable()
export class ExtractService {
  private readonly config = loadOrbitConfig(process.env, { service: "api" });

  constructor(
    private readonly jobsService: JobsService,
    @Inject(REFERENCE_EXTRACT_ENQUEUE_JOB)
    private readonly enqueueJob: ReferenceExtractEnqueueJob,
    @InjectPinoLogger(ExtractService.name)
    private readonly logger: PinoLogger
  ) {}

  async extract(
    files: UploadedExtractFile[],
    projectId: string,
    fileIds: string[] = []
  ): Promise<ExtractResponse> {
    const payload = {
      files: files.map((file, index) => ({
        fileId: fileIds[index]?.trim() || `file_${randomUUID()}`,
        originalName: file.originalname || "upload",
        mimeType: file.mimetype || "application/octet-stream",
        contentBase64: file.buffer.toString("base64")
      }))
    };

    // ponytail: DB payload keeps MVP simple; move upload bytes to object storage when size matters.
    const queuedJob = await this.jobsService.create({
      projectId,
      type: "reference-extract",
      payload
    });

    try {
      await this.enqueueJob({
        driver: this.config.JOB_QUEUE_DRIVER,
        redisUrl: this.config.REDIS_URL,
        jobId: queuedJob.jobId,
        projectId,
        files: payload.files
      });
      this.logger.info(
        {
          event: "job.enqueued",
          jobId: queuedJob.jobId,
          jobType: queuedJob.type,
          projectId,
          driver: this.config.JOB_QUEUE_DRIVER,
          fileCount: payload.files.length
        },
        "Reference extraction job enqueued."
      );
    } catch (error) {
      await this.jobsService.update(queuedJob.jobId, {
        status: "failed",
        progress: 0,
        message: "Reference extraction enqueue failed.",
        error: {
          code: "REFERENCE_EXTRACT_ENQUEUE_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Reference extraction enqueue failed."
          }
      });
      this.logger.error(
        {
          event: "job.enqueue_failed",
          jobId: queuedJob.jobId,
          jobType: queuedJob.type,
          projectId,
          driver: this.config.JOB_QUEUE_DRIVER,
          fileCount: payload.files.length,
          error: serializeLogError(error)
        },
        "Reference extraction enqueue failed."
      );
      throw error;
    }

    return extractResponseSchema.parse({
      files: [],
      job: queuedJob
    });
  }
}
