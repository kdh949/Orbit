import type { RehearsalProjectSummary } from "@orbit/shared";
import { describe, expect, it } from "vitest";
import {
  buildRehearsalProjectSummaryDashboardModel,
  formatDuration,
} from "./rehearsalProjectSummaryModel";

describe("buildRehearsalProjectSummaryDashboardModel", () => {
  it("최신 회차 KPI와 직전 회차 변화량을 계산한다", () => {
    const model = buildRehearsalProjectSummaryDashboardModel(
      summaryFixture(),
      null,
    );

    expect(model?.kpis).toEqual([
      expect.objectContaining({
        key: "duration",
        value: "8:42",
        comparisonLabel: "권장",
        comparisonValue: "8:00",
        deltaLabel: "+0:42 초과",
        state: "negative",
      }),
      expect.objectContaining({
        key: "silence",
        value: "2회",
        comparisonLabel: "직전",
        comparisonValue: "3회",
        deltaLabel: "1회 감소",
        state: "positive",
      }),
      expect.objectContaining({
        key: "keyword-coverage",
        value: "7/8 전달",
        comparisonLabel: "직전",
        comparisonValue: "6/8 전달",
        deltaLabel: "+13%p 개선",
        state: "positive",
      }),
      expect.objectContaining({
        key: "timing-overrun",
        value: "2/8장",
        comparisonLabel: "직전",
        comparisonValue: "3/8장",
        deltaLabel: "1장 감소",
        state: "positive",
      }),
    ]);
  });

  it("미측정 값을 0으로 바꾸지 않고 N/A로 유지한다", () => {
    const summary = summaryFixture();
    summary.runMetricSeries[1] = {
      ...summary.runMetricSeries[1],
      duration: {
        measurementState: "unmeasured",
        reasonCode: "DURATION_UNMEASURED",
        actualSeconds: null,
        targetSeconds: 480,
      },
      longSilence: {
        measurementState: "unmeasured",
        reasonCode: "SILENCE_UNMEASURED",
        count: null,
        metricDefinitionVersion: 2,
      },
    };

    const model = buildRehearsalProjectSummaryDashboardModel(summary, null);

    expect(model?.kpis[0]).toEqual(
      expect.objectContaining({
        value: "N/A",
        comparisonValue: null,
        detail: "발표 시간 미측정",
      }),
    );
    expect(model?.kpis[1]).toEqual(
      expect.objectContaining({ value: "N/A", detail: "침묵 구간 미측정" }),
    );
    expect(model?.durationSeries).toHaveLength(1);
  });

  it("비교 이슈가 없어도 슬라이드 자체 지표로 점검 상태를 표시한다", () => {
    const model = buildRehearsalProjectSummaryDashboardModel(
      summaryFixture(),
      null,
    );

    expect(model?.slideRows[0]).toEqual(
      expect.objectContaining({ status: "개선 필요", statusTone: "danger" }),
    );
  });

  it("두 누적 지표가 모두 미측정이고 비교 이슈가 없으면 측정 불가로 표시한다", () => {
    const summary = summaryFixture();
    summary.slidePerformanceSummaries[0] = {
      ...summary.slidePerformanceSummaries[0],
      timingOverrun: {
        measurementState: "unmeasured",
        reasonCode: "SLIDE_TIMINGS_UNAVAILABLE",
        overrunCount: 0,
        measurableCount: 0,
        rate: null,
      },
      keywordCoverage: {
        measurementState: "unmeasured",
        reasonCode: "NO_MEASURABLE_KEYWORDS",
        matchedCount: 0,
        missedCount: 0,
        measurableCount: 0,
        rate: null,
      },
    };

    const model = buildRehearsalProjectSummaryDashboardModel(summary, null);

    expect(model?.slideRows[0]).toEqual(
      expect.objectContaining({ status: "측정 불가", statusTone: "neutral" }),
    );
  });

  it("긴 침묵 추이는 최신 측정 기준과 같은 버전만 연결한다", () => {
    const summary = summaryFixture();
    summary.runMetricSeries[0].longSilence = {
      ...summary.runMetricSeries[0].longSilence,
      metricDefinitionVersion: 1,
    };

    const model = buildRehearsalProjectSummaryDashboardModel(summary, null);

    expect(model?.metricSeries.longSilence).toEqual([
      { label: "2회차", value: 2 },
    ]);
  });

  it("Deck 변경으로 키워드 분모가 달라도 전달률 차이를 비교한다", () => {
    const summary = summaryFixture();
    summary.runMetricSeries[0]!.keywordCoverage = {
      measurementState: "measured",
      reasonCode: null,
      matchedCount: 1,
      missedCount: 38,
      measurableCount: 39,
      rate: 0.0256,
    };
    summary.runMetricSeries[1]!.keywordCoverage = {
      measurementState: "measured",
      reasonCode: null,
      matchedCount: 3,
      missedCount: 39,
      measurableCount: 42,
      rate: 0.0714,
    };

    const model = buildRehearsalProjectSummaryDashboardModel(summary, null);

    expect(model?.kpis[2]).toEqual(
      expect.objectContaining({
        value: "3/42 전달",
        comparisonValue: "1/39 전달",
        detail: "7%",
        deltaLabel: "+5%p 개선",
        state: "positive",
      }),
    );
  });
});

describe("formatDuration", () => {
  it("분과 초를 발표 시간 형식으로 표시한다", () => {
    expect(formatDuration(522)).toBe("8:42");
    expect(formatDuration(42)).toBe("42초");
  });
});

function summaryFixture(): RehearsalProjectSummary {
  return {
    projectId: "project_1",
    runCount: 2,
    progressComment: "발표 시간이 안정되고 있어요.",
    runDurationSeries: [],
    slideAvgTimings: [],
    runMetricSeries: [
      {
        runId: "run_1",
        createdAt: "2026-07-18T00:00:00.000Z",
        duration: {
          measurementState: "measured",
          reasonCode: null,
          actualSeconds: 540,
          targetSeconds: 480,
        },
        longSilence: {
          measurementState: "measured",
          reasonCode: null,
          count: 3,
          metricDefinitionVersion: 2,
        },
        coreMessageCoverage: {
          measurementState: "measured",
          reasonCode: null,
          coveredCount: 6,
          partialCount: 1,
          missedCount: 1,
          measurableCount: 8,
          rate: 0.75,
        },
        keywordCoverage: {
          measurementState: "measured",
          reasonCode: null,
          matchedCount: 6,
          missedCount: 2,
          measurableCount: 8,
          rate: 0.75,
        },
        timingOverrun: {
          measurementState: "measured",
          reasonCode: null,
          overrunCount: 3,
          measurableCount: 8,
          rate: 0.375,
        },
      },
      {
        runId: "run_2",
        createdAt: "2026-07-19T00:00:00.000Z",
        duration: {
          measurementState: "measured",
          reasonCode: null,
          actualSeconds: 522,
          targetSeconds: 480,
        },
        longSilence: {
          measurementState: "measured",
          reasonCode: null,
          count: 2,
          metricDefinitionVersion: 2,
        },
        coreMessageCoverage: {
          measurementState: "measured",
          reasonCode: null,
          coveredCount: 7,
          partialCount: 0,
          missedCount: 1,
          measurableCount: 8,
          rate: 0.875,
        },
        keywordCoverage: {
          measurementState: "measured",
          reasonCode: null,
          matchedCount: 7,
          missedCount: 1,
          measurableCount: 8,
          rate: 0.875,
        },
        timingOverrun: {
          measurementState: "measured",
          reasonCode: null,
          overrunCount: 2,
          measurableCount: 8,
          rate: 0.25,
        },
      },
    ],
    slidePerformanceSummaries: [
      {
        slideId: "slide_1",
        order: 1,
        title: "문제 정의",
        thumbnailUrl: "https://example.com/slide-1.png",
        avgActualSeconds: 72,
        targetSeconds: 60,
        sampleCount: 2,
        timingOverrun: {
          measurementState: "measured",
          reasonCode: null,
          overrunCount: 1,
          measurableCount: 2,
          rate: 0.5,
        },
        coreMessageCoverage: {
          measurementState: "measured",
          reasonCode: null,
          coveredCount: 1,
          partialCount: 0,
          missedCount: 1,
          measurableCount: 2,
          rate: 0.5,
        },
        keywordCoverage: {
          measurementState: "measured",
          reasonCode: null,
          matchedCount: 1,
          missedCount: 1,
          measurableCount: 2,
          rate: 0.5,
        },
        repeatedMissedKeywordCount: 0,
      },
    ],
  };
}
