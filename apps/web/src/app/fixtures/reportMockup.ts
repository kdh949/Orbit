import { legacyRehearsalSlideSpeakingRate } from "@orbit/shared/coaching";
import { demoIds } from "@orbit/shared/common";
import {
  legacyRehearsalReportMetricsDefaults,
  legacyRehearsalSilenceAnalysis,
  legacyRehearsalVolumeAnalysis,
  type RehearsalReport,
  type RehearsalRun,
} from "@orbit/shared/rehearsals";
import { createDemoDeck } from "@orbit/editor-core/fixtures";

export const demoDeck = createDemoDeck();
export const reportMockupRunId = "run_report_mockup";
const reportMockupGeneratedAt = "2026-07-01T09:00:00.000Z";
export const reportMockupRun: RehearsalRun = {
  runId: reportMockupRunId,
  projectId: demoIds.projectId,
  deckId: demoIds.deckId,
  audioFileId: "file_report_mockup_audio",
  jobId: "job_report_mockup_stt",
  deckVersion: null,
  evaluationSnapshot: null,
  semanticEvaluationMode: "full",
  analysisRevision: 1,
  analysisFinalizedAt: reportMockupGeneratedAt,
  status: "succeeded",
  error: null,
  rawAudioDeletedAt: null,
  createdAt: "2026-07-01T08:54:12.000Z",
  updatedAt: reportMockupGeneratedAt,
};
export const reportMockupReport: RehearsalReport = {
  reportId: "report_mockup",
  runId: reportMockupRunId,
  projectId: demoIds.projectId,
  deckId: demoIds.deckId,
  transcriptRetained: false,
  transcript: null,
  volumeAnalysis: legacyRehearsalVolumeAnalysis,
  silenceAnalysis: {
    ...legacyRehearsalSilenceAnalysis,
    measurementState: "measured",
    reasonCode: null,
    detectorVersion: "6.2.1",
    analysisWindowStartSeconds: 0.4,
    analysisWindowEndSeconds: 285.5,
    totalSilenceSeconds: 2,
    silenceRatio: 0.007,
    longSilenceCount: 1,
    detectedSegmentCount: 1,
    segments: [
      {
        category: "long",
        startSeconds: 144,
        endSeconds: 146,
        durationSeconds: 2,
      },
    ],
  },
  metrics: {
    ...legacyRehearsalReportMetricsDefaults,
    durationSeconds: 286,
    wordsPerMinute: 128,
    fillerWordCount: 3,
    longSilenceCount: 1,
    measurements: {
      ...legacyRehearsalReportMetricsDefaults.measurements,
      longSilenceCount: {
        measurementState: "measured",
        metricDefinitionVersion: 1,
        reasonCode: null,
      },
    },
    keywordCoverage: 0.86,
    keywordCoverageMeasurement: { state: "measured" },
  },
  speedSamples: [
    { startSecond: 0, endSecond: 30, wordsPerMinute: 118 },
    { startSecond: 30, endSecond: 60, wordsPerMinute: 132 },
    { startSecond: 60, endSecond: 90, wordsPerMinute: 126 },
  ],
  fillerWordDetails: [{ word: "음", count: 3 }],
  missedKeywords: [
    { slideId: "slide_1", keywordId: "kw_1", text: "핵심 메시지" },
  ],
  utteranceOutcomes: [],
  semanticCueDecisions: [],
  semanticEvaluation: {
    state: "unavailable",
    measurementMode: "none",
    reasons: ["evaluation_not_run"],
    retryable: false,
  },
  semanticCueOutcomes: [],
  slideTimings: [{ slideId: "slide_1", targetSeconds: 60, actualSeconds: 58 }],
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
    summary:
      "핵심 메시지는 안정적으로 전달됐고, 속도도 발표 시간에 잘 맞습니다.",
    strengths: [
      "도입부에서 발표 목적을 빠르게 제시했습니다.",
      "중요 키워드를 반복해 청중이 흐름을 따라가기 좋았습니다.",
      "슬라이드 전환 사이의 멈춤이 과하지 않았습니다.",
    ],
    improvements: [
      "중간 설명에서 일부 filler 표현이 반복됩니다.",
      "마무리 전에 다음 행동을 더 명확하게 요청하면 좋습니다.",
      "수치가 있는 문장은 한 번 더 천천히 읽는 편이 좋습니다.",
    ],
    nextPracticeFocus:
      "다음 연습에서는 결론 슬라이드의 CTA 문장을 먼저 고정하고, 수치 설명 구간의 호흡을 조금 더 길게 가져가세요.",
    message: "",
  },
  generatedAt: reportMockupGeneratedAt,
};
