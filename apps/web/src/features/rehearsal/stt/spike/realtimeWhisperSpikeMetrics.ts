export type RealtimeWhisperTurnMetric = {
  turnId: number;
  itemId: string | null;
  speechStartedAtMs: number;
  committedAtMs: number | null;
  firstDeltaAtMs: number | null;
  completedAtMs: number | null;
  transcript: string;
  partialCount: number;
};

export type RealtimeWhisperMetricSummary = {
  completedTurns: number;
  firstDeltaLatencyMedianMs: number | null;
  firstDeltaLatencyP95Ms: number | null;
  commitToFinalMedianMs: number | null;
  commitToFinalP95Ms: number | null;
  onsetToFinalMedianMs: number | null;
  onsetToFinalP95Ms: number | null;
};

export function summarizeRealtimeWhisperMetrics(
  turns: readonly RealtimeWhisperTurnMetric[]
): RealtimeWhisperMetricSummary {
  const completedTurns = turns.filter((turn) => turn.completedAtMs !== null);
  const firstDeltaLatencies = turns.flatMap((turn) =>
    turn.firstDeltaAtMs === null
      ? []
      : [Math.max(turn.firstDeltaAtMs - turn.speechStartedAtMs, 0)]
  );
  const commitToFinalLatencies = completedTurns.flatMap((turn) =>
    turn.committedAtMs === null || turn.completedAtMs === null
      ? []
      : [Math.max(turn.completedAtMs - turn.committedAtMs, 0)]
  );
  const onsetToFinalLatencies = completedTurns.flatMap((turn) =>
    turn.completedAtMs === null
      ? []
      : [Math.max(turn.completedAtMs - turn.speechStartedAtMs, 0)]
  );

  return {
    completedTurns: completedTurns.length,
    firstDeltaLatencyMedianMs: percentile(firstDeltaLatencies, 50),
    firstDeltaLatencyP95Ms: percentile(firstDeltaLatencies, 95),
    commitToFinalMedianMs: percentile(commitToFinalLatencies, 50),
    commitToFinalP95Ms: percentile(commitToFinalLatencies, 95),
    onsetToFinalMedianMs: percentile(onsetToFinalLatencies, 50),
    onsetToFinalP95Ms: percentile(onsetToFinalLatencies, 95)
  };
}

export function calculateNormalizedKoreanCer(reference: string, actual: string) {
  const expected = normalizeCerText(reference);
  const received = normalizeCerText(actual);
  if (expected.length === 0) {
    return received.length === 0 ? 0 : null;
  }

  return levenshteinDistance([...expected], [...received]) / expected.length;
}

export function calculateKoreanCerBreakdown(reference: string, actual: string) {
  return {
    strictCer: calculateNormalizedKoreanCer(reference, actual),
    numberTolerantCer: calculateNormalizedKoreanCer(
      normalizeKoreanNumberVariants(reference),
      normalizeKoreanNumberVariants(actual)
    )
  };
}

export function normalizeCerText(value: string) {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function normalizeKoreanNumberVariants(value: string) {
  return normalizeCerText(value)
    .replace(/(?:3|삼|세)(?=(?:건|개|명|번|회|장|가지|곳|대|줄|권))/gu, "3")
    .replace(/(?:2|이|두)(?=(?:건|개|명|번|회|장|가지|곳|대|줄|권))/gu, "2");
}

function percentile(values: readonly number[], target: number) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil((target / 100) * sorted.length) - 1;
  return Math.round(sorted[Math.max(index, 0)]);
}

function levenshteinDistance(left: readonly string[], right: readonly string[]) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost
      );
    }
    previous = current;
  }

  return previous[right.length] ?? 0;
}
