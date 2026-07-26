import { loadOrbitConfig } from "@orbit/config";
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res
} from "@nestjs/common";
import { joinAudiencePresentationRequestSchema } from "@orbit/shared/presentation";
import type { Response } from "express";

import { parseRequest } from "../common/zod-request";
import {
  audienceAccessCookieName,
  audienceAccessCookieOptions,
  createAudienceAccessToken,
  createAudienceId,
  verifyAudienceAccessToken
} from "./audience-access-cookie";
import { PresentationSessionsService } from "./presentation-sessions.service";
import {
  assertAudienceJsonSameOrigin,
  getAudienceClientAddress,
  getUserAgent,
  requireAudienceIdentity,
  type SignedCookieRequest
} from "./audience-request-security";

@Controller("api/v1/audience-sessions")
export class AudienceSessionsController {
  private readonly config = loadOrbitConfig(process.env, { service: "api" });

  constructor(private readonly presentationSessionsService: PresentationSessionsService) {}

  @Get(":sessionId/public")
  getPublic(@Param("sessionId") sessionId: string) {
    return this.presentationSessionsService.getAudiencePublicInfo(sessionId);
  }

  @Post(":sessionId/join")
  async join(
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    assertAudienceJsonSameOrigin(this.config, request);
    const input = parseRequest(joinAudiencePresentationRequestSchema, body ?? {});
    const userAgent = getUserAgent(request);
    const existing = getSignedAudienceAccessToken(request);
    const existingPayload = existing
      ? verifyAudienceAccessToken(this.config, existing, userAgent)
      : null;
    const audienceId =
      existingPayload?.sessionId === sessionId
        ? existingPayload.audienceId
        : createAudienceId();
    const result = await this.presentationSessionsService.joinAudience(
      sessionId,
      input,
      audienceId,
      getAudienceClientAddress(request)
    );

    response.cookie(
      audienceAccessCookieName,
      createAudienceAccessToken(this.config, result.session, userAgent, audienceId),
      audienceAccessCookieOptions(this.config, result.session.expiresAt)
    );
    return result;
  }

  @Get(":sessionId/access")
  async getAccess(
    @Param("sessionId") sessionId: string,
    @Req() request: SignedCookieRequest
  ) {
    const payload = requireAudienceIdentity(this.config, request, sessionId);
    return this.presentationSessionsService.getAudienceAccess(sessionId, payload.projectId);
  }
}

function getSignedAudienceAccessToken(request: SignedCookieRequest): string | null {
  const value = request.signedCookies?.[audienceAccessCookieName];
  return typeof value === "string" && value.length > 0 ? value : null;
}
