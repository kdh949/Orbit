import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  applyDeckPatch,
  removeLegacyAiGeneratedTitleAnimations,
} from "@orbit/editor-core/patches";
import type { ApplyDeckPatchError } from "@orbit/editor-core/patches";
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
  appendDeckPatchRequestSchema,
  deckApiErrorSchema,
  deckSchema,
  deckSnapshotIdSchema,
  deckSnapshotReasonSchema,
  deckSnapshotSchema,
  PPTX_OOXML_SYNC_CAPABILITY_VERSION,
  putDeckRequestSchema,
  recoverTemplateBlueprintSlideIds,
  templateBlueprintSchema,
} from "@orbit/shared/deck";
import type {
  AppendDeckPatchRequest,
  Deck,
  DeckApiError,
  DeckApiErrorCode,
  DeckChangeRecord,
  DeckElement,
  DeckPatchOperation,
  DeckSnapshot,
  DeckSnapshotReason,
  OoxmlSyncState,
  PutDeckRequest,
  TemplateBlueprint,
} from "@orbit/shared/deck";
import type { Job } from "@orbit/shared/jobs";
import { HttpException, HttpStatus } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { DataSource, EntityManager } from "typeorm";
import { ZodError } from "zod";
import { JobsService } from "../../jobs/jobs.service";
import { isAsyncJobAdmissionDraining } from "../../jobs/async-job-admission";

export type DeckRow = {
  project_id: string;
  deck_id: string;
  deck_json: unknown;
  version: number;
  updated_at: Date | string;
};

export type DeckSnapshotRow = {
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

export type PptxImportQualityRow = {
  quality_report_json: unknown;
};

export type PptxNotesPreviewAssetRow = {
  file_id: string;
  project_id: string;
  purpose: string;
  status: string;
  mime_type: string;
};

export type OoxmlTemplateBlueprint = TemplateBlueprintRow & {
  blueprint: TemplateBlueprint;
};

export type PptxOoxmlSyncJobInput = {
  deckId: string;
  changeId: string;
  targetDeckVersion: number;
};

type DeckExportEnqueueJob = (input: EnqueueDeckExportJobInput) => Promise<void>;
type QueryExecutor = DataSource | EntityManager;
export const deckCheckpointPatchInterval = 20;
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

export type InitialDeckWriteResult = {
  deck: Deck;
  snapshot: DeckSnapshot;
  updatedAt: string;
};

export class DeckUseCasesBase {
  constructor(
    protected readonly dataSource: DataSource,
    protected readonly jobsService?: JobsService,
    protected readonly enqueueSyncJob: PptxOoxmlSyncEnqueueJob = enqueuePptxOoxmlSyncJob,
    protected readonly enqueueDeckExport: DeckExportEnqueueJob = enqueueDeckExportJob,
    protected readonly enqueueSemanticCueJob: SemanticCueExtractionEnqueueJob = enqueueSemanticCueExtractionJob,
    protected readonly logger?: PinoLogger,
    protected readonly enqueueSpeakerNotesSuggestion: SpeakerNotesSuggestionEnqueueJob = enqueueSpeakerNotesSuggestionJob,
  ) {}

  protected async assertExportSession(
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

  protected async readCurrentDeckState(
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

  protected async findDeckRow(
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

  protected async findProjectDeckRowForUpdate(
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

  protected async findDeckRowForUpdate(
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

  protected async findPatchRowsAfterVersion(
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

  protected async upsertDeck(
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

  protected async updateProjectTitle(
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

  protected async writeDeckCheckpoint(
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

  protected async insertPatchLog(
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

  protected async createSnapshot(
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

  protected async findEquivalentRestoreSnapshot(
    executor: QueryExecutor,
    deck: Deck,
  ): Promise<DeckSnapshotRow | undefined> {
    const rows = await executor.query<DeckSnapshotRow[]>(
      `
        SELECT snapshot_id, project_id, deck_id, deck_json, version, reason, created_at
        FROM deck_snapshots
        WHERE project_id = $1
          AND deck_id = $2
          AND version = $3
          AND reason = $4
        ORDER BY created_at DESC, snapshot_id DESC
      `,
      [deck.projectId, deck.deckId, deck.version, "snapshot-restore"],
    );

    return rows.find((row) =>
      isDeepStrictEqual(
        removeLegacyAiGeneratedTitleAnimations(parseDeckJson(row.deck_json)),
        deck,
      ),
    );
  }

  protected async deletePatchRowsAfterVersion(
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

  protected async deletePatchRowsUpToVersion(
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

  protected async findSnapshotRow(
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

  protected async findOoxmlTemplateBlueprint(
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

  protected async readOoxmlSyncState(
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

    const syncedDeckVersion = imported.blueprint.ooxmlSyncedDeckVersion ?? null;
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

    const attemptedCapabilityVersion = readSyncCapabilityVersion(job);
    return {
      status,
      deckId: deck.deckId,
      deckVersion: deck.version,
      syncedDeckVersion,
      retryable:
        status === "stale" ||
        (status === "failed" &&
          (job?.error?.retryable === true ||
            attemptedCapabilityVersion < PPTX_OOXML_SYNC_CAPABILITY_VERSION)),
      ...(job ? { job } : {}),
    };
  }

  protected async enqueueOoxmlSync(
    projectId: string,
    input: PptxOoxmlSyncJobInput,
  ) {
    if (!this.jobsService) {
      return undefined;
    }
    if (isAsyncJobAdmissionDraining()) {
      this.logger?.info(
        {
          event: "pptx_ooxml.sync.skipped_admission_drain",
          projectId,
          deckId: input.deckId,
          targetDeckVersion: input.targetDeckVersion,
        },
        "PPTX OOXML sync was skipped while asynchronous job admission is draining.",
      );
      return undefined;
    }

    const versionedInput = {
      ...input,
      syncCapabilityVersion: PPTX_OOXML_SYNC_CAPABILITY_VERSION,
    };
    const queuedJob = await this.jobsService.create({
      projectId,
      type: "pptx-ooxml-sync",
      payload: versionedInput,
    });

    try {
      const config = loadOrbitConfig(process.env, { service: "api" });
      await this.enqueueSyncJob({
        driver: config.JOB_QUEUE_DRIVER,
        redisUrl: config.REDIS_URL,
        jobId: queuedJob.jobId,
        projectId,
        ...versionedInput,
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
            retryable: true,
            syncCapabilityVersion: PPTX_OOXML_SYNC_CAPABILITY_VERSION,
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

function readSyncCapabilityVersion(job: Job | null | undefined): number {
  const resultVersion = job?.result?.syncCapabilityVersion;
  return (
    job?.error?.syncCapabilityVersion ??
    (typeof resultVersion === "number" && Number.isInteger(resultVersion)
      ? resultVersion
      : 1)
  );
}

export function parsePutDeckRequest(body: unknown): PutDeckRequest {
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

export function createOoxmlReplacement(
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
    ...createOoxmlSpeakerNotesDiff(currentDeck, deck),
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

function createOoxmlSpeakerNotesDiff(
  currentDeck: Deck,
  nextDeck: Deck,
): DeckPatchOperation[] {
  const currentSlides = new Map(
    currentDeck.slides.map((slide) => [slide.slideId, slide]),
  );
  return nextDeck.slides.flatMap((slide) => {
    const current = currentSlides.get(slide.slideId);
    if (!current || current.speakerNotes === slide.speakerNotes) return [];
    return [
      {
        type: "update_speaker_notes" as const,
        slideId: slide.slideId,
        speakerNotes: slide.speakerNotes,
      },
    ];
  });
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

export function parseAppendDeckPatchRequest(
  body: unknown,
): AppendDeckPatchRequest {
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

export function parseDeckRow(row: DeckRow | undefined): Deck {
  if (!row) {
    throwDeckApiException(
      "DECK_NOT_FOUND",
      HttpStatus.NOT_FOUND,
      "Deck row was not returned",
    );
  }

  return parseDeckJson(normalizeStoredDeckRowIdentity(row));
}

export function parseDeckJson(deckJson: unknown): Deck {
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

export function deduplicateRestoreSnapshotRows(
  rows: DeckSnapshotRow[],
): DeckSnapshotRow[] {
  const restoreStates: Array<{ deckId: string; deck: Deck }> = [];

  return rows.filter((row) => {
    if (row.reason !== "snapshot-restore") return true;

    const deck = removeLegacyAiGeneratedTitleAnimations(
      parseDeckJson(row.deck_json),
    );
    const isDuplicate = restoreStates.some(
      (state) =>
        state.deckId === row.deck_id && isDeepStrictEqual(state.deck, deck),
    );
    if (isDuplicate) return false;

    restoreStates.push({ deckId: row.deck_id, deck });
    return true;
  });
}

export function parseSnapshotRow(row: DeckSnapshotRow): DeckSnapshot {
  return deckSnapshotSchema.parse({
    snapshotId: row.snapshot_id,
    projectId: row.project_id,
    deckId: row.deck_id,
    version: row.version,
    reason: row.reason,
    createdAt: toIso(row.created_at),
  });
}

export function throwApplyPatchException(error: ApplyDeckPatchError): never {
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

export function throwDeckApiException(
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

export function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

export function nowIso(): string {
  return new Date().toISOString();
}
