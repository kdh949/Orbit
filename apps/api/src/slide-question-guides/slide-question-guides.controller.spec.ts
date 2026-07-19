import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AuthService } from "../auth/auth.service";
import { ProjectsService } from "../projects/projects.service";
import { SlideQuestionGuidesController } from "./slide-question-guides.controller";
import { SlideQuestionGuidesService } from "./slide-question-guides.service";

describe("SlideQuestionGuidesController auto batch permission", () => {
  it("requires write permission before starting automatic generation", async () => {
    const authService = {
      me: vi.fn(async () => ({ user: { userId: "viewer-1" } })),
    } as unknown as AuthService;
    const projectsService = {
      assertCanWriteProject: vi.fn(async () => {
        throw new ForbiddenException();
      }),
    } as unknown as ProjectsService;
    const guidesService = {
      autoCreate: vi.fn(),
    } as unknown as SlideQuestionGuidesService;
    const controller = new SlideQuestionGuidesController(authService, projectsService, guidesService);

    await expect(
      controller.autoCreate("project-1", {}, {
        signedCookies: { orbit_session: "session-1" },
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(projectsService.assertCanWriteProject).toHaveBeenCalledWith("project-1", "viewer-1");
    expect(guidesService.autoCreate).not.toHaveBeenCalled();
  });
});
