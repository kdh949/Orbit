import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { PresentationSessionAccessService } from "./presentation-session-access.service";

describe("PresentationSessionAccessService", () => {
  it("accepts an existing presenter session", async () => {
    const repository = {
      findByIdForRead: vi.fn().mockResolvedValue({ session_id: "session_1" }),
    };
    const service = new PresentationSessionAccessService(repository as never);

    await expect(
      service.assertPresenterSession("project_1", "session_1"),
    ).resolves.toBeUndefined();
    expect(repository.findByIdForRead).toHaveBeenCalledWith(
      "project_1",
      "session_1",
    );
  });

  it("rejects a missing presenter session", async () => {
    const service = new PresentationSessionAccessService({
      findByIdForRead: vi.fn().mockResolvedValue(null),
    } as never);

    await expect(
      service.assertPresenterSession("project_1", "session_1"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("accepts an accessible audience session in the requested project", async () => {
    const repository = {
      findAccessibleBySessionId: vi.fn().mockResolvedValue({
        project_id: "project_1",
        deck_id: "deck_1",
      }),
    };
    const service = new PresentationSessionAccessService(repository as never);

    await expect(
      service.assertAudienceAccess("session_1", "project_1"),
    ).resolves.toBeUndefined();
  });

  it.each([
    null,
    { project_id: "project_other", deck_id: "deck_1" },
    { project_id: "project_1", deck_id: null },
  ])("rejects unavailable audience access %#", async (row) => {
    const service = new PresentationSessionAccessService({
      findAccessibleBySessionId: vi.fn().mockResolvedValue(row),
    } as never);

    await expect(
      service.assertAudienceAccess("session_1", "project_1"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
