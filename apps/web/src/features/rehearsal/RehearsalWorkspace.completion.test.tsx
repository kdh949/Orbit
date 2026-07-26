import { createDemoDeck } from "@orbit/editor-core";
import { legacyRehearsalSlideSpeakingRate } from "@orbit/shared/coaching";
import {
  legacyRehearsalReportMetricsDefaults,
  legacyRehearsalSilenceAnalysis,
  legacyRehearsalVolumeAnalysis,
  type RehearsalReport,
  type RehearsalRun,
} from "@orbit/shared/rehearsals";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RehearsalReportDocument } from "../reports/RehearsalReportDocument";
import { resolveRehearsalReportLoadState } from "./api/rehearsalApi";
import {
  RehearsalReportPage,
  shouldLoadPracticeGoalSummary,
} from "./report/RehearsalReportPage";
import { RehearsalWorkspace } from "./RehearsalWorkspace";
import { shouldRenderRehearsalThumbnailImage } from "./rehearsalWorkspaceModel";
import {
  getRehearsalFinishPath,
  getRehearsalReportPath,
} from "./rehearsalRoutes";

const createdAt = "2026-06-29T00:00:00.000Z";

vi.mock("react-konva", () => {
  const Group = forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>,
  );
  const Stage = forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>,
  );
  const Text = ({ text }: { text?: string }) => <span>{text}</span>;

  return {
    Arrow: () => <span data-konva-arrow="true" />,
    Circle: () => <span data-konva-circle="true" />,
    Group,
    Image: () => <span data-konva-image="true" />,
    Layer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Line: () => <span data-konva-line="true" />,
    Rect: () => <span data-konva-rect="true" />,
    RegularPolygon: () => <span data-konva-polygon="true" />,
    Shape: () => <span data-konva-shape="true" />,
    Star: () => <span data-konva-star="true" />,
    Stage,
    Text,
  };
});

describe("RehearsalWorkspace completion and report", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps final report content out of the presenter workspace", () => {
    const deck = createDemoDeck();
    const html = renderToStaticMarkup(
      <RehearsalWorkspace initialDeck={deck} />,
    );

    expect(html).not.toContain("리허설 보고서");
    expect(html).not.toContain("120 wpm");
    expect(html).not.toContain("민감한 전사 원문");
  });

  it("renders the dedicated report page from official report data", () => {
    const deck = createDemoDeck();
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={deck}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({
          transcriptRetained: false,
          transcript: null,
        })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).toContain("1회차 리허설 리포트");
    expect(html).toContain("2026.06.29");
    expect(html).toContain("1분 30초");
    expect(html).toContain(String(deck.slides.length));
    expect(html).toContain("말버릇 총량");
    expect(html).toContain("긴 침묵");
    expect(html).toContain("긴 침묵 구간 분석");
    expect(html).toContain("음");
    expect(html).toContain("2회 · 100%");
    expect(html).toContain("놓친 핵심 메시지");
    expect(html).toContain("문제 신호");
    expect(html).toContain("습관어 2회");
    expect(html).toContain("개선 피드백");
    expect(html).toContain("참고 시간");
    expect(html).toContain("슬라이드별 소요 시간");
    expect(html).toContain("rrd-cumulative-chart");
    expect(html).toContain("1번 슬라이드");
    expect(html).toContain("rrd-timing-slide-option-times");
    expect(html).toContain("소요</small><strong>0분 52초");
    expect(html).toContain("권장</small><strong>1분 00초");
    expect(html).not.toContain("이번 시간");
    expect(html).not.toContain("계속 문제였던 장표");
    expect(html).not.toContain("종합 발표 점수");
    expect(html).not.toContain("/ 100");
    expect(html).not.toContain("속도 안정성");
    expect(html).not.toContain("전체 말버릇 중");
    expect(html).not.toContain("민감한 전사 원문");
    expect(html).not.toContain("dB");
  });

  it("formats filler-word deltas as counts in the summary change list", () => {
    const html = renderToStaticMarkup(
      <RehearsalReportDocument
        deck={createDemoDeck()}
        prevReports={[
          reportFixture({
            metrics: {
              ...legacyRehearsalReportMetricsDefaults,
              durationSeconds: 90,
              wordsPerMinute: 120,
              fillerWordCount: 0,
              longSilenceCount: 1,
              keywordCoverage: 0.75,
              keywordCoverageMeasurement: { state: "measured" },
            },
          }),
        ]}
        projectId="project-a"
        report={reportFixture({
          metrics: {
            ...legacyRehearsalReportMetricsDefaults,
            durationSeconds: 90,
            wordsPerMinute: 120,
            fillerWordCount: 18,
            longSilenceCount: 1,
            keywordCoverage: 0.75,
            keywordCoverageMeasurement: { state: "measured" },
          },
        })}
        run={runFixture("succeeded")}
        runNumber={2}
        totalRunCount={2}
      />,
    );

    expect(html).toContain("+18회");
    expect(html).not.toContain("18초회");
  });

  it("integrates slide priority sorting into the slide analysis viewer", () => {
    const baseDeck = createDemoDeck();
    const deck = {
      ...baseDeck,
      slides: Array.from({ length: 4 }, (_, index) => {
        const originalSlide = baseDeck.slides[index] ?? baseDeck.slides[0]!;
        return {
          ...originalSlide,
          slideId: `slide_${index + 1}`,
          order: index + 1,
          title: `${originalSlide.title} ${index + 1}`,
        };
      }),
    };
    const [slide1, slide2, slide3, slide4] = deck.slides;
    const html = renderToStaticMarkup(
      <RehearsalReportDocument
        deck={deck}
        prevReports={[
          reportFixture({
            slideTimings: [
              {
                slideId: slide1!.slideId,
                targetSeconds: 60,
                actualSeconds: 35,
              },
              {
                slideId: slide2!.slideId,
                targetSeconds: 60,
                actualSeconds: 66,
              },
              {
                slideId: slide3!.slideId,
                targetSeconds: 60,
                actualSeconds: 68,
              },
              {
                slideId: slide4!.slideId,
                targetSeconds: 60,
                actualSeconds: 72,
              },
            ],
            missedKeywords: [
              {
                slideId: slide2!.slideId,
                keywordId: "prev_kw_2",
                text: "동시 접근",
              },
              {
                slideId: slide3!.slideId,
                keywordId: "prev_kw_3",
                text: "세마포어",
              },
            ],
          }),
        ]}
        projectId="project-a"
        report={reportFixture({
          missedKeywords: [
            { slideId: slide1!.slideId, keywordId: "kw_1", text: "ORBIT" },
            {
              slideId: slide2!.slideId,
              keywordId: "kw_2",
              text: "Race Condition",
            },
          ],
          slideTimings: [
            { slideId: slide1!.slideId, targetSeconds: 60, actualSeconds: 52 },
            { slideId: slide2!.slideId, targetSeconds: 60, actualSeconds: 88 },
            { slideId: slide3!.slideId, targetSeconds: 60, actualSeconds: 43 },
            { slideId: slide4!.slideId, targetSeconds: 60, actualSeconds: 84 },
          ],
          slideInsights: [
            {
              slideId: slide1!.slideId,
              fillerWordCount: 2,
              longSilenceCount: 1,
              speakingRate: legacyRehearsalSlideSpeakingRate,
            },
            {
              slideId: slide2!.slideId,
              fillerWordCount: 1,
              longSilenceCount: 0,
              speakingRate: legacyRehearsalSlideSpeakingRate,
            },
            {
              slideId: slide3!.slideId,
              fillerWordCount: 0,
              longSilenceCount: 1,
              speakingRate: legacyRehearsalSlideSpeakingRate,
            },
            {
              slideId: slide4!.slideId,
              fillerWordCount: 3,
              longSilenceCount: 0,
              speakingRate: legacyRehearsalSlideSpeakingRate,
            },
          ],
        })}
        run={runFixture("succeeded")}
        runNumber={2}
        totalRunCount={2}
      />,
    );

    expect(html).toContain("슬라이드별 분석");
    expect(html).toContain("우선순위가 높은 장표부터 확인하세요.");
    expect(html).toContain("우선순위순");
    expect(html).toContain(slide1!.title);
    expect(html).toContain("개선 필요");
    expect(html).toContain("놓친 핵심 메시지");
    expect(html).toContain("참고 시간");
  });

  it("renders a report loading shell before report data is ready", () => {
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={createDemoDeck()}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).toContain("보고서를 불러오는 중입니다.");
    expect(html).toContain("report-loading-shell");
    expect(html).not.toContain("report-page-state");
  });

  it("renders retained transcript controls without exposing raw text by default", () => {
    const deck = createDemoDeck();
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={deck}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({
          transcriptRetained: true,
          transcript: "민감한 전사 원문",
          generatedAt: new Date().toISOString(),
        })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).toContain("발표 전사본");
    expect(html).toContain("DOCX 내려받기");
    expect(html).toContain("펼치기");
    expect(html).not.toContain("민감한 전사 원문");
  });

  it("hides the transcript controls after the 30-minute retention window", () => {
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={createDemoDeck()}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({
          transcriptRetained: true,
          transcript: "만료된 전사 원문",
          generatedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
        })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).not.toContain("발표 전사본");
    expect(html).not.toContain("DOCX 내려받기");
    expect(html).not.toContain("만료된 전사 원문");
  });

  it("calculates completion percent from official slide timings", () => {
    const deck = createDemoDeck();
    const completedSlide = deck.slides[0]!;
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={deck}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({
          slideTimings: [
            {
              slideId: completedSlide.slideId,
              targetSeconds: 60,
              actualSeconds: 52,
            },
          ],
        })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).toContain("슬라이드별 분석");
    expect(html).toContain("0분 52초");
  });

  it("does not describe an extreme speaking speed as stable", () => {
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={createDemoDeck()}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({
          metrics: {
            ...legacyRehearsalReportMetricsDefaults,
            durationSeconds: 0,
            wordsPerMinute: 3600,
            fillerWordCount: 0,
            longSilenceCount: null,
            keywordCoverage: 1,
            keywordCoverageMeasurement: { state: "measured" },
          },
        })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).toContain("전체 발표 시간");
    expect(html).not.toContain("3600");
  });

  it("does not infer missing keyword candidates from deck data", () => {
    const deck = createDemoDeck();
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={deck}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({
          missedKeywords: [],
          metrics: {
            ...legacyRehearsalReportMetricsDefaults,
            durationSeconds: 90,
            wordsPerMinute: 120,
            fillerWordCount: 0,
            longSilenceCount: null,
            keywordCoverage: 1,
            keywordCoverageMeasurement: { state: "measured" },
          },
        })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).not.toContain(
      "핵심 키워드 커버리지가 낮을 때만 누락 후보를 표시합니다.",
    );
  });

  it("groups official missing keywords by slide in a single row", () => {
    const deck = createDemoDeck();
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={deck}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({
          missedKeywords: [
            {
              slideId: deck.slides[0]!.slideId,
              keywordId: "kw_component",
              text: "컴포넌트",
            },
            {
              slideId: deck.slides[0]!.slideId,
              keywordId: "kw_design",
              text: "설계",
            },
            {
              slideId: deck.slides[0]!.slideId,
              keywordId: "kw_state",
              text: "상태관리",
            },
          ],
        })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).toContain("컴포넌트");
    expect(html).toContain("설계");
    expect(html).toContain("상태관리");
  });

  it("renders a dense official missing keyword list without dropping entries", () => {
    const missedKeywords = Array.from({ length: 24 }, (_, index) => ({
      slideId: `slide_${(index % 3) + 1}`,
      keywordId: `kw_dense_${index}`,
      text: `매우긴누락키워드${index}발표흐름핵심데이터`,
    }));
    const html = renderToStaticMarkup(
      <RehearsalReportPage
        initialDeck={createDemoDeck()}
        initialRun={runFixture("succeeded")}
        initialReport={reportFixture({ missedKeywords })}
        projectId="project-a"
        runId="run-1"
      />,
    );

    expect(html).toContain("매우긴누락키워드0발표흐름핵심데이터");
    expect(html).toContain("매우긴누락키워드21발표흐름핵심데이터");
    expect(html).toContain("놓친 핵심 메시지");
  });

  it("maps failed and mismatched report responses to failed page state", () => {
    expect(
      resolveRehearsalReportLoadState(
        {
          run: runFixture("failed", {
            error: { code: "REPORT_FAILED", message: "분석 실패" },
          }),
          report: null,
        },
        "project-a",
      ),
    ).toEqual({
      error: "분석 실패",
      status: "failed",
    });

    expect(
      resolveRehearsalReportLoadState(
        {
          run: runFixture("succeeded", { projectId: "project-b" }),
          report: reportFixture(),
        },
        "project-a",
      ),
    ).toEqual({
      error: "요청한 프로젝트와 리허설 실행 정보가 일치하지 않습니다.",
      status: "failed",
    });
  });

  it("loads practice goals for succeeded runs even when the report body is unavailable", () => {
    expect(shouldLoadPracticeGoalSummary(runFixture("succeeded"))).toBe(true);
    expect(shouldLoadPracticeGoalSummary(runFixture("failed"))).toBe(false);
    expect(shouldLoadPracticeGoalSummary(null)).toBe(false);
  });

  it("stops report progress when a succeeded run has no report job or body", () => {
    expect(
      resolveRehearsalReportLoadState(
        {
          run: runFixture("succeeded", { jobId: null }),
          report: null,
        },
        "project-a",
      ),
    ).toEqual({
      error: "",
      status: "unavailable",
    });
  });

  it("builds the dedicated report route for a completed rehearsal run", () => {
    expect(getRehearsalReportPath("project a", "run/1")).toBe(
      "/rehearsal/project%20a/report/run%2F1",
    );
  });

  it("opens the report only from finish when the run has succeeded", () => {
    expect(getRehearsalFinishPath("project-a", null)).toBe(
      "/project/project-a",
    );
    expect(getRehearsalFinishPath("project-a", runFixture("processing"))).toBe(
      "/rehearsal/project-a/report/run-1",
    );
    expect(getRehearsalFinishPath("project-a", runFixture("succeeded"))).toBe(
      "/rehearsal/project-a/report/run-1",
    );
  });

  it("falls back to slide labels when a thumbnail image has failed to load", () => {
    const failedThumbnailUrls = new Set(["/files/thumbnails/slide_1.png"]);

    expect(
      shouldRenderRehearsalThumbnailImage(
        "/files/thumbnails/slide_1.png",
        failedThumbnailUrls,
      ),
    ).toBe(false);
    expect(
      shouldRenderRehearsalThumbnailImage(
        "/files/thumbnails/slide_2.png",
        failedThumbnailUrls,
      ),
    ).toBe(true);
    expect(shouldRenderRehearsalThumbnailImage("", failedThumbnailUrls)).toBe(
      false,
    );
  });
});

function runFixture(
  status: RehearsalRun["status"],
  patch: Partial<RehearsalRun> = {},
): RehearsalRun {
  return {
    runId: "run-1",
    projectId: "project-a",
    deckId: "deck-a",
    audioFileId: null,
    jobId: null,
    deckVersion: null,
    evaluationSnapshot: null,
    semanticEvaluationMode: "full",
    status,
    error: null,
    rawAudioDeletedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...patch,
    analysisRevision: patch.analysisRevision ?? 0,
    analysisFinalizedAt: patch.analysisFinalizedAt ?? null,
  };
}

function reportFixture(patch: Partial<RehearsalReport> = {}): RehearsalReport {
  return {
    reportId: "report_run-1",
    runId: "run-1",
    projectId: "project-a",
    deckId: "deck-a",
    transcriptRetained: false,
    transcript: null,
    volumeAnalysis: legacyRehearsalVolumeAnalysis,
    silenceAnalysis: {
      ...legacyRehearsalSilenceAnalysis,
      measurementState: "measured",
      reasonCode: null,
      detectorVersion: "test-vad",
      analysisWindowStartSeconds: 0,
      analysisWindowEndSeconds: 90,
      totalSilenceSeconds: 2,
      silenceRatio: 0.0222,
      longSilenceCount: 1,
      detectedSegmentCount: 1,
      segments: [
        {
          category: "long",
          startSeconds: 12,
          endSeconds: 14,
          durationSeconds: 2,
        },
      ],
    },
    metrics: {
      ...legacyRehearsalReportMetricsDefaults,
      durationSeconds: 90,
      wordsPerMinute: 120,
      fillerWordCount: 2,
      longSilenceCount: 1,
      keywordCoverage: 0.75,
      measurements: {
        ...legacyRehearsalReportMetricsDefaults.measurements,
        longSilenceCount: {
          measurementState: "measured",
          metricDefinitionVersion: 1,
          reasonCode: null,
        },
      },
      keywordCoverageMeasurement: { state: "measured" },
    },
    speedSamples: [{ startSecond: 0, endSecond: 10, wordsPerMinute: 120 }],
    fillerWordDetails: [{ word: "음", count: 2 }],
    missedKeywords: [{ slideId: "slide_1", keywordId: "kw_1", text: "ORBIT" }],
    utteranceOutcomes: [],
    semanticCueDecisions: [],
    semanticEvaluation: {
      state: "unavailable",
      measurementMode: "none",
      reasons: ["evaluation_not_run"],
      retryable: false,
    },
    semanticCueOutcomes: [],
    slideTimings: [
      { slideId: "slide_1", targetSeconds: 60, actualSeconds: 52 },
    ],
    slideInsights: [
      {
        slideId: "slide_1",
        fillerWordCount: 2,
        longSilenceCount: 1,
        speakingRate: legacyRehearsalSlideSpeakingRate,
      },
    ],
    qnaSummary: {
      questionCount: 0,
      questionSummary: "",
      unclearTopics: [],
    },
    coaching: {
      status: "succeeded",
      summary: "핵심 메시지가 분명합니다.",
      strengths: ["키워드를 언급했습니다."],
      improvements: ["불필요한 filler를 줄이세요."],
      nextPracticeFocus: "도입부를 더 짧게 연습하세요.",
      message: "",
    },
    generatedAt: "2026-06-29T00:00:10.000Z",
    ...patch,
  };
}
