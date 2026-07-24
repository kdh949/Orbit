import { loadOrbitConfig } from "@orbit/config";
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import { createHmac } from "node:crypto";
import Redis from "ioredis";

export const COMPANION_COMMAND_RATE_LIMIT_REDIS = Symbol(
  "COMPANION_COMMAND_RATE_LIMIT_REDIS",
);
export const companionDrawingRatePerSecond = 120;
export const companionDrawingBurst = 180;
export const companionLaserRatePerSecond = 60;
export const companionLaserBurst = 60;

type RateLimitRedis = Pick<
  Redis,
  "eval" | "quit" | "disconnect" | "status"
>;

const tokenBucketScript = `
-- companion:command-token-bucket
local values = redis.call("HMGET", KEYS[1], "tokens", "updatedAt")
local tokens = tonumber(values[1])
local updatedAt = tonumber(values[2])
local now = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local burst = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
if not tokens or not updatedAt then
  tokens = burst
  updatedAt = now
end
local elapsed = math.max(0, now - updatedAt) / 1000
tokens = math.min(burst, tokens + elapsed * rate)
local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end
redis.call("HSET", KEYS[1], "tokens", tokens, "updatedAt", now)
redis.call("EXPIRE", KEYS[1], 5)
return allowed
`;

@Injectable()
export class PresentationCompanionCommandRateLimitService
  implements OnModuleDestroy
{
  private readonly redis: RateLimitRedis;
  private readonly secret: string;

  constructor(
    @Optional()
    @Inject(COMPANION_COMMAND_RATE_LIMIT_REDIS)
    redis?: RateLimitRedis,
  ) {
    const config = loadOrbitConfig(process.env, { service: "api" });
    this.secret = config.SESSION_SECRET;
    this.redis =
      redis ??
      new Redis(config.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
  }

  consumeDrawing(identity: string): Promise<void> {
    return this.consume(
      "drawing",
      identity,
      companionDrawingRatePerSecond,
      companionDrawingBurst,
    );
  }

  consumeLaser(identity: string): Promise<void> {
    return this.consume(
      "laser",
      identity,
      companionLaserRatePerSecond,
      companionLaserBurst,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === "end") return;
    if (this.redis.status === "wait") {
      this.redis.disconnect();
      return;
    }
    await this.redis.quit();
  }

  private async consume(
    scope: "drawing" | "laser",
    identity: string,
    rate: number,
    burst: number,
  ): Promise<void> {
    const digest = createHmac("sha256", this.secret)
      .update(`${scope}\0${identity}`)
      .digest("hex");
    const allowed = Number(
      await this.redis.eval(
        tokenBucketScript,
        1,
        `presentation-companion:command-rate:${scope}:${digest}`,
        Date.now(),
        rate,
        burst,
        1,
      ),
    );
    if (allowed !== 1) {
      throw new HttpException(
        "Too many presentation commands",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
