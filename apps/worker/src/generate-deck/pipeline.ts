import {
  generateDeckResponseSchema,
  type Deck,
  type GenerateDeckDiagnostics,
  type GenerateDeckRequest,
  type GenerateDeckValidation,
  type SavedDesignPackSnapshot,
} from "@orbit/shared/deck";
import { type Job } from "@orbit/shared/jobs";
import type { StoragePort } from "@orbit/storage";
import type { DataSource } from "typeorm";
import type { ImageAssetRuntime } from "../image-asset-pipeline";
import {
  OptionalMediaFallbackUnavailableError,
  hasMediaPlaceholder,
  resolvedVisualAssetCount,
  resolveGenerateDeckAssets,
  unresolvedOptionalMediaSlideIds,
  unresolvedRequiredMediaSlideIds,
} from "./asset-resolution";
import {
  failGenerateDeckJob,
  failGenerateDeckQualityGate,
  failGenerateDeckOptionalImageFallback,
  failGenerateDeckVisualQaUnavailable,
  publishGenerateDeckResult,
  updateGenerateDeckJob,
} from "./publication";
import {
  RenderedVisualQualityUnavailableError,
  renderedVisualQualityDiagnostics,
  runRenderedVisualQuality,
} from "./rendered-visual-quality";
import {
  allValidationIssues,
  hasBlockingQualityGateIssues,
  runInitialSemanticQuality,
  withDuplicateMediaAssetIssue,
  withGenerationQualityMetadata,
  withHybridMediaBudgetIssue,
  withVisualIssues,
} from "./semantic-quality";

type GenerateDeckWorkerPayload = ReturnType<
  typeof generateDeckResponseSchema.parse
>;

export type GenerateDeckEventLogger = (
  event: string,
  fields: Record<string, unknown>,
) => void;

export async function processGenerateDeckPipeline(input: {
  dataSource: DataSource;
  storage: Pick<StoragePort, "getSignedReadUrl" | "putObject">;
  pythonWorkerUrl: string;
  jobId: string;
  projectId: string;
  request: GenerateDeckRequest;
  designPackSnapshot?: SavedDesignPackSnapshot;
  imageAssetScope?: { userId: string };
  workerPayload: GenerateDeckWorkerPayload;
  imageRuntime?: ImageAssetRuntime;
  eventLogger?: GenerateDeckEventLogger;
}): Promise<Job> {
  try {
    const blockingIssues = allValidationIssues(
      input.workerPayload.validation,
    ).filter((issue) => issue.blocking);
    if (blockingIssues.length > 0) {
      return failGenerateDeckJob(
        input.dataSource,
        input.jobId,
        75,
        "GENERATE_DECK_VALIDATION_BLOCKING",
        `Deck generation retained ${blockingIssues.length} blocking validation issue(s).`,
        {
          warnings: input.workerPayload.warnings,
          validation: input.workerPayload.validation,
          diagnostics: input.workerPayload.diagnostics,
        },
      );
    }

    let deck = markDeckForInitialThumbnailRefresh(
      input.workerPayload.deck,
      input.designPackSnapshot,
    );
    const emitEvent = (event: string, fields: Record<string, unknown>) =>
      emitGenerateDeckEvent(input.eventLogger, event, fields);
    const research = input.workerPayload.diagnostics;
    if (research.researchQuality !== "not-run") {
      emitEvent("ai-ppt.web-research.completed", {
        jobId: input.jobId,
        projectId: input.projectId,
        quality: research.researchQuality,
        issueCodes: research.researchIssueCodes,
        attempts: research.researchAttempts,
        relevantSourceCount: research.relevantWebSourceCount,
        officialSourceCount: research.officialWebSourceCount,
        independentSourceCount: research.independentWebSourceCount,
        factCoverageSatisfied: research.researchFactCoverageSatisfied,
      });
    }
    emitEvent("ai-ppt.design-program.created", {
      jobId: input.jobId,
      projectId: input.projectId,
      deckId: deck.deckId,
      slideCount: deck.slides.length,
    });
    emitEvent("ai-ppt.composition.completed", {
      jobId: input.jobId,
      projectId: input.projectId,
      deckId: deck.deckId,
      compositionCount: new Set(
        deck.slides
          .map((slide) => slide.aiNotes?.compositionPlan?.compositionId)
          .flatMap((value) => (value ? [value] : [])),
      ).size,
    });
    await updateGenerateDeckJob(input.dataSource, input.jobId, {
      status: "running",
      progress: 45,
      message: "AI deck composition completed.",
      result: null,
      error: null,
    });
    if (hasBlockingQualityGateIssues(input.workerPayload.validation)) {
      emitEvent("ai-ppt.visual-gate.failed", {
        jobId: input.jobId,
        projectId: input.projectId,
        deckId: deck.deckId,
        issueCount: allValidationIssues(input.workerPayload.validation).length,
        stage: "deterministic",
      });
      return failGenerateDeckQualityGate(
        input.dataSource,
        input.jobId,
        input.workerPayload,
        deck,
        input.workerPayload.validation,
        input.workerPayload.warnings,
      );
    }

    let imageWarnings: string[] = [];
    let deterministicValidation = input.workerPayload.validation;
    try {
      const assets = await resolveGenerateDeckAssets({
        dataSource: input.dataSource,
        storage: input.storage,
        pythonWorkerUrl: input.pythonWorkerUrl,
        deck,
        validation: deterministicValidation,
        imageRuntime: input.imageRuntime,
        imageAssetScope: input.imageAssetScope,
        officialAssetFileIds: input.request.officialAssetFileIds ?? [],
      });
      deck = assets.deck;
      deterministicValidation = assets.validation;
      imageWarnings.push(...assets.warnings);
    } catch (error) {
      if (!(error instanceof OptionalMediaFallbackUnavailableError)) {
        throw error;
      }
      emitEvent("ai-ppt.visual-gate.failed", {
        jobId: input.jobId,
        projectId: input.projectId,
        deckId: error.deck.deckId,
        stage: "optional-asset-fallback",
      });
      return failGenerateDeckOptionalImageFallback(
        input.dataSource,
        input.jobId,
        input.workerPayload,
        error.deck,
        error.validation,
        [...input.workerPayload.warnings, ...error.warnings],
        error.message,
      );
    }
    emitEvent("ai-ppt.asset.resolved", {
      jobId: input.jobId,
      projectId: input.projectId,
      deckId: deck.deckId,
      resolvedAssetCount: resolvedVisualAssetCount(deck),
      unresolvedRequiredCount: unresolvedRequiredMediaSlideIds(deck).length,
      unresolvedOptionalCount: unresolvedOptionalMediaSlideIds(deck).length,
    });
    deterministicValidation = withDuplicateMediaAssetIssue(
      deterministicValidation,
      deck,
    );
    if (hasBlockingQualityGateIssues(deterministicValidation)) {
      emitEvent("ai-ppt.visual-gate.failed", {
        jobId: input.jobId,
        projectId: input.projectId,
        deckId: deck.deckId,
        issueCount: allValidationIssues(deterministicValidation).length,
        stage: "asset-identity",
      });
      return failGenerateDeckQualityGate(
        input.dataSource,
        input.jobId,
        input.workerPayload,
        deck,
        deterministicValidation,
        [...input.workerPayload.warnings, ...imageWarnings],
      );
    }
    const enforcesHybridMediaBudget =
      input.request.design.mediaPolicy === "hybrid";
    if (enforcesHybridMediaBudget) {
      deterministicValidation = withHybridMediaBudgetIssue(
        deterministicValidation,
        deck,
      );
      if (hasBlockingQualityGateIssues(deterministicValidation)) {
        emitEvent("ai-ppt.visual-gate.failed", {
          jobId: input.jobId,
          projectId: input.projectId,
          deckId: deck.deckId,
          issueCount: allValidationIssues(deterministicValidation).length,
          stage: "asset-budget",
        });
        return failGenerateDeckQualityGate(
          input.dataSource,
          input.jobId,
          input.workerPayload,
          deck,
          deterministicValidation,
          [...input.workerPayload.warnings, ...imageWarnings],
        );
      }
    }
    await updateGenerateDeckJob(input.dataSource, input.jobId, {
      status: "running",
      progress: 65,
      message: "AI deck image assets prepared.",
      result: null,
      error: null,
    });

    const semanticOutcome = runInitialSemanticQuality({
      deck,
      validation: deterministicValidation,
    });
    deck = semanticOutcome.deck;
    imageWarnings.push(...semanticOutcome.warnings);
    let validation: GenerateDeckValidation = semanticOutcome.validation;
    if (
      hasBlockingQualityGateIssues(validation) ||
      semanticOutcome.unresolvedMedia
    ) {
      emitEvent("ai-ppt.visual-gate.failed", {
        jobId: input.jobId,
        projectId: input.projectId,
        deckId: deck.deckId,
        issueCount: allValidationIssues(validation).length,
        stage: semanticOutcome.unresolvedMedia ? "asset" : "semantic",
      });
      return failGenerateDeckQualityGate(
        input.dataSource,
        input.jobId,
        input.workerPayload,
        deck,
        validation,
        [...input.workerPayload.warnings, ...imageWarnings],
      );
    }

    let diagnostics: GenerateDeckDiagnostics = {
      ...input.workerPayload.diagnostics,
      validationIssueCount: allValidationIssues(validation).length,
    };
    await updateGenerateDeckJob(input.dataSource, input.jobId, {
      status: "running",
      progress: 75,
      message: "AI deck rendered visual review running.",
      result: null,
      error: null,
    });
    let visualOutcome;
    try {
      visualOutcome = await runRenderedVisualQuality({
        dataSource: input.dataSource,
        storage: input.storage,
        pythonWorkerUrl: input.pythonWorkerUrl,
        deck,
        validation,
        imageRuntime: input.imageRuntime,
        imageAssetScope: input.imageAssetScope,
        officialAssetFileIds: input.request.officialAssetFileIds ?? [],
        enforcesHybridMediaBudget,
        jobId: input.jobId,
        projectId: input.projectId,
        onRepairProgress: async (attempt, maxAttempts) => {
          await updateGenerateDeckJob(input.dataSource, input.jobId, {
            status: "running",
            progress: Math.min(90, 80 + attempt * 5),
            message: `AI deck visual repair ${attempt}/${maxAttempts} running.`,
            result: null,
            error: null,
          });
        },
        emitEvent,
      });
    } catch (error) {
      if (error instanceof OptionalMediaFallbackUnavailableError) {
        return failGenerateDeckOptionalImageFallback(
          input.dataSource,
          input.jobId,
          input.workerPayload,
          error.deck,
          error.validation,
          [
            ...input.workerPayload.warnings,
            ...imageWarnings,
            ...error.warnings,
          ],
          error.message,
        );
      }
      const unavailable =
        error instanceof RenderedVisualQualityUnavailableError
          ? error
          : undefined;
      emitEvent("ai-ppt.visual-gate.failed", {
        jobId: input.jobId,
        projectId: input.projectId,
        deckId: deck.deckId,
        stage: "visual-qa-unavailable",
      });
      const unavailableDeck = unavailable?.deck ?? deck;
      const unavailableValidation = unavailable?.validation ?? validation;
      if (
        hasBlockingQualityGateIssues(unavailableValidation) ||
        hasMediaPlaceholder(unavailableDeck)
      ) {
        return failGenerateDeckVisualQaUnavailable(
          input.dataSource,
          input.jobId,
          input.workerPayload,
          unavailableDeck,
          unavailableValidation,
          [
            ...input.workerPayload.warnings,
            ...imageWarnings,
            ...(unavailable?.warnings ?? []),
          ],
          error instanceof Error ? error.message : "Vision QA unavailable.",
          {
            visualReviewAttempts: unavailable?.reviewAttempts ?? 0,
            visualRepairAttempts: unavailable?.repairAttempts ?? 0,
          },
        );
      }
      diagnostics = {
        ...diagnostics,
        warningCodes: [
          ...new Set([
            ...diagnostics.warningCodes,
            "GENERATE_DECK_VISUAL_QA_UNAVAILABLE",
          ]),
        ],
        visualQaStatus: "unavailable",
        visualReviewAttempts: unavailable?.reviewAttempts ?? 0,
        visualRepairAttempts: unavailable?.repairAttempts ?? 0,
        visualIssueCodes: [],
        validationIssueCount: allValidationIssues(unavailableValidation).length,
      };
      return publishGenerateDeckResult({
        dataSource: input.dataSource,
        jobId: input.jobId,
        projectId: input.projectId,
        workerPayload: input.workerPayload,
        deck: withGenerationQualityMetadata(
          unavailableDeck,
          unavailableValidation,
          "unavailable",
        ),
        warnings: [
          ...input.workerPayload.warnings,
          ...imageWarnings,
          ...(unavailable?.warnings ?? []),
          "Rendered Visual QA was unavailable; deterministic validation was used.",
        ],
        validation: unavailableValidation,
        diagnostics,
        coachingProvenance: input.request.coachingContext,
        emitEvent,
      });
    }
    deck = visualOutcome.deck;
    validation = visualOutcome.issues.length > 0
      ? withVisualIssues(visualOutcome.validation, visualOutcome.issues)
      : visualOutcome.validation;
    deck = withGenerationQualityMetadata(
      deck,
      validation,
      visualOutcome.issues.length > 0 ? "advisory" : "passed",
    );
    imageWarnings.push(...visualOutcome.warnings);
    diagnostics = {
      ...renderedVisualQualityDiagnostics(visualOutcome, diagnostics),
      validationIssueCount: allValidationIssues(validation).length,
    };
    await updateGenerateDeckJob(input.dataSource, input.jobId, {
      status: "running",
      progress: 95,
      message: "AI deck final publication running.",
      result: null,
      error: null,
    });

    return publishGenerateDeckResult({
      dataSource: input.dataSource,
      jobId: input.jobId,
      projectId: input.projectId,
      workerPayload: input.workerPayload,
      deck,
      warnings: [...input.workerPayload.warnings, ...imageWarnings],
      validation,
      diagnostics,
      coachingProvenance: input.request.coachingContext,
      emitEvent,
    });
  } catch (error) {
    return failGenerateDeckJob(
      input.dataSource,
      input.jobId,
      75,
      "PYTHON_WORKER_GENERATE_DECK_INVALID_RESPONSE",
      error instanceof Error
        ? error.message
        : "Python worker returned invalid deck generation response.",
    );
  }
}

export function markDeckForInitialThumbnailRefresh(
  deck: Deck,
  designPackSnapshot?: SavedDesignPackSnapshot,
): Deck {
  return {
    ...deck,
    metadata: {
      ...deck.metadata,
      thumbnailSource: "import-render",
      ...(designPackSnapshot && deck.metadata.sourceType === "ai"
        ? { designPackSnapshot }
        : {}),
    },
    slides: deck.slides.map((slide, index) => ({
      ...slide,
      thumbnailUrl: slide.thumbnailUrl.trim()
        ? slide.thumbnailUrl
        : `asset:generated_slide_render_${safeId(
            slide.slideId || String(index + 1),
          )}`,
    })),
  };
}

function emitGenerateDeckEvent(
  logger: GenerateDeckEventLogger | undefined,
  event: string,
  fields: Record<string, unknown>,
) {
  try {
    logger?.(event, fields);
  } catch {
    // Business event logging must not change generation behavior.
  }
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_") || "pptx";
}
