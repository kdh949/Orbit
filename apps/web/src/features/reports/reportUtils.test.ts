import { afterEach, describe, expect, it, vi } from "vitest";
import type { RehearsalRun } from "@orbit/shared/rehearsals";
import {
  getRehearsalRunNumber,
  navigateTo,
  rehearsalNavigationRequestEvent,
  sortRehearsalRunsByCreatedAt,
} from "./reportUtils";

afterEach(() => {
  vi.unstubAllGlobals();
});

function runFixture(
  runId: string,
  createdAt: string,
  status: RehearsalRun["status"] = "succeeded",
): RehearsalRun {
  return {
    runId,
    projectId: "project-a",
    deckId: "deck-a",
    audioFileId: null,
    jobId: null,
    deckVersion: null,
    evaluationSnapshot: null,
    semanticEvaluationMode: "full",
    analysisRevision: 1,
    analysisFinalizedAt: createdAt,
    status,
    error: null,
    createdAt,
    updatedAt: createdAt,
    rawAudioDeletedAt: null,
  };
}

describe("rehearsalUtils", () => {
  it("sorts rehearsal runs chronologically", () => {
    const runs = [
      runFixture("run-3", "2026-07-03T00:00:00.000Z"),
      runFixture("run-1", "2026-07-01T00:00:00.000Z"),
      runFixture("run-2", "2026-07-02T00:00:00.000Z"),
    ];

    expect(sortRehearsalRunsByCreatedAt(runs).map((run) => run.runId)).toEqual([
      "run-1",
      "run-2",
      "run-3",
    ]);
  });

  it("calculates run number from chronological order", () => {
    const runs = [
      runFixture("run-3", "2026-07-03T00:00:00.000Z"),
      runFixture("run-1", "2026-07-01T00:00:00.000Z"),
      runFixture("run-2", "2026-07-02T00:00:00.000Z"),
    ];

    expect(getRehearsalRunNumber(runs, "run-1")).toBe(1);
    expect(getRehearsalRunNumber(runs, "run-2")).toBe(2);
    expect(getRehearsalRunNumber(runs, "run-3")).toBe(3);
    expect(getRehearsalRunNumber(runs, "run-unknown")).toBeNull();
  });

  it("requests the shared preflight modal for a rehearsal entry", () => {
    const eventTarget = new EventTarget();
    const pushState = vi.fn();
    let requestedPath = "";
    eventTarget.addEventListener(rehearsalNavigationRequestEvent, (event) => {
      requestedPath = (event as CustomEvent<string>).detail;
    });
    vi.stubGlobal("window", {
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
      history: { pushState },
      location: { origin: "http://localhost:5173" },
    });

    navigateTo("/rehearsal/project-a");

    expect(requestedPath).toBe("/rehearsal/project-a");
    expect(pushState).not.toHaveBeenCalled();
  });

  it("navigates directly after preflight is complete", () => {
    const pushState = vi.fn();
    vi.stubGlobal("PopStateEvent", class extends Event {});
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      history: { pushState },
      location: { origin: "http://localhost:5173" },
    });

    navigateTo("/rehearsal/project-a?preflight=complete");

    expect(pushState).toHaveBeenCalledWith(
      {},
      "",
      "/rehearsal/project-a?preflight=complete",
    );
  });
});
