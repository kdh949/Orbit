import {
  deckExportFormatSchema,
  deckExportJobResultSchema,
  deckSchema,
  templateBlueprintSchema,
  type Job,
  type TemplateBlueprint,
} from "@orbit/shared";
import type { StoragePort } from "@orbit/storage";
import { randomUUID } from "crypto";
import type { DataSource } from "typeorm";
import { z } from "zod";
import { projectActivityDeckForStaticExport } from "./activity-export-projection";

const deckExportPayloadSchema = z
  .object({
    jobId: z.string().min(1),
    projectId: z.string().min(1),
    deck: deckSchema,
    format: deckExportFormatSchema,
    presentationSessionId: z.string().trim().min(1).optional(),
  })
  .strict();

const pythonExportResponseSchema = z.object({
  contentBase64: z.string().min(1),
  warnings: z.array(z.string()).default([]),
  motionDiagnostics: z
    .array(
      z.object({
        code: z.enum([
          "PPTX_MOTION_EFFECT_UNSUPPORTED",
          "PPTX_MOTION_INTERACTIVE_EXCLUDED",
          "PPTX_MOTION_MEDIA_EXCLUDED",
          "PPTX_MOTION_PARAGRAPH_BUILD_DOWNGRADED",
          "PPTX_MOTION_PAYLOAD_INVALID",
          "PPTX_MOTION_PRESET_UNSUPPORTED",
          "PPTX_MOTION_SERIALIZATION_FAILED",
          "PPTX_MOTION_SOURCE_UNAVAILABLE",
          "PPTX_MOTION_START_MODE_UNSUPPORTED",
          "PPTX_MOTION_STRUCTURE_UNSUPPORTED",
          "PPTX_MOTION_TARGET_FLATTENED",
          "PPTX_MOTION_TARGET_UNRESOLVED",
        ]),
        slideIndex: z.number().int().positive(),
        elementId: z.string().min(1).max(200).optional(),
        count: z.number().int().positive().optional(),
      }),
    )
    .max(500)
    .default([]),
});

type DeckExportPayload = z.infer<typeof deckExportPayloadSchema>;
type QueryExecutor = Pick<DataSource, "query">;
type JobRow = {
  job_id: string;
  project_id: string;
  type: Job["type"];
  status: Job["status"];
  progress: number;
  message: string;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type TemplateBlueprintRow = {
  blueprint_json: unknown;
};

type StoredDeckRow = {
  version: number;
};

type ProjectAssetRow = {
  file_id: string;
  project_id: string;
  storage_key: string;
  mime_type: string;
  original_name: string;
  purpose: string;
  status: string;
};

type ImportedExportResult =
  | { kind: "generic" }
  | { kind: "stale"; deckVersion: number; syncedDeckVersion: number }
  | { kind: "completed"; job: Job }
  | { kind: "materialized"; pptxBytes: Buffer; warnings: string[] };

type DeckExportProcessorOptions = {
  ooxmlReadyAttempts?: number;
  ooxmlReadyDelayMs?: number;
};

const pptxMimeType =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const zipMimeType = "application/zip";

export async function processDeckExportJob(
  dataSource: DataSource,
  storage: Pick<StoragePort, "putObject" | "getSignedReadUrl">,
  pythonWorkerUrl: string,
  rawPayload: unknown,
  options: DeckExportProcessorOptions = {},
): Promise<Job> {
  const payloadResult = deckExportPayloadSchema.safeParse(rawPayload);
  if (!payloadResult.success) {
    const jobId =
      rawPayload &&
      typeof rawPayload === "object" &&
      "jobId" in rawPayload &&
      typeof rawPayload.jobId === "string"
        ? rawPayload.jobId
        : "";
    if (!jobId) throw new Error(payloadResult.error.message);
    return failJob(
      dataSource,
      jobId,
      0,
      "DECK_EXPORT_PAYLOAD_INVALID",
      payloadResult.error.message,
    );
  }

  const payload = payloadResult.data;
  const containsActivitySlides = payload.deck.slides.some(
    (slide) => slide.kind === "activity" || slide.kind === "activity-results",
  );
  await updateJob(dataSource, payload.jobId, {
    status: "running",
    progress: 20,
    message: "Deck export running.",
    result: null,
    error: null,
  });

  let exportPayload: DeckExportPayload;
  try {
    exportPayload = {
      ...payload,
      deck: await projectActivityDeckForStaticExport(
        dataSource,
        payload.projectId,
        payload.deck,
        payload.presentationSessionId,
      ),
    };
  } catch (error) {
    return failJob(
      dataSource,
      payload.jobId,
      20,
      "DECK_EXPORT_ACTIVITY_PROJECTION_FAILED",
      error instanceof Error
        ? error.message
        : "Activity slide export projection failed.",
    );
  }

  const readyAttempts = Math.max(1, options.ooxmlReadyAttempts ?? 5);
  const readyDelayMs = Math.max(0, options.ooxmlReadyDelayMs ?? 1_000);
  try {
    for (let attempt = 1; attempt <= readyAttempts; attempt += 1) {
      const imported = await exportImportedDeckIfReady(
        dataSource,
        storage,
        exportPayload,
        containsActivitySlides,
      );
      if (imported.kind === "completed") return imported.job;
      if (imported.kind === "materialized") {
        return finishMaterializedExport(
          dataSource,
          storage,
          pythonWorkerUrl,
          exportPayload,
          imported.pptxBytes,
          imported.warnings,
        );
      }
      if (imported.kind === "generic") break;
      if (attempt === readyAttempts) {
        return failJob(
          dataSource,
          payload.jobId,
          20,
          "DECK_EXPORT_OOXML_SYNC_STALE",
          `Latest PPTX package is not ready for deck version ${imported.deckVersion} (synced ${imported.syncedDeckVersion}).`,
        );
      }
      if (readyDelayMs > 0) await delay(readyDelayMs);
    }
  } catch (error) {
    return failJob(
      dataSource,
      payload.jobId,
      20,
      "DECK_EXPORT_OOXML_PACKAGE_INVALID",
      error instanceof Error ? error.message : "PPTX OOXML package is invalid.",
    );
  }

  let response: Response;
  try {
    const exportDeck = await embedDeckImageAssets(
      dataSource,
      storage,
      payload.projectId,
      exportPayload.deck,
    );
    response = await fetch(workerUrl(pythonWorkerUrl, "/ai/export-deck-pptx"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deck: exportDeck, format: "pptx" }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    return failJob(
      dataSource,
      payload.jobId,
      20,
      "PYTHON_WORKER_DECK_EXPORT_UNAVAILABLE",
      error instanceof Error ? error.message : "Python worker unavailable.",
    );
  }

  if (!response.ok) {
    return failJob(
      dataSource,
      payload.jobId,
      20,
      "PYTHON_WORKER_DECK_EXPORT_FAILED",
      (await response.text()) || "Python worker deck export failed.",
    );
  }

  try {
    const workerPayload = pythonExportResponseSchema.parse(
      await response.json(),
    );
    const fatalMotionDiagnostics = workerPayload.motionDiagnostics.filter(
      (diagnostic) => diagnostic.code !== "PPTX_MOTION_TARGET_FLATTENED",
    );
    if (fatalMotionDiagnostics.length > 0) {
      const diagnosticCodes = Array.from(
        new Set(fatalMotionDiagnostics.map((diagnostic) => diagnostic.code)),
      )
        .slice(0, 5)
        .join(", ");
      return failJob(
        dataSource,
        payload.jobId,
        75,
        "DECK_EXPORT_MOTION_PRESERVATION_FAILED",
        `Generic PPTX export reported ${fatalMotionDiagnostics.length} fatal motion preservation diagnostic(s): ${diagnosticCodes}.`,
      );
    }
    const flattenedTargetCount = workerPayload.motionDiagnostics
      .filter(
        (diagnostic) => diagnostic.code === "PPTX_MOTION_TARGET_FLATTENED",
      )
      .reduce((total, diagnostic) => total + (diagnostic.count ?? 1), 0);
    const warnings = [...workerPayload.warnings];
    if (flattenedTargetCount > 0) {
      warnings.push(
        `PPTX_MOTION_TARGET_FLATTENED: ${flattenedTargetCount} animation target(s) were exported through the supported flattened group fallback.`,
      );
    }
    return finishMaterializedExport(
      dataSource,
      storage,
      pythonWorkerUrl,
      payload,
      Buffer.from(workerPayload.contentBase64, "base64"),
      warnings,
    );
  } catch (error) {
    return failJob(
      dataSource,
      payload.jobId,
      75,
      "PYTHON_WORKER_DECK_EXPORT_INVALID_RESPONSE",
      error instanceof Error
        ? error.message
        : "Python worker returned invalid deck export response.",
    );
  }
}

async function exportImportedDeckIfReady(
  dataSource: DataSource,
  storage: Pick<StoragePort, "putObject" | "getSignedReadUrl">,
  payload: DeckExportPayload,
  containsActivitySlides = false,
): Promise<ImportedExportResult> {
  if (containsActivitySlides) {
    return { kind: "generic" };
  }
  const templateBlueprint = await loadOoxmlTemplateBlueprint(
    dataSource,
    payload.projectId,
    payload.deck.deckId,
  );
  if (!templateBlueprint) return { kind: "generic" };

  return dataSource.transaction(async (manager) => {
    await manager.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`${payload.projectId}:${payload.deck.deckId}`],
    );
    const storedDeck = await loadStoredDeckForExport(
      manager,
      payload.projectId,
      payload.deck.deckId,
    );
    const templateBlueprint = await loadOoxmlTemplateBlueprint(
      manager,
      payload.projectId,
      payload.deck.deckId,
    );
    if (!templateBlueprint) return { kind: "generic" };

    const currentPackageFileId = templateBlueprint.currentPackageFileId;
    if (!currentPackageFileId) {
      throw new Error("OOXML-backed deck has no current PPTX package asset.");
    }
    const syncedDeckVersion = templateBlueprint.ooxmlSyncedDeckVersion ?? 0;
    if (syncedDeckVersion !== storedDeck.version) {
      return {
        kind: "stale",
        deckVersion: storedDeck.version,
        syncedDeckVersion,
      };
    }

    const packageAsset = await loadCurrentPackageAsset(
      manager,
      payload.projectId,
      currentPackageFileId,
    );
    const packageResponse = await fetch(
      await storage.getSignedReadUrl(packageAsset.storage_key),
    );
    if (!packageResponse.ok) {
      throw new Error(
        `Current PPTX package content unavailable: ${currentPackageFileId}`,
      );
    }
    const packageBytes = Buffer.from(await packageResponse.arrayBuffer());

    const recheckedDeck = await loadStoredDeckForExport(
      manager,
      payload.projectId,
      payload.deck.deckId,
    );
    const recheckedBlueprint = await loadOoxmlTemplateBlueprint(
      manager,
      payload.projectId,
      payload.deck.deckId,
    );
    if (
      !recheckedBlueprint ||
      recheckedDeck.version !== storedDeck.version ||
      recheckedBlueprint.ooxmlSyncedDeckVersion !== recheckedDeck.version ||
      recheckedBlueprint.currentPackageFileId !== currentPackageFileId
    ) {
      return {
        kind: "stale",
        deckVersion: recheckedDeck.version,
        syncedDeckVersion: recheckedBlueprint?.ooxmlSyncedDeckVersion ?? 0,
      };
    }

    if (payload.format === "png") {
      return { kind: "materialized", pptxBytes: packageBytes, warnings: [] };
    }

    const file = await saveExportBytes(manager, storage, payload, packageBytes);
    const result = deckExportJobResultSchema.parse({
      deckId: payload.deck.deckId,
      fileId: file.fileId,
      url: file.url,
      format: payload.format,
      warnings: [],
    });
    const job = await updateJob(manager, payload.jobId, {
      status: "succeeded",
      progress: 100,
      message: "Deck export completed.",
      result,
      error: null,
    });
    return { kind: "completed", job };
  });
}

async function loadStoredDeckForExport(
  dataSource: QueryExecutor,
  projectId: string,
  deckId: string,
): Promise<StoredDeckRow> {
  const rows = readQueryRows<StoredDeckRow>(
    await dataSource.query(
      `
        SELECT version
        FROM decks
        WHERE project_id = $1 AND deck_id = $2
        FOR SHARE
      `,
      [projectId, deckId],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error(`Deck not found for export: ${deckId}`);
  return row;
}

async function loadOoxmlTemplateBlueprint(
  dataSource: QueryExecutor,
  projectId: string,
  deckId: string,
): Promise<TemplateBlueprint | null> {
  const rows = readQueryRows<TemplateBlueprintRow>(
    await dataSource.query(
      `
        SELECT blueprint_json
        FROM template_blueprints
        WHERE project_id = $1 AND deck_id = $2
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      [projectId, deckId],
    ),
  );
  const blueprintJson = rows[0]?.blueprint_json;
  if (!isRecord(blueprintJson)) return null;
  if (
    typeof blueprintJson.currentPackageFileId !== "string" &&
    typeof blueprintJson.sourcePackageFileId !== "string"
  ) {
    return null;
  }
  return templateBlueprintSchema.parse(blueprintJson);
}

async function loadCurrentPackageAsset(
  dataSource: QueryExecutor,
  projectId: string,
  fileId: string,
): Promise<ProjectAssetRow> {
  const rows = readQueryRows<ProjectAssetRow>(
    await dataSource.query(
      `
        SELECT file_id, project_id, storage_key, mime_type, original_name, purpose, status
        FROM project_assets
        WHERE file_id = $1
        FOR SHARE
      `,
      [fileId],
    ),
  );
  const asset = rows[0];
  if (!asset)
    throw new Error(`Current PPTX package asset not found: ${fileId}`);
  if (asset.project_id !== projectId) {
    throw new Error(`Current PPTX package asset project mismatch: ${fileId}`);
  }
  if (
    asset.status !== "uploaded" ||
    asset.mime_type !== pptxMimeType ||
    asset.purpose !== "design-asset"
  ) {
    throw new Error(`Current PPTX package asset is not exportable: ${fileId}`);
  }
  return asset;
}

export async function embedDeckImageAssets(
  dataSource: DataSource,
  storage: Pick<StoragePort, "getSignedReadUrl">,
  projectId: string,
  deck: z.infer<typeof deckSchema>,
) {
  const fileIds = Array.from(
    new Set(
      deck.slides.flatMap((slide) =>
        slide.elements.flatMap((element) => {
          if (element.type !== "image") return [];
          const fileId = internalAssetFileId(element.props.src, projectId);
          return fileId ? [fileId] : [];
        }),
      ),
    ),
  );
  if (fileIds.length === 0) return deck;

  const rows = (await dataSource.query(
    `
      SELECT file_id, storage_key, mime_type
      FROM project_assets
      WHERE project_id = $1
        AND file_id = ANY($2)
        AND status = 'uploaded'
    `,
    [projectId, fileIds],
  )) as Array<{ file_id: string; storage_key: string; mime_type: string }>;
  const dataUrls = new Map<string, string>();
  for (const row of rows) {
    const readUrl = await storage.getSignedReadUrl(row.storage_key);
    const response = await fetch(readUrl);
    if (!response.ok) continue;
    const content = Buffer.from(await response.arrayBuffer()).toString(
      "base64",
    );
    dataUrls.set(row.file_id, `data:${row.mime_type};base64,${content}`);
  }

  return deckSchema.parse({
    ...deck,
    slides: deck.slides.map((slide) => ({
      ...slide,
      elements: slide.elements.map((element) => {
        if (element.type !== "image") return element;
        const fileId = internalAssetFileId(element.props.src, projectId);
        const src = fileId ? dataUrls.get(fileId) : undefined;
        return src ? { ...element, props: { ...element.props, src } } : element;
      }),
    })),
  });
}

function internalAssetFileId(src: string, projectId: string) {
  const match = src.match(
    /^\/api\/v1\/projects\/([^/]+)\/assets\/([^/]+)\/content$/,
  );
  if (!match || decodeURIComponent(match[1]) !== projectId) return null;
  return decodeURIComponent(match[2]);
}

async function finishMaterializedExport(
  dataSource: QueryExecutor,
  storage: Pick<StoragePort, "putObject">,
  pythonWorkerUrl: string,
  payload: DeckExportPayload,
  pptxBytes: Buffer,
  initialWarnings: string[],
): Promise<Job> {
  let body = pptxBytes;
  let warnings = initialWarnings;
  if (payload.format === "png") {
    let response: Response;
    try {
      response = await fetch(workerUrl(pythonWorkerUrl, "/ai/export-pptx-png-zip"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentBase64: pptxBytes.toString("base64") }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      return failJob(
        dataSource,
        payload.jobId,
        60,
        "PYTHON_WORKER_PNG_EXPORT_UNAVAILABLE",
        error instanceof Error ? error.message : "Python worker unavailable.",
      );
    }
    if (!response.ok) {
      return failJob(
        dataSource,
        payload.jobId,
        60,
        "PYTHON_WORKER_PNG_EXPORT_FAILED",
        (await response.text()) || "Python worker PNG export failed.",
      );
    }
    try {
      const rendered = pythonExportResponseSchema.parse(await response.json());
      body = Buffer.from(rendered.contentBase64, "base64");
      warnings = [...warnings, ...rendered.warnings];
    } catch (error) {
      return failJob(
        dataSource,
        payload.jobId,
        75,
        "PYTHON_WORKER_PNG_EXPORT_INVALID_RESPONSE",
        error instanceof Error
          ? error.message
          : "Python worker returned an invalid PNG export response.",
      );
    }
  }

  try {
    const file = await saveExportBytes(dataSource, storage, payload, body);
    const result = deckExportJobResultSchema.parse({
      deckId: payload.deck.deckId,
      fileId: file.fileId,
      url: file.url,
      format: payload.format,
      warnings,
    });
    return updateJob(dataSource, payload.jobId, {
      status: "succeeded",
      progress: 100,
      message: "Deck export completed.",
      result,
      error: null,
    });
  } catch (error) {
    return failJob(
      dataSource,
      payload.jobId,
      75,
      "DECK_EXPORT_SAVE_FAILED",
      error instanceof Error ? error.message : "Deck export could not be saved.",
    );
  }
}

async function saveExportBytes(
  dataSource: QueryExecutor,
  storage: Pick<StoragePort, "putObject">,
  payload: DeckExportPayload,
  body: Buffer,
) {
  const fileId = `file_${randomUUID()}`;
  const extension = payload.format === "png" ? "zip" : "pptx";
  const mimeType = payload.format === "png" ? zipMimeType : pptxMimeType;
  const fileName = `${safeStorageName(payload.deck.title || payload.deck.deckId)}.${extension}`;
  const storageKey = `projects/${payload.projectId}/assets/${fileId}-${fileName}`;
  const url = createAssetContentUrl(payload.projectId, fileId);

  await storage.putObject({
    key: storageKey,
    body,
    contentType: mimeType,
    purpose: "export-result",
  });
  await dataSource.query(
    `
      INSERT INTO project_assets (
        file_id, project_id, storage_key, original_name, mime_type, size, url,
        purpose, status, created_at, uploaded_at, deleted_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'export-result', 'uploaded', now(), now(), null)
    `,
    [
      fileId,
      payload.projectId,
      storageKey,
      fileName,
      mimeType,
      body.byteLength,
      url,
    ],
  );

  return { fileId, url };
}

async function failJob(
  dataSource: QueryExecutor,
  jobId: string,
  progress: number,
  code: string,
  message: string,
): Promise<Job> {
  return updateJob(dataSource, jobId, {
    status: "failed",
    progress,
    message: "Deck export failed.",
    result: null,
    error: { code, message },
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
    error: { code: string; message: string } | null;
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
  if (!row) throw new Error(`Job not found: ${jobId}`);
  return rowToJob(row);
}

function readFirstQueryRow<T>(queryResult: unknown): T | null {
  if (!Array.isArray(queryResult)) return null;
  const first = queryResult[0];
  if (Array.isArray(first)) return (first[0] as T | undefined) ?? null;
  return (first as T | undefined) ?? null;
}

function readQueryRows<T>(queryResult: unknown): T[] {
  if (!Array.isArray(queryResult)) return [];
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

function createAssetContentUrl(projectId: string, fileId: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(
    fileId,
  )}/content`;
}

function workerUrl(baseUrl: string, path: string): string {
  return new URL(
    path,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  ).toString();
}

function safeStorageName(fileName: string): string {
  return (fileName || "deck-export").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
