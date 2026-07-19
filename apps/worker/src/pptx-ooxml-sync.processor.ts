import {
  animationSchema,
  deckCanvasSchema,
  deckPatchOperationSchema,
  deckPatchOperationTypeSchema,
  deckSchema,
  ooxmlMotionCapabilitiesSchema,
  pptxOoxmlSyncJobResultSchema,
  recoverTemplateBlueprintSlideIds,
  slideTransitionSchema,
  templateElementSourceSchema,
  templateBlueprintSchema,
  type Deck,
  type DeckPatchOperation,
  type Job,
  type TemplateBlueprint,
} from "@orbit/shared";
import type { StoragePort } from "@orbit/storage";
import { randomUUID } from "crypto";
import type { DataSource } from "typeorm";
import { z } from "zod";

const pptxOoxmlSyncPayloadSchema = z.object({
  jobId: z.string().min(1),
  projectId: z.string().min(1),
  deckId: z.string().min(1),
  changeId: z.string().min(1),
  targetDeckVersion: z.number().int().positive(),
});

const syncAssetSchema = z.object({
  assetId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  contentBase64: z.string().min(1),
});

const ooxmlSyncOperationTypeSchema = z.enum([
  "add_slide",
  "delete_slide",
  "add_element",
  "update_element_frame",
  "update_element_props",
  "delete_element",
  "reorder_slides",
]);

const ooxmlUnsupportedReasonCodeSchema = z.enum([
  "ADD_SLIDE_FAILED",
  "ADD_SLIDE_LAYOUT_UNSAFE",
  "ADD_ELEMENT_FAILED",
  "ADD_ELEMENT_TYPE_UNSUPPORTED",
  "CROP_CAPABILITY_UNSAFE",
  "DELETE_SLIDE_FAILED",
  "DELETE_SLIDE_LOCATOR_UNSAFE",
  "DELETE_SLIDE_RELATIONSHIP_UNSAFE",
  "RICH_TEXT_CAPABILITY_UNSAFE",
  "ELEMENT_TYPE_MISMATCH",
  "FRAME_FIELDS_UNSUPPORTED",
  "GROUPED_FRAME_UNSUPPORTED",
  "MOTION_REFERENCE_COVERAGE_UNSAFE",
  "OPERATION_TYPE_UNSUPPORTED",
  "PROPS_FIELDS_UNSUPPORTED",
  "PROPS_UPDATE_FAILED",
  "SHAPE_MISSING",
  "SHARED_SHAPE_COHORT_UNSAFE",
  "SLIDE_PART_MISSING",
  "SLIDE_REORDER_LOCATOR_UNSAFE",
  "SLIDE_REORDER_PERMUTATION_INVALID",
  "SLIDE_REORDER_RELATIONSHIP_UNSAFE",
  "LAST_SLIDE_DELETE_FORBIDDEN",
  "SOURCE_MISSING",
  "SOURCE_NOT_WRITABLE",
  "SOURCE_PROVENANCE_UNSAFE",
  "SYNC_RESPONSE_INCOMPLETE",
  "TABLE_CELL_CAPABILITY_UNSAFE",
  "TABLE_STRUCTURE_UNSUPPORTED",
]);

const ooxmlAppliedOperationSchema = z
  .object({
    operationType: ooxmlSyncOperationTypeSchema,
    slideId: z.string().min(1).optional(),
    elementId: z.string().min(1).optional(),
  })
  .strict();

const ooxmlUnsupportedOperationSchema = z
  .object({
    operationType: deckPatchOperationTypeSchema,
    slideId: z.string().min(1).optional(),
    elementId: z.string().min(1).optional(),
    reasonCode: ooxmlUnsupportedReasonCodeSchema,
  })
  .strict();

const slideMotionTouchedSchema = z
  .object({
    transition: z.boolean(),
    animations: z.boolean(),
  })
  .strict();

const slideMotionSyncInputSchema = z
  .object({
    slideId: z.string().min(1),
    sourceSlidePart: z
      .string()
      .regex(/^ppt\/slides\/slide[^/]+\.xml$/)
      .optional(),
    transition: slideTransitionSchema.nullable(),
    animations: z.array(animationSchema),
    capabilities: ooxmlMotionCapabilitiesSchema,
    touched: slideMotionTouchedSchema,
  })
  .strict();

const appliedSlideMotionSchema = z
  .object({
    slideId: z.string().min(1),
    transition: z.boolean(),
    animations: z.boolean(),
  })
  .strict();

const unsupportedSlideMotionSchema = z
  .object({
    slideId: z.string().min(1),
    scope: z.enum(["transition", "animations"]),
    reasonCode: z.enum([
      "SLIDE_MOTION_SOURCE_MISSING",
      "SLIDE_MOTION_PAYLOAD_INVALID",
      "SLIDE_TRANSITION_CAPABILITY_UNSAFE",
      "SLIDE_TRANSITION_UNSUPPORTED",
      "SLIDE_ANIMATION_CAPABILITY_UNSAFE",
      "SLIDE_ANIMATION_UNSUPPORTED",
      "SLIDE_ANIMATION_TARGET_UNRESOLVED",
      "SLIDE_MOTION_STRUCTURE_UNSUPPORTED",
      "SLIDE_MOTION_SYNC_RESPONSE_INCOMPLETE",
    ]),
  })
  .strict();

const pptxOoxmlSyncWorkerResponseSchema = z.object({
  assets: z.array(syncAssetSchema).default([]),
  elementSources: z.array(templateElementSourceSchema).max(500).default([]),
  appliedOperations: z.array(ooxmlAppliedOperationSchema).max(500).default([]),
  unsupportedOperations: z
    .array(ooxmlUnsupportedOperationSchema)
    .max(500)
    .default([]),
  appliedSlideMotion: z.array(appliedSlideMotionSchema).max(500).default([]),
  unsupportedSlideMotion: z
    .array(unsupportedSlideMotionSchema)
    .max(500)
    .default([]),
  warnings: z.array(z.string()).default([]),
});

type PptxOoxmlSyncWorkerResponse = z.infer<
  typeof pptxOoxmlSyncWorkerResponseSchema
>;
type OoxmlSyncOperation = Extract<
  DeckPatchOperation,
  {
    type:
      | "add_element"
      | "add_slide"
      | "delete_slide"
      | "update_element_frame"
      | "update_element_props"
      | "delete_element"
      | "reorder_slides";
  }
>;
type OoxmlMotionOperation = Extract<
  DeckPatchOperation,
  {
    type:
      | "update_slide_transition"
      | "add_animation"
      | "update_animation"
      | "delete_animation";
  }
>;
type SlideMotionSyncInput = z.infer<typeof slideMotionSyncInputSchema>;

type JobRow = {
  job_id: string;
  project_id: string;
  type: Job["type"];
  status: Job["status"];
  progress: number;
  message: string;
  result: Record<string, unknown> | null;
  error: { code: string; message: string; retryable?: boolean } | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ProjectAssetRow = {
  file_id: string;
  project_id: string;
  storage_key: string;
  mime_type: string;
  original_name: string;
  size: number;
  purpose: string;
  status: string;
};

type TemplateBlueprintRow = {
  template_id: string;
  blueprint_json: unknown;
  quality_report_json: unknown;
};

type DeckRow = {
  deck_json: unknown;
  version: number;
};

type DeckPatchRow = {
  operations: DeckPatchOperation[];
};

type SavedSyncAssets = {
  currentPackageFileId: string;
  renderAssetFileIds: string[];
  renderAssetFileIdsByAssetId: Map<string, string>;
};

type QueryExecutor = Pick<DataSource, "query">;

type ImageAssetRow = {
  file_id: string;
  project_id: string;
  storage_key: string;
  mime_type: string;
  status: string;
};

const pptxMimeType =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const jsonMimeType = "application/json";
export const ooxmlSyncJsonPartLimits = {
  template_blueprint: 16 * 1024 * 1024,
  operations: 72 * 1024 * 1024,
  deck_canvas: 4 * 1024,
  slide_motion: 16 * 1024 * 1024,
} as const;

const ooxmlSyncTransportErrorDetailSchema = z.object({
  detail: z.object({
    code: z.enum([
      "PPTX_OOXML_SYNC_PACKAGE_MIME_INVALID",
      "PPTX_OOXML_SYNC_PACKAGE_TOO_LARGE",
      "PPTX_OOXML_SYNC_PART_DUPLICATED",
      "PPTX_OOXML_SYNC_PART_MIME_INVALID",
      "PPTX_OOXML_SYNC_PART_MISSING",
      "PPTX_OOXML_SYNC_PART_TOO_LARGE",
      "PPTX_OOXML_SYNC_JSON_INVALID",
      "PPTX_OOXML_SYNC_JSON_SCHEMA_INVALID",
    ]),
    field: z.enum([
      "file",
      "template_blueprint",
      "operations",
      "deck_canvas",
      "slide_motion",
    ]),
    maxBytes: z.number().int().positive().optional(),
  }),
});

class UnsupportedOoxmlOperationsError extends Error {
  constructor(
    readonly operation: z.infer<typeof ooxmlUnsupportedOperationSchema>,
  ) {
    const target = [operation.slideId, operation.elementId]
      .filter(Boolean)
      .join(":");
    super(
      `${operation.operationType}:${operation.reasonCode}${target ? `:${target}` : ""}`,
    );
    this.name = "UnsupportedOoxmlOperationsError";
  }
}

class UnsupportedOoxmlSlideMotionError extends Error {
  constructor(
    readonly motion: z.infer<typeof unsupportedSlideMotionSchema>,
  ) {
    super(`${motion.slideId}:${motion.scope}:${motion.reasonCode}`);
    this.name = "UnsupportedOoxmlSlideMotionError";
  }
}

export class OoxmlSyncTransportError extends Error {
  constructor(
    readonly code: z.infer<
      typeof ooxmlSyncTransportErrorDetailSchema
    >["detail"]["code"],
    readonly field: z.infer<
      typeof ooxmlSyncTransportErrorDetailSchema
    >["detail"]["field"],
    readonly maxBytes?: number,
  ) {
    super(`${code}:${field}${maxBytes === undefined ? "" : `:${maxBytes}`}`);
    this.name = "OoxmlSyncTransportError";
  }
}

export async function processPptxOoxmlSyncJob(
  dataSource: DataSource,
  storage: Pick<StoragePort, "getSignedReadUrl" | "putObject">,
  pythonWorkerUrl: string,
  rawPayload: unknown,
): Promise<Job> {
  const payloadResult = pptxOoxmlSyncPayloadSchema.safeParse(rawPayload);
  if (!payloadResult.success) {
    const jobId = readRawJobId(rawPayload);
    if (!jobId) {
      throw new Error(payloadResult.error.message);
    }
    return failJob(
      dataSource,
      jobId,
      0,
      "PPTX_OOXML_SYNC_PAYLOAD_INVALID",
      payloadResult.error.message,
    );
  }

  const payload = payloadResult.data;
  await updateJob(dataSource, payload.jobId, {
    status: "running",
    progress: 10,
    message: "PPTX OOXML sync running.",
    result: null,
    error: null,
  });

  try {
    return await dataSource.transaction(async (manager) => {
      await acquireDeckAdvisoryLock(manager, payload.projectId, payload.deckId);

      const templateRow = await loadTemplateBlueprintRow(
        manager,
        payload.projectId,
        payload.deckId,
      );
      const parsedTemplateBlueprint = templateBlueprintSchema.parse(
        templateRow.blueprint_json,
      );
      const deck = await loadStoredDeck(
        manager,
        payload.projectId,
        payload.deckId,
      );
      const storedDeck = deckSchema.parse(deck.deck_json);
      const recoveredTemplateBlueprint =
        recoverTemplateBlueprintForPendingSlides(
          parsedTemplateBlueprint,
          storedDeck,
        );
      if (!recoveredTemplateBlueprint) {
        throw new UnsupportedOoxmlOperationsError({
          operationType: "reorder_slides",
          reasonCode: "SLIDE_REORDER_LOCATOR_UNSAFE",
        });
      }
      const templateBlueprint = recoveredTemplateBlueprint.blueprint;
      const latestDeckVersion = deck.version;
      const syncedDeckVersion = templateBlueprint.ooxmlSyncedDeckVersion ?? 1;

      if (syncedDeckVersion >= latestDeckVersion) {
        await compactSyncedPatches(
          manager,
          payload.projectId,
          payload.deckId,
          latestDeckVersion,
        );
        return completeSyncJob(manager, payload, {
          templateId: templateBlueprint.templateId,
          currentPackageFileId: currentPackageFileId(templateBlueprint),
          renderAssetFileIds: templateBlueprint.slides.flatMap((slide) =>
            slide.renderAssetFileId ? [slide.renderAssetFileId] : [],
          ),
          syncedDeckVersion,
          warnings: [],
        });
      }

      const packageAsset = await loadPackageAsset(
        manager,
        payload.projectId,
        currentPackageFileId(templateBlueprint),
      );
      const operations = compactTransientElementOperations(
        await loadUnsyncedPatchOperations(
          manager,
          payload.projectId,
          payload.deckId,
          syncedDeckVersion,
          latestDeckVersion,
        ),
        templateBlueprint,
        storedDeck,
      );
      const currentLogicalGroupElementIds = storedDeck.slides.flatMap((slide) =>
        slide.elements
          .filter((element) => element.type === "group")
          .map((element) => element.elementId),
      );
      const knownLogicalGroupElementIds = new Set([
        ...templateBlueprint.logicalGroupElementIds,
        ...currentLogicalGroupElementIds,
        ...operations.flatMap((operation) =>
          operation.type === "add_element" && operation.element.type === "group"
            ? [operation.element.elementId]
            : [],
        ),
      ]);
      const rawPackageOperations = operations.filter(
        (operation) =>
          !isLogicalGroupOperation(operation, knownLogicalGroupElementIds),
      );
      const blueprintWithLogicalGroups = templateBlueprintSchema.parse({
        ...templateBlueprint,
        logicalGroupElementIds: currentLogicalGroupElementIds,
      });
      const packageOperations = replayAndCompactSlideOperations(
        rawPackageOperations,
        blueprintWithLogicalGroups,
        storedDeck,
      );
      const unsupportedPendingOperation = packageOperations.find(
        (operation) =>
          !isOoxmlSyncOperation(operation) &&
          !isOoxmlMotionOperation(operation) &&
          !isOoxmlPackageNeutralOperation(operation),
      );
      if (unsupportedPendingOperation) {
        throw new UnsupportedOoxmlOperationsError({
          ...operationIdentity(unsupportedPendingOperation),
          reasonCode: "OPERATION_TYPE_UNSUPPORTED",
        });
      }
      const embeddedOperations = await embedProjectImageAssets(
        manager,
        storage,
        payload.projectId,
        packageOperations,
      );
      const syncPlan = prepareAuthoredSlideSync(
        blueprintWithLogicalGroups,
        embeddedOperations,
      );
      const synced = await syncPptxOoxmlWithPython(
        storage,
        pythonWorkerUrl,
        latestDeckVersion,
        packageAsset,
        syncPlan.templateBlueprint,
        storedDeck,
        syncPlan.operations,
      );
      const savedAssets = await saveSyncAssets(
        manager,
        storage,
        payload.projectId,
        synced,
      );
      const nextTemplateBlueprint = withSyncResult(
        syncPlan.templateBlueprint,
        savedAssets,
        latestDeckVersion,
        synced,
        storedDeck,
      );
      const updated = await updateTemplateBlueprintConditionally(
        manager,
        payload.projectId,
        payload.deckId,
        nextTemplateBlueprint,
        latestDeckVersion,
      );
      if (!updated) {
        throw new Error(
          `A newer PPTX OOXML package already exists for deck: ${payload.deckId}`,
        );
      }
      await compactSyncedPatches(
        manager,
        payload.projectId,
        payload.deckId,
        latestDeckVersion,
      );

      return completeSyncJob(manager, payload, {
        templateId: nextTemplateBlueprint.templateId,
        currentPackageFileId: savedAssets.currentPackageFileId,
        renderAssetFileIds: savedAssets.renderAssetFileIds,
        syncedDeckVersion: latestDeckVersion,
        warnings: synced.warnings,
      });
    });
  } catch (error) {
    if (
      error instanceof UnsupportedOoxmlOperationsError ||
      error instanceof UnsupportedOoxmlSlideMotionError
    ) {
      return failJob(
        dataSource,
        payload.jobId,
        50,
        "PPTX_OOXML_SYNC_UNSUPPORTED_OPERATION",
        error.message,
        false,
      );
    }
    if (error instanceof OoxmlSyncTransportError) {
      return failJob(
        dataSource,
        payload.jobId,
        50,
        error.code,
        error.message,
        false,
      );
    }
    return failJob(
      dataSource,
      payload.jobId,
      50,
      "PPTX_OOXML_SYNC_FAILED",
      error instanceof Error ? error.message : "PPTX OOXML sync failed.",
    );
  }
}

async function loadTemplateBlueprintRow(
  dataSource: QueryExecutor,
  projectId: string,
  deckId: string,
): Promise<TemplateBlueprintRow> {
  const rows = readQueryRows<TemplateBlueprintRow>(
    await dataSource.query(
      `
        SELECT template_id, blueprint_json, quality_report_json
        FROM template_blueprints
        WHERE project_id = $1 AND deck_id = $2
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      [projectId, deckId],
    ),
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`Template blueprint not found for deck: ${deckId}`);
  }
  return row;
}

async function loadPackageAsset(
  dataSource: QueryExecutor,
  projectId: string,
  fileId: string,
): Promise<ProjectAssetRow> {
  const rows = readQueryRows<ProjectAssetRow>(
    await dataSource.query(
      `
        SELECT file_id, project_id, storage_key, mime_type, original_name, size, purpose, status
        FROM project_assets
        WHERE file_id = $1
      `,
      [fileId],
    ),
  );
  const asset = rows[0];
  if (!asset) {
    throw new Error(`PPTX package asset not found: ${fileId}`);
  }
  if (asset.project_id !== projectId) {
    throw new Error(`PPTX package asset project mismatch: ${fileId}`);
  }
  if (asset.status !== "uploaded" || asset.mime_type !== pptxMimeType) {
    throw new Error(
      `PPTX OOXML sync requires an uploaded PPTX package: ${fileId}`,
    );
  }
  return asset;
}

async function loadStoredDeck(
  dataSource: QueryExecutor,
  projectId: string,
  deckId: string,
): Promise<DeckRow> {
  const rows = readQueryRows<DeckRow>(
    await dataSource.query(
      `
        SELECT deck_json, version
        FROM decks
        WHERE project_id = $1 AND deck_id = $2
      `,
      [projectId, deckId],
    ),
  );
  const deck = rows[0];
  if (deck && isRecord(deck.deck_json)) {
    deckCanvasSchema.parse(deck.deck_json.canvas);
    return deck;
  }
  throw new Error(`Deck not found for OOXML sync: ${deckId}`);
}

async function loadUnsyncedPatchOperations(
  dataSource: QueryExecutor,
  projectId: string,
  deckId: string,
  syncedVersion: number,
  targetDeckVersion: number,
): Promise<DeckPatchOperation[]> {
  const rows = readQueryRows<DeckPatchRow>(
    await dataSource.query(
      `
        SELECT operations
        FROM deck_patches
        WHERE project_id = $1
          AND deck_id = $2
          AND after_version > $3
          AND after_version <= $4
        ORDER BY after_version ASC, created_at ASC, change_id ASC
      `,
      [projectId, deckId, syncedVersion, targetDeckVersion],
    ),
  );
  return rows.flatMap((row) => row.operations);
}

async function acquireDeckAdvisoryLock(
  dataSource: QueryExecutor,
  projectId: string,
  deckId: string,
): Promise<void> {
  await dataSource.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${projectId}:${deckId}`],
  );
}

async function compactSyncedPatches(
  dataSource: QueryExecutor,
  projectId: string,
  deckId: string,
  syncedDeckVersion: number,
): Promise<void> {
  await dataSource.query(
    `
      DELETE FROM deck_patches
      WHERE project_id = $1 AND deck_id = $2 AND after_version <= $3
    `,
    [projectId, deckId, syncedDeckVersion],
  );
}

async function completeSyncJob(
  dataSource: QueryExecutor,
  payload: z.infer<typeof pptxOoxmlSyncPayloadSchema>,
  resultInput: {
    templateId: string;
    currentPackageFileId: string;
    renderAssetFileIds: string[];
    syncedDeckVersion: number;
    warnings: string[];
  },
): Promise<Job> {
  const result = pptxOoxmlSyncJobResultSchema.parse({
    deckId: payload.deckId,
    ...resultInput,
  });
  return updateJob(dataSource, payload.jobId, {
    status: "succeeded",
    progress: 100,
    message: "PPTX OOXML sync completed.",
    result,
    error: null,
  });
}

async function embedProjectImageAssets(
  dataSource: QueryExecutor,
  storage: Pick<StoragePort, "getSignedReadUrl">,
  projectId: string,
  operations: DeckPatchOperation[],
): Promise<DeckPatchOperation[]> {
  const references = operations.flatMap((operation) => {
    return operationImageSources(operation).flatMap((src) => {
      const reference = parseInternalAssetReference(src);
      if (reference && reference.projectId !== projectId) {
        throw new Error(
          `OOXML image asset project mismatch: ${reference.fileId}`,
        );
      }
      return reference ? [reference] : [];
    });
  });
  const fileIds = [...new Set(references.map((reference) => reference.fileId))];
  if (fileIds.length === 0) return operations;

  const rows = readQueryRows<ImageAssetRow>(
    await dataSource.query(
      `
        SELECT file_id, project_id, storage_key, mime_type, status
        FROM project_assets
        WHERE file_id = ANY($1)
      `,
      [fileIds],
    ),
  );
  const assets = new Map(rows.map((row) => [row.file_id, row]));
  const dataUrls = new Map<string, string>();

  for (const fileId of fileIds) {
    const asset = assets.get(fileId);
    if (!asset) throw new Error(`OOXML image asset not found: ${fileId}`);
    if (asset.project_id !== projectId) {
      throw new Error(`OOXML image asset project mismatch: ${fileId}`);
    }
    if (
      asset.status !== "uploaded" ||
      !isSupportedImageMimeType(asset.mime_type)
    ) {
      throw new Error(`OOXML image asset must be an uploaded image: ${fileId}`);
    }
    const response = await fetch(
      await storage.getSignedReadUrl(asset.storage_key),
    );
    if (!response.ok) {
      throw new Error(`OOXML image asset content unavailable: ${fileId}`);
    }
    const content = Buffer.from(await response.arrayBuffer()).toString(
      "base64",
    );
    dataUrls.set(fileId, `data:${asset.mime_type};base64,${content}`);
  }

  return operations.map((operation) => {
    if (operation.type === "add_slide") {
      return deckPatchOperationSchema.parse({
        ...operation,
        slide: {
          ...operation.slide,
          elements: operation.slide.elements.map((element) => {
            if (element.type !== "image") return element;
            const reference = parseInternalAssetReference(element.props.src);
            const embedded = reference
              ? dataUrls.get(reference.fileId)
              : undefined;
            return embedded
              ? { ...element, props: { ...element.props, src: embedded } }
              : element;
          }),
        },
      });
    }
    const src = operationImageSources(operation)[0];
    const reference = src ? parseInternalAssetReference(src) : null;
    const dataUrl = reference ? dataUrls.get(reference.fileId) : undefined;
    if (!dataUrl) return operation;
    if (operation.type === "update_element_props") {
      return deckPatchOperationSchema.parse({
        ...operation,
        props: { ...operation.props, src: dataUrl },
      });
    }
    if (
      operation.type === "add_element" &&
      operation.element.type === "image"
    ) {
      return deckPatchOperationSchema.parse({
        ...operation,
        element: {
          ...operation.element,
          props: { ...operation.element.props, src: dataUrl },
        },
      });
    }
    return operation;
  });
}

function operationImageSources(operation: DeckPatchOperation): string[] {
  if (
    operation.type === "update_element_props" &&
    typeof operation.props.src === "string"
  ) {
    return [operation.props.src];
  }
  if (operation.type === "add_element" && operation.element.type === "image") {
    return [operation.element.props.src];
  }
  if (operation.type === "add_slide") {
    return operation.slide.elements.flatMap((element) =>
      element.type === "image" ? [element.props.src] : [],
    );
  }
  return [];
}

function parseInternalAssetReference(src: string) {
  const match = src.match(
    /^\/api\/v1\/projects\/([^/]+)\/assets\/([^/]+)\/content$/,
  );
  if (!match) return null;
  return {
    projectId: decodeURIComponent(match[1]),
    fileId: decodeURIComponent(match[2]),
  };
}

function isSupportedImageMimeType(mimeType: string): boolean {
  return ["image/jpeg", "image/png", "image/webp"].includes(mimeType);
}

async function syncPptxOoxmlWithPython(
  storage: Pick<StoragePort, "getSignedReadUrl">,
  pythonWorkerUrl: string,
  targetDeckVersion: number,
  asset: ProjectAssetRow,
  templateBlueprint: TemplateBlueprint,
  deck: Deck,
  operations: DeckPatchOperation[],
): Promise<PptxOoxmlSyncWorkerResponse> {
  const slideMotion = buildSlideMotionSyncInput(
    deck,
    templateBlueprint,
    operations,
  );
  const ooxmlOperations = operations
    .filter(isOoxmlSyncOperation)
    .map((operation) => withSourceSlideLocator(operation, templateBlueprint));
  const form = new FormData();
  appendJsonFilePart(
    form,
    "template_blueprint_file",
    "template-blueprint.json",
    "template_blueprint",
    templateBlueprint,
  );
  appendJsonFilePart(
    form,
    "operations_file",
    "operations.json",
    "operations",
    ooxmlOperations,
  );
  appendJsonFilePart(
    form,
    "slide_motion_file",
    "slide-motion.json",
    "slide_motion",
    slideMotion,
  );
  appendJsonFilePart(
    form,
    "deck_canvas_file",
    "deck-canvas.json",
    "deck_canvas",
    deck.canvas,
  );
  form.append("synced_deck_version", String(targetDeckVersion));
  form.append("render", "true");

  const readUrl = await storage.getSignedReadUrl(asset.storage_key);
  const sourceResponse = await fetch(readUrl);
  if (!sourceResponse.ok) {
    throw new Error(`PPTX package content unavailable: ${asset.file_id}`);
  }

  form.append(
    "file",
    new Blob([Buffer.from(await sourceResponse.arrayBuffer())], {
      type: asset.mime_type,
    }),
    asset.original_name,
  );

  const response = await fetch(
    workerUrl(pythonWorkerUrl, "/ai/pptx-ooxml-sync"),
    {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(180_000),
    },
  );

  if (!response.ok) {
    throw await parseOoxmlSyncFailure(response);
  }

  const synced = pptxOoxmlSyncWorkerResponseSchema.parse(await response.json());
  const unsupported = synced.unsupportedOperations[0];
  if (unsupported) {
    throw new UnsupportedOoxmlOperationsError(unsupported);
  }
  const unsupportedMotion = synced.unsupportedSlideMotion[0];
  if (unsupportedMotion) {
    throw new UnsupportedOoxmlSlideMotionError(unsupportedMotion);
  }
  const incompleteOperation = findIncompleteAppliedOperation(
    ooxmlOperations,
    synced.appliedOperations,
  );
  if (incompleteOperation) {
    throw new UnsupportedOoxmlOperationsError(incompleteOperation);
  }
  const incompleteMotion = findIncompleteAppliedSlideMotion(
    slideMotion,
    synced.appliedSlideMotion,
  );
  if (incompleteMotion) {
    throw new UnsupportedOoxmlSlideMotionError(incompleteMotion);
  }
  return synced;
}

export function appendJsonFilePart(
  form: FormData,
  multipartField: string,
  fileName: string,
  logicalField: keyof typeof ooxmlSyncJsonPartLimits,
  value: unknown,
): void {
  const content = JSON.stringify(value);
  const maxBytes = ooxmlSyncJsonPartLimits[logicalField];
  if (Buffer.byteLength(content, "utf8") > maxBytes) {
    throw new OoxmlSyncTransportError(
      "PPTX_OOXML_SYNC_PART_TOO_LARGE",
      logicalField,
      maxBytes,
    );
  }
  form.append(
    multipartField,
    new Blob([content], { type: jsonMimeType }),
    fileName,
  );
}

async function parseOoxmlSyncFailure(response: Response): Promise<Error> {
  try {
    const parsed = ooxmlSyncTransportErrorDetailSchema.safeParse(
      await response.json(),
    );
    if (parsed.success) {
      return new OoxmlSyncTransportError(
        parsed.data.detail.code,
        parsed.data.detail.field,
        parsed.data.detail.maxBytes,
      );
    }
  } catch {
    // The bounded generic error below deliberately excludes provider response text.
  }
  return new Error(
    `Python worker PPTX sync failed with HTTP ${response.status}.`,
  );
}

function findIncompleteAppliedOperation(
  operations: OoxmlSyncOperation[],
  appliedOperations: PptxOoxmlSyncWorkerResponse["appliedOperations"],
): z.infer<typeof ooxmlUnsupportedOperationSchema> | null {
  const comparisonLength = Math.max(
    operations.length,
    appliedOperations.length,
  );
  for (let index = 0; index < comparisonLength; index += 1) {
    const operation = operations[index];
    const applied = appliedOperations[index];
    if (operation && matchesAppliedOperation(operation, applied)) continue;

    const identity = operation ? operationIdentity(operation) : applied;
    if (identity) {
      return {
        operationType: identity.operationType,
        slideId: identity.slideId,
        elementId: identity.elementId,
        reasonCode: "SYNC_RESPONSE_INCOMPLETE",
      };
    }
  }
  return null;
}

function findIncompleteAppliedSlideMotion(
  expected: SlideMotionSyncInput[],
  applied: PptxOoxmlSyncWorkerResponse["appliedSlideMotion"],
): z.infer<typeof unsupportedSlideMotionSchema> | null {
  const comparisonLength = Math.max(expected.length, applied.length);
  for (let index = 0; index < comparisonLength; index += 1) {
    const expectedMotion = expected[index];
    const appliedMotion = applied[index];
    if (
      expectedMotion &&
      appliedMotion &&
      expectedMotion.slideId === appliedMotion.slideId &&
      expectedMotion.touched.transition === appliedMotion.transition &&
      expectedMotion.touched.animations === appliedMotion.animations
    ) {
      continue;
    }

    const slideId =
      expectedMotion?.slideId ?? appliedMotion?.slideId ?? "unknown-slide";
    const scope =
      expectedMotion?.touched.transition !== appliedMotion?.transition
        ? "transition"
        : "animations";
    return {
      slideId,
      scope,
      reasonCode: "SLIDE_MOTION_SYNC_RESPONSE_INCOMPLETE",
    };
  }
  return null;
}

function buildSlideMotionSyncInput(
  deck: Deck,
  templateBlueprint: TemplateBlueprint,
  operations: DeckPatchOperation[],
): SlideMotionSyncInput[] {
  const touchedBySlideId = new Map<
    string,
    { transition: boolean; animations: boolean }
  >();
  for (const operation of operations) {
    if (
      operation.type !== "delete_element" &&
      !isOoxmlMotionOperation(operation)
    ) {
      continue;
    }
    const touched = touchedBySlideId.get(operation.slideId) ?? {
      transition: false,
      animations: false,
    };
    if (operation.type === "update_slide_transition") {
      touched.transition = true;
    } else if (operation.type === "delete_element") {
      const slide = deck.slides.find(
        (candidate) => candidate.slideId === operation.slideId,
      );
      if (
        slide?.ooxmlMotionCapabilities?.importedMainSequenceCoverage !==
        "complete"
      ) {
        continue;
      }
      touched.animations = true;
    } else {
      touched.animations = true;
    }
    touchedBySlideId.set(operation.slideId, touched);
  }

  return deck.slides.flatMap((slide) => {
    const touched = touchedBySlideId.get(slide.slideId);
    if (!touched) return [];
    const scope = touched.transition ? "transition" : "animations";
    if (!slide.ooxmlMotionCapabilities) {
      throw new UnsupportedOoxmlSlideMotionError({
        slideId: slide.slideId,
        scope,
        reasonCode:
          scope === "transition"
            ? "SLIDE_TRANSITION_CAPABILITY_UNSAFE"
            : "SLIDE_ANIMATION_CAPABILITY_UNSAFE",
      });
    }
    const sourceSlidePart = slide.ooxmlSourceSlidePart;
    const matchingTemplateSlides = templateBlueprint.slides.filter(
      (candidate) => candidate.sourceSlidePart === sourceSlidePart,
    );
    const templateSlide = matchingTemplateSlides[0];
    if (
      !sourceSlidePart ||
      matchingTemplateSlides.length !== 1 ||
      !templateSlide
    ) {
      throw new UnsupportedOoxmlSlideMotionError({
        slideId: slide.slideId,
        scope,
        reasonCode: "SLIDE_MOTION_SOURCE_MISSING",
      });
    }
    const authoritativeCapabilities = templateSlide.ooxmlMotionCapabilities;
    if (
      touched.transition &&
      (slide.ooxmlMotionCapabilities.transitionWritable !== true ||
        authoritativeCapabilities?.transitionWritable !== true)
    ) {
      throw new UnsupportedOoxmlSlideMotionError({
        slideId: slide.slideId,
        scope: "transition",
        reasonCode: "SLIDE_TRANSITION_CAPABILITY_UNSAFE",
      });
    }
    const coverage = slide.ooxmlMotionCapabilities.importedMainSequenceCoverage;
    if (
      touched.animations &&
      ((coverage !== "absent" && coverage !== "complete") ||
        authoritativeCapabilities?.importedMainSequenceCoverage !== coverage)
    ) {
      throw new UnsupportedOoxmlSlideMotionError({
        slideId: slide.slideId,
        scope: "animations",
        reasonCode: "SLIDE_ANIMATION_CAPABILITY_UNSAFE",
      });
    }
    return [
      slideMotionSyncInputSchema.parse({
        slideId: slide.slideId,
        sourceSlidePart,
        transition: slide.transition ?? null,
        animations: slide.animations,
        capabilities: slide.ooxmlMotionCapabilities,
        touched,
      }),
    ];
  });
}

function matchesAppliedOperation(
  operation: OoxmlSyncOperation,
  applied: z.infer<typeof ooxmlAppliedOperationSchema> | undefined,
): boolean {
  if (!applied) return false;
  const expected = operationIdentity(operation);
  return (
    applied.operationType === expected.operationType &&
    applied.slideId === expected.slideId &&
    applied.elementId === expected.elementId
  );
}

function isOoxmlSyncOperation(
  operation: DeckPatchOperation,
): operation is OoxmlSyncOperation {
  return [
    "add_slide",
    "delete_slide",
    "update_element_frame",
    "update_element_props",
    "add_element",
    "delete_element",
    "reorder_slides",
  ].includes(operation.type);
}

function isOoxmlMotionOperation(
  operation: DeckPatchOperation,
): operation is OoxmlMotionOperation {
  return [
    "update_slide_transition",
    "add_animation",
    "update_animation",
    "delete_animation",
  ].includes(operation.type);
}

function isOoxmlPackageNeutralOperation(
  operation: DeckPatchOperation,
): boolean {
  return [
    "update_deck",
    "update_slide",
    "update_speaker_notes",
    "replace_keywords",
    "replace_semantic_cues",
    "add_slide_action",
    "update_slide_action",
    "delete_slide_action",
  ].includes(operation.type);
}

function isLogicalGroupOperation(
  operation: DeckPatchOperation,
  logicalGroupElementIds: Set<string>,
): boolean {
  if (operation.type === "add_element") {
    return operation.element.type === "group";
  }
  if (
    operation.type === "update_element_frame" ||
    operation.type === "update_element_props" ||
    operation.type === "delete_element"
  ) {
    return logicalGroupElementIds.has(operation.elementId);
  }
  return false;
}

function compactTransientElementOperations(
  operations: DeckPatchOperation[],
  templateBlueprint: TemplateBlueprint,
  deck: Deck,
): DeckPatchOperation[] {
  const storedElementKeys = new Set(
    templateBlueprint.slides.flatMap((slide) =>
      slide.slideId
        ? slide.elementSources.map((source) =>
            elementOperationKey(slide.slideId as string, source.elementId),
          )
        : [],
    ),
  );
  const currentElementKeys = new Set(
    deck.slides.flatMap((slide) =>
      slide.elements.map((element) =>
        elementOperationKey(slide.slideId, element.elementId),
      ),
    ),
  );
  const histories = new Map<string, DeckPatchOperation[]>();
  for (const operation of operations) {
    const key = elementOperationKeyForOperation(operation);
    if (!key) continue;
    const history = histories.get(key) ?? [];
    history.push(operation);
    histories.set(key, history);
  }
  const transientKeys = new Set(
    [...histories.entries()].flatMap(([key, history]) => {
      const addCount = history.filter(
        (operation) => operation.type === "add_element",
      ).length;
      const deleteCount = history.filter(
        (operation) => operation.type === "delete_element",
      ).length;
      return !storedElementKeys.has(key) &&
        !currentElementKeys.has(key) &&
        addCount === 1 &&
        deleteCount === 1 &&
        history[0]?.type === "add_element" &&
        history.at(-1)?.type === "delete_element"
        ? [key]
        : [];
    }),
  );
  return operations.filter((operation) => {
    const key = elementOperationKeyForOperation(operation);
    return !key || !transientKeys.has(key);
  });
}

function elementOperationKeyForOperation(
  operation: DeckPatchOperation,
): string | null {
  if (operation.type === "add_element") {
    return elementOperationKey(operation.slideId, operation.element.elementId);
  }
  if (
    operation.type === "update_element_frame" ||
    operation.type === "update_element_props" ||
    operation.type === "delete_element"
  ) {
    return elementOperationKey(operation.slideId, operation.elementId);
  }
  return null;
}

function elementOperationKey(slideId: string, elementId: string): string {
  return JSON.stringify([slideId, elementId]);
}

function isExactSlidePermutation(
  operation: Extract<DeckPatchOperation, { type: "reorder_slides" }>,
  currentSlideIds: string[],
): boolean {
  const requestedSlideIds = operation.slideOrders.map((item) => item.slideId);
  const requestedOrders = operation.slideOrders.map((item) => item.order);
  const expectedOrders = new Set(currentSlideIds.map((_, index) => index + 1));
  return (
    currentSlideIds.length === requestedSlideIds.length &&
    new Set(currentSlideIds).size === currentSlideIds.length &&
    new Set(requestedSlideIds).size === requestedSlideIds.length &&
    requestedSlideIds.every((slideId) => currentSlideIds.includes(slideId)) &&
    new Set(requestedOrders).size === requestedOrders.length &&
    requestedOrders.every((order) => expectedOrders.has(order))
  );
}

function replayAndCompactSlideOperations(
  operations: DeckPatchOperation[],
  templateBlueprint: TemplateBlueprint,
  storedDeck: Deck,
): DeckPatchOperation[] {
  const initialSlides = [...templateBlueprint.slides]
    .sort((left, right) => left.slideIndex - right.slideIndex)
    .map((slide) => ({ slideId: slide.slideId ?? "", order: slide.slideIndex }));
  const initialSlideIds = initialSlides.map((slide) => slide.slideId);
  if (
    initialSlideIds.some((slideId) => !slideId) ||
    new Set(initialSlideIds).size !== initialSlideIds.length
  ) {
    throw new UnsupportedOoxmlOperationsError({
      operationType: "reorder_slides",
      reasonCode: "SLIDE_REORDER_LOCATOR_UNSAFE",
    });
  }

  let currentSlides = initialSlides;
  let lastStructuralOperation: DeckPatchOperation | undefined;
  for (const operation of operations) {
    if (operation.type === "add_slide") {
      lastStructuralOperation = operation;
      if (
        currentSlides.some(
          (candidate) => candidate.slideId === operation.slide.slideId,
        )
      ) {
        throwInvalidSlideSequence(operation);
      }
      currentSlides = [...currentSlides, {
        slideId: operation.slide.slideId,
        order: operation.slide.order,
      }].sort((left, right) => left.order - right.order);
      continue;
    }
    if (operation.type === "delete_slide") {
      lastStructuralOperation = operation;
      const remaining = currentSlides.filter(
        (candidate) => candidate.slideId !== operation.slideId,
      );
      if (
        remaining.length === currentSlides.length ||
        currentSlides.length === 1
      ) {
        throwInvalidSlideSequence(operation);
      }
      currentSlides = remaining.map((slide, index) => ({
        ...slide,
        order: index + 1,
      }));
      continue;
    }
    if (operation.type !== "reorder_slides") continue;
    lastStructuralOperation = operation;
    const currentSlideIds = currentSlides.map((slide) => slide.slideId);
    if (!isExactSlidePermutation(operation, currentSlideIds)) {
      throwInvalidSlideSequence(operation);
    }
    const ordersBySlideId = new Map(
      operation.slideOrders.map((slideOrder) => [
        slideOrder.slideId,
        slideOrder.order,
      ]),
    );
    currentSlides = currentSlides
      .map((slide) => ({
        ...slide,
        order: ordersBySlideId.get(slide.slideId)!,
      }))
      .sort((left, right) => left.order - right.order);
  }

  const finalSlideIds = [...storedDeck.slides]
    .sort((left, right) => left.order - right.order)
    .map((slide) => slide.slideId);
  if (
    currentSlides.length !== finalSlideIds.length ||
    currentSlides.some(
      (slide, index) => slide.slideId !== finalSlideIds[index],
    )
  ) {
    throwInvalidSlideSequence(
      lastStructuralOperation ?? {
        type: "reorder_slides",
        slideOrders: finalSlideIds.map((slideId, index) => ({
          slideId,
          order: index + 1,
        })),
      },
    );
  }

  if (!lastStructuralOperation) return operations;
  const initialSet = new Set(initialSlideIds);
  const finalSet = new Set(finalSlideIds);
  const compacted = operations.filter((operation) => {
    if (operation.type === "reorder_slides") return false;
    if (operation.type === "add_slide") {
      return !initialSet.has(operation.slide.slideId) &&
        finalSet.has(operation.slide.slideId);
    }
    if (operation.type === "delete_slide") {
      return initialSet.has(operation.slideId) && !finalSet.has(operation.slideId);
    }
    const slideId = "slideId" in operation ? operation.slideId : undefined;
    return !slideId || initialSet.has(slideId) || finalSet.has(slideId);
  });
  compacted.push({
    type: "reorder_slides",
    slideOrders: finalSlideIds.map((slideId, index) => ({
      slideId,
      order: index + 1,
    })),
  });
  return compacted;
}

function throwInvalidSlideSequence(operation: DeckPatchOperation): never {
  throw new UnsupportedOoxmlOperationsError({
    ...operationIdentity(operation),
    reasonCode: "SLIDE_REORDER_PERMUTATION_INVALID",
  });
}

function operationIdentity(operation: DeckPatchOperation) {
  return {
    operationType: operation.type,
    slideId:
      "slideId" in operation
        ? operation.slideId
        : operation.type === "add_slide"
          ? operation.slide.slideId
          : undefined,
    elementId:
      "elementId" in operation
        ? operation.elementId
        : operation.type === "add_element"
          ? operation.element.elementId
          : undefined,
  };
}

async function saveSyncAssets(
  dataSource: QueryExecutor,
  storage: Pick<StoragePort, "putObject">,
  projectId: string,
  synced: PptxOoxmlSyncWorkerResponse,
): Promise<SavedSyncAssets> {
  const renderAssetFileIds: string[] = [];
  const renderAssetFileIdsByAssetId = new Map<string, string>();
  let currentPackageFileId = "";

  for (const asset of synced.assets) {
    const fileId = `file_${randomUUID()}`;
    const originalName = safeStorageName(asset.fileName);
    const storageKey = `projects/${projectId}/assets/${fileId}-${originalName}`;
    const body = Buffer.from(asset.contentBase64, "base64");
    const url = createAssetContentUrl(projectId, fileId);

    await storage.putObject({
      key: storageKey,
      body,
      contentType: asset.mimeType,
      purpose: "design-asset",
    });
    await dataSource.query(
      `
        INSERT INTO project_assets (
          file_id, project_id, storage_key, original_name, mime_type, size, url,
          purpose, status, created_at, uploaded_at, deleted_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'design-asset', 'uploaded', now(), now(), null)
      `,
      [
        fileId,
        projectId,
        storageKey,
        originalName,
        asset.mimeType,
        body.byteLength,
        url,
      ],
    );

    if (asset.assetId === "current_package") {
      currentPackageFileId = fileId;
    } else if (asset.assetId.startsWith("slide_render_")) {
      renderAssetFileIds.push(fileId);
      renderAssetFileIdsByAssetId.set(asset.assetId, fileId);
    }
  }

  if (!currentPackageFileId) {
    throw new Error("PPTX OOXML sync did not return a current package asset.");
  }

  return {
    currentPackageFileId,
    renderAssetFileIds,
    renderAssetFileIdsByAssetId,
  };
}

function withSyncResult(
  templateBlueprint: TemplateBlueprint,
  assets: SavedSyncAssets,
  syncedDeckVersion: number,
  synced: PptxOoxmlSyncWorkerResponse,
  deck: Deck,
): TemplateBlueprint {
  const deckOrderBySlideId = new Map(
    deck.slides.map((slide) => [slide.slideId, slide.order]),
  );
  const currentSlides = templateBlueprint.slides
    .filter(
      (slide) => slide.slideId && deckOrderBySlideId.has(slide.slideId),
    )
    .sort(
      (left, right) =>
        deckOrderBySlideId.get(left.slideId!)! -
        deckOrderBySlideId.get(right.slideId!)!,
    );
  return templateBlueprintSchema.parse({
    ...templateBlueprint,
    currentPackageFileId: assets.currentPackageFileId,
    ooxmlSyncedDeckVersion: syncedDeckVersion,
    slides: currentSlides.map((slide, index) => ({
      ...slide,
      slideIndex: index + 1,
      renderAssetFileId:
        assets.renderAssetFileIdsByAssetId.get(
          `slide_render_${slide.sourceSlideIndex}`,
        ) ??
        assets.renderAssetFileIds[index] ??
        slide.renderAssetFileId,
      elementSources: mergeElementSources(
        slide.elementSources,
        synced.elementSources.filter(
          (source) => source.slidePart === slide.sourceSlidePart,
        ),
      ),
    })),
  });
}

function withSourceSlideLocator(
  operation: OoxmlSyncOperation,
  templateBlueprint: TemplateBlueprint,
): OoxmlSyncOperation {
  if (operation.type === "reorder_slides") {
    return {
      ...operation,
      slideOrders: operation.slideOrders.map((slideOrder) => {
        const locator = sourceSlideLocatorForDeckSlide(
          slideOrder.slideId,
          templateBlueprint,
        );
        return {
          ...slideOrder,
          sourceSlidePart: locator?.sourceSlidePart ?? "",
        };
      }),
    } as OoxmlSyncOperation;
  }
  if (operation.type === "add_slide") {
    const locator = sourceSlideLocatorForDeckSlide(
      operation.slide.slideId,
      templateBlueprint,
    );
    return {
      ...operation,
      sourceSlidePart: locator?.sourceSlidePart ?? "",
    } as OoxmlSyncOperation;
  }
  if (!("slideId" in operation)) return operation;
  const locator = sourceSlideLocatorForDeckSlide(
    operation.slideId,
    templateBlueprint,
  );
  return {
    ...operation,
    sourceSlidePart: locator?.sourceSlidePart ?? "",
  } as unknown as OoxmlSyncOperation;
}

function sourceSlideLocatorForDeckSlide(
  slideId: string,
  templateBlueprint: TemplateBlueprint,
): { sourceSlidePart: string } | null {
  const matches = templateBlueprint.slides.filter(
    (slide) => slide.slideId === slideId,
  );
  const slide = matches[0];
  if (matches.length !== 1 || !slide?.sourceSlidePart) {
    return null;
  }
  return {
    sourceSlidePart: slide.sourceSlidePart,
  };
}

function recoverTemplateBlueprintForPendingSlides(
  blueprint: TemplateBlueprint,
  deck: Deck,
): { blueprint: TemplateBlueprint; recovered: boolean } | null {
  const mappedSlideIds = blueprint.slides.flatMap((slide) =>
    slide.slideId ? [slide.slideId] : [],
  );
  if (
    mappedSlideIds.length === blueprint.slides.length &&
    new Set(mappedSlideIds).size === mappedSlideIds.length
  ) {
    return { blueprint, recovered: false };
  }
  return recoverTemplateBlueprintSlideIds(blueprint, deck.slides);
}

function prepareAuthoredSlideSync(
  templateBlueprint: TemplateBlueprint,
  operations: DeckPatchOperation[],
): {
  templateBlueprint: TemplateBlueprint;
  operations: DeckPatchOperation[];
} {
  const slides = [...templateBlueprint.slides];
  const mappedSlideIds = new Set(slides.flatMap((slide) =>
    slide.slideId ? [slide.slideId] : [],
  ));
  const usedPartNumbers = new Set(
    slides.flatMap((slide) => {
      const match = slide.sourceSlidePart?.match(/^ppt\/slides\/slide(\d+)\.xml$/);
      return match ? [Number(match[1])] : [];
    }),
  );
  let sourceSlideIndex = Math.max(
    0,
    ...slides.map((slide) => slide.sourceSlideIndex),
  );

  for (const operation of operations) {
    if (operation.type !== "add_slide") continue;
    if (mappedSlideIds.has(operation.slide.slideId)) continue;
    let partNumber = 1;
    while (usedPartNumbers.has(partNumber)) partNumber += 1;
    usedPartNumbers.add(partNumber);
    sourceSlideIndex += 1;
    mappedSlideIds.add(operation.slide.slideId);
    slides.push({
      slideId: operation.slide.slideId,
      slideIndex: operation.slide.order,
      sourceSlideIndex,
      sourceSlidePart: `ppt/slides/slide${partNumber}.xml`,
      ooxmlOrigin: "authored",
      slots: [],
      elementSources: [],
    });
  }

  return {
    templateBlueprint: templateBlueprintSchema.parse({
      ...templateBlueprint,
      slides,
    }),
    operations,
  };
}

function mergeElementSources(
  current: TemplateBlueprint["slides"][number]["elementSources"],
  incoming: PptxOoxmlSyncWorkerResponse["elementSources"],
) {
  const byElementId = new Map(
    current.map((source) => [source.elementId, source]),
  );
  for (const source of incoming) {
    byElementId.set(source.elementId, source);
  }
  return [...byElementId.values()];
}

async function updateTemplateBlueprintConditionally(
  dataSource: QueryExecutor,
  projectId: string,
  deckId: string,
  templateBlueprint: TemplateBlueprint,
  syncedDeckVersion: number,
): Promise<boolean> {
  const rows = readQueryRows<{ template_id: string }>(
    await dataSource.query(
      `
      UPDATE template_blueprints
      SET blueprint_json = $4,
          updated_at = now()
      WHERE project_id = $1 AND deck_id = $2 AND template_id = $3
        AND COALESCE((blueprint_json->>'ooxmlSyncedDeckVersion')::integer, 0) < $5
      RETURNING template_id
    `,
      [
        projectId,
        deckId,
        templateBlueprint.templateId,
        templateBlueprint,
        syncedDeckVersion,
      ],
    ),
  );
  return rows.length === 1;
}

function currentPackageFileId(templateBlueprint: TemplateBlueprint): string {
  const fileId =
    templateBlueprint.currentPackageFileId ??
    templateBlueprint.sourcePackageFileId;
  if (!fileId) {
    throw new Error("Template blueprint has no OOXML package file id.");
  }
  return fileId;
}

async function failJob(
  dataSource: QueryExecutor,
  jobId: string,
  progress: number,
  code: string,
  message: string,
  retryable?: boolean,
): Promise<Job> {
  return updateJob(dataSource, jobId, {
    status: "failed",
    progress,
    message: "PPTX OOXML sync failed.",
    result: null,
    error: {
      code,
      message,
      ...(retryable === undefined ? {} : { retryable }),
    },
  });
}

async function updateJob(
  dataSource: QueryExecutor,
  jobId: string,
  patch: {
    status: "running" | "succeeded" | "failed";
    progress: number;
    message: string;
    result: Record<string, unknown> | null;
    error: { code: string; message: string; retryable?: boolean } | null;
  },
): Promise<Job> {
  const rows = await dataSource.query(
    `
      UPDATE jobs
      SET status = $2,
          progress = $3,
          message = $4,
          result = $5,
          error = $6,
          updated_at = now()
      WHERE job_id = $1
      RETURNING *
    `,
    [
      jobId,
      patch.status,
      patch.progress,
      patch.message,
      patch.result,
      patch.error,
    ],
  );

  const row = readFirstQueryRow<JobRow>(rows);
  if (!row) {
    throw new Error(`Job not found: ${jobId}`);
  }

  return rowToJob(row);
}

function readRawJobId(rawPayload: unknown): string {
  return isRecord(rawPayload) && typeof rawPayload.jobId === "string"
    ? rawPayload.jobId
    : "";
}

function readFirstQueryRow<T>(queryResult: unknown): T | null {
  if (!Array.isArray(queryResult)) {
    return null;
  }

  const first = queryResult[0];
  if (Array.isArray(first)) {
    return (first[0] as T | undefined) ?? null;
  }

  return (first as T | undefined) ?? null;
}

function readQueryRows<T>(queryResult: unknown): T[] {
  if (!Array.isArray(queryResult)) {
    return [];
  }

  const first = queryResult[0];
  return (Array.isArray(first) ? first : queryResult) as T[];
}

function rowToJob(row: JobRow): Job {
  return {
    jobId: row.job_id,
    projectId: row.project_id,
    type: row.type,
    status: row.status,
    progress: row.progress,
    message: row.message,
    result: row.result,
    error: row.error,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp value: ${String(value)}`);
  }
  return date.toISOString();
}

function workerUrl(baseUrl: string, path: string): string {
  return new URL(
    path,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  ).toString();
}

function createAssetContentUrl(projectId: string, fileId: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(
    fileId,
  )}/content`;
}

function safeStorageName(fileName: string): string {
  return (fileName || "design-asset").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
