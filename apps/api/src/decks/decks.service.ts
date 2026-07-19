import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  applyDeckPatch,
  removeLegacyAiGeneratedTitleAnimations,
} from "@orbit/editor-core";
import type { ApplyDeckPatchError } from "@orbit/editor-core";
import { loadOrbitConfig } from "@orbit/config";
import {
  enqueueDeckExportJob,
  enqueuePptxOoxmlSyncJob,
  enqueueSemanticCueExtractionJob,
  enqueueSpeakerNotesSuggestionJob,
  type EnqueueDeckExportJobInput,
  type EnqueuePptxOoxmlSyncJobInput,
  type EnqueueSemanticCueExtractionJobInput,
  type EnqueueSpeakerNotesSuggestionJobInput,
} from "@orbit/job-queue";
import {
  appendDeckPatchAckResponseSchema,
  appendDeckPatchRequestSchema,
  appendDeckPatchResponseSchema,
  deckApiErrorSchema,
  deckExportEnqueueErrorSchema,
  deckExportRequestSchema,
  deckSchema,
  deckSnapshotIdSchema,
  deckSnapshotReasonSchema,
  deckSnapshotSchema,
  getDeckResponseSchema,
  getPptxImportQualityResponseSchema,
  getOoxmlSyncStateResponseSchema,
  jobSchema,
  listDeckSnapshotsResponseSchema,
  putDeckRequestSchema,
  putDeckResponseSchema,
  qualityReportSchema,
  retryOoxmlSyncResponseSchema,
  restoreDeckSnapshotResponseSchema,
  recoverTemplateBlueprintSlideIds,
  createSemanticCueExtractionJobResponseSchema,
  semanticCueExtractionJobPayloadSchema,
  semanticCueExtractionRequestSchema,
  createSpeakerNotesSuggestionJobResponseSchema,
  speakerNotesSuggestionJobPayloadSchema,
  speakerNotesSuggestionRequestSchema,
  templateBlueprintSchema,
} from "@orbit/shared";
import type {
  AppendDeckPatchAckRequest,
  AppendDeckPatchAckResponse,
  AppendDeckPatchFullRequest,
  AppendDeckPatchRequest,
  AppendDeckPatchResponse,
  Deck,
  DeckApiError,
  DeckApiErrorCode,
  DeckChangeRecord,
  DeckElement,
  DeckPatchOperation,
  DeckSnapshot,
  DeckSnapshotReason,
  GetDeckResponse,
  GetPptxImportQualityResponse,
  Job,
  OoxmlSyncState,
  ListDeckSnapshotsResponse,
  PutDeckRequest,
  PutDeckResponse,
  RestoreDeckSnapshotResponse,
  CreateSemanticCueExtractionJobResponse,
  CreateSpeakerNotesSuggestionJobResponse,
  TemplateBlueprint,
} from "@orbit/shared";
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { DataSource, EntityManager } from "typeorm";
import { ZodError } from "zod";
import { JobsService } from "../jobs/jobs.service";
import { serializeLogError } from "../logging";

type DeckRow = {
  project_id: string;
  deck_id: string;
  deck_json: unknown;
  version: number;
  updated_at: Date | string;
};

type DeckSnapshotRow = {
  snapshot_id: string;
  project_id: string;
  deck_id: string;
  deck_json: unknown;
  version: number;
  reason: DeckSnapshotReason;
  created_at: Date | string;
};

type DeckPatchRow = {
  change_id: string;
  project_id: string;
  deck_id: string;
  before_version: number;
  after_version: number;
  source: AppendDeckPatchRequest["patch"]["source"];
  actor_user_id: string | null;
  operations: AppendDeckPatchRequest["patch"]["operations"];
  created_at: Date | string;
};

type TemplateBlueprintRow = {
  template_id: string;
  blueprint_json: unknown;
};

type PptxImportQualityRow = {
  quality_report_json: unknown;
};

type OoxmlTemplateBlueprint = TemplateBlueprintRow & {
  blueprint: TemplateBlueprint;
};

type PptxOoxmlSyncJobInput = {
  deckId: string;
  changeId: string;
  targetDeckVersion: number;
};

type DeckExportEnqueueJob = (input: EnqueueDeckExportJobInput) => Promise<void>;
type QueryExecutor = DataSource | EntityManager;
const deckCheckpointPatchInterval = 20;
export type PptxOoxmlSyncEnqueueJob = (
  input: EnqueuePptxOoxmlSyncJobInput,
) => Promise<void>;
export const PPTX_OOXML_SYNC_ENQUEUE_JOB = "PPTX_OOXML_SYNC_ENQUEUE_JOB";
export const DECK_EXPORT_ENQUEUE_JOB = "DECK_EXPORT_ENQUEUE_JOB";
export type SemanticCueExtractionEnqueueJob = (
  input: EnqueueSemanticCueExtractionJobInput,
) => Promise<void>;
export const SEMANTIC_CUE_EXTRACTION_ENQUEUE_JOB =
  "SEMANTIC_CUE_EXTRACTION_ENQUEUE_JOB";
export type SpeakerNotesSuggestionEnqueueJob = (
  input: EnqueueSpeakerNotesSuggestionJobInput,
) => Promise<void>;
export const SPEAKER_NOTES_SUGGESTION_ENQUEUE_JOB =
  "SPEAKER_NOTES_SUGGESTION_ENQUEUE_JOB";

@Injectable()
export class DecksService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly jobsService?: JobsService,
    @Optional()
    @Inject(PPTX_OOXML_SYNC_ENQUEUE_JOB)
    private readonly enqueueSyncJob: PptxOoxmlSyncEnqueueJob = enqueuePptxOoxmlSyncJob,
    @Optional()
    @Inject(DECK_EXPORT_ENQUEUE_JOB)
    private readonly enqueueDeckExport: DeckExportEnqueueJob = enqueueDeckExportJob,
    @Optional()
    @Inject(SEMANTIC_CUE_EXTRACTION_ENQUEUE_JOB)
    private readonly enqueueSemanticCueJob: SemanticCueExtractionEnqueueJob = enqueueSemanticCueExtractionJob,
    @Optional()
    @InjectPinoLogger(DecksService.name)
    private readonly logger?: PinoLogger,
    @Optional()
    @Inject(SPEAKER_NOTES_SUGGESTION_ENQUEUE_JOB)
    private readonly enqueueSpeakerNotesSuggestion: SpeakerNotesSuggestionEnqueueJob = enqueueSpeakerNotesSuggestionJob,
  ) {}

  async getDeck(projectId: string): Promise<GetDeckResponse> {
    const deckRow = await this.findDeckRow(this.dataSource, projectId);

    if (!deckRow) {
      throwDeckApiException(
        "DECK_NOT_FOUND",
        HttpStatus.NOT_FOUND,
        `Deck not found for project: ${projectId}`,
      );
    }

    const deck = await this.readCurrentDeckState(
      this.dataSource,
      parseDeckRow(deckRow),
      projectId,
      deckRow.deck_id,
      toIso(deckRow.updated_at),
    );

    return getDeckResponseSchema.parse({
      projectId,
      deck: deck.deck,
      updatedAt: deck.updatedAt,
    });
  }

  async getDeckForUpdate(
    manager: EntityManager,
    projectId: string,
    deckId: string,
  ): Promise<Deck> {
    const deckRow = await this.findDeckRowForUpdate(
      manager,
      projectId,
      deckId,
    );

    if (!deckRow) {
      throwDeckApiException(
        "DECK_NOT_FOUND",
        HttpStatus.NOT_FOUND,
        `Deck not found for project: ${projectId}`,
      );
    }

    return (
      await this.readCurrentDeckState(
        manager,
        parseDeckRow(deckRow),
        projectId,
        deckId,
        toIso(deckRow.updated_at),
        true,
      )
    ).deck;
  }

  async getPptxImportQuality(
    projectId: string,
  ): Promise<GetPptxImportQualityResponse> {
    const { deck } = await this.getDeck(projectId);
    const rows = await this.dataSource.query<PptxImportQualityRow[]>(
      `
        SELECT quality_report_json
        FROM template_blueprints
        WHERE project_id = $1 AND deck_id = $2
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      [projectId, deck.deckId],
    );
    const qualityReport = qualityReportSchema.safeParse(
      rows[0]?.quality_report_json,
    );

    return getPptxImportQualityResponseSchema.parse({
      importQuality: qualityReport.success
        ? { qualityReport: qualityReport.data }
        : null,
    });
  }

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

  async getOoxmlSyncState(projectId: string) {
    const { deck } = await this.getDeck(projectId);
    const state = await this.readOoxmlSyncState(projectId, deck);
    return getOoxmlSyncStateResponseSchema.parse({ ooxmlSyncState: state });
  }

  async retryOoxmlSync(projectId: string) {
    const { deck } = await this.getDeck(projectId);
    const current = await this.readOoxmlSyncState(projectId, deck);
    if (current.status === "not-applicable" || current.status === "synced") {
      return retryOoxmlSyncResponseSchema.parse({ ooxmlSyncState: current });
    }
    if (
      current.status === "pending" &&
      current.job?.status !== "failed"
    ) {
      return retryOoxmlSyncResponseSchema.parse({ ooxmlSyncState: current });
    }

    const job = await this.enqueueOoxmlSync(projectId, {
      deckId: deck.deckId,
      changeId: `retry_${randomUUID()}`,
      targetDeckVersion: deck.version,
    });
    const state = await this.readOoxmlSyncState(projectId, deck, job);
    return retryOoxmlSyncResponseSchema.parse({ ooxmlSyncState: state });
  }

  private async assertExportSession(
    projectId: string,
    deckId: string,
    sessionId: string,
  ) {
    const rows = await this.dataSource.query(
      `
        SELECT session_id
        FROM presentation_sessions
        WHERE project_id = $1 AND deck_id = $2 AND session_id = $3
          AND results_deleted_at IS NULL
        LIMIT 1
      `,
      [projectId, deckId, sessionId],
    );
    if (!rows[0]) {
      throw new HttpException(
        "Presentation session not found for export",
        HttpStatus.NOT_FOUND,
      );
    }
  }

  async putDeck(projectId: string, body: unknown): Promise<PutDeckResponse> {
    const request = parsePutDeckRequest(body);

    if (request.deck.projectId !== projectId) {
      throwDeckApiException(
        "PROJECT_MISMATCH",
        HttpStatus.BAD_REQUEST,
        "URL projectId must match deck.projectId",
        [`projectId=${projectId}`, `deck.projectId=${request.deck.projectId}`],
      );
    }

    let syncInput: PptxOoxmlSyncJobInput | null = null;
    const response = await this.dataSource.transaction(async (manager) => {
      const updatedAt = nowIso();
      const deckRow = await this.findProjectDeckRowForUpdate(
        manager,
        projectId,
      );
      let currentDeck: Deck | undefined;
      let templateBlueprint: OoxmlTemplateBlueprint | undefined;

      if (deckRow) {
        if (deckRow.deck_id !== request.deck.deckId) {
          throwDeckApiException(
            "DECK_MISMATCH",
            HttpStatus.CONFLICT,
            "Stored deckId must match deck.deckId",
            [
              `deck.deckId=${deckRow.deck_id}`,
              `request.deckId=${request.deck.deckId}`,
            ],
          );
        }

        currentDeck = (
          await this.readCurrentDeckState(
            manager,
            parseDeckRow(deckRow),
            projectId,
            deckRow.deck_id,
            toIso(deckRow.updated_at),
            true,
          )
        ).deck;
        const baseVersion = request.baseVersion ?? request.deck.version;

        if (currentDeck.version !== baseVersion) {
          throwDeckApiException(
            "STALE_BASE_VERSION",
            HttpStatus.CONFLICT,
            "Deck baseVersion does not match current deck version",
            [
              `deck.version=${currentDeck.version}`,
              `request.baseVersion=${baseVersion}`,
            ],
          );
        }

        templateBlueprint = await this.findOoxmlTemplateBlueprint(
          manager,
          projectId,
          currentDeck.deckId,
          currentDeck,
        );
      }

      const requestedDeck = removeLegacyAiGeneratedTitleAnimations(
        request.deck,
      );
      const replacement =
        currentDeck && templateBlueprint
          ? createOoxmlReplacement(currentDeck, requestedDeck, updatedAt)
          : undefined;
      const nextDeck = replacement?.deck ?? requestedDeck;

      await this.deletePatchRowsAfterVersion(
        manager,
        projectId,
        nextDeck.deckId,
        nextDeck.version,
      );

      if (replacement) {
        await this.insertPatchLog(manager, projectId, replacement.changeRecord);
      }

      const deck = await this.writeDeckCheckpoint(
        manager,
        nextDeck,
        updatedAt,
        templateBlueprint ?? null,
      );
      await this.updateProjectTitle(manager, projectId, deck.title);
      const snapshot = await this.createSnapshot(
        manager,
        deck,
        request.snapshotReason ?? "deck-replaced",
        updatedAt,
      );

      if (replacement) {
        syncInput = {
          deckId: deck.deckId,
          changeId: replacement.changeRecord.changeId,
          targetDeckVersion: deck.version,
        };
      }

      return {
        deck,
        snapshot,
        updatedAt,
      };
    });

    const ooxmlSyncJob = syncInput
      ? await this.enqueueOoxmlSync(projectId, syncInput)
      : undefined;

    return putDeckResponseSchema.parse({ ...response, ooxmlSyncJob });
  }

  async appendPatch(
    projectId: string,
    body: AppendDeckPatchAckRequest,
  ): Promise<AppendDeckPatchAckResponse>;
  async appendPatch(
    projectId: string,
    body: AppendDeckPatchFullRequest,
  ): Promise<AppendDeckPatchResponse>;
  async appendPatch(
    projectId: string,
    body: unknown,
  ): Promise<AppendDeckPatchResponse | AppendDeckPatchAckResponse>;
  async appendPatch(
    projectId: string,
    body: unknown,
  ): Promise<AppendDeckPatchResponse | AppendDeckPatchAckResponse> {
    const request = parseAppendDeckPatchRequest(body);
    let syncInput: PptxOoxmlSyncJobInput | null = null;

    const response = await this.dataSource.transaction(async (manager) => {
      const deckRow = await this.findDeckRowForUpdate(
        manager,
        projectId,
        request.patch.deckId,
      );

      if (!deckRow) {
        throwDeckApiException(
          "DECK_NOT_FOUND",
          HttpStatus.NOT_FOUND,
          `Deck not found for project: ${projectId}`,
        );
      }

      const checkpointVersion = deckRow.version;
      const currentDeck = (
        await this.readCurrentDeckState(
          manager,
          parseDeckRow(deckRow),
          projectId,
          request.patch.deckId,
          toIso(deckRow.updated_at),
          true,
        )
      ).deck;

      if (currentDeck.projectId !== projectId) {
        throwDeckApiException(
          "PROJECT_MISMATCH",
          HttpStatus.BAD_REQUEST,
          "Stored deck projectId must match URL projectId",
          [`projectId=${projectId}`, `deck.projectId=${currentDeck.projectId}`],
        );
      }

      const updatedAt = nowIso();
      const applyResult = applyDeckPatch(currentDeck, request.patch, {
        createdAt: updatedAt,
      });

      if (!applyResult.ok) {
        throwApplyPatchException(applyResult.error);
      }

      await this.insertPatchLog(manager, projectId, applyResult.changeRecord);
      const templateBlueprint = await this.findOoxmlTemplateBlueprint(
        manager,
        projectId,
        applyResult.deck.deckId,
        currentDeck,
      );
      const shouldCheckpoint =
        !templateBlueprint &&
        (Boolean(request.snapshotReason) ||
          applyResult.deck.version - checkpointVersion >=
            deckCheckpointPatchInterval);
      const deck =
        templateBlueprint || shouldCheckpoint
          ? await this.writeDeckCheckpoint(
              manager,
              applyResult.deck,
              updatedAt,
              templateBlueprint ?? null,
            )
          : applyResult.deck;

      if (applyResult.deck.title !== currentDeck.title) {
        await this.updateProjectTitle(
          manager,
          projectId,
          applyResult.deck.title,
        );
      }

      const snapshot = request.snapshotReason
        ? await this.createSnapshot(
            manager,
            deck,
            request.snapshotReason,
            updatedAt,
          )
        : null;
      if (templateBlueprint) {
        syncInput = {
          deckId: deck.deckId,
          changeId: applyResult.changeRecord.changeId,
          targetDeckVersion: deck.version,
        };
      }

      return {
        deck,
        changeRecord: applyResult.changeRecord,
        snapshot,
        updatedAt,
      };
    });

    const ooxmlSyncJob = syncInput
      ? await this.enqueueOoxmlSync(projectId, syncInput)
      : undefined;

    if (request.responseMode === "ack") {
      return appendDeckPatchAckResponseSchema.parse({
        deckId: response.deck.deckId,
        version: response.deck.version,
        changeRecord: response.changeRecord,
        ...(response.snapshot ? { snapshot: response.snapshot } : {}),
        ooxmlSyncJob,
        updatedAt: response.updatedAt,
      });
    }

    return appendDeckPatchResponseSchema.parse({ ...response, ooxmlSyncJob });
  }

  async createSemanticCueExtractionJob(
    projectId: string,
    body: unknown,
  ): Promise<CreateSemanticCueExtractionJobResponse> {
    const request = semanticCueExtractionRequestSchema.parse(body ?? {});

    if (!this.jobsService) {
      throwDeckApiException(
        "DECK_VALIDATION_FAILED",
        HttpStatus.SERVICE_UNAVAILABLE,
        "Jobs service is not available",
      );
    }

    const preparedRequest = await this.dataSource.transaction(
      async (manager) => {
        const deckRow = await this.findProjectDeckRowForUpdate(
          manager,
          projectId,
        );

        if (!deckRow) {
          throwDeckApiException(
            "DECK_NOT_FOUND",
            HttpStatus.NOT_FOUND,
            `Deck not found for project: ${projectId}`,
          );
        }

        const requestedDeckId = request.deckId ?? deckRow.deck_id;
        if (requestedDeckId !== deckRow.deck_id) {
          throwDeckApiException(
            "DECK_MISMATCH",
            HttpStatus.BAD_REQUEST,
            "Requested deckId must match project deck",
            [
              `deck.deckId=${deckRow.deck_id}`,
              `request.deckId=${requestedDeckId}`,
            ],
          );
        }

        const materializedState = await this.readCurrentDeckState(
          manager,
          parseDeckRow(deckRow),
          projectId,
          deckRow.deck_id,
          toIso(deckRow.updated_at),
          true,
        );
        const deck = await this.writeDeckCheckpoint(
          manager,
          materializedState.deck,
          nowIso(),
        );

        return semanticCueExtractionJobPayloadSchema.shape.request.parse({
          deckId: deck.deckId,
          force: request.force,
          baseVersion: deck.version,
        });
      },
    );

    const queuedJob = await this.jobsService.create({
      projectId,
      type: "semantic-cue-extraction",
      payload: { request: preparedRequest },
    });

    try {
      const config = loadOrbitConfig(process.env, { service: "api" });
      await this.enqueueSemanticCueJob({
        driver: config.JOB_QUEUE_DRIVER,
        redisUrl: config.REDIS_URL,
        jobId: queuedJob.jobId,
        projectId,
        request: preparedRequest,
      });
      this.logger?.info(
        {
          event: "semantic_cue.extraction.queued",
          jobId: queuedJob.jobId,
          jobType: queuedJob.type,
          projectId,
          deckId: preparedRequest.deckId,
          deckVersion: preparedRequest.baseVersion,
          force: preparedRequest.force,
        },
        "Semantic cue extraction job enqueued.",
      );
    } catch (error) {
      await this.jobsService.update(queuedJob.jobId, {
        status: "failed",
        progress: 0,
        message: "Semantic cue extraction enqueue failed.",
        error: {
          code: "SEMANTIC_CUE_EXTRACTION_ENQUEUE_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Semantic cue extraction enqueue failed.",
        },
      });
      this.logger?.error(
        {
          event: "semantic_cue.extraction.failed",
          jobId: queuedJob.jobId,
          jobType: queuedJob.type,
          projectId,
          deckId: preparedRequest.deckId,
          deckVersion: preparedRequest.baseVersion,
          reason: "enqueue_failed",
          error: serializeLogError(error),
        },
        "Semantic cue extraction enqueue failed.",
      );
      throw error;
    }

    return createSemanticCueExtractionJobResponseSchema.parse({
      job: queuedJob,
    });
  }

  async createSpeakerNotesSuggestionJob(
    projectId: string,
    body: unknown,
  ): Promise<CreateSpeakerNotesSuggestionJobResponse> {
    const request = speakerNotesSuggestionRequestSchema.parse(body);

    if (!this.jobsService) {
      throwDeckApiException(
        "DECK_VALIDATION_FAILED",
        HttpStatus.SERVICE_UNAVAILABLE,
        "Jobs service is not available",
      );
    }

    const preparedRequest = await this.dataSource.transaction(async (manager) => {
      const deckRow = await this.findProjectDeckRowForUpdate(manager, projectId);
      if (!deckRow) {
        throwDeckApiException(
          "DECK_NOT_FOUND",
          HttpStatus.NOT_FOUND,
          `Deck not found for project: ${projectId}`,
        );
      }
      if (request.deckId !== deckRow.deck_id) {
        throwDeckApiException(
          "DECK_MISMATCH",
          HttpStatus.BAD_REQUEST,
          "Requested deckId must match project deck",
        );
      }

      const materializedState = await this.readCurrentDeckState(
        manager,
        parseDeckRow(deckRow),
        projectId,
        deckRow.deck_id,
        toIso(deckRow.updated_at),
        true,
      );
      if (materializedState.deck.version !== request.baseVersion) {
        throwDeckApiException(
          "STALE_BASE_VERSION",
          HttpStatus.CONFLICT,
          "Deck changed before the speaker notes suggestion started",
        );
      }
      const slide = materializedState.deck.slides.find(
        (candidate) => candidate.slideId === request.slideId,
      );
      if (!slide) {
        throwDeckApiException(
          "DECK_VALIDATION_FAILED",
          HttpStatus.BAD_REQUEST,
          "Requested slide does not exist in the deck",
        );
      }
      const hasNotes = slide.speakerNotes.trim().length > 0;
      const requiresExistingNotes = request.mode !== "draft" && request.mode !== "icebreaker";
      if (
        (request.mode === "draft" && hasNotes) ||
        (requiresExistingNotes && !hasNotes)
      ) {
        throwDeckApiException(
          "DECK_VALIDATION_FAILED",
          HttpStatus.BAD_REQUEST,
          hasNotes
            ? "Draft mode is only available when speaker notes are empty"
            : "Refinement modes require existing speaker notes",
        );
      }

      const deck = await this.writeDeckCheckpoint(
        manager,
        materializedState.deck,
        nowIso(),
      );
      return speakerNotesSuggestionJobPayloadSchema.shape.request.parse({
        ...request,
        baseVersion: deck.version,
      });
    });

    const queuedJob = await this.jobsService.create({
      projectId,
      type: "speaker-notes-suggestion",
      payload: { request: preparedRequest },
    });

    try {
      const config = loadOrbitConfig(process.env, { service: "api" });
      await this.enqueueSpeakerNotesSuggestion({
        driver: config.JOB_QUEUE_DRIVER,
        redisUrl: config.REDIS_URL,
        jobId: queuedJob.jobId,
        projectId,
        request: preparedRequest,
      });
      this.logger?.info(
        {
          event: "speaker_notes.suggestion.queued",
          jobId: queuedJob.jobId,
          jobType: queuedJob.type,
          projectId,
          deckId: preparedRequest.deckId,
          slideId: preparedRequest.slideId,
          deckVersion: preparedRequest.baseVersion,
          mode: preparedRequest.mode,
        },
        "Speaker notes suggestion job enqueued.",
      );
    } catch (error) {
      await this.jobsService.update(queuedJob.jobId, {
        status: "failed",
        progress: 0,
        message: "Speaker notes suggestion enqueue failed.",
        error: {
          code: "SPEAKER_NOTES_SUGGESTION_ENQUEUE_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Speaker notes suggestion enqueue failed.",
        },
      });
      this.logger?.error(
        {
          event: "speaker_notes.suggestion.failed",
          jobId: queuedJob.jobId,
          jobType: queuedJob.type,
          projectId,
          deckId: preparedRequest.deckId,
          slideId: preparedRequest.slideId,
          deckVersion: preparedRequest.baseVersion,
          mode: preparedRequest.mode,
          reason: "enqueue_failed",
          error: serializeLogError(error),
        },
        "Speaker notes suggestion enqueue failed.",
      );
      throw error;
    }

    return createSpeakerNotesSuggestionJobResponseSchema.parse({ job: queuedJob });
  }

  async listSnapshots(projectId: string): Promise<ListDeckSnapshotsResponse> {
    const rows = await this.dataSource.query<DeckSnapshotRow[]>(
      `
        SELECT snapshot_id, project_id, deck_id, deck_json, version, reason, created_at
        FROM deck_snapshots
        WHERE project_id = $1
        ORDER BY created_at DESC, version DESC, snapshot_id DESC
      `,
      [projectId],
    );

    return listDeckSnapshotsResponseSchema.parse({
      projectId,
      snapshots: rows.map(parseSnapshotRow),
    });
  }

  async getOrCreateSnapshot(deck: Deck): Promise<DeckSnapshot> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT deck_id FROM decks WHERE project_id = $1 AND deck_id = $2 FOR UPDATE`,
        [deck.projectId, deck.deckId],
      );
      const rows = await manager.query<DeckSnapshotRow[]>(
        `SELECT snapshot_id, project_id, deck_id, deck_json, version, reason, created_at
         FROM deck_snapshots
         WHERE project_id = $1 AND deck_id = $2 AND version = $3
         ORDER BY created_at DESC, snapshot_id DESC LIMIT 1`,
        [deck.projectId, deck.deckId, deck.version],
      );
      return rows[0]
        ? parseSnapshotRow(rows[0])
        : this.createSnapshot(manager, deck, "auto-save", nowIso());
    });
  }

  async restoreSnapshot(
    projectId: string,
    snapshotId: string,
  ): Promise<RestoreDeckSnapshotResponse> {
    let syncInput: PptxOoxmlSyncJobInput | null = null;
    const response = await this.dataSource.transaction(async (manager) => {
      const snapshotRow = await this.findSnapshotRow(manager, snapshotId);

      if (!snapshotRow) {
        throwDeckApiException(
          "SNAPSHOT_NOT_FOUND",
          HttpStatus.NOT_FOUND,
          `Snapshot not found: ${snapshotId}`,
        );
      }

      if (snapshotRow.project_id !== projectId) {
        throwDeckApiException(
          "SNAPSHOT_PROJECT_MISMATCH",
          HttpStatus.BAD_REQUEST,
          "Snapshot does not belong to the requested project",
          [
            `projectId=${projectId}`,
            `snapshot.projectId=${snapshotRow.project_id}`,
          ],
        );
      }

      const restoredSnapshot = parseSnapshotRow(snapshotRow);
      const deck = removeLegacyAiGeneratedTitleAnimations(
        parseDeckJson(snapshotRow.deck_json),
      );
      const updatedAt = nowIso();
      let currentDeck: Deck | undefined;
      let templateBlueprint: OoxmlTemplateBlueprint | undefined;
      const currentRow = await this.findDeckRowForUpdate(
        manager,
        projectId,
        deck.deckId,
      );
      if (currentRow) {
        const currentState = await this.readCurrentDeckState(
          manager,
          parseDeckJson(currentRow.deck_json),
          projectId,
          deck.deckId,
          toIso(currentRow.updated_at),
          true,
        );
        currentDeck = currentState.deck;
        templateBlueprint = await this.findOoxmlTemplateBlueprint(
          manager,
          projectId,
          currentDeck.deckId,
          currentDeck,
        );
        await this.createSnapshot(
          manager,
          currentDeck,
          "snapshot-restore",
          updatedAt,
        );
      }

      if (currentDeck && templateBlueprint) {
        const replacement = createOoxmlReplacement(
          currentDeck,
          deck,
          updatedAt,
        );
        await this.insertPatchLog(manager, projectId, replacement.changeRecord);
        const restoredDeck = await this.writeDeckCheckpoint(
          manager,
          replacement.deck,
          updatedAt,
          templateBlueprint,
        );
        await this.updateProjectTitle(
          manager,
          projectId,
          restoredDeck.title,
        );
        syncInput = {
          deckId: restoredDeck.deckId,
          changeId: replacement.changeRecord.changeId,
          targetDeckVersion: restoredDeck.version,
        };

        return { deck: restoredDeck, restoredSnapshot, updatedAt };
      }

      await this.deletePatchRowsAfterVersion(
        manager,
        projectId,
        deck.deckId,
        deck.version,
      );
      await this.writeDeckCheckpoint(manager, deck, updatedAt);
      await this.updateProjectTitle(manager, projectId, deck.title);

      return { deck, restoredSnapshot, updatedAt };
    });

    const ooxmlSyncJob = syncInput
      ? await this.enqueueOoxmlSync(projectId, syncInput)
      : undefined;

    return restoreDeckSnapshotResponseSchema.parse({
      ...response,
      ooxmlSyncJob,
    });
  }

  private async readCurrentDeckState(
    executor: QueryExecutor,
    checkpointDeck: Deck,
    projectId: string,
    deckId: string,
    checkpointUpdatedAt: string,
    lockRows = false,
  ): Promise<{ deck: Deck; updatedAt: string }> {
    const patchRows = await this.findPatchRowsAfterVersion(
      executor,
      projectId,
      deckId,
      checkpointDeck.version,
      lockRows,
    );

    if (patchRows.length === 0) {
      return {
        deck: removeLegacyAiGeneratedTitleAnimations(checkpointDeck),
        updatedAt: checkpointUpdatedAt,
      };
    }

    const deck = removeLegacyAiGeneratedTitleAnimations(
      replayPatchRows(checkpointDeck, patchRows),
    );
    return {
      deck,
      updatedAt: toIso(patchRows.at(-1)?.created_at ?? nowIso()),
    };
  }

  private async findDeckRow(
    executor: QueryExecutor,
    projectId: string,
  ): Promise<DeckRow | undefined> {
    const rows = await executor.query<DeckRow[]>(
      `
        SELECT project_id, deck_id, deck_json, version, updated_at
        FROM decks
        WHERE project_id = $1
      `,
      [projectId],
    );

    return rows[0];
  }

  private async findProjectDeckRowForUpdate(
    manager: EntityManager,
    projectId: string,
  ): Promise<DeckRow | undefined> {
    const rows = await manager.query<DeckRow[]>(
      `
        SELECT project_id, deck_id, deck_json, version, updated_at
        FROM decks
        WHERE project_id = $1
        FOR UPDATE
      `,
      [projectId],
    );

    return rows[0];
  }

  private async findDeckRowForUpdate(
    manager: EntityManager,
    projectId: string,
    deckId: string,
  ): Promise<DeckRow | undefined> {
    const rows = await manager.query<DeckRow[]>(
      `
        SELECT project_id, deck_id, deck_json, version, updated_at
        FROM decks
        WHERE project_id = $1 AND deck_id = $2
        FOR UPDATE
      `,
      [projectId, deckId],
    );

    return rows[0];
  }

  private async findPatchRowsAfterVersion(
    executor: QueryExecutor,
    projectId: string,
    deckId: string,
    version: number,
    lockRows = false,
  ): Promise<DeckPatchRow[]> {
    const rows = await executor.query<DeckPatchRow[]>(
      `
        SELECT
          change_id,
          project_id,
          deck_id,
          before_version,
          after_version,
          source,
          actor_user_id,
          operations,
          created_at
        FROM deck_patches
        WHERE project_id = $1 AND deck_id = $2 AND after_version > $3
        ORDER BY after_version ASC, created_at ASC, change_id ASC
        ${lockRows ? "FOR UPDATE" : ""}
      `,
      [projectId, deckId, version],
    );

    return rows;
  }

  private async upsertDeck(
    executor: QueryExecutor,
    deck: Deck,
    updatedAt: string,
  ): Promise<Deck> {
    const rows = await executor.query<DeckRow[]>(
      `
        INSERT INTO decks (project_id, deck_id, deck_json, version, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (project_id)
        DO UPDATE SET
          deck_id = EXCLUDED.deck_id,
          deck_json = EXCLUDED.deck_json,
          version = EXCLUDED.version,
          updated_at = EXCLUDED.updated_at
        RETURNING project_id, deck_id, deck_json, version, updated_at
      `,
      [deck.projectId, deck.deckId, deck, deck.version, updatedAt],
    );

    return parseDeckRow(rows[0]);
  }

  private async updateProjectTitle(
    executor: QueryExecutor,
    projectId: string,
    title: string,
  ): Promise<void> {
    await executor.query(
      `
        UPDATE projects
        SET title = $2
        WHERE project_id = $1
      `,
      [projectId, title],
    );
  }

  private async writeDeckCheckpoint(
    executor: QueryExecutor,
    deck: Deck,
    updatedAt: string,
    knownTemplateBlueprint?: OoxmlTemplateBlueprint | null,
  ): Promise<Deck> {
    const templateBlueprint =
      knownTemplateBlueprint === undefined
        ? await this.findOoxmlTemplateBlueprint(
            executor,
            deck.projectId,
            deck.deckId,
            deck,
          )
        : (knownTemplateBlueprint ?? undefined);
    const checkpointDeck = await this.upsertDeck(executor, deck, updatedAt);
    await this.deletePatchRowsUpToVersion(
      executor,
      checkpointDeck.projectId,
      checkpointDeck.deckId,
      templateBlueprint
        ? Math.min(
            templateBlueprint.blueprint.ooxmlSyncedDeckVersion ?? 1,
            checkpointDeck.version,
          )
        : checkpointDeck.version,
    );
    return checkpointDeck;
  }

  private async insertPatchLog(
    manager: EntityManager,
    projectId: string,
    changeRecord: DeckChangeRecord,
  ): Promise<void> {
    await manager.query(
      `
        INSERT INTO deck_patches (
          change_id,
          project_id,
          deck_id,
          before_version,
          after_version,
          source,
          actor_user_id,
          operations,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        changeRecord.changeId,
        projectId,
        changeRecord.deckId,
        changeRecord.beforeVersion,
        changeRecord.afterVersion,
        changeRecord.source,
        changeRecord.actorUserId ?? null,
        JSON.stringify(changeRecord.operations),
        changeRecord.createdAt,
      ],
    );
  }

  private async createSnapshot(
    executor: QueryExecutor,
    deck: Deck,
    reason: DeckSnapshotReason,
    createdAt: string,
  ): Promise<DeckSnapshot> {
    const snapshotId = deckSnapshotIdSchema.parse(`snapshot_${randomUUID()}`);
    const snapshotReason = deckSnapshotReasonSchema.parse(reason);

    const rows = await executor.query<DeckSnapshotRow[]>(
      `
        INSERT INTO deck_snapshots (
          snapshot_id,
          project_id,
          deck_id,
          deck_json,
          version,
          reason,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING snapshot_id, project_id, deck_id, deck_json, version, reason, created_at
      `,
      [
        snapshotId,
        deck.projectId,
        deck.deckId,
        deck,
        deck.version,
        snapshotReason,
        createdAt,
      ],
    );

    return parseSnapshotRow(rows[0]);
  }

  private async deletePatchRowsAfterVersion(
    executor: QueryExecutor,
    projectId: string,
    deckId: string,
    version: number,
  ): Promise<void> {
    await executor.query(
      `
        DELETE FROM deck_patches
        WHERE project_id = $1 AND deck_id = $2 AND after_version > $3
      `,
      [projectId, deckId, version],
    );
  }

  private async deletePatchRowsUpToVersion(
    executor: QueryExecutor,
    projectId: string,
    deckId: string,
    version: number,
  ): Promise<void> {
    await executor.query(
      `
        DELETE FROM deck_patches
        WHERE project_id = $1 AND deck_id = $2 AND after_version <= $3
      `,
      [projectId, deckId, version],
    );
  }

  private async findSnapshotRow(
    manager: EntityManager,
    snapshotId: string,
  ): Promise<DeckSnapshotRow | undefined> {
    const rows = await manager.query<DeckSnapshotRow[]>(
      `
        SELECT snapshot_id, project_id, deck_id, deck_json, version, reason, created_at
        FROM deck_snapshots
        WHERE snapshot_id = $1
        FOR UPDATE
      `,
      [snapshotId],
    );

    return rows[0];
  }

  private async findOoxmlTemplateBlueprint(
    executor: QueryExecutor,
    projectId: string,
    deckId: string,
    deck: Deck,
  ): Promise<OoxmlTemplateBlueprint | undefined> {
    const rows = await executor.query<TemplateBlueprintRow[]>(
      `
        SELECT template_id, blueprint_json
        FROM template_blueprints
        WHERE project_id = $1 AND deck_id = $2
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      [projectId, deckId],
    );
    const row = rows[0];

    if (!row) {
      return undefined;
    }

    const parsed = templateBlueprintSchema.safeParse(row.blueprint_json);
    if (
      !parsed.success ||
      (!parsed.data.currentPackageFileId && !parsed.data.sourcePackageFileId)
    ) {
      return undefined;
    }

    const recovered = recoverTemplateBlueprintSlideIds(
      parsed.data,
      deck.slides,
    );
    if (!recovered) return undefined;
    if (recovered.recovered) {
      await executor.query(
        `
          UPDATE template_blueprints
          SET blueprint_json = $2, updated_at = now()
          WHERE template_id = $1
        `,
        [row.template_id, recovered.blueprint],
      );
    }

    return { ...row, blueprint: recovered.blueprint };
  }

  private async readOoxmlSyncState(
    projectId: string,
    deck: Deck,
    suppliedJob?: Job,
  ): Promise<OoxmlSyncState> {
    const imported = await this.findOoxmlTemplateBlueprint(
      this.dataSource,
      projectId,
      deck.deckId,
      deck,
    );
    if (!imported) {
      return {
        status: "not-applicable",
        deckId: deck.deckId,
        deckVersion: deck.version,
        syncedDeckVersion: null,
        retryable: false,
      };
    }

    const syncedDeckVersion =
      imported.blueprint.ooxmlSyncedDeckVersion ?? null;
    const job =
      suppliedJob ??
      (await this.jobsService?.getLatestPptxOoxmlSync(
        projectId,
        deck.deckId,
        deck.version,
      ));
    const status =
      syncedDeckVersion === deck.version
        ? "synced"
        : job?.status === "failed"
          ? "failed"
          : job?.status === "queued" || job?.status === "running"
            ? "pending"
            : "stale";

    return {
      status,
      deckId: deck.deckId,
      deckVersion: deck.version,
      syncedDeckVersion,
      retryable: status === "stale" || status === "failed",
      ...(job ? { job } : {}),
    };
  }

  private async enqueueOoxmlSync(
    projectId: string,
    input: PptxOoxmlSyncJobInput,
  ) {
    if (!this.jobsService) {
      return undefined;
    }

    const queuedJob = await this.jobsService.create({
      projectId,
      type: "pptx-ooxml-sync",
      payload: input,
    });

    try {
      const config = loadOrbitConfig(process.env, { service: "api" });
      await this.enqueueSyncJob({
        driver: config.JOB_QUEUE_DRIVER,
        redisUrl: config.REDIS_URL,
        jobId: queuedJob.jobId,
        projectId,
        ...input,
      });
      this.logger?.info(
        {
          event: "pptx_ooxml.sync.queued",
          jobId: queuedJob.jobId,
          projectId,
          deckId: input.deckId,
          targetDeckVersion: input.targetDeckVersion,
        },
        "PPTX OOXML sync job enqueued.",
      );
      return queuedJob;
    } catch (error) {
      const failedJob =
        (await this.jobsService.update(queuedJob.jobId, {
          status: "failed",
          progress: 0,
          message: "PPTX OOXML sync enqueue failed.",
          error: {
            code: "PPTX_OOXML_SYNC_ENQUEUE_FAILED",
            message:
              error instanceof Error
                ? error.message
                : "PPTX OOXML sync enqueue failed.",
          },
        })) ?? queuedJob;
      this.logger?.error(
        {
          event: "pptx_ooxml.sync.enqueue_failed",
          jobId: queuedJob.jobId,
          projectId,
          deckId: input.deckId,
          targetDeckVersion: input.targetDeckVersion,
        },
        "PPTX OOXML sync job enqueue failed.",
      );
      return failedJob;
    }
  }
}

function parsePutDeckRequest(body: unknown): PutDeckRequest {
  const result = putDeckRequestSchema.safeParse(body);

  if (!result.success) {
    throwDeckApiException(
      "DECK_VALIDATION_FAILED",
      HttpStatus.BAD_REQUEST,
      "Deck payload is invalid",
      formatZodError(result.error),
    );
  }

  return result.data;
}

function createOoxmlReplacement(
  currentDeck: Deck,
  requestedDeck: Deck,
  createdAt: string,
): { deck: Deck; changeRecord: DeckChangeRecord } {
  const deck = deckSchema.parse({
    ...requestedDeck,
    version: currentDeck.version + 1,
  });
  const slideOperations = createOoxmlSlideDiff(currentDeck, deck);
  const operations = [
    ...slideOperations,
    ...createOoxmlElementDiff(currentDeck, deck),
  ];

  return {
    deck,
    changeRecord: {
      changeId: `change_${deck.deckId}_${deck.version}_put`,
      deckId: deck.deckId,
      beforeVersion: currentDeck.version,
      afterVersion: deck.version,
      source: "user",
      createdAt,
      operations:
        operations.length > 0
          ? operations
          : [{ type: "update_deck", title: deck.title }],
    },
  };
}

function createOoxmlSlideDiff(
  currentDeck: Deck,
  nextDeck: Deck,
): DeckPatchOperation[] {
  const currentSlides = validateAndSortSlides(currentDeck);
  const nextSlides = validateAndSortSlides(nextDeck);
  const currentIds = currentSlides.map((slide) => slide.slideId);
  const nextIds = nextSlides.map((slide) => slide.slideId);
  const currentIdSet = new Set(currentIds);
  const nextIdSet = new Set(nextIds);
  const hasSameSlides =
    currentIds.length === nextIds.length &&
    currentIdSet.size === currentIds.length &&
    nextIdSet.size === nextIds.length &&
    nextIds.every((slideId) => currentIdSet.has(slideId));

  if (hasSameSlides) {
    if (isDeepStrictEqual(currentIds, nextIds)) return [];
    return [
      {
        type: "reorder_slides",
        slideOrders: nextSlides.map((slide) => ({
          slideId: slide.slideId,
          order: slide.order,
        })),
      },
    ];
  }

  return [
    ...currentSlides
      .filter((slide) => !nextIdSet.has(slide.slideId))
      .map(
        (slide): DeckPatchOperation => ({
          type: "delete_slide",
          slideId: slide.slideId,
        }),
      ),
    ...nextSlides
      .filter((slide) => !currentIdSet.has(slide.slideId))
      .map(
        (slide): DeckPatchOperation => ({
          type: "add_slide",
          slide,
        }),
      ),
  ];
}

function validateAndSortSlides(deck: Deck): Deck["slides"] {
  const slideIds = deck.slides.map((slide) => slide.slideId);
  const orders = deck.slides.map((slide) => slide.order);
  const expectedOrders = new Set(deck.slides.map((_, index) => index + 1));
  const hasUniqueIds = new Set(slideIds).size === slideIds.length;
  const hasExactOrders =
    new Set(orders).size === orders.length &&
    orders.every((order) => expectedOrders.has(order));
  if (!hasUniqueIds || !hasExactOrders) {
    throwDeckApiException(
      "DECK_VALIDATION_FAILED",
      HttpStatus.BAD_REQUEST,
      "Deck slide IDs and orders must be exact permutations",
      [`slideIds=${slideIds.join(",")}`, `slideOrders=${orders.join(",")}`],
    );
  }
  return [...deck.slides].sort((left, right) => left.order - right.order);
}

function createOoxmlElementDiff(
  currentDeck: Deck,
  nextDeck: Deck,
): DeckPatchOperation[] {
  const nextSlideIds = new Set(nextDeck.slides.map((slide) => slide.slideId));
  const sharedSlideIds = new Set(
    currentDeck.slides
      .map((slide) => slide.slideId)
      .filter((slideId) => nextSlideIds.has(slideId)),
  );
  const currentElements = indexDeckElements(currentDeck, sharedSlideIds);
  const nextElements = indexDeckElements(nextDeck, sharedSlideIds);
  const operations: DeckPatchOperation[] = [];

  for (const [elementKey, current] of currentElements) {
    const next = nextElements.get(elementKey);
    if (
      !next ||
      next.slideId !== current.slideId ||
      next.element.type !== current.element.type
    ) {
      operations.push({
        type: "delete_element",
        slideId: current.slideId,
        elementId: current.element.elementId,
      });
    }
  }

  for (const [elementKey, next] of nextElements) {
    const current = currentElements.get(elementKey);
    if (
      !current ||
      current.slideId !== next.slideId ||
      current.element.type !== next.element.type
    ) {
      operations.push({
        type: "add_element",
        slideId: next.slideId,
        element: next.element,
      });
      continue;
    }

    const currentFrame = ooxmlElementFrame(current.element);
    const nextFrame = ooxmlElementFrame(next.element);
    if (!isDeepStrictEqual(currentFrame, nextFrame)) {
      operations.push({
        type: "update_element_frame",
        slideId: next.slideId,
        elementId: next.element.elementId,
        frame: nextFrame,
      });
    }
    if (!isDeepStrictEqual(current.element.props, next.element.props)) {
      operations.push({
        type: "update_element_props",
        slideId: next.slideId,
        elementId: next.element.elementId,
        props: changedOoxmlElementProps(
          current.element.props,
          next.element.props,
        ),
      });
    }
  }

  return operations;
}

function changedOoxmlElementProps(
  currentProps: DeckElement["props"],
  nextProps: DeckElement["props"],
): Record<string, unknown> {
  const current = currentProps as Record<string, unknown>;
  const next = nextProps as Record<string, unknown>;
  const changed: Record<string, unknown> = {};

  const propNames = new Set([...Object.keys(current), ...Object.keys(next)]);
  for (const propName of propNames) {
    if (!isDeepStrictEqual(current[propName], next[propName])) {
      changed[propName] = propName in next ? next[propName] : null;
    }
  }

  return changed;
}

function indexDeckElements(deck: Deck, includedSlideIds?: ReadonlySet<string>) {
  const elements = new Map<
    string,
    { slideId: Deck["slides"][number]["slideId"]; element: DeckElement }
  >();
  for (const slide of deck.slides) {
    if (includedSlideIds && !includedSlideIds.has(slide.slideId)) continue;
    for (const element of slide.elements) {
      elements.set(`${slide.slideId}\0${element.elementId}`, {
        slideId: slide.slideId,
        element,
      });
    }
  }
  return elements;
}

function ooxmlElementFrame(element: DeckElement) {
  return {
    role: element.role,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation,
    opacity: element.opacity,
    zIndex: element.zIndex,
    locked: element.locked,
    visible: element.visible,
  };
}

function parseAppendDeckPatchRequest(body: unknown): AppendDeckPatchRequest {
  const result = appendDeckPatchRequestSchema.safeParse(body);

  if (!result.success) {
    throwDeckApiException(
      "PATCH_VALIDATION_FAILED",
      HttpStatus.BAD_REQUEST,
      "Deck patch payload is invalid",
      formatZodError(result.error),
    );
  }

  return result.data;
}

function parseDeckRow(row: DeckRow | undefined): Deck {
  if (!row) {
    throwDeckApiException(
      "DECK_NOT_FOUND",
      HttpStatus.NOT_FOUND,
      "Deck row was not returned",
    );
  }

  return parseDeckJson(normalizeStoredDeckRowIdentity(row));
}

function parseDeckJson(deckJson: unknown): Deck {
  const result = deckSchema.safeParse(deckJson);

  if (result.success) {
    return result.data;
  }

  return deckSchema.parse(normalizeLegacyDeckKeywords(deckJson));
}

function replayPatchRows(
  checkpointDeck: Deck,
  patchRows: DeckPatchRow[],
): Deck {
  let workingDeck = checkpointDeck;
  let expectedBeforeVersion = checkpointDeck.version;

  for (const patchRow of patchRows) {
    if (
      patchRow.project_id !== checkpointDeck.projectId ||
      patchRow.deck_id !== checkpointDeck.deckId
    ) {
      throwDeckApiException(
        "PATCH_CHAIN_INVALID",
        HttpStatus.CONFLICT,
        "Stored patch history does not belong to the checkpoint deck",
        [
          `deck.projectId=${checkpointDeck.projectId}`,
          `patch.projectId=${patchRow.project_id}`,
          `deck.deckId=${checkpointDeck.deckId}`,
          `patch.deckId=${patchRow.deck_id}`,
          `patch.changeId=${patchRow.change_id}`,
        ],
      );
    }

    if (patchRow.before_version !== expectedBeforeVersion) {
      throwDeckApiException(
        expectedBeforeVersion === checkpointDeck.version
          ? "PATCH_CHAIN_CHECKPOINT_MISMATCH"
          : "PATCH_CHAIN_INVALID",
        HttpStatus.CONFLICT,
        expectedBeforeVersion === checkpointDeck.version
          ? "Stored patch chain does not start from the checkpoint version"
          : "Stored patch chain has a version gap or duplicate transition",
        [
          `checkpoint.version=${checkpointDeck.version}`,
          `expected.beforeVersion=${expectedBeforeVersion}`,
          `patch.beforeVersion=${patchRow.before_version}`,
          `patch.changeId=${patchRow.change_id}`,
        ],
      );
    }

    if (patchRow.after_version !== patchRow.before_version + 1) {
      throwDeckApiException(
        "PATCH_CHAIN_INVALID",
        HttpStatus.CONFLICT,
        "Stored patch history has a non-sequential version transition",
        [
          `patch.beforeVersion=${patchRow.before_version}`,
          `patch.afterVersion=${patchRow.after_version}`,
          `patch.changeId=${patchRow.change_id}`,
        ],
      );
    }

    const patch = appendDeckPatchRequestSchema.shape.patch.parse({
      deckId: patchRow.deck_id,
      baseVersion: patchRow.before_version,
      source: patchRow.source,
      operations: patchRow.operations,
    });
    const result = applyDeckPatch(workingDeck, patch, {
      createdAt: toIso(patchRow.created_at),
    });

    if (!result.ok) {
      throwApplyPatchException(result.error);
    }

    if (result.deck.version !== patchRow.after_version) {
      throwDeckApiException(
        "PATCH_CHAIN_INVALID",
        HttpStatus.CONFLICT,
        "Stored patch history has an unexpected version transition",
        [
          `deck.version=${result.deck.version}`,
          `patch.afterVersion=${patchRow.after_version}`,
          `patch.changeId=${patchRow.change_id}`,
        ],
      );
    }

    workingDeck = result.deck;
    expectedBeforeVersion = patchRow.after_version;
  }

  return workingDeck;
}

function normalizeStoredDeckRowIdentity(row: DeckRow): unknown {
  if (!isRecord(row.deck_json)) {
    return row.deck_json;
  }

  return {
    ...row.deck_json,
    projectId: row.project_id,
    deckId: row.deck_id,
  };
}

function normalizeLegacyDeckKeywords(deckJson: unknown): unknown {
  if (!isRecord(deckJson) || !Array.isArray(deckJson.slides)) {
    return deckJson;
  }

  return {
    ...deckJson,
    slides: deckJson.slides.map((slide) => {
      if (!isRecord(slide) || !Array.isArray(slide.keywords)) {
        return slide;
      }

      return {
        ...slide,
        keywords: normalizeLegacySlideKeywords(slide.keywords),
      };
    }),
  };
}

function normalizeLegacySlideKeywords(keywords: unknown[]): unknown[] {
  const normalizedKeywords: unknown[] = [];
  const keywordByTerm = new Map<string, Record<string, unknown>>();

  for (const [index, keyword] of keywords.entries()) {
    if (!isRecord(keyword)) {
      normalizedKeywords.push(keyword);
      continue;
    }

    const text = normalizeLegacyKeywordTerm(keyword.text);

    if (!text) {
      if (typeof keyword.text !== "string") {
        normalizedKeywords.push(keyword);
      }
      continue;
    }

    const textKey = normalizeLegacyKeywordTermKey(text);
    const existingKeyword = keywordByTerm.get(textKey);

    if (existingKeyword) {
      existingKeyword.synonyms = appendLegacyKeywordTerms(
        existingKeyword.synonyms,
        keyword.synonyms,
        keywordByTerm,
        existingKeyword,
      );
      existingKeyword.abbreviations = appendLegacyKeywordTerms(
        existingKeyword.abbreviations,
        keyword.abbreviations,
        keywordByTerm,
        existingKeyword,
      );
      continue;
    }

    const normalizedKeyword: Record<string, unknown> = {
      ...keyword,
      keywordId: normalizeLegacyKeywordId(keyword.keywordId, index),
      text,
      synonyms: [],
      abbreviations: [],
    };

    keywordByTerm.set(textKey, normalizedKeyword);
    normalizedKeyword.synonyms = appendLegacyKeywordTerms(
      normalizedKeyword.synonyms,
      keyword.synonyms,
      keywordByTerm,
      normalizedKeyword,
    );
    normalizedKeyword.abbreviations = appendLegacyKeywordTerms(
      normalizedKeyword.abbreviations,
      keyword.abbreviations,
      keywordByTerm,
      normalizedKeyword,
    );
    normalizedKeywords.push(normalizedKeyword);
  }

  return normalizedKeywords;
}

function normalizeLegacyKeywordId(value: unknown, index: number): string {
  if (typeof value === "string" && /^kw_[A-Za-z0-9_-]+$/.test(value)) {
    return value;
  }

  const normalizedValue =
    typeof value === "string" || typeof value === "number"
      ? String(value)
          .trim()
          .replace(/[^A-Za-z0-9_-]/g, "_")
      : "";

  return `kw_legacy_${normalizedValue || index + 1}`;
}

function appendLegacyKeywordTerms(
  current: unknown,
  incoming: unknown,
  keywordByTerm: Map<string, Record<string, unknown>>,
  ownerKeyword: Record<string, unknown>,
): unknown {
  if (incoming === undefined) {
    return current;
  }

  if (!Array.isArray(incoming)) {
    return incoming;
  }

  const terms = Array.isArray(current) ? [...current] : [];

  for (const term of incoming) {
    const normalizedTerm = normalizeLegacyKeywordTerm(term);

    if (!normalizedTerm) {
      if (typeof term !== "string") {
        terms.push(term);
      }
      continue;
    }

    const termKey = normalizeLegacyKeywordTermKey(normalizedTerm);

    if (keywordByTerm.has(termKey)) {
      continue;
    }

    keywordByTerm.set(termKey, ownerKeyword);
    terms.push(normalizedTerm);
  }

  return terms;
}

function normalizeLegacyKeywordTerm(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const term = value.trim();
  return term.length > 0 ? term : undefined;
}

function normalizeLegacyKeywordTermKey(value: string): string {
  return value.toLocaleLowerCase("ko-KR");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSnapshotRow(row: DeckSnapshotRow): DeckSnapshot {
  return deckSnapshotSchema.parse({
    snapshotId: row.snapshot_id,
    projectId: row.project_id,
    deckId: row.deck_id,
    version: row.version,
    reason: row.reason,
    createdAt: toIso(row.created_at),
  });
}

function throwApplyPatchException(error: ApplyDeckPatchError): never {
  if (error.code === "BASE_VERSION_MISMATCH") {
    throwDeckApiException(
      "STALE_BASE_VERSION",
      HttpStatus.CONFLICT,
      error.message,
      error.details ?? [],
    );
  }

  if (error.code === "PATCH_VALIDATION_FAILED") {
    throwDeckApiException(
      "PATCH_VALIDATION_FAILED",
      HttpStatus.BAD_REQUEST,
      error.message,
      error.details ?? [],
    );
  }

  if (error.code === "DECK_VALIDATION_FAILED") {
    throwDeckApiException(
      "DECK_VALIDATION_FAILED",
      HttpStatus.BAD_REQUEST,
      error.message,
      error.details ?? [],
    );
  }

  throwDeckApiException(
    "PATCH_APPLY_FAILED",
    HttpStatus.BAD_REQUEST,
    error.message,
    error.details ?? [],
  );
}

function throwDeckApiException(
  code: DeckApiErrorCode,
  status: HttpStatus,
  message: string,
  details: string[] = [],
): never {
  const error = deckApiErrorSchema.parse({
    code,
    message,
    details,
  } satisfies DeckApiError);

  throw new HttpException(error, status);
}

function formatZodError(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function nowIso(): string {
  return new Date().toISOString();
}
