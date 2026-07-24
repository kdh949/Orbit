import type { OrbitConfig } from "@orbit/config";
import { describe, expect, it } from "vitest";

import {
  companionAccessCookieOptions,
  companionAccessScopes,
  createCompanionAccessToken,
  verifyCompanionAccessToken,
} from "./companion-access-cookie";

const config = {
  SESSION_SECRET: "companion-cookie-test-secret",
} as OrbitConfig;
const now = new Date("2026-07-23T00:00:00.000Z");
const expiresAt = "2026-07-23T04:00:00.000Z";

function createToken(userAgent = "iPad Safari/18") {
  return createCompanionAccessToken(
    config,
    {
      sessionId: "session_1",
      projectId: "project_1",
      deckId: "deck_1",
      deckVersion: 4,
      pairingGeneration: 2,
      scopes: [...companionAccessScopes],
      expiresAt,
    },
    userAgent,
  );
}

describe("companion access cookie", () => {
  it("signs a strict user-agent-bound credential without storing raw user-agent", () => {
    const token = createToken();

    expect(token).not.toContain("iPad Safari");
    expect(
      verifyCompanionAccessToken(config, token, "iPad Safari/18", now),
    ).toMatchObject({
      sessionId: "session_1",
      projectId: "project_1",
      deckId: "deck_1",
      deckVersion: 4,
      pairingGeneration: 2,
      scopes: [...companionAccessScopes],
    });
  });

  it("rejects another user-agent, expiry, and payload tampering", () => {
    const token = createToken();
    const [payload, signature] = token.split(".");
    const tamperedPayload = `${payload?.slice(0, -1)}A`;

    expect(
      verifyCompanionAccessToken(config, token, "Desktop Safari", now),
    ).toBeNull();
    expect(
      verifyCompanionAccessToken(
        config,
        token,
        "iPad Safari/18",
        new Date(expiresAt),
      ),
    ).toBeNull();
    expect(
      verifyCompanionAccessToken(
        config,
        `${tamperedPayload}.${signature}`,
        "iPad Safari/18",
        now,
      ),
    ).toBeNull();
  });

  it("uses a signed Secure HttpOnly SameSite=Lax cookie with exact expiry", () => {
    expect(companionAccessCookieOptions(expiresAt)).toEqual({
      expires: new Date(expiresAt),
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: true,
      signed: true,
    });
  });
});
