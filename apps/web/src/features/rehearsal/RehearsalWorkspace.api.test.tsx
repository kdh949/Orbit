import { createDemoDeck } from "@orbit/editor-core";
import { legacyRehearsalSlideSpeakingRate } from "@orbit/shared/coaching";
import { type Job } from "@orbit/shared/jobs";
import {
  createRehearsalEvaluationSnapshot,
  legacyRehearsalReportMetricsDefaults,
  legacyRehearsalSilenceAnalysis,
  legacyRehearsalVolumeAnalysis,
  type RehearsalReport,
  type RehearsalRun,
} from "@orbit/shared/rehearsals";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RehearsalFlowError,
  cancelRehearsalRun,
  createRehearsalRun,
  createRehearsalRunForUpload,
  fetchOrCreateRehearsalDeck,
  fetchRehearsalReport,
  prepareRehearsalEvaluationRun,
  retryRehearsalSemanticEvaluation,
  runRehearsalUploadFlow,
} from "./api/rehearsalApi";
import { buildP3SessionSlides } from "./rehearsalWorkspaceModel";

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

describe("RehearsalWorkspace API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("persists a fallback demo deck when rehearsal entry has no stored deck", async () => {
    const fallbackDeck = createDemoDeck();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });

        if (!init) {
          return new Response("missing", { status: 404 });
        }

        return jsonResponse({
          projectId: fallbackDeck.projectId,
          deck: fallbackDeck,
          updatedAt: createdAt,
          snapshot: null,
        });
      },
    );

    const deck = await fetchOrCreateRehearsalDeck({
      fallbackDeck,
      fetcher,
    });

    expect(deck.deckId).toBe(fallbackDeck.deckId);
    expect(calls.map((call) => call.url)).toEqual([
      `/api/v1/projects/${fallbackDeck.projectId}/deck`,
      `/api/v1/projects/${fallbackDeck.projectId}/deck`,
    ]);
    expect(calls[1]?.init).toMatchObject({
      method: "PUT",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      deck: fallbackDeck,
      snapshotReason: "deck-replaced",
    });
  });

  it("uses the fallback demo deck when rehearsal deck fetch is unauthorized", async () => {
    const fallbackDeck = createDemoDeck();
    const fetcher = vi.fn(
      async () => new Response("unauthorized", { status: 401 }),
    );

    const deck = await fetchOrCreateRehearsalDeck({
      fallbackDeck,
      fetcher,
    });

    expect(deck.deckId).toBe(fallbackDeck.deckId);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/projects/${fallbackDeck.projectId}/deck`,
    );
  });

  it("creates a full run with the client deck version before tracking", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        run: runFixture("created", {
          deckVersion: 3,
          evaluationSnapshot:
            createRehearsalEvaluationSnapshot(createDemoDeck()),
        }),
      }),
    );

    await createRehearsalRun("project-a", "deck-a", fetcher, {
      expectedDeckVersion: 3,
      semanticEvaluationMode: "full",
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/projects/project-a/rehearsals",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          deckId: "deck-a",
          expectedDeckVersion: 3,
          semanticEvaluationMode: "full",
        }),
      }),
    );
  });

  it("passes prepared slide snapshot file IDs to run creation", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ run: runFixture("created") }),
    );

    await createRehearsalRun("project-a", "deck-a", fetcher, {
      slideSnapshots: [{ slideId: "slide_1", fileId: "file-slide-1" }],
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/projects/project-a/rehearsals",
      expect.objectContaining({
        body: JSON.stringify({
          deckId: "deck-a",
          slideSnapshots: [{ slideId: "slide_1", fileId: "file-slide-1" }],
        }),
      }),
    );
  });

  it("cancels a run that exits before upload processing", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ run: runFixture("cancelled") }),
    );

    const run = await cancelRehearsalRun("run-1", fetcher);

    expect(run.status).toBe("cancelled");
    expect(fetcher).toHaveBeenCalledWith("/api/v1/rehearsals/run-1/cancel", {
      method: "POST",
    });
  });

  it("creates a delivery-only run after an offline rehearsal deck version mismatch", async () => {
    const bodies: unknown[] = [];
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        if (bodies.length === 1) {
          return new Response("deck version mismatch", { status: 409 });
        }
        return jsonResponse({
          run: runFixture("created", {
            semanticEvaluationMode: "delivery-only",
            deckVersion: null,
            evaluationSnapshot: null,
          }),
        });
      },
    );

    const result = await createRehearsalRunForUpload(
      "project-a",
      "deck-a",
      3,
      fetcher,
    );

    expect(result).toMatchObject({
      evaluationSnapshotMismatch: true,
      run: { semanticEvaluationMode: "delivery-only" },
    });
    expect(bodies).toEqual([
      {
        deckId: "deck-a",
        expectedDeckVersion: 3,
        semanticEvaluationMode: "full",
      },
      {
        deckId: "deck-a",
        expectedDeckVersion: 3,
        semanticEvaluationMode: "delivery-only",
      },
    ]);
  });

  it("continues with a provisional snapshot when initial server run creation is offline", async () => {
    const deck = createDemoDeck();
    const result = await prepareRehearsalEvaluationRun(
      deck,
      vi.fn(async () => {
        throw new TypeError("network offline");
      }),
    );

    expect(result.run).toBeNull();
    expect(result.evaluationSnapshot).toMatchObject({
      deckId: deck.deckId,
      deckVersion: deck.version,
    });
    expect(result.serverEvaluation).toEqual({
      state: "unavailable",
      reason: "network_error",
    });
  });

  it("builds P3 cue and keyword inputs from the immutable snapshot", () => {
    const deck = createDemoDeck();
    deck.slides[0]!.speakerNotes = "현재 로컬 발표자 노트";
    deck.slides[0]!.keywords = [
      {
        keywordId: "kw_snapshot",
        text: "SNAPSHOT",
        synonyms: ["고정 키워드"],
        abbreviations: [],
        required: true,
      },
    ];
    const snapshot = createRehearsalEvaluationSnapshot(deck);
    deck.slides[0]!.keywords[0]!.text = "LIVE EDIT";

    const slides = buildP3SessionSlides(deck, snapshot);

    expect(slides[0]?.keywords[0]?.text).toBe("SNAPSHOT");
    expect(slides[0]?.speakerNotes).toBe("현재 로컬 발표자 노트");
  });

  it("reuses the pre-created run while uploading, completing, and polling", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });

        if (url === "/api/v1/rehearsals/run-1/audio/upload-url") {
          return jsonResponse({
            run: runFixture("uploading", { audioFileId: "file-audio" }),
            upload: {
              fileId: "file-audio",
              projectId: "project-a",
              uploadUrl: "http://storage.local/rehearsal.webm",
              method: "PUT",
              headers: { "content-type": "audio/webm" },
              expiresAt: "2026-06-29T00:15:00.000Z",
              purpose: "rehearsal-audio",
            },
          });
        }

        if (url === "http://storage.local/rehearsal.webm") {
          return new Response(null, { status: 200 });
        }

        if (url === "/api/v1/rehearsals/run-1/meta") {
          return jsonResponse({ run: runFixture("uploading") });
        }

        if (url === "/api/v1/rehearsals/run-1/audio/complete") {
          return jsonResponse({
            run: runFixture("processing", {
              audioFileId: "file-audio",
              jobId: "job-1",
            }),
            job: jobFixture("queued", 0),
          });
        }

        if (url === "/api/jobs/job-1") {
          const count = calls.filter(
            (call) => call.url === "/api/jobs/job-1",
          ).length;
          return jsonResponse(
            count === 1
              ? jobFixture("running", 40)
              : jobFixture("succeeded", 100),
          );
        }

        if (url === "/api/v1/rehearsals/run-1") {
          return jsonResponse({
            run: runFixture("succeeded", {
              audioFileId: "file-audio",
              jobId: "job-1",
              rawAudioDeletedAt: "2026-06-29T00:00:10.000Z",
            }),
          });
        }

        return new Response("unexpected", { status: 500 });
      },
    );
    const audioFile = new File(["audio"], "rehearsal.webm", {
      type: "audio/webm",
    });

    const result = await runRehearsalUploadFlow({
      runId: "run-1",
      audioFile,
      liveTranscript: "브라우저에서 인식한 전체 문장",
      slideTranscriptSnapshots: [
        {
          slideId: "slide_1",
          slideNum: 1,
          visitedVer: 1,
          transcript: "첫 문장",
          visitedAt: "2026-07-20T04:00:00.000Z",
          capturedAt: "2026-07-20T04:01:00.000Z",
          reason: "rehearsal-end",
        },
      ],
      slideTimeline: [
        { slideId: "slide_1", enteredAt: "2026-06-29T00:00:00.000Z" },
      ],
      fetcher,
      pollDelayMs: 0,
    });

    expect(result.run.status).toBe("succeeded");
    expect(result.job.status).toBe("succeeded");
    expect(calls.map((call) => call.url)).toEqual([
      "/api/v1/rehearsals/run-1/audio/upload-url",
      "http://storage.local/rehearsal.webm",
      "/api/v1/rehearsals/run-1/meta",
      "/api/v1/rehearsals/run-1/audio/complete",
      "/api/jobs/job-1",
      "/api/jobs/job-1",
      "/api/v1/rehearsals/run-1",
    ]);
    expect(calls[1]?.init).toMatchObject({
      method: "PUT",
      headers: { "content-type": "audio/webm" },
      body: audioFile,
    });
    expect(calls[2]?.init).toMatchObject({
      method: "PATCH",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({
      fileId: "file-audio",
      liveTranscript: "브라우저에서 인식한 전체 문장",
      slideTranscriptSnapshots: [
        {
          slideId: "slide_1",
          slideNum: 1,
          visitedVer: 1,
          transcript: "첫 문장",
          visitedAt: "2026-07-20T04:00:00.000Z",
          capturedAt: "2026-07-20T04:01:00.000Z",
          reason: "rehearsal-end",
        },
      ],
    });
  });

  it("stops before complete when storage upload is interrupted", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);

      if (url === "/api/v1/rehearsals/run-1/audio/upload-url") {
        return jsonResponse({
          run: runFixture("uploading", { audioFileId: "file-audio" }),
          upload: {
            fileId: "file-audio",
            projectId: "project-a",
            uploadUrl: "http://storage.local/rehearsal.webm",
            method: "PUT",
            headers: { "content-type": "audio/webm" },
            expiresAt: "2026-06-29T00:15:00.000Z",
            purpose: "rehearsal-audio",
          },
        });
      }

      if (url === "http://storage.local/rehearsal.webm") {
        return new Response("network interrupted", { status: 503 });
      }

      return new Response("unexpected", { status: 500 });
    });

    await expect(
      runRehearsalUploadFlow({
        runId: "run-1",
        audioFile: new File(["audio"], "rehearsal.webm", {
          type: "audio/webm",
        }),
        fetcher,
        pollDelayMs: 0,
      }),
    ).rejects.toMatchObject({
      stage: "storage-put",
    } satisfies Partial<RehearsalFlowError>);

    expect(calls).toEqual([
      "/api/v1/rehearsals/run-1/audio/upload-url",
      "http://storage.local/rehearsal.webm",
    ]);
  });

  it("loads the official report for a rehearsal run", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        run: runFixture("succeeded"),
        report: reportFixture(),
      }),
    );

    const result = await fetchRehearsalReport("run-1", fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/v1/rehearsals/run-1/report");
    expect(result.report?.transcriptRetained).toBe(false);
    expect(result.report?.transcript).toBeNull();
  });

  it("queues a semantic evaluation retry without sending report data", async () => {
    const job = jobFixture("queued", 0);
    const fetcher = vi.fn(async () => jsonResponse({ job }));

    const result = await retryRehearsalSemanticEvaluation("run-1", fetcher);

    expect(result).toEqual(job);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/rehearsals/run-1/semantic-evaluation/retry",
      { method: "POST" },
    );
  });

  it("uses presenter-facing copy when retry evidence has expired", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          code: "REHEARSAL_SEMANTIC_EVIDENCE_EXPIRED",
          message: "internal retry detail",
          retryable: false,
        },
        409,
      ),
    );

    await expect(
      retryRehearsalSemanticEvaluation("run-1", fetcher),
    ).rejects.toMatchObject({
      message: "재평가 가능 시간이 지났습니다. 새 리허설을 시작해 주세요.",
      stage: "semantic-retry",
      status: 409,
    });
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

function jobFixture(status: Job["status"], progress: number): Job {
  return {
    jobId: "job-1",
    projectId: "project-a",
    type: "rehearsal-stt",
    status,
    progress,
    message: status,
    result: null,
    error: null,
    createdAt,
    updatedAt: createdAt,
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

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}
