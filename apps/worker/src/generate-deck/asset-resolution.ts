import {
  deckSchema,
  generateDeckValidationSchema,
  type Deck,
  type GenerateDeckValidation,
  type GenerateDeckVisualRepairAction,
} from "@orbit/shared/deck";
import type { StoragePort } from "@orbit/storage";
import type { DataSource } from "typeorm";
import { z } from "zod";
import {
  resolveDeckImageAssets,
  type ImageAssetFallbackDiagnostic,
  type ImageAssetRuntime,
} from "../image-asset-pipeline";

const visualRepairResponseSchema = z.object({
  deck: deckSchema,
  validation: generateDeckValidationSchema,
  assetSlideIds: z.array(z.string().min(1)).default([]),
  warnings: z.array(z.string()).default([]),
});

type VisualRepairResponse = z.infer<typeof visualRepairResponseSchema>;

const IMAGE_COVER_COMPOSITION_IDS = new Set([
  "cover-visual-impact",
  "cover-immersive-background",
  "cover-research-author",
]);

export class OptionalMediaFallbackUnavailableError extends Error {
  constructor(
    message: string,
    readonly deck: Deck,
    readonly validation: GenerateDeckValidation,
    readonly warnings: string[],
    readonly imageFailureDiagnostic?: ImageAssetFallbackDiagnostic,
  ) {
    super(message);
    this.name = "OptionalMediaFallbackUnavailableError";
  }
}

export async function resolveGenerateDeckAssets(input: {
  dataSource: DataSource;
  storage: Pick<StoragePort, "getSignedReadUrl" | "putObject">;
  pythonWorkerUrl: string;
  deck: Deck;
  validation: GenerateDeckValidation;
  imageRuntime?: ImageAssetRuntime;
  imageAssetScope?: { userId: string };
  officialAssetFileIds: readonly string[];
  onlySlideIds?: ReadonlySet<string>;
  deterministicIdentity?: string;
  onImageFallback?: (diagnostic: ImageAssetFallbackDiagnostic) => void;
}): Promise<{
  deck: Deck;
  validation: GenerateDeckValidation;
  warnings: string[];
}> {
  let deck = input.deck;
  let validation = input.validation;
  const warnings: string[] = [];
  let imageFailureDiagnostic: ImageAssetFallbackDiagnostic | undefined;

  if (input.imageRuntime && input.imageAssetScope) {
    try {
      const resolvedImages = await resolveDeckImageAssets(
        input.dataSource,
        input.storage,
        deck,
        input.imageRuntime,
        input.imageAssetScope,
        input.onlySlideIds,
        input.officialAssetFileIds,
        input.deterministicIdentity,
        (diagnostic) => {
          imageFailureDiagnostic = diagnostic;
          input.onImageFallback?.(diagnostic);
        },
      );
      deck = resolvedImages.deck;
      warnings.push(...resolvedImages.warnings);
    } catch (error) {
      warnings.push(
        `Image asset pipeline fallback retained placeholders: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  const optionalSlideIds = unresolvedOptionalMediaSlideIds(deck).filter(
    (slideId) =>
      input.onlySlideIds === undefined || input.onlySlideIds.has(slideId),
  );
  const failedCoverSlideIds = unresolvedFailedCoverMediaSlideIds(deck).filter(
    (slideId) =>
      input.onlySlideIds === undefined || input.onlySlideIds.has(slideId),
  );
  if (optionalSlideIds.length > 0 || failedCoverSlideIds.length > 0) {
    try {
      const fallback = await requestVisualRepair(
        input.pythonWorkerUrl,
        deck,
        [],
        optionalSlideIds,
        failedCoverSlideIds,
      );
      deck = fallback.deck;
      validation = fallback.validation;
      warnings.push(...fallback.warnings);
    } catch (error) {
      throw new OptionalMediaFallbackUnavailableError(
        error instanceof Error ? error.message : "Visual repair unavailable.",
        deck,
        validation,
        [...warnings],
        imageFailureDiagnostic,
      );
    }
  }

  return { deck, validation, warnings };
}

export async function resolveRepairedDeckAssets(input: {
  dataSource: DataSource;
  storage: Pick<StoragePort, "getSignedReadUrl" | "putObject">;
  deck: Deck;
  imageRuntime: ImageAssetRuntime;
  imageAssetScope: { userId: string };
  assetSlideIds: readonly string[];
  officialAssetFileIds: readonly string[];
}): Promise<{ deck: Deck; warnings: string[] }> {
  const resolved = await resolveDeckImageAssets(
    input.dataSource,
    input.storage,
    input.deck,
    input.imageRuntime,
    input.imageAssetScope,
    new Set(input.assetSlideIds),
    input.officialAssetFileIds,
  );
  return { deck: resolved.deck, warnings: resolved.warnings };
}

export async function requestVisualRepair(
  pythonWorkerUrl: string,
  deck: Deck,
  actions: GenerateDeckVisualRepairAction[],
  dropOptionalMediaSlideIds: string[],
  dropFailedCoverMediaSlideIds: string[] = [],
): Promise<VisualRepairResponse> {
  let response: Response;
  try {
    response = await fetch(
      workerUrl(pythonWorkerUrl, "/ai/repair-deck-visuals"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deck,
          actions,
          dropOptionalMediaSlideIds,
          dropFailedCoverMediaSlideIds,
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "Visual repair request unavailable.",
    );
  }
  if (!response.ok) {
    throw new Error((await response.text()) || "Visual repair request failed.");
  }
  return visualRepairResponseSchema.parse(await response.json());
}

export function hasMediaPlaceholder(deck: Deck) {
  return deck.slides.some(isUnresolvedMediaSlide);
}

export function unresolvedOptionalMediaSlideIds(deck: Deck) {
  return deck.slides
    .filter(
      (slide) =>
        isUnresolvedMediaSlide(slide) &&
        slide.aiNotes?.compositionPlan?.requiredAsset === false,
    )
    .map((slide) => slide.slideId);
}

export function unresolvedRequiredMediaSlideIds(deck: Deck) {
  return deck.slides
    .filter(
      (slide) =>
        isUnresolvedMediaSlide(slide) &&
        slide.aiNotes?.compositionPlan?.requiredAsset !== false,
    )
    .map((slide) => slide.slideId);
}

export function unresolvedFailedCoverMediaSlideIds(deck: Deck) {
  return deck.slides
    .filter(
      (slide) =>
        slide.order === 1 &&
        isUnresolvedMediaSlide(slide) &&
        IMAGE_COVER_COMPOSITION_IDS.has(
          slide.aiNotes?.compositionPlan?.compositionId ?? "",
        ),
    )
    .map((slide) => slide.slideId);
}

export function resolvedVisualAssetCount(deck: Deck) {
  return resolvedVisualAssetSlides(deck).length;
}

export function resolvedVisualAssetSlides(deck: Deck) {
  return deck.slides.filter(
    (slide) =>
      slide.aiNotes?.visualPlan?.asset &&
      slide.elements.some(
        (element) =>
          element.visible &&
          element.role === "media" &&
          element.type === "image",
      ),
  );
}

function isUnresolvedMediaSlide(deckSlide: Deck["slides"][number]) {
  return (
    deckSlide.aiNotes?.visualPlan?.imageNeeded === true &&
    deckSlide.elements.some(
      (element) =>
        element.visible &&
        element.role === "media" &&
        element.elementId.endsWith("_media_placeholder"),
    )
  );
}

function workerUrl(baseUrl: string, path: string): string {
  return new URL(
    path,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  ).toString();
}
