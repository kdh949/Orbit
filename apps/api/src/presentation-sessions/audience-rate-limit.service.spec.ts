import { HttpStatus } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
  AUDIENCE_RATE_LIMIT_ERROR,
  AudienceRateLimitService,
  audienceJoinLimitPerMinute,
  audienceResponseMutationLimitPerMinute,
} from "./audience-rate-limit.service";

const configMock = vi.hoisted(() => ({
  current: {
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: "rate-limit-test-secret",
    LOAD_TEST_MODE: false,
    LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN: undefined as string | undefined,
  },
}));

vi.mock("@orbit/config", () => ({
  loadOrbitConfig: () => configMock.current,
}));

describe("AudienceRateLimitService", () => {
  it("bypasses passcode join limits only for the configured load-test token", async () => {
    configMock.current = {
      ...configMock.current,
      LOAD_TEST_MODE: true,
      LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN:
        "load-test-bypass-token-at-least-32-characters",
    };
    const redis = createRedisCounter();
    const metrics = { recordJoinBypass: vi.fn() };
    const service = new AudienceRateLimitService(redis as never, metrics);

    await expect(
      service.consumeJoin(
        "session_private",
        "203.0.113.10",
        "load-test-bypass-token-at-least-32-characters",
      ),
    ).resolves.toBeUndefined();
    expect(redis.eval).not.toHaveBeenCalled();
    expect(metrics.recordJoinBypass).toHaveBeenCalledOnce();
  });

  it("rejects an invalid provided bypass token instead of consuming the normal bucket", async () => {
    configMock.current = {
      ...configMock.current,
      LOAD_TEST_MODE: true,
      LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN:
        "load-test-bypass-token-at-least-32-characters",
    };
    const redis = createRedisCounter();
    const service = new AudienceRateLimitService(redis as never);

    await expect(
      service.consumeJoin(
        "session_private",
        "203.0.113.10",
        "invalid-load-test-token",
      ),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("keeps the normal ten-attempt limit when no bypass token is supplied", async () => {
    configMock.current = {
      ...configMock.current,
      LOAD_TEST_MODE: true,
      LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN:
        "load-test-bypass-token-at-least-32-characters",
    };
    const redis = createRedisCounter();
    const service = new AudienceRateLimitService(redis as never);

    for (let attempt = 0; attempt < audienceJoinLimitPerMinute; attempt += 1) {
      await service.consumeJoin("session_private", "203.0.113.10");
    }

    await expect(
      service.consumeJoin("session_private", "203.0.113.10"),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it("limits passcode attempts to ten per session and client address", async () => {
    const redis = createRedisCounter();
    const service = new AudienceRateLimitService(redis as never);

    for (let attempt = 0; attempt < audienceJoinLimitPerMinute; attempt += 1) {
      await service.consumeJoin("session_private", "203.0.113.10");
    }

    await expect(
      service.consumeJoin("session_private", "203.0.113.10"),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      message: AUDIENCE_RATE_LIMIT_ERROR,
    });
  });

  it("limits excessive response mutations per audience and run", async () => {
    const redis = createRedisCounter();
    const service = new AudienceRateLimitService(redis as never);

    for (
      let mutation = 0;
      mutation < audienceResponseMutationLimitPerMinute;
      mutation += 1
    ) {
      await service.consumeResponseMutation(
        "audience_private",
        "activity_run_1",
      );
    }

    await expect(
      service.consumeResponseMutation("audience_private", "activity_run_1"),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      message: AUDIENCE_RATE_LIMIT_ERROR,
    });
  });

  it("allows 200 distinct audience identities without sharing a mutation bucket", async () => {
    const redis = createRedisCounter();
    const service = new AudienceRateLimitService(redis as never);

    await expect(
      Promise.all(
        Array.from({ length: 200 }, (_, index) =>
          service.consumeResponseMutation(
            `audience_${index}`,
            "activity_run_shared",
          ),
        ),
      ),
    ).resolves.toHaveLength(200);
  });

  it("stores only HMAC digests instead of raw IP or audience identifiers", async () => {
    const redis = createRedisCounter();
    const service = new AudienceRateLimitService(redis as never);

    await service.consumeJoin("session_secret", "198.51.100.44");
    await service.consumeResponseMutation(
      "audience_secret",
      "activity_run_secret",
    );

    const keys = redis.eval.mock.calls.map((call) => String(call[2]));
    expect(keys).toHaveLength(2);
    expect(
      keys.every((key) =>
        /^audience:rate:(join|response):[a-f0-9]{64}$/.test(key),
      ),
    ).toBe(true);
    expect(JSON.stringify(keys)).not.toMatch(
      /session_secret|198\.51\.100\.44|audience_secret|activity_run_secret/,
    );
  });
});

function createRedisCounter() {
  const counts = new Map<string, number>();
  return {
    status: "ready",
    eval: vi.fn(async (_script: string, _keyCount: number, key: string) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count;
    }),
    disconnect: vi.fn(),
    quit: vi.fn(async () => "OK"),
  };
}
