import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { authSessionCookieName } from "../auth/auth.constants";
import type { AuthService } from "../auth/auth.service";
import type { SignedCookieRequest } from "../auth/current-user";
import type { ProjectsService } from "../projects/projects.service";
import { OoxmlReferenceTemplateGenerationsController } from "./ooxml-reference-template-generations.controller";

describe("OoxmlReferenceTemplateGenerationsController", () => {
  it("requires project write permission before creating a generation", async () => {
    const service = { createGeneration: vi.fn(async () => ({ job: {} })) };
    const projects = {
      assertCanWriteProject: vi.fn(async () => ({ projectId: "project-a" })),
    };
    const controller = new OoxmlReferenceTemplateGenerationsController(
      authService(),
      service as never,
      projects as unknown as ProjectsService,
    );
    const body = { topic: "운영 리뷰" };

    await controller.createGeneration("project-a", body, signedRequest());

    expect(projects.assertCanWriteProject).toHaveBeenCalledWith(
      "project-a",
      "user-1",
    );
    expect(service.createGeneration).toHaveBeenCalledWith("project-a", body);
  });

  it("does not invoke the service when project write permission is denied", async () => {
    const service = { createGeneration: vi.fn() };
    const projects = {
      assertCanWriteProject: vi.fn(async () => {
        throw new ForbiddenException("Project editor permission required");
      }),
    };
    const controller = new OoxmlReferenceTemplateGenerationsController(
      authService(),
      service as never,
      projects as unknown as ProjectsService,
    );

    await expect(
      controller.createGeneration("project-a", {}, signedRequest()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.createGeneration).not.toHaveBeenCalled();
  });
});

function authService(): AuthService {
  return {
    me: vi.fn(async () => ({
      user: { userId: "user-1", email: "user@example.com" },
    })),
  } as unknown as AuthService;
}

function signedRequest(): SignedCookieRequest {
  return {
    signedCookies: {
      [authSessionCookieName]: "session-1",
    },
  } as unknown as SignedCookieRequest;
}
