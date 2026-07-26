import type { SlidePracticeReportRecord } from "@orbit/shared/slide-practice";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  nextPracticeTrendMetric,
  PracticeTrendDashboard,
} from "./PracticeTrendDashboard";

const currentHash = "a".repeat(64);
type PracticeReportV3Record = Extract<SlidePracticeReportRecord, { reportVersion: 3 }>;

describe("PracticeTrendDashboard", () => {
  it("실제 단위의 지표와 측정된 0을 렌더링한다", () => {
    const html = renderToStaticMarkup(
      <PracticeTrendDashboard
        reports={[report(2, { fillerCount: 0 }), report(1, { fillerCount: 2 })]}
        slideContentHash={currentHash}
      />,
    );

    expect(html).toContain("최근 5회 성장 추세");
    expect(html).toContain("2회 비교");
    expect(html).toContain("0.0회/분");
    expect(html).toContain("4.2음절/초 · 적정");
    expect(html).toContain("-36dBFS · 적정");
    expect(html).toContain("2.4dB · 안정");
    expect(html).toContain('aria-label="4.2 음절/초"');
    expect(html).toContain('aria-label="-36 dBFS"');
    expect(html).toContain('aria-label="2.4 dB"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
  });

  it("측정 불가 회차를 선으로 보간하지 않고 명시한다", () => {
    const html = renderToStaticMarkup(
      <PracticeTrendDashboard
        reports={[
          report(3, { fillerCount: 0 }),
          report(2, { qualityState: "unmeasured" }),
          report(1, { fillerCount: 2 }),
        ]}
        slideContentHash={currentHash}
      />,
    );

    expect(html).toContain("측정 불가");
    expect((html.match(/editor-practice-trend-line/g) ?? [])).toHaveLength(0);
  });

  it("최신 회차가 unmeasured이면 원시 지표 값도 성공 값으로 표시하지 않는다", () => {
    const html = renderToStaticMarkup(
      <PracticeTrendDashboard
        reports={[report(1, { qualityState: "unmeasured" })]}
        slideContentHash={currentHash}
      />,
    );

    expect(html).not.toContain("4.2음절/초");
    expect(html).not.toContain("-36dBFS");
    expect(html).not.toContain("2.4dB");
    expect((html.match(/>측정 불가</g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain("습관어 사용 없음");
  });

  it("방향키와 Home/End 키로 지표 탭을 순환한다", () => {
    expect(nextPracticeTrendMetric("fillerRate", "ArrowLeft")).toBe("pauseRatio");
    expect(nextPracticeTrendMetric("fillerRate", "ArrowRight")).toBe("pace");
    expect(nextPracticeTrendMetric("pace", "Home")).toBe("fillerRate");
    expect(nextPracticeTrendMetric("pace", "End")).toBe("pauseRatio");
    expect(nextPracticeTrendMetric("pace", "Enter")).toBeNull();
  });
});

function report(
  index: number,
  options: {
    fillerCount?: number;
    qualityState?: "measured" | "unmeasured";
  } = {},
): PracticeReportV3Record {
  const fillerCount = options.fillerCount ?? index;
  return {
    reportVersion: 3,
    metricDefinitionVersion: 3,
    contentHashVersion: "slide-text-v1",
    slideContentHash: currentHash,
    classifierVersion: 4,
    reportId: `report-${index}`,
    createdBy: "user-1",
    createdAt: `2026-07-${String(20 + index).padStart(2, "0")}T12:00:00.000Z`,
    expiresAt: "2026-10-19T12:00:00.000Z",
    practiceSessionId: `practice-${index}`,
    projectId: "project-1",
    deckId: "deck-1",
    deckVersion: index,
    slideId: "slide-1",
    slideOrder: 1,
    startedAt: `2026-07-${String(20 + index).padStart(2, "0")}T11:59:00.000Z`,
    durationMs: 60_000,
    syllableCount: 100,
    meanRecognitionConfidence: 0.9,
    fillers: {
      policyVersion: 1,
      totalCount: fillerCount,
      details: fillerCount === 0 ? [] : [{ word: "음", count: fillerCount }],
    },
    voice: {
      activeSpeechMs: 60_000,
      pauseRatio: 0.2,
      pitchMedianHz: 170,
      pitchSpanHz: 80,
      pitchValidRatio: 0.8,
      loudnessDb: -36,
      loudnessMadDb: 2.4,
      syllablesPerSecond: 4.2,
      signalToNoiseDb: 20,
      breathinessRatio: 0.2,
      clarityRatio: 0.8,
      rhythmRegularity: 0.7,
      clippingRatio: 0,
    },
    style: {
      mode: "neutral",
      confidence: 0,
      evidenceLabels: ["판단 보류"],
      message: "판단을 보류했습니다.",
    },
    quality: options.qualityState === "unmeasured"
      ? { state: "unmeasured", reasons: ["insufficient-speech"] }
      : { state: "measured", reasons: [] },
    source: {
      kind: "server",
      sttEngine: "report-stt",
      deviceIdHash: null,
      baselineVersion: null,
    },
  };
}
