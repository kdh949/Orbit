import {
  animationSchema,
  deckCanvasSchema,
  deckElementSchema,
  deckSchema,
  pptxOoxmlGenerationJobResultSchema,
  pptxOoxmlGenerationRequestSchema,
  qualityReportSchema,
  slideTransitionSchema,
  slideStyleSchema,
  templateBlueprintSchema,
  themeSchema,
  type Deck,
  type DeckCanvas,
  type Job,
  type QualityReport,
  type TemplateBlueprint,
} from "@orbit/shared";
import type { StoragePort } from "@orbit/storage";
import { randomUUID } from "crypto";
import type { DataSource, EntityManager } from "typeorm";
import { z } from "zod";

const pptxOoxmlGenerationPayloadSchema = z.object({
  jobId: z.string().min(1),
  projectId: z.string().min(1),
  request: pptxOoxmlGenerationRequestSchema,
});

const generatedDesignAssetSchema = z.object({
  assetId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  contentBase64: z.string().min(1),
});

const ooxmlGenerationBlueprintSlideSchema = z
  .object({
    sourceSlideIndex: z.number().int().positive().optional(),
    style: slideStyleSchema,
    elements: z.array(deckElementSchema).default([]),
    transition: slideTransitionSchema.optional(),
    animations: z.array(animationSchema).default([]),
  })
  .passthrough();

const ooxmlGenerationBlueprintSchema = z
  .object({
    theme: themeSchema.default({}),
    slides: z.array(ooxmlGenerationBlueprintSlideSchema).min(1),
  })
  .passthrough();

const pptxOoxmlGenerationWorkerResponseSchema = z.object({
  canvas: deckCanvasSchema,
  blueprint: ooxmlGenerationBlueprintSchema,
  templateBlueprint: templateBlueprintSchema,
  qualityReport: qualityReportSchema,
  assets: z.array(generatedDesignAssetSchema).default([]),
  warnings: z.array(z.string()).default([]),
});

type PptxOoxmlGenerationWorkerResponse = z.infer<
  typeof pptxOoxmlGenerationWorkerResponseSchema
>;
type OoxmlGenerationBlueprint = PptxOoxmlGenerationWorkerResponse["blueprint"];
type OoxmlTemplateBlueprint =
  PptxOoxmlGenerationWorkerResponse["templateBlueprint"];

type SavedAssetRefs = {
  fileIds: Map<string, string>;
  urls: Map<string, string>;
};

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

const pptxMimeType =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export async function processPptxOoxmlGenerationJob(
  dataSource: DataSource,
  storage: Pick<StoragePort, "getSignedReadUrl" | "putObject">,
  pythonWorkerUrl: string,
  rawPayload: unknown,
): Promise<Job> {
  const payloadResult = pptxOoxmlGenerationPayloadSchema.safeParse(rawPayload);
  if (!payloadResult.success) {
    const jobId =
      rawPayload &&
      typeof rawPayload === "object" &&
      "jobId" in rawPayload &&
      typeof rawPayload.jobId === "string"
        ? rawPayload.jobId
        : "";

    if (!jobId) {
      throw new Error(payloadResult.error.message);
    }

    return failJob(
      dataSource,
      jobId,
      0,
      "PPTX_OOXML_GENERATION_PAYLOAD_INVALID",
      payloadResult.error.message,
    );
  }

  const payload = payloadResult.data;
  await updateJob(dataSource, payload.jobId, {
    status: "running",
    progress: 10,
    message: "PPTX OOXML generation running.",
    result: null,
    error: null,
  });

  let asset: ProjectAssetRow;
  let generated: PptxOoxmlGenerationWorkerResponse;
  try {
    asset = await loadPptxAsset(
      dataSource,
      payload.projectId,
      payload.request.fileId,
    );
    generated = await generatePptxOoxmlWithPython(
      storage,
      pythonWorkerUrl,
      asset,
    );
  } catch (error) {
    return failJob(
      dataSource,
      payload.jobId,
      10,
      "PPTX_OOXML_GENERATION_SOURCE_FAILED",
      error instanceof Error ? error.message : "PPTX OOXML generation failed.",
    );
  }

  try {
    const assetRefs = await saveGeneratedDesignAssets(
      dataSource,
      storage,
      payload.projectId,
      generated,
    );
    const templateBlueprint =
      pptxOoxmlGenerationWorkerResponseSchema.shape.templateBlueprint.parse(
        replaceAssetRefs(generated.templateBlueprint, assetRefs.fileIds),
      );
    const deckBlueprint =
      pptxOoxmlGenerationWorkerResponseSchema.shape.blueprint.parse(
        replaceAssetRefs(generated.blueprint, assetRefs.urls),
      );
    const deck = buildOoxmlDeck(
      payload.projectId,
      asset,
      generated.canvas,
      deckBlueprint,
      templateBlueprint,
      assetRefs.urls,
    );
    const mappedTemplateBlueprint = reconcileMotionCapabilitiesWithDeck(
      templateBlueprintSchema.parse({
        ...templateBlueprint,
        slides: templateBlueprint.slides.map((slide, index) => ({
          ...slide,
          slideId: deck.slides[index]?.slideId,
        })),
      }),
      deck,
    );

    await dataSource.transaction(async (manager) => {
      await saveDeck(manager, deck);
      await saveTemplateBlueprint(
        manager,
        payload.projectId,
        deck.deckId,
        mappedTemplateBlueprint,
        generated.qualityReport,
      );
      await updateProjectTitle(manager, payload.projectId, deck.title);
    });

    const result = pptxOoxmlGenerationJobResultSchema.parse({
      deckId: deck.deckId,
      templateId: templateBlueprint.templateId,
      sourceFileId: payload.request.fileId,
      currentPackageFileId: templateBlueprint.currentPackageFileId,
      qualityReport: generated.qualityReport,
      warnings: generated.warnings,
    });

    return updateJob(dataSource, payload.jobId, {
      status: "succeeded",
      progress: 100,
      message: "PPTX OOXML generation completed.",
      result,
      error: null,
    });
  } catch (error) {
    return failJob(
      dataSource,
      payload.jobId,
      75,
      "PPTX_OOXML_GENERATION_SAVE_FAILED",
      error instanceof Error
        ? error.message
        : "PPTX OOXML generation save failed.",
    );
  }
}

async function loadPptxAsset(
  dataSource: DataSource,
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
    throw new Error(`PPTX asset not found: ${fileId}`);
  }
  if (asset.project_id !== projectId) {
    throw new Error(`PPTX asset project mismatch: ${fileId}`);
  }
  if (asset.status !== "uploaded") {
    throw new Error(`PPTX asset is not uploaded: ${fileId}`);
  }
  if (asset.purpose !== "pptx-import") {
    throw new Error(`PPTX asset purpose must be pptx-import: ${fileId}`);
  }
  if (asset.mime_type !== pptxMimeType) {
    throw new Error(`PPTX OOXML generation requires a PPTX file: ${fileId}`);
  }

  return asset;
}

async function generatePptxOoxmlWithPython(
  storage: Pick<StoragePort, "getSignedReadUrl">,
  pythonWorkerUrl: string,
  asset: ProjectAssetRow,
): Promise<PptxOoxmlGenerationWorkerResponse> {
  const readUrl = await storage.getSignedReadUrl(asset.storage_key);
  const sourceResponse = await fetch(readUrl);
  if (!sourceResponse.ok) {
    throw new Error(`PPTX content unavailable: ${asset.file_id}`);
  }

  const form = new FormData();
  form.append("file_id", asset.file_id);
  form.append(
    "file",
    new Blob([Buffer.from(await sourceResponse.arrayBuffer())], {
      type: asset.mime_type,
    }),
    asset.original_name,
  );

  const response = await fetch(
    workerUrl(pythonWorkerUrl, "/ai/pptx-ooxml-generation"),
    {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(180_000),
    },
  );

  if (!response.ok) {
    throw new Error(
      (await response.text()) || "Python worker PPTX OOXML generation failed.",
    );
  }

  return pptxOoxmlGenerationWorkerResponseSchema.parse(await response.json());
}

async function saveGeneratedDesignAssets(
  dataSource: DataSource,
  storage: Pick<StoragePort, "putObject">,
  projectId: string,
  generated: PptxOoxmlGenerationWorkerResponse,
): Promise<SavedAssetRefs> {
  const refs: SavedAssetRefs = {
    fileIds: new Map(),
    urls: new Map(),
  };

  for (const asset of generated.assets) {
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

    refs.fileIds.set(`asset:${asset.assetId}`, fileId);
    refs.urls.set(`asset:${asset.assetId}`, url);
  }

  return refs;
}

function buildOoxmlDeck(
  projectId: string,
  asset: ProjectAssetRow,
  canvas: DeckCanvas,
  blueprint: OoxmlGenerationBlueprint,
  templateBlueprint: OoxmlTemplateBlueprint,
  assetUrls: Map<string, string>,
): Deck {
  const title = titleFromFileName(asset.original_name);
  const blueprintSlides = new Map(
    blueprint.slides.map((slide, index) => [
      slide.sourceSlideIndex ?? index + 1,
      slide,
    ]),
  );

  return deckSchema.parse({
    deckId: `deck_ooxml_${safeId(asset.file_id)}`,
    projectId,
    title,
    version: 1,
    metadata: {
      language: "ko",
      locale: "ko-KR",
      sourceType: "import",
      thumbnailSource: "import-render",
    },
    canvas,
    theme: blueprint.theme,
    slides: templateBlueprint.slides.map((slide, index) => {
      const renderAssetRef = `asset:slide_render_${slide.sourceSlideIndex}`;
      const renderUrl = assetUrls.get(renderAssetRef);
      const blueprintSlide =
        blueprintSlides.get(slide.sourceSlideIndex) ?? blueprint.slides[index];
      const visualElements = blueprintSlide?.elements ?? [];
      const useSnapshotFallback =
        visualElements.length === 0 ||
        visualElements.some(elementHasUnresolvedAssetRef);
      if (!renderUrl) {
        throw new Error(`Rendered slide asset missing: ${renderAssetRef}`);
      }
      const elementSources = new Map(
        slide.elementSources.map((source) => [source.elementId, source]),
      );
      const elements = useSnapshotFallback
        ? []
        : visualElements.map((element) =>
            deckElementSchema.parse({
              ...element,
              ooxmlOrigin: "imported",
              ooxmlEditCapabilities: elementSources.get(element.elementId)
                ?.ooxmlEditCapabilities ?? {
                richText: "none",
                crop: "none",
                tableCellText: false,
                frame: false,
                delete: false,
                imageSource: false,
              },
            }),
          );
      const elementIds = new Set(elements.map((element) => element.elementId));
      const sourceAnimations = blueprintSlide?.animations ?? [];
      const animations = useSnapshotFallback
        ? []
        : sourceAnimations.filter((animation) =>
            elementIds.has(animation.elementId),
          );
      const sourceMotionCapabilities = slide.ooxmlMotionCapabilities ?? {
        transitionWritable: false,
        importedMainSequenceCoverage: "unknown" as const,
      };
      const ooxmlMotionCapabilities =
        sourceMotionCapabilities.importedMainSequenceCoverage === "complete" &&
        animations.length !== sourceAnimations.length
          ? {
              ...sourceMotionCapabilities,
              importedMainSequenceCoverage: "partial" as const,
            }
          : sourceMotionCapabilities;

      return {
        slideId: `slide_ooxml_${safeId(asset.file_id)}_${index + 1}`,
        ooxmlOrigin: "imported",
        ...(slide.sourceSlidePart
          ? { ooxmlSourceSlidePart: slide.sourceSlidePart }
          : {}),
        ooxmlMotionCapabilities,
        order: index + 1,
        title: `Slide ${index + 1}`,
        thumbnailUrl: renderUrl,
        ...(blueprintSlide?.transition
          ? { transition: blueprintSlide.transition }
          : {}),
        style: {
          ...(blueprintSlide?.style ?? {}),
          layout: "title-content",
          ...(useSnapshotFallback
            ? {
                backgroundImage: {
                  src: renderUrl,
                  alt: `Slide ${slide.sourceSlideIndex}`,
                  fit: "stretch",
                  opacity: 1,
                },
              }
            : {}),
        },
        speakerNotes: "",
        elements,
        keywords: [],
        animations,
        aiNotes: {
          emphasisPoints: [],
          sourceEvidence: [],
        },
      };
    }),
  });
}

function reconcileMotionCapabilitiesWithDeck(
  templateBlueprint: OoxmlTemplateBlueprint,
  deck: Deck,
): OoxmlTemplateBlueprint {
  return pptxOoxmlGenerationWorkerResponseSchema.shape.templateBlueprint.parse({
    ...templateBlueprint,
    slides: templateBlueprint.slides.map((slide, index) => ({
      ...slide,
      ooxmlMotionCapabilities:
        deck.slides[index]?.ooxmlMotionCapabilities ??
        slide.ooxmlMotionCapabilities,
    })),
  });
}

function elementHasUnresolvedAssetRef(element: unknown): boolean {
  if (!isRecord(element) || !isRecord(element.props)) {
    return false;
  }
  const src = element.props.src;
  return typeof src === "string" && src.startsWith("asset:");
}

async function saveDeck(executor: EntityManager, deck: Deck): Promise<void> {
  await executor.query(
    `
      INSERT INTO decks (project_id, deck_id, deck_json, version, updated_at)
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (project_id)
      DO UPDATE SET
        deck_id = EXCLUDED.deck_id,
        deck_json = EXCLUDED.deck_json,
        version = EXCLUDED.version,
        updated_at = EXCLUDED.updated_at
    `,
    [deck.projectId, deck.deckId, deck, deck.version],
  );
}

async function saveTemplateBlueprint(
  executor: EntityManager,
  projectId: string,
  deckId: string,
  templateBlueprint: TemplateBlueprint,
  qualityReport: QualityReport,
): Promise<void> {
  await executor.query(
    `
      INSERT INTO template_blueprints (
        template_id, project_id, deck_id, source_file_id,
        blueprint_json, quality_report_json, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, now(), now())
      ON CONFLICT (template_id)
      DO UPDATE SET
        project_id = EXCLUDED.project_id,
        deck_id = EXCLUDED.deck_id,
        source_file_id = EXCLUDED.source_file_id,
        blueprint_json = EXCLUDED.blueprint_json,
        quality_report_json = EXCLUDED.quality_report_json,
        updated_at = EXCLUDED.updated_at
    `,
    [
      templateBlueprint.templateId,
      projectId,
      deckId,
      templateBlueprint.sourceFileId,
      templateBlueprint,
      qualityReport,
    ],
  );
}

async function updateProjectTitle(
  executor: EntityManager,
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

function replaceAssetRefs(value: unknown, refs: Map<string, string>): unknown {
  if (typeof value === "string") {
    return refs.get(value) ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceAssetRefs(item, refs));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceAssetRefs(item, refs),
      ]),
    );
  }

  return value;
}

async function failJob(
  dataSource: DataSource,
  jobId: string,
  progress: number,
  code: string,
  message: string,
): Promise<Job> {
  return updateJob(dataSource, jobId, {
    status: "failed",
    progress,
    message: "PPTX OOXML generation failed.",
    result: null,
    error: { code, message },
  });
}

async function updateJob(
  dataSource: DataSource,
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
  if (!row) {
    throw new Error(`Job not found: ${jobId}`);
  }

  return rowToJob(row);
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

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_") || "pptx";
}

function titleFromFileName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "").trim();
  return stem || "Imported PPTX";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
