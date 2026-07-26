import { loadOrbitConfig } from "@orbit/config";
import { createHmac } from "node:crypto";
import type { Socket } from "socket.io";
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

import { authSessionCookieName } from "../auth/auth.constants";
import {
  audienceAccessCookieName,
  createAudienceAccessToken,
} from "../presentation-sessions/audience-access-cookie";
import { ActivityRealtimeGateway } from "./activity-realtime.gateway";

const config = loadOrbitConfig(process.env, { service: "api" });

function signedCookie(name: string, value: string) {
  const signature = createHmac("sha256", config.COOKIE_SECRET)
    .update(value)
    .digest("base64")
    .replace(/=+$/, "");
  return `${name}=${encodeURIComponent(`s:${value}.${signature}`)}`;
}

function client(cookie: string): Socket {
  return {
    handshake: { headers: { cookie, "user-agent": "test-agent" } },
    data: {},
    join: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn(),
  } as unknown as Socket;
}

describe("ActivityRealtimeGateway", () => {
  it("joins an authenticated editor to the presenter-only room", async () => {
    const auth = {
      me: vi.fn().mockResolvedValue({ user: { userId: "user_1" } }),
    };
    const projects = { assertCanWriteProject: vi.fn().mockResolvedValue({}) };
    const sessions = {
      assertPresenterSession: vi.fn().mockResolvedValue(undefined),
    };
    const gateway = new ActivityRealtimeGateway(
      auth as never,
      projects as never,
      sessions as never,
      { attach: vi.fn() } as never,
    );
    const socket = client(
      signedCookie(authSessionCookieName, "auth_session_1"),
    );

    await expect(
      gateway.joinPresenter(socket, {
        sessionId: "session_1",
        projectId: "project_1",
      }),
    ).resolves.toEqual({
      joined: true,
      sessionId: "session_1",
      role: "presenter",
    });
    expect(socket.join).toHaveBeenCalledWith(
      "presentation:session_1:presenter",
    );
  });

  it("does not join an audience socket with an invalid cookie", async () => {
    const gateway = new ActivityRealtimeGateway(
      {} as never,
      {} as never,
      { assertAudienceAccess: vi.fn() } as never,
      { attach: vi.fn() } as never,
    );
    const socket = client("orbit_audience_access=invalid");

    await expect(
      gateway.joinAudience(socket, {
        sessionId: "session_1",
        projectId: "project_1",
      }),
    ).resolves.toEqual({
      event: "presentation:error",
      data: { message: "Presentation room access required" },
    });
    expect(socket.join).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(socket.emit).mock.calls)).not.toContain(
      "audienceId",
    );
  });

  it("joins a valid audience cookie without returning its private identity", async () => {
    const sessions = {
      assertAudienceAccess: vi.fn().mockResolvedValue(undefined),
    };
    const gateway = new ActivityRealtimeGateway(
      {} as never,
      {} as never,
      sessions as never,
      { attach: vi.fn() } as never,
    );
    const token = createAudienceAccessToken(
      config,
      {
        sessionId: "session_1",
        projectId: "project_1",
        expiresAt: "2027-07-31T00:00:00.000Z",
      },
      "test-agent",
      "audience_private",
    );
    const socket = client(signedCookie(audienceAccessCookieName, token));

    const result = await gateway.joinAudience(socket, {
      sessionId: "session_1",
      projectId: "project_1",
    });

    expect(result).toEqual({
      joined: true,
      sessionId: "session_1",
      role: "audience",
    });
    expect(socket.join).toHaveBeenCalledWith("presentation:session_1:audience");
    expect(JSON.stringify(result)).not.toContain("audience_private");
  });
});
