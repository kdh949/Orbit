import { rehearsalReportSchema } from "@orbit/shared/rehearsals";
import type { DataSource } from "typeorm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { processRehearsalSemanticEvaluationJob } from "./rehearsal-semantic-evaluation.processor";

const payload = {
  jobId: "job-semantic-retry",
  projectId: "project-a",
  runId: "run-a",
};

describe("processRehearsalSemanticEvaluationJob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces only semantic report fields with recovered canonical outcomes", async () => {
    const recoveredReport = report(
      {
        state: "succeeded",
        measurementMode: "basic",
        reasons: [],
        retryable: false,
      },
      [coveredOutcome()],
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([jobRow("running", 60, null, null)])
      .mockResolvedValueOnce([{ report_json: recoveredReport }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        jobRow(
          "succeeded",
          100,
          { runId: "run-a", semanticCueOutcomeCount: 1 },
          null,
        ),
      ]);
    const cache = evidenceCache({
      segments: [{ startMs: 0, endMs: 1_500, text: "ORBIT 핵심 의미" }],
    });
    const events = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              semanticEvaluation: {
                state: "succeeded",
                measurementMode: "basic",
                reasons: [],
                retryable: false,
              },
              semanticCueOutcomes: [coveredOutcome()],
            }),
          ),
      ),
    );

    const job = await processRehearsalSemanticEvaluationJob(
      { query } as unknown as DataSource,
      "http://localhost:8000",
      payload,
      cache,
      events,
    );

    expect(job.status).toBe("succeeded");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/rehearsal/analyze-semantic-cues",
      expect.objectContaining({ method: "POST" }),
    );
    const requestBody = JSON.parse(
      String(vi.mocked(fetch).mock.calls[0]?.[1]?.body),
    );
    expect(requestBody).toMatchObject({
      runId: "run-a",
      evaluationSnapshot: evaluationSnapshot(),
      segments: [{ startMs: 0, endMs: 1_500, text: "ORBIT 핵심 의미" }],
    });
    const reportUpdate = query.mock.calls.find(([sql]) =>
      String(sql).includes("jsonb_set"),
    );
    expect(reportUpdate?.[0]).toContain("'{semanticEvaluation}'");
    expect(reportUpdate?.[0]).toContain("'{semanticCueOutcomes}'");
    expect(reportUpdate?.[0]).not.toContain("metrics");
    expect(reportUpdate?.[0]).not.toContain("coaching");
    expect(reportUpdate?.[1]).toEqual([
      "run-a",
      "project-a",
      JSON.stringify(recoveredReport.semanticEvaluation),
      JSON.stringify(recoveredReport.semanticCueOutcomes),
    ]);
    expect(recoveredReport.metrics.wordsPerMinute).toBe(121);
    expect(recoveredReport.coaching?.summary).toBe("delivery preserved");
    expect(events).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: "rehearsal.semantic_evaluation.succeeded",
        runId: "run-a",
        jobId: "job-semantic-retry",
        reasons: [],
      }),
    );
    expect(JSON.stringify(events.mock.calls)).not.toContain("ORBIT 핵심 의미");
  });

  it("fails safely without changing the report when cached evidence expired", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([
        jobRow("failed", 10, null, {
          code: "REHEARSAL_SEMANTIC_EVIDENCE_EXPIRED",
          message: "Rehearsal semantic evidence has expired.",
        }),
      ]);
    const events = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const job = await processRehearsalSemanticEvaluationJob(
      { query } as unknown as DataSource,
      "http://localhost:8000",
      payload,
      evidenceCache(null),
      events,
    );

    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("REHEARSAL_SEMANTIC_EVIDENCE_EXPIRED");
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes("jsonb_set")),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "rehearsal.semantic_evaluation.retry_failed",
        reason: "REHEARSAL_SEMANTIC_EVIDENCE_EXPIRED",
      }),
    );
  });

  it("keeps the previous report when the semantic endpoint still fails", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([jobRow("running", 60, null, null)])
      .mockResolvedValueOnce([
        jobRow("failed", 60, null, {
          code: "REHEARSAL_SEMANTIC_EVALUATION_FAILED",
          message: "server_evaluation_failed",
        }),
      ]);
    const events = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );

    const job = await processRehearsalSemanticEvaluationJob(
      { query } as unknown as DataSource,
      "http://localhost:8000",
      payload,
      evidenceCache({
        segments: [{ startMs: 0, endMs: 1_500, text: "재시도 발화" }],
      }),
      events,
    );

    expect(job.status).toBe("failed");
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes("jsonb_set")),
    ).toBe(false);
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "rehearsal.semantic_evaluation.retry_failed",
        reason: "REHEARSAL_SEMANTIC_EVALUATION_FAILED",
      }),
    );
    expect(JSON.stringify(events.mock.calls)).not.toContain("재시도 발화");
  });

  it("does not replace the previous report with another partial evaluation", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([jobRow("running", 60, null, null)])
      .mockResolvedValueOnce([
        jobRow("failed", 60, null, {
          code: "REHEARSAL_SEMANTIC_EVALUATION_INCOMPLETE",
          message: "timeout",
        }),
      ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              semanticEvaluation: {
                state: "partial",
                measurementMode: "none",
                reasons: ["timeout"],
                retryable: true,
              },
              semanticCueOutcomes: [unmeasuredOutcome()],
            }),
          ),
      ),
    );

    const job = await processRehearsalSemanticEvaluationJob(
      { query } as unknown as DataSource,
      "http://localhost:8000",
      payload,
      evidenceCache({
        segments: [{ startMs: 0, endMs: 1_500, text: "재시도 발화" }],
      }),
    );

    expect(job.error?.code).toBe("REHEARSAL_SEMANTIC_EVALUATION_INCOMPLETE");
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes("jsonb_set")),
    ).toBe(false);
  });

  it("finishes repeated work as an idempotent no-op after recovery", async () => {
    const recoveredReport = report(
      {
        state: "succeeded",
        measurementMode: "basic",
        reasons: [],
        retryable: false,
      },
      [coveredOutcome()],
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([runRow(recoveredReport)])
      .mockResolvedValueOnce([
        jobRow(
          "succeeded",
          100,
          { runId: "run-a", semanticCueOutcomeCount: 1 },
          null,
        ),
      ]);
    const cache = evidenceCache({
      segments: [{ startMs: 0, endMs: 500, text: "호출되지 않을 발화" }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const job = await processRehearsalSemanticEvaluationJob(
      { query } as unknown as DataSource,
      "http://localhost:8000",
      payload,
      cache,
    );

    expect(job.status).toBe("succeeded");
    expect(cache.getSemanticEvidence).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes("jsonb_set")),
    ).toBe(false);
  });

  it("does not overwrite a concurrent retry that recovered first", async () => {
    const recoveredReport = report(
      {
        state: "succeeded",
        measurementMode: "basic",
        reasons: [],
        retryable: false,
      },
      [coveredOutcome()],
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([jobRow("running", 60, null, null)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ report_json: recoveredReport }])
      .mockResolvedValueOnce([
        jobRow(
          "succeeded",
          100,
          { runId: "run-a", semanticCueOutcomeCount: 1 },
          null,
        ),
      ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              semanticEvaluation: recoveredReport.semanticEvaluation,
              semanticCueOutcomes: recoveredReport.semanticCueOutcomes,
            }),
          ),
      ),
    );

    const job = await processRehearsalSemanticEvaluationJob(
      { query } as unknown as DataSource,
      "http://localhost:8000",
      payload,
      evidenceCache({
        segments: [{ startMs: 0, endMs: 500, text: "동시 재시도 발화" }],
      }),
    );

    expect(job.status).toBe("succeeded");
    const reportUpdate = query.mock.calls.find(([sql]) =>
      String(sql).includes("jsonb_set"),
    );
    expect(reportUpdate?.[0]).toContain(
      "report_json #>> '{semanticEvaluation,retryable}' = 'true'",
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SELECT report_json"),
      ["run-a", "project-a"],
    );
  });
});

function evidenceCache(
  value: {
    segments: Array<{ startMs: number; endMs: number; text: string }>;
  } | null,
) {
  return {
    set: vi.fn(async () => undefined),
    setSemanticEvidence: vi.fn(async () => undefined),
    getSemanticEvidence: vi.fn(async () => value),
    close: vi.fn(async () => undefined),
  };
}

function runRow(
  reportJson = report(
    {
      state: "partial",
      measurementMode: "none",
      reasons: ["timeout"],
      retryable: true,
    },
    [unmeasuredOutcome()],
  ),
) {
  return {
    run_id: "run-a",
    project_id: "project-a",
    deck_id: "deck-a",
    status: "succeeded",
    semantic_evaluation_mode: "full",
    evaluation_snapshot_json: evaluationSnapshot(),
    meta_json: {
      slideTimeline: [
        { slideId: "slide_1", enteredAt: "2026-07-10T00:00:00.000Z" },
      ],
      missedKeywords: [],
      adviceEvents: [],
      utteranceOutcomes: [],
      semanticCueDecisions: [],
      semanticCapabilityEvents: [],
    },
    report_json: reportJson,
  };
}

function report(
  semanticEvaluation: {
    state: "succeeded" | "partial" | "unavailable";
    measurementMode: "full" | "basic" | "none";
    reasons: Array<"timeout">;
    retryable: boolean;
  },
  semanticCueOutcomes: Array<Record<string, unknown>>,
) {
  return rehearsalReportSchema.parse({
    reportId: "report_run-a",
    runId: "run-a",
    projectId: "project-a",
    deckId: "deck-a",
    transcriptRetained: false,
    transcript: null,
    metrics: {
      durationSeconds: 10,
      wordsPerMinute: 121,
      fillerWordCount: 1,
      longSilenceCount: null,
      keywordCoverage: 1,
    },
    semanticEvaluation,
    semanticCueOutcomes,
    coaching: {
      status: "succeeded",
      summary: "delivery preserved",
      strengths: [],
      improvements: [],
      nextPracticeFocus: "도입부",
      message: "",
    },
    generatedAt: "2026-07-10T00:00:10.000Z",
  });
}

function evaluationSnapshot() {
  return {
    deckId: "deck-a",
    deckVersion: 7,
    capturedAt: "2026-07-10T00:00:00.000Z",
    slides: [
      {
        slideId: "slide_1",
        order: 1,
        title: "첫 슬라이드",
        estimatedSeconds: 30,
        keywords: [],
        semanticCues: [
          {
            cueId: "scue_1",
            slideId: "slide_1",
            meaning: "핵심 의미",
            reportLabel: "핵심 의미",
            importance: "core",
            reviewStatus: "approved",
            freshness: "current",
            origin: "manual",
            revision: 1,
            sourceRefs: [],
            qualityWarnings: [],
            required: true,
            priority: 1,
            candidateKeywords: ["ORBIT"],
            aliases: {},
            requiredConcepts: ["ORBIT"],
            nliHypotheses: ["발표자는 ORBIT을 설명했다"],
            negativeHints: [],
            targetElementIds: [],
            triggerActionIds: [],
          },
        ],
      },
    ],
  };
}

function coveredOutcome() {
  return {
    slideId: "slide_1",
    cueId: "scue_1",
    cueRevision: 1,
    cueMeaningSnapshot: "핵심 의미",
    reportLabelSnapshot: "핵심 의미",
    importance: "core",
    status: "covered",
    confidence: 1,
    matchedBy: "lexical",
    measurementMode: "basic",
    fallbackUsed: false,
    coveredConcepts: ["ORBIT"],
    missingConcepts: [],
  };
}

function unmeasuredOutcome() {
  return {
    slideId: "slide_1",
    cueId: "scue_1",
    cueRevision: 1,
    cueMeaningSnapshot: "핵심 의미",
    reportLabelSnapshot: "핵심 의미",
    importance: "core",
    status: "unmeasured",
    measurementMode: "none",
    fallbackUsed: true,
    fallbackReason: "timeout",
    unmeasuredReason: "timeout",
    coveredConcepts: [],
    missingConcepts: ["ORBIT"],
  };
}

function jobRow(
  status: "running" | "succeeded" | "failed",
  progress: number,
  result: Record<string, unknown> | null,
  error: { code: string; message: string } | null,
) {
  return {
    job_id: "job-semantic-retry",
    project_id: "project-a",
    type: "rehearsal-semantic-evaluation",
    status,
    progress,
    message: status,
    result,
    error,
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:01.000Z",
  };
}
