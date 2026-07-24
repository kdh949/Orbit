import { createDemoDeck } from "@orbit/editor-core";
import { deckSchema } from "@orbit/shared";
import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { DecksService } from "../decks/decks.service";
import type { FilesService } from "../files/files.service";
import type { PresentationSessionRepository } from "./presentation-session.repository";
import { PresentationCompanionProjectionService } from "./presentation-companion-projection.service";

vi.mock("@orbit/config", () => ({
  loadOrbitConfig: () => ({
    API_BASE_URL: "https://api.orbit.example",
    WEB_ORIGIN: "https://present.orbit.example",
  }),
}));

const privateMarker = "PRIVATE_BOOTSTRAP_MARKER_b12c";

function createFixture(options: {
  currentVersion?: number;
  sessionStatus?: "active" | "missing";
} = {}) {
  const source = createDemoDeck();
  const deck = deckSchema.parse({
    ...source,
    title: privateMarker,
    metadata: {
      createdFrom: { topic: privateMarker },
    },
    version: options.currentVersion ?? source.version,
    slides: source.slides.map((slide, index) =>
      index === 0
        ? {
            ...slide,
            speakerNotes: privateMarker,
            thumbnailUrl:
              `https://present.orbit.example/api/v1/projects/${source.projectId}/assets/file_thumbnail/content`,
            style: {
              ...slide.style,
              backgroundImage: {
                src:
                  `https://api.orbit.example/api/v1/projects/${source.projectId}/assets/file_background/content`,
              },
            },
            elements: [
              ...slide.elements,
              {
                elementId: "el_companion_image",
                type: "image",
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                props: {
                  src:
                    `/api/v1/projects/${source.projectId}/assets/file_image/content`,
                },
              },
            ],
          }
        : slide,
    ),
  });
  const session = {
    session_id: "session_companion",
    project_id: source.projectId,
    deck_id: source.deckId,
    deck_version: source.version,
    status: "live",
  };
  const sessions = {
    findActiveCompanionSession: vi
      .fn()
      .mockResolvedValue(
        options.sessionStatus === "missing" ? null : session,
      ),
  } as unknown as PresentationSessionRepository;
  const decks = {
    getDeck: vi.fn().mockResolvedValue({ deck }),
  } as unknown as DecksService;
  const files = {
    openCompanionRenderableAssetContent: vi.fn().mockResolvedValue({
      status: "not-modified",
      cacheControl: "private, no-cache",
      etag: '"etag"',
    }),
  } as unknown as FilesService;

  return {
    deck,
    decks,
    files,
    service: new PresentationCompanionProjectionService(
      sessions,
      decks,
      files,
    ),
    sessions,
  };
}

describe("PresentationCompanionProjectionService", () => {
  it("returns a private-marker-free Deck projection for an active session", async () => {
    const fixture = createFixture();

    const projection = await fixture.service.getDeckProjection(
      "session_companion",
    );

    expect(JSON.stringify(projection.deck)).not.toContain(privateMarker);
    expect(projection.referencedAssetIds).toEqual(
      new Set(["file_thumbnail", "file_background", "file_image"]),
    );
  });

  it("opens only assets referenced by the current session Deck", async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.openReferencedAsset(
        "session_companion",
        "file_image",
        '"client-etag"',
      ),
    ).resolves.toMatchObject({ status: "not-modified" });
    expect(
      fixture.files.openCompanionRenderableAssetContent,
    ).toHaveBeenCalledWith(
      fixture.deck.projectId,
      "file_image",
      '"client-etag"',
    );

    await expect(
      fixture.service.openReferencedAsset(
        "session_companion",
        "file_same_project_but_unreferenced",
      ),
    ).rejects.toMatchObject({
      message: "Presentation companion asset unavailable",
    });
    expect(
      fixture.files.openCompanionRenderableAssetContent,
    ).toHaveBeenCalledTimes(1);
  });

  it("maps owner-only and unavailable asset failures to a fixed 404", async () => {
    const fixture = createFixture();
    vi.mocked(
      fixture.files.openCompanionRenderableAssetContent,
    ).mockRejectedValueOnce(
      new NotFoundException(`${privateMarker}: presentation-audio`),
    );

    await expect(
      fixture.service.openReferencedAsset(
        "session_companion",
        "file_image",
      ),
    ).rejects.toMatchObject({
      message: "Presentation companion asset unavailable",
    });
  });

  it("rejects ended, expired, or replaced Deck versions with a fixed 404", async () => {
    const ended = createFixture({ sessionStatus: "missing" });
    await expect(
      ended.service.getDeckProjection("session_companion"),
    ).rejects.toMatchObject({
      message: "Presentation companion unavailable",
    });

    const replaced = createFixture({ currentVersion: 99 });
    await expect(
      replaced.service.getDeckProjection("session_companion"),
    ).rejects.toMatchObject({
      message: "Presentation companion unavailable",
    });
    expect(JSON.stringify(await rejectedBody(replaced.service))).not.toContain(
      privateMarker,
    );
  });
});

async function rejectedBody(service: PresentationCompanionProjectionService) {
  try {
    await service.getDeckProjection("session_companion");
  } catch (error) {
    return error;
  }
  return null;
}
