import {
  deckSchema,
  getSemanticQaIssues,
  repairSemanticQaOnce,
  type Deck,
  type GenerateDeckValidation,
} from "@orbit/shared/deck";
import {
  hasMediaPlaceholder,
  resolvedVisualAssetCount,
  resolvedVisualAssetSlides,
} from "./asset-resolution";

const hybridMediaBudget = { min: 3, max: 5 } as const;

export type VisualQualityIssue = {
  code: GenerateDeckValidation["designIssues"][number]["code"];
  slideOrder: number;
  message: string;
};

export function allValidationIssues(validation: GenerateDeckValidation) {
  return [
    ...validation.layoutIssues,
    ...validation.contentIssues,
    ...validation.designIssues,
    ...validation.presentationIssues,
  ];
}

export function withGenerationQualityMetadata(
  deck: Deck,
  validation: GenerateDeckValidation,
  requestedStatus: "passed" | "advisory" | "unavailable",
): Deck {
  const issues = allValidationIssues(validation).map((issue) => {
    const slideOrder = slideOrderFromIssuePath(issue.path);
    const slideId = slideOrder
      ? deck.slides[slideOrder - 1]?.slideId
      : undefined;
    return {
      code: issue.code,
      message: issue.message,
      severity: issue.severity === "error" ? "risk" as const : "warning" as const,
      ...(slideOrder ? { slideOrder } : {}),
      ...(slideId ? { slideId } : {}),
    };
  });
  return deckSchema.parse({
    ...deck,
    metadata: {
      ...deck.metadata,
      generationQuality: {
        status:
          requestedStatus === "unavailable"
            ? "unavailable"
            : issues.length > 0
              ? "advisory"
              : "passed",
        issues,
      },
    },
  });
}

function slideOrderFromIssuePath(path: string): number | undefined {
  const match = /^slides\.(\d+)/.exec(path);
  return match ? Number(match[1]) + 1 : undefined;
}

export function hasBlockingQualityGateIssues(
  validation: GenerateDeckValidation,
) {
  return allValidationIssues(validation).some((issue) => issue.blocking);
}

export function withHybridMediaBudgetIssue(
  validation: GenerateDeckValidation,
  deck: Deck,
): GenerateDeckValidation {
  const resolvedCount = resolvedVisualAssetCount(deck);
  if (
    resolvedCount >= hybridMediaBudget.min &&
    resolvedCount <= hybridMediaBudget.max
  ) {
    const resolvedSlides = resolvedVisualAssetSlides(deck);
    const hasOfficialEvidence = resolvedSlides.some(
      (slide) =>
        slide.aiNotes?.compositionPlan?.assetRole === "evidence" &&
        slide.aiNotes?.visualPlan?.imageSourcePolicy === "official-assets",
    );
    const hasGeneratedAtmosphere = resolvedSlides.some(
      (slide) =>
        slide.aiNotes?.compositionPlan?.assetRole === "atmosphere" &&
        slide.aiNotes?.visualPlan?.imageSourcePolicy === "ai-generated",
    );
    const contractIssues: GenerateDeckValidation["designIssues"] = [];
    if (!hasOfficialEvidence || !hasGeneratedAtmosphere) {
      contractIssues.push({
        code: "MEDIA_MIX_UNDERSUPPLIED",
        scope: "deck",
        severity: "warning",
        blocking: false,
        path: "slides",
        message:
          "Hybrid media requires at least one official evidence asset and one AI-generated atmosphere asset.",
      });
    }
    if (contractIssues.length === 0) return validation;
    return {
      ...validation,
      passed: false,
      designIssues: [...validation.designIssues, ...contractIssues],
    };
  }
  const code =
    resolvedCount < hybridMediaBudget.min
      ? "MEDIA_BUDGET_UNDERSUPPLIED"
      : "MEDIA_BUDGET_EXCEEDED";
  if (validation.designIssues.some((issue) => issue.code === code)) {
    return { ...validation, passed: false };
  }
  return {
    ...validation,
    passed: false,
    designIssues: [
      ...validation.designIssues,
      {
        code,
        scope: "deck",
        severity: "warning",
        blocking: false,
        path: "slides",
        message: `Hybrid media requires ${hybridMediaBudget.min}-${hybridMediaBudget.max} resolved visual assets; received ${resolvedCount}.`,
      },
    ],
  };
}

export function withDuplicateMediaAssetIssue(
  validation: GenerateDeckValidation,
  deck: Deck,
): GenerateDeckValidation {
  const assetIdentities = resolvedVisualAssetSlides(deck)
    .map((slide) => {
      const asset = slide.aiNotes?.visualPlan?.asset;
      return asset?.sourceAssetUrl ?? asset?.fileId ?? "";
    })
    .filter(Boolean);
  const hasDuplicateAssets =
    new Set(assetIdentities).size !== assetIdentities.length;
  if (!hasDuplicateAssets) return validation;
  if (
    validation.designIssues.some(
      (issue) => issue.code === "MEDIA_ASSET_DUPLICATED",
    )
  ) {
    return { ...validation, passed: false };
  }
  return {
    ...validation,
    passed: false,
    designIssues: [
      ...validation.designIssues,
      {
        code: "MEDIA_ASSET_DUPLICATED",
        scope: "deck",
        severity: "warning",
        blocking: false,
        path: "slides",
        message:
          "Media contains a repeated visual asset; each media slide requires a distinct asset.",
      },
    ],
  };
}

export function withUnresolvedMediaIssue(
  validation: GenerateDeckValidation,
): GenerateDeckValidation {
  if (
    validation.designIssues.some(
      (issue) => issue.code === "MEDIA_PLACEHOLDER_UNRESOLVED",
    )
  ) {
    return { ...validation, passed: false };
  }
  return {
    ...validation,
    passed: false,
    designIssues: [
      ...validation.designIssues,
      {
        code: "MEDIA_PLACEHOLDER_UNRESOLVED",
        scope: "deck",
        severity: "warning",
        blocking: false,
        path: "slides",
        message:
          "이미지 자리 표시자가 실제 asset 또는 no-media composition으로 해소되지 않았습니다.",
      },
    ],
  };
}

export function withVisualIssues(
  validation: GenerateDeckValidation,
  issues: VisualQualityIssue[],
): GenerateDeckValidation {
  const existing = new Set(
    validation.designIssues.map((issue) => `${issue.code}:${issue.path}`),
  );
  const visualIssues = issues
    .map((issue) => ({
      code: issue.code,
      scope: "slide" as const,
      severity: "warning" as const,
      blocking: false,
      path: `slides.${issue.slideOrder - 1}`,
      message: issue.message,
    }))
    .filter((issue) => !existing.has(`${issue.code}:${issue.path}`));
  return {
    ...validation,
    passed: false,
    designIssues: [...validation.designIssues, ...visualIssues],
  };
}

export function runInitialSemanticQuality(input: {
  deck: Deck;
  validation: GenerateDeckValidation;
  allowRepair?: boolean;
}): {
  deck: Deck;
  validation: GenerateDeckValidation;
  warnings: string[];
  unresolvedMedia: boolean;
} {
  let deck = input.deck;
  const warnings: string[] = [];
  const initialSemanticIssues = getSemanticQaIssues(deck);
  const shouldRepairSemanticIssues = initialSemanticIssues.some((issue) =>
    ["SLIDE_MESSAGE_MULTIPLE", "IMAGE_RELEVANCE_WEAK"].includes(issue.code),
  );
  if (shouldRepairSemanticIssues && input.allowRepair !== false) {
    deck = deckSchema.parse(repairSemanticQaOnce(deck));
    warnings.push("Semantic QA bounded repair applied once.");
  }
  const semanticIssues = getSemanticQaIssues(deck);
  let validation: GenerateDeckValidation = {
    ...input.validation,
    passed: input.validation.passed && semanticIssues.length === 0,
    presentationIssues: [
      ...input.validation.presentationIssues,
      ...semanticIssues,
    ],
  };
  const unresolvedMedia = hasMediaPlaceholder(deck);
  if (unresolvedMedia) {
    validation = withUnresolvedMediaIssue(validation);
  }
  return { deck, validation, warnings, unresolvedMedia };
}

export function applyPostVisualRepairValidation(input: {
  deck: Deck;
  validation: GenerateDeckValidation;
  enforcesHybridMediaBudget: boolean;
}): GenerateDeckValidation {
  const semanticIssues = getSemanticQaIssues(input.deck);
  let validation: GenerateDeckValidation = {
    ...input.validation,
    passed: input.validation.passed && semanticIssues.length === 0,
    presentationIssues: [
      ...input.validation.presentationIssues,
      ...semanticIssues,
    ],
  };
  if (hasMediaPlaceholder(input.deck)) {
    validation = withUnresolvedMediaIssue(validation);
  }
  validation = withDuplicateMediaAssetIssue(validation, input.deck);
  if (input.enforcesHybridMediaBudget) {
    validation = withHybridMediaBudgetIssue(validation, input.deck);
  }
  return validation;
}
