import { describe, expect, it, vi } from "vitest";
import {
  createPresenterCompanionPairing,
  disconnectPresenterCompanion,
  exchangePresenterCompanionPairing,
  fetchPresenterCompanionActivityProjection,
  fetchPresenterCompanionStatus,
  isPresenterCompanionEnabled,
} from "./presenterCompanionApi";

describe("presenterCompanionApi", () => {
  it("fails closed when the runtime flag cannot be loaded", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));

    await expect(isPresenterCompanionEnabled(fetcher)).resolves.toBe(false);
  });

  it("creates a pairing without extracting or returning a raw code", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        pairingUrl:
          "https://present.orbit.example/companion/pair/single-use-secret",
        expiresAt: "2026-07-23T00:02:00.000Z",
      }),
    );

    await expect(
      createPresenterCompanionPairing(
        { projectId: "project 1", sessionId: "session/1" },
        fetcher,
      ),
    ).resolves.toEqual({
      pairingUrl:
        "https://present.orbit.example/companion/pair/single-use-secret",
      expiresAt: "2026-07-23T00:02:00.000Z",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/projects/project%201/presentation-sessions/session%2F1/companion-pairings",
      expect.objectContaining({
        body: "{}",
        credentials: "include",
        headers: expect.objectContaining({
          "content-type": "application/json",
        }),
        method: "POST",
      }),
    );
  });

  it("uses credentialed requests for status, exchange, and disconnect", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          connected: true,
          connectedAt: "2026-07-23T00:00:00.000Z",
          pairingGeneration: 2,
          rttBucket: "fast",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          sessionId: "session_1",
          expiresAt: "2026-07-23T04:00:00.000Z",
          scopes: ["view-audience-output", "write-annotation"],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await fetchPresenterCompanionStatus(
      { projectId: "project_1", sessionId: "session_1" },
      fetcher,
    );
    await exchangePresenterCompanionPairing("code/1", fetcher);
    await disconnectPresenterCompanion(
      { projectId: "project_1", sessionId: "session_1" },
      fetcher,
    );

    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "/api/v1/presentation-companion/pairings/code%2F1/exchange",
    );
    expect(fetcher.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        body: "{}",
        headers: expect.objectContaining({
          "content-type": "application/json",
        }),
        method: "POST",
      }),
    );
    expect(fetcher.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.any(String),
          expect.objectContaining({ credentials: "include" }),
        ]),
      ]),
    );
  });

  it("reads only the companion-scoped public activity projection", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        activityId: "activity_1",
        audienceUrl: "/audience/session_1/a/activity_1",
        run: { status: "results" },
        publicResult: {
          activityRunId: "activity_run_1",
          activityId: "activity_1",
          status: "results",
          revision: 2,
          responseCount: 3,
          aggregates: [],
          approvedTextEntries: [],
        },
      }),
    );

    await expect(
      fetchPresenterCompanionActivityProjection(
        "session/1",
        "activity 1",
        fetcher,
      ),
    ).resolves.toMatchObject({
      activityId: "activity_1",
      run: { status: "results" },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/presentation-companion/session%2F1/activities/activity%201",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
