import { describe, expect, it, vi } from "vitest";

import { authSessionCookieName } from "../auth/auth.constants";
import type { AuthService } from "../auth/auth.service";
import type { SignedCookieRequest } from "../auth/current-user";
import type { ProjectsService } from "../projects/projects.service";
import { OoxmlReferenceTemplatePreviewController } from "./ooxml-reference-template-preview.controller";

describe("OoxmlReferenceTemplatePreviewController", () => {
  it("checks project read access before loading a preview", async () => {
    const preview = { getPreview: vi.fn(async () => ({ editable: false })) };
    const projects = { assertCanReadProject: vi.fn(async () => ({})) };
    const controller = new OoxmlReferenceTemplatePreviewController(
      authService(),
      preview as never,
      projects as unknown as ProjectsService,
    );

    await controller.getPreview("project-1", "job-1", signedRequest());

    expect(projects.assertCanReadProject).toHaveBeenCalledWith(
      "project-1",
      "user-1",
    );
    expect(preview.getPreview).toHaveBeenCalledWith("project-1", "job-1");
    expect(projects.assertCanReadProject.mock.invocationCallOrder[0]).toBeLessThan(
      preview.getPreview.mock.invocationCallOrder[0]!,
    );
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
    signedCookies: { [authSessionCookieName]: "session-1" },
  } as unknown as SignedCookieRequest;
}
