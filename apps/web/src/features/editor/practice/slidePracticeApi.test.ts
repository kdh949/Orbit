import type { SlidePracticeReportRecord } from "@orbit/shared/slide-practice";
import { afterEach, describe, expect, it, vi } from "vitest";

import { submitSlidePracticeAudio } from "./slidePracticeApi";

afterEach(() => vi.unstubAllGlobals());

describe("submitSlidePracticeAudio", () => {
  it("uploads private audio and returns the server-derived report", async () => {
    const report = serverReport();
    const fetcher = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(request);
      if (url.endsWith("/slide-practice-analyses")) {
        return new Response(JSON.stringify({
          analysis: analysis("uploading", null),
          upload: {
            fileId: "file-audio",
            projectId: "project-1",
            uploadUrl: "https://upload.invalid/slide.webm",
            method: "PUT",
            headers: { "content-type": "audio/webm" },
            expiresAt: "2026-07-17T00:15:00.000Z",
            purpose: "slide-practice-audio",
          },
        }), { status: 200 });
      }
      if (url === "https://upload.invalid/slide.webm") return new Response(null, { status: 200 });
      return new Response(JSON.stringify({
        analysis: analysis("succeeded", report.reportId),
        report,
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);

    const result = await submitSlidePracticeAudio({
      projectId: "project-1",
      practiceSessionId: "practice-1",
      deckId: "deck-1",
      deckVersion: 2,
      slideId: "slide-1",
      slideOrder: 0,
      slideContentHash: "a".repeat(64),
      startedAt: "2026-07-17T00:00:00.000Z",
      deviceIdHash: "device-hash",
      blob: new Blob(["audio"], { type: "audio/webm;codecs=opus" }),
      durationMs: 10_000,
    });

    expect(result.reportId).toBe("report-1");
    const createBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(createBody.mimeType).toBe("audio/webm");
    expect(createBody.contentHashVersion).toBe("slide-text-v1");
    expect(createBody.slideContentHash).toBe("a".repeat(64));
    expect(createBody).not.toHaveProperty("transcript");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("shows an upload-specific message when the browser cannot reach the upload URL", async () => {
    const fetcher = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request);
      if (url.endsWith("/slide-practice-analyses")) {
        return new Response(JSON.stringify({
          analysis: analysis("uploading", null),
          upload: {
            fileId: "file-audio",
            projectId: "project-1",
            uploadUrl: "http://localhost:5173/api/v1/projects/project-1/assets/file-audio/content",
            method: "PUT",
            headers: { "content-type": "audio/webm" },
            expiresAt: "2026-07-17T00:15:00.000Z",
            purpose: "slide-practice-audio",
          },
        }), { status: 201 });
      }
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetcher);

    await expect(submitSlidePracticeAudio({
      projectId: "project-1",
      practiceSessionId: "practice-1",
      deckId: "deck-1",
      deckVersion: 2,
      slideId: "slide-1",
      slideOrder: 0,
      slideContentHash: "a".repeat(64),
      startedAt: "2026-07-17T00:00:00.000Z",
      deviceIdHash: "device-hash",
      blob: new Blob(["audio"], { type: "audio/webm;codecs=opus" }),
      durationMs: 10_000,
    })).rejects.toThrow("연습 녹음 업로드 서버에 연결하지 못했습니다.");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

function analysis(status: "uploading" | "succeeded", reportId: string | null) {
  return {
    analysisId: "analysis-1",
    projectId: "project-1",
    practiceSessionId: "practice-1",
    status,
    analysisJobId: status === "succeeded" ? "job-1" : null,
    reportId,
    errorCode: null,
    createdAt: "2026-07-17T00:00:01.000Z",
    completedAt: status === "succeeded" ? "2026-07-17T00:00:10.000Z" : null,
  };
}

function serverReport(): SlidePracticeReportRecord {
  return {
    reportVersion: 1,
    metricDefinitionVersion: 2,
    classifierVersion: 3,
    reportId: "report-1",
    practiceSessionId: "practice-1",
    projectId: "project-1",
    deckId: "deck-1",
    deckVersion: 2,
    slideId: "slide-1",
    slideOrder: 0,
    startedAt: "2026-07-17T00:00:00.000Z",
    durationMs: 10_000,
    syllableCount: 30,
    meanRecognitionConfidence: null,
    fillers: { policyVersion: 1, totalCount: 1, details: [{ word: "음", count: 1 }] },
    voice: {
      activeSpeechMs: 8_000,
      pauseRatio: 0.2,
      pitchMedianHz: 180,
      pitchSpanHz: 30,
      pitchValidRatio: 0.8,
      loudnessDb: -40,
      loudnessMadDb: 2,
      syllablesPerSecond: 3.75,
      signalToNoiseDb: 20,
      breathinessRatio: 0.2,
      clarityRatio: 0.7,
      rhythmRegularity: 0.8,
      clippingRatio: 0,
    },
    style: {
      mode: "lullaby",
      confidence: 0.82,
      evidenceLabels: ["목소리가 작아요", "억양 변화가 적어요"],
      message: "자장가처럼 차분해요.",
    },
    quality: { state: "measured", reasons: [] },
    source: {
      kind: "server",
      sttEngine: "report-stt",
      deviceIdHash: "device-hash",
      baselineVersion: 1,
    },
    createdBy: "user-1",
    createdAt: "2026-07-17T00:00:10.000Z",
    expiresAt: "2026-10-15T00:00:10.000Z",
  };
}
