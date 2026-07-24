import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { PresentationSessionsController } from "./presentation-sessions.controller";

function createController(canWrite = true) {
  const authService = {
    me: vi.fn().mockResolvedValue({ user: { userId: "user_1" } })
  };
  const presentationSessionsService = {
    getCurrent: vi.fn().mockResolvedValue({ session: null, audienceUrl: null }),
    list: vi.fn().mockResolvedValue({ sessions: [] }),
    create: vi.fn().mockResolvedValue({}),
    updateAccess: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue({})
  };
  const projectsService = {
    assertCanWriteProject: canWrite
      ? vi.fn().mockResolvedValue({})
      : vi.fn().mockRejectedValue(new ForbiddenException("Project editor permission required"))
  };
  const controller = new PresentationSessionsController(
    authService as never,
    presentationSessionsService as never,
    projectsService as never
  );
  const request = { signedCookies: { orbit_session: "signed_session" } } as never;
  return { controller, presentationSessionsService, projectsService, request };
}

describe("PresentationSessionsController", () => {
  it("allows an owner or editor to reconnect to a deck-scoped current session", async () => {
    const { controller, presentationSessionsService, request } = createController();

    await controller.getCurrent("project_1", "deck_1", undefined, request);

    expect(presentationSessionsService.getCurrent).toHaveBeenCalledWith(
      "project_1",
      "deck_1",
      "presentation",
    );
  });

  it("does not allow a viewer to create a presentation session", async () => {
    const { controller, presentationSessionsService, request } = createController(false);

    await expect(
      controller.create(
        "project_1",
        {
          deckId: "deck_1",
          audienceAccessEnabled: true,
          accessMode: "public",
        },
        request
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(presentationSessionsService.create).not.toHaveBeenCalled();
  });

  it("passes only the authenticated user and server-validated create input", async () => {
    const { controller, presentationSessionsService, request } = createController();

    await controller.create(
      "project_1",
      {
        deckId: "deck_1",
        audienceAccessEnabled: true,
        accessMode: "public",
      },
      request
    );

    expect(presentationSessionsService.create).toHaveBeenCalledWith(
      "project_1",
      "user_1",
      {
        deckId: "deck_1",
        sessionPurpose: "presentation",
        audienceAccessEnabled: true,
        accessMode: "public",
      },
    );
  });
});
