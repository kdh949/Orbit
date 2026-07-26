import {
  enqueuePptxOoxmlGenerationJob,
  type EnqueuePptxOoxmlGenerationJobInput
} from "@orbit/job-queue";
import { pptxOoxmlGenerationRequestSchema } from "@orbit/shared/deck";
import { jobSchema } from "@orbit/shared/jobs";
import { loadOrbitConfig } from "@orbit/config";
import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { z } from "zod";
import { parseRequest } from "../common/zod-request";
import { FilesService } from "../files/files.service";
import { JobsService } from "../jobs/jobs.service";
import { ProjectsService } from "../projects/projects.service";

const createPptxOoxmlGenerationResponseSchema = z.object({
  job: jobSchema
});

const pptxMimeType =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

type CreatePptxOoxmlGenerationResponse = z.infer<
  typeof createPptxOoxmlGenerationResponseSchema
>;

@Injectable()
export class PptxOoxmlGenerationsService {
  private readonly config = loadOrbitConfig(process.env, { service: "api" });

  constructor(
    private readonly jobsService: JobsService,
    private readonly projectsService: ProjectsService,
    private readonly filesService: FilesService,
    @Optional()
    private readonly enqueueJob: (
      input: EnqueuePptxOoxmlGenerationJobInput
    ) => Promise<void> = enqueuePptxOoxmlGenerationJob
  ) {}

  async createGeneration(
    projectId: string,
    body: unknown
  ): Promise<CreatePptxOoxmlGenerationResponse> {
    await this.projectsService.getAccessibleProject(projectId);

    const request = parseRequest(pptxOoxmlGenerationRequestSchema, body);
    const asset = await this.filesService.getUploadedAsset(
      projectId,
      request.fileId,
      "pptx-import"
    );

    if (asset.mimeType !== pptxMimeType) {
      throw new BadRequestException("PPTX OOXML generation requires an uploaded PPTX file.");
    }

    const queuedJob = await this.jobsService.create({
      projectId,
      type: "pptx-ooxml-generation",
      payload: { request }
    });

    try {
      await this.enqueueJob({
        driver: this.config.JOB_QUEUE_DRIVER,
        redisUrl: this.config.REDIS_URL,
        jobId: queuedJob.jobId,
        projectId,
        request
      });
    } catch (error) {
      await this.jobsService.update(queuedJob.jobId, {
        status: "failed",
        progress: 0,
        message: "PPTX OOXML generation enqueue failed.",
        error: {
          code: "PPTX_OOXML_GENERATION_ENQUEUE_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "PPTX OOXML generation enqueue failed."
        }
      });
      throw error;
    }

    return createPptxOoxmlGenerationResponseSchema.parse({ job: queuedJob });
  }
}
