import type { TestMetricTone } from "./rehearsalReportTestViewModel";

export const REHEARSAL_TIMING_TOLERANCE_RATIO = 0.2;

export type RehearsalTimingAssessment = {
  label: string;
  tone: TestMetricTone;
};

export function buildRehearsalTimingAssessment(
  actualSeconds: number | null,
  targetSeconds: number | null,
  formatDuration: (seconds: number) => string,
): RehearsalTimingAssessment {
  if (
    actualSeconds == null ||
    targetSeconds == null ||
    !Number.isFinite(actualSeconds) ||
    !Number.isFinite(targetSeconds) ||
    targetSeconds <= 0
  ) {
    return { label: "시간 정보 없음", tone: "muted" };
  }

  const deltaSeconds = actualSeconds - targetSeconds;
  const differenceRatio = Math.abs(deltaSeconds) / targetSeconds;

  if (differenceRatio <= REHEARSAL_TIMING_TOLERANCE_RATIO) {
    return { label: "적절", tone: "success" };
  }

  return deltaSeconds < 0
    ? {
        label: `권장보다 ${formatDuration(Math.abs(deltaSeconds))} 짧음`,
        tone: "warning",
      }
    : {
        label: `권장보다 ${formatDuration(deltaSeconds)} 김`,
        tone: "warning",
      };
}
