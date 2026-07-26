import {
  createRehearsalEvaluationSnapshot,
  deckSchema,
  legacyRehearsalReportMetricsDefaults,
  legacyRehearsalSilenceAnalysis,
  legacyRehearsalVolumeAnalysis,
  type Deck,
  type RehearsalReport,
} from "@orbit/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  fetchRehearsalDownload,
  ReportDetailFrame,
  RehearsalReportDocument,
} from "./RehearsalReportDocument";

describe("RehearsalReportDocument", () => {
  it("shares the same report detail frame with actual-presentation reports", () => {
    const html = renderToStaticMarkup(
      <ReportDetailFrame
        actions={<button type="button">다시 발표</button>}
        date="2026. 7. 20."
        statusLabel="분석 완료"
        title="1회차 실전 발표 리포트"
      >
        <section className="rrd-card">청중 응답 결과</section>
      </ReportDetailFrame>,
    );

    expect(html).toContain('class="rrd-root"');
    expect(html).toContain('class="rrd-hero"');
    expect(html).toContain("1회차 실전 발표 리포트");
    expect(html).toContain("청중 응답 결과");
    expect(html).toContain("다시 발표");
  });

  it("opens the test report directly without analysis tab controls", () => {
    const html = renderToStaticMarkup(
      <RehearsalReportDocument
        deck={deck}
        practiceGoalSummary={
          <section className="practice-report-summary">
            priority practice goals
          </section>
        }
        prevReports={[]}
        projectId="project_a"
        report={reportFixture()}
        run={null}
        runNumber={9}
        totalRunCount={9}
      />,
    );

    expect(html).not.toContain("rrd-analysis-tabs");
    expect(html).not.toContain('role="tablist"');
    expect(html).toMatch(/id="rrd-panel-overview"[^>]*hidden=""/);
    expect(html).toMatch(/id="rrd-panel-slides"[^>]*hidden=""/);
    expect(html).toMatch(/id="rrd-panel-test"[^>]*class="rrd-report-panel"/);
    expect(html).not.toMatch(/id="rrd-panel-test"[^>]*hidden=""/);
    expect(html).toContain("슬라이드 상세 리포트 테스트");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("전체 발표 핵심 요약");
    expect(html).toContain("자료 내려받기");
    expect(html.indexOf("전체 리허설 리포트")).toBeLessThan(
      html.indexOf("자료 내려받기"),
    );
    expect(html.indexOf("자료 내려받기")).toBeLessThan(
      html.indexOf("다시 리허설"),
    );
  });

  it("requests a private rehearsal artifact download", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("전체 transcript", {
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
    );

    const result = await fetchRehearsalDownload("run/1", "transcript", fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/rehearsals/run%2F1/downloads/transcript",
    );
    expect(result.fileName).toBe("transcript.txt");
    expect(await result.blob.text()).toBe("전체 transcript");
  });
  it("groups utterance outcomes and renders presenter-facing semantic outcomes", () => {
    const html = renderToStaticMarkup(
      <RehearsalReportDocument
        deck={deck}
        prevReports={[]}
        projectId="project_a"
        report={reportFixture({
          utteranceOutcomes: [
            { slideId: "slide_1", kind: "covered", sentenceId: "sentence_1" },
            {
              slideId: "slide_1",
              kind: "paraphrased",
              sentenceId: "sentence_2",
              similarity: 0.93,
            },
            {
              slideId: "slide_1",
              kind: "ad-lib",
              text: "고객 사례를 하나 더 설명했습니다.",
              sentenceId: "sentence_2",
              similarity: 0.87,
            },
            { slideId: "slide_2", kind: "missed", sentenceId: "sentence_1" },
          ],
          semanticCueDecisions: [
            {
              slideId: "slide_1",
              cueId: "scue_intro_1",
              label: "covered",
              measurementMode: "full",
              finalScore: 0.82,
              matchedBy: "nli",
              fallbackUsed: false,
              entailmentScore: 0.91,
              premise: "보고서에 그대로 노출하지 않을 전사 근거",
              hypothesis: "보고서에 그대로 노출하지 않을 가설",
              provider: "browser-transformersjs",
              modelId: "model",
              reasonCodes: ["nli-entailment", "concept-coverage"],
            },
          ],
          semanticEvaluation: {
            state: "partial",
            measurementMode: "full",
            reasons: ["timeout"],
            retryable: true,
          },
          semanticCueOutcomes: [
            semanticOutcome({ cueId: "cue-covered", status: "covered" }),
            semanticOutcome({
              cueId: "cue-partial",
              reportLabelSnapshot: "비용 절감 효과",
              status: "partial",
              coveredConcepts: ["반복 업무 감소"],
              missingConcepts: ["비용 절감"],
              evidence: {
                excerpt: "반복 업무를 줄였습니다.",
                startMs: 100,
                endMs: 900,
              },
            }),
            semanticOutcome({
              cueId: "cue-missed",
              reportLabelSnapshot: "고객 가치",
              status: "missed",
              coveredConcepts: [],
              missingConcepts: ["고객 시간 절약"],
            }),
            semanticOutcome({
              cueId: "cue-unmeasured",
              measurementMode: "none",
              reportLabelSnapshot: "시장 근거",
              status: "unmeasured",
              unmeasuredReason: "timeout",
              coveredConcepts: [],
              missingConcepts: [],
            }),
            semanticOutcome({
              cueId: "cue-excluded",
              measurementMode: "none",
              reportLabelSnapshot: "이전 Cue",
              status: "excluded",
              coveredConcepts: [],
              missingConcepts: [],
            }),
          ],
        })}
        run={{
          runId: "run_1",
          projectId: "project_a",
          deckId: "deck_a",
          jobId: null,
          audioFileId: null,
          deckVersion: null,
          evaluationSnapshot: null,
          semanticEvaluationMode: "full",
          analysisRevision: 1,
          analysisFinalizedAt: "2026-07-03T00:00:00.000Z",
          rawAudioDeletedAt: null,
          status: "succeeded",
          error: null,
          createdAt: "2026-07-03T00:00:00.000Z",
          updatedAt: "2026-07-03T00:00:00.000Z",
        }}
        runNumber={1}
        semanticRetryState={{ status: "idle" }}
        totalRunCount={1}
        onSemanticRetry={() => undefined}
      />,
    );

    expect(html).not.toContain("AI 총평");
    expect(html).toContain("말버릇");
    expect(html).toContain("긴 침묵 구간 분석");
    expect(html).toContain("소요 시간 분석");
    expect(html).not.toContain("의미 전달 리포트");
    expect(html).not.toContain("발화 커버리지");
    expect(html.indexOf("긴 침묵 구간 분석")).toBeLessThan(
      html.indexOf("슬라이드별 소요 시간"),
    );
    expect(html).not.toContain("Semantic cue evidence");
    expect(html).not.toContain("scue_intro_1");
    expect(html).not.toContain("nli-entailment");
    expect(html).not.toContain("보고서에 그대로 노출하지 않을 전사 근거");
    expect(html).not.toContain("보고서에 그대로 노출하지 않을 가설");
  });

  it("does not render removed semantic or keyword coverage content", () => {
    const html = renderToStaticMarkup(
      <RehearsalReportDocument
        deck={deck}
        prevReports={[]}
        projectId="project_a"
        report={reportFixture({
          metrics: {
            ...reportFixture().metrics,
            keywordCoverage: 0,
            keywordCoverageMeasurement: {
              state: "unmeasured",
              reason: "no-keywords",
            },
          },
          semanticEvaluation: {
            state: "succeeded",
            measurementMode: "basic",
            reasons: [],
            retryable: false,
          },
          semanticCueOutcomes: [
            semanticOutcome({
              measurementMode: "basic",
              status: "covered",
            }),
          ],
        })}
        run={null}
        runNumber={1}
        semanticRetryState={{ status: "idle" }}
        totalRunCount={1}
      />,
    );

    expect(html).not.toContain("기본 의미 체크");
    expect(html).not.toContain("N/A");
    expect(html).not.toContain("키워드 커버리지");
  });

  it("summarizes measured slide speaking pace on the initial overall view", () => {
    const html = renderToStaticMarkup(
      <RehearsalReportDocument
        deck={deck}
        prevReports={[]}
        projectId="project_a"
        report={reportFixture({
          slideTimings: [
            { slideId: "slide_1", targetSeconds: 60, actualSeconds: 52 },
            { slideId: "slide_2", targetSeconds: 45, actualSeconds: 38 },
          ],
          slideInsights: [
            {
              slideId: "slide_1",
              fillerWordCount: 0,
              longSilenceCount: null,
              speakingRate: {
                metricDefinitionVersion: 1,
                measurementState: "measured",
                reasonCode: null,
                charactersPerSecond: 3.1,
                baselineCharactersPerSecond: 4,
                relativeRateRatio: 0.775,
                paceCategory: "slower",
                activeSpeechSeconds: 10,
                characterCount: 31,
              },
            },
            {
              slideId: "slide_2",
              fillerWordCount: 0,
              longSilenceCount: null,
              speakingRate: {
                metricDefinitionVersion: 1,
                measurementState: "unmeasured",
                reasonCode: "INSUFFICIENT_SLIDE_SPEECH",
                charactersPerSecond: null,
                baselineCharactersPerSecond: null,
                relativeRateRatio: null,
                paceCategory: null,
                activeSpeechSeconds: 2.5,
                characterCount: 8,
              },
            },
          ],
        })}
        run={null}
        runNumber={1}
        totalRunCount={1}
      />,
    );

    expect(html).toContain(
      "분석된 1개 슬라이드 중 빠른 구간 0개, 느린 구간 1개가 확인됐습니다.",
    );
    expect(html).not.toContain("분석할 발화가 부족해요");
    expect(html).not.toMatch(/WPM|CPM|CPS/);
  });

  it("includes every measured slide in the initial overall pace summary", () => {
    const measuredRate = {
      metricDefinitionVersion: 1 as const,
      measurementState: "measured" as const,
      reasonCode: null,
      baselineCharactersPerSecond: 4,
      activeSpeechSeconds: 10,
      characterCount: 40,
    };
    const html = renderToStaticMarkup(
      <RehearsalReportDocument
        deck={deck}
        prevReports={[]}
        projectId="project_a"
        report={reportFixture({
          slideTimings: [
            { slideId: "slide_1", targetSeconds: 60, actualSeconds: 52 },
            { slideId: "slide_2", targetSeconds: 45, actualSeconds: 38 },
          ],
          slideInsights: [
            {
              slideId: "slide_1",
              fillerWordCount: 0,
              longSilenceCount: null,
              speakingRate: {
                ...measuredRate,
                charactersPerSecond: 4,
                relativeRateRatio: 1,
                paceCategory: "similar",
              },
            },
            {
              slideId: "slide_2",
              fillerWordCount: 0,
              longSilenceCount: null,
              speakingRate: {
                ...measuredRate,
                charactersPerSecond: 5,
                relativeRateRatio: 1.25,
                paceCategory: "faster",
              },
            },
          ],
        })}
        run={null}
        runNumber={1}
        totalRunCount={1}
      />,
    );

    expect(html).toContain(
      "분석된 2개 슬라이드 중 빠른 구간 1개, 느린 구간 0개가 확인됐습니다.",
    );
  });

  it("does not render removed semantic retry content in the report", () => {
    const html = renderToStaticMarkup(
      <RehearsalReportDocument
        deck={deck}
        prevReports={[]}
        projectId="project_a"
        report={reportFixture({
          semanticEvaluation: {
            state: "unavailable",
            measurementMode: "none",
            reasons: ["server_evaluation_failed"],
            retryable: true,
          },
          semanticCueOutcomes: [
            semanticOutcome({
              measurementMode: "none",
              status: "unmeasured",
              unmeasuredReason: "server_evaluation_failed",
              coveredConcepts: [],
              missingConcepts: [],
            }),
          ],
        })}
        run={null}
        runNumber={1}
        semanticRetryState={{
          message: "서버 재평가를 완료하지 못했습니다.",
          status: "failed",
        }}
        totalRunCount={1}
        onSemanticRetry={() => undefined}
      />,
    );

    expect(html).not.toContain("시스템 상태 안내");
    expect(html).not.toContain("서버 의미 평가 연결 실패");
    expect(html).not.toContain("서버 재평가를 완료하지 못했습니다.");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("server_evaluation_failed");
  });

  it("renders report slides with Konva instead of thumbnail assets", () => {
    const currentDeck = structuredClone(deck);
    currentDeck.slides[0]!.thumbnailUrl = "/current-deck-thumbnail.png";
    const evaluationSnapshot = createRehearsalEvaluationSnapshot(
      currentDeck,
      "2026-07-03T00:00:00.000Z",
      {
        slideThumbnailUrls: new Map([
          [
            "slide_1",
            "/api/v1/projects/project_a/assets/file_run_slide/content",
          ],
        ]),
      },
    );
    const html = renderToStaticMarkup(
      <RehearsalReportDocument
        deck={currentDeck}
        prevReports={[]}
        projectId="project_a"
        report={reportFixture({
          slideTimings: [
            { slideId: "slide_1", targetSeconds: 60, actualSeconds: 58 },
          ],
        })}
        run={{
          runId: "run_1",
          projectId: "project_a",
          deckId: "deck_a",
          jobId: null,
          audioFileId: null,
          deckVersion: 1,
          evaluationSnapshot,
          semanticEvaluationMode: "full",
          analysisRevision: 1,
          analysisFinalizedAt: "2026-07-03T00:00:00.000Z",
          rawAudioDeletedAt: null,
          status: "succeeded",
          error: null,
          createdAt: "2026-07-03T00:00:00.000Z",
          updatedAt: "2026-07-03T00:00:00.000Z",
        }}
        runNumber={1}
        totalRunCount={1}
      />,
    );

    expect(html).toContain('data-renderer="konva"');
    expect(html).not.toContain("file_run_slide/content");
    expect(html).not.toContain("current-deck-thumbnail");
  });

  it("renders Konva when the run snapshot has no thumbnail", () => {
    const currentDeck = structuredClone(deck);
    currentDeck.slides[0]!.thumbnailUrl = "/stale-deck-thumbnail.png";
    const evaluationSnapshot = createRehearsalEvaluationSnapshot(
      currentDeck,
      "2026-07-03T00:00:00.000Z",
    );
    const html = renderToStaticMarkup(
      <RehearsalReportDocument
        deck={currentDeck}
        prevReports={[]}
        projectId="project_a"
        report={reportFixture({
          slideTimings: [
            { slideId: "slide_1", targetSeconds: 60, actualSeconds: 58 },
          ],
        })}
        run={{
          runId: "run_1",
          projectId: "project_a",
          deckId: "deck_a",
          jobId: null,
          audioFileId: null,
          deckVersion: 1,
          evaluationSnapshot,
          semanticEvaluationMode: "full",
          analysisRevision: 1,
          analysisFinalizedAt: "2026-07-03T00:00:00.000Z",
          rawAudioDeletedAt: null,
          status: "succeeded",
          error: null,
          createdAt: "2026-07-03T00:00:00.000Z",
          updatedAt: "2026-07-03T00:00:00.000Z",
        }}
        runNumber={1}
        totalRunCount={1}
      />,
    );

    expect(html).toContain('data-renderer="konva"');
    expect(html).not.toContain("stale-deck-thumbnail");
  });

  it("renders the current Deck with Konva when there is no evaluation snapshot", () => {
    const currentDeck = structuredClone(deck);
    currentDeck.slides[0]!.thumbnailUrl = "/stale-deck-thumbnail.png";
    const html = renderToStaticMarkup(
      <RehearsalReportDocument
        deck={currentDeck}
        prevReports={[]}
        projectId="project_a"
        report={reportFixture({
          slideTimings: [
            { slideId: "slide_1", targetSeconds: 60, actualSeconds: 58 },
          ],
        })}
        run={{
          runId: "run_1",
          projectId: "project_a",
          deckId: "deck_a",
          jobId: null,
          audioFileId: null,
          deckVersion: null,
          evaluationSnapshot: null,
          semanticEvaluationMode: "delivery-only",
          analysisRevision: 1,
          analysisFinalizedAt: "2026-07-03T00:00:00.000Z",
          rawAudioDeletedAt: null,
          status: "succeeded",
          error: null,
          createdAt: "2026-07-03T00:00:00.000Z",
          updatedAt: "2026-07-03T00:00:00.000Z",
        }}
        runNumber={1}
        totalRunCount={1}
      />,
    );

    expect(html).toContain('data-renderer="konva"');
    expect(html).not.toContain("stale-deck-thumbnail");
  });
});

const deck: Deck = deckSchema.parse({
  deckId: "deck_a",
  projectId: "project_a",
  title: "Outcome deck",
  version: 1,
  targetDurationMinutes: 5,
  canvas: {
    preset: "wide-16-9",
    width: 1920,
    height: 1080,
    aspectRatio: "16:9",
  },
  theme: {
    name: "Test",
    fontFamily: "Inter",
    backgroundColor: "#ffffff",
    textColor: "#111827",
    accentColor: "#2563eb",
    palette: {
      primary: "#2563eb",
      secondary: "#10b981",
      surface: "#ffffff",
      muted: "#f3f4f6",
      border: "#dbe3f0",
    },
    typography: {
      headingFontFamily: "Inter",
      bodyFontFamily: "Inter",
      titleSize: 48,
      headingSize: 32,
      bodySize: 22,
      captionSize: 14,
    },
    effects: {
      borderRadius: 8,
      shadow: {
        color: "#111827",
        blur: 16,
        offsetX: 0,
        offsetY: 8,
        opacity: 0.15,
      },
    },
  },
  slides: [
    {
      slideId: "slide_1",
      order: 1,
      title: "Opening",
      estimatedSeconds: 60,
      style: {},
      speakerNotes: "도입 문장입니다. 핵심 메시지를 다르게 설명합니다.",
      elements: [],
      animations: [],
      keywords: [],
    },
    {
      slideId: "slide_2",
      order: 2,
      title: "Closing",
      estimatedSeconds: 45,
      style: {},
      speakerNotes: "마무리 문장입니다.",
      elements: [],
      animations: [],
      keywords: [],
    },
  ],
});

function reportFixture(patch: Partial<RehearsalReport> = {}): RehearsalReport {
  return {
    reportId: "report_run-1",
    runId: "run_1",
    projectId: "project_a",
    deckId: "deck_a",
    transcriptRetained: false,
    transcript: null,
    volumeAnalysis: legacyRehearsalVolumeAnalysis,
    silenceAnalysis: legacyRehearsalSilenceAnalysis,
    metrics: {
      ...legacyRehearsalReportMetricsDefaults,
      durationSeconds: 90,
      wordsPerMinute: 120,
      fillerWordCount: 0,
      longSilenceCount: null,
      keywordCoverage: 1,
      keywordCoverageMeasurement: { state: "measured" },
    },
    speedSamples: [],
    fillerWordDetails: [],
    missedKeywords: [],
    utteranceOutcomes: [],
    semanticCueDecisions: [],
    semanticEvaluation: {
      state: "unavailable",
      measurementMode: "none",
      reasons: ["evaluation_not_run"],
      retryable: false,
    },
    semanticCueOutcomes: [],
    slideTimings: [],
    slideInsights: [],
    qnaSummary: {
      questionCount: 0,
      questionSummary: "",
      unclearTopics: [],
    },
    coaching: null,
    generatedAt: "2026-07-03T00:00:10.000Z",
    ...patch,
  };
}

function semanticOutcome(
  patch: Partial<RehearsalReport["semanticCueOutcomes"][number]> = {},
): RehearsalReport["semanticCueOutcomes"][number] {
  return {
    slideId: "slide_1",
    cueId: "cue-default",
    cueRevision: 1,
    cueMeaningSnapshot: "고객이 얻는 가치를 설명한다.",
    reportLabelSnapshot: "핵심 가치",
    importance: "core",
    status: "covered",
    confidence: 0.9,
    matchedBy: "post_run_semantic",
    measurementMode: "full",
    fallbackUsed: false,
    coveredConcepts: ["고객 가치"],
    missingConcepts: [],
    ...patch,
  };
}
