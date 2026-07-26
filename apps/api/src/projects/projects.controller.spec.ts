import { BadRequestException } from "@nestjs/common";
import { demoIds } from "@orbit/shared/common";
import { describe, expect, it, vi } from "vitest";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

describe("ProjectsController", () => {
  it("turns an invalid create payload into a bad request", async () => {
    const controller = new ProjectsController({
      create: vi.fn(),
      list: vi.fn(),
    } as unknown as ProjectsService, {
      me: vi.fn(),
    } as never);

    await expect(
      controller.createProject(demoIds.workspaceId, { title: "" }, {} as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("turns a non-boolean project pin payload into a bad request", async () => {
    const controller = new ProjectsController({
      updatePin: vi.fn(),
    } as unknown as ProjectsService, {
      me: vi.fn(),
    } as never);

    await expect(
      controller.updateProjectPin(
        demoIds.workspaceId,
        demoIds.projectId,
        { isPinned: "true" },
        {} as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
