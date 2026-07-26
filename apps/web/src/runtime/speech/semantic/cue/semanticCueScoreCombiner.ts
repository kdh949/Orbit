export type SemanticCueCombinedLabel =
  | "covered"
  | "partial"
  | "not_covered"
  | "contradicted";

export type SemanticCueScoreCombination = {
  label: SemanticCueCombinedLabel;
  finalScore: number;
  reasonCodes: string[];
};

export type SemanticCueCombinerConfig = {
  weights: {
    lexical: number;
    conceptCoverage: number;
    embedding: number;
    entailment: number;
  };
  contradictionThreshold: number;
  entailmentReasonThreshold: number;
  conceptReasonThreshold: number;
  lexicalReasonThreshold: number;
  embeddingReasonThreshold: number;
  entailmentFloorThreshold: number;
  entailmentFloorScore: number;
  coveredFinalScore: number;
  coveredEntailment: number;
  partialFinalScore: number;
};

export const defaultSemanticCueCombinerConfig: SemanticCueCombinerConfig = {
  weights: {
    lexical: 0.1,
    conceptCoverage: 0.2,
    embedding: 0.25,
    entailment: 0.45
  },
  contradictionThreshold: 0.7,
  entailmentReasonThreshold: 0.78,
  conceptReasonThreshold: 0.5,
  lexicalReasonThreshold: 0.5,
  embeddingReasonThreshold: 0.7,
  entailmentFloorThreshold: 0.9,
  entailmentFloorScore: 0.75,
  coveredFinalScore: 0.7,
  coveredEntailment: 0.78,
  partialFinalScore: 0.45
};

export function combineSemanticCueScore(
  options: {
    lexicalScore?: number;
    conceptCoverage?: number;
    embeddingScore?: number;
    nli?: {
      entailmentScore: number;
      neutralScore: number;
      contradictionScore: number;
    };
  },
  config: SemanticCueCombinerConfig = defaultSemanticCueCombinerConfig
): SemanticCueScoreCombination {
  const lexicalScore = clamp01(options.lexicalScore ?? 0);
  const conceptCoverage = clamp01(options.conceptCoverage ?? 0);
  const embeddingScore = clamp01(options.embeddingScore ?? 0);
  const entailmentScore = clamp01(options.nli?.entailmentScore ?? 0);
  const contradictionScore = clamp01(options.nli?.contradictionScore ?? 0);
  const reasonCodes: string[] = [];

  if (contradictionScore >= config.contradictionThreshold) {
    return {
      label: "contradicted",
      finalScore: roundScore(Math.max(0, 1 - contradictionScore)),
      reasonCodes: ["nli-contradiction"]
    };
  }

  if (entailmentScore >= config.entailmentReasonThreshold) {
    reasonCodes.push("nli-entailment");
  }

  if (conceptCoverage >= config.conceptReasonThreshold) {
    reasonCodes.push("concept-coverage");
  }

  if (lexicalScore >= config.lexicalReasonThreshold) {
    reasonCodes.push("lexical-support");
  }

  if (embeddingScore >= config.embeddingReasonThreshold) {
    reasonCodes.push("embedding-support");
  }

  const finalScore = roundScore(
    lexicalScore * config.weights.lexical +
      conceptCoverage * config.weights.conceptCoverage +
      embeddingScore * config.weights.embedding +
      entailmentScore * config.weights.entailment
  );
  const effectiveFinalScore =
    entailmentScore >= config.entailmentFloorThreshold
      ? Math.max(finalScore, config.entailmentFloorScore)
      : finalScore;

  if (
    effectiveFinalScore >= config.coveredFinalScore &&
    entailmentScore >= config.coveredEntailment
  ) {
    return {
      label: "covered",
      finalScore: roundScore(effectiveFinalScore),
      reasonCodes
    };
  }

  if (effectiveFinalScore >= config.partialFinalScore) {
    return {
      label: "partial",
      finalScore: roundScore(effectiveFinalScore),
      reasonCodes: reasonCodes.length > 0 ? reasonCodes : ["partial-support"]
    };
  }

  return {
    label: "not_covered",
    finalScore,
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : ["insufficient-support"]
  };
}

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function roundScore(value: number) {
  return Math.round(value * 1000) / 1000;
}
