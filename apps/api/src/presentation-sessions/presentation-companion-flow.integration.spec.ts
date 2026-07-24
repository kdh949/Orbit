import { createDemoDeck } from "@orbit/editor-core";
import { deckSchema } from "@orbit/shared";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";

vi.mock("@orbit/config", () => ({
  loadOrbitConfig: () => ({
    API_BASE_URL: "https://api.orbit.example",
    IPAD_PRESENTER_COMPANION_ENABLED: true,
    SESSION_SECRET: "companion-flow-integration-secret",
    WEB_ORIGIN: "https://present.orbit.example",
  }),
}));

import type { FilesService } from "../files/files.service";
import type { DecksService } from "../decks/decks.service";
import {
  ProjectPresentationCompanionController,
  PublicPresentationCompanionController,
} from "./presentation-companion.controller";
import { PresentationCompanionProjectionService } from "./presentation-companion-projection.service";
import { PresentationCompanionService } from "./presentation-companion.service";
import type { PresentationSessionRepository } from "./presentation-session.repository";
import type {
  PresentationCompanionPairing,
  PresentationCompanionStore,
} from "./presentation-companion.store";
import { companionAccessCookieName } from "./companion-access-cookie";

const privateMarker = "PRIVATE_FLOW_MARKER_8e14";

describe("presentation companion pairing flow integration", () => {
  it("supports reload, replacement, safe asset access, and disconnect revoke", async () => {
    const fixture = createFixture();
    const firstPairing = await fixture.projectController.createPairing(
      fixture.projectId,
      fixture.sessionId,
      presenterRequest(),
    );
    const firstCode = pairingCode(firstPairing.pairingUrl);
    const firstCookie = await exchange(
      fixture.publicController,
      firstCode,
    );

    const firstBootstrap = await fixture.publicController.getBootstrap(
      fixture.sessionId,
      companionRequest(firstCookie),
    );
    const reloadedBootstrap = await fixture.publicController.getBootstrap(
      fixture.sessionId,
      companionRequest(firstCookie),
    );
    expect(reloadedBootstrap).toEqual(firstBootstrap);
    expect(JSON.stringify(firstBootstrap)).not.toContain(privateMarker);
    expect(JSON.stringify(firstBootstrap)).not.toMatch(
      /speakerNotes|metadata|transcript|rawAudio/,
    );

    const assetResponse = responseDouble();
    await expect(
      fixture.publicController.readAsset(
        fixture.sessionId,
        "file_flow_image",
        companionRequest(firstCookie),
        undefined,
        assetResponse as never,
      ),
    ).resolves.toBeUndefined();
    expect(fixture.files.openCompanionRenderableAssetContent).toHaveBeenCalled();

    const secondPairing = await fixture.projectController.createPairing(
      fixture.projectId,
      fixture.sessionId,
      presenterRequest(),
    );
    const secondCookie = await exchange(
      fixture.publicController,
      pairingCode(secondPairing.pairingUrl),
    );
    await expect(
      fixture.publicController.getBootstrap(
        fixture.sessionId,
        companionRequest(firstCookie),
      ),
    ).rejects.toMatchObject({
      message: "Presentation companion unavailable",
    });
    await expect(
      fixture.publicController.getBootstrap(
        fixture.sessionId,
        companionRequest(secondCookie),
      ),
    ).resolves.toMatchObject({ sessionId: fixture.sessionId });

    await fixture.projectController.disconnect(
      fixture.projectId,
      fixture.sessionId,
      presenterRequest(),
    );
    await expect(
      fixture.publicController.getBootstrap(
        fixture.sessionId,
        companionRequest(secondCookie),
      ),
    ).rejects.toMatchObject({
      message: "Presentation companion unavailable",
    });

    const replacementPairing = await fixture.projectController.createPairing(
      fixture.projectId,
      fixture.sessionId,
      presenterRequest(),
    );
    const replacementCookie = await exchange(
      fixture.publicController,
      pairingCode(replacementPairing.pairingUrl),
    );
    await expect(
      fixture.publicController.getBootstrap(
        fixture.sessionId,
        companionRequest(secondCookie),
      ),
    ).rejects.toMatchObject({
      message: "Presentation companion unavailable",
    });
    await expect(
      fixture.publicController.getBootstrap(
        fixture.sessionId,
        companionRequest(replacementCookie),
      ),
    ).resolves.toMatchObject({ sessionId: fixture.sessionId });
  });
});

function createFixture() {
  const source = createDemoDeck();
  const deck = deckSchema.parse({
    ...source,
    title: privateMarker,
    metadata: {
      ...source.metadata,
      createdFrom: { topic: privateMarker },
    },
    slides: source.slides.map((slide, index) =>
      index === 0
        ? {
            ...slide,
            speakerNotes: privateMarker,
            elements: [
              ...slide.elements,
              {
                elementId: "el_flow_image",
                type: "image",
                x: 10,
                y: 10,
                width: 100,
                height: 100,
                props: {
                  src:
                    `/api/v1/projects/${source.projectId}` +
                    "/assets/file_flow_image/content",
                },
              },
            ],
          }
        : slide,
    ),
  });
  const sessionId = "session_flow_1";
  const session = {
    session_id: sessionId,
    project_id: deck.projectId,
    deck_id: deck.deckId,
    deck_version: deck.version,
    presenter_user_id: "user_1",
    created_by: "user_1",
    status: "live",
    session_purpose: "presentation",
    audience_access_enabled: false,
    access_mode: "public",
    session_password_hash: null,
    starts_at: "2026-07-23T00:00:00.000Z",
    expires_at: "2099-07-23T04:00:00.000Z",
    active_activity_run_id: null,
    started_at: "2026-07-23T00:00:00.000Z",
    ended_at: null,
    closed_at: null,
    raw_responses_delete_after: null,
    raw_responses_deleted_at: null,
    results_deleted_at: null,
    created_at: "2026-07-23T00:00:00.000Z",
    updated_at: "2026-07-23T00:00:00.000Z",
  };
  const sessions = {
    findActiveCompanionSession: vi.fn().mockResolvedValue(session),
  } as unknown as PresentationSessionRepository;
  const decks = {
    getDeck: vi.fn().mockResolvedValue({ deck }),
  } as unknown as DecksService;
  const filesMock = {
    openCompanionRenderableAssetContent: vi.fn().mockResolvedValue({
      status: "not-modified",
      cacheControl: "private, no-cache",
      etag: '"flow-etag"',
    }),
  };
  const files = filesMock as unknown as FilesService;
  const projection = new PresentationCompanionProjectionService(
    sessions,
    decks,
    files,
  );
  const store = new FlowCompanionStore();
  const companion = new PresentationCompanionService(
    store as unknown as PresentationCompanionStore,
    sessions,
    projection,
    { info: vi.fn() } as never,
  );
  const projectController = new ProjectPresentationCompanionController(
    { me: vi.fn().mockResolvedValue({ user: { userId: "user_1" } }) } as never,
    { assertCanWriteProject: vi.fn().mockResolvedValue(undefined) } as never,
    companion,
    { consumePairingCreate: vi.fn().mockResolvedValue(undefined) } as never,
  );
  const publicController = new PublicPresentationCompanionController(
    companion,
    projection,
    { getProjection: vi.fn() } as never,
    { consumePairingExchange: vi.fn().mockResolvedValue(undefined) } as never,
  );
  return {
    files: filesMock,
    projectController,
    projectId: deck.projectId,
    publicController,
    sessionId,
  };
}

class FlowCompanionStore {
  pairings = new Map<string, PresentationCompanionPairing>();
  generations = new Map<string, number>();

  async putPairing(
    code: string,
    pairing: PresentationCompanionPairing,
  ) {
    this.pairings.set(code, pairing);
  }

  async consumePairing(code: string) {
    const pairing = this.pairings.get(code) ?? null;
    this.pairings.delete(code);
    return pairing;
  }

  async issueGeneration(sessionId: string) {
    const previousGeneration = this.generations.get(sessionId) ?? null;
    const generation = (previousGeneration ?? 0) + 1;
    this.generations.set(sessionId, generation);
    return { generation, previousGeneration };
  }

  async getLatestGeneration(sessionId: string) {
    return this.generations.get(sessionId) ?? null;
  }

  async revokeSession(sessionId: string) {
    const generation = this.generations.get(sessionId);
    if (generation !== undefined) {
      this.generations.set(sessionId, generation + 1);
    }
  }

  async getPresence() {
    return null;
  }

  async getAuthority() {
    return null;
  }

  async claimAuthority() {
    return true;
  }

  async heartbeatAuthority() {
    return true;
  }

  async renewPresence() {}

  async clearPresence() {}
}

async function exchange(
  controller: PublicPresentationCompanionController,
  code: string,
) {
  const response = responseDouble();
  await controller.exchange(
    code,
    companionRequest(),
    response as never,
  );
  const call = response.cookie.mock.calls[0];
  if (!call || call[0] !== companionAccessCookieName) {
    throw new Error("companion cookie missing");
  }
  return String(call[1]);
}

function pairingCode(pairingUrl: string) {
  const code = new URL(pairingUrl).pathname.split("/").at(-1);
  if (!code) throw new Error("pairing code missing");
  return code;
}

function presenterRequest() {
  return {
    headers: {
      origin: "https://present.orbit.example",
      "content-type": "application/json",
      "user-agent": "Desktop Safari",
    },
    ip: "203.0.113.20",
    signedCookies: { orbit_session: "signed-session" },
  } as unknown as Request & {
    signedCookies: Record<string, string>;
  };
}

function companionRequest(cookie?: string) {
  return {
    headers: {
      origin: "https://present.orbit.example",
      "content-type": "application/json",
      "user-agent": "iPad Safari",
    },
    ip: "203.0.113.21",
    signedCookies: cookie
      ? { [companionAccessCookieName]: cookie }
      : {},
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
