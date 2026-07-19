import type {
  RehearsalProjectCoreMessageCoverage,
  RehearsalProjectMetricReasonCode,
  RehearsalProjectRunMetricPoint,
  RehearsalProjectSummary,
  RehearsalProjectTimingOverrun,
} from "@orbit/shared";
import type { RehearsalRunComparisonViewModel } from "./rehearsalRunComparisonModel";

export type ProjectSummaryKpi = {
  deltaLabel: string | null;
  detail: string;
  key: "duration" | "silence" | "core-message" | "timing-overrun";
  label: string;
  state: "positive" | "negative" | "neutral" | "unavailable";
  value: string;
};

export type ProjectSummarySlideRow =
  RehearsalProjectSummary["slidePerformanceSummaries"][number] & {
    href: string | null;
    status: "개선 필요" | "보통" | "개선됨" | "비교 제외" | "좋음";
    statusTone: "danger" | "warning" | "success" | "neutral";
  };

export type ProjectSummaryDashboardModel = {
  durationSeries: Array<{ label: string; seconds: number }>;
  kpis: ProjectSummaryKpi[];
  latest: RehearsalProjectRunMetricPoint;
  latestDurationTarget: number | null;
  latestMeasuredRunLabel: string | null;
  metricSeries: {
    coreMessage: Array<{ label: string; value: number }>;
    longSilence: Array<{ label: string; value: number }>;
    timingOverrun: Array<{ label: string; value: number }>;
  };
  primaryAction: {
    href: string | null;
    label: string;
    reason: string;
    slideLabel: string | null;
  };
  slideRows: ProjectSummarySlideRow[];
};

export function buildRehearsalProjectSummaryDashboardModel(
  summary: RehearsalProjectSummary,
  comparison: RehearsalRunComparisonViewModel | null,
): ProjectSummaryDashboardModel | null {
  const latest = summary.runMetricSeries.at(-1);
  if (!latest) return null;

  const previous = summary.runMetricSeries.at(-2) ?? null;
  const labeledRuns = summary.runMetricSeries.map((run, index) => ({
    label: `${index + 1}회차`,
    run,
  }));
  const durationSeries = labeledRuns.flatMap(({ label, run }) =>
    run.duration.measurementState === "measured"
      ? [{ label, seconds: run.duration.actualSeconds }]
      : [],
  );
  const latestMeasuredRunIndex = findLatestMeasuredRunIndex(
    summary.runMetricSeries,
  );
  const latestSilenceVersion = findLatestSilenceMetricVersion(
    summary.runMetricSeries,
  );
  const latestDurationTarget =
    latest.duration.measurementState === "measured"
      ? latest.duration.targetSeconds
      : null;

  return {
    latest,
    latestDurationTarget,
    latestMeasuredRunLabel:
      latestMeasuredRunIndex >= 0
        ? `${latestMeasuredRunIndex + 1}회차`
        : null,
    durationSeries,
    metricSeries: {
      longSilence: labeledRuns.flatMap(({ label, run }) =>
        run.longSilence.measurementState === "measured" &&
        run.longSilence.metricDefinitionVersion === latestSilenceVersion
          ? [{ label, value: run.longSilence.count }]
          : [],
      ).slice(-5),
      coreMessage: labeledRuns.flatMap(({ label, run }) =>
        run.coreMessageCoverage.measurementState === "measured"
          ? [{ label, value: run.coreMessageCoverage.rate * 100 }]
          : [],
      ).slice(-5),
      timingOverrun: labeledRuns.flatMap(({ label, run }) =>
        run.timingOverrun.measurementState === "measured"
          ? [{ label, value: run.timingOverrun.rate * 100 }]
          : [],
      ).slice(-5),
    },
    kpis: [
      buildDurationKpi(latest),
      buildSilenceKpi(latest, previous),
      buildCoreMessageKpi(latest.coreMessageCoverage, previous?.coreMessageCoverage),
      buildTimingOverrunKpi(latest.timingOverrun, previous?.timingOverrun),
    ],
    primaryAction: buildPrimaryAction(comparison, summary.progressComment),
    slideRows: buildSlideRows(summary, comparison),
  };
}

function buildDurationKpi(
  latest: RehearsalProjectRunMetricPoint,
): ProjectSummaryKpi {
  if (latest.duration.measurementState === "unmeasured") {
    return unavailableKpi(
      "duration",
      "총 발표 시간",
      latest.duration.reasonCode,
    );
  }

  const target = latest.duration.targetSeconds;
  const delta = target === null ? null : latest.duration.actualSeconds - target;
  return {
    key: "duration",
    label: "총 발표 시간",
    value: formatDuration(latest.duration.actualSeconds),
    detail: target === null ? "권장 시간 없음" : `/ 권장 ${formatDuration(target)}`,
    deltaLabel:
      delta === null
        ? null
        : delta === 0
          ? "권장과 일치"
          : `${delta > 0 ? "+" : "-"}${formatClockDelta(Math.abs(delta))} ${delta > 0 ? "초과" : "부족"}`,
    state:
      delta === null || Math.abs(delta) <= 5
        ? "neutral"
        : delta > 0
          ? "negative"
          : "positive",
  };
}

function buildSilenceKpi(
  latest: RehearsalProjectRunMetricPoint,
  previous: RehearsalProjectRunMetricPoint | null,
): ProjectSummaryKpi {
  if (latest.longSilence.measurementState === "unmeasured") {
    return unavailableKpi(
      "silence",
      "긴 침묵",
      latest.longSilence.reasonCode,
    );
  }

  const comparablePrevious =
    previous?.longSilence.measurementState === "measured" &&
    previous.longSilence.metricDefinitionVersion ===
      latest.longSilence.metricDefinitionVersion
      ? previous.longSilence
      : null;
  const delta = comparablePrevious
    ? latest.longSilence.count - comparablePrevious.count
    : null;
  return {
    key: "silence",
    label: "긴 침묵",
    value: `${latest.longSilence.count}회`,
    detail: comparablePrevious
      ? `/ 직전 ${comparablePrevious.count}회`
      : `측정 기준 v${latest.longSilence.metricDefinitionVersion}`,
    deltaLabel:
      delta === null
        ? "직전 회차 비교 불가"
        : delta === 0
          ? "직전과 동일"
          : `${Math.abs(delta)}회 ${delta < 0 ? "감소" : "증가"}`,
    state:
      delta === null || delta === 0
        ? "neutral"
        : delta < 0
          ? "positive"
          : "negative",
  };
}

function buildCoreMessageKpi(
  latest: RehearsalProjectCoreMessageCoverage,
  previous: RehearsalProjectCoreMessageCoverage | undefined,
): ProjectSummaryKpi {
  if (latest.measurementState === "unmeasured") {
    return unavailableKpi("core-message", "핵심 메시지 전달", latest.reasonCode);
  }

  const delta =
    previous?.measurementState === "measured"
      ? latest.coveredCount - previous.coveredCount
      : null;
  return {
    key: "core-message",
    label: "핵심 메시지 전달",
    value: `${latest.coveredCount}/${latest.measurableCount} 전달`,
    detail: formatPercent(latest.rate * 100),
    deltaLabel:
      delta === null
        ? "직전 회차 비교 불가"
        : delta === 0
          ? "직전과 동일"
          : `${Math.abs(delta)}개 ${delta > 0 ? "개선" : "감소"}`,
    state:
      delta === null || delta === 0
        ? "neutral"
        : delta > 0
          ? "positive"
          : "negative",
  };
}

function buildTimingOverrunKpi(
  latest: RehearsalProjectTimingOverrun,
  previous: RehearsalProjectTimingOverrun | undefined,
): ProjectSummaryKpi {
  if (latest.measurementState === "unmeasured") {
    return unavailableKpi(
      "timing-overrun",
      "시간 초과 슬라이드",
      latest.reasonCode,
    );
  }

  const delta =
    previous?.measurementState === "measured"
      ? latest.overrunCount - previous.overrunCount
      : null;
  return {
    key: "timing-overrun",
    label: "시간 초과 슬라이드",
    value: `${latest.overrunCount}/${latest.measurableCount}장`,
    detail: formatPercent(latest.rate * 100),
    deltaLabel:
      delta === null
        ? "직전 회차 비교 불가"
        : delta === 0
          ? "직전과 동일"
          : `${Math.abs(delta)}장 ${delta < 0 ? "감소" : "증가"}`,
    state:
      delta === null || delta === 0
        ? "neutral"
        : delta < 0
          ? "positive"
          : "negative",
  };
}

function unavailableKpi(
  key: ProjectSummaryKpi["key"],
  label: string,
  reasonCode: RehearsalProjectMetricReasonCode,
): ProjectSummaryKpi {
  return {
    key,
    label,
    value: "N/A",
    detail: reasonLabel(reasonCode),
    deltaLabel: null,
    state: "unavailable",
  };
}

function buildSlideRows(
  summary: RehearsalProjectSummary,
  comparison: RehearsalRunComparisonViewModel | null,
): ProjectSummarySlideRow[] {
  const issueBySlide = new Map<
    string,
    { group: RehearsalRunComparisonViewModel["groups"][number]["key"]; href: string }
  >();
  const priority = ["repeated", "new", "improved", "incomparable"] as const;
  for (const groupKey of priority) {
    const group = comparison?.groups.find((candidate) => candidate.key === groupKey);
    for (const item of group?.items ?? []) {
      if (!issueBySlide.has(item.slideId)) {
        issueBySlide.set(item.slideId, { group: groupKey, href: item.href });
      }
    }
  }

  return summary.slidePerformanceSummaries.map((slide) => {
    const issue = issueBySlide.get(slide.slideId);
    if (issue?.group === "repeated" || issue?.group === "new") {
      return {
        ...slide,
        href: issue.href,
        status: issue.group === "repeated" ? "개선 필요" : "보통",
        statusTone: issue.group === "repeated" ? "danger" : "warning",
      };
    }
    if (issue?.group === "improved") {
      return {
        ...slide,
        href: issue.href,
        status: "개선됨",
        statusTone: "success",
      };
    }
    if (issue?.group === "incomparable") {
      return {
        ...slide,
        href: issue.href,
        status: "비교 제외",
        statusTone: "neutral",
      };
    }

    const needsImprovement =
      (slide.timingOverrun.measurementState === "measured" &&
        slide.timingOverrun.rate >= 0.4) ||
      (slide.coreMessageCoverage.measurementState === "measured" &&
        slide.coreMessageCoverage.rate < 0.7);
    const needsAttention =
      !needsImprovement &&
      ((slide.timingOverrun.measurementState === "measured" &&
        slide.timingOverrun.rate >= 0.2) ||
        (slide.coreMessageCoverage.measurementState === "measured" &&
          slide.coreMessageCoverage.rate < 0.9));
    return {
      ...slide,
      href: null,
      status: needsImprovement ? "개선 필요" : needsAttention ? "보통" : "좋음",
      statusTone: needsImprovement ? "danger" : needsAttention ? "warning" : "success",
    };
  });
}

function buildPrimaryAction(
  comparison: RehearsalRunComparisonViewModel | null,
  progressComment: string | null,
) {
  const primary = comparison?.briefing[0];
  if (primary) {
    return {
      href: primary.href,
      label: primary.label,
      reason: primary.reason,
      slideLabel: primary.slideLabel,
    };
  }
  return {
    href: null,
    label: "현재 흐름을 유지하며 한 번 더 연습하세요",
    reason:
      progressComment ??
      "반복된 핵심 이슈가 없습니다. 같은 발표 흐름을 유지하며 다음 회차를 기록해보세요.",
    slideLabel: null,
  };
}

function findLatestMeasuredRunIndex(series: RehearsalProjectRunMetricPoint[]) {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    if (series[index].duration.measurementState === "measured") return index;
  }
  return -1;
}

function findLatestSilenceMetricVersion(
  series: RehearsalProjectRunMetricPoint[],
) {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const metric = series[index].longSilence;
    if (metric.measurementState === "measured") {
      return metric.metricDefinitionVersion;
    }
  }
  return null;
}

function reasonLabel(reasonCode: RehearsalProjectMetricReasonCode) {
  const labels: Record<RehearsalProjectMetricReasonCode, string> = {
    REPORT_UNAVAILABLE: "리포트 데이터 없음",
    DURATION_UNMEASURED: "발표 시간 미측정",
    SILENCE_UNMEASURED: "침묵 구간 미측정",
    SEMANTIC_EVALUATION_UNAVAILABLE: "의미 전달 분석 미완료",
    NO_MEASURABLE_CORE_CUES: "측정 가능한 핵심 메시지 없음",
    SLIDE_TIMINGS_UNAVAILABLE: "슬라이드 시간 미측정",
  };
  return labels[reasonCode];
}

export function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0
    ? `${minutes}:${String(remainder).padStart(2, "0")}`
    : `${remainder}초`;
}

export function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function formatClockDelta(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
