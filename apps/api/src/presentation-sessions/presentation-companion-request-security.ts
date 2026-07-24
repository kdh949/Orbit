import { loadOrbitConfig, type OrbitConfig } from "@orbit/config";
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  Optional,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { Request } from "express";
import Redis from "ioredis";

import { normalizeHttpOrigin } from "../common/web-origin";

export const COMPANION_RATE_LIMIT_REDIS = Symbol(
  "COMPANION_RATE_LIMIT_REDIS",
);
export const COMPANION_RATE_LIMIT_ERROR =
  "Too many presentation companion requests";
export const companionPairingCreateLimitPerMinute = 10;
export const companionPairingExchangeLimitPerMinute = 20;

type RateLimitRedis = Pick<
  Redis,
  "eval" | "quit" | "disconnect" | "status"
>;

const windowSeconds = 60;
const incrementWithExpiryScript = `
-- companion:rate-limit
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

@Injectable()
export class PresentationCompanionRateLimitService
  implements OnModuleDestroy
{
  private readonly redis: RateLimitRedis;
  private readonly secret: string;

  constructor(
    @Optional()
    @Inject(COMPANION_RATE_LIMIT_REDIS)
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

  consumePairingCreate(
    projectId: string,
    clientAddress: string,
  ): Promise<void> {
    return this.consume(
      "create",
      [projectId, clientAddress],
      companionPairingCreateLimitPerMinute,
    );
  }

  consumePairingExchange(clientAddress: string): Promise<void> {
    return this.consume(
      "exchange",
      [clientAddress],
      companionPairingExchangeLimitPerMinute,
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
    scope: "create" | "exchange",
    identifiers: string[],
    limit: number,
  ): Promise<void> {
    const count = Number(
      await this.redis.eval(
        incrementWithExpiryScript,
        1,
        this.key(scope, identifiers),
        windowSeconds,
      ),
    );
    if (!Number.isFinite(count) || count > limit) {
      throw new HttpException(
        COMPANION_RATE_LIMIT_ERROR,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private key(
    scope: "create" | "exchange",
    identifiers: string[],
  ): string {
    const digest = createHmac("sha256", this.secret)
      .update([scope, ...identifiers].join("\0"))
      .digest("hex");
    return `presentation-companion:rate:${scope}:${digest}`;
  }
}

export function assertPresentationCompanionEnabled(
  config: OrbitConfig,
): void {
  if (!config.IPAD_PRESENTER_COMPANION_ENABLED) {
    throw new NotFoundException("Presentation companion unavailable");
  }
}

export function assertCompanionSameOrigin(
  config: OrbitConfig,
  request: Request,
): void {
  const origin = normalizeHttpOrigin(getHeader(request, "origin"));
  const expected = normalizeHttpOrigin(config.WEB_ORIGIN);
  if (!origin || !expected || origin !== expected) {
    throw new ForbiddenException("Same-origin request required");
  }
}

export function assertCompanionJsonSameOrigin(
  config: OrbitConfig,
  request: Request,
): void {
  const contentType = getHeader(request, "content-type");
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new UnsupportedMediaTypeException("JSON content type required");
  }
  assertCompanionSameOrigin(config, request);
}

export function resolveCompanionPublicWebOrigin(
  webOrigin: string,
): string {
  const normalized = normalizeHttpOrigin(webOrigin);
  if (!normalized) {
    throw companionPublicOriginUnavailable();
  }
  const parsed = new URL(normalized);
  if (
    parsed.protocol !== "https:" ||
    (parsed.port !== "" && parsed.port !== "443") ||
    isPrivateWebHostname(parsed.hostname)
  ) {
    throw companionPublicOriginUnavailable();
  }
  return parsed.origin;
}

export function getCompanionClientAddress(request: Request): string {
  return request.ip || "unknown";
}

export function getCompanionUserAgent(request: Request): string {
  return getHeader(request, "user-agent") ?? "";
}

function companionPublicOriginUnavailable() {
  return new ServiceUnavailableException(
    "Presentation companion requires a public HTTPS web origin",
  );
}

function isPrivateWebHostname(hostname: string): boolean {
  const normalized = hostname
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .toLowerCase();
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  ) {
    return true;
  }
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const octets = normalized.split(".").map(Number);
    const [first, second] = octets;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    );
  }
  if (ipVersion === 6) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized)
    );
  }
  return normalized.length === 0;
}

function getHeader(
  request: Request,
  name: string,
): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
