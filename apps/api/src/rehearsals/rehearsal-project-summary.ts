import {
  rehearsalEvaluationSnapshotSchema,
  rehearsalProjectSummarySchema,
  rehearsalReportSchema,
  type RehearsalEvaluationSnapshot,
  type RehearsalProjectCoreMessageCoverage,
  type RehearsalProjectSummary,
  type RehearsalProjectTimingOverrun,
  type RehearsalReport,
} from "@orbit/shared";

const TIMING_OVERRUN_RATIO = 1.2;

export type RehearsalProjectSummaryRunInput = {
  runId: string;
  createdAt: Date;
  rehearsalReport: Record<string, unknown> | null;
  evaluationSnapshot: RehearsalEvaluationSnapshot | null;
};

type ParsedRun = RehearsalProjectSummaryRunInput & {
  report: RehearsalReport | null;
  snapshot: RehearsalEvaluationSnapshot | null;
};

type SlideAccumulator = {
  actualTotal: number;
  timingCount: number;
  overrunCount: number;
  coveredCount: number;
  partialCount: number;
  missedCount: number;
};

export function buildRehearsalProjectSummary(input: {
  projectId: string;
  progressComment: string | null;
  runs: RehearsalProjectSummaryRunInput[];
}): RehearsalProjectSummary {
  const runs = input.runs
    .map(parseRun)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  const runMetricSeries = runs.map((run) => buildRunMetricPoint(run));
  const slidePerformanceSummaries = buildSlidePerformanceSummaries(runs);

  return rehearsalProjectSummarySchema.parse({
    projectId: input.projectId,
    runCount: runs.length,
    runDurationSeries: runMetricSeries.flatMap((point) =>
      point.duration.measurementState === "measured"
        ? [
            {
              runId: point.runId,
              createdAt: point.createdAt,
              durationSeconds: point.duration.actualSeconds,
            },
          ]
        : [],
    ),
    slideAvgTimings: slidePerformanceSummaries.flatMap((slide) =>
      slide.avgActualSeconds === null
        ? []
        : [
            {
              slideId: slide.slideId,
              avgSeconds: slide.avgActualSeconds,
              sampleCount: slide.sampleCount,
            },
          ],
    ),
    runMetricSeries,
    slidePerformanceSummaries,
    progressComment: input.progressComment,
  });
}

function parseRun(run: RehearsalProjectSummaryRunInput): ParsedRun {
  const reportResult = rehearsalReportSchema.safeParse(run.rehearsalReport);
  const snapshotResult = rehearsalEvaluationSnapshotSchema.safeParse(
    run.evaluationSnapshot,
  );

  return {
    ...run,
    report: reportResult.success ? reportResult.data : null,
    snapshot: snapshotResult.success ? snapshotResult.data : null,
  };
}

function buildRunMetricPoint(run: ParsedRun) {
  const targetSeconds = getTargetDurationSeconds(run.snapshot);

  return {
    runId: run.runId,
    createdAt: run.createdAt.toISOString(),
    duration: buildDurationMetric(run.report, targetSeconds),
    longSilence: buildLongSilenceMetric(run.report),
    coreMessageCoverage: buildCoreMessageCoverage(run.report),
    timingOverrun: buildTimingOverrun(run.report?.slideTimings ?? []),
  };
}

function buildDurationMetric(
  report: RehearsalReport | null,
  targetSeconds: number | null,
) {
  if (report === null) {
    return {
      measurementState: "unmeasured" as const,
      reasonCode: "REPORT_UNAVAILABLE" as const,
      actualSeconds: null,
      targetSeconds,
    };
  }
  if (report.metrics.measurements.duration.measurementState !== "measured") {
    return {
      measurementState: "unmeasured" as const,
      reasonCode: "DURATION_UNMEASURED" as const,
      actualSeconds: null,
      targetSeconds,
    };
  }

  return {
    measurementState: "measured" as const,
    reasonCode: null,
    actualSeconds: report.metrics.durationSeconds,
    targetSeconds,
  };
}

function buildLongSilenceMetric(report: RehearsalReport | null) {
  if (report === null) {
    return {
      measurementState: "unmeasured" as const,
      reasonCode: "REPORT_UNAVAILABLE" as const,
      count: null,
      metricDefinitionVersion: null,
    };
  }
  if (report.silenceAnalysis.measurementState !== "measured") {
    return {
      measurementState: "unmeasured" as const,
      reasonCode: "SILENCE_UNMEASURED" as const,
      count: null,
      metricDefinitionVersion: report.silenceAnalysis.metricDefinitionVersion,
    };
  }

  return {
    measurementState: "measured" as const,
    reasonCode: null,
    count: report.silenceAnalysis.longSilenceCount,
    metricDefinitionVersion: report.silenceAnalysis.metricDefinitionVersion,
  };
}

function buildCoreMessageCoverage(
  report: RehearsalReport | null,
): RehearsalProjectCoreMessageCoverage {
  if (report === null) {
    return unmeasuredCoreMessageCoverage("REPORT_UNAVAILABLE");
  }
  if (
    report.semanticEvaluation.state !== "succeeded" ||
    report.semanticEvaluation.measurementMode !== "full"
  ) {
    return unmeasuredCoreMessageCoverage("SEMANTIC_EVALUATION_UNAVAILABLE");
  }

  const outcomes = report.semanticCueOutcomes.filter(
    (outcome) =>
      outcome.importance === "core" &&
      outcome.measurementMode === "full" &&
      ["covered", "partial", "missed"].includes(outcome.status),
  );
  if (outcomes.length === 0) {
    return unmeasuredCoreMessageCoverage("NO_MEASURABLE_CORE_CUES");
  }

  const coveredCount = outcomes.filter(
    (outcome) => outcome.status === "covered",
  ).length;
  const partialCount = outcomes.filter(
    (outcome) => outcome.status === "partial",
  ).length;
  const missedCount = outcomes.filter(
    (outcome) => outcome.status === "missed",
  ).length;

  return {
    measurementState: "measured",
    reasonCode: null,
    coveredCount,
    partialCount,
    missedCount,
    measurableCount: outcomes.length,
    rate: divide(coveredCount, outcomes.length),
  };
}

function buildTimingOverrun(
  timings: RehearsalReport["slideTimings"],
): RehearsalProjectTimingOverrun {
  const measurableTimings = timings.filter((timing) => timing.targetSeconds > 0);
  if (measurableTimings.length === 0) {
    return unmeasuredTimingOverrun();
  }
  const overrunCount = measurableTimings.filter(isTimingOverrun).length;

  return {
    measurementState: "measured",
    reasonCode: null,
    overrunCount,
    measurableCount: measurableTimings.length,
    rate: divide(overrunCount, measurableTimings.length),
  };
}

function buildSlidePerformanceSummaries(runs: ParsedRun[]) {
  const accumulators = new Map<string, SlideAccumulator>();
  const discoveredSlideIds: string[] = [];
  const rememberSlide = (slideId: string) => {
    if (!accumulators.has(slideId)) {
      accumulators.set(slideId, emptySlideAccumulator());
      discoveredSlideIds.push(slideId);
    }
    return accumulators.get(slideId)!;
  };

  for (const run of runs) {
    if (run.report === null) continue;

    for (const timing of run.report.slideTimings) {
      if (timing.targetSeconds <= 0) continue;
      const accumulator = rememberSlide(timing.slideId);
      accumulator.actualTotal += timing.actualSeconds;
      accumulator.timingCount += 1;
      if (isTimingOverrun(timing)) accumulator.overrunCount += 1;
    }

    if (
      run.report.semanticEvaluation.state !== "succeeded" ||
      run.report.semanticEvaluation.measurementMode !== "full"
    ) {
      continue;
    }
    for (const outcome of run.report.semanticCueOutcomes) {
      if (
        outcome.importance !== "core" ||
        outcome.measurementMode !== "full" ||
        !["covered", "partial", "missed"].includes(outcome.status)
      ) {
        continue;
      }
      const accumulator = rememberSlide(outcome.slideId);
      if (outcome.status === "covered") accumulator.coveredCount += 1;
      if (outcome.status === "partial") accumulator.partialCount += 1;
      if (outcome.status === "missed") accumulator.missedCount += 1;
    }
  }

  const latestSnapshot = [...runs]
    .reverse()
    .find((run) => run.snapshot !== null)?.snapshot;
  const latestSlides = latestSnapshot?.slides ?? [];
  const slideIds =
    latestSlides.length > 0
      ? latestSlides.map((slide) => slide.slideId)
      : discoveredSlideIds;
  const slideMetadata = new Map(
    latestSlides.map((slide) => [slide.slideId, slide]),
  );

  return slideIds.map((slideId, index) => {
    const metadata = slideMetadata.get(slideId);
    const accumulator = accumulators.get(slideId) ?? emptySlideAccumulator();
    const semanticMeasurableCount =
      accumulator.coveredCount +
      accumulator.partialCount +
      accumulator.missedCount;

    return {
      slideId,
      order: metadata?.order ?? index + 1,
      title: metadata?.title ?? `슬라이드 ${index + 1}`,
      thumbnailUrl: metadata?.thumbnailUrl ?? "",
      avgActualSeconds:
        accumulator.timingCount > 0
          ? Math.round(accumulator.actualTotal / accumulator.timingCount)
          : null,
      targetSeconds: metadata?.estimatedSeconds ?? null,
      sampleCount: accumulator.timingCount,
      timingOverrun:
        accumulator.timingCount > 0
          ? {
              measurementState: "measured" as const,
              reasonCode: null,
              overrunCount: accumulator.overrunCount,
              measurableCount: accumulator.timingCount,
              rate: divide(
                accumulator.overrunCount,
                accumulator.timingCount,
              ),
            }
          : unmeasuredTimingOverrun(),
      coreMessageCoverage:
        semanticMeasurableCount > 0
          ? {
              measurementState: "measured" as const,
              reasonCode: null,
              coveredCount: accumulator.coveredCount,
              partialCount: accumulator.partialCount,
              missedCount: accumulator.missedCount,
              measurableCount: semanticMeasurableCount,
              rate: divide(accumulator.coveredCount, semanticMeasurableCount),
            }
          : unmeasuredCoreMessageCoverage("NO_MEASURABLE_CORE_CUES"),
    };
  });
}

function getTargetDurationSeconds(
  snapshot: RehearsalEvaluationSnapshot | null,
) {
  if (snapshot === null || snapshot.slides.length === 0) return null;
  return snapshot.slides.reduce(
    (total, slide) => total + slide.estimatedSeconds,
    0,
  );
}

function emptySlideAccumulator(): SlideAccumulator {
  return {
    actualTotal: 0,
    timingCount: 0,
    overrunCount: 0,
    coveredCount: 0,
    partialCount: 0,
    missedCount: 0,
  };
}

function unmeasuredCoreMessageCoverage(
  reasonCode:
    | "REPORT_UNAVAILABLE"
    | "SEMANTIC_EVALUATION_UNAVAILABLE"
    | "NO_MEASURABLE_CORE_CUES",
): RehearsalProjectCoreMessageCoverage {
  return {
    measurementState: "unmeasured",
    reasonCode,
    coveredCount: 0,
    partialCount: 0,
    missedCount: 0,
    measurableCount: 0,
    rate: null,
  };
}

function unmeasuredTimingOverrun(): RehearsalProjectTimingOverrun {
  return {
    measurementState: "unmeasured",
    reasonCode: "SLIDE_TIMINGS_UNAVAILABLE",
    overrunCount: 0,
    measurableCount: 0,
    rate: null,
  };
}

function isTimingOverrun(
  timing: RehearsalReport["slideTimings"][number],
) {
  return timing.actualSeconds > timing.targetSeconds * TIMING_OVERRUN_RATIO;
}

function divide(numerator: number, denominator: number) {
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}
