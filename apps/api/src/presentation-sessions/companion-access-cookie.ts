import type { OrbitConfig } from "@orbit/config";
import { companionAccessScopeSchema } from "@orbit/shared";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { CookieOptions } from "express";
import { z } from "zod";

export const companionAccessCookieName = "orbit_presentation_companion";
export const companionAccessScopes = [
  "view-audience-output",
  "write-annotation",
] as const;

const companionAccessTokenPayloadSchema = z
  .object({
    companionId: z.string().regex(/^companion_[A-Za-z0-9_-]+$/),
    sessionId: z.string().min(1),
    projectId: z.string().min(1),
    deckId: z.string().min(1),
    deckVersion: z.number().int().positive(),
    pairingGeneration: z.number().int().positive(),
    scopes: z
      .array(companionAccessScopeSchema)
      .min(1)
      .max(companionAccessScopes.length),
    expiresAt: z.string().datetime(),
    uaHash: z.string().min(32),
  })
  .strict();

export type CompanionAccessTokenPayload = z.infer<
  typeof companionAccessTokenPayloadSchema
>;

export type CompanionAccessTokenInput = Omit<
  CompanionAccessTokenPayload,
  "companionId" | "uaHash"
> & {
  companionId?: string;
};

export function createCompanionAccessToken(
  config: OrbitConfig,
  input: CompanionAccessTokenInput,
  userAgent: string,
): string {
  const payload = companionAccessTokenPayloadSchema.parse({
    ...input,
    companionId: input.companionId ?? `companion_${randomUUID()}`,
    uaHash: hashUserAgent(config.SESSION_SECRET, userAgent),
  });
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${encoded}.${sign(config.SESSION_SECRET, encoded)}`;
}

export function verifyCompanionAccessToken(
  config: OrbitConfig,
  token: string,
  userAgent: string,
  now = new Date(),
): CompanionAccessTokenPayload | null {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator !== token.lastIndexOf(".")) {
    return null;
  }
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, sign(config.SESSION_SECRET, encoded))) {
    return null;
  }
  try {
    const payload = companionAccessTokenPayloadSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    if (
      !safeEqual(
        payload.uaHash,
        hashUserAgent(config.SESSION_SECRET, userAgent),
      ) ||
      new Date(payload.expiresAt).getTime() <= now.getTime()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function companionAccessCookieOptions(
  expiresAt: string,
): CookieOptions {
  return {
    expires: new Date(expiresAt),
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: true,
    signed: true,
  };
}

export function clearCompanionAccessCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: true,
    signed: true,
  };
}

function hashUserAgent(secret: string, userAgent: string): string {
  return createHmac("sha256", secret)
    .update(userAgent)
    .digest("base64url");
}

function sign(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
