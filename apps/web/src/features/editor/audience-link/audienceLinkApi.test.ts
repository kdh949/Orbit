import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeAudienceAccessSession,
  createAudienceAccessSession,
  fetchCurrentAudienceAccessSession
} from "./audienceLinkApi";

const now = "2026-07-17T00:00:00.000Z";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("audienceLinkApi", () => {
  it("loads the current deck-aware presentation session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      audienceUrl: "/audience/session_1",
      session: sessionFixture()
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchCurrentAudienceAccessSession("project_1", "deck_1")
    ).resolves.toMatchObject({ session: { sessionId: "session_1" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/projects/project_1/presentation-sessions/current?deckId=deck_1",
      { credentials: "include" }
    );
  });

  it("creates an immediate 14-day passcode session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      audienceUrl: "/audience/session_1",
      session: sessionFixture()
    }));
    vi.stubGlobal("fetch", fetchMock);

    await createAudienceAccessSession({
      accessMode: "passcode",
      deckId: "deck_1",
      durationDays: 14,
      passcode: "2468",
      projectId: "project_1"
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      accessMode: "passcode",
      audienceAccessEnabled: true,
      deckId: "deck_1",
      expiresAt: "2026-07-31T00:00:00.000Z",
      passcode: "2468",
      sessionPurpose: "presentation",
      startsAt: now
    });
  });

  it("enables audience access on an existing companion session without replacing it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      session: { ...sessionFixture(), audienceAccessEnabled: true }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createAudienceAccessSession({
      accessMode: "public",
      deckId: "deck_1",
      durationDays: 1,
      projectId: "project_1",
      sessionId: "session_1"
    })).resolves.toMatchObject({
      audienceUrl: "/audience/session_1",
      session: { sessionId: "session_1" }
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/projects/project_1/presentation-sessions/session_1/access"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty(
      "deckId"
    );
  });

  it("omits passcodes for public sessions and disables only audience access", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        audienceUrl: "/audience/session_1",
        session: { ...sessionFixture(), accessMode: "public" }
      }))
      .mockResolvedValueOnce(jsonResponse({ session: {
        ...sessionFixture(),
        audienceAccessEnabled: false
      } }));
    vi.stubGlobal("fetch", fetchMock);

    await createAudienceAccessSession({
      accessMode: "public",
      deckId: "deck_1",
      durationDays: 1,
      projectId: "project_1"
    });
    await closeAudienceAccessSession({
      projectId: "project_1",
      sessionId: "session_1"
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty(
      "passcode"
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/v1/projects/project_1/presentation-sessions/session_1/access"
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      audienceAccessEnabled: false
    });
  });
});

function sessionFixture() {
  return {
    sessionId: "session_1",
    projectId: "project_1",
    deckId: "deck_1",
    deckVersion: 1,
    presenterUserId: "user_1",
    createdBy: "user_1",
    status: "live" as const,
    sessionPurpose: "presentation" as const,
    audienceAccessEnabled: true,
    accessMode: "passcode" as const,
    startsAt: now,
    expiresAt: "2026-07-31T00:00:00.000Z",
    activeActivityRunId: null,
    startedAt: now,
    endedAt: null,
    closedAt: null,
    rawResponsesDeleteAfter: null,
    rawResponsesDeletedAt: null,
    resultsDeletedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status: 200
  });
}
