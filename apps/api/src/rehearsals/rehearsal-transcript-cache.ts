import { loadOrbitConfig } from "@orbit/config";
import { rehearsalSemanticEvidenceCacheKey } from "@orbit/shared/rehearsals";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

export const REHEARSAL_TRANSCRIPT_TTL_SECONDS = 30 * 60;

export interface RehearsalTranscriptCache {
  hasSemanticEvidence(runId: string): Promise<boolean>;
}

@Injectable()
export class RedisRehearsalTranscriptCache
  implements RehearsalTranscriptCache, OnModuleDestroy
{
  private readonly redis: Redis;

  constructor() {
    const config = loadOrbitConfig(process.env, { service: "api" });
    this.redis = new Redis(config.PRIVATE_EVIDENCE_REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });
  }

  async hasSemanticEvidence(runId: string): Promise<boolean> {
    return (await this.redis.exists(rehearsalSemanticEvidenceCacheKey(runId))) > 0;
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
}
