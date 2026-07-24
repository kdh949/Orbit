import { HttpStatus } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

vi.mock("@orbit/config", () => ({
  loadOrbitConfig: () => ({
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: "companion-command-rate-secret",
  }),
}));

import {
  companionDrawingBurst,
  companionDrawingRatePerSecond,
  PresentationCompanionCommandRateLimitService,
} from "./presentation-companion-rate-limit.service";

describe("PresentationCompanionCommandRateLimitService", () => {
  it("uses the 120/s drawing rate with a 180 command burst", async () => {
    const redis = {
      status: "ready",
      eval: vi.fn().mockResolvedValue(1),
      quit: vi.fn(),
      disconnect: vi.fn(),
    };
    const service = new PresentationCompanionCommandRateLimitService(
      redis as never,
    );
    await service.consumeDrawing("companion_private_1");

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("command-token-bucket"),
      1,
      expect.not.stringContaining("companion_private_1"),
      expect.any(Number),
      companionDrawingRatePerSecond,
      companionDrawingBurst,
      1,
    );
  });

  it("returns a fixed 429 when the token bucket is empty", async () => {
    const service = new PresentationCompanionCommandRateLimitService({
      status: "ready",
      eval: vi.fn().mockResolvedValue(0),
      quit: vi.fn(),
      disconnect: vi.fn(),
    } as never);

    await expect(
      service.consumeLaser("socket_private_1"),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      message: "Too many presentation commands",
    });
  });
});
