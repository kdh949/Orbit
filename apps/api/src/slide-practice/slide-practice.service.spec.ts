import { createDemoDeck } from "@orbit/editor-core";
import {
  slideQuestionGuideTextHashInput,
  type SlidePracticeReportV3,
} from "@orbit/shared/slide-practice";
import { ConflictException } from "@nestjs/common";
import type { DataSource } from "typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: {
    SLIDE_PRACTICE_ENABLED: true,
    JOB_QUEUE_DRIVER: "memory",
    REDIS_URL: "redis://unused",
  },
}));

vi.mock("@orbit/config", () => ({ loadOrbitConfig: () => mocks.config }));

import { sha256Canonical } from "../practice-goals/evaluation-plan";
import { SlidePracticeService } from "./slide-practice.service";

describe("SlidePracticeService content hash", () => {
  beforeEach(() => {
    mocks.config.SLIDE_PRACTICE_ENABLED = true;
  });

  it("rejects a stale client hash before creating an audio upload", async () => {
    const harness = createHarness();
    const slide = harness.deck.slides[0]!;

    await expect(harness.service.createAnalysis(
      harness.deck.projectId,
      "user-1",
      analysisRequest(harness.deck, "b".repeat(64)),
    )).rejects.toMatchObject({
      response: { code: "SLIDE_PRACTICE_CONTENT_HASH_MISMATCH" },
    });
    expect(harness.files.createUploadUrl).not.toHaveBeenCalled();
    expect(sha256Canonical(slideQuestionGuideTextHashInput(slide))).not.toBe("b".repeat(64));
  });

  it("stores the server-computed hash for a new analysis", async () => {
    const harness = createHarness({ persistAnalysis: true });
    const slide = harness.deck.slides[0]!;
    const expectedHash = sha256Canonical(slideQuestionGuideTextHashInput(slide));

    await harness.service.createAnalysis(
      harness.deck.projectId,
      "user-1",
      analysisRequest(harness.deck, expectedHash),
    );

    expect(harness.insertedAnalysisParameters[9]).toBe("slide-text-v1");
    expect(harness.insertedAnalysisParameters[10]).toBe(expectedHash);
  });

  it("accepts a stale deck version when the target slide text hash is unchanged", async () => {
    const harness = createHarness({ persistAnalysis: true });
    const slide = harness.deck.slides[0]!;
    const expectedHash = sha256Canonical(slideQuestionGuideTextHashInput(slide));
    const request = {
      ...analysisRequest(harness.deck, expectedHash),
      deckVersion: harness.deck.version + 4,
      slideOrder: slide.order + 3,
    };

    await harness.service.createAnalysis(
      harness.deck.projectId,
      "user-1",
      request,
    );

    expect(harness.insertedAnalysisParameters[6]).toBe(harness.deck.version);
    expect(harness.insertedAnalysisParameters[8]).toBe(slide.order);
    expect(harness.files.createUploadUrl).toHaveBeenCalledOnce();
  });

  it("keeps strict deck version validation for legacy clients without a content hash", async () => {
    const harness = createHarness();
    const request = {
      ...analysisRequest(harness.deck, "a".repeat(64)),
      deckVersion: harness.deck.version + 1,
    } as Record<string, unknown>;
    delete request.contentHashVersion;
    delete request.slideContentHash;

    await expect(harness.service.createAnalysis(
      harness.deck.projectId,
      "user-1",
      request,
    )).rejects.toMatchObject({
      response: { code: "SLIDE_PRACTICE_DECK_VERSION_MISMATCH" },
    });
    expect(harness.files.createUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects a stale v3 report hash against the current deck", async () => {
    const harness = createHarness();
    const slide = harness.deck.slides[0]!;

    await expect(harness.service.createReport(
      harness.deck.projectId,
      "user-1",
      { clientRequestId: "report-request-1", report: reportV3(harness.deck, slide.slideId, slide.order, "c".repeat(64)) },
    )).rejects.toBeInstanceOf(ConflictException);
  });

  it("filters creator-private history by hash and metric definition v3", async () => {
    const harness = createHarness();
    const hash = "d".repeat(64);

    await harness.service.listReports(harness.deck.projectId, "user-1", {
      deckId: harness.deck.deckId,
      slideId: harness.deck.slides[0]!.slideId,
      slideContentHash: hash,
      limit: "5",
    });

    expect(harness.lastSql).toContain("slide_content_hash = $5");
    expect(harness.lastSql).toContain("metric_definition_version = 3");
    expect(harness.lastParameters).toEqual([
      harness.deck.projectId,
      "user-1",
      harness.deck.deckId,
      harness.deck.slides[0]!.slideId,
      hash,
      null,
      6,
    ]);
  });
});

function createHarness(options: { persistAnalysis?: boolean } = {}) {
  const deck = createDemoDeck();
  let lastSql = "";
  let lastParameters: unknown[] = [];
  const insertedAnalysisParameters: unknown[] = [];
  const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
    lastSql = sql.replace(/\s+/g, " ").trim();
    lastParameters = parameters;
    if (lastSql.startsWith("INSERT INTO slide_practice_audio_analyses")) {
      insertedAnalysisParameters.push(...parameters);
      if (!options.persistAnalysis) return [];
      return [{
        analysis_id: "analysis-1",
        project_id: deck.projectId,
        practice_session_id: "practice-1",
        status: "uploading",
        analysis_job_id: null,
        report_id: null,
        error_code: null,
        created_at: "2026-07-21T00:00:00.000Z",
        completed_at: null,
      }];
    }
    return [];
  });
  const files = {
    createUploadUrl: vi.fn(async () => ({
      fileId: "file-1",
      projectId: deck.projectId,
      uploadUrl: "http://127.0.0.1/upload/file-1",
      method: "PUT",
      headers: {},
      expiresAt: "2026-07-21T00:15:00.000Z",
      purpose: "slide-practice-audio",
    })),
  };
  const service = new SlidePracticeService(
    { query } as unknown as DataSource,
    { getDeck: vi.fn(async () => ({ deck })) } as never,
    files as never,
    {} as never,
    {} as never,
    { info: vi.fn() } as never,
  );
  return {
    deck,
    files,
    insertedAnalysisParameters,
    get lastSql() { return lastSql; },
    get lastParameters() { return lastParameters; },
    service,
  };
}

function analysisRequest(deck: ReturnType<typeof createDemoDeck>, slideContentHash: string) {
  const slide = deck.slides[0]!;
  return {
    clientRequestId: "analysis-request-1",
    practiceSessionId: "practice-1",
    deckId: deck.deckId,
    deckVersion: deck.version,
    slideId: slide.slideId,
    slideOrder: slide.order,
    startedAt: "2026-07-21T00:00:00.000Z",
    mimeType: "audio/webm",
    size: 1_024,
    deviceIdHash: null,
    contentHashVersion: "slide-text-v1",
    slideContentHash,
  } as const;
}

function reportV3(
  deck: ReturnType<typeof createDemoDeck>,
  slideId: string,
  slideOrder: number,
  slideContentHash: string,
): SlidePracticeReportV3 {
  return {
    reportVersion: 3,
    metricDefinitionVersion: 3,
    contentHashVersion: "slide-text-v1",
    slideContentHash,
    classifierVersion: 4,
    practiceSessionId: "practice-1",
    projectId: deck.projectId,
    deckId: deck.deckId,
    deckVersion: deck.version,
    slideId,
    slideOrder,
    startedAt: "2026-07-21T00:00:00.000Z",
    durationMs: 30_000,
    syllableCount: 100,
    meanRecognitionConfidence: 0.9,
    fillers: { policyVersion: 1, totalCount: 0, details: [] },
    voice: {
      activeSpeechMs: 25_000,
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
    style: { mode: "neutral", confidence: 0, evidenceLabels: ["판단 보류"], message: "판단을 보류했습니다." },
    quality: { state: "measured", reasons: [] },
    source: { kind: "server", sttEngine: "report-stt", deviceIdHash: null, baselineVersion: null },
  };
}
