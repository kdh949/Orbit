import {
  generateDeckVisualIssueCodeSchema,
  generateDeckVisualRepairActionSchema,
  generateDeckVisualRepairActionTypeSchema,
  type Deck,
  type GenerateDeckDiagnostics,
  type GenerateDeckValidation,
  type GenerateDeckVisualRepairAction,
} from "@orbit/shared";
import type { StoragePort } from "@orbit/storage";
import type { DataSource } from "typeorm";
import { z } from "zod";
import { embedDeckImageAssets } from "../deck-export.processor";
import type { ImageAssetRuntime } from "../image-asset-pipeline";
import {
  OptionalMediaFallbackUnavailableError,
  requestVisualRepair,
  resolveRepairedDeckAssets,
  unresolvedOptionalMediaSlideIds,
} from "./asset-resolution";
import {
  applyPostVisualRepairValidation,
  hasBlockingQualityGateIssues,
} from "./semantic-quality";
import { evaluateVisualQualityPolicy } from "./visual-quality-policy";

const pythonVisualRepairActionSchema = z.object({
  action: generateDeckVisualRepairActionTypeSchema,
  slideId: z.string().min(1),
  targetElementId: z.string().min(1).nullish(),
  compositionId: z.string().min(1).nullish(),
  backgroundMode: z.enum(["light", "dark", "image"]).nullish(),
  reason: z.string().min(1),
});

const visualQaIssueSchema = z.object({
  code: generateDeckVisualIssueCodeSchema,
  slideOrder: z.number().int().positive(),
  message: z.string().min(1),
});

const visualQaReviewSchema = z
  .object({
    passed: z.boolean(),
    issues: z.array(visualQaIssueSchema).default([]),
    repairActions: z.array(pythonVisualRepairActionSchema).default([]),
  })
  .superRefine((review, context) => {
    if (review.passed && review.issues.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["passed"],
        message: "passed visual review cannot contain issues",
      });
    }
    if (!review.passed && review.issues.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issues"],
        message: "failed visual review must contain at least one issue",
      });
    }
  });

const visualQaResponseSchema = z.object({
  review: visualQaReviewSchema,
  warnings: z.array(z.string()).default([]),
});

export type VisualQaIssue = z.infer<typeof visualQaIssueSchema>;
type NormalizedVisualQaReview = {
  passed: boolean;
  issues: VisualQaIssue[];
  repairActions: GenerateDeckVisualRepairAction[];
};

export type RenderedVisualQualityOutcome = {
  passed: boolean;
  deck: Deck;
  validation: GenerateDeckValidation;
  warnings: string[];
  reviewAttempts: number;
  repairAttempts: number;
  issues: VisualQaIssue[];
};

export function renderedVisualQualityDiagnostics(
  outcome: RenderedVisualQualityOutcome,
  diagnostics: GenerateDeckDiagnostics,
): GenerateDeckDiagnostics {
  const advisory = outcome.passed && outcome.issues.length > 0;
  return {
    ...diagnostics,
    warningCodes: advisory
      ? [
          ...new Set([
            ...diagnostics.warningCodes,
            "GENERATE_DECK_VISUAL_ADVISORY",
          ]),
        ]
      : diagnostics.warningCodes,
    visualQaStatus: advisory
      ? "advisory"
      : outcome.passed
        ? "passed"
        : "failed",
    visualReviewAttempts: outcome.reviewAttempts,
    visualRepairAttempts: outcome.repairAttempts,
    visualIssueCodes: outcome.issues.map((issue) => issue.code),
    visualIssueSlideOrders: [
      ...new Set(outcome.issues.map((issue) => issue.slideOrder)),
    ].sort((left, right) => left - right),
  };
}

export class RenderedVisualQualityUnavailableError extends Error {
  constructor(
    message: string,
    readonly reviewAttempts: number,
    readonly repairAttempts: number,
    readonly deck: Deck,
    readonly validation: GenerateDeckValidation,
    readonly warnings: string[],
  ) {
    super(message);
    this.name = "RenderedVisualQualityUnavailableError";
  }
}

const maxVisualRepairAttempts = 2;

export async function runRenderedVisualQuality(input: {
  dataSource: DataSource;
  storage: Pick<StoragePort, "getSignedReadUrl" | "putObject">;
  pythonWorkerUrl: string;
  deck: Deck;
  validation: GenerateDeckValidation;
  imageRuntime?: ImageAssetRuntime;
  imageAssetScope?: { userId: string };
  officialAssetFileIds: readonly string[];
  enforcesHybridMediaBudget: boolean;
  jobId: string;
  projectId: string;
  onRepairProgress: (attempt: number, maxAttempts: number) => Promise<void>;
  emitEvent: (event: string, fields: Record<string, unknown>) => void;
  maxRepairAttempts?: number;
}): Promise<RenderedVisualQualityOutcome> {
  let deck = input.deck;
  let validation = input.validation;
  const warnings: string[] = [];
  let reviewAttempts = 1;
  let repairAttempts = 0;
  let reviewed: Awaited<ReturnType<typeof requestVisualReview>>;
  try {
    reviewed = await requestVisualReview(
      input.dataSource,
      input.storage,
      input.pythonWorkerUrl,
      deck,
    );
  } catch (error) {
    throw unavailableVisualQaError(
      error,
      reviewAttempts,
      repairAttempts,
      deck,
      validation,
      warnings,
    );
  }
  let review = reviewed.review;
  warnings.push(...reviewed.warnings);
  emitVisualReviewEvent(input, deck, review, reviewAttempts);

  while (
    !review.passed &&
    repairAttempts < (input.maxRepairAttempts ?? maxVisualRepairAttempts) &&
    review.repairActions.length > 0
  ) {
    repairAttempts += 1;
    await input.onRepairProgress(
      repairAttempts,
      input.maxRepairAttempts ?? maxVisualRepairAttempts,
    );
    let repaired: Awaited<ReturnType<typeof requestVisualRepair>>;
    try {
      repaired = await requestVisualRepair(
        input.pythonWorkerUrl,
        deck,
        review.repairActions,
        [],
      );
    } catch (error) {
      throw unavailableVisualQaError(
        error,
        reviewAttempts,
        repairAttempts,
        deck,
        validation,
        warnings,
      );
    }
    deck = repaired.deck;
    validation = repaired.validation;
    warnings.push(...repaired.warnings);
    input.emitEvent("ai-ppt.visual-repair.applied", {
      jobId: input.jobId,
      projectId: input.projectId,
      deckId: deck.deckId,
      attempt: repairAttempts,
      actionTypes: review.repairActions.map((action) => action.action),
      slideCount: new Set(review.repairActions.map((action) => action.slideId))
        .size,
    });

    if (repaired.assetSlideIds.length > 0) {
      if (input.imageRuntime && input.imageAssetScope) {
        try {
          const resolved = await resolveRepairedDeckAssets({
            dataSource: input.dataSource,
            storage: input.storage,
            deck,
            imageRuntime: input.imageRuntime,
            imageAssetScope: input.imageAssetScope,
            assetSlideIds: repaired.assetSlideIds,
            officialAssetFileIds: input.officialAssetFileIds,
          });
          deck = resolved.deck;
          warnings.push(...resolved.warnings);
        } catch (error) {
          warnings.push(
            `Visual repair image re-resolution failed: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
        }
      } else {
        warnings.push(
          "Visual repair requested image re-resolution without an available provider scope.",
        );
      }
    }

    const optionalSlideIds = unresolvedOptionalMediaSlideIds(deck);
    if (optionalSlideIds.length > 0) {
      let fallback: Awaited<ReturnType<typeof requestVisualRepair>>;
      try {
        fallback = await requestVisualRepair(
          input.pythonWorkerUrl,
          deck,
          [],
          optionalSlideIds,
        );
      } catch (error) {
        throw new OptionalMediaFallbackUnavailableError(
          error instanceof Error ? error.message : "Visual repair unavailable.",
          deck,
          validation,
          warnings,
        );
      }
      deck = fallback.deck;
      validation = fallback.validation;
      warnings.push(...fallback.warnings);
    }

    validation = applyPostVisualRepairValidation({
      deck,
      validation,
      enforcesHybridMediaBudget: input.enforcesHybridMediaBudget,
    });
    if (hasBlockingQualityGateIssues(validation)) {
      return {
        passed: false,
        deck,
        validation,
        warnings,
        reviewAttempts,
        repairAttempts,
        issues: review.issues,
      };
    }

    reviewAttempts += 1;
    try {
      reviewed = await requestVisualReview(
        input.dataSource,
        input.storage,
        input.pythonWorkerUrl,
        deck,
      );
    } catch (error) {
      throw unavailableVisualQaError(
        error,
        reviewAttempts,
        repairAttempts,
        deck,
        validation,
        warnings,
      );
    }
    review = reviewed.review;
    warnings.push(...reviewed.warnings);
    emitVisualReviewEvent(input, deck, review, reviewAttempts);
  }

  const policy = evaluateVisualQualityPolicy({
    validation,
    visualQaStatus: review.passed ? "passed" : "failed",
    visualIssueCodes: review.issues.map((issue) => issue.code),
    repairAttempts,
    maxRepairAttempts: input.maxRepairAttempts ?? maxVisualRepairAttempts,
    safeRemapAttempted: false,
  });
  return {
    passed: policy.publicationAllowed,
    deck,
    validation,
    warnings,
    reviewAttempts,
    repairAttempts,
    issues: review.issues,
  };
}

async function requestVisualReview(
  dataSource: DataSource,
  storage: Pick<StoragePort, "getSignedReadUrl">,
  pythonWorkerUrl: string,
  deck: Deck,
): Promise<{ review: NormalizedVisualQaReview; warnings: string[] }> {
  let response: Response;
  try {
    const reviewDeck = await embedDeckImageAssets(
      dataSource,
      storage,
      deck.projectId,
      deck,
    );
    response = await fetch(
      workerUrl(pythonWorkerUrl, "/ai/review-deck-visuals"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deck: reviewDeck }),
        signal: AbortSignal.timeout(300_000),
      },
    );
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Vision QA request unavailable.",
    );
  }
  if (!response.ok) {
    throw new Error((await response.text()) || "Vision QA request failed.");
  }
  const payload = visualQaResponseSchema.parse(await response.json());
  return {
    review: {
      passed: payload.review.passed,
      issues: payload.review.issues,
      repairActions: payload.review.repairActions.map((action) =>
        generateDeckVisualRepairActionSchema.parse({
          action: action.action,
          slideId: action.slideId,
          ...(action.targetElementId
            ? { targetElementId: action.targetElementId }
            : {}),
          ...(action.compositionId
            ? { compositionId: action.compositionId }
            : {}),
          ...(action.backgroundMode
            ? { backgroundMode: action.backgroundMode }
            : {}),
          reason: action.reason,
        }),
      ),
    },
    warnings: payload.warnings,
  };
}

function emitVisualReviewEvent(
  input: {
    emitEvent: (event: string, fields: Record<string, unknown>) => void;
    jobId: string;
    projectId: string;
  },
  deck: Deck,
  review: NormalizedVisualQaReview,
  attempt: number,
) {
  input.emitEvent("ai-ppt.visual-review.completed", {
    jobId: input.jobId,
    projectId: input.projectId,
    deckId: deck.deckId,
    attempt,
    passed: review.passed,
    issueCodes: review.issues.map((issue) => issue.code),
  });
}

function unavailableVisualQaError(
  error: unknown,
  reviewAttempts: number,
  repairAttempts: number,
  deck: Deck,
  validation: GenerateDeckValidation,
  warnings: string[],
) {
  return new RenderedVisualQualityUnavailableError(
    error instanceof Error ? error.message : "Vision QA unavailable.",
    reviewAttempts,
    repairAttempts,
    deck,
    validation,
    [...warnings],
  );
}

function workerUrl(baseUrl: string, path: string): string {
  return new URL(
    path,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  ).toString();
}
