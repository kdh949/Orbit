import { describe, expect, it } from "vitest";

import { maxRehearsalAudioUploadSizeBytes } from "../files/file.schema";
import {
  beginRehearsalAudioUploadRequestSchema,
  completeRehearsalAudioChunkUploadRequestSchema,
  completeRehearsalAudioUploadRequestSchema,
  createRehearsalAudioClipRequestSchema,
  createRehearsalAudioUploadUrlRequestSchema,
  getRehearsalReportResponseSchema,
  rehearsalRecordingDurationSecondsSchema,
  rehearsalRunMetaSchema,
  uploadRehearsalAudioChunkParamsSchema,
} from "./rehearsal.schema";

describe("getRehearsalReportResponseSchema", () => {
  it("allows report to be null while the run is not ready", () => {
    const response = getRehearsalReportResponseSchema.parse({
      run: {
        runId: "run_1",
        projectId: "project_demo_1",
        deckId: "deck_demo_1",
        audioFileId: "file_audio_1",
        jobId: "job_1",
        status: "processing",
        error: null,
        rawAudioDeletedAt: null,
        createdAt: "2026-06-29T00:00:00.000Z",
        updatedAt: "2026-06-29T00:00:05.000Z",
      },
      report: null,
    });

    expect(response.run.status).toBe("processing");
    expect(response.report).toBeNull();
  });
});

describe("createRehearsalAudioClipRequestSchema", () => {
  it("accepts positive clips up to sixty seconds", () => {
    expect(
      createRehearsalAudioClipRequestSchema.parse({
        startSeconds: 10,
        endSeconds: 12.5,
      }),
    ).toEqual({ startSeconds: 10, endSeconds: 12.5 });
  });

  it("rejects reversed and overlong clip ranges", () => {
    expect(
      createRehearsalAudioClipRequestSchema.safeParse({
        startSeconds: 10,
        endSeconds: 9,
      }).success,
    ).toBe(false);
    expect(
      createRehearsalAudioClipRequestSchema.safeParse({
        startSeconds: 0,
        endSeconds: 60.1,
      }).success,
    ).toBe(false);
  });
});
describe("createRehearsalAudioUploadUrlRequestSchema", () => {
  it("accepts audio MIME types without exposing purpose in the request", () => {
    const request = createRehearsalAudioUploadUrlRequestSchema.parse({
      originalName: "rehearsal.webm",
      mimeType: "audio/webm",
      size: maxRehearsalAudioUploadSizeBytes,
    });

    expect(request.mimeType).toBe("audio/webm");
  });

  it("accepts report STT MIME aliases including FLAC", () => {
    for (const mimeType of [
      "audio/mp3",
      "audio/ogg",
      "audio/flac",
      "audio/x-m4a",
    ] as const) {
      const request = createRehearsalAudioUploadUrlRequestSchema.parse({
        originalName: "rehearsal.audio",
        mimeType,
        size: 1024,
      });

      expect(request.mimeType).toBe(mimeType);
    }
  });

  it("rejects non-audio MIME types", () => {
    const result = createRehearsalAudioUploadUrlRequestSchema.safeParse({
      originalName: "slides.pdf",
      mimeType: "application/pdf",
      size: 1024,
    });

    expect(result.success).toBe(false);
  });

  it("rejects MIME types outside the rehearsal audio contract", () => {
    for (const mimeType of ["audio/aac"] as const) {
      const result = createRehearsalAudioUploadUrlRequestSchema.safeParse({
        originalName: "rehearsal.audio",
        mimeType,
        size: 1024,
      });

      expect(result.success).toBe(false);
    }
  });

  it("defers runtime upload size limits to the service schema", () => {
    const request = createRehearsalAudioUploadUrlRequestSchema.parse({
      originalName: "rehearsal.webm",
      mimeType: "audio/webm",
      size: maxRehearsalAudioUploadSizeBytes + 1,
    });

    expect(request.size).toBe(maxRehearsalAudioUploadSizeBytes + 1);
  });
});

describe("beginRehearsalAudioUploadRequestSchema", () => {
  it("accepts only the FLAC chunk profile used by the presenter recorder", () => {
    const request = beginRehearsalAudioUploadRequestSchema.parse({
      codec: "flac",
      sampleRate: 16000,
      channels: 1,
      chunkDurationMs: 30000,
    });

    expect(request.codec).toBe("flac");
  });

  it.each([
    ["sampleRate", 48000],
    ["channels", 2],
    ["chunkDurationMs", 10000],
  ])("rejects unsupported chunk %s", (field, value) => {
    const result = beginRehearsalAudioUploadRequestSchema.safeParse({
      codec: "flac",
      sampleRate: 16000,
      channels: 1,
      chunkDurationMs: 30000,
      [field]: value,
    });

    expect(result.success).toBe(false);
  });
});

describe("uploadRehearsalAudioChunkParamsSchema", () => {
  it("accepts a runId and zero-based chunk index", () => {
    const params = uploadRehearsalAudioChunkParamsSchema.parse({
      runId: "run_1",
      index: "0",
    });

    expect(params.index).toBe(0);
  });

  it("rejects negative chunk indexes", () => {
    const result = uploadRehearsalAudioChunkParamsSchema.safeParse({
      runId: "run_1",
      index: -1,
    });

    expect(result.success).toBe(false);
  });
});

describe("completeRehearsalAudioUploadRequestSchema", () => {
  it("keeps the legacy complete request as fileId for upload-url compatibility", () => {
    const request = completeRehearsalAudioUploadRequestSchema.parse({
      fileId: "file_audio_1",
    });

    expect(request.fileId).toBe("file_audio_1");
    expect(request.recordingDurationSeconds).toBeNull();
    expect(request.liveTranscript).toBeNull();
    expect(request.slideTranscriptSnapshots).toEqual([]);
  });

  it("accepts the accumulated browser live transcript", () => {
    const request = completeRehearsalAudioUploadRequestSchema.parse({
      fileId: "file_audio_1",
      liveTranscript: "첫 문장 두 번째 문장",
    });

    expect(request.liveTranscript).toBe("첫 문장 두 번째 문장");
  });
});

describe("completeRehearsalAudioChunkUploadRequestSchema", () => {
  it("accepts the final chunk manifest", () => {
    const manifest = completeRehearsalAudioChunkUploadRequestSchema.parse({
      chunkCount: 3,
      totalDurationMs: 90000,
      totalSizeBytes: 1024,
      sha256: "a".repeat(64),
    });

    expect(manifest.chunkCount).toBe(3);
    expect(manifest.recordingDurationSeconds).toBeNull();
  });

  it.each([
    ["chunkCount", 0],
    ["totalDurationMs", 0],
    ["totalSizeBytes", 0],
    ["sha256", "not-a-sha"],
  ])("rejects invalid complete manifest %s", (field, value) => {
    const result = completeRehearsalAudioChunkUploadRequestSchema.safeParse({
      chunkCount: 3,
      totalDurationMs: 90000,
      totalSizeBytes: 1024,
      sha256: "a".repeat(64),
      [field]: value,
    });

    expect(result.success).toBe(false);
  });
});

describe("rehearsalRecordingDurationSecondsSchema", () => {
  it("preserves the same measured duration across complete requests and run meta", () => {
    const recordingDurationSeconds = 90.25;
    const legacyComplete = completeRehearsalAudioUploadRequestSchema.parse({
      fileId: "file_audio_1",
      recordingDurationSeconds,
    });
    const chunkComplete = completeRehearsalAudioChunkUploadRequestSchema.parse({
      chunkCount: 3,
      totalDurationMs: 90000,
      totalSizeBytes: 1024,
      sha256: "a".repeat(64),
      recordingDurationSeconds,
    });
    const runMeta = rehearsalRunMetaSchema.parse({ recordingDurationSeconds });

    expect([
      legacyComplete.recordingDurationSeconds,
      chunkComplete.recordingDurationSeconds,
      runMeta.recordingDurationSeconds,
    ]).toEqual([
      recordingDurationSeconds,
      recordingDurationSeconds,
      recordingDurationSeconds,
    ]);
  });

  it("defaults missing recording duration to null for legacy payloads", () => {
    expect(rehearsalRecordingDurationSecondsSchema.parse(undefined)).toBeNull();
    expect(
      rehearsalRunMetaSchema.parse({}).recordingDurationSeconds,
    ).toBeNull();
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])(
    "rejects %s recording duration across every transport",
    (_label, value) => {
      expect(
        rehearsalRecordingDurationSecondsSchema.safeParse(value).success,
      ).toBe(false);
      expect(
        completeRehearsalAudioUploadRequestSchema.safeParse({
          fileId: "file_audio_1",
          recordingDurationSeconds: value,
        }).success,
      ).toBe(false);
      expect(
        completeRehearsalAudioChunkUploadRequestSchema.safeParse({
          chunkCount: 3,
          totalDurationMs: 90000,
          totalSizeBytes: 1024,
          sha256: "a".repeat(64),
          recordingDurationSeconds: value,
        }).success,
      ).toBe(false);
      expect(
        rehearsalRunMetaSchema.safeParse({ recordingDurationSeconds: value })
          .success,
      ).toBe(false);
    },
  );
});
