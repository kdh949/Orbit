import {
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { Request } from "express";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const configState = vi.hoisted(() => ({
  enabled: true,
  webOrigin: "https://present.orbit.example",
}));

vi.mock("@orbit/config", () => ({
  loadOrbitConfig: () => ({
    IPAD_PRESENTER_COMPANION_ENABLED: configState.enabled,
    WEB_ORIGIN: configState.webOrigin,
  }),
}));

import { companionAccessCookieName } from "./companion-access-cookie";
import {
  ProjectPresentationCompanionController,
  PublicPresentationCompanionController,
} from "./presentation-companion.controller";

describe("ProjectPresentationCompanionController", () => {
  it("returns only a public HTTPS pairing URL after write authorization", async () => {
    const fixture = createProjectFixture();
    const result = await fixture.controller.createPairing(
      "project_1",
      "session_1",
      presenterRequest(),
    );

    expect(result).toEqual({
      pairingUrl:
        "https://present.orbit.example/companion/pair/private-single-use-code",
      expiresAt: "2026-07-23T00:02:00.000Z",
    });
    expect(result).not.toHaveProperty("code");
    expect(fixture.projectsService.assertCanWriteProject).toHaveBeenCalledWith(
      "project_1",
      "user_1",
    );
    expect(fixture.rateLimit.consumePairingCreate).toHaveBeenCalledWith(
      "project_1",
      "203.0.113.9",
    );
  });

  it("rejects cross-origin pairing creation before consuming rate limit", async () => {
    const fixture = createProjectFixture();
    await expect(
      fixture.controller.createPairing(
        "project_1",
        "session_1",
        presenterRequest("https://evil.example"),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.rateLimit.consumePairingCreate).not.toHaveBeenCalled();
    expect(fixture.companion.createPairing).not.toHaveBeenCalled();
  });

  it("does not mint a pairing when WEB_ORIGIN is not public HTTPS", async () => {
    configState.webOrigin = "http://localhost:5173";
    const fixture = createProjectFixture();
    await expect(
      fixture.controller.createPairing(
        "project_1",
        "session_1",
        presenterRequest("http://localhost:5173"),
      ),
    ).rejects.toThrow("public HTTPS web origin");
    expect(fixture.companion.createPairing).not.toHaveBeenCalled();
    configState.webOrigin = "https://present.orbit.example";
  });

  it("validates project scope before disconnecting the active generation", async () => {
    const fixture = createProjectFixture();
    await fixture.controller.disconnect(
      "project_1",
      "session_1",
      presenterRequest(),
    );
    expect(fixture.companion.disconnect).toHaveBeenCalledWith(
      "project_1",
      "session_1",
    );
  });

  it("returns a fixed 404 while the feature flag is disabled", async () => {
    configState.enabled = false;
    const fixture = createProjectFixture();
    await expect(
      fixture.controller.getStatus(
        "project_1",
        "session_1",
        presenterRequest(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fixture.authService.me).not.toHaveBeenCalled();
    configState.enabled = true;
  });
});

describe("PublicPresentationCompanionController", () => {
  it("exchanges once into a Secure signed cookie without returning token or code", async () => {
    const fixture = createPublicFixture();
    const response = responseDouble();
    const result = await fixture.controller.exchange(
      "private-single-use-code-12345678",
      companionRequest(),
      response as never,
    );

    expect(result).toEqual({
      sessionId: "session_1",
      expiresAt: "2026-07-23T04:00:00.000Z",
      scopes: ["view-audience-output", "write-annotation"],
    });
    expect(JSON.stringify(result)).not.toMatch(/private|signed-token/);
    expect(response.cookie).toHaveBeenCalledWith(
      companionAccessCookieName,
      "signed-token",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        signed: true,
      }),
    );
    expect(fixture.rateLimit.consumePairingExchange).toHaveBeenCalledWith(
      "203.0.113.10",
    );
  });

  it("does not consume a code for a cross-origin exchange", async () => {
    const fixture = createPublicFixture();
    await expect(
      fixture.controller.exchange(
        "private-single-use-code-12345678",
        companionRequest("https://evil.example"),
        responseDouble() as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.companion.exchangePairing).not.toHaveBeenCalled();
  });

  it("returns a safe bootstrap without presenter-private markers", async () => {
    const fixture = createPublicFixture();
    const bootstrap = await fixture.controller.getBootstrap(
      "session_1",
      companionRequest(),
    );
    const serialized = JSON.stringify(bootstrap);
    expect(serialized).toContain("SAFE_AUDIENCE_TEXT");
    expect(serialized).not.toMatch(
      /PRIVATE_(?:SPEAKER_NOTES|TRANSCRIPT|RAW_AUDIO|SCRIPT)/,
    );
    expect(fixture.companion.getBootstrap).toHaveBeenCalledWith(
      "signed-token",
      "iPad Safari",
      "session_1",
    );
  });

  it("rejects bootstrap and assets without a companion credential", async () => {
    const fixture = createPublicFixture();
    const missingCookie = {
      ...companionRequest(),
      signedCookies: {},
    } as never;
    expect(() =>
      fixture.controller.getBootstrap("session_1", missingCookie),
    ).toThrow(NotFoundException);
    await expect(
      fixture.controller.readAsset(
        "session_1",
        "file_1",
        missingCookie,
        undefined,
        responseDouble() as never,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fixture.projection.openReferencedAsset).not.toHaveBeenCalled();
  });

  it("streams only an asset authorized by the current safe Deck projection", async () => {
    const fixture = createPublicFixture();
    vi.mocked(fixture.projection.openReferencedAsset).mockResolvedValue({
      status: "ok",
      body: Readable.from(Buffer.from("safe-image")),
      cacheControl: "private, no-cache",
      contentLength: 10,
      contentType: "image/png",
      etag: "\"safe-etag\"",
    });
    const response = responseDouble();

    await expect(
      fixture.controller.readAsset(
        "session_1",
        "file_1",
        companionRequest(),
        undefined,
        response as never,
      ),
    ).resolves.toBeDefined();
    expect(fixture.companion.verifyCredential).toHaveBeenCalledWith(
      "signed-token",
      "iPad Safari",
      "session_1",
    );
    expect(fixture.projection.openReferencedAsset).toHaveBeenCalledWith(
      "session_1",
      "file_1",
      undefined,
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "content-type",
      "image/png",
    );
  });

  it("reads activity state through the companion credential boundary", async () => {
    const fixture = createPublicFixture();
    await expect(
      fixture.controller.getActivityProjection(
        "session_1",
        "activity_1",
        companionRequest(),
      ),
    ).resolves.toMatchObject({
      activityId: "activity_1",
      run: { status: "open" },
    });
    expect(fixture.activity.getProjection).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session_1" }),
      "activity_1",
    );
  });
});

function createProjectFixture() {
  const authService = {
    me: vi.fn().mockResolvedValue({ user: { userId: "user_1" } }),
  };
  const projectsService = {
    assertCanWriteProject: vi.fn().mockResolvedValue(undefined),
  };
  const companion = {
    createPairing: vi.fn().mockResolvedValue({
      code: "private-single-use-code",
      expiresAt: "2026-07-23T00:02:00.000Z",
    }),
    getStatus: vi.fn().mockResolvedValue({
      connected: false,
      pairingGeneration: null,
      connectedAt: null,
      rttBucket: null,
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const rateLimit = {
    consumePairingCreate: vi.fn().mockResolvedValue(undefined),
  };
  return {
    authService,
    companion,
    controller: new ProjectPresentationCompanionController(
      authService as never,
      projectsService as never,
      companion as never,
      rateLimit as never,
    ),
    projectsService,
    rateLimit,
  };
}

function createPublicFixture() {
  const companion = {
    exchangePairing: vi.fn().mockResolvedValue({
      token: "signed-token",
      credential: {
        sessionId: "session_1",
        expiresAt: "2026-07-23T04:00:00.000Z",
        scopes: ["view-audience-output", "write-annotation"],
      },
    }),
    getBootstrap: vi.fn().mockResolvedValue({
      sessionId: "session_1",
      sessionPurpose: "presentation",
      expiresAt: "2026-07-23T04:00:00.000Z",
      scopes: ["view-audience-output", "write-annotation"],
      deck: {
        deckId: "deck_1",
        projectId: "project_1",
        version: 4,
        canvas: {
          preset: "wide-16-9",
          width: 1920,
          height: 1080,
          aspectRatio: "16:9",
        },
        theme: {},
        slides: [
          {
            slideId: "slide_1",
            kind: "content",
            order: 1,
            style: {},
            elements: [
              {
                elementId: "element_1",
                type: "text",
                x: 0,
                y: 0,
                width: 100,
                height: 50,
                props: {
                  text: "SAFE_AUDIENCE_TEXT",
                  fontSize: 32,
                  fill: "#111111",
                },
              },
            ],
            animations: [],
          },
        ],
      },
    }),
    verifyCredential: vi.fn().mockResolvedValue({
      sessionId: "session_1",
    }),
  };
  const projection = {
    openReferencedAsset: vi.fn(),
  };
  const activity = {
    getProjection: vi.fn().mockResolvedValue({
      activityId: "activity_1",
      audienceUrl: "/audience/session_1/a/activity_1",
      run: { status: "open" },
      publicResult: null,
    }),
  };
  const rateLimit = {
    consumePairingExchange: vi.fn().mockResolvedValue(undefined),
  };
  return {
    activity,
    companion,
    controller: new PublicPresentationCompanionController(
      companion as never,
      projection as never,
      activity as never,
      rateLimit as never,
    ),
    projection,
    rateLimit,
  };
}

function presenterRequest(
  origin = "https://present.orbit.example",
) {
  return {
    headers: {
      origin,
      "content-type": "application/json",
      "user-agent": "Desktop Safari",
    },
    ip: "203.0.113.9",
    signedCookies: { orbit_session: "signed-session" },
  } as unknown as Request & {
    signedCookies: Record<string, string>;
  };
}

function companionRequest(
  origin = "https://present.orbit.example",
) {
  return {
    headers: {
      origin,
      "content-type": "application/json",
      "user-agent": "iPad Safari",
    },
    ip: "203.0.113.10",
    signedCookies: {
      [companionAccessCookieName]: "signed-token",
    },
  } as unknown as Request & {
    signedCookies: Record<string, string>;
  };
}

function responseDouble() {
  return {
    cookie: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
}
