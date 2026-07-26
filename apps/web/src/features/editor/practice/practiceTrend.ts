import {
  distanceToTargetRange,
  slidePracticeMetricTargets,
  type SlidePracticeReportRecord,
} from "@orbit/shared/slide-practice";

export type PracticeTrendMetric = "fillerRate" | "pace" | "loudness" | "pauseRatio";
export type PracticeTrendMode = "current" | "comparison" | "trend";
export type PracticeTrendDirection = "improved" | "unchanged" | "declined" | "unavailable";

export type PracticeTrendPoint = {
  reportId: string;
  practiceSessionId: string;
  createdAt: string;
  dateLabel: string;
  value: number | null;
};

export type PracticeTrendSeries = {
  metric: PracticeTrendMetric;
  mode: PracticeTrendMode;
  direction: PracticeTrendDirection;
  points: PracticeTrendPoint[];
  segments: Array<[number, number]>;
};

export const practiceTrendMetricOptions: ReadonlyArray<{
  id: PracticeTrendMetric;
  label: string;
  unit: string;
  guidance: string;
}> = [
  { id: "fillerRate", label: "습관어/분", unit: "회/분", guidance: "낮을수록 좋아요" },
  { id: "pace", label: "말 속도", unit: "음절/초", guidance: "3.5~4.8 음절/초가 적정해요" },
  { id: "loudness", label: "평균 음량", unit: "dBFS", guidance: "-45~-30 dBFS가 적정해요" },
  { id: "pauseRatio", label: "쉼 비율", unit: "%", guidance: "12~55%가 적정해요" },
];

export function comparablePracticeReports(
  reports: readonly SlidePracticeReportRecord[],
  slideContentHash: string,
) {
  return reports
    .filter((report) => (
      report.reportVersion === 3
      && report.metricDefinitionVersion === 3
      && report.contentHashVersion === "slide-text-v1"
      && report.slideContentHash === slideContentHash
    ))
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-5);
}

export function buildPracticeTrendSeries(input: {
  reports: readonly SlidePracticeReportRecord[];
  slideContentHash: string;
  metric: PracticeTrendMetric;
}): PracticeTrendSeries {
  const reports = comparablePracticeReports(input.reports, input.slideContentHash);
  const points = reports.map((report, index) => ({
    reportId: report.reportId,
    practiceSessionId: report.practiceSessionId,
    createdAt: report.createdAt,
    dateLabel: practiceTrendDateLabel(report.createdAt, index + 1),
    value: metricValue(report, input.metric),
  }));
  const segments: Array<[number, number]> = [];
  for (let index = 1; index < points.length; index += 1) {
    if (points[index - 1]?.value !== null && points[index]?.value !== null) {
      segments.push([index - 1, index]);
    }
  }
  return {
    metric: input.metric,
    mode: points.length <= 1 ? "current" : points.length === 2 ? "comparison" : "trend",
    direction: trendDirection(points, input.metric),
    points,
    segments,
  };
}

export function practiceTrendDateLabel(createdAt: string, round: number) {
  const date = new Date(createdAt);
  return `${round}회차 (${date.getMonth() + 1}/${date.getDate()})`;
}

function metricValue(
  report: SlidePracticeReportRecord,
  metric: PracticeTrendMetric,
) {
  if (report.quality.state === "unmeasured") return null;
  if (metric === "fillerRate") {
    if (
      report.quality.state !== "measured"
      || report.quality.reasons.includes("stt-unavailable")
      || report.voice.activeSpeechMs < slidePracticeMetricTargets.activeSpeechMinimumMs
    ) {
      return null;
    }
    return report.fillers.totalCount / (report.voice.activeSpeechMs / 60_000);
  }
  if (metric === "pace") return report.voice.syllablesPerSecond;
  if (metric === "loudness") return report.voice.loudnessDb;
  return report.voice.pauseRatio * 100;
}

function trendDirection(
  points: readonly PracticeTrendPoint[],
  metric: PracticeTrendMetric,
): PracticeTrendDirection {
  const measured = points.filter(
    (point): point is PracticeTrendPoint & { value: number } => point.value !== null,
  );
  if (measured.length < 2) return "unavailable";
  const first = metricDistance(metric, measured[0]!.value);
  const latest = metricDistance(metric, measured.at(-1)!.value);
  if (Math.abs(latest - first) < 1e-9) return "unchanged";
  return latest < first ? "improved" : "declined";
}

function metricDistance(metric: PracticeTrendMetric, value: number) {
  if (metric === "fillerRate") return value;
  if (metric === "pace") {
    return distanceToTargetRange(value, slidePracticeMetricTargets.syllablesPerSecond);
  }
  if (metric === "loudness") {
    return distanceToTargetRange(value, slidePracticeMetricTargets.loudnessDb);
  }
  return distanceToTargetRange(value, {
    min: slidePracticeMetricTargets.pauseRatio.min * 100,
    max: slidePracticeMetricTargets.pauseRatio.max * 100,
  });
}
