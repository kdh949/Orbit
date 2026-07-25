import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { authSessionCookieName } from "../auth/auth.constants";
import { RealtimeTranscriptionController } from "./realtime-transcription.controller";

describe("RealtimeTranscriptionController", () => {
  it("requires an authenticated project member before issuing a client secret", async () => {
    const authService = {
      me: vi.fn().mockResolvedValue({
        user: {
          userId: "user_1",
          email: "user@example.test",
          createdAt: "2026-07-05T00:00:00.000Z"
        }
      })
    };
    const projectsService = {
      assertCanReadProject: vi.fn().mockResolvedValue({
        projectId: "project_1"
      })
    };
    const realtimeTranscriptionService = {
      createClientSecret: vi.fn().mockResolvedValue({
        clientSecret: "ek_test",
        expiresAt: 1790000000,
        model: "gpt-realtime-whisper",
        delay: "minimal"
      })
    };
    const controller = new RealtimeTranscriptionController(
      authService as never,
      projectsService as never,
      realtimeTranscriptionService as never
    );

    await expect(
      controller.createClientSecret("project_1", {
        signedCookies: {
          [authSessionCookieName]: "session_1"
        }
      } as never)
    ).resolves.toMatchObject({
      clientSecret: "ek_test",
      model: "gpt-realtime-whisper"
    });

    expect(authService.me).toHaveBeenCalledWith("session_1");
    expect(projectsService.assertCanReadProject).toHaveBeenCalledWith(
      "project_1",
      "user_1"
    );
    expect(realtimeTranscriptionService.createClientSecret).toHaveBeenCalledWith({
      projectId: "project_1",
      userId: "user_1"
    });
  });

  it("rejects requests without a signed session cookie", async () => {
    const controller = new RealtimeTranscriptionController(
      { me: vi.fn() } as never,
      { assertCanReadProject: vi.fn() } as never,
      { createClientSecret: vi.fn() } as never
    );

    await expect(
      controller.createClientSecret("project_1", { signedCookies: {} } as never)
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
