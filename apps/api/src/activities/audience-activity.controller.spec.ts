import type { OrbitConfig } from "@orbit/config";
import {
  ForbiddenException,
  UnauthorizedException,
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

import { AudienceActivityController } from "./audience-activity.controller";
import {
  audienceAccessCookieName,
  createAudienceAccessToken,
} from "../presentation-sessions/audience-access-cookie";

describe("AudienceActivityController", () => {
  it("rejects non-JSON and cross-origin response mutations before persistence", async () => {
    const responses = { upsert: vi.fn() };
    const controller = new AudienceActivityController(
      responses as never,
      { getAudienceActivity: vi.fn() } as never,
      { assertAudienceAccess: vi.fn() } as never,
    );
    const config = Reflect.get(controller, "config") as OrbitConfig;

    await expect(
      controller.upsertResponse("session_1", "activity_1", {}, {
        headers: {
          origin: config.WEB_ORIGIN,
          "content-type": "application/jsonp",
        },
      } as never),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    await expect(
      controller.upsertResponse("session_1", "activity_1", {}, {
        headers: {
          origin: "https://invalid.example",
          "content-type": "application/json",
        },
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(responses.upsert).not.toHaveBeenCalled();
  });

  it("revalidates the current session before audience Activity reads and writes", async () => {
    const responses = { upsert: vi.fn() };
    const results = { getAudienceActivity: vi.fn() };
    const sessions = {
      assertAudienceAccess: vi
        .fn()
        .mockRejectedValue(
          new UnauthorizedException("Audience access required"),
        ),
    };
    const controller = new AudienceActivityController(
      responses as never,
      results as never,
      sessions as never,
    );
    const config = Reflect.get(controller, "config") as OrbitConfig;
    const access = {
      sessionId: "session_1",
      projectId: "project_1",
      deckId: "deck_1",
      accessMode: "public" as const,
      startsAt: "2026-07-17T00:00:00.000Z",
      expiresAt: "2027-07-31T00:00:00.000Z",
      activeActivityRunId: null,
    };
    const token = createAudienceAccessToken(
      config,
      access,
      "test-agent",
      "audience_1",
    );
    const readRequest = {
      headers: { "user-agent": "test-agent" },
      signedCookies: { [audienceAccessCookieName]: token },
    } as never;
    const writeRequest = {
      headers: {
        "user-agent": "test-agent",
        origin: config.WEB_ORIGIN,
        "content-type": "application/json",
      },
      signedCookies: { [audienceAccessCookieName]: token },
    } as never;

    await expect(
      controller.getActivity("session_1", "activity_1", readRequest),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      controller.upsertResponse(
        "session_1",
        "activity_1",
        {
          clientMutationId: "mutation_1",
          answers: [{ questionId: "question_1", type: "rating", value: 5 }],
        },
        writeRequest,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.assertAudienceAccess).toHaveBeenCalledTimes(2);
    expect(results.getAudienceActivity).not.toHaveBeenCalled();
    expect(responses.upsert).not.toHaveBeenCalled();
  });
});
