import { describe, expect, it } from "vitest";

import { rehearsalProjectSummarySchema } from "./project-summary-contracts";

describe("rehearsalProjectSummarySchema", () => {
  it("accepts measured project trends and slide performance summaries", () => {
    const summary = rehearsalProjectSummarySchema.parse({
      projectId: "project_demo_1",
      runCount: 2,
      runMetricSeries: [
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
            metricDefinitionVersion: 1,
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
          thumbnailUrl: "/api/v1/projects/project_demo_1/assets/file_1/content",
          avgActualSeconds: 48,
          targetSeconds: 45,
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
            partialCount: 1,
            missedCount: 0,
            measurableCount: 2,
            rate: 0.5,
          },
          keywordCoverage: {
            measurementState: "measured",
            reasonCode: null,
            matchedCount: 7,
            missedCount: 1,
            measurableCount: 8,
            rate: 0.875,
          },
          repeatedMissedKeywordCount: 1,
        },
      ],
      progressComment: null,
    });

    expect(summary.runMetricSeries[0]?.coreMessageCoverage.rate).toBe(0.875);
    expect(summary.runMetricSeries[0]?.keywordCoverage.rate).toBe(0.875);
    expect(
      summary.slidePerformanceSummaries[0]?.repeatedMissedKeywordCount,
    ).toBe(1);
    expect(summary.slidePerformanceSummaries[0]?.sampleCount).toBe(2);
  });

  it("requires null values for unmeasured project metrics", () => {
    const invalidSummary = rehearsalProjectSummarySchema.safeParse({
      projectId: "project_demo_1",
      runCount: 1,
      runMetricSeries: [
        {
          runId: "run_1",
          createdAt: "2026-07-19T00:00:00.000Z",
          duration: {
            measurementState: "unmeasured",
            reasonCode: "DURATION_UNMEASURED",
            actualSeconds: 0,
            targetSeconds: null,
          },
          longSilence: {
            measurementState: "unmeasured",
            reasonCode: "SILENCE_UNMEASURED",
            count: null,
            metricDefinitionVersion: null,
          },
          coreMessageCoverage: {
            measurementState: "unmeasured",
            reasonCode: "SEMANTIC_EVALUATION_UNAVAILABLE",
            coveredCount: 0,
            partialCount: 0,
            missedCount: 0,
            measurableCount: 0,
            rate: null,
          },
          keywordCoverage: {
            measurementState: "unmeasured",
            reasonCode: "KEYWORD_COVERAGE_UNMEASURED",
            matchedCount: 0,
            missedCount: 0,
            measurableCount: 0,
            rate: null,
          },
          timingOverrun: {
            measurementState: "unmeasured",
            reasonCode: "SLIDE_TIMINGS_UNAVAILABLE",
            overrunCount: 0,
            measurableCount: 0,
            rate: null,
          },
        },
      ],
      progressComment: null,
    });

    expect(invalidSummary.success).toBe(false);
  });
});
