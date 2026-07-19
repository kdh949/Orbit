import { describe, expect, it } from "vitest";

import {
  deckExportEnqueueErrorSchema,
  deckExportJobResultSchema,
  deckExportRequestSchema
} from "./deck-export.schema";

describe("deckExportRequestSchema", () => {
  it("defaults to PPTX export", () => {
    const request = deckExportRequestSchema.parse({});

    expect(request).toEqual({ format: "pptx" });
  });

  it("accepts one optional presentation session for static Activity results", () => {
    expect(
      deckExportRequestSchema.parse({ presentationSessionId: "session_1" }),
    ).toEqual({ format: "pptx", presentationSessionId: "session_1" });
    expect(
      deckExportRequestSchema.safeParse({
        presentationSessionId: "session_1",
        rawResponse: "forbidden",
      }).success,
    ).toBe(false);
  });

  it("accepts an all-slide PNG ZIP export", () => {
    expect(deckExportRequestSchema.parse({ format: "png" })).toEqual({
      format: "png"
    });
  });
});

describe("deckExportEnqueueErrorSchema", () => {
  it("keeps the failed Job and API error code consistent", () => {
    const parsed = deckExportEnqueueErrorSchema.parse({
      code: "DECK_EXPORT_ENQUEUE_FAILED",
      message: "Deck export queue is unavailable.",
      job: {
        jobId: "job_export_failed",
        projectId: "project_1",
        type: "deck-export",
        status: "failed",
        progress: 0,
        message: "Deck export queue is unavailable.",
        result: null,
        error: {
          code: "DECK_EXPORT_ENQUEUE_FAILED",
          message: "Deck export queue is unavailable.",
          retryable: true,
        },
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:01.000Z",
      },
    });

    expect(parsed.job.error?.code).toBe(parsed.code);
    expect(parsed.job.status).toBe("failed");
  });
});

describe("deckExportJobResultSchema", () => {
  it("accepts the worker PPTX export result payload", () => {
    const result = deckExportJobResultSchema.parse({
      deckId: "deck_ai_1",
      fileId: "file_export_1",
      url: "/api/v1/files/file_export_1/download",
      format: "pptx",
      warnings: ["Skipped unsupported gradient fill."]
    });

    expect(result.format).toBe("pptx");
  });

  it("identifies a PNG ZIP result by its requested format", () => {
    expect(
      deckExportJobResultSchema.parse({
        deckId: "deck_ai_1",
        fileId: "file_export_2",
        url: "/api/v1/files/file_export_2/download",
        format: "png",
        warnings: []
      }).format
    ).toBe("png");
  });
});
