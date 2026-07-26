export type PairwiseNliLabelMapping = {
  entailment: number;
  neutral: number;
  contradiction: number;
};

export type PairwiseNliScores = {
  entailmentScore: number;
  neutralScore: number;
  contradictionScore: number;
};

const REQUIRED_LABELS = ["entailment", "neutral", "contradiction"] as const;

export function resolvePairwiseNliLabelMapping(
  id2label: Readonly<Record<string | number, string>>,
): PairwiseNliLabelMapping {
  const indices = new Map<string, number>();

  for (const [rawIndex, rawLabel] of Object.entries(id2label)) {
    const index = Number(rawIndex);
    const label = rawLabel.trim().toLowerCase();
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      !REQUIRED_LABELS.includes(label as never)
    ) {
      continue;
    }
    if (indices.has(label)) {
      throw new Error(
        `Pairwise NLI config contains duplicate ${label} labels.`,
      );
    }
    indices.set(label, index);
  }

  if (!REQUIRED_LABELS.every((label) => indices.has(label))) {
    throw new Error(
      "Pairwise NLI config must define entailment, neutral, and contradiction labels.",
    );
  }

  return {
    entailment: indices.get("entailment")!,
    neutral: indices.get("neutral")!,
    contradiction: indices.get("contradiction")!,
  };
}

export function mapPairwiseNliLogits(
  logits: readonly number[],
  mapping: PairwiseNliLabelMapping,
): PairwiseNliScores {
  const requiredLength =
    Math.max(mapping.entailment, mapping.neutral, mapping.contradiction) + 1;
  if (logits.length < requiredLength) {
    throw new Error(
      "Pairwise NLI logits do not contain all configured labels.",
    );
  }
  if (!logits.every(Number.isFinite)) {
    throw new Error("Pairwise NLI logits must be finite numbers.");
  }

  const maxLogit = Math.max(...logits);
  const exponentials = logits.map((logit) => Math.exp(logit - maxLogit));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Pairwise NLI logits could not be normalized.");
  }

  return {
    entailmentScore: exponentials[mapping.entailment]! / total,
    neutralScore: exponentials[mapping.neutral]! / total,
    contradictionScore: exponentials[mapping.contradiction]! / total,
  };
}
