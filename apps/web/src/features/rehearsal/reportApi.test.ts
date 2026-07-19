import type { RehearsalRunComparison } from "@orbit/shared";
import { describe, expect, it, vi } from "vitest";
import {
  fetchProjectRehearsalReportRuns,
  fetchProjectRehearsalSummary,
  fetchRehearsalRunComparison,
  fetchReportProjects,
} from "./reportApi";

describe("fetchRehearsalRunComparison", () => {
  it("requests the current rehearsal comparison with credentials", async () => {
    const comparison = comparisonFixture();
    const fetcher = vi.fn(async () => jsonResponse(comparison));

    await expect(
      fetchRehearsalRunComparison("project demo/1", "run current/1", fetcher),
    ).resolves.toEqual(comparison);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/projects/project%20demo%2F1/rehearsals/run%20current%2F1/comparison",
      { credentials: "include" },
    );
  });

  it("returns null for an unavailable or invalid comparison", async () => {
    await expect(
      fetchRehearsalRunComparison(
        "project_1",
        "run_1",
        async () => new Response("missing", { status: 404 }),
      ),
    ).resolves.toBeNull();
    await expect(
      fetchRehearsalRunComparison("project_1", "run_1", async () =>
        jsonResponse({ currentRunId: "run_1" }),
      ),
    ).resolves.toBeNull();
    await expect(
      fetchRehearsalRunComparison(
        "project_1",
        "run_1",
        async () => new Response("not-json", { status: 200 }),
      ),
    ).resolves.toBeNull();
  });

  it("서버 오류를 빈 리포트로 숨기지 않는다", async () => {
    const unavailable = async () => new Response("failed", { status: 500 });

    await expect(fetchReportProjects(unavailable)).rejects.toThrow("(500)");
    await expect(
      fetchProjectRehearsalSummary("project_1", unavailable),
    ).rejects.toThrow("(500)");
    await expect(
      fetchProjectRehearsalReportRuns("project_1", unavailable),
    ).rejects.toThrow("(500)");
    await expect(
      fetchRehearsalRunComparison("project_1", "run_1", unavailable),
    ).rejects.toThrow("(500)");
  });
});

describe("fetchProjectRehearsalSummary", () => {
  it("공통 계약으로 프로젝트 요약 응답을 검증한다", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        summary: {
          projectId: "project_1",
          runCount: 1,
          progressComment: null,
        },
      }),
    );

    await expect(
      fetchProjectRehearsalSummary("project_1", fetcher),
    ).resolves.toEqual({
      projectId: "project_1",
      runCount: 1,
      progressComment: null,
      runDurationSeries: [],
      slideAvgTimings: [],
      runMetricSeries: [],
      slidePerformanceSummaries: [],
    });
  });

  it("계약과 다른 요약 응답을 성공 데이터로 사용하지 않는다", async () => {
    await expect(
      fetchProjectRehearsalSummary("project_1", async () =>
        jsonResponse({ summary: { projectId: "project_1", runCount: -1 } }),
      ),
    ).rejects.toThrow();
  });
});

function comparisonFixture(): RehearsalRunComparison {
  return {
    currentRunId: "run current/1",
    previousRunId: "run_previous",
    silenceComparison: {
      state: "unavailable",
      metricDefinitionVersion: null,
      currentLongSilenceCount: null,
      previousLongSilenceCount: null,
      longSilenceCountDelta: null,
      currentTotalSilenceSeconds: null,
      previousTotalSilenceSeconds: null,
      totalSilenceSecondsDelta: null,
      reasonCode: "LEGACY_COMPARISON",
    },
    improved: [],
    repeated: [],
    newIssues: [],
    incomparable: [],
    briefing: [],
  };
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
