import type { SlidePracticeReportRecord } from "@orbit/shared/slide-practice";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PracticeHistoryContent } from "./SlidePracticeHistoryPanel";
import { listSlidePracticeReports } from "./slidePracticeApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PracticeHistoryContent", () => {
  it("같은 슬라이드 내용의 기록은 성장 추세로, 최신 기록은 접힌 상세로 렌더링한다", () => {
    const reports = [practiceReport(0), practiceReport(1)];
    const html = renderToStaticMarkup(
      <PracticeHistoryContent
        comparableReports={reports}
        latestReport={reports[1]!}
        slideContentHash={currentHash}
      />,
    );

    expect(html).toContain("최근 5회 성장 추세");
    expect(html).toContain("2회 비교");
    expect(html).toContain("이번 회차 상세");
    expect(html).toContain("기록 1의 AI 코칭");
    expect(html).not.toContain("이전 슬라이드 내용으로 연습한 기록");
  });

  it("최신 기록의 내용 해시가 다르면 상세에 이전 내용 안내를 남긴다", () => {
    const latestReport = { ...practiceReport(0), slideContentHash: "b".repeat(64) };
    const html = renderToStaticMarkup(
      <PracticeHistoryContent
        comparableReports={[]}
        latestReport={latestReport}
        slideContentHash={currentHash}
      />,
    );

    expect(html).toContain("이전 슬라이드 내용으로 연습한 기록");
    expect(html).toContain("이 내용으로 연습한 기록이 아직 없습니다.");
  });

  it("DB 저장 기록을 최신 1개로 제한해 요청한다", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      reports: [],
      nextCursor: null,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await listSlidePracticeReports({
      projectId: "project-1",
      deckId: "deck-1",
      slideId: "slide-1",
      limit: 1,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/slide-practice-reports?deckId=deck-1&slideId=slide-1&limit=1",
      { credentials: "include" },
    );
  });

  it("동일 내용 기록 조회에는 내용 해시를 쿼리에 포함한다", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      reports: [],
      nextCursor: null,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await listSlidePracticeReports({
      projectId: "project-1",
      deckId: "deck-1",
      slideId: "slide-1",
      slideContentHash: currentHash,
      limit: 5,
    });

    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/projects/project-1/slide-practice-reports?deckId=deck-1&slideId=slide-1&slideContentHash=${currentHash}&limit=5`,
      { credentials: "include" },
    );
  });
});

const currentHash = "a".repeat(64);

function practiceReport(index: number): SlidePracticeReportRecord {
  return {
    reportVersion: 3,
    metricDefinitionVersion: 3,
    contentHashVersion: "slide-text-v1",
    slideContentHash: currentHash,
    classifierVersion: 4,
    reportId: `report-${index}`,
    practiceSessionId: `practice-${index}`,
    projectId: "project-1",
    deckId: "deck-1",
    deckVersion: 1,
    slideId: "slide-1",
    slideOrder: 0,
    startedAt: `2026-07-17T00:0${index}:00.000Z`,
    durationMs: 10_000,
    syllableCount: 50,
    meanRecognitionConfidence: 0.9,
    fillers: {
      policyVersion: 1,
      totalCount: index + 1,
      details: [{ word: "음", count: index + 1 }],
    },
    voice: {
      activeSpeechMs: 8_000,
      pauseRatio: 0.2,
      pitchMedianHz: 120,
      pitchSpanHz: 34.3,
      pitchValidRatio: 0.9,
      loudnessDb: -20,
      loudnessMadDb: 2,
      syllablesPerSecond: 4.5,
      signalToNoiseDb: 18,
      breathinessRatio: 0.1,
      clarityRatio: 0.9,
      rhythmRegularity: 0.8,
      clippingRatio: 0,
    },
    style: {
      mode: "neutral",
      confidence: 0.8,
      evidenceLabels: ["안정적인 속도"],
      message: `기록 ${index}의 목소리 스타일`,
    },
    quality: { state: "measured", reasons: [] },
    coaching: {
      status: "unavailable",
      summary: `기록 ${index}의 AI 코칭`,
      issueCodes: [],
      items: [],
      practicePlan: null,
      model: null,
      policyVersion: 1,
      promptVersion: 1,
      generatedAt: null,
    },
    source: {
      kind: "browser",
      sttEngine: "web-speech",
      deviceIdHash: null,
      baselineVersion: null,
    },
    createdBy: "user-1",
    createdAt: `2026-07-17T00:0${index}:10.000Z`,
    expiresAt: "2026-10-15T00:00:00.000Z",
  };
}
