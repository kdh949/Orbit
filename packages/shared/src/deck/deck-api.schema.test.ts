import { describe, expect, it } from "vitest";

import {
  appendDeckPatchAckResponseSchema,
  appendDeckPatchRequestSchema,
  getPptxImportQualityResponseSchema,
  getOoxmlSyncStateResponseSchema,
  putDeckResponseSchema,
  retryOoxmlSyncResponseSchema,
  restoreDeckSnapshotResponseSchema,
} from "./deck-api.schema";

const importQualityReport = {
  compositeScore: 82,
  metrics: {
    geometry: 90,
    text: 80,
    color: 80,
    layer: 90,
    editability: 60,
    pixelSimilarity: null,
  },
  weights: {
    geometry: 25 as const,
    text: 15 as const,
    color: 10 as const,
    layer: 10 as const,
    editability: 10 as const,
    pixelSimilarity: 30 as const,
  },
  editabilityCoverage: 0.6,
  appliedCap: null,
  slideReports: [],
  notes: ["pixel renderer unavailable"],
};

describe("PPTX import quality API schema", () => {
  it("accepts persisted quality and an absent import sidecar", () => {
    expect(
      getPptxImportQualityResponseSchema.parse({
        importQuality: { qualityReport: importQualityReport },
      }),
    ).toEqual({ importQuality: { qualityReport: importQualityReport } });
    expect(
      getPptxImportQualityResponseSchema.parse({ importQuality: null }),
    ).toEqual({ importQuality: null });
  });
});

describe("OOXML sync state API schema", () => {
  const state = {
    status: "stale" as const,
    deckId: "deck_test_1",
    deckVersion: 145,
    syncedDeckVersion: 1,
    retryable: true,
  };

  it("accepts stale state with the synced package version", () => {
    expect(
      getOoxmlSyncStateResponseSchema.parse({ ooxmlSyncState: state }),
    ).toEqual({ ooxmlSyncState: state });
  });

  it("accepts the retry response contract", () => {
    const parsed = retryOoxmlSyncResponseSchema.parse({
      ooxmlSyncState: {
        ...state,
        status: "pending",
        retryable: false,
        job: {
          jobId: "job_sync_retry_1",
          projectId: "project_test_1",
          type: "pptx-ooxml-sync",
          status: "queued",
          progress: 0,
          message: "Job queued",
          result: null,
          error: null,
          createdAt: "2026-07-18T00:00:00.000Z",
          updatedAt: "2026-07-18T00:00:00.000Z",
        },
      },
    });

    expect(parsed.ooxmlSyncState.status).toBe("pending");
  });
});

const changeRecord = {
  changeId: "change_test_1",
  deckId: "deck_test_1",
  beforeVersion: 1,
  afterVersion: 2,
  source: "user" as const,
  operations: [{ type: "update_deck" as const, title: "Updated" }],
  createdAt: "2026-07-10T00:00:00.000Z",
};

describe("deck patch ack API schema", () => {
  it("accepts the optional ack response mode", () => {
    const request = appendDeckPatchRequestSchema.parse({
      patch: {
        deckId: "deck_test_1",
        baseVersion: 1,
        source: "user",
        operations: [{ type: "update_deck", title: "Updated" }],
      },
      responseMode: "ack",
    });

    expect(request.responseMode).toBe("ack");
  });

  it("validates a lightweight response without a deck", () => {
    const response = appendDeckPatchAckResponseSchema.parse({
      deckId: "deck_test_1",
      version: 2,
      changeRecord,
      updatedAt: "2026-07-10T00:00:00.000Z",
    });

    expect(response).not.toHaveProperty("deck");
    expect(response.version).toBe(2);
  });

  it("rejects an ack version that differs from the change record", () => {
    expect(() =>
      appendDeckPatchAckResponseSchema.parse({
        deckId: "deck_test_1",
        version: 3,
        changeRecord,
        updatedAt: "2026-07-10T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("put deck API schema", () => {
  it("accepts an optional OOXML sync job", () => {
    const response = putDeckResponseSchema.parse({
      deck: {
        deckId: "deck_test_1",
        projectId: "project_test_1",
        title: "Imported deck",
        version: 2,
        metadata: { language: "ko", locale: "ko-KR" },
        canvas: {
          preset: "wide-16-9",
          width: 1920,
          height: 1080,
          aspectRatio: "16:9",
        },
        slides: [{ slideId: "slide_test_1", order: 1, title: "Slide" }],
      },
      snapshot: {
        snapshotId: "snapshot_test_1",
        projectId: "project_test_1",
        deckId: "deck_test_1",
        version: 2,
        reason: "deck-replaced",
        createdAt: "2026-07-10T00:00:00.000Z",
      },
      ooxmlSyncJob: {
        jobId: "job_sync_1",
        projectId: "project_test_1",
        type: "pptx-ooxml-sync",
        status: "queued",
        progress: 0,
        message: "Job queued",
        result: null,
        error: null,
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
      updatedAt: "2026-07-10T00:00:00.000Z",
    });

    expect(response.ooxmlSyncJob?.type).toBe("pptx-ooxml-sync");
  });
});

describe("restore deck snapshot API schema", () => {
  const response = {
    deck: {
      deckId: "deck_test_1",
      projectId: "project_test_1",
      title: "Restored imported deck",
      version: 4,
      metadata: { language: "ko", locale: "ko-KR" },
      canvas: {
        preset: "wide-16-9",
        width: 1920,
        height: 1080,
        aspectRatio: "16:9",
      },
      slides: [{ slideId: "slide_test_1", order: 1, title: "Slide" }],
    },
    restoredSnapshot: {
      snapshotId: "snapshot_test_1",
      projectId: "project_test_1",
      deckId: "deck_test_1",
      version: 1,
      reason: "deck-replaced",
      createdAt: "2026-07-10T00:00:00.000Z",
    },
    ooxmlSyncJob: {
      jobId: "job_restore_sync_1",
      projectId: "project_test_1",
      type: "pptx-ooxml-sync",
      status: "queued",
      progress: 0,
      message: "Job queued",
      result: null,
      error: null,
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    },
    updatedAt: "2026-07-10T00:00:00.000Z",
  };

  it("keeps the historical snapshot version while returning the next imported Deck version", () => {
    const parsed = restoreDeckSnapshotResponseSchema.parse(response);

    expect(parsed.deck.version).toBe(4);
    expect(parsed.restoredSnapshot.version).toBe(1);
    expect(parsed.ooxmlSyncJob?.type).toBe("pptx-ooxml-sync");
  });

  it("accepts the unchanged version contract for a general Deck restore", () => {
    const parsed = restoreDeckSnapshotResponseSchema.parse({
      ...response,
      deck: { ...response.deck, version: 1 },
      ooxmlSyncJob: undefined,
    });

    expect(parsed.deck.version).toBe(parsed.restoredSnapshot.version);
    expect(parsed.ooxmlSyncJob).toBeUndefined();
  });

  it("requires a matching OOXML sync job for a normalized restore version", () => {
    expect(() =>
      restoreDeckSnapshotResponseSchema.parse({
        ...response,
        ooxmlSyncJob: undefined,
      }),
    ).toThrow();
    expect(() =>
      restoreDeckSnapshotResponseSchema.parse({
        ...response,
        ooxmlSyncJob: {
          ...response.ooxmlSyncJob,
          projectId: "project_other_1",
        },
      }),
    ).toThrow();
  });

  it("allows a historical snapshot version ahead of the normalized Deck version", () => {
    const parsed = restoreDeckSnapshotResponseSchema.parse({
      ...response,
      deck: { ...response.deck, version: 2 },
      restoredSnapshot: { ...response.restoredSnapshot, version: 3 },
    });

    expect(parsed.deck.version).toBe(2);
    expect(parsed.restoredSnapshot.version).toBe(3);
  });

  it("still rejects a restored snapshot for another Deck", () => {
    expect(() =>
      restoreDeckSnapshotResponseSchema.parse({
        ...response,
        restoredSnapshot: {
          ...response.restoredSnapshot,
          deckId: "deck_other_1",
        },
      }),
    ).toThrow();
  });
});
