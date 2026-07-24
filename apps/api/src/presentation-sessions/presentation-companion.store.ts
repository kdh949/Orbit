import { loadOrbitConfig } from "@orbit/config";
import { createHmac } from "node:crypto";
import Redis from "ioredis";
import { z } from "zod";

const pairingSchema = z
  .object({
    sessionId: z.string().min(1),
    projectId: z.string().min(1),
    deckId: z.string().min(1),
    deckVersion: z.number().int().positive(),
    sessionExpiresAt: z.string().datetime(),
  })
  .strict();

const presenceSchema = z
  .object({
    generation: z.number().int().positive(),
    connectedAt: z.string().datetime(),
    rttBucket: z.enum(["fast", "moderate", "slow", "unknown"]),
  })
  .strict();

export type PresentationCompanionPairing = z.infer<typeof pairingSchema>;
export type PresentationCompanionPresence = z.infer<typeof presenceSchema>;
export type PresentationCompanionGenerationIssue = {
  generation: number;
  previousGeneration: number | null;
};

export interface PresentationCompanionRedis {
  status: string;
  set(
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number,
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
  quit(): Promise<unknown>;
  disconnect(): void;
}

const consumePairingScript = `
-- companion:consume-pairing
local value = redis.call("GET", KEYS[1])
if not value then return nil end
redis.call("DEL", KEYS[1])
return value
`;

const putPairingScript = `
-- companion:put-pairing
local previous = redis.call("GET", KEYS[2])
if previous and previous ~= KEYS[1] then
  redis.call("DEL", previous)
end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[2], KEYS[1], "EX", ARGV[2])
return 1
`;

const clearPairingIndexScript = `
-- companion:clear-pairing-index
local current = redis.call("GET", KEYS[1])
if not current or current ~= ARGV[1] then return 0 end
redis.call("DEL", KEYS[1])
return 1
`;

const revokeSessionScript = `
-- companion:revoke-session
local pendingPairingKey = redis.call("GET", KEYS[4])
if redis.call("GET", KEYS[1]) then
  redis.call("INCR", KEYS[1])
end
redis.call("DEL", KEYS[2], KEYS[3], KEYS[4])
if pendingPairingKey then
  redis.call("DEL", pendingPairingKey)
end
return 1
`;

const issueGenerationScript = `
-- companion:issue-generation
local previous = redis.call("GET", KEYS[1])
local generation = redis.call("INCR", KEYS[1])
redis.call("EXPIRE", KEYS[1], ARGV[1])
return { previous or "0", tostring(generation) }
`;

const claimAuthorityScript = `
-- companion:claim-authority
local current = redis.call("GET", KEYS[1])
if current and current ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
return 1
`;

const heartbeatAuthorityScript = `
-- companion:heartbeat-authority
local current = redis.call("GET", KEYS[1])
if not current or current ~= ARGV[1] then return 0 end
redis.call("EXPIRE", KEYS[1], ARGV[2])
return 1
`;

const clearPresenceScript = `
-- companion:clear-presence
local value = redis.call("GET", KEYS[1])
if not value then return 0 end
local ok, presence = pcall(cjson.decode, value)
if not ok or tonumber(presence.generation) ~= tonumber(ARGV[1]) then
  return 0
end
redis.call("DEL", KEYS[1])
return 1
`;

export class PresentationCompanionStore {
  constructor(
    private readonly redis: PresentationCompanionRedis,
    private readonly sessionSecret: string,
  ) {}

  async putPairing(
    code: string,
    pairing: PresentationCompanionPairing,
    ttlSeconds = 120,
  ): Promise<void> {
    assertTtl(ttlSeconds);
    const pairingKey = this.key("pairing", code);
    await this.redis.eval(
      putPairingScript,
      2,
      pairingKey,
      this.key("pairing-session", pairing.sessionId),
      JSON.stringify(pairingSchema.parse(pairing)),
      ttlSeconds,
    );
  }

  async consumePairing(
    code: string,
  ): Promise<PresentationCompanionPairing | null> {
    const value = await this.redis.eval(
      consumePairingScript,
      1,
      this.key("pairing", code),
    );
    if (typeof value !== "string") {
      return null;
    }
    try {
      const pairing = pairingSchema.parse(JSON.parse(value));
      await this.redis.eval(
        clearPairingIndexScript,
        1,
        this.key("pairing-session", pairing.sessionId),
        this.key("pairing", code),
      );
      return pairing;
    } catch {
      return null;
    }
  }

  async issueGeneration(
    sessionId: string,
    ttlSeconds: number,
  ): Promise<PresentationCompanionGenerationIssue> {
    assertTtl(ttlSeconds);
    const value = await this.redis.eval(
      issueGenerationScript,
      1,
      this.key("generation", sessionId),
      ttlSeconds,
    );
    if (!Array.isArray(value) || value.length !== 2) {
      throw new Error("Companion generation unavailable");
    }
    const previousGeneration = Number(value[0]);
    const generation = Number(value[1]);
    if (
      !Number.isSafeInteger(previousGeneration) ||
      previousGeneration < 0
    ) {
      throw new Error("Companion generation unavailable");
    }
    if (!Number.isSafeInteger(generation) || generation <= 0) {
      throw new Error("Companion generation unavailable");
    }
    return {
      generation,
      previousGeneration:
        previousGeneration === 0 ? null : previousGeneration,
    };
  }

  async getLatestGeneration(sessionId: string): Promise<number | null> {
    const key = this.key("generation", sessionId);
    const value = await this.redis.get(key);
    if (value === null) {
      return null;
    }
    const generation = Number(value);
    if (!Number.isSafeInteger(generation) || generation <= 0) {
      await this.redis.del(key);
      return null;
    }
    return generation;
  }

  async claimAuthority(
    sessionId: string,
    authorityEpochId: string,
    ttlSeconds = 10,
  ): Promise<boolean> {
    assertOpaqueIdentifier(authorityEpochId);
    assertTtl(ttlSeconds);
    return (
      Number(
        await this.redis.eval(
          claimAuthorityScript,
          1,
          this.key("authority", sessionId),
          authorityEpochId,
          ttlSeconds,
        ),
      ) === 1
    );
  }

  async heartbeatAuthority(
    sessionId: string,
    authorityEpochId: string,
    ttlSeconds = 10,
  ): Promise<boolean> {
    assertOpaqueIdentifier(authorityEpochId);
    assertTtl(ttlSeconds);
    return (
      Number(
        await this.redis.eval(
          heartbeatAuthorityScript,
          1,
          this.key("authority", sessionId),
          authorityEpochId,
          ttlSeconds,
        ),
      ) === 1
    );
  }

  getAuthority(sessionId: string): Promise<string | null> {
    return this.redis.get(this.key("authority", sessionId));
  }

  async renewPresence(
    sessionId: string,
    presence: PresentationCompanionPresence,
    ttlSeconds = 15,
  ): Promise<void> {
    assertTtl(ttlSeconds);
    await this.redis.set(
      this.key("presence", sessionId),
      JSON.stringify(presenceSchema.parse(presence)),
      "EX",
      ttlSeconds,
    );
  }

  async getPresence(
    sessionId: string,
  ): Promise<PresentationCompanionPresence | null> {
    const key = this.key("presence", sessionId);
    const value = await this.redis.get(key);
    if (!value) {
      return null;
    }
    try {
      return presenceSchema.parse(JSON.parse(value));
    } catch {
      await this.redis.del(key);
      return null;
    }
  }

  async clearPresence(
    sessionId: string,
    expectedGeneration: number,
  ): Promise<boolean> {
    if (
      !Number.isSafeInteger(expectedGeneration) ||
      expectedGeneration <= 0
    ) {
      return false;
    }
    return (
      Number(
        await this.redis.eval(
          clearPresenceScript,
          1,
          this.key("presence", sessionId),
          expectedGeneration,
        ),
      ) === 1
    );
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.redis.eval(
      revokeSessionScript,
      4,
      this.key("generation", sessionId),
      this.key("authority", sessionId),
      this.key("presence", sessionId),
      this.key("pairing-session", sessionId),
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === "end") {
      return;
    }
    if (this.redis.status === "wait") {
      this.redis.disconnect();
      return;
    }
    await this.redis.quit();
  }

  private key(kind: string, value: string): string {
    const digest = createHmac("sha256", this.sessionSecret)
      .update(`${kind}:${value}`)
      .digest("hex");
    return `presentation-companion:${kind}:${digest}`;
  }
}

export function createRedisPresentationCompanionStore() {
  const config = loadOrbitConfig(process.env, { service: "api" });
  const redis = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  return new PresentationCompanionStore(redis, config.SESSION_SECRET);
}

function assertTtl(ttlSeconds: number): void {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new Error("Companion TTL must be a positive integer");
  }
}

function assertOpaqueIdentifier(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error("Companion opaque identifier is invalid");
  }
}
