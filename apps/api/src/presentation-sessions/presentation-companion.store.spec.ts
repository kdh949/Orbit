import { describe, expect, it } from "vitest";

import {
  PresentationCompanionStore,
  type PresentationCompanionRedis,
} from "./presentation-companion.store";

const pairing = {
  sessionId: "session_1",
  projectId: "project_1",
  deckId: "deck_1",
  deckVersion: 4,
  sessionExpiresAt: "2026-07-23T04:00:00.000Z",
};

describe("PresentationCompanionStore", () => {
  it("atomically consumes one HMAC-keyed pairing code under concurrency", async () => {
    const redis = new FakeCompanionRedis();
    const store = new PresentationCompanionStore(redis, "store-secret");
    const rawCode = "raw-single-use-code";

    await store.putPairing(rawCode, pairing);
    expect([...redis.values.keys()].join(" ")).not.toContain(rawCode);
    expect([...redis.values.values()].join(" ")).not.toContain(rawCode);

    const consumed = await Promise.all([
      store.consumePairing(rawCode),
      store.consumePairing(rawCode),
    ]);
    expect(consumed.filter(Boolean)).toEqual([pairing]);
  });

  it("fails closed for expired and corrupt pairing payloads", async () => {
    const redis = new FakeCompanionRedis();
    const store = new PresentationCompanionStore(redis, "store-secret");

    await store.putPairing("expired-code", pairing, 2);
    redis.advance(2_001);
    await expect(store.consumePairing("expired-code")).resolves.toBeNull();

    await store.putPairing("corrupt-code", pairing);
    const key = [...redis.values.keys()][0];
    if (!key) throw new Error("pairing key missing");
    redis.values.set(key, { expiresAtMs: null, value: "{private-corrupt" });
    await expect(store.consumePairing("corrupt-code")).resolves.toBeNull();
    expect(redis.values.has(key)).toBe(false);
  });

  it("keeps a monotonic invalidation floor when a session is revoked", async () => {
    const redis = new FakeCompanionRedis();
    const store = new PresentationCompanionStore(redis, "store-secret");

    await expect(store.issueGeneration("session_1", 60)).resolves.toEqual({
      generation: 1,
      previousGeneration: null,
    });
    await expect(store.issueGeneration("session_1", 60)).resolves.toEqual({
      generation: 2,
      previousGeneration: 1,
    });
    await expect(store.getLatestGeneration("session_1")).resolves.toBe(2);

    await store.revokeSession("session_1");
    await expect(store.getLatestGeneration("session_1")).resolves.toBe(3);
    await expect(store.issueGeneration("session_1", 60)).resolves.toEqual({
      generation: 4,
      previousGeneration: 3,
    });
  });

  it("returns each immediately preceding generation under concurrent issuance", async () => {
    const redis = new FakeCompanionRedis();
    const store = new PresentationCompanionStore(redis, "store-secret");

    await expect(
      Promise.all([
        store.issueGeneration("session_1", 60),
        store.issueGeneration("session_1", 60),
        store.issueGeneration("session_1", 60),
      ]),
    ).resolves.toEqual([
      { generation: 1, previousGeneration: null },
      { generation: 2, previousGeneration: 1 },
      { generation: 3, previousGeneration: 2 },
    ]);
  });

  it("replaces and revokes pending pairing keys without storing raw codes", async () => {
    const redis = new FakeCompanionRedis();
    const store = new PresentationCompanionStore(redis, "store-secret");

    await store.putPairing("first-private-code", pairing);
    await store.putPairing("second-private-code", pairing);
    expect([...redis.values.keys()].join(" ")).not.toContain(
      "first-private-code",
    );
    await expect(
      store.consumePairing("first-private-code"),
    ).resolves.toBeNull();
    await store.issueGeneration("session_1", 60);
    await store.claimAuthority("session_1", "epoch_1");
    await store.renewPresence("session_1", {
      generation: 1,
      connectedAt: "2026-07-23T00:00:00.000Z",
      rttBucket: "fast",
    });

    await store.revokeSession("session_1");
    await expect(
      store.consumePairing("second-private-code"),
    ).resolves.toBeNull();
    await expect(store.getLatestGeneration("session_1")).resolves.toBe(2);
    await expect(store.getAuthority("session_1")).resolves.toBeNull();
    await expect(store.getPresence("session_1")).resolves.toBeNull();
    expect(redis.values.size).toBe(1);
  });

  it("allows one authority epoch until its lease expires", async () => {
    const redis = new FakeCompanionRedis();
    const store = new PresentationCompanionStore(redis, "store-secret");

    await expect(
      store.claimAuthority("session_1", "epoch_tab_1", 10),
    ).resolves.toBe(true);
    await expect(
      store.claimAuthority("session_1", "epoch_tab_2", 10),
    ).resolves.toBe(false);
    await expect(
      store.heartbeatAuthority("session_1", "epoch_tab_1", 10),
    ).resolves.toBe(true);

    redis.advance(10_001);
    await expect(
      store.claimAuthority("session_1", "epoch_tab_2", 10),
    ).resolves.toBe(true);
    await expect(store.getAuthority("session_1")).resolves.toBe("epoch_tab_2");
  });

  it("expires presence without revoking reconnect generation", async () => {
    const redis = new FakeCompanionRedis();
    const store = new PresentationCompanionStore(redis, "store-secret");
    await store.issueGeneration("session_1", 60);
    await store.renewPresence(
      "session_1",
      {
        generation: 1,
        connectedAt: "2026-07-23T00:00:00.000Z",
        rttBucket: "fast",
      },
      15,
    );

    redis.advance(15_001);
    await expect(store.getPresence("session_1")).resolves.toBeNull();
    await expect(store.getLatestGeneration("session_1")).resolves.toBe(1);
  });

  it("does not let a stale socket clear newer generation presence", async () => {
    const redis = new FakeCompanionRedis();
    const store = new PresentationCompanionStore(redis, "store-secret");
    await store.renewPresence("session_1", {
      generation: 2,
      connectedAt: "2026-07-23T00:00:00.000Z",
      rttBucket: "fast",
    });

    await expect(store.clearPresence("session_1", 1)).resolves.toBe(false);
    await expect(store.getPresence("session_1")).resolves.toMatchObject({
      generation: 2,
    });
    await expect(store.clearPresence("session_1", 2)).resolves.toBe(true);
    await expect(store.getPresence("session_1")).resolves.toBeNull();
  });
});

class FakeCompanionRedis implements PresentationCompanionRedis {
  status = "ready";
  nowMs = 0;
  values = new Map<
    string,
    { expiresAtMs: number | null; value: string }
  >();

  advance(durationMs: number) {
    this.nowMs += durationMs;
  }

  async set(
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number,
  ) {
    if (mode !== "EX") throw new Error("unsupported fake set mode");
    this.values.set(key, {
      expiresAtMs: this.nowMs + ttlSeconds * 1_000,
      value,
    });
    return "OK";
  }

  async get(key: string) {
    return this.read(key);
  }

  private read(key: string) {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs !== null && entry.expiresAtMs <= this.nowMs) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  }

  async del(...keys: string[]) {
    return keys.reduce(
      (count, key) => count + (this.values.delete(key) ? 1 : 0),
      0,
    );
  }

  async eval(
    script: string,
    _numberOfKeys: number,
    ...args: Array<string | number>
  ) {
    const key = String(args[0]);
    if (script.includes("companion:put-pairing")) {
      const pairingKey = key;
      const indexKey = String(args[1]);
      const previous = await this.get(indexKey);
      if (previous && previous !== pairingKey) {
        this.values.delete(previous);
      }
      await this.set(
        pairingKey,
        String(args[2]),
        "EX",
        Number(args[3]),
      );
      await this.set(
        indexKey,
        pairingKey,
        "EX",
        Number(args[3]),
      );
      return 1;
    }
    if (script.includes("companion:consume-pairing")) {
      const value = this.read(key);
      if (value !== null) this.values.delete(key);
      return value;
    }
    if (script.includes("companion:clear-pairing-index")) {
      const expectedPairingKey = String(args[1]);
      if ((await this.get(key)) !== expectedPairingKey) return 0;
      this.values.delete(key);
      return 1;
    }
    if (script.includes("companion:revoke-session")) {
      const pairingIndexKey = String(args[3]);
      const pendingPairingKey = await this.get(pairingIndexKey);
      const generationEntry = this.values.get(key);
      const generation = this.read(key);
      if (generationEntry && generation !== null) {
        this.values.set(key, {
          ...generationEntry,
          value: String(Number(generation) + 1),
        });
      }
      await this.del(
        String(args[1]),
        String(args[2]),
        pairingIndexKey,
      );
      if (pendingPairingKey) {
        await this.del(pendingPairingKey);
      }
      return 1;
    }
    if (script.includes("companion:issue-generation")) {
      const previous = Number(this.read(key) ?? "0");
      const current = previous + 1;
      this.values.set(key, {
        expiresAtMs: this.nowMs + Number(args[1]) * 1_000,
        value: String(current),
      });
      return [String(previous), String(current)];
    }
    if (script.includes("companion:claim-authority")) {
      const epoch = String(args[1]);
      const current = await this.get(key);
      if (current && current !== epoch) return 0;
      await this.set(key, epoch, "EX", Number(args[2]));
      return 1;
    }
    if (script.includes("companion:heartbeat-authority")) {
      const epoch = String(args[1]);
      const current = await this.get(key);
      if (!current || current !== epoch) return 0;
      await this.set(key, epoch, "EX", Number(args[2]));
      return 1;
    }
    if (script.includes("companion:clear-presence")) {
      const expectedGeneration = Number(args[1]);
      const value = this.read(key);
      if (!value) return 0;
      const presence = JSON.parse(value) as { generation?: unknown };
      if (presence.generation !== expectedGeneration) return 0;
      this.values.delete(key);
      return 1;
    }
    throw new Error("unsupported fake eval script");
  }

  async quit() {
    this.status = "end";
    return "OK";
  }

  disconnect() {
    this.status = "end";
  }
}
