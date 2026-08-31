import type { OrbitConfig } from "@orbit/config";
import {
  ForbiddenException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
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
  verifyAudienceAccessToken,
} from "./audience-access-cookie";
import { AudienceSessionsController } from "./audience-sessions.controller";

const access = {
  sessionId: "session_1",
  projectId: "project_1",
  deckId: "deck_1",
  accessMode: "public" as const,
  startsAt: "2026-07-17T00:00:00.000Z",
  expiresAt: "2027-07-31T00:00:00.000Z",
  activeActivityRunId: null,
};

function createController() {
  const service = {
    getAudiencePublicInfo: vi.fn().mockResolvedValue({}),
    joinAudience: vi
      .fn()
      .mockResolvedValue({ verified: true, session: access }),
    getAudienceAccess: vi
      .fn()
      .mockResolvedValue({ verified: true, session: access }),
  };
  const controller = new AudienceSessionsController(service as never);
  const config = Reflect.get(controller, "config") as OrbitConfig;
  return { config, controller, service };
}

describe("AudienceSessionsController", () => {
  it("requires JSON and a same-origin mutation request", async () => {
    const { controller, config } = createController();
    const response = { cookie: vi.fn() } as never;

    await expect(
      controller.join(
        "session_1",
        {},
        { headers: { origin: config.WEB_ORIGIN } } as never,
        response,
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    await expect(
      controller.join(
        "session_1",
        {},
        {
          headers: {
            origin: "https://invalid.example",
            "content-type": "application/json",
          },
        } as never,
        response,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.join(
        "session_1",
        {},
        {
          headers: {
            origin: config.WEB_ORIGIN,
            "content-type": "application/jsonp",
          },
        } as never,
        response,
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it("preserves the signed audience identity when rejoining the same session", async () => {
    const { controller, config, service } = createController();
    const existingToken = createAudienceAccessToken(
      config,
      access,
      "test-agent",
      "audience_existing",
    );
    const response = { cookie: vi.fn() };

    await controller.join(
      "session_1",
      {},
      {
        headers: {
          origin: config.WEB_ORIGIN,
          "content-type": "application/json",
          "user-agent": "test-agent",
        },
        signedCookies: { [audienceAccessCookieName]: existingToken },
      } as never,
      response as never,
    );

    const issuedToken = response.cookie.mock.calls[0]?.[1];
    expect(typeof issuedToken).toBe("string");
    expect(
      verifyAudienceAccessToken(config, issuedToken, "test-agent")?.audienceId,
    ).toBe("audience_existing");
    expect(service.joinAudience).toHaveBeenCalledWith(
      "session_1",
      {},
      "audience_existing",
      "unknown",
      undefined,
    );
  });

  it("passes the load-test token to the passcode join service without logging it", async () => {
    const { controller, config, service } = createController();
    const response = { cookie: vi.fn() };

    await controller.join(
      "session_1",
      { passcode: "1234" },
      {
        headers: {
          origin: config.WEB_ORIGIN,
          "content-type": "application/json",
          "user-agent": "test-agent",
          "x-orbit-load-test-token": "private-load-test-token",
        },
      } as never,
      response as never,
    );

    expect(service.joinAudience).toHaveBeenCalledWith(
      "session_1",
      { passcode: "1234" },
      expect.stringMatching(/^audience_/),
      "unknown",
      "private-load-test-token",
    );
  });

  it("registers a newly generated anonymous identity before issuing its cookie", async () => {
    const { controller, config, service } = createController();
    const response = { cookie: vi.fn() };

    await controller.join(
      "session_1",
      {},
      {
        headers: {
          origin: config.WEB_ORIGIN,
          "content-type": "application/json",
          "user-agent": "test-agent",
        },
      } as never,
      response as never,
    );

    const registeredAudienceId = service.joinAudience.mock.calls[0]?.[2];
    const issuedToken = response.cookie.mock.calls[0]?.[1];
    expect(registeredAudienceId).toMatch(/^audience_/);
    expect(
      verifyAudienceAccessToken(config, issuedToken, "test-agent")?.audienceId,
    ).toBe(registeredAudienceId);
  });
});
