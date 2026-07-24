import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as createSocketClient, type Socket } from "socket.io-client";
import { describe, expect, it, vi } from "vitest";

import { RedisIoAdapter } from "./redis-io.adapter";

const redisUrl = process.env.REDIS_IO_INTEGRATION_URL;

describe.skipIf(!redisUrl)(
  "RedisIoAdapter multi-instance integration",
  () => {
    it("relays and revokes one room across two Socket.IO server instances", async () => {
      const first = await createServerInstance(redisUrl!);
      const second = await createServerInstance(redisUrl!);
      const firstClient = await connectClient(first.port);
      const secondClient = await connectClient(second.port);

      try {
        await Promise.all([
          joinRoom(firstClient, "room_cross_process"),
          joinRoom(secondClient, "room_cross_process"),
        ]);
        const received = new Promise<unknown>((resolve) => {
          secondClient.once("relay:event", resolve);
        });
        first.io
          .to("room_cross_process")
          .emit("relay:event", { source: "first-api" });

        await expect(received).resolves.toEqual({
          source: "first-api",
        });

        const revoked = new Promise<unknown>((resolve) => {
          secondClient.once(
            "presentation:companion:revoked",
            resolve,
          );
        });
        const disconnected = new Promise<void>((resolve) => {
          secondClient.once("disconnect", () => resolve());
        });
        first.io
          .to("room_cross_process")
          .emit("presentation:companion:revoked", {
            reason: "session-ended",
          });
        first.io
          .in("room_cross_process")
          .disconnectSockets(true);

        await expect(revoked).resolves.toEqual({
          reason: "session-ended",
        });
        await expect(disconnected).resolves.toBeUndefined();
      } finally {
        firstClient.disconnect();
        secondClient.disconnect();
        await Promise.all([
          first.adapter.close(first.io),
          second.adapter.close(second.io),
        ]);
      }
    });
  },
);

async function createServerInstance(redisConnectionUrl: string) {
  const httpServer = createServer();
  const adapter = new RedisIoAdapter({
    app: httpServer as never,
    config: {
      APP_ENV: "test",
      REDIS_URL: redisConnectionUrl,
    },
    logger: {
      error: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    },
  });
  await adapter.connectToRedis();
  const io = adapter.createIOServer(0);
  io.on("connection", (socket) => {
    socket.on(
      "room:join",
      async (room: string, acknowledge: () => void) => {
        await socket.join(room);
        acknowledge();
      },
    );
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  const address = httpServer.address() as AddressInfo;
  return { adapter, io, port: address.port };
}

function connectClient(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createSocketClient(`http://127.0.0.1:${port}`, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function joinRoom(socket: Socket, room: string): Promise<void> {
  return new Promise((resolve) => {
    socket.emit("room:join", room, resolve);
  });
}
