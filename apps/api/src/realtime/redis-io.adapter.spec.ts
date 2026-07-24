import { IoAdapter } from "@nestjs/platform-socket.io";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RedisIoAdapter,
  type RedisIoClient,
} from "./redis-io.adapter";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RedisIoAdapter", () => {
  it("installs the Redis adapter and closes both clients", async () => {
    const fixture = createFixture("production");
    const socketServer = { adapter: vi.fn() };
    vi.spyOn(IoAdapter.prototype, "createIOServer").mockReturnValue(
      socketServer as never,
    );
    vi.spyOn(IoAdapter.prototype, "close").mockResolvedValue();

    await expect(fixture.adapter.connectToRedis()).resolves.toBe(
      "redis",
    );
    expect(
      fixture.adapter.createIOServer(0).adapter,
    ).toHaveBeenCalledWith(fixture.socketAdapterFactory);
    await fixture.adapter.close(socketServer as never);
    expect(fixture.publisher.quit).toHaveBeenCalledOnce();
    expect(fixture.subscriber.quit).toHaveBeenCalledOnce();
  });

  it("fails closed in staging and production when Redis is unavailable", async () => {
    for (const appEnv of ["staging", "production"] as const) {
      const fixture = createFixture(appEnv, {
        connectError: new Error("private redis connection details"),
      });
      await expect(
        fixture.adapter.connectToRedis(),
      ).rejects.toThrow(
        "Socket.IO Redis adapter is required in remote environments",
      );
      expect(fixture.publisher.disconnect).toHaveBeenCalledOnce();
      expect(fixture.subscriber.disconnect).toHaveBeenCalledOnce();
      expect(JSON.stringify(fixture.logger.warn.mock.calls)).not.toContain(
        "private redis connection details",
      );
    }
  });

  it("uses an explicit in-memory fallback only in local and test", async () => {
    for (const appEnv of ["local", "test"] as const) {
      const fixture = createFixture(appEnv, {
        connectError: new Error("redis unavailable"),
      });
      const socketServer = { adapter: vi.fn() };
      vi.spyOn(IoAdapter.prototype, "createIOServer").mockReturnValue(
        socketServer as never,
      );

      await expect(fixture.adapter.connectToRedis()).resolves.toBe(
        "memory",
      );
      fixture.adapter.createIOServer(0);
      expect(socketServer.adapter).not.toHaveBeenCalled();
      expect(fixture.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "socket_io.redis_adapter_fallback",
          appEnv,
        }),
        expect.any(String),
      );
      vi.restoreAllMocks();
    }
  });

  it("requires startup connection before creating a Socket.IO server", () => {
    const fixture = createFixture("local");
    expect(() => fixture.adapter.createIOServer(0)).toThrow(
      "connectToRedis must complete",
    );
  });
});

function createFixture(
  appEnv: "local" | "test" | "staging" | "production",
  options: { connectError?: Error } = {},
) {
  const subscriber = createClient(options.connectError);
  const publisher = createClient(options.connectError);
  publisher.duplicate.mockReturnValue(subscriber);
  const socketAdapterFactory = vi.fn();
  const createRedisAdapter = vi
    .fn()
    .mockReturnValue(socketAdapterFactory);
  const logger = {
    error: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  };
  const adapter = new RedisIoAdapter({
    app: {} as never,
    config: {
      APP_ENV: appEnv,
      REDIS_URL: "redis://private-host.invalid:6379",
    },
    createClient: () => publisher,
    createRedisAdapter: createRedisAdapter as never,
    logger,
  });
  return {
    adapter,
    createRedisAdapter,
    logger,
    publisher,
    socketAdapterFactory,
    subscriber,
  };
}

function createClient(connectError?: Error) {
  const client = {
    status: "wait",
    connect: vi.fn(async () => {
      if (connectError) throw connectError;
      client.status = "ready";
    }),
    disconnect: vi.fn(() => {
      client.status = "end";
    }),
    duplicate: vi.fn(),
    on: vi.fn(),
    quit: vi.fn(async () => {
      client.status = "end";
    }),
  };
  return client as typeof client & RedisIoClient;
}
