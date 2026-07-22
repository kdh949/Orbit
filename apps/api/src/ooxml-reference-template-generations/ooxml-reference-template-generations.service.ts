import { loadOrbitConfig } from "@orbit/config";
import type { EnqueueOoxmlReferenceTemplateGenerationJobInput } from "@orbit/job-queue";
import {
  jobSchema,
  ooxmlReferenceTemplateGenerationRequestSchema,
  type OoxmlReferenceTemplateGenerationRequest,
} from "@orbit/shared";
import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { z } from "zod";
import { parseRequest } from "../common/zod-request";
import { JobsService } from "../jobs/jobs.service";
import { ProjectsService } from "../projects/projects.service";

export const OOXML_REFERENCE_TEMPLATE_GENERATION_ENQUEUE_JOB =
  "OOXML_REFERENCE_TEMPLATE_GENERATION_ENQUEUE_JOB";

export type OoxmlReferenceTemplateGenerationEnqueueJob = (
  input: EnqueueOoxmlReferenceTemplateGenerationJobInput,
) => Promise<void>;

const createGenerationResponseSchema = z
  .object({
    job: jobSchema,
  })
  .strict();

const enqueueFailureCode = "OOXML_REFERENCE_ENQUEUE_FAILED";

@Injectable()
export class OoxmlReferenceTemplateGenerationsService {
  constructor(
    private readonly jobsService: JobsService,
    private readonly projectsService: ProjectsService,
    @Inject(OOXML_REFERENCE_TEMPLATE_GENERATION_ENQUEUE_JOB)
    private readonly enqueueGeneration: OoxmlReferenceTemplateGenerationEnqueueJob,
    @InjectPinoLogger(OoxmlReferenceTemplateGenerationsService.name)
    private readonly logger: PinoLogger,
  ) {}

  async createGeneration(projectId: string, body: unknown) {
    await this.projectsService.getAccessibleProject(projectId);
    const request = parseRequest(
      ooxmlReferenceTemplateGenerationRequestSchema,
      body,
    );
    const selection = requireUserTemplateSelection(request);
    const queuedJob = await this.jobsService.create({
      projectId,
      type: "ooxml-reference-template-generation",
      payload: { request },
    });

    try {
      const config = loadOrbitConfig(process.env, { service: "api" });
      await this.enqueueGeneration({
        driver: config.JOB_QUEUE_DRIVER,
        redisUrl: config.REDIS_URL,
        jobId: queuedJob.jobId,
        projectId,
        request,
      });
      this.logger.info(
        {
          event: "ooxml-reference-template.job.enqueued",
          jobId: queuedJob.jobId,
          projectId,
          templateId: selection.templateId,
          templateVersion: selection.version,
        },
        "OOXML reference template generation job enqueued.",
      );
    } catch (error) {
      await this.jobsService.update(queuedJob.jobId, {
        status: "failed",
        progress: 0,
        message: "OOXML reference template generation enqueue failed.",
        error: {
          code: enqueueFailureCode,
          message: "OOXML reference template generation could not be queued.",
        },
      });
      this.logger.error(
        {
          event: "ooxml-reference-template.job.failed",
          jobId: queuedJob.jobId,
          projectId,
          templateId: selection.templateId,
          templateVersion: selection.version,
          issueCode: enqueueFailureCode,
        },
        "OOXML reference template generation enqueue failed.",
      );
      throw new ServiceUnavailableException(
        "OOXML reference template generation could not be queued.",
      );
    }

    return createGenerationResponseSchema.parse({ job: queuedJob });
  }
}

function requireUserTemplateSelection(
  request: OoxmlReferenceTemplateGenerationRequest,
) {
  if (request.templateSelection.mode !== "user") {
    throw new BadRequestException(
      "Automatic OOXML reference template selection is not enabled.",
    );
  }
  return request.templateSelection;
}
