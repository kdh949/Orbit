import { HttpStatus } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

vi.mock("@orbit/config", () => ({
  loadOrbitConfig: () => ({
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: "companion-rate-limit-secret",
  }),
}));

import {
  assertCompanionJsonSameOrigin,
  assertPresentationCompanionEnabled,
  companionPairingCreateLimitPerMinute,
  PresentationCompanionRateLimitService,
  resolveCompanionPublicWebOrigin,
} from "./presentation-companion-request-security";

const config = {
  WEB_ORIGIN: "https://present.orbit.example",
  IPAD_PRESENTER_COMPANION_ENABLED: true,
};

describe("presentation companion request security", () => {
  it("accepts only an exact same-origin JSON request", () => {
    expect(() =>
      assertCompanionJsonSameOrigin(
        config as never,
        request({
          origin: "https://present.orbit.example",
          "content-type": "application/json; charset=utf-8",
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertCompanionJsonSameOrigin(
        config as never,
        request({
          origin: "https://evil.example",
          "content-type": "application/json",
        }),
      ),
    ).toThrow("Same-origin request required");
    expect(() =>
      assertCompanionJsonSameOrigin(
        config as never,
        request({
          origin: "https://present.orbit.example",
          "content-type": "text/plain",
        }),
      ),
    ).toThrow("JSON content type required");
  });

  it("allows only public HTTPS origins without a private port", () => {
    expect(
      resolveCompanionPublicWebOrigin(
        "https://present.orbit.example",
      ),
    ).toBe("https://present.orbit.example");
    for (const origin of [
      "http://present.orbit.example",
      "https://localhost",
      "https://127.0.0.1",
      "https://10.0.0.4",
      "https://192.168.1.4",
      "https://[::1]",
      "https://present.orbit.example:8443",
    ]) {
      expect(() => resolveCompanionPublicWebOrigin(origin)).toThrow(
        "public HTTPS web origin",
      );
    }
  });

  it("hides the API when the runtime feature flag is disabled", () => {
    expect(() =>
      assertPresentationCompanionEnabled({
        ...config,
        IPAD_PRESENTER_COMPANION_ENABLED: false,
      } as never),
    ).toThrow("Presentation companion unavailable");
  });

  it("rate limits HMAC-keyed pairing creation by project and client address", async () => {
    const redis = new FakeRateLimitRedis();
    const service = new PresentationCompanionRateLimitService(
      redis as never,
    );
    for (
      let index = 0;
      index < companionPairingCreateLimitPerMinute;
      index += 1
    ) {
      await service.consumePairingCreate("project_private_1", "203.0.113.9");
    }
    await expect(
      service.consumePairingCreate("project_private_1", "203.0.113.9"),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    expect(redis.keys.join(" ")).not.toMatch(
      /project_private_1|203\.0\.113\.9/,
    );
  });
});

function request(headers: Record<string, string>) {
  return { headers, ip: "203.0.113.9" } as never;
}

class FakeRateLimitRedis {
  status = "ready";
  keys: string[] = [];
  counts = new Map<string, number>();

  async eval(
    _script: string,
    _numberOfKeys: number,
    key: string,
  ) {
    this.keys.push(key);
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return count;
  }

  async quit() {
    this.status = "end";
  }

  disconnect() {
    this.status = "end";
  }
}
