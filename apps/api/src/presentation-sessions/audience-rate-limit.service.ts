import { loadOrbitConfig } from "@orbit/config";
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import Redis from "ioredis";

export const AUDIENCE_RATE_LIMIT_ERROR = "Too many audience requests";
export const AUDIENCE_RATE_LIMIT_REDIS = Symbol("AUDIENCE_RATE_LIMIT_REDIS");
export const AUDIENCE_RATE_LIMIT_METRICS = Symbol(
  "AUDIENCE_RATE_LIMIT_METRICS",
);
export const audienceJoinLimitPerMinute = 10;
export const audienceResponseMutationLimitPerMinute = 30;

type RateLimitRedis = Pick<Redis, "eval" | "quit" | "disconnect" | "status">;
export type AudienceRateLimitMetrics = {
  recordJoinBypass(): void;
};

const windowSeconds = 60;
const incrementWithExpiryScript = `
  local count = redis.call("INCR", KEYS[1])
  if count == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
  end
  return count
`;

@Injectable()
export class AudienceRateLimitService implements OnModuleDestroy {
  private readonly redis: RateLimitRedis;
  private readonly secret: string;
  private readonly loadTestMode: boolean;
  private readonly loadTestBypassToken: string | undefined;

  constructor(
    @Optional()
    @Inject(AUDIENCE_RATE_LIMIT_REDIS)
    redis?: RateLimitRedis,
    @Optional()
    @Inject(AUDIENCE_RATE_LIMIT_METRICS)
    private readonly metrics?: AudienceRateLimitMetrics,
  ) {
    const config = loadOrbitConfig(process.env, { service: "api" });
    this.secret = config.SESSION_SECRET;
    this.loadTestMode = config.LOAD_TEST_MODE;
    this.loadTestBypassToken = config.LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN;
    this.redis =
      redis ??
      new Redis(config.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
  }

  async consumeJoin(
    sessionId: string,
    clientAddress: string,
    providedBypassToken?: string,
  ): Promise<void> {
    if (providedBypassToken !== undefined) {
      if (
        !this.loadTestMode ||
        !this.loadTestBypassToken ||
        !tokensMatch(this.loadTestBypassToken, providedBypassToken)
      ) {
        throw new ForbiddenException("Invalid load-test bypass token");
      }
      this.metrics?.recordJoinBypass();
      return;
    }
    await this.consume(
      "join",
      [sessionId, clientAddress],
      audienceJoinLimitPerMinute,
    );
  }

  consumeResponseMutation(audienceId: string, runId: string): Promise<void> {
    return this.consume(
      "response",
      [audienceId, runId],
      audienceResponseMutationLimitPerMinute,
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
    scope: "join" | "response",
    identifiers: string[],
    limit: number,
  ): Promise<void> {
    const key = this.key(scope, identifiers);
    const count = Number(
      await this.redis.eval(incrementWithExpiryScript, 1, key, windowSeconds),
    );
    if (!Number.isFinite(count) || count > limit) {
      throw new HttpException(
        AUDIENCE_RATE_LIMIT_ERROR,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private key(scope: "join" | "response", identifiers: string[]): string {
    const digest = createHmac("sha256", this.secret)
      .update([scope, ...identifiers].join("\0"))
      .digest("hex");
    return `audience:rate:${scope}:${digest}`;
  }
}

function tokensMatch(expected: string, provided: string): boolean {
  const expectedDigest = createHash("sha256").update(expected).digest();
  const providedDigest = createHash("sha256").update(provided).digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}
