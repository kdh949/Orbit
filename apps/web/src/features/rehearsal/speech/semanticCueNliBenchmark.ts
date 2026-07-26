import type { BrowserSemanticCueNliDevice } from "../../../runtime/speech/semantic/nli/browserSemanticCueNliWorkerProtocol";

export type SemanticCueNliBenchmarkInput = {
  device: BrowserSemanticCueNliDevice;
  modelId: string;
  dtype: string;
  modelBytes: number;
  memoryBeforeBytes: number | null;
  memoryAfterBytes: number | null;
  coldLoadMs: number;
  warmLatenciesMs: readonly number[];
  mainThreadLongTasksMs: readonly number[];
  expectedCovered: readonly boolean[];
  predictedCovered: readonly boolean[];
  coldLoadsDuringPresentation: number;
};

export type SemanticCueNliBenchmarkResult = Omit<
  SemanticCueNliBenchmarkInput,
  | "warmLatenciesMs"
  | "mainThreadLongTasksMs"
  | "expectedCovered"
  | "predictedCovered"
> & {
  warmLatencyP50Ms: number;
  warmLatencyP95Ms: number;
  maxMainThreadTaskMs: number;
  memoryDeltaBytes: number | null;
  evaluatedNegativeCount: number;
  falseCoveredRate: number;
  confusionMatrix: { tp: number; fp: number; tn: number; fn: number };
};

export type SemanticCueNliBenchmarkGateReason =
  | "warm-p95-over-500ms"
  | "false-covered-over-1pct"
  | "insufficient-negative-samples"
  | "main-thread-task-over-50ms"
  | "presentation-cold-load";

export function buildSemanticCueNliBenchmarkResult(
  input: SemanticCueNliBenchmarkInput,
): SemanticCueNliBenchmarkResult {
  if (input.warmLatenciesMs.length === 0) {
    throw new Error(
      "Semantic Cue NLI benchmark requires warm latency samples.",
    );
  }
  if (input.expectedCovered.length !== input.predictedCovered.length) {
    throw new Error(
      "Semantic Cue NLI benchmark labels must have equal lengths.",
    );
  }

  const confusionMatrix = input.expectedCovered.reduce(
    (matrix, expected, index) => {
      const predicted = input.predictedCovered[index];
      if (expected && predicted) matrix.tp += 1;
      else if (!expected && predicted) matrix.fp += 1;
      else if (!expected && !predicted) matrix.tn += 1;
      else matrix.fn += 1;
      return matrix;
    },
    { tp: 0, fp: 0, tn: 0, fn: 0 },
  );
  const negativeCount = confusionMatrix.fp + confusionMatrix.tn;

  return {
    device: input.device,
    modelId: input.modelId,
    dtype: input.dtype,
    modelBytes: input.modelBytes,
    memoryBeforeBytes: input.memoryBeforeBytes,
    memoryAfterBytes: input.memoryAfterBytes,
    memoryDeltaBytes:
      input.memoryBeforeBytes === null || input.memoryAfterBytes === null
        ? null
        : input.memoryAfterBytes - input.memoryBeforeBytes,
    coldLoadMs: input.coldLoadMs,
    coldLoadsDuringPresentation: input.coldLoadsDuringPresentation,
    warmLatencyP50Ms: percentile(input.warmLatenciesMs, 0.5),
    warmLatencyP95Ms: percentile(input.warmLatenciesMs, 0.95),
    maxMainThreadTaskMs: Math.max(0, ...input.mainThreadLongTasksMs),
    evaluatedNegativeCount: negativeCount,
    falseCoveredRate:
      negativeCount === 0 ? 0 : confusionMatrix.fp / negativeCount,
    confusionMatrix,
  };
}

export function evaluateSemanticCueNliBenchmarkGate(
  result: SemanticCueNliBenchmarkResult,
): { passed: boolean; reasons: SemanticCueNliBenchmarkGateReason[] } {
  const reasons: SemanticCueNliBenchmarkGateReason[] = [];
  if (result.warmLatencyP95Ms > 500) reasons.push("warm-p95-over-500ms");
  if (result.falseCoveredRate > 0.01) reasons.push("false-covered-over-1pct");
  if (result.evaluatedNegativeCount < 100)
    reasons.push("insufficient-negative-samples");
  if (result.maxMainThreadTaskMs > 50)
    reasons.push("main-thread-task-over-50ms");
  if (result.coldLoadsDuringPresentation > 0)
    reasons.push("presentation-cold-load");
  return { passed: reasons.length === 0, reasons };
}

function percentile(values: readonly number[], quantile: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index]!;
}
