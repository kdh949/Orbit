import {
  enqueueGenerateDeckJob,
  retryAiDeckStagedCoordinatorJob,
  type EnqueueGenerateDeckJobInput
} from "@orbit/job-queue";
import {
  deckColorCustomizationRequestSchema,
  deckColorCustomizationResponseSchema,
  deckColorOptionRequestSchema,
  deckColorOptionsResponseSchema,
  generateDeckRequestSchema,
  generateDeckStartResponseSchema,
  generateDeckStoredJobPayloadSchema,
  type DeckColorCustomizationResponse,
  type DeckColorOptionsResponse,
} from "@orbit/shared/deck";
import { loadOrbitConfig } from "@orbit/config";
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Optional,
  ServiceUnavailableException
} from "@nestjs/common";
import { parseRequest } from "../common/zod-request";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { FilesService } from "../files/files.service";
import { JobsService } from "../jobs/jobs.service";
import { ProjectsService } from "../projects/projects.service";
import { SavedDesignPacksService } from "../saved-design-packs/saved-design-packs.service";
import { PresentationBriefsService } from "../presentation-briefs/presentation-briefs.service";
import {
  demoDeckCacheUnavailable,
  isDemoDeckCacheRequest,
  readDemoDeckCache,
} from "./demo-deck-cache";

type GenerateDeckJobResponse = ReturnType<
  typeof generateDeckStartResponseSchema.parse
>;
@Injectable()
export class GenerateDeckService {
  private readonly config = loadOrbitConfig(process.env, { service: "api" });

  constructor(
    private readonly jobsService: JobsService,
    private readonly projectsService: ProjectsService,
    @Optional()
    private readonly enqueueJob: (
      input: EnqueueGenerateDeckJobInput
    ) => Promise<void> = enqueueGenerateDeckJob,
    @Optional()
    private readonly filesService?: FilesService,
    @Optional()
    private readonly savedDesignPacksService?: SavedDesignPacksService,
    @Optional()
    private readonly presentationBriefs?: PresentationBriefsService,
    @Optional()
    @InjectDataSource()
    private readonly dataSource?: DataSource,
  ) {
    if (this.config.AI_DECK_EXECUTION_MODE === "sqs") {
      throw new Error("AI Deck SQS transport is not implemented yet.");
    }
  }

  async createJob(
    projectId: string,
    body: unknown,
    userId?: string
  ): Promise<GenerateDeckJobResponse> {
    await this.projectsService.getAccessibleProject(projectId);

    const parsedRequest = parseRequest(generateDeckRequestSchema, body);
    const resolved =
      this.savedDesignPacksService && userId
        ? await this.savedDesignPacksService.resolveGenerationRequest(
            parsedRequest,
            body,
            userId
          )
        : { request: parsedRequest };
    const request = resolved.request;
    await this.assertCoachingContext(projectId, request.coachingContext);
    await this.assertOfficialAssets(projectId, request.officialAssetFileIds ?? []);
    const storedPayload = generateDeckStoredJobPayloadSchema.parse({
      request,
      ...(resolved.snapshot ? { designPackSnapshot: resolved.snapshot } : {}),
      ...(userId
        ? {
            requestedByUserId: userId,
            imageAssetScope: {
              userId
            }
          }
        : {}),
    });
    const useDemoCache = isDemoDeckCacheRequest(
      this.config,
      storedPayload.requestedByUserId,
      storedPayload.request.topic,
    );
    if (useDemoCache) {
      const sourceProjectId = this.config.DEMO_AI_DECK_SOURCE_PROJECT_ID;
      if (
        !sourceProjectId ||
        sourceProjectId === projectId ||
        !userId ||
        !this.dataSource
      ) {
        throw demoDeckCacheUnavailable();
      }
      try {
        await this.projectsService.assertCanReadProject(sourceProjectId, userId);
        await readDemoDeckCache(this.dataSource, sourceProjectId, userId);
      } catch {
        throw demoDeckCacheUnavailable();
      }
    }
    const queuedJob = await this.jobsService.create({
      projectId,
      type: "ai-deck-generation",
      payload: storedPayload
    });

    if (useDemoCache) {
      return generateDeckStartResponseSchema.parse({ job: queuedJob });
    }

    try {
      await this.enqueueJob({
        driver: this.config.JOB_QUEUE_DRIVER,
        executionMode: this.config.AI_DECK_EXECUTION_MODE,
        redisUrl: this.config.REDIS_URL,
        jobId: queuedJob.jobId,
        projectId,
        ...storedPayload
      });
    } catch (error) {
      await this.jobsService.update(queuedJob.jobId, {
        status: "failed",
        progress: 0,
        message: "AI deck generation enqueue failed.",
        error: {
          code: "GENERATE_DECK_ENQUEUE_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "AI deck generation enqueue failed."
        }
      });
      throw error;
    }

    return generateDeckStartResponseSchema.parse({
      job: queuedJob,
    });
  }

  async createColorOptions(body: unknown): Promise<DeckColorOptionsResponse> {
    const request = deckColorOptionRequestSchema.parse(body);
    let response: Response;

    try {
      response = await fetch(
        workerUrl(this.config.PYTHON_WORKER_URL, "/ai/deck-color-options"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(30_000)
        }
      );
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error
          ? error.message
          : "Python worker color option generation unavailable."
      );
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        (await response.text()) || "Python worker color option generation failed."
      );
    }

    try {
      return deckColorOptionsResponseSchema.parse(await response.json());
    } catch (error) {
      throw new InternalServerErrorException(
        error instanceof Error
          ? error.message
          : "Python worker returned invalid color options."
      );
    }
  }

  async customizeColorPalette(
    body: unknown
  ): Promise<DeckColorCustomizationResponse> {
    const request = parseRequest(deckColorCustomizationRequestSchema, body);
    let response: Response;

    try {
      response = await fetch(
        workerUrl(this.config.PYTHON_WORKER_URL, "/ai/deck-color-customization"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(30_000)
        }
      );
    } catch {
      throw new ServiceUnavailableException(
        "AI palette customization is temporarily unavailable."
      );
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        "AI palette customization failed. Keep the selected palette and retry."
      );
    }

    try {
      return deckColorCustomizationResponseSchema.parse(await response.json());
    } catch {
      throw new InternalServerErrorException(
        "Python worker returned an invalid customized palette."
      );
    }
  }

  async retryJob(projectId: string, jobId: string) {
    if (
      this.config.AI_DECK_EXECUTION_MODE !== "bullmq" &&
      this.config.AI_DECK_EXECUTION_MODE !== "pg"
    ) {
      throw new ServiceUnavailableException(
        "AI deck stage retry requires bullmq execution mode."
      );
    }
    const retried = await this.jobsService.retryAiDeckGeneration(projectId, jobId);
    if (
      retried.restartCoordinator &&
      this.config.AI_DECK_EXECUTION_MODE === "bullmq"
    ) {
      try {
        await retryAiDeckStagedCoordinatorJob({
          redisUrl: this.config.REDIS_URL,
          jobId,
          projectId
        });
      } catch (error) {
        await this.jobsService.update(jobId, {
          status: "failed",
          message: "AI deck generation retry enqueue failed.",
          error: {
            code: "AI_DECK_COORDINATOR_RETRY_ENQUEUE_FAILED",
            message: "AI deck staged coordinator retry could not be enqueued.",
            failedStage: "reference-extract-file",
            retryable: true
          }
        });
        throw error;
      }
    }
    return { job: retried.job };
  }

  private async assertOfficialAssets(
    projectId: string,
    officialAssetFileIds: string[]
  ): Promise<void> {
    if (officialAssetFileIds.length === 0) return;
    if (!this.filesService) {
      throw new BadRequestException("Official asset validation is unavailable.");
    }

    for (const fileId of officialAssetFileIds) {
      const asset = await this.filesService.getUploadedAsset(projectId, fileId);
      if (!asset.mimeType.startsWith("image/")) {
        throw new BadRequestException("Official assets must be uploaded image files.");
      }
    }
  }

  private async assertCoachingContext(
    projectId: string,
    context: ReturnType<typeof generateDeckRequestSchema.parse>["coachingContext"]
  ) {
    if (!context) return;
    if (context.briefRef.mode === "generic") {
      if (context.evaluatorLensRef.lensId !== "general-novice") {
        throw new BadRequestException("Generic generation must use the general novice lens.");
      }
      return;
    }
    const brief = await this.presentationBriefs?.getCurrent(projectId);
    if (
      !brief ||
      brief.briefId !== context.briefRef.briefId ||
      brief.revision !== context.briefRef.revision ||
      brief.evaluatorLensRef.lensId !== context.evaluatorLensRef.lensId ||
      brief.evaluatorLensRef.revision !== context.evaluatorLensRef.revision
    ) {
      throw new BadRequestException("Brief generation context is no longer current.");
    }
  }
}

function workerUrl(baseUrl: string, path: string): string {
  return new URL(
    path,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  ).toString();
}
