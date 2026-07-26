import { describe, expect, it } from "vitest";
import { rehearsalSlideSpeakingRateSchema } from "../coaching/rehearsal-analyze.schema";
import {
  createRehearsalRunRequestSchema,
  rehearsalAudioPlaybackUrlResponseSchema,
  rehearsalRunComparisonSchema,
  rehearsalSemanticCueOutcomeSchema,
  rehearsalSemanticCueDecisionSchema,
  rehearsalRunMetaSchema,
  rehearsalReportSchema,
  rehearsalRunSchema,
} from "./rehearsal.schema";

describe("rehearsalRunComparisonSchema", () => {
  it("accepts a bounded owner-only comparison without report evidence", () => {
    const issue = {
      category: "semantic-cue" as const,
      slideId: "slide_1",
      cueId: "scue_1",
      cueRevision: 2,
      label: "고객 가치",
      severity: "high" as const,
      reason: "두 회차 연속 핵심 의미를 충분히 전달하지 못했습니다.",
    };

    const comparison = rehearsalRunComparisonSchema.parse({
      currentRunId: "run_2",
      previousRunId: "run_1",
      improved: [],
      repeated: [issue],
      newIssues: [],
      incomparable: [],
      briefing: [issue],
    });

    expect(comparison.briefing).toEqual([issue]);
    expect(JSON.stringify(comparison)).not.toContain("evidence");
    expect(JSON.stringify(comparison)).not.toContain("transcript");
  });

  it("rejects more than three briefing items and unknown evidence fields", () => {
    const issue = {
      category: "timing",
      slideId: "slide_1",
      label: "도입부 시간 초과",
      severity: "medium",
      reason: "두 회차 연속 목표 시간을 초과했습니다.",
    };
    const base = {
      currentRunId: "run_2",
      previousRunId: "run_1",
      improved: [],
      repeated: [],
      newIssues: [],
      incomparable: [],
    };

    expect(
      rehearsalRunComparisonSchema.safeParse({
        ...base,
        briefing: [issue, issue, issue, issue],
      }).success,
    ).toBe(false);
    expect(
      rehearsalRunComparisonSchema.safeParse({
        ...base,
        briefing: [{ ...issue, evidence: "민감한 발화 근거" }],
      }).success,
    ).toBe(false);
  });
});

describe("rehearsalRunSchema", () => {
  it("accepts deleted raw audio tracking on completed runs", () => {
    const run = rehearsalRunSchema.parse({
      runId: "run_1",
      projectId: "project_demo_1",
      deckId: "deck_demo_1",
      audioFileId: "file_audio_1",
      jobId: "job_1",
      status: "succeeded",
      error: null,
      rawAudioDeletedAt: "2026-06-29T00:00:10.000Z",
      rawAudioDeleteDeadlineAt: "2026-07-13T00:00:00.000Z",
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:10.000Z",
    });

    expect(run.status).toBe("succeeded");
    expect(run.rawAudioDeletedAt).toBe("2026-06-29T00:00:10.000Z");
    expect(run.rawAudioDeleteDeadlineAt).toBe("2026-07-13T00:00:00.000Z");
    expect(run.deckVersion).toBeNull();
    expect(run.evaluationSnapshot).toBeNull();
    expect(run.semanticEvaluationMode).toBe("full");
    expect(run.analysisRevision).toBe(0);
    expect(run.analysisFinalizedAt).toBeNull();
  });

  it("accepts cancelled runs without report processing fields", () => {
    const run = rehearsalRunSchema.parse({
      runId: "run_cancelled",
      projectId: "project_demo_1",
      deckId: "deck_demo_1",
      audioFileId: null,
      jobId: null,
      status: "cancelled",
      error: null,
      rawAudioDeletedAt: null,
      rawAudioDeleteDeadlineAt: null,
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:10.000Z",
    });

    expect(run.status).toBe("cancelled");
    expect(run.rawAudioDeleteDeadlineAt).toBeNull();
  });
});

describe("rehearsalAudioPlaybackUrlResponseSchema", () => {
  it("accepts a short-lived URL bounded by the retention deadline", () => {
    const response = rehearsalAudioPlaybackUrlResponseSchema.parse({
      playbackUrl: "https://storage.example.com/audio?signature=short-lived",
      expiresAt: "2026-07-16T00:15:00.000Z",
      retentionExpiresAt: "2026-07-30T00:00:00.000Z",
    });

    expect(response.playbackUrl).toContain("signature");
  });

  it("rejects a playback URL that outlives retention", () => {
    expect(
      rehearsalAudioPlaybackUrlResponseSchema.safeParse({
        playbackUrl: "https://storage.example.com/audio?signature=short-lived",
        expiresAt: "2026-07-30T00:00:01.000Z",
        retentionExpiresAt: "2026-07-30T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("createRehearsalRunRequestSchema", () => {
  it("defaults semantic evaluation to full and accepts an expected deck version", () => {
    expect(
      createRehearsalRunRequestSchema.parse({
        deckId: "deck_demo_1",
        expectedDeckVersion: 7,
      }),
    ).toEqual({
      deckId: "deck_demo_1",
      expectedDeckVersion: 7,
      semanticEvaluationMode: "full",
    });
  });

  it("accepts an explicit delivery-only run", () => {
    expect(
      createRehearsalRunRequestSchema.parse({
        deckId: "deck_demo_1",
        semanticEvaluationMode: "delivery-only",
      }).semanticEvaluationMode,
    ).toBe("delivery-only");
  });

  it("accepts one persistent slide snapshot asset per slide", () => {
    const request = createRehearsalRunRequestSchema.parse({
      deckId: "deck_demo_1",
      slideSnapshots: [{ slideId: "slide_1", fileId: "file_snapshot_1" }],
    });

    expect(request.slideSnapshots).toEqual([
      { slideId: "slide_1", fileId: "file_snapshot_1" },
    ]);
    expect(
      createRehearsalRunRequestSchema.safeParse({
        deckId: "deck_demo_1",
        slideSnapshots: [
          { slideId: "slide_1", fileId: "file_snapshot_1" },
          { slideId: "slide_1", fileId: "file_snapshot_2" },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires a complete adaptive evaluation context", () => {
    expect(
      createRehearsalRunRequestSchema.safeParse({
        deckId: "deck_demo_1",
        expectedDeckVersion: 7,
        briefRef: { mode: "generic" },
      }).success,
    ).toBe(false);

    expect(
      createRehearsalRunRequestSchema.parse({
        deckId: "deck_demo_1",
        expectedDeckVersion: 7,
        briefRef: { mode: "generic" },
        evaluatorLensRef: { lensId: "general-novice", revision: 1 },
        sourceGoalSetId: null,
      }).sourceGoalSetId,
    ).toBeNull();
  });
});

describe("rehearsalReportSchema", () => {
  it("accepts a report without retaining the raw transcript", () => {
    const report = rehearsalReportSchema.parse(rehearsalReportFixture());

    expect(report.transcriptRetained).toBe(false);
    expect(report.transcript).toBeNull();
  });

  it("rejects transcript content when retention is disabled", () => {
    const result = rehearsalReportSchema.safeParse({
      ...rehearsalReportFixture(),
      transcriptRetained: false,
      transcript: "민감한 전사 원문",
    });

    expect(result.success).toBe(false);
  });

  it("rejects provisional 0-100 score fields before ORBIT-37 defines the formula", () => {
    const topLevelScore = rehearsalReportSchema.safeParse({
      ...rehearsalReportFixture(),
      score: 88,
    });
    const metricScores = rehearsalReportSchema.safeParse({
      ...rehearsalReportFixture(),
      metrics: {
        ...rehearsalReportFixture().metrics,
        deliveryScore: 91,
        speedScore: 84,
      },
    });

    expect(topLevelScore.success).toBe(false);
    expect(metricScores.success).toBe(false);
  });

  it("accepts worker-generated report detail fields without 0-100 scores", () => {
    const report = rehearsalReportSchema.parse({
      ...rehearsalReportFixture(),
      speedSamples: [{ startSecond: 0, endSecond: 5, wordsPerMinute: 120 }],
      fillerWordDetails: [{ word: "음", count: 2 }],
      silenceAnalysis: measuredSilenceAnalysis(),
      metrics: {
        ...rehearsalReportFixture().metrics,
        longSilenceCount: 1,
        measurements: {
          ...legacyReportMeasurements(),
          longSilenceCount: {
            measurementState: "measured",
            metricDefinitionVersion: 1,
            reasonCode: null,
          },
        },
      },
      missedKeywords: [
        { slideId: "slide_1", keywordId: "kw_1", text: "ORBIT" },
      ],
      utteranceOutcomes: [
        { slideId: "slide_1", kind: "covered", sentenceId: "sentence_1" },
        { slideId: "slide_1", kind: "ad-lib", text: "짧은 추가 설명" },
      ],
      semanticCueDecisions: [
        {
          slideId: "slide_1",
          cueId: "scue_1",
          label: "covered",
          finalScore: 0.91,
          lexicalScore: 0.2,
          conceptCoverage: 0.75,
          entailmentScore: 0.94,
          neutralScore: 0.05,
          contradictionScore: 0.01,
          premise:
            "처음엔 세일즈에 돈이 많이 들어 고객 한 명 데려오는 비용이 컸습니다",
          hypothesis: "고객 획득 비용이 초기 영업 비용 때문에 높다",
          provider: "mock",
          modelId: "test-nli",
          reasonCodes: ["nli-entailment"],
          at: "2026-07-02T00:00:20.000Z",
        },
      ],
      slideTimings: [
        { slideId: "slide_1", targetSeconds: 60, actualSeconds: 52 },
      ],
      slideInsights: [
        {
          slideId: "slide_1",
          fillerWordCount: 2,
          longSilenceCount: 1,
          speakingRate: {
            metricDefinitionVersion: 1,
            measurementState: "measured",
            reasonCode: null,
            charactersPerSecond: 4.62,
            baselineCharactersPerSecond: 4.24,
            relativeRateRatio: 1.0896,
            paceCategory: "similar",
            activeSpeechSeconds: 12.4,
            characterCount: 57,
          },
        },
      ],
      qnaSummary: {
        questionCount: 1,
        questionSummary: "가격 정책 질문이 있었습니다.",
        unclearTopics: [{ topic: "가격 정책", slideId: "slide_1" }],
      },
      aiSummary: {
        headline: "도입부 핵심 메시지가 약했습니다.",
        paragraphs: [
          "발표 흐름은 안정적이었지만 Opening에서 ORBIT 키워드가 빠졌습니다.",
          "다음 연습에서는 도입부 핵심 문장을 먼저 고정해야 합니다.",
        ],
      },
    });

    expect(report.speedSamples).toHaveLength(1);
    expect(report.fillerWordDetails[0]?.word).toBe("음");
    expect(report.silenceAnalysis.segments[0]?.durationSeconds).toBe(1.5);
    expect(report.missedKeywords[0]?.keywordId).toBe("kw_1");
    expect(report.utteranceOutcomes.map((outcome) => outcome.kind)).toEqual([
      "covered",
      "ad-lib",
    ]);
    expect(report.semanticCueDecisions[0]?.cueId).toBe("scue_1");
    expect(report.slideTimings[0]?.actualSeconds).toBe(52);
    expect(report.slideInsights[0]?.fillerWordCount).toBe(2);
    expect(report.slideInsights[0]?.speakingRate.paceCategory).toBe("similar");
    expect(report.qnaSummary.questionCount).toBe(1);
    expect(report.aiSummary?.headline).toBe("도입부 핵심 메시지가 약했습니다.");
  });

  it("defaults optional official detail sections to empty values", () => {
    const report = rehearsalReportSchema.parse(rehearsalReportFixture());

    expect(report.metrics.charactersPerMinute).toBeNull();
    expect(report.metrics.measurements).toEqual(legacyReportMeasurements());
    expect(report.metrics.sttQualityGate).toEqual({
      version: 1,
      state: "unavailable",
      reasonCode: "LEGACY_QUALITY_GATE_UNKNOWN",
      confidence: null,
      threshold: null,
      policyId: null,
    });
    expect(report.metrics.analysisCapabilities).toEqual({
      recordingDuration: { state: "unavailable", source: "none" },
      providerDuration: { state: "unavailable", source: "none" },
      segmentTimestamps: { state: "unavailable", source: "none" },
      sttConfidence: { state: "unavailable", source: "none" },
      sentenceBoundaries: { state: "unavailable", source: "none" },
    });
    expect(report.speedSamples).toEqual([]);
    expect(report.silenceAnalysis.measurementState).toBe("unmeasured");
    expect(report.silenceAnalysis.reasonCode).toBe("LEGACY_REPORT");
    expect(report.missedKeywords).toEqual([]);
    expect(report.utteranceOutcomes).toEqual([]);
    expect(report.semanticCueDecisions).toEqual([]);
    expect(report.semanticCueOutcomes).toEqual([]);
    expect(report.semanticEvaluation).toEqual({
      state: "unavailable",
      measurementMode: "none",
      reasons: ["evaluation_not_run"],
      retryable: false,
    });
    expect(report.metrics.keywordCoverageMeasurement).toEqual({
      state: "measured",
    });
    expect(report.slideTimings).toEqual([]);
    expect(report.slideInsights).toEqual([]);
    expect(report.qnaSummary).toEqual({
      questionCount: 0,
      questionSummary: "",
      unclearTopics: [],
    });
    expect(report.aiSummary).toBeUndefined();
  });

  it("accepts measured speech evidence with canonical metric versions", () => {
    const report = rehearsalReportSchema.parse({
      ...rehearsalReportFixture(),
      metrics: {
        ...rehearsalReportFixture().metrics,
        charactersPerMinute: 318,
        longSilenceCount: 1,
        measurements: measuredReportMeasurements(),
        sttQualityGate: {
          version: 1,
          state: "passed",
          reasonCode: "CONFIDENCE_ACCEPTED",
          confidence: 0.91,
          threshold: 0.8,
          policyId: "quality-policy-ko-1",
        },
        analysisCapabilities: {
          recordingDuration: { state: "available", source: "recording" },
          providerDuration: { state: "available", source: "provider" },
          segmentTimestamps: { state: "available", source: "segment" },
          sttConfidence: { state: "available", source: "provider" },
          sentenceBoundaries: { state: "available", source: "provider" },
        },
      },
      silenceAnalysis: measuredSilenceAnalysis(),
    });

    expect(report.metrics.charactersPerMinute).toBe(318);
    expect(
      report.metrics.measurements.longSilenceCount.metricDefinitionVersion,
    ).toBe(1);
    expect(report.silenceAnalysis.detector).toBe("silero-vad");
  });

  it("rejects a long silence count that differs from silence analysis", () => {
    const fixture = rehearsalReportFixture();
    const result = rehearsalReportSchema.safeParse({
      ...fixture,
      silenceAnalysis: measuredSilenceAnalysis(),
      metrics: {
        ...fixture.metrics,
        longSilenceCount: 2,
        measurements: measuredReportMeasurements(),
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects slide silence counts when silence analysis is unmeasured", () => {
    const fixture = rehearsalReportFixture();
    const result = rehearsalReportSchema.safeParse({
      ...fixture,
      slideInsights: [
        { slideId: "slide_1", fillerWordCount: 0, longSilenceCount: 1 },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("defaults legacy slide speaking rates to an unmeasured result", () => {
    const report = rehearsalReportSchema.parse({
      ...rehearsalReportFixture(),
      slideInsights: [
        { slideId: "slide_1", fillerWordCount: 0, longSilenceCount: null },
      ],
    });

    expect(report.slideInsights[0]?.speakingRate).toEqual({
      metricDefinitionVersion: 1,
      measurementState: "unmeasured",
      reasonCode: "LEGACY_REPORT",
      charactersPerSecond: null,
      baselineCharactersPerSecond: null,
      relativeRateRatio: null,
      paceCategory: null,
      activeSpeechSeconds: 0,
      characterCount: 0,
    });
  });

  it("rejects invalid slide speaking rate invariants and non-finite values", () => {
    const measuredWithReason = rehearsalSlideSpeakingRateSchema.safeParse({
      metricDefinitionVersion: 1,
      measurementState: "measured",
      reasonCode: "BASELINE_UNAVAILABLE",
      charactersPerSecond: 4.5,
      baselineCharactersPerSecond: 4,
      relativeRateRatio: 1.125,
      paceCategory: "similar",
      activeSpeechSeconds: 3,
      characterCount: 14,
    });
    const nonFinite = rehearsalSlideSpeakingRateSchema.safeParse({
      metricDefinitionVersion: 1,
      measurementState: "measured",
      reasonCode: null,
      charactersPerSecond: Number.POSITIVE_INFINITY,
      baselineCharactersPerSecond: 4,
      relativeRateRatio: 1,
      paceCategory: "similar",
      activeSpeechSeconds: 3,
      characterCount: 14,
    });

    expect(measuredWithReason.success).toBe(false);
    expect(nonFinite.success).toBe(false);
  });

  it("rejects CPM values that contradict their measurement state", () => {
    expect(
      rehearsalReportSchema.safeParse({
        ...rehearsalReportFixture(),
        metrics: {
          ...rehearsalReportFixture().metrics,
          charactersPerMinute: 318,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects non-canonical public report metric versions", () => {
    expect(
      rehearsalReportSchema.safeParse({
        ...rehearsalReportFixture(),
        metrics: {
          ...rehearsalReportFixture().metrics,
          measurements: {
            ...legacyReportMeasurements(),
            longSilenceCount: speechMetricUnmeasured(
              2,
              "LEGACY_MEASUREMENT_STATE_UNKNOWN",
            ),
          },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects STT-dependent evidence when the quality gate failed", () => {
    const failedMeasurements = {
      ...legacyReportMeasurements(),
      duration: {
        measurementState: "measured" as const,
        metricDefinitionVersion: 1,
        reasonCode: null,
      },
      charactersPerMinute: speechMetricUnmeasured(
        1,
        "LOW_TRANSCRIPTION_CONFIDENCE",
      ),
      wordsPerMinute: speechMetricUnmeasured(1, "LOW_TRANSCRIPTION_CONFIDENCE"),
      fillerWordCount: speechMetricUnmeasured(
        1,
        "LOW_TRANSCRIPTION_CONFIDENCE",
      ),
      longSilenceCount: speechMetricUnmeasured(
        1,
        "LEGACY_MEASUREMENT_STATE_UNKNOWN",
      ),
      keywordCoverage: speechMetricUnmeasured(
        1,
        "LOW_TRANSCRIPTION_CONFIDENCE",
      ),
    };
    const failedGateReport = {
      ...rehearsalReportFixture(),
      metrics: {
        ...rehearsalReportFixture().metrics,
        measurements: failedMeasurements,
        keywordCoverageMeasurement: {
          state: "unmeasured" as const,
          reason: "low-transcription-confidence" as const,
        },
        sttQualityGate: {
          version: 1 as const,
          state: "failed" as const,
          reasonCode: "LOW_TRANSCRIPTION_CONFIDENCE" as const,
          confidence: 0.4,
          threshold: 0.8,
          policyId: "quality-policy-ko-1",
        },
      },
    };

    expect(rehearsalReportSchema.safeParse(failedGateReport).success).toBe(
      true,
    );
    expect(
      rehearsalReportSchema.safeParse({
        ...failedGateReport,
        metrics: {
          ...failedGateReport.metrics,
          measurements: {
            ...failedMeasurements,
            fillerWordCount: {
              measurementState: "measured",
              metricDefinitionVersion: 1,
              reasonCode: null,
            },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      rehearsalReportSchema.safeParse({
        ...failedGateReport,
        fillerWordDetails: [{ word: "음", count: 1 }],
      }).success,
    ).toBe(false);
  });

  it("accepts a canonical measured semantic cue outcome", () => {
    const report = rehearsalReportSchema.parse({
      ...rehearsalReportFixture(),
      semanticEvaluation: {
        state: "succeeded",
        measurementMode: "full",
        reasons: [],
        retryable: false,
      },
      semanticCueOutcomes: [
        semanticCueOutcome({
          status: "covered",
          measurementMode: "full",
          matchedBy: "post_run_semantic",
          evidence: {
            excerpt: "  고객 획득 비용은\n초기 영업 비용 때문에 높았습니다.  ",
            startMs: 1200,
            endMs: 4800,
          },
        }),
      ],
    });

    expect(report.semanticCueOutcomes[0]?.evidence?.excerpt).toBe(
      "고객 획득 비용은 초기 영업 비용 때문에 높았습니다.",
    );
  });
});

describe("rehearsalSemanticCueOutcomeSchema", () => {
  it("requires an explicit reason for unmeasured outcomes", () => {
    const missingReason = rehearsalSemanticCueOutcomeSchema.safeParse(
      semanticCueOutcome({ status: "unmeasured", measurementMode: "none" }),
    );
    const measuredUnmeasured = rehearsalSemanticCueOutcomeSchema.safeParse(
      semanticCueOutcome({
        status: "unmeasured",
        measurementMode: "full",
        unmeasuredReason: "no_transcript",
      }),
    );

    expect(missingReason.success).toBe(false);
    expect(measuredUnmeasured.success).toBe(false);
  });

  it("allows missed only after full measurement", () => {
    const none = rehearsalSemanticCueOutcomeSchema.safeParse(
      semanticCueOutcome({ status: "missed", measurementMode: "none" }),
    );
    const basic = rehearsalSemanticCueOutcomeSchema.safeParse(
      semanticCueOutcome({ status: "missed", measurementMode: "basic" }),
    );
    const full = rehearsalSemanticCueOutcomeSchema.safeParse(
      semanticCueOutcome({ status: "missed", measurementMode: "full" }),
    );

    expect(none.success).toBe(false);
    expect(basic.success).toBe(false);
    expect(full.success).toBe(true);
  });

  it("allows basic mode only for positive covered or partial evidence", () => {
    expect(
      rehearsalSemanticCueOutcomeSchema.safeParse(
        semanticCueOutcome({ status: "covered", measurementMode: "basic" }),
      ).success,
    ).toBe(true);
    expect(
      rehearsalSemanticCueOutcomeSchema.safeParse(
        semanticCueOutcome({ status: "partial", measurementMode: "basic" }),
      ).success,
    ).toBe(true);
    expect(
      rehearsalSemanticCueOutcomeSchema.safeParse(
        semanticCueOutcome({ status: "excluded", measurementMode: "basic" }),
      ).success,
    ).toBe(false);
  });

  it("requires fallback reasons and keeps excluded outcomes evidence-free", () => {
    const fallbackWithoutReason = rehearsalSemanticCueOutcomeSchema.safeParse(
      semanticCueOutcome({ fallbackUsed: true }),
    );
    const excludedWithEvidence = rehearsalSemanticCueOutcomeSchema.safeParse(
      semanticCueOutcome({
        status: "excluded",
        measurementMode: "none",
        evidence: { excerpt: "저장하면 안 되는 근거", startMs: 0, endMs: 10 },
      }),
    );
    const excluded = rehearsalSemanticCueOutcomeSchema.safeParse(
      semanticCueOutcome({ status: "excluded", measurementMode: "none" }),
    );

    expect(fallbackWithoutReason.success).toBe(false);
    expect(excludedWithEvidence.success).toBe(false);
    expect(excluded.success).toBe(true);
  });
});

describe("rehearsalSemanticCueDecisionSchema", () => {
  it("normalizes legacy NLI decisions and requires a visible fallback reason", () => {
    const legacy = rehearsalSemanticCueDecisionSchema.parse({
      slideId: "slide_1",
      cueId: "scue_1",
      label: "covered",
      finalScore: 0.9,
      provider: "mock",
      reasonCodes: ["nli-entailment"],
    });
    const invalidFallback = rehearsalSemanticCueDecisionSchema.safeParse({
      ...legacy,
      fallbackUsed: true,
      fallbackReason: undefined,
    });

    expect(legacy).toMatchObject({
      matchedBy: "nli",
      measurementMode: "full",
      fallbackUsed: false,
    });
    expect(invalidFallback.success).toBe(false);
  });
});

describe("rehearsalRunMetaSchema", () => {
  it("accepts slide timeline, missed keywords, and advice events", () => {
    const meta = rehearsalRunMetaSchema.parse({
      slideTimeline: [
        { slideId: "slide_1", enteredAt: "2026-07-02T00:00:00.000Z" },
      ],
      missedKeywords: [{ slideId: "slide_1", keywordId: "kw_1" }],
      adviceEvents: [{ type: "pace-too-fast", at: "2026-07-02T00:00:30.000Z" }],
    });

    expect(meta.slideTimeline).toHaveLength(1);
  });

  it("accepts bounded utterance outcomes for coverage, ad-lib, and missed script sentences", () => {
    const meta = rehearsalRunMetaSchema.parse({
      utteranceOutcomes: [
        {
          slideId: "slide_1",
          kind: "covered",
          sentenceId: "sentence_1",
          similarity: 0.98,
          lexicalOverlap: 0.75,
          at: "2026-07-02T00:00:10.000Z",
        },
        {
          slideId: "slide_1",
          kind: "paraphrased",
          sentenceId: "sentence_2",
          similarity: 0.92,
          lexicalOverlap: 0.2,
          at: "2026-07-02T00:00:20.000Z",
        },
        {
          slideId: "slide_1",
          kind: "ad-lib",
          text: "이 부분은 실제 고객 미팅에서 들었던 추가 사례입니다.",
          similarity: 0.87,
          at: "2026-07-02T00:00:30.000Z",
        },
        {
          slideId: "slide_2",
          kind: "missed",
          sentenceId: "sentence_3",
        },
      ],
    });

    expect(meta.utteranceOutcomes.map((outcome) => outcome.kind)).toEqual([
      "covered",
      "paraphrased",
      "ad-lib",
      "missed",
    ]);
  });

  it("accepts bounded semantic cue NLI evidence", () => {
    const meta = rehearsalRunMetaSchema.parse({
      semanticCueDecisions: [
        {
          slideId: "slide_1",
          cueId: "scue_1",
          label: "covered",
          finalScore: 0.9,
          embeddingScore: 0.72,
          lexicalScore: 0.1,
          conceptCoverage: 0.66,
          entailmentScore: 0.93,
          neutralScore: 0.06,
          contradictionScore: 0.01,
          premise:
            "처음엔 세일즈에 돈이 많이 들어 고객 한 명 데려오는 비용이 컸습니다",
          hypothesis: "고객 획득 비용이 초기 영업 비용 때문에 높다",
          provider: "mock",
          modelId: "test-nli",
          reasonCodes: ["ad-lib-candidate", "nli-entailment"],
          at: "2026-07-02T00:00:30.000Z",
        },
      ],
    });

    expect(meta.semanticCueDecisions[0]?.label).toBe("covered");
  });

  it("defaults utterance outcomes to an empty list for existing run meta payloads", () => {
    const meta = rehearsalRunMetaSchema.parse({
      slideTimeline: [],
      missedKeywords: [],
      adviceEvents: [],
    });

    expect(meta.utteranceOutcomes).toEqual([]);
    expect(meta.semanticCueDecisions).toEqual([]);
    expect(meta.semanticCapabilityEvents).toEqual([]);
    expect(meta.recordingDurationSeconds).toBeNull();
  });

  it("deduplicates bounded capability cue IDs without accepting sensitive fields", () => {
    const meta = rehearsalRunMetaSchema.parse({
      semanticCapabilityEvents: [
        {
          eventId: "cap_1",
          capability: "nli",
          fromState: "available",
          toState: "degraded",
          reason: "timeout",
          measurementMode: "basic",
          retryable: true,
          slideId: "slide_1",
          cueIds: ["scue_1", "scue_1"],
          provider: "browser-transformersjs",
          latencyMs: 1500,
          at: "2026-07-02T00:00:30.000Z",
        },
      ],
    });
    const sensitive = rehearsalRunMetaSchema.safeParse({
      semanticCapabilityEvents: [
        {
          eventId: "cap_2",
          capability: "nli",
          fromState: "available",
          toState: "unavailable",
          reason: "runtime_error",
          measurementMode: "none",
          retryable: false,
          cueIds: [],
          at: "2026-07-02T00:00:30.000Z",
          transcript: "민감한 전사 원문",
        },
      ],
    });

    expect(meta.semanticCapabilityEvents[0]?.cueIds).toEqual(["scue_1"]);
    expect(sensitive.success).toBe(false);
  });

  it("requires capability failure reasons and an explicit recovery source state", () => {
    const noFailureReason = rehearsalRunMetaSchema.safeParse({
      semanticCapabilityEvents: [
        {
          eventId: "cap_1",
          capability: "stt",
          fromState: "available",
          toState: "unavailable",
          measurementMode: "none",
          retryable: true,
          cueIds: [],
          at: "2026-07-02T00:00:30.000Z",
        },
      ],
    });
    const noRecoverySource = rehearsalRunMetaSchema.safeParse({
      semanticCapabilityEvents: [
        {
          eventId: "cap_2",
          capability: "stt",
          fromState: null,
          toState: "available",
          measurementMode: "full",
          retryable: false,
          cueIds: [],
          at: "2026-07-02T00:00:31.000Z",
        },
      ],
    });

    expect(noFailureReason.success).toBe(false);
    expect(noRecoverySource.success).toBe(false);
  });

  it("rejects oversized semantic cue premise and hypothesis evidence", () => {
    const result = rehearsalRunMetaSchema.safeParse({
      semanticCueDecisions: [
        {
          slideId: "slide_1",
          cueId: "scue_1",
          label: "covered",
          finalScore: 0.9,
          premise: "가".repeat(601),
          hypothesis: "나".repeat(301),
          provider: "mock",
          reasonCodes: ["nli-entailment"],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects oversized ad-lib utterance text", () => {
    const result = rehearsalRunMetaSchema.safeParse({
      utteranceOutcomes: [
        {
          slideId: "slide_1",
          kind: "ad-lib",
          text: "가".repeat(601),
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it.each(["transcript", "speakerNotes", "rawAudio", "script"])(
    "rejects sensitive run meta field %s",
    (field) => {
      const result = rehearsalRunMetaSchema.safeParse({
        slideTimeline: [],
        missedKeywords: [],
        adviceEvents: [],
        [field]: "민감한 원문",
      });

      expect(result.success).toBe(false);
    },
  );
});

function rehearsalReportFixture() {
  return {
    reportId: "report_run_1",
    runId: "run_1",
    projectId: "project_demo_1",
    deckId: "deck_demo_1",
    transcriptRetained: false,
    transcript: null,
    metrics: {
      durationSeconds: 90,
      wordsPerMinute: 120,
      fillerWordCount: 2,
      keywordCoverage: 0.75,
    },
    slideInsights: [],
    coaching: {
      status: "succeeded",
      summary: "핵심 메시지가 분명합니다.",
      strengths: ["키워드를 언급했습니다."],
      improvements: ["불필요한 filler를 줄이세요."],
      nextPracticeFocus: "도입부를 더 짧게 연습하세요.",
      message: "",
    },
    generatedAt: "2026-06-29T00:00:10.000Z",
  };
}

function speechMetricUnmeasured(
  metricDefinitionVersion: number,
  reasonCode:
    | "LEGACY_MEASUREMENT_STATE_UNKNOWN"
    | "LOW_TRANSCRIPTION_CONFIDENCE",
) {
  return {
    measurementState: "unmeasured" as const,
    metricDefinitionVersion,
    reasonCode,
  };
}

function legacyReportMeasurements() {
  return {
    duration: speechMetricUnmeasured(1, "LEGACY_MEASUREMENT_STATE_UNKNOWN"),
    charactersPerMinute: speechMetricUnmeasured(
      1,
      "LEGACY_MEASUREMENT_STATE_UNKNOWN",
    ),
    wordsPerMinute: speechMetricUnmeasured(
      1,
      "LEGACY_MEASUREMENT_STATE_UNKNOWN",
    ),
    fillerWordCount: speechMetricUnmeasured(
      1,
      "LEGACY_MEASUREMENT_STATE_UNKNOWN",
    ),
    longSilenceCount: speechMetricUnmeasured(
      1,
      "LEGACY_MEASUREMENT_STATE_UNKNOWN",
    ),
    keywordCoverage: speechMetricUnmeasured(
      1,
      "LEGACY_MEASUREMENT_STATE_UNKNOWN",
    ),
  };
}

function measuredReportMeasurements() {
  return {
    duration: {
      measurementState: "measured" as const,
      metricDefinitionVersion: 1,
      reasonCode: null,
    },
    charactersPerMinute: {
      measurementState: "measured" as const,
      metricDefinitionVersion: 1,
      reasonCode: null,
    },
    wordsPerMinute: {
      measurementState: "measured" as const,
      metricDefinitionVersion: 1,
      reasonCode: null,
    },
    fillerWordCount: {
      measurementState: "measured" as const,
      metricDefinitionVersion: 1,
      reasonCode: null,
    },
    longSilenceCount: {
      measurementState: "measured" as const,
      metricDefinitionVersion: 1,
      reasonCode: null,
    },
    keywordCoverage: {
      measurementState: "measured" as const,
      metricDefinitionVersion: 1,
      reasonCode: null,
    },
  };
}

function measuredSilenceAnalysis() {
  return {
    metricDefinitionVersion: 1 as const,
    measurementState: "measured" as const,
    reasonCode: null,
    detector: "silero-vad" as const,
    detectorVersion: "6.2.1",
    speechThreshold: 0.5 as const,
    minimumSilenceMs: 250 as const,
    longSilenceMs: 1000 as const,
    analysisWindowStartSeconds: 0.5,
    analysisWindowEndSeconds: 10,
    totalSilenceSeconds: 1.5,
    silenceRatio: 0.1579,
    longSilenceCount: 1,
    detectedSegmentCount: 1,
    segmentsTruncated: false,
    segments: [
      {
        category: "long" as const,
        startSeconds: 2,
        endSeconds: 3.5,
        durationSeconds: 1.5,
      },
    ],
  };
}

function semanticCueOutcome(
  patch: Partial<
    Parameters<typeof rehearsalSemanticCueOutcomeSchema.parse>[0]
  > = {},
) {
  return {
    slideId: "slide_1",
    cueId: "scue_1",
    cueRevision: 1,
    cueMeaningSnapshot: "고객 획득 비용이 초기 영업 비용 때문에 높다",
    reportLabelSnapshot: "초기 영업 비용이 높인 CAC",
    importance: "core",
    status: "covered",
    measurementMode: "full",
    fallbackUsed: false,
    coveredConcepts: ["고객 획득 비용", "초기 영업 비용"],
    missingConcepts: [],
    ...patch,
  };
}
