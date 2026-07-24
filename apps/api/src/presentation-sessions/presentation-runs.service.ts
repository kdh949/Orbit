import { loadOrbitConfig } from "@orbit/config";
import type { EnqueuePresentationAnalysisJobInput } from "@orbit/job-queue";
import {
  completePresentationAudioRequestSchema,
  completePresentationAudioResponseSchema,
  createAssetUploadUrlRequestSchema,
  createPresentationAudioUploadRequestSchema,
  createPresentationAudioUploadResponseSchema,
  createPresentationRunRequestSchema,
  createPresentationRunResponseSchema,
  getPresentationRunReportResponseSchema,
  getPresentationRunResponseSchema,
  listPresentationRunsResponseSchema,
  type PresentationRun,
} from "@orbit/shared";
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { IsNull, Not, QueryFailedError, Repository } from "typeorm";

import { parseRequest } from "../common/zod-request";
import { ActivityResultsService } from "../activities/activity-results.service";
import { DecksService } from "../decks/decks.service";
import { FilesService } from "../files/files.service";
import { JobsService } from "../jobs/jobs.service";
import { serializeLogError } from "../logging";
import { PresentationRunEntity } from "./presentation-run.entity";
import { PresentationSessionsService } from "./presentation-sessions.service";

export type PresentationAnalysisEnqueueJob = (
  input: EnqueuePresentationAnalysisJobInput,
) => Promise<void>;

export const PRESENTATION_ANALYSIS_ENQUEUE_JOB =
  "PRESENTATION_ANALYSIS_ENQUEUE_JOB";

const presentationAudioRetentionMs = 14 * 24 * 60 * 60 * 1000;

@Injectable()
export class PresentationRunsService {
  private readonly config = loadOrbitConfig(process.env, { service: "api" });
  private readonly presentationAudioUploadRequestSchema =
    createAssetUploadUrlRequestSchema({
      maxRehearsalAudioUploadSizeBytes: this.config.REHEARSAL_AUDIO_MAX_BYTES,
      allowedPrivatePurpose: "presentation-audio",
    });

  constructor(
    @InjectRepository(PresentationRunEntity)
    private readonly runs: Repository<PresentationRunEntity>,
    private readonly sessions: PresentationSessionsService,
    private readonly decks: DecksService,
    private readonly files: FilesService,
    private readonly jobs: JobsService,
    @Inject(forwardRef(() => ActivityResultsService))
    private readonly activityResults: ActivityResultsService,
    @Inject(PRESENTATION_ANALYSIS_ENQUEUE_JOB)
    private readonly enqueueAnalysis: PresentationAnalysisEnqueueJob,
    @InjectPinoLogger(PresentationRunsService.name)
    private readonly logger: PinoLogger,
  ) {}

  async createRun(projectId: string, sessionId: string, body: unknown) {
    const request = parseRequest(createPresentationRunRequestSchema, body);
    const session = await this.sessions.getSessionForPresenter(
      projectId,
      sessionId,
    );
    if (session.sessionPurpose !== "presentation") {
      throw new BadRequestException(
        "Presentation runs cannot be created for rehearsal sessions.",
      );
    }
    if (session.deckVersion !== request.expectedDeckVersion) {
      throw new ConflictException({
        code: "PRESENTATION_DECK_VERSION_MISMATCH",
        message:
          "The expected deck version does not match the presentation session.",
        expectedDeckVersion: request.expectedDeckVersion,
        actualDeckVersion: session.deckVersion,
      });
    }

    const existing = await this.runs.findOne({ where: { sessionId } });
    if (existing) {
      if (
        existing.status === "created" &&
        !existing.audioFileId &&
        !existing.jobId &&
        existing.recordingMode !== request.recordingMode
      ) {
        existing.recordingMode = request.recordingMode;
        existing.updatedAt = new Date();
        await this.runs.save(existing);
      }
      return createPresentationRunResponseSchema.parse({
        run: toPresentationRun(existing),
      });
    }

    const deckResponse = await this.decks.getDeck(projectId);
    if (
      deckResponse.deck.deckId !== session.deckId ||
      deckResponse.deck.version !== session.deckVersion
    ) {
      throw new ConflictException({
        code: "PRESENTATION_DECK_CHANGED",
        message: "The deck changed after the presentation session was created.",
      });
    }

    const now = new Date();
    const run = this.runs.create({
      runId: `presentation_run_${randomUUID()}`,
      projectId,
      sessionId,
      deckId: session.deckId,
      deckVersion: session.deckVersion,
      deckSnapshot: deckResponse.deck,
      recordingMode: request.recordingMode,
      audioFileId: null,
      jobId: null,
      status: "created",
      error: null,
      voiceReport: null,
      detailedReport: null,
      rawAudioDeletedAt: null,
      rawAudioDeleteDeadlineAt: null,
      startedAt: now,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    try {
      const saved = await this.runs.save(run);
      this.logger.info(
        {
          event: "presentation_run.created",
          projectId,
          presentationSessionId: sessionId,
          presentationRunId: saved.runId,
          recordingMode: saved.recordingMode,
        },
        "Presentation run created.",
      );
      return createPresentationRunResponseSchema.parse({
        run: toPresentationRun(saved),
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const concurrent = await this.runs.findOne({ where: { sessionId } });
      if (!concurrent) throw error;
      return createPresentationRunResponseSchema.parse({
        run: toPresentationRun(concurrent),
      });
    }
  }

  async createAudioUpload(
    projectId: string,
    sessionId: string,
    runId: string,
    body: unknown,
  ) {
    const request = parseRequest(
      createPresentationAudioUploadRequestSchema,
      body,
    );
    const run = await this.getRunEntity(projectId, sessionId, runId);
    if (run.recordingMode !== "microphone") {
      throw new BadRequestException(
        "Presentation run was started without microphone recording.",
      );
    }
    if (!["created", "uploading"].includes(run.status)) {
      throw new BadRequestException(
        "Presentation run is not accepting audio uploads.",
      );
    }

    const input = parseRequest(this.presentationAudioUploadRequestSchema, {
      ...request,
      purpose: "presentation-audio",
    });
    const upload = await this.files.createPresentationAudioUploadUrl(
      projectId,
      input,
      { runId: run.runId, createdAt: run.createdAt },
    );
    run.audioFileId = upload.fileId;
    run.status = "uploading";
    run.error = null;
    run.updatedAt = new Date();
    const saved = await this.runs.save(run);
    return createPresentationAudioUploadResponseSchema.parse({
      run: toPresentationRun(saved),
      upload,
    });
  }

  async completeAudio(
    projectId: string,
    sessionId: string,
    runId: string,
    body: unknown,
  ) {
    const request = parseRequest(completePresentationAudioRequestSchema, body);
    const run = await this.getRunEntity(projectId, sessionId, runId);

    if ("withoutAudio" in request) {
      if (run.recordingMode !== "none") {
        throw new BadRequestException(
          "Presentation run expects a microphone recording.",
        );
      }
      if (run.status === "succeeded") {
        return completePresentationAudioResponseSchema.parse({
          run: toPresentationRun(run),
          job: null,
        });
      }
      if (run.status !== "created") {
        throw new BadRequestException("Presentation run cannot be completed.");
      }
      run.status = "succeeded";
      run.endedAt = new Date();
      run.updatedAt = run.endedAt;
      const saved = await this.runs.save(run);
      return completePresentationAudioResponseSchema.parse({
        run: toPresentationRun(saved),
        job: null,
      });
    }

    if (
      ["processing", "succeeded"].includes(run.status) &&
      run.audioFileId === request.fileId
    ) {
      return completePresentationAudioResponseSchema.parse({
        run: toPresentationRun(run),
        job: run.jobId ? await this.jobs.get(run.jobId) : null,
      });
    }
    if (run.status !== "uploading" || run.audioFileId !== request.fileId) {
      throw new BadRequestException(
        "Presentation run has no matching pending audio upload.",
      );
    }

    await this.files.completeUpload(
      projectId,
      { fileId: request.fileId },
      "presentation-audio",
    );
    await this.files.getUploadedAsset(
      projectId,
      request.fileId,
      "presentation-audio",
    );

    const claimed = await this.runs.update(
      { runId, projectId, sessionId, status: "uploading" },
      {
        status: "processing",
        rawAudioDeleteDeadlineAt: new Date(
          Date.now() + presentationAudioRetentionMs,
        ),
        endedAt: new Date(),
        updatedAt: new Date(),
      },
    );
    if (!claimed.affected) {
      throw new ConflictException("Presentation audio was already completed.");
    }

    const processingRun = await this.getRunEntity(projectId, sessionId, runId);
    const job = await this.jobs.create({
      projectId,
      type: "presentation-analysis",
      payload: {
        sessionId,
        runId,
        deckId: run.deckId,
        audioFileId: request.fileId,
        liveTranscript: request.liveTranscript,
        slideTranscriptSnapshots: request.slideTranscriptSnapshots,
      },
    });
    processingRun.jobId = job.jobId;
    processingRun.updatedAt = new Date();
    await this.runs.save(processingRun);

    try {
      await this.enqueueAnalysis({
        driver: this.config.JOB_QUEUE_DRIVER,
        redisUrl: this.config.REDIS_URL,
        jobId: job.jobId,
        projectId,
        sessionId,
        runId,
        deckId: run.deckId,
        audioFileId: request.fileId,
        liveTranscript: request.liveTranscript,
        slideTranscriptSnapshots: request.slideTranscriptSnapshots,
      });
      this.logger.info(
        {
          event: "job.enqueued",
          jobId: job.jobId,
          jobType: job.type,
          projectId,
          presentationSessionId: sessionId,
          presentationRunId: runId,
        },
        "Presentation analysis job enqueued.",
      );
      return completePresentationAudioResponseSchema.parse({
        run: toPresentationRun(processingRun),
        job,
      });
    } catch (error) {
      const failure = {
        code: "PRESENTATION_ANALYSIS_ENQUEUE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Presentation analysis enqueue failed.",
      };
      processingRun.status = "failed";
      processingRun.error = failure;
      processingRun.updatedAt = new Date();
      await this.runs.save(processingRun);
      await this.jobs.update(job.jobId, {
        status: "failed",
        progress: 0,
        message: "Presentation analysis enqueue failed.",
        error: failure,
      });
      this.logger.error(
        {
          event: "job.enqueue_failed",
          jobId: job.jobId,
          jobType: job.type,
          projectId,
          presentationSessionId: sessionId,
          presentationRunId: runId,
          error: serializeLogError(error),
        },
        "Presentation analysis enqueue failed.",
      );
      throw error;
    }
  }

  async getRun(projectId: string, sessionId: string, runId: string) {
    const run = await this.getRunEntity(projectId, sessionId, runId);
    return getPresentationRunResponseSchema.parse({
      run: toPresentationRun(run),
    });
  }

  async getSessionRun(projectId: string, sessionId: string) {
    await this.sessions.getSessionForPresenter(projectId, sessionId);
    const run = await this.runs.findOne({ where: { projectId, sessionId } });
    if (!run) {
      throw new NotFoundException(
        `Presentation run not found for session: ${sessionId}`,
      );
    }
    return getPresentationRunResponseSchema.parse({
      run: toPresentationRun(run),
    });
  }

  async listProjectRuns(
    projectId: string,
    query: { page?: string; pageSize?: string },
  ) {
    const page = parsePositiveInteger(query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(query.pageSize, 50), 100);
    const [runs, total] = await this.runs.findAndCount({
      where: { projectId, endedAt: Not(IsNull()) },
      order: { createdAt: "DESC" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return listPresentationRunsResponseSchema.parse({
      runs: runs.map(toPresentationRun),
      total,
      page,
      pageSize,
    });
  }

  async retryAnalysis(projectId: string, sessionId: string, runId: string) {
    const run = await this.getRunEntity(projectId, sessionId, runId);
    if (
      run.status !== "failed" ||
      run.recordingMode !== "microphone" ||
      !run.audioFileId ||
      run.rawAudioDeletedAt
    ) {
      throw new BadRequestException(
        "Presentation analysis cannot be retried for this run.",
      );
    }

    await this.files.getUploadedAsset(
      projectId,
      run.audioFileId,
      "presentation-audio",
    );
    const claimed = await this.runs.update(
      { runId, projectId, sessionId, status: "failed" },
      { status: "processing", error: null, updatedAt: new Date() },
    );
    if (!claimed.affected) {
      throw new ConflictException(
        "Presentation analysis retry was already requested.",
      );
    }

    const processingRun = await this.getRunEntity(projectId, sessionId, runId);
    const job = await this.jobs.create({
      projectId,
      type: "presentation-analysis",
      payload: {
        sessionId,
        runId,
        deckId: run.deckId,
        audioFileId: run.audioFileId,
        liveTranscript: null,
        slideTranscriptSnapshots: [],
      },
    });
    processingRun.jobId = job.jobId;
    processingRun.updatedAt = new Date();
    await this.runs.save(processingRun);

    try {
      await this.enqueueAnalysis({
        driver: this.config.JOB_QUEUE_DRIVER,
        redisUrl: this.config.REDIS_URL,
        jobId: job.jobId,
        projectId,
        sessionId,
        runId,
        deckId: run.deckId,
        audioFileId: run.audioFileId,
        liveTranscript: null,
        slideTranscriptSnapshots: [],
      });
      this.logger.info(
        {
          event: "job.enqueued",
          jobId: job.jobId,
          jobType: job.type,
          projectId,
          presentationSessionId: sessionId,
          presentationRunId: runId,
          retry: true,
        },
        "Presentation analysis retry job enqueued.",
      );
      return completePresentationAudioResponseSchema.parse({
        run: toPresentationRun(processingRun),
        job,
      });
    } catch (error) {
      const failure = {
        code: "PRESENTATION_ANALYSIS_ENQUEUE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Presentation analysis enqueue failed.",
      };
      processingRun.status = "failed";
      processingRun.error = failure;
      processingRun.updatedAt = new Date();
      await this.runs.save(processingRun);
      await this.jobs.update(job.jobId, {
        status: "failed",
        progress: 0,
        message: "Presentation analysis enqueue failed.",
        error: failure,
      });
      this.logger.error(
        {
          event: "job.enqueue_failed",
          jobId: job.jobId,
          jobType: job.type,
          projectId,
          presentationSessionId: sessionId,
          presentationRunId: runId,
          retry: true,
          error: serializeLogError(error),
        },
        "Presentation analysis retry enqueue failed.",
      );
      throw error;
    }
  }

  async getReport(projectId: string, sessionId: string, runId: string) {
    const run = await this.getRunEntity(projectId, sessionId, runId);
    const audienceArchive = await this.activityResults.getSessionArchive(
      projectId,
      sessionId,
    );
    return getPresentationRunReportResponseSchema.parse({
      report: {
        runId,
        projectId,
        sessionId,
        analysisStatus: run.status,
        recordingMode: run.recordingMode,
        voiceReport: run.voiceReport,
        detailedReport: run.detailedReport,
        deck: run.deckSnapshot,
        audienceSummary: { activities: audienceArchive.activities },
      },
    });
  }

  private async getRunEntity(
    projectId: string,
    sessionId: string,
    runId: string,
  ) {
    const run = await this.runs.findOne({
      where: { projectId, sessionId, runId },
    });
    if (!run) {
      throw new NotFoundException(`Presentation run not found: ${runId}`);
    }
    return run;
  }
}

export function toPresentationRun(run: PresentationRunEntity): PresentationRun {
  return {
    runId: run.runId,
    projectId: run.projectId,
    sessionId: run.sessionId,
    deckId: run.deckId,
    deckVersion: run.deckVersion,
    recordingMode: run.recordingMode,
    audioFileId: run.audioFileId,
    jobId: run.jobId,
    status: run.status,
    error: run.error,
    voiceReport: run.voiceReport,
    detailedReport: run.detailedReport,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    typeof (error as { driverError?: { code?: unknown } }).driverError?.code ===
      "string" &&
    (error as { driverError: { code: string } }).driverError.code === "23505"
  );
}
