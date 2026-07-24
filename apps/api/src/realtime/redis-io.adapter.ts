import type { OrbitConfig } from "@orbit/config";
import { createAdapter } from "@socket.io/redis-adapter";
import type { INestApplicationContext } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import Redis from "ioredis";
import type { Server, ServerOptions } from "socket.io";

type RedisAdapterFactory = typeof createAdapter;

export type RedisIoClient = {
  status: string;
  connect(): Promise<unknown>;
  duplicate(): RedisIoClient;
  quit(): Promise<unknown>;
  disconnect(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
};

export type RedisIoLogger = {
  log(
    object: Record<string, unknown>,
    message: string,
  ): unknown;
  warn(
    object: Record<string, unknown>,
    message: string,
  ): unknown;
  error(
    object: Record<string, unknown>,
    message: string,
  ): unknown;
};

type RedisIoAdapterOptions = {
  app: INestApplicationContext;
  config: Pick<OrbitConfig, "APP_ENV" | "REDIS_URL">;
  logger: RedisIoLogger;
  createClient?: (redisUrl: string) => RedisIoClient;
  createRedisAdapter?: RedisAdapterFactory;
};

type AdapterState = "pending" | "redis" | "memory" | "closed";

export class RedisIoAdapter extends IoAdapter {
  private readonly appEnv: OrbitConfig["APP_ENV"];
  private readonly redisUrl: string;
  private readonly logger: RedisIoLogger;
  private readonly createClient: (redisUrl: string) => RedisIoClient;
  private readonly createRedisAdapter: RedisAdapterFactory;
  private adapterFactory: ReturnType<RedisAdapterFactory> | null = null;
  private clients: RedisIoClient[] = [];
  private state: AdapterState = "pending";

  constructor(options: RedisIoAdapterOptions) {
    super(options.app);
    this.appEnv = options.config.APP_ENV;
    this.redisUrl = options.config.REDIS_URL;
    this.logger = options.logger;
    this.createClient =
      options.createClient ??
      ((redisUrl) =>
        new Redis(redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        }) as unknown as RedisIoClient);
    this.createRedisAdapter =
      options.createRedisAdapter ?? createAdapter;
  }

  async connectToRedis(): Promise<"redis" | "memory"> {
    if (this.state === "redis" || this.state === "memory") {
      return this.state;
    }
    if (this.state !== "pending") {
      throw new Error("Socket.IO Redis adapter is closed");
    }

    const publisher = this.createClient(this.redisUrl);
    const subscriber = publisher.duplicate();
    this.clients = [publisher, subscriber];
    for (const [role, client] of [
      ["publisher", publisher],
      ["subscriber", subscriber],
    ] as const) {
      client.on("error", (error) => {
        this.logger.error(
          {
            event: "socket_io.redis_adapter_error",
            clientRole: role,
            errorName: error.name,
          },
          "Socket.IO Redis adapter client error",
        );
      });
    }

    try {
      await Promise.all([
        connectRedisClient(publisher),
        connectRedisClient(subscriber),
      ]);
      this.adapterFactory = this.createRedisAdapter(
        publisher,
        subscriber,
        {
          key: "orbit:socket.io",
          publishOnSpecificResponseChannel: true,
        },
      );
      this.state = "redis";
      this.logger.log(
        {
          event: "socket_io.redis_adapter_ready",
          appEnv: this.appEnv,
        },
        "Socket.IO Redis adapter ready",
      );
      return "redis";
    } catch (error) {
      await this.closeRedisClients();
      if (isRemoteEnvironment(this.appEnv)) {
        throw new Error(
          "Socket.IO Redis adapter is required in remote environments",
          { cause: error },
        );
      }
      this.state = "memory";
      this.logger.warn(
        {
          event: "socket_io.redis_adapter_fallback",
          appEnv: this.appEnv,
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Socket.IO uses the in-memory adapter in local/test",
      );
      return "memory";
    }
  }

  override createIOServer(
    port: number,
    options?: ServerOptions,
  ): Server {
    if (this.state === "pending") {
      throw new Error(
        "connectToRedis must complete before creating Socket.IO",
      );
    }
    if (this.state === "closed") {
      throw new Error("Socket.IO Redis adapter is closed");
    }
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterFactory) {
      server.adapter(this.adapterFactory);
    }
    return server;
  }

  override async close(server: Server): Promise<void> {
    try {
      await super.close(server);
    } finally {
      await this.closeRedisClients();
    }
  }

  override async dispose(): Promise<void> {
    try {
      await super.dispose();
    } finally {
      await this.closeRedisClients();
    }
  }

  private async closeRedisClients(): Promise<void> {
    if (this.clients.length === 0) {
      this.adapterFactory = null;
      this.state = "closed";
      return;
    }
    const clients = this.clients;
    this.clients = [];
    await Promise.allSettled(
      clients.map(async (client) => {
        if (client.status === "end") return;
        if (client.status === "wait") {
          client.disconnect();
          return;
        }
        await client.quit();
      }),
    );
    this.adapterFactory = null;
    this.state = "closed";
  }
}

function connectRedisClient(client: RedisIoClient): Promise<unknown> {
  if (client.status === "ready" || client.status === "connect") {
    return Promise.resolve();
  }
  return client.connect();
}

function isRemoteEnvironment(
  appEnv: OrbitConfig["APP_ENV"],
): boolean {
  return appEnv === "staging" || appEnv === "production";
}
