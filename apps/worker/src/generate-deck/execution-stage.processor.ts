import {
  aiDeckGenerationStageMessageSchema,
  deckSchema,
  generateDeckJobResultSchema,
  generateDeckResponseSchema,
  generateDeckStoredJobPayloadSchema,
  generateDeckVisualIssueCodeSchema,
  jobErrorSchema,
  jobSchema,
  jobStatusSchema,
  type AiDeckGenerationStageMessage,
  type GenerateDeckResponse,
  type Job,
  type JobError,
} from "@orbit/shared";
import type { StoragePort } from "@orbit/storage";
import type { DataSource } from "typeorm";
import { z } from "zod";
import type { ImageAssetRuntime } from "../image-asset-pipeline";
import {
  OptionalMediaFallbackUnavailableError,
  hasMediaPlaceholder,
  resolveGenerateDeckAssets,
} from "./asset-resolution";
import { AiDeckExecutionArtifactRepository } from "./execution-artifact-repository";
import {
  completedSlideV2ArtifactPayloadSchema,
  coverSlideArtifactPayloadSchema,
  imageSlideArtifactPayloadSchema,
  isCompletedSlideV2Artifact,
  isAiDeckExecutionStage,
  qualityArtifactPayloadSchema,
  type AiDeckExecutionArtifactPayload,
  type AiDeckExecutionStage,
} from "./execution-stage-contract";
import { AiDeckPlanningArtifactRepository } from "./planning-artifact-repository";
import {
  contentPlanningArtifactPayloadSchema,
  designPlanningArtifactPayloadSchema,
  isLayoutCompileV2Artifact,
  layoutCompileArtifactPayloadSchema,
  type LayoutCompileV2ArtifactPayload,
} from "./planning-stage-contract";
import { markDeckForInitialThumbnailRefresh } from "./pipeline";
import {
  RenderedVisualQualityUnavailableError,
  renderedVisualQualityDiagnostics,
  runRenderedVisualQuality,
} from "./rendered-visual-quality";
import {
  allValidationIssues,
  hasBlockingQualityGateIssues,
  runInitialSemanticQuality,
  withGenerationQualityMetadata,
  withDuplicateMediaAssetIssue,
  withHybridMediaBudgetIssue,
  withVisualIssues,
} from "./semantic-quality";
import {
  AiDeckGenerationStageCheckpointRepository,
  type AiDeckGenerationStageCheckpoint,
} from "./stage-checkpoint-repository";
import {
  compactDiagnostics,
  contractErrorDiagnostics,
  emitStageEvent,
  stageEventFields,
  unknownErrorDiagnostics,
  type AiDeckStageEventLogger,
  type SafeStageErrorDiagnostics,
} from "./stage-diagnostics";
import { composeAiDeckSlide } from "./slide-compose-python-client";

const executionMessageSchema = aiDeckGenerationStageMessageSchema.refine(
  (message) => isAiDeckExecutionStage(message.stage),
  { message: "AI deck execution stage required" },
);
const timestampSchema = z.union([z.date(), z.string().min(1)]);
const parentJobRowSchema = z.object({
  job_id: z.string().min(1),
  project_id: z.string().min(1),
  type: z.literal("ai-deck-generation"),
  status: jobStatusSchema,
  progress: z.number().int().min(0).max(100),
  message: z.string(),
  result: z.record(z.unknown()).nullable(),
  error: jobErrorSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export interface AiDeckExecutionStageProcessorOptions {
  heartbeatIntervalMs?: number;
  eventLogger?: AiDeckStageEventLogger;
  claimedCheckpoint?: AiDeckGenerationStageCheckpoint;
}

export async function processAiDeckExecutionStage(
  dataSource: DataSource,
  storage: Pick<StoragePort, "getSignedReadUrl" | "putObject">,
  pythonWorkerUrl: string,
  workerId: string,
  rawMessage: unknown,
  imageRuntime?: ImageAssetRuntime,
  options: AiDeckExecutionStageProcessorOptions = {},
): Promise<Job | void> {
  const parsed = executionMessageSchema.parse(rawMessage);
  if (!isAiDeckExecutionStage(parsed.stage)) {
    throw new Error("AI deck execution stage required.");
  }
  const message = { ...parsed, stage: parsed.stage };
  const checkpoints = new AiDeckGenerationStageCheckpointRepository(dataSource);
  const claimed =
    options.claimedCheckpoint ?? (await checkpoints.claim(message, workerId));
  if (!claimed) return;
  assertClaimMatches(message, claimed);
  if (!claimed.leaseOwner) throw new Error("Claimed stage has no lease owner.");
  const startedAt = Date.now();
  emitStageEvent(
    options.eventLogger,
    "ai-ppt.stage.started",
    stageEventFields(message, workerId, claimed.attempt, startedAt),
  );

  const controller = new AbortController();
  let leaseLost = false;
  let heartbeatRunning = false;
  const heartbeat = setInterval(() => {
    if (leaseLost || heartbeatRunning) return;
    heartbeatRunning = true;
    void checkpoints
      .renewLease(message, claimed.leaseOwner!, claimed.attempt)
      .then((renewed) => {
        if (!renewed) {
          leaseLost = true;
          controller.abort();
        }
      })
      .catch(() => {
        leaseLost = true;
        controller.abort();
      })
      .finally(() => {
        heartbeatRunning = false;
      });
  }, options.heartbeatIntervalMs ?? 60_000);
  heartbeat.unref?.();

  try {
    const context = await loadParentContext(dataSource, message);
    const payload = await executeStage({
      dataSource,
      storage,
      pythonWorkerUrl,
      message,
      inputRef: claimed.inputRef,
      context,
      imageRuntime,
      eventLogger: options.eventLogger,
      workerId,
      attempt: claimed.attempt,
      startedAt,
    });
    if (leaseLost) return;
    if (message.stage === "publication") {
      const result = generateDeckJobResultSchema.parse(
        (payload as { result: unknown }).result,
      );
      const job = await publishAtomically(
        dataSource,
        { ...message, stage: "publication" },
        claimed.leaseOwner,
        claimed.attempt,
        result,
        options.eventLogger,
      );
      emitStageEvent(
        options.eventLogger,
        "ai-ppt.stage.succeeded",
        stageEventFields(message, workerId, claimed.attempt, startedAt),
      );
      return job;
    }
    const job = await completeStage(
      dataSource,
      message,
      claimed.leaseOwner,
      claimed.attempt,
      claimed.inputRef,
      payload,
    );
    emitStageEvent(
      options.eventLogger,
      "ai-ppt.stage.succeeded",
      stageEventFields(message, workerId, claimed.attempt, startedAt),
    );
    return job;
  } catch (error) {
    if (leaseLost || error instanceof AiDeckExecutionFencingLostError) return;
    if (isRetrySignal(error)) throw error;
    const normalized = normalizeExecutionError(error, message.stage);
    const diagnostics = executionErrorDiagnostics(error, normalized.error);
    if (normalized.error.retryable && claimed.attempt < 5) {
      const released = await checkpoints.releaseForRetry(
        message,
        claimed.leaseOwner,
        claimed.attempt,
        normalized.error,
      );
      if (released) {
        emitStageEvent(
          options.eventLogger,
          "ai-ppt.stage.attempt-failed",
          stageEventFields(
            message,
            workerId,
            claimed.attempt,
            startedAt,
            false,
            diagnostics,
          ),
        );
        throw retrySignal();
      }
      return;
    }
    const v2ImageShard =
      message.stage === "image-slide" &&
      (await isV2ImageShard(dataSource, message, claimed.inputRef));
    const result = message.stage === "cover-slide"
      ? await failOptionalCoverStage(
          dataSource,
          message,
          claimed.leaseOwner,
          claimed.attempt,
          normalized.error,
        )
      : v2ImageShard
        ? await failV2ImageShardAndJoin(
          dataSource,
          message,
          claimed.leaseOwner,
          claimed.attempt,
          normalized.error,
        )
        : await failStageAndParent(
          dataSource,
          message,
          claimed.leaseOwner,
          claimed.attempt,
          normalized.error,
          normalized.result,
        );
    if (result) {
      emitStageEvent(
        options.eventLogger,
        "ai-ppt.stage.failed",
        stageEventFields(
          message,
          workerId,
          claimed.attempt,
          startedAt,
          true,
          diagnostics,
        ),
      );
    }
    return result;
  } finally {
    clearInterval(heartbeat);
  }
}

function assertClaimMatches(
  message: AiDeckGenerationStageMessage,
  claimed: AiDeckGenerationStageCheckpoint,
): void {
  if (
    claimed.pipelineJobId !== message.pipelineJobId ||
    claimed.stage !== message.stage ||
    claimed.shardKey !== message.shardKey ||
    claimed.status !== "running"
  ) {
    throw new Error("Preclaimed AI deck checkpoint identity mismatch.");
  }
}

async function executeStage(input: {
  dataSource: DataSource;
  storage: Pick<StoragePort, "getSignedReadUrl" | "putObject">;
  pythonWorkerUrl: string;
  message: AiDeckGenerationStageMessage & { stage: AiDeckExecutionStage };
  inputRef: Record<string, unknown>;
  context: Awaited<ReturnType<typeof loadParentContext>>;
  imageRuntime?: ImageAssetRuntime;
  eventLogger?: AiDeckStageEventLogger;
  workerId: string;
  attempt: number;
  startedAt: number;
}): Promise<AiDeckExecutionArtifactPayload> {
  switch (input.message.stage) {
    case "cover-slide":
      return executeCoverSlide(input);
    case "image-slide":
      return executeImageSlide(input);
    case "semantic-quality":
      return executeSemanticQuality(input);
    case "rendered-visual-quality":
      return executeRenderedVisualQuality(input);
    case "publication": {
      const artifact = await new AiDeckExecutionArtifactRepository(
        input.dataSource,
      ).get(input.message, input.inputRef, "rendered-visual-quality");
      const workerPayload = qualityArtifactPayloadSchema.parse(
        artifact.payload,
      ).workerPayload;
      return {
        result: generateDeckJobResultSchema.parse({
          deckId: workerPayload.deck.deckId,
          ...workerPayload,
          coachingProvenance: input.context.request.coachingContext,
        }),
      };
    }
  }
}

async function executeImageSlide(
  input: Parameters<typeof executeStage>[0],
): Promise<AiDeckExecutionArtifactPayload> {
  const layout = await loadLayoutArtifact(
    input.dataSource,
    input.message,
    input.inputRef,
  );
  if (isLayoutCompileV2Artifact(layout)) {
    return executeV2ImageSlide(input, layout);
  }
  const workerPayload = layout.workerPayload;
  let deck = markDeckForInitialThumbnailRefresh(
    workerPayload.deck,
    input.context.designPackSnapshot,
  );
  const slideIds = visualSlideIds(layout.visualRequirements);
  const slideIndex = slideIds.indexOf(input.message.shardKey);
  if (slideIndex < 0) {
    throw new StageTerminalError(
      "AI_DECK_IMAGE_SHARD_INVALID",
      "AI deck image shard does not match the layout artifact.",
    );
  }
  const resolved = await resolveGenerateDeckAssets({
    dataSource: input.dataSource,
    storage: input.storage,
    pythonWorkerUrl: input.pythonWorkerUrl,
    deck,
    validation: workerPayload.validation,
    imageRuntime: input.imageRuntime,
    imageAssetScope: input.context.imageAssetScope,
    officialAssetFileIds: input.context.request.officialAssetFileIds ?? [],
    onlySlideIds: new Set([input.message.shardKey]),
    deterministicIdentity: `${input.message.projectId}:${input.message.pipelineJobId}`,
    onImageFallback: (diagnostic) =>
      emitStageEvent(
        input.eventLogger,
        "ai-ppt.image-asset.fallback",
        stageEventFields(
          input.message,
          input.workerId,
          input.attempt,
          input.startedAt,
          false,
          {
            code: "GENERATE_DECK_OPTIONAL_IMAGE_FALLBACK",
            ...diagnostic,
          },
        ),
      ),
  });
  deck = resolved.deck;
  const slide = deck.slides.find(
    (candidate) => candidate.slideId === input.message.shardKey,
  );
  if (!slide) throw new Error("Resolved AI deck image slide is missing.");
  emit(input.eventLogger, "ai-ppt.asset.resolved", {
    jobId: input.message.pipelineJobId,
    projectId: input.message.projectId,
    slideId: slide.slideId,
  });
  return imageSlideArtifactPayloadSchema.parse({
    slide,
    warnings: resolved.warnings,
  });
}

function executeCoverSlide(
  input: Parameters<typeof executeStage>[0],
): AiDeckExecutionArtifactPayload {
  const plan = input.context.coverPlan;
  const selection = input.context.designSelection;
  if (!plan || !selection) {
    throw new StageTerminalError(
      "AI_DECK_COVER_INPUT_MISSING",
      "AI deck cover input is unavailable.",
    );
  }
  const palette = selection.paletteOverride;
  const font = selection.fontOverride;
  const deck = deckSchema.parse({
    deckId: `deck_${input.message.pipelineJobId}`,
    projectId: input.message.projectId,
    title: plan.title,
    version: 1,
    metadata: {
      language: "ko",
      locale: "ko-KR",
      sourceType: "ai",
      generatedBy: "ai",
      audience: input.context.request.metadata.audience,
      purpose: input.context.request.metadata.purpose,
      tone: input.context.request.metadata.tone,
      createdFrom: {
        topic: input.context.request.topic,
        references: input.context.request.referenceFileIds.map((fileId) => ({ fileId })),
        designReferences: [],
      },
    },
    targetDurationMinutes: input.context.request.targetDurationMinutes,
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    },
    theme: {
      name: selection.paletteOptionId,
      fontFamily: font.bodyFontFamily,
      backgroundColor: palette.background,
      textColor: palette.text,
      accentColor: palette.accentColor,
      palette: {
        primary: palette.primary,
        secondary: palette.secondary,
        surface: palette.surface,
        muted: palette.muted,
        border: palette.border,
      },
      typography: {
        headingFontFamily: font.headingFontFamily,
        bodyFontFamily: font.bodyFontFamily,
        titleSize: font.recommendedTitleSize,
        headingSize: Math.max(32, font.recommendedTitleSize - 8),
        bodySize: font.recommendedBodySize,
        captionSize: Math.max(14, font.recommendedBodySize - 6),
      },
      effects: { borderRadius: 8 },
    },
    slides: [
      {
        kind: "content",
        slideId: "slide_1",
        order: 1,
        title: plan.title,
        thumbnailUrl: "",
        style: {
          layout: "title",
          fontFamily: font.bodyFontFamily,
          backgroundColor: palette.background,
          textColor: palette.text,
          accentColor: palette.accentColor,
        },
        speakerNotes: "",
        elements: [
          {
            elementId: "el_cover_backdrop",
            type: "rect",
            role: "decoration",
            x: 1320,
            y: 0,
            width: 600,
            height: 1080,
            rotation: 8,
            opacity: 0.72,
            zIndex: 1,
            props: { fill: palette.muted, borderRadius: 84 },
          },
          {
            elementId: "el_cover_accent",
            type: "rect",
            role: "decoration",
            x: 132,
            y: 190,
            width: 96,
            height: 14,
            zIndex: 2,
            props: { fill: palette.accentColor, borderRadius: 7 },
          },
          {
            elementId: "el_cover_title",
            type: "text",
            role: "title",
            x: 132,
            y: 292,
            width: 1240,
            height: 430,
            zIndex: 3,
            props: {
              text: plan.title,
              fontFamily: font.headingFontFamily,
              fontSize: Math.max(
                64,
                Math.min(88, font.recommendedTitleSize + 20),
              ),
              fontWeight: "bold",
              color: palette.text,
              lineHeight: Math.max(1.05, Math.min(1.2, font.lineHeight)),
            },
          },
        ],
        keywords: [],
        semanticCues: [],
        animations: [],
        actions: [],
        aiNotes: {
          emphasisPoints: [plan.title],
          sourceEvidence: [],
          visualPlan: {
            visualType: "minimal-cover",
            imageNeeded: false,
            imageSourcePolicy: "minimal",
            reason: "Fast deterministic cover preview",
          },
          compositionPlan: {
            compositionId: "minimal-cover",
            variant: "selected-palette",
            backgroundMode: "light",
            focalType: "title",
            primaryFocalElementId: "el_cover_title",
            assetRole: "none",
            requiredAsset: false,
          },
        },
      },
    ],
  });
  return coverSlideArtifactPayloadSchema.parse({
    deck,
    warnings: [],
    validation: emptyValidation(),
  });
}

function emptyValidation() {
  return {
    passed: true,
    layoutIssues: [],
    contentIssues: [],
    designIssues: [],
    presentationIssues: [],
  } as const;
}

const contentPlanSlideSchema = z
  .object({
    order: z.number().int().positive(),
    title: z.string().min(1),
    message: z.string().min(1),
    speaker_notes: z.string().optional(),
    speakerNotes: z.string().optional(),
    source_refs: z.array(z.string()).optional(),
    sourceRefs: z.array(z.string()).optional(),
  })
  .passthrough();
const v2ContentSchema = z.object({
  outline: z.record(z.unknown()),
  slidePlans: z.array(contentPlanSlideSchema).min(1),
});

async function executeV2ImageSlide(
  input: Parameters<typeof executeStage>[0],
  layout: LayoutCompileV2ArtifactPayload,
): Promise<AiDeckExecutionArtifactPayload> {
  const descriptor = layout.slides.find(
    (slide) => slide.shardKey === input.message.shardKey,
  );
  if (!descriptor) {
    throw new StageTerminalError(
      "AI_DECK_SLIDE_SHARD_INVALID",
      "AI deck slide shard does not match the layout manifest.",
    );
  }
  const planning = new AiDeckPlanningArtifactRepository(input.dataSource);
  const [contentArtifact, designArtifact] = await Promise.all([
    planning.getByStage(input.message, "content-planning"),
    planning.getByStage(input.message, "design-planning"),
  ]);
  const content = contentPlanningArtifactPayloadSchema.parse(
    contentArtifact.payload,
  );
  const design = designPlanningArtifactPayloadSchema.parse(
    designArtifact.payload,
  );
  const contentPlan = v2ContentSchema.parse(content.contentPlan);
  const plannedSlide = contentPlan.slidePlans.find(
    (slide) => slide.order === descriptor.order,
  );
  if (!plannedSlide) {
    throw new StageTerminalError(
      "AI_DECK_CONTENT_PLAN_SLIDE_MISSING",
      "Content plan slide is missing from the content artifact.",
    );
  }
  const composed = await composeAiDeckSlide(input.pythonWorkerUrl, {
    rawInput: scopeRawInputForSlide(content.rawInput, plannedSlide),
    contentPlan: content.contentPlan,
    designPlan: design.designPlan,
    sourceOrder: descriptor.sourceOrder,
    order: descriptor.order,
    slideId: descriptor.slideId,
  });
  emit(input.eventLogger, "ai-ppt.fact-validation.completed", {
    jobId: input.message.pipelineJobId,
    projectId: input.message.projectId,
    durationMs: composed.factDiagnostics.validationDurationMs,
    issueCodes: composed.factDiagnostics.issueCodes,
    slideOrders: composed.factDiagnostics.slideOrders,
  });
  if (composed.factDiagnostics.repairAttempted) {
    emit(input.eventLogger, "ai-ppt.fact-repair.attempted", {
      jobId: input.message.pipelineJobId,
      projectId: input.message.projectId,
      durationMs: composed.factDiagnostics.repairDurationMs,
      slideOrders: [descriptor.order],
      repairCount: 1,
      succeeded: composed.factDiagnostics.repairSucceeded,
    });
  }
  assertCompletedSlideMatchesContentPlan(
    composed.slide,
    plannedSlide,
    descriptor,
  );

  let deck = markDeckForInitialThumbnailRefresh(
    deckSchema.parse({ ...layout.deckShell, slides: [composed.slide] }),
    input.context.designPackSnapshot,
  );
  const resolved = await resolveGenerateDeckAssets({
    dataSource: input.dataSource,
    storage: input.storage,
    pythonWorkerUrl: input.pythonWorkerUrl,
    deck,
    validation: composed.validation,
    imageRuntime: input.imageRuntime,
    imageAssetScope: input.context.imageAssetScope,
    officialAssetFileIds: input.context.request.officialAssetFileIds ?? [],
    onlySlideIds: new Set([descriptor.slideId]),
    deterministicIdentity: `${input.message.projectId}:${input.message.pipelineJobId}`,
    onImageFallback: (diagnostic) =>
      emitStageEvent(
        input.eventLogger,
        "ai-ppt.image-asset.fallback",
        stageEventFields(
          input.message,
          input.workerId,
          input.attempt,
          input.startedAt,
          false,
          { code: "GENERATE_DECK_OPTIONAL_IMAGE_FALLBACK", ...diagnostic },
        ),
      ),
  });
  const semantic = runInitialSemanticQuality(resolved);
  if (
    hasBlockingQualityGateIssues(semantic.validation) ||
    semantic.unresolvedMedia
  ) {
    throw new StageTerminalError(
      "GENERATE_DECK_SLIDE_QUALITY_GATE_FAILED",
      "Generated slide did not pass deterministic validation.",
    );
  }
  let finalizedDeck = semantic.deck;
  let finalizedValidation = semantic.validation;
  const warnings = [
    ...layout.warnings,
    ...composed.warnings,
    ...resolved.warnings,
    ...semantic.warnings,
  ];
  try {
    const visual = await runRenderedVisualQuality({
      dataSource: input.dataSource,
      storage: input.storage,
      pythonWorkerUrl: input.pythonWorkerUrl,
      deck: finalizedDeck,
      validation: finalizedValidation,
      imageRuntime: input.imageRuntime,
      imageAssetScope: input.context.imageAssetScope,
      officialAssetFileIds: input.context.request.officialAssetFileIds ?? [],
      enforcesHybridMediaBudget: false,
      jobId: input.message.pipelineJobId,
      projectId: input.message.projectId,
      onRepairProgress: async () => undefined,
      emitEvent: (event, fields) => emit(input.eventLogger, event, fields),
      maxRepairAttempts: 0,
    });
    if (!visual.passed) {
      throw new StageTerminalError(
        "GENERATE_DECK_SLIDE_VISUAL_QUALITY_GATE_FAILED",
        "Generated slide did not pass rendered visual quality review.",
      );
    }
    finalizedDeck = visual.deck;
    finalizedValidation = visual.issues.length > 0
      ? withVisualIssues(visual.validation, visual.issues)
      : visual.validation;
    warnings.push(...visual.warnings);
  } catch (error) {
    if (!(error instanceof RenderedVisualQualityUnavailableError)) throw error;
    if (
      hasBlockingQualityGateIssues(error.validation) ||
      hasMediaPlaceholder(error.deck)
    ) {
      throw new StageTerminalError(
        "GENERATE_DECK_SLIDE_QUALITY_GATE_FAILED",
        "Generated slide could not be validated.",
      );
    }
    finalizedDeck = error.deck;
    finalizedValidation = error.validation;
    warnings.push(...error.warnings, "Rendered Visual QA was unavailable.");
  }
  const slide = finalizedDeck.slides[0];
  if (!slide) throw new Error("Completed AI deck slide is missing.");
  assertCompletedSlideMatchesContentPlan(slide, plannedSlide, descriptor);
  emit(input.eventLogger, "ai-ppt.slide.completed", {
    jobId: input.message.pipelineJobId,
    projectId: input.message.projectId,
    slideId: slide.slideId,
    sourceOrder: descriptor.sourceOrder,
    durationMs: Date.now() - input.startedAt,
  });
  return completedSlideV2ArtifactPayloadSchema.parse({
    artifactVersion: 2,
    sourceOrder: descriptor.sourceOrder,
    order: descriptor.order,
    slideId: descriptor.slideId,
    slide,
    warnings: unique(warnings),
    validation: finalizedValidation,
  });
}

function scopeRawInputForSlide(
  rawInput: Record<string, unknown>,
  plannedSlide: z.infer<typeof contentPlanSlideSchema>,
): Record<string, unknown> {
  const sourceRefs = new Set(
    plannedSlide.sourceRefs ?? plannedSlide.source_refs ?? [],
  );
  const rawSources = Array.isArray(rawInput.sourceRecords)
    ? rawInput.sourceRecords
    : Array.isArray(rawInput.source_records)
      ? rawInput.source_records
      : [];
  const sourceRecords = rawSources.filter((source) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return false;
    }
    const record = source as Record<string, unknown>;
    const sourceId = record.sourceId ?? record.source_id;
    return typeof sourceId === "string" && sourceRefs.has(sourceId);
  });
  return {
    ...rawInput,
    sourceRecords,
    source_records: sourceRecords,
    referenceContext: [],
    reference_context: [],
  };
}

function assertCompletedSlideMatchesContentPlan(
  slide: GenerateDeckResponse["deck"]["slides"][number],
  plannedSlide: z.infer<typeof contentPlanSlideSchema>,
  descriptor: LayoutCompileV2ArtifactPayload["slides"][number],
) {
  const plannedNotes =
    plannedSlide.speakerNotes ?? plannedSlide.speaker_notes ?? "";
  if (
    slide.slideId !== descriptor.slideId ||
    slide.order !== descriptor.order ||
    slide.title !== plannedSlide.title ||
    !slide.aiNotes?.emphasisPoints?.includes(plannedSlide.message) ||
    (plannedNotes.trim() && slide.speakerNotes !== plannedNotes)
  ) {
    throw new StageTerminalError(
      "AI_DECK_COMPLETED_SLIDE_IDENTITY_INVALID",
      "Completed slide changed content plan fields.",
    );
  }
}

async function executeSemanticQuality(
  input: Parameters<typeof executeStage>[0],
): Promise<AiDeckExecutionArtifactPayload> {
  const layout = await loadLayoutArtifact(
    input.dataSource,
    input.message,
    input.inputRef,
  );
  if (isLayoutCompileV2Artifact(layout)) {
    return executeV2SemanticQuality(input, layout);
  }
  let workerPayload = generateDeckResponseSchema.parse(layout.workerPayload);
  const artifacts = await new AiDeckExecutionArtifactRepository(
    input.dataSource,
  ).listImageSlides(input.message);
  const imageSlides = new Map(
    artifacts.map((artifact) => {
      const payload = imageSlideArtifactPayloadSchema.parse(artifact.payload);
      return [payload.slide.slideId, payload] as const;
    }),
  );
  const deck = markDeckForInitialThumbnailRefresh(
    {
      ...workerPayload.deck,
      slides: workerPayload.deck.slides.map(
        (slide) => imageSlides.get(slide.slideId)?.slide ?? slide,
      ),
    },
    input.context.designPackSnapshot,
  );
  const imageWarnings = [...imageSlides.values()].flatMap(
    (payload) => payload.warnings,
  );
  if (hasBlockingQualityGateIssues(workerPayload.validation)) {
    throw qualityGateError(
      "GENERATE_DECK_QUALITY_GATE_FAILED",
      workerPayload,
      deck,
      workerPayload.validation,
      imageWarnings,
    );
  }
  let validation = withDuplicateMediaAssetIssue(workerPayload.validation, deck);
  if (input.context.request.design.mediaPolicy === "hybrid") {
    validation = withHybridMediaBudgetIssue(validation, deck);
  }
  const semantic = runInitialSemanticQuality({ deck, validation });
  workerPayload = generateDeckResponseSchema.parse({
    ...workerPayload,
    deck: semantic.deck,
    warnings: [
      ...workerPayload.warnings,
      ...imageWarnings,
      ...semantic.warnings,
    ],
    validation: semantic.validation,
    diagnostics: {
      ...workerPayload.diagnostics,
      validationIssueCount: allValidationIssues(semantic.validation).length,
    },
  });
  if (
    hasBlockingQualityGateIssues(semantic.validation) ||
    semantic.unresolvedMedia
  ) {
    throw qualityGateError(
      "GENERATE_DECK_QUALITY_GATE_FAILED",
      workerPayload,
      semantic.deck,
      semantic.validation,
    );
  }
  return qualityArtifactPayloadSchema.parse({ workerPayload });
}

async function executeV2SemanticQuality(
  input: Parameters<typeof executeStage>[0],
  layout: LayoutCompileV2ArtifactPayload,
): Promise<AiDeckExecutionArtifactPayload> {
  const repository = new AiDeckExecutionArtifactRepository(input.dataSource);
  const artifacts = await repository.listImageSlides(input.message);
  const completed = artifacts.map((artifact) =>
    completedSlideV2ArtifactPayloadSchema.parse(artifact.payload),
  );
  const firstDescriptor = layout.slides[0];
  if (
    firstDescriptor?.order === 1 &&
    !completed.some(
      (artifact) => artifact.sourceOrder === firstDescriptor.sourceOrder,
    )
  ) {
    const coverArtifact = await repository.findByStage(
      input.message,
      "cover-slide",
    );
    const cover = coverArtifact
      ? coverSlideArtifactPayloadSchema.parse(coverArtifact.payload)
      : undefined;
    const slide = cover?.deck.slides[0];
    if (cover && slide) {
      completed.push(
        completedSlideV2ArtifactPayloadSchema.parse({
          artifactVersion: 2,
          sourceOrder: firstDescriptor.sourceOrder,
          order: firstDescriptor.order,
          slideId: firstDescriptor.slideId,
          slide,
          warnings: cover.warnings,
          validation: cover.validation,
        }),
      );
    }
  }
  const bySourceOrder = new Map(
    completed.map((artifact) => [artifact.sourceOrder, artifact]),
  );
  if (
    bySourceOrder.size !== layout.slides.length ||
    layout.slides.some(
      (descriptor) =>
        bySourceOrder.get(descriptor.sourceOrder)?.slideId !==
        descriptor.slideId,
    )
  ) {
    throw new StageTerminalError(
      "AI_DECK_SLIDE_ARTIFACT_SET_INVALID",
      "Completed slide artifacts do not match the layout manifest.",
    );
  }
  const slides = layout.slides.map(
    (descriptor) => bySourceOrder.get(descriptor.sourceOrder)!.slide,
  );
  const deck = markDeckForInitialThumbnailRefresh(
    deckSchema.parse({ ...layout.deckShell, slides }),
    input.context.designPackSnapshot,
  );
  let validation = mergeSlideValidations(completed);
  validation = withDuplicateMediaAssetIssue(validation, deck);
  if (input.context.request.design.mediaPolicy === "hybrid") {
    validation = withHybridMediaBudgetIssue(validation, deck);
  }
  const semantic = runInitialSemanticQuality({
    deck,
    validation,
    allowRepair: false,
  });
  const workerPayload = generateDeckResponseSchema.parse({
    deck: semantic.deck,
    templateSelection: [],
    warnings: unique([
      ...layout.warnings,
      ...completed.flatMap((artifact) => artifact.warnings),
      ...semantic.warnings,
    ]),
    validation: semantic.validation,
  });
  if (
    hasBlockingQualityGateIssues(semantic.validation) ||
    semantic.unresolvedMedia
  ) {
    throw qualityGateError(
      "GENERATE_DECK_QUALITY_GATE_FAILED",
      workerPayload,
      semantic.deck,
      semantic.validation,
    );
  }
  return qualityArtifactPayloadSchema.parse({ workerPayload });
}

export function mergeSlideValidations(
  completed: Array<
    ReturnType<typeof completedSlideV2ArtifactPayloadSchema.parse>
  >,
) {
  const finalSlideOrder = Math.max(
    ...completed.map((artifact) => artifact.order),
  );
  const mergeIssues = (
    select: (
      artifact: (typeof completed)[number],
    ) => (typeof artifact.validation.layoutIssues),
  ) =>
    completed.flatMap((artifact) =>
      select(artifact)
        .filter((issue) => issue.scope !== "deck")
        .filter(
          (issue) =>
            issue.code !== "CTA_MISSING" || artifact.order === finalSlideOrder,
        )
        .map((issue) => ({
          ...issue,
          path: rebaseSlideShardIssuePath(issue.path, artifact.order),
        })),
    );
  const layoutIssues = mergeIssues(
    (artifact) => artifact.validation.layoutIssues,
  );
  const contentIssues = mergeIssues(
    (artifact) => artifact.validation.contentIssues,
  );
  const designIssues = mergeIssues(
    (artifact) => artifact.validation.designIssues,
  );
  const presentationIssues = mergeIssues(
    (artifact) => artifact.validation.presentationIssues,
  );
  return {
    passed:
      layoutIssues.length +
        contentIssues.length +
        designIssues.length +
        presentationIssues.length ===
      0,
    layoutIssues,
    contentIssues,
    designIssues,
    presentationIssues,
  };
}

function rebaseSlideShardIssuePath(path: string, slideOrder: number) {
  return path.replace(/^slides\.0(?=\.|$)/, `slides.${slideOrder - 1}`);
}

async function executeRenderedVisualQuality(
  input: Parameters<typeof executeStage>[0],
): Promise<AiDeckExecutionArtifactPayload> {
  const layout = layoutCompileArtifactPayloadSchema.parse(
    (
      await new AiDeckPlanningArtifactRepository(input.dataSource).getByStage(
        input.message,
        "layout-compile",
      )
    ).payload,
  );
  const artifact = await new AiDeckExecutionArtifactRepository(
    input.dataSource,
  ).get(input.message, input.inputRef, "semantic-quality");
  let workerPayload = qualityArtifactPayloadSchema.parse(
    artifact.payload,
  ).workerPayload;
  if (isLayoutCompileV2Artifact(layout)) {
    const visualQaUnavailable = workerPayload.warnings.some((warning) =>
      warning.includes("Rendered Visual QA was unavailable"),
    );
    const visualIssues = allValidationIssues(workerPayload.validation).flatMap(
      (issue) => {
        const code = generateDeckVisualIssueCodeSchema.safeParse(issue.code);
        const slideOrder = slideOrderFromIssuePath(issue.path);
        return code.success
          ? [{ code: code.data, ...(slideOrder ? { slideOrder } : {}) }]
          : [];
      },
    );
    workerPayload = generateDeckResponseSchema.parse({
      ...workerPayload,
      deck: withGenerationQualityMetadata(
        workerPayload.deck,
        workerPayload.validation,
        visualQaUnavailable ? "unavailable" : "advisory",
      ),
      diagnostics: {
        ...workerPayload.diagnostics,
        validationIssueCount: allValidationIssues(workerPayload.validation).length,
        visualQaStatus: visualQaUnavailable
          ? "unavailable"
          : visualIssues.length > 0
            ? "advisory"
            : "passed",
        warningCodes: visualQaUnavailable || visualIssues.length > 0
          ? unique([
              ...workerPayload.diagnostics.warningCodes,
              visualQaUnavailable
                ? "GENERATE_DECK_VISUAL_QA_UNAVAILABLE"
                : "GENERATE_DECK_VISUAL_ADVISORY",
            ])
          : workerPayload.diagnostics.warningCodes,
        visualIssueCodes: visualIssues.map((issue) => issue.code),
        visualIssueSlideOrders: unique(
          visualIssues.flatMap((issue) =>
            issue.slideOrder ? [issue.slideOrder] : [],
          ),
        ).sort((left, right) => left - right),
      },
    });
    return qualityArtifactPayloadSchema.parse({ workerPayload });
  }
  try {
    const outcome = await runRenderedVisualQuality({
      dataSource: input.dataSource,
      storage: input.storage,
      pythonWorkerUrl: input.pythonWorkerUrl,
      deck: workerPayload.deck,
      validation: workerPayload.validation,
      imageRuntime: input.imageRuntime,
      imageAssetScope: input.context.imageAssetScope,
      officialAssetFileIds: input.context.request.officialAssetFileIds ?? [],
      enforcesHybridMediaBudget:
        input.context.request.design.mediaPolicy === "hybrid",
      jobId: input.message.pipelineJobId,
      projectId: input.message.projectId,
      onRepairProgress: async () => undefined,
      emitEvent: (event, fields) => emit(input.eventLogger, event, fields),
      ...(isLayoutCompileV2Artifact(layout) ? { maxRepairAttempts: 0 } : {}),
    });
    const diagnostics = {
      ...renderedVisualQualityDiagnostics(outcome, workerPayload.diagnostics),
      validationIssueCount: allValidationIssues(outcome.validation).length,
    };
    const validation = outcome.issues.length > 0
      ? withVisualIssues(outcome.validation, outcome.issues)
      : outcome.validation;
    if (!outcome.passed) {
      throw qualityGateError(
        "GENERATE_DECK_VISUAL_QUALITY_GATE_FAILED",
        workerPayload,
        outcome.deck,
        validation,
        [...workerPayload.warnings, ...outcome.warnings],
      );
    }
    workerPayload = generateDeckResponseSchema.parse({
      ...workerPayload,
      deck: withGenerationQualityMetadata(
        outcome.deck,
        validation,
        outcome.issues.length > 0 ? "advisory" : "passed",
      ),
      warnings: [...workerPayload.warnings, ...outcome.warnings],
      validation,
      diagnostics,
    });
    return qualityArtifactPayloadSchema.parse({ workerPayload });
  } catch (error) {
    if (!(error instanceof RenderedVisualQualityUnavailableError)) throw error;
    if (
      hasBlockingQualityGateIssues(error.validation) ||
      hasMediaPlaceholder(error.deck)
    ) {
      throw qualityGateError(
        "GENERATE_DECK_QUALITY_GATE_FAILED",
        workerPayload,
        error.deck,
        error.validation,
        error.warnings,
      );
    }
    workerPayload = generateDeckResponseSchema.parse({
      ...workerPayload,
      deck: withGenerationQualityMetadata(
        error.deck,
        error.validation,
        "unavailable",
      ),
      warnings: [
        ...workerPayload.warnings,
        ...error.warnings,
        "Rendered Visual QA was unavailable; deterministic validation was used.",
      ],
      validation: error.validation,
      diagnostics: {
        ...workerPayload.diagnostics,
        warningCodes: unique([
          ...workerPayload.diagnostics.warningCodes,
          "GENERATE_DECK_VISUAL_QA_UNAVAILABLE",
        ]),
        visualQaStatus: "unavailable",
        visualReviewAttempts: error.reviewAttempts,
        visualRepairAttempts: error.repairAttempts,
        visualIssueCodes: [],
        validationIssueCount: allValidationIssues(error.validation).length,
      },
    });
    return qualityArtifactPayloadSchema.parse({ workerPayload });
  }
}

function slideOrderFromIssuePath(path: string): number | undefined {
  const match = /^slides\.(\d+)/.exec(path);
  return match ? Number(match[1]) + 1 : undefined;
}

async function completeStage(
  dataSource: DataSource,
  message: AiDeckGenerationStageMessage & { stage: AiDeckExecutionStage },
  leaseOwner: string,
  attempt: number,
  inputRef: Record<string, unknown>,
  payload: AiDeckExecutionArtifactPayload,
): Promise<Job> {
  return dataSource.transaction(async (manager) => {
    const artifacts = new AiDeckExecutionArtifactRepository(manager);
    const checkpoints = new AiDeckGenerationStageCheckpointRepository(manager);
    const resultRef = await artifacts.upsert(message, payload);
    const succeeded = await checkpoints.succeed(
      message,
      leaseOwner,
      attempt,
      resultRef,
    );
    if (!succeeded) throw new AiDeckExecutionFencingLostError();

    if (message.stage === "cover-slide") {
      await ensureDesignPlanningAfterCover(manager, checkpoints, message);
      return readParentJob(manager, message);
    }

    if (message.stage === "image-slide") {
      if (isCompletedSlideV2Artifact(payload)) {
        return joinV2ImageShards(manager, checkpoints, message, inputRef);
      }
      const rows = await manager.query(
        `
          SELECT count(*)::int AS expected,
                 count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded
          FROM ai_deck_generation_stages
          WHERE pipeline_job_id = $1 AND stage = 'image-slide'
        `,
        [message.pipelineJobId],
      );
      const counts = z
        .object({
          expected: z.coerce.number().int(),
          succeeded: z.coerce.number().int(),
        })
        .parse(firstQueryRow(rows));
      if (counts.expected > 0 && counts.expected === counts.succeeded) {
        await checkpoints.ensureQueued(
          { ...message, stage: "semantic-quality", shardKey: "" },
          inputRef,
        );
      }
      return updateParentProgress(manager, message, 70);
    }
    const nextStage =
      message.stage === "semantic-quality"
        ? "rendered-visual-quality"
        : "publication";
    await checkpoints.ensureQueued(
      { ...message, stage: nextStage, shardKey: "" },
      resultRef,
    );
    return updateParentProgress(
      manager,
      message,
      message.stage === "semantic-quality" ? 80 : 95,
    );
  });
}

async function failOptionalCoverStage(
  dataSource: DataSource,
  message: AiDeckGenerationStageMessage & { stage: AiDeckExecutionStage },
  leaseOwner: string,
  attempt: number,
  error: JobError,
): Promise<Job | void> {
  return dataSource.transaction(async (manager) => {
    const checkpoints = new AiDeckGenerationStageCheckpointRepository(manager);
    const failed = await checkpoints.fail(message, leaseOwner, attempt, error);
    if (!failed) return;
    await ensureDesignPlanningAfterCover(manager, checkpoints, message);
    return readParentJob(manager, message);
  });
}

async function ensureDesignPlanningAfterCover(
  manager: Pick<DataSource, "query">,
  checkpoints: AiDeckGenerationStageCheckpointRepository,
  message: AiDeckGenerationStageMessage,
): Promise<void> {
  const content = firstQueryRow(
    await manager.query(
      `SELECT artifact_id FROM ai_deck_planning_artifacts
       WHERE pipeline_job_id = $1 AND project_id = $2
         AND stage = 'content-planning'`,
      [message.pipelineJobId, message.projectId],
    ),
  );
  const parsedContent = z
    .object({ artifact_id: z.string().uuid() })
    .safeParse(content);
  if (!parsedContent.success) return;
  await checkpoints.ensureQueued(
    { ...message, stage: "design-planning", shardKey: "" },
    { planningArtifactId: parsedContent.data.artifact_id },
  );
}

async function isV2ImageShard(
  dataSource: DataSource,
  message: AiDeckGenerationStageMessage,
  inputRef: Record<string, unknown>,
): Promise<boolean> {
  try {
    return isLayoutCompileV2Artifact(
      await loadLayoutArtifact(dataSource, message, inputRef),
    );
  } catch {
    return false;
  }
}

async function failV2ImageShardAndJoin(
  dataSource: DataSource,
  message: AiDeckGenerationStageMessage & { stage: AiDeckExecutionStage },
  leaseOwner: string,
  attempt: number,
  rawError: JobError,
): Promise<Job | void> {
  const error = jobErrorSchema.parse(rawError);
  return dataSource.transaction(async (manager) => {
    const checkpoints = new AiDeckGenerationStageCheckpointRepository(manager);
    const failed = await checkpoints.fail(message, leaseOwner, attempt, error);
    if (!failed) return;
    return joinV2ImageShards(manager, checkpoints, message, {});
  });
}

async function joinV2ImageShards(
  manager: Pick<DataSource, "query">,
  checkpoints: AiDeckGenerationStageCheckpointRepository,
  message: AiDeckGenerationStageMessage,
  layoutReference: Record<string, unknown>,
): Promise<Job> {
  const counts = z
    .object({
      expected: z.coerce.number().int().positive(),
      succeeded: z.coerce.number().int().nonnegative(),
      failed: z.coerce.number().int().nonnegative(),
      terminal: z.coerce.number().int().nonnegative(),
    })
    .parse(
      firstQueryRow(
        await manager.query(
          `
            SELECT count(*)::int AS expected,
                   count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
                   count(*) FILTER (WHERE status = 'failed')::int AS failed,
                   count(*) FILTER (WHERE status IN ('succeeded','failed'))::int AS terminal
            FROM ai_deck_generation_stages
            WHERE pipeline_job_id = $1 AND stage = 'image-slide'
          `,
          [message.pipelineJobId],
        ),
      ),
    );
  if (counts.succeeded === counts.expected) {
    await checkpoints.ensureQueued(
      { ...message, stage: "semantic-quality", shardKey: "" },
      layoutReference,
    );
  } else if (counts.terminal === counts.expected && counts.failed > 0) {
    const failedRow = z
      .object({ error_json: jobErrorSchema })
      .parse(
        firstQueryRow(
          await manager.query(
            `
              SELECT error_json
              FROM ai_deck_generation_stages
              WHERE pipeline_job_id = $1 AND stage = 'image-slide'
                AND status = 'failed'
              ORDER BY shard_key
              LIMIT 1
            `,
            [message.pipelineJobId],
          ),
        ),
      );
    const rows = await manager.query(
      `
        UPDATE jobs
        SET status = 'failed', message = 'AI deck generation failed.',
            error = $3::jsonb, updated_at = now()
        WHERE job_id = $1 AND project_id = $2
          AND type = 'ai-deck-generation' AND status IN ('queued','running')
        RETURNING *
      `,
      [message.pipelineJobId, message.projectId, failedRow.error_json],
    );
    const job = parentJobFromQuery(rows);
    if (!job) throw new Error("AI deck generation parent job is not runnable.");
    return job;
  }
  const progress = 60 + Math.round((counts.succeeded / counts.expected) * 10);
  return updateParentProgress(manager, message, progress);
}

export async function publishAtomically(
  dataSource: DataSource,
  message: AiDeckGenerationStageMessage & { stage: "publication" },
  leaseOwner: string,
  attempt: number,
  result: ReturnType<typeof generateDeckJobResultSchema.parse>,
  eventLogger?: (event: string, fields: Record<string, unknown>) => void,
): Promise<Job> {
  const job = await dataSource.transaction(async (manager) => {
    const artifacts = new AiDeckExecutionArtifactRepository(manager);
    const checkpoints = new AiDeckGenerationStageCheckpointRepository(manager);
    const resultRef = await artifacts.upsert(message, { result });
    const succeeded = await checkpoints.succeed(
      message,
      leaseOwner,
      attempt,
      resultRef,
    );
    if (!succeeded) throw new AiDeckExecutionFencingLostError();
    await manager.query(
      `
        INSERT INTO decks (project_id, deck_id, deck_json, version, updated_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (project_id) DO UPDATE
        SET deck_id = EXCLUDED.deck_id,
            deck_json = EXCLUDED.deck_json,
            version = EXCLUDED.version,
            updated_at = EXCLUDED.updated_at
      `,
      [message.projectId, result.deck.deckId, result.deck, result.deck.version],
    );
    const rows = await manager.query(
      `
        UPDATE jobs
        SET status = 'succeeded', progress = 100,
            message = 'AI deck generation completed.',
            result = $3::jsonb, error = NULL, updated_at = now()
        WHERE job_id = $1 AND project_id = $2
          AND type = 'ai-deck-generation' AND status IN ('queued','running')
        RETURNING *
      `,
      [message.pipelineJobId, message.projectId, result],
    );
    const updated = parentJobFromQuery(rows);
    if (!updated) throw new AiDeckExecutionFencingLostError();
    return updated;
  });
  emit(eventLogger, "ai-ppt.deck.published", {
    jobId: message.pipelineJobId,
    projectId: message.projectId,
    deckId: result.deck.deckId,
    slideCount: result.deck.slides.length,
  });
  return job;
}

async function failStageAndParent(
  dataSource: DataSource,
  message: AiDeckGenerationStageMessage & { stage: AiDeckExecutionStage },
  leaseOwner: string,
  attempt: number,
  rawError: JobError,
  result: Record<string, unknown> | null,
): Promise<Job | void> {
  const error = jobErrorSchema.parse(rawError);
  return dataSource.transaction(async (manager) => {
    const failed = await new AiDeckGenerationStageCheckpointRepository(
      manager,
    ).fail(message, leaseOwner, attempt, error);
    if (!failed) return;
    const rows = await manager.query(
      `
        UPDATE jobs
        SET status = 'failed', message = 'AI deck generation failed.',
            result = $4::jsonb, error = $3::jsonb, updated_at = now()
        WHERE job_id = $1 AND project_id = $2
          AND type = 'ai-deck-generation' AND status IN ('queued','running')
        RETURNING *
      `,
      [message.pipelineJobId, message.projectId, error, result],
    );
    return parentJobFromQuery(rows);
  });
}

async function loadLayoutArtifact(
  dataSource: DataSource,
  message: AiDeckGenerationStageMessage,
  inputRef: Record<string, unknown>,
) {
  const artifact = await new AiDeckPlanningArtifactRepository(dataSource).get(
    message,
    inputRef,
    "layout-compile",
  );
  return layoutCompileArtifactPayloadSchema.parse(artifact.payload);
}

async function loadParentContext(
  dataSource: DataSource,
  message: AiDeckGenerationStageMessage,
) {
  const rows = await dataSource.query(
    `
      SELECT payload FROM jobs
      WHERE job_id = $1 AND project_id = $2
        AND type = 'ai-deck-generation' AND status IN ('queued','running')
    `,
    [message.pipelineJobId, message.projectId],
  );
  const row = z.object({ payload: z.unknown() }).parse(firstQueryRow(rows));
  return generateDeckStoredJobPayloadSchema.parse(row.payload);
}

function visualSlideIds(rawVisualRequirements: unknown): string[] {
  return z
    .object({
      items: z.array(
        z.object({
          slideId: z.string().min(1),
          visualPlan: z
            .object({ imageNeeded: z.boolean().optional() })
            .passthrough(),
        }),
      ),
    })
    .parse(rawVisualRequirements)
    .items.filter((item) => item.visualPlan.imageNeeded === true)
    .map((item) => item.slideId);
}

function qualityGateError(
  code: string,
  workerPayload: GenerateDeckResponse,
  deck: GenerateDeckResponse["deck"],
  validation: GenerateDeckResponse["validation"],
  extraWarnings: string[] = [],
) {
  const payload = generateDeckResponseSchema.parse({
    ...workerPayload,
    deck,
    validation,
    warnings: [...workerPayload.warnings, ...extraWarnings],
    diagnostics: {
      ...workerPayload.diagnostics,
      validationIssueCount: allValidationIssues(validation).length,
    },
  });
  return new StageTerminalError(
    code,
    `Deck generation retained ${allValidationIssues(validation).length} quality issue(s).`,
    generateDeckJobResultSchema.parse({
      deckId: deck.deckId,
      ...payload,
      coachingProvenance: null,
    }),
    {
      reasonCode: "QUALITY_GATE_BLOCKING",
      issueCodes: unique(
        allValidationIssues(validation).map((issue) => issue.code),
      ),
      issueCount: allValidationIssues(validation).length,
      unresolvedMediaCount: deck.slides.reduce(
        (count, slide) =>
          count +
          slide.elements.filter((element) =>
            element.elementId.endsWith("_media_placeholder"),
          ).length,
        0,
      ),
    },
  );
}

function normalizeExecutionError(
  error: unknown,
  stage: AiDeckExecutionStage,
): { error: JobError; result: Record<string, unknown> | null } {
  if (error instanceof StageTerminalError) {
    return {
      error: jobErrorSchema.parse({
        code: error.code,
        message: error.message,
        failedStage: stage,
        retryable: false,
      }),
      result: error.result,
    };
  }
  if (error instanceof OptionalMediaFallbackUnavailableError) {
    return {
      error: jobErrorSchema.parse({
        code: "GENERATE_DECK_OPTIONAL_IMAGE_FALLBACK_FAILED",
        message: "Optional image fallback could not be completed.",
        failedStage: stage,
        retryable: false,
      }),
      result: null,
    };
  }
  if (error instanceof z.ZodError) {
    return {
      error: jobErrorSchema.parse({
        code: "AI_DECK_EXECUTION_CONTRACT_INVALID",
        message: "AI deck execution stage contract is invalid.",
        failedStage: stage,
        retryable: false,
      }),
      result: null,
    };
  }
  return {
    error: jobErrorSchema.parse({
      code: "AI_DECK_EXECUTION_INTERNAL_ERROR",
      message: "AI deck execution stage could not be completed.",
      failedStage: stage,
      retryable: true,
    }),
    result: null,
  };
}

function executionErrorDiagnostics(
  error: unknown,
  normalized: JobError,
): SafeStageErrorDiagnostics {
  if (error instanceof StageTerminalError) {
    return compactDiagnostics({
      code: normalized.code,
      reasonCode: error.diagnostics?.reasonCode ?? error.code,
      name: error.name,
      issueCodes: error.diagnostics?.issueCodes,
      issueCount: error.diagnostics?.issueCount,
      unresolvedMediaCount: error.diagnostics?.unresolvedMediaCount,
    });
  }
  if (error instanceof OptionalMediaFallbackUnavailableError) {
    return compactDiagnostics({
      code: normalized.code,
      reasonCode:
        error.imageFailureDiagnostic?.reasonCode ??
        "OPTIONAL_IMAGE_FALLBACK_FAILED",
      name: error.name,
      providerHttpStatus: error.imageFailureDiagnostic?.providerHttpStatus,
      provider: error.imageFailureDiagnostic?.provider,
      providerRequestId: error.imageFailureDiagnostic?.providerRequestId,
    });
  }
  if (error instanceof z.ZodError) {
    return contractErrorDiagnostics(
      error,
      normalized.code,
      "EXECUTION_CONTRACT_INVALID",
    );
  }
  return unknownErrorDiagnostics(
    error,
    normalized.code,
    "EXECUTION_FAILURE_UNCLASSIFIED",
  );
}

async function updateParentProgress(
  db: Pick<DataSource, "query">,
  message: AiDeckGenerationStageMessage,
  progress: number,
): Promise<Job> {
  const rows = await db.query(
    `
      UPDATE jobs SET status = 'running', progress = GREATEST(progress, $3),
          message = 'AI deck staged generation running.', error = NULL,
          updated_at = now()
      WHERE job_id = $1 AND project_id = $2
        AND type = 'ai-deck-generation' AND status IN ('queued','running')
      RETURNING *
    `,
    [message.pipelineJobId, message.projectId, progress],
  );
  const job = parentJobFromQuery(rows);
  if (!job) throw new Error("AI deck generation parent job is not runnable.");
  return job;
}

async function readParentJob(
  db: Pick<DataSource, "query">,
  message: AiDeckGenerationStageMessage,
): Promise<Job> {
  const rows = await db.query(
    `
      SELECT * FROM jobs
      WHERE job_id = $1 AND project_id = $2
        AND type = 'ai-deck-generation' AND status IN ('queued','running')
    `,
    [message.pipelineJobId, message.projectId],
  );
  const job = parentJobFromQuery(rows);
  if (!job) throw new Error("AI deck generation parent job is not runnable.");
  return job;
}

class StageTerminalError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly result: Record<string, unknown> | null = null,
    readonly diagnostics?: Pick<
      SafeStageErrorDiagnostics,
      "reasonCode" | "issueCodes" | "issueCount" | "unresolvedMediaCount"
    >,
  ) {
    super(message);
    this.name = "StageTerminalError";
  }
}

class AiDeckExecutionFencingLostError extends Error {}

function retrySignal(): Error {
  const error = new Error("AI_DECK_STAGE_RETRY");
  error.name = "AiDeckStageRetrySignal";
  return error;
}

function isRetrySignal(error: unknown): boolean {
  return error instanceof Error && error.message === "AI_DECK_STAGE_RETRY";
}

function parentJobFromQuery(queryResult: unknown): Job | void {
  const raw = firstQueryRow(queryResult);
  if (!raw) return;
  const row = parentJobRowSchema.parse(raw);
  return jobSchema.parse({
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
  });
}

function firstQueryRow(queryResult: unknown): unknown | null {
  if (!Array.isArray(queryResult)) return null;
  const first = queryResult[0];
  if (Array.isArray(first)) return first[0] ?? null;
  return first ?? null;
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function emit(
  logger:
    | ((event: string, fields: Record<string, unknown>) => void)
    | undefined,
  event: string,
  fields: Record<string, unknown>,
) {
  try {
    logger?.(event, fields);
  } catch {
    // Business event logging must not change generation behavior.
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
