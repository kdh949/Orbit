import type { OoxmlSyncState } from "@orbit/shared";
import { describe, expect, it, vi } from "vitest";

import { refreshOoxmlStateForTerminalJob } from "./useOoxmlSyncJob";

describe("refreshOoxmlStateForTerminalJob", () => {
  it("reloads authoritative state after a terminal Job event", async () => {
    const state: OoxmlSyncState = {
      status: "failed",
      deckId: "deck-a",
      deckVersion: 53,
      syncedDeckVersion: 52,
      retryable: false,
    };
    const loadState = vi.fn(async () => state);

    await expect(
      refreshOoxmlStateForTerminalJob(
        "project-a",
        {
          jobId: "job-sync",
          projectId: "project-a",
          type: "pptx-ooxml-sync",
          status: "failed",
          progress: 50,
          message: "failed",
          result: null,
          error: {
            code: "PPTX_OOXML_SYNC_UNSUPPORTED_OPERATION",
            message: "unsupported",
            retryable: false,
            syncCapabilityVersion: 2,
          },
          createdAt: "2026-07-19T00:00:00.000Z",
          updatedAt: "2026-07-19T00:00:01.000Z",
        },
        loadState,
      ),
    ).resolves.toEqual(state);
    expect(loadState).toHaveBeenCalledWith("project-a");
  });
});
