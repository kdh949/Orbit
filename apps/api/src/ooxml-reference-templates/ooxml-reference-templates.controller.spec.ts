import { UnauthorizedException } from "@nestjs/common";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { authSessionCookieName } from "../auth/auth.constants";
import type { AuthService } from "../auth/auth.service";
import type { SignedCookieRequest } from "../auth/current-user";
import { OoxmlReferenceTemplatesController } from "./ooxml-reference-templates.controller";

describe("OoxmlReferenceTemplatesController", () => {
  it("requires authentication before catalog access", async () => {
    const templates = { listOptions: vi.fn() };
    const controller = new OoxmlReferenceTemplatesController(
      authService(),
      templates as never,
    );

    await expect(
      controller.listOptions({} as SignedCookieRequest),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(templates.listOptions).not.toHaveBeenCalled();
  });

  it("requires authentication and streams preview bytes without a URL", async () => {
    const body = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const templates = {
      readPreview: vi.fn(async () => ({ body, contentType: "image/png" })),
    };
    const controller = new OoxmlReferenceTemplatesController(
      authService(),
      templates as never,
    );
    const response = { setHeader: vi.fn() };

    const stream = await controller.readPreview(
      "operating-review",
      "1",
      "cover",
      signedRequest(),
      response as never,
    );

    expect(templates.readPreview).toHaveBeenCalledWith(
      "operating-review",
      "1",
      "cover",
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "cache-control",
      "private, max-age=300",
    );
    expect(stream.getStream()).toBeInstanceOf(Readable);
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
