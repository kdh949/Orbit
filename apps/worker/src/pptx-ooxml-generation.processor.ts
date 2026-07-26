import {
  animationSchema,
  deckCanvasSchema,
  deckElementSchema,
  deckSchema,
  pptxOoxmlGenerationJobResultSchema,
  pptxOoxmlGenerationRequestSchema,
  pptxOoxmlAssetTransportVersionSchema,
  pptxOoxmlStoredAssetSchema,
  qualityReportSchema,
  slideTransitionSchema,
  slideStyleSchema,
  templateBlueprintSchema,
  themeSchema,
  type Deck,
  type DeckCanvas,
  type QualityReport,
  type QualityReportSlide,
  type PptxImportPreference,
  type SlideImportRenderMode,
  type TemplateBlueprint,
} from "@orbit/shared/deck";
import { type Job } from "@orbit/shared/jobs";
import type { StoragePort } from "@orbit/storage";
import type { DataSource, EntityManager } from "typeorm";
import { z } from "zod";
import {
  createPptxOoxmlAssetRefs,
  createPptxOoxmlStoragePrefix,
  registerPptxOoxmlStoredAssets,
  verifyPptxOoxmlStoredAssets,
} from "./pptx-ooxml-stored-assets";

const pptxOoxmlGenerationPayloadSchema = z.object({
  jobId: z.string().min(1),
  projectId: z.string().min(1),
  request: pptxOoxmlGenerationRequestSchema,
});

const ooxmlGenerationBlueprintSlideSchema = z
  .object({
    sourceSlideIndex: z.number().int().positive().optional(),
    speakerNotes: z.string().default(""),
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
  assetTransport: pptxOoxmlAssetTransportVersionSchema,
  assets: z.array(pptxOoxmlStoredAssetSchema).default([]),
  warnings: z.array(z.string()).default([]),
});

type PptxOoxmlGenerationWorkerResponse = z.infer<
  typeof pptxOoxmlGenerationWorkerResponseSchema
>;
type OoxmlGenerationBlueprint = PptxOoxmlGenerationWorkerResponse["blueprint"];
type OoxmlTemplateBlueprint =
  PptxOoxmlGenerationWorkerResponse["templateBlueprint"];

type SlideRenderModeDecision = {
  fontSubstitutionCount: number;
  pixelEvaluation: "passed" | "failed" | "not-evaluated";
  reasons: string[];
  recommendedRenderMode: SlideImportRenderMode;
  selectedRenderMode: SlideImportRenderMode;
  slideIndex: number;
  unsupportedObjectCount: number;
};

type SlideRenderModeElement = {
  elementId: string;
  props?: unknown;
};

type SlideRenderModeElementSource = {
  elementId: string;
  fallbackReason?: string;
  relationshipId?: string;
};

type SlideRenderModeSelectionInput = {
  importPreference: PptxImportPreference;
  qualityReportSlide?: QualityReportSlide;
  slideIndex: number;
  sourceElementSources: SlideRenderModeElementSource[];
  visualElements: SlideRenderModeElement[];
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
  storage: Pick<StoragePort, "getSignedReadUrl" | "headObject">,
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
      payload.request.importPreference,
      createPptxOoxmlStoragePrefix(payload.projectId, payload.jobId),
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
    const storagePrefix = createPptxOoxmlStoragePrefix(
      payload.projectId,
      payload.jobId,
    );
    await verifyPptxOoxmlStoredAssets(
      storage,
      storagePrefix,
      generated.assets,
    );
    const assetRefs = createPptxOoxmlAssetRefs(
      payload.projectId,
      generated.assets,
    );
    const failedNotesPreviewRefs = collectMissingNotesPreviewRefs(
      generated.templateBlueprint,
      assetRefs.fileIds,
    );
    const reconciledNotes = reconcileFailedNotesPreviewAssets(
      generated.templateBlueprint,
      generated.qualityReport,
      failedNotesPreviewRefs,
    );
    const templateBlueprint =
      pptxOoxmlGenerationWorkerResponseSchema.shape.templateBlueprint.parse(
        replaceAssetRefs(reconciledNotes.templateBlueprint, assetRefs.fileIds),
      );
    const deckBlueprint =
      pptxOoxmlGenerationWorkerResponseSchema.shape.blueprint.parse(
        replaceAssetRefs(generated.blueprint, assetRefs.urls),
      );
    const builtDeck = buildOoxmlDeck(
      payload.projectId,
      asset,
      generated.canvas,
      deckBlueprint,
      templateBlueprint,
      assetRefs.urls,
      reconciledNotes.qualityReport,
      payload.request.importPreference,
    );
    const deck = builtDeck.deck;
    const qualityReport = reconcileSlideRenderModeDiagnostics(
      reconciledNotes.qualityReport,
      builtDeck.decisions,
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
      await registerPptxOoxmlStoredAssets(
        manager,
        payload.projectId,
        generated.assets,
      );
      await saveDeck(manager, deck);
      await saveTemplateBlueprint(
        manager,
        payload.projectId,
        deck.deckId,
        mappedTemplateBlueprint,
        qualityReport,
      );
      await updateProjectTitle(manager, payload.projectId, deck.title);
    });

    const result = pptxOoxmlGenerationJobResultSchema.parse({
      deckId: deck.deckId,
      templateId: templateBlueprint.templateId,
      sourceFileId: payload.request.fileId,
      currentPackageFileId: templateBlueprint.currentPackageFileId,
      qualityReport,
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
  importPreference: PptxImportPreference,
  storagePrefix: string,
): Promise<PptxOoxmlGenerationWorkerResponse> {
  const readUrl = await storage.getSignedReadUrl(asset.storage_key);
  const sourceResponse = await fetch(readUrl);
  if (!sourceResponse.ok) {
    throw new Error(`PPTX content unavailable: ${asset.file_id}`);
  }

  const form = new FormData();
  form.append("file_id", asset.file_id);
  form.append("import_preference", importPreference);
  form.append("storage_prefix", storagePrefix);
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

function buildOoxmlDeck(
  projectId: string,
  asset: ProjectAssetRow,
  canvas: DeckCanvas,
  blueprint: OoxmlGenerationBlueprint,
  templateBlueprint: OoxmlTemplateBlueprint,
  assetUrls: Map<string, string>,
  qualityReport: QualityReport,
  importPreference: PptxImportPreference,
): { deck: Deck; decisions: SlideRenderModeDecision[] } {
  const title = titleFromFileName(asset.original_name);
  const blueprintSlides = new Map(
    blueprint.slides.map((slide, index) => [
      slide.sourceSlideIndex ?? index + 1,
      slide,
    ]),
  );

  const slideReports = new Map(
    qualityReport.slideReports.map((report) => [report.slideIndex, report]),
  );
  const decisions: SlideRenderModeDecision[] = [];
  const deck = deckSchema.parse({
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
      if (!renderUrl) {
        throw new Error(`Rendered slide asset missing: ${renderAssetRef}`);
      }
      const decision = selectSlideImportRenderMode({
        importPreference,
        qualityReportSlide: slideReports.get(slide.sourceSlideIndex),
        slideIndex: slide.sourceSlideIndex,
        sourceElementSources: slide.elementSources,
        visualElements,
      });
      decisions.push(decision);
      const elementSources = new Map(
        slide.elementSources.map((source) => [source.elementId, source]),
      );
      const elements = visualElements.map((element) =>
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
      const animations = sourceAnimations.filter((animation) =>
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
        importRenderMode: decision.selectedRenderMode,
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
          ...(decision.selectedRenderMode === "snapshot"
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
        speakerNotes: blueprintSlide?.speakerNotes ?? "",
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

  return { deck, decisions };
}

export function selectSlideImportRenderMode(
  args: SlideRenderModeSelectionInput,
): SlideRenderModeDecision {
  const {
    importPreference,
    qualityReportSlide,
    slideIndex,
    sourceElementSources,
    visualElements,
  } = args;
  const pixelEvaluation =
    qualityReportSlide?.pixelEvaluation ??
    {
      passed: "passed" as const,
      vectorization_failed: "failed" as const,
      not_evaluated: "not-evaluated" as const,
    }[qualityReportSlide?.status ?? "not_evaluated"];
  const fallbackSources = sourceElementSources.filter(
    (source) => Boolean(source.fallbackReason),
  );
  const visualElementIds = new Set(
    visualElements.map((element) => element.elementId),
  );
  const hasUnresolvedAsset = visualElements.some(elementHasUnresolvedAssetRef);
  const hasMissingFallbackElement = fallbackSources.some(
    (source) => !visualElementIds.has(source.elementId),
  );
  const hasMissingRelationshipElement = sourceElementSources.some(
    (source) =>
      Boolean(source.relationshipId) && !visualElementIds.has(source.elementId),
  );
  const reportedUnsupportedObjectCount =
    qualityReportSlide?.unsupportedObjectCount ?? 0;
  const hasUnaccountedUnsupportedObject =
    reportedUnsupportedObjectCount > fallbackSources.length;
  const hasDataLossRisk =
    visualElements.length === 0 ||
    hasUnresolvedAsset ||
    hasMissingFallbackElement ||
    hasMissingRelationshipElement ||
    hasUnaccountedUnsupportedObject;
  const capabilityMode: SlideImportRenderMode = hasDataLossRisk
    ? "snapshot"
    : fallbackSources.length > 0
      ? "hybrid"
      : "editable";
  const selectedRenderMode: SlideImportRenderMode = hasDataLossRisk
    ? "snapshot"
    : importPreference === "appearance-first" && pixelEvaluation !== "passed"
      ? "snapshot"
      : capabilityMode;
  const reasons: string[] = [];

  if (visualElements.length === 0) {
    reasons.push("PPTX_RENDER_MODE_SNAPSHOT_VISUAL_TREE_EMPTY");
  }
  if (hasUnresolvedAsset) {
    reasons.push("PPTX_RENDER_MODE_SNAPSHOT_UNRESOLVED_ASSET");
  }
  if (hasMissingFallbackElement) {
    reasons.push("PPTX_RENDER_MODE_SNAPSHOT_FALLBACK_ELEMENT_MISSING");
  }
  if (hasMissingRelationshipElement) {
    reasons.push("PPTX_RENDER_MODE_SNAPSHOT_RELATIONSHIP_ELEMENT_MISSING");
  }
  if (hasUnaccountedUnsupportedObject) {
    reasons.push("PPTX_RENDER_MODE_SNAPSHOT_UNACCOUNTED_UNSUPPORTED_OBJECT");
  }
  if (fallbackSources.length > 0 && !hasDataLossRisk) {
    reasons.push("PPTX_RENDER_MODE_HYBRID_RASTER_FALLBACK");
  }
  if (
    importPreference === "appearance-first" &&
    pixelEvaluation === "not-evaluated" &&
    !hasDataLossRisk
  ) {
    reasons.push("PPTX_RENDER_MODE_APPEARANCE_SNAPSHOT_PIXEL_NOT_EVALUATED");
  }
  if (
    importPreference === "appearance-first" &&
    pixelEvaluation === "failed" &&
    !hasDataLossRisk
  ) {
    reasons.push("PPTX_RENDER_MODE_APPEARANCE_SNAPSHOT_PIXEL_FAILED");
  }
  if (
    importPreference === "editability-first" &&
    pixelEvaluation === "not-evaluated" &&
    !hasDataLossRisk
  ) {
    reasons.push("PPTX_RENDER_MODE_EDITABILITY_PIXEL_NOT_EVALUATED");
  }

  return {
    fontSubstitutionCount: qualityReportSlide?.fontSubstitutionCount ?? 0,
    pixelEvaluation,
    reasons,
    recommendedRenderMode: selectedRenderMode,
    selectedRenderMode,
    slideIndex,
    unsupportedObjectCount: Math.max(
      fallbackSources.length,
      reportedUnsupportedObjectCount,
    ),
  };
}

function reconcileSlideRenderModeDiagnostics(
  qualityReport: QualityReport,
  decisions: SlideRenderModeDecision[],
): QualityReport {
  const existingReports = new Map(
    qualityReport.slideReports.map((report) => [report.slideIndex, report]),
  );

  return qualityReportSchema.parse({
    ...qualityReport,
    slideReports: decisions.map((decision) => {
      const existing = existingReports.get(decision.slideIndex) ?? {
        slideIndex: decision.slideIndex,
        status: "not_evaluated" as const,
        ssim: null,
        reasons: [],
        fallback: "none" as const,
      };
      return {
        ...existing,
        ...decision,
        reasons: [...new Set([...existing.reasons, ...decision.reasons])],
        fallback:
          decision.selectedRenderMode === "snapshot"
            ? "rendered-background"
            : "none",
      };
    }),
  });
}

function reconcileFailedNotesPreviewAssets(
  templateBlueprint: OoxmlTemplateBlueprint,
  qualityReport: QualityReport,
  failedRefs: ReadonlySet<string>,
): {
  templateBlueprint: OoxmlTemplateBlueprint;
  qualityReport: QualityReport;
} {
  if (failedRefs.size === 0) {
    return { templateBlueprint, qualityReport };
  }

  let affectedCount = 0;
  const slides = templateBlueprint.slides.map((slide) => {
    const notesPage = slide.notesPage;
    if (
      !notesPage?.renderAssetFileId ||
      !failedRefs.has(notesPage.renderAssetFileId)
    ) {
      return slide;
    }

    affectedCount += 1;
    const downgradedNotesPage = { ...notesPage };
    delete downgradedNotesPage.renderAssetFileId;
    return {
      ...slide,
      notesPage: {
        ...downgradedNotesPage,
        status: "render-unavailable" as const,
      },
    };
  });

  if (affectedCount === 0) {
    return { templateBlueprint, qualityReport };
  }

  const diagnostics = qualityReport.notesDiagnostics ?? {
    total: slides.length,
    imported: slides.filter((slide) => slide.notesPage?.sourceNotesPart).length,
    rendered: 0,
    writable: slides.filter((slide) => slide.notesPage?.bodyWritable).length,
    warnings: [],
  };
  const warningCounts = new Map(
    diagnostics.warnings.map((warning) => [warning.code, warning.count]),
  );
  warningCounts.set(
    "PPTX_NOTES_PREVIEW_ASSET_FAILED",
    (warningCounts.get("PPTX_NOTES_PREVIEW_ASSET_FAILED") ?? 0) +
      affectedCount,
  );

  return {
    templateBlueprint: templateBlueprintSchema.parse({
      ...templateBlueprint,
      slides,
    }),
    qualityReport: qualityReportSchema.parse({
      ...qualityReport,
      notesDiagnostics: {
        ...diagnostics,
        rendered: Math.max(0, diagnostics.rendered - affectedCount),
        warnings: [...warningCounts.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([code, count]) => ({ code, count })),
      },
    }),
  };
}

function collectMissingNotesPreviewRefs(
  templateBlueprint: OoxmlTemplateBlueprint,
  storedFileIds: ReadonlyMap<string, string>,
): Set<string> {
  const missingRefs = new Set<string>();
  for (const slide of templateBlueprint.slides) {
    const ref = slide.notesPage?.renderAssetFileId;
    if (ref?.startsWith("asset:") && !storedFileIds.has(ref)) {
      missingRefs.add(ref);
    }
  }
  return missingRefs;
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
        key === "speakerNotes" ? item : replaceAssetRefs(item, refs),
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
