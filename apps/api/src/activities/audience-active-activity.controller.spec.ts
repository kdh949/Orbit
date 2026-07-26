import type { OrbitConfig } from "@orbit/config";
import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

vi.mock("@orbit/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@orbit/config")>();
  return {
    ...actual,
    loadOrbitConfig: () => ({
      APP_ENV: "test",
      WEB_ORIGIN: "http://localhost:5173",
      SESSION_SECRET: "activity-test-session-secret",
      COOKIE_SECRET: "activity-test-cookie-secret",
      AUTH_COOKIE_SECURE: false,
    }),
  };
});

import {
  audienceAccessCookieName,
  createAudienceAccessToken,
} from "../presentation-sessions/audience-access-cookie";
import { AudienceActiveActivityController } from "./audience-active-activity.controller";

describe("AudienceActiveActivityController", () => {
  it("rejects a stale cookie after the presentation session ends", async () => {
    const results = { getAudienceActiveActivity: vi.fn() };
    const sessions = {
      assertAudienceAccess: vi
        .fn()
        .mockRejectedValue(
          new UnauthorizedException("Audience access required"),
        ),
    };
    const controller = new AudienceActiveActivityController(
      results as never,
      sessions as never,
    );
    const config = Reflect.get(controller, "config") as OrbitConfig;
    const token = createAudienceAccessToken(
      config,
      {
        sessionId: "session_1",
        projectId: "project_1",
        expiresAt: "2027-07-31T00:00:00.000Z",
      },
      "test-agent",
      "audience_1",
    );

    await expect(
      controller.getActiveActivity("session_1", {
        headers: { "user-agent": "test-agent" },
        signedCookies: { [audienceAccessCookieName]: token },
      } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(results.getAudienceActiveActivity).not.toHaveBeenCalled();
  });
});
