import { describe, expect, it } from "vitest";

import {
  createPresentationSessionRequestSchema,
  audiencePresentationAccessResponseSchema,
  getCurrentPresentationSessionResponseSchema,
  presentationSessionSchema,
  updatePresentationSessionAccessRequestSchema
} from "./presentation.schema";

const session = {
  sessionId: "session_1",
  projectId: "project_1",
  deckId: "deck_1",
  deckVersion: 4,
  presenterUserId: "user_1",
  createdBy: "user_1",
  status: "live" as const,
  sessionPurpose: "presentation" as const,
  audienceAccessEnabled: true,
  accessMode: "passcode" as const,
  startsAt: "2026-07-17T00:00:00.000Z",
  expiresAt: "2026-07-31T00:00:00.000Z",
  activeActivityRunId: null,
  startedAt: "2026-07-17T00:00:00.000Z",
  endedAt: null,
  closedAt: null,
  rawResponsesDeleteAfter: null,
  rawResponsesDeletedAt: null,
  resultsDeletedAt: null,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z"
};

describe("PresentationSession Activity contract", () => {
  it("requires a server-owned Deck version and access period", () => {
    expect(presentationSessionSchema.safeParse(session).success).toBe(true);
    expect(
      presentationSessionSchema.safeParse({ ...session, deckVersion: undefined })
        .success
    ).toBe(false);
  });

  it("limits access periods to thirty days", () => {
    expect(
      presentationSessionSchema.safeParse({
        ...session,
        expiresAt: "2026-08-17T00:00:00.001Z"
      }).success
    ).toBe(false);
  });

  it("separates public access and four-digit passcode input", () => {
    expect(
      createPresentationSessionRequestSchema.safeParse({
        deckId: "deck_1",
        audienceAccessEnabled: true,
        accessMode: "passcode",
        passcode: "1234"
      }).success
    ).toBe(true);
    expect(
      createPresentationSessionRequestSchema.safeParse({
        deckId: "deck_1",
        audienceAccessEnabled: true,
        accessMode: "public",
        passcode: "1234"
      }).success
    ).toBe(false);
  });

  it("rejects client-supplied deckVersion", () => {
    expect(
      createPresentationSessionRequestSchema.safeParse({
        deckId: "deck_1",
        audienceAccessEnabled: true,
        accessMode: "public",
        deckVersion: 99
      }).success
    ).toBe(false);
  });

  it("keeps session reuse opt-in for the live runtime", () => {
    expect(
      createPresentationSessionRequestSchema.parse({
        deckId: "deck_1",
        audienceAccessEnabled: true,
        accessMode: "public"
      }).reuseCurrent
    ).toBeUndefined();
    expect(
      createPresentationSessionRequestSchema.parse({
        deckId: "deck_1",
        audienceAccessEnabled: true,
        accessMode: "public",
        reuseCurrent: true
      }).reuseCurrent
    ).toBe(true);
  });

  it("defaults new session creation to fail-closed audience access", () => {
    expect(
      createPresentationSessionRequestSchema.parse({
        deckId: "deck_1",
      })
    ).toEqual({
      deckId: "deck_1",
      sessionPurpose: "presentation",
      audienceAccessEnabled: false,
    });
  });

  it("normalizes legacy accessMode requests to audience-enabled sessions", () => {
    expect(
      createPresentationSessionRequestSchema.parse({
        deckId: "deck_1",
        accessMode: "public",
      }),
    ).toEqual({
      deckId: "deck_1",
      sessionPurpose: "presentation",
      audienceAccessEnabled: true,
      accessMode: "public",
    });
    expect(
      createPresentationSessionRequestSchema.parse({
        deckId: "deck_1",
        accessMode: "passcode",
        passcode: "1234",
      }),
    ).toEqual({
      deckId: "deck_1",
      sessionPurpose: "presentation",
      audienceAccessEnabled: true,
      accessMode: "passcode",
      passcode: "1234",
    });
  });

  it("keeps rehearsal sessions companion-only", () => {
    expect(
      presentationSessionSchema.safeParse({
        ...session,
        sessionPurpose: "rehearsal",
        audienceAccessEnabled: false,
      }).success
    ).toBe(true);
    expect(
      presentationSessionSchema.safeParse({
        ...session,
        sessionPurpose: "rehearsal",
        audienceAccessEnabled: true,
      }).success
    ).toBe(false);
    expect(
      createPresentationSessionRequestSchema.safeParse({
        deckId: "deck_1",
        sessionPurpose: "rehearsal",
        audienceAccessEnabled: true,
        accessMode: "public",
      }).success
    ).toBe(false);
  });

  it("represents the absence of a current session without a dangling URL", () => {
    expect(
      getCurrentPresentationSessionResponseSchema.safeParse({
        session: null,
        audienceUrl: null
      }).success
    ).toBe(true);
    expect(
      getCurrentPresentationSessionResponseSchema.safeParse({
        session: null,
        audienceUrl: "/audience/session_missing"
      }).success
    ).toBe(false);
    expect(
      getCurrentPresentationSessionResponseSchema.safeParse({
        session: {
          ...session,
          audienceAccessEnabled: false,
        },
        audienceUrl: null,
      }).success
    ).toBe(true);
    expect(
      getCurrentPresentationSessionResponseSchema.safeParse({
        session: {
          ...session,
          audienceAccessEnabled: false,
        },
        audienceUrl: "/audience/session_1",
      }).success
    ).toBe(false);
  });

  it("requires matching access credentials when access settings change", () => {
    const window = {
      startsAt: "2026-07-17T00:00:00.000Z",
      expiresAt: "2026-07-31T00:00:00.000Z"
    };
    expect(
      updatePresentationSessionAccessRequestSchema.safeParse({
        ...window,
        audienceAccessEnabled: true,
        accessMode: "passcode"
      }).success
    ).toBe(false);
    expect(
      updatePresentationSessionAccessRequestSchema.safeParse({
        ...window,
        audienceAccessEnabled: true,
        accessMode: "public"
      }).success
    ).toBe(true);
    expect(
      updatePresentationSessionAccessRequestSchema.parse({
        audienceAccessEnabled: false,
      })
    ).toEqual({ audienceAccessEnabled: false });
  });

  it("keeps audience access identity out of the public response contract", () => {
    expect(
      audiencePresentationAccessResponseSchema.safeParse({
        verified: true,
        session: {
          sessionId: "session_1",
          projectId: "project_1",
          deckId: "deck_1",
          accessMode: "public",
          startsAt: "2026-07-17T00:00:00.000Z",
          expiresAt: "2026-07-31T00:00:00.000Z",
          activeActivityRunId: null,
          audienceId: "audience_private"
        }
      }).success
    ).toBe(false);
  });
});
