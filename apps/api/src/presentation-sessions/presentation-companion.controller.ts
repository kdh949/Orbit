import { loadOrbitConfig } from "@orbit/config";
import {
  presentationCompanionExchangeResponseSchema,
  presentationCompanionPairingResponseSchema,
} from "@orbit/shared";
import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { authSessionCookieName } from "../auth/auth.constants";
import { AuthService } from "../auth/auth.service";
import { ProjectsService } from "../projects/projects.service";
import {
  companionAccessCookieName,
  companionAccessCookieOptions,
} from "./companion-access-cookie";
import { PresentationCompanionProjectionService } from "./presentation-companion-projection.service";
import { PresentationCompanionActivityService } from "./presentation-companion-activity.service";
import {
  assertCompanionJsonSameOrigin,
  assertCompanionSameOrigin,
  assertPresentationCompanionEnabled,
  getCompanionClientAddress,
  getCompanionUserAgent,
  PresentationCompanionRateLimitService,
  resolveCompanionPublicWebOrigin,
} from "./presentation-companion-request-security";
import { PresentationCompanionService } from "./presentation-companion.service";

type SignedCookieRequest = Request & {
  signedCookies?: Record<string, string | false | undefined>;
};

@Controller(
  "api/v1/projects/:projectId/presentation-sessions/:sessionId",
)
export class ProjectPresentationCompanionController {
  private readonly config = loadOrbitConfig(process.env, {
    service: "api",
  });

  constructor(
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService,
    private readonly companion: PresentationCompanionService,
    private readonly rateLimit: PresentationCompanionRateLimitService,
  ) {}

  @Post("companion-pairings")
  async createPairing(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Req() request: SignedCookieRequest,
  ) {
    assertPresentationCompanionEnabled(this.config);
    assertCompanionJsonSameOrigin(this.config, request);
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(
      projectId,
      user.userId,
    );
    const publicOrigin = resolveCompanionPublicWebOrigin(
      this.config.WEB_ORIGIN,
    );
    await this.rateLimit.consumePairingCreate(
      projectId,
      getCompanionClientAddress(request),
    );
    const pairing = await this.companion.createPairing(
      projectId,
      sessionId,
    );
    return presentationCompanionPairingResponseSchema.parse({
      pairingUrl: new URL(
        `/companion/pair/${encodeURIComponent(pairing.code)}`,
        publicOrigin,
      ).toString(),
      expiresAt: pairing.expiresAt,
    });
  }

  @Get("companion-status")
  async getStatus(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Req() request: SignedCookieRequest,
  ) {
    assertPresentationCompanionEnabled(this.config);
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(
      projectId,
      user.userId,
    );
    return this.companion.getStatus(projectId, sessionId);
  }

  @Delete("companion")
  @HttpCode(204)
  async disconnect(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Req() request: SignedCookieRequest,
  ): Promise<void> {
    assertPresentationCompanionEnabled(this.config);
    assertCompanionSameOrigin(this.config, request);
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(
      projectId,
      user.userId,
    );
    await this.companion.disconnect(projectId, sessionId);
  }

  private async getCurrentUser(request: SignedCookieRequest) {
    const value = request.signedCookies?.[authSessionCookieName];
    if (typeof value !== "string" || value.length === 0) {
      throw new UnauthorizedException("Authentication required");
    }
    return (await this.authService.me(value)).user;
  }
}

@Controller("api/v1/presentation-companion")
export class PublicPresentationCompanionController {
  private readonly config = loadOrbitConfig(process.env, {
    service: "api",
  });

  constructor(
    private readonly companion: PresentationCompanionService,
    private readonly projection: PresentationCompanionProjectionService,
    private readonly activity: PresentationCompanionActivityService,
    private readonly rateLimit: PresentationCompanionRateLimitService,
  ) {}

  @Post("pairings/:code/exchange")
  @HttpCode(200)
  async exchange(
    @Param("code") code: string,
    @Req() request: SignedCookieRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertPresentationCompanionEnabled(this.config);
    assertCompanionJsonSameOrigin(this.config, request);
    await this.rateLimit.consumePairingExchange(
      getCompanionClientAddress(request),
    );
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(code)) {
      throw companionUnavailable();
    }
    const exchange = await this.companion.exchangePairing(
      code,
      getCompanionUserAgent(request),
    );
    response.cookie(
      companionAccessCookieName,
      exchange.token,
      companionAccessCookieOptions(exchange.credential.expiresAt),
    );
    return presentationCompanionExchangeResponseSchema.parse({
      sessionId: exchange.credential.sessionId,
      expiresAt: exchange.credential.expiresAt,
      scopes: exchange.credential.scopes,
    });
  }

  @Get(":sessionId/bootstrap")
  getBootstrap(
    @Param("sessionId") sessionId: string,
    @Req() request: SignedCookieRequest,
  ) {
    assertPresentationCompanionEnabled(this.config);
    return this.companion.getBootstrap(
      this.getCredential(request),
      getCompanionUserAgent(request),
      sessionId,
    );
  }

  @Get(":sessionId/assets/:fileId/content")
  async readAsset(
    @Param("sessionId") sessionId: string,
    @Param("fileId") fileId: string,
    @Req() request: SignedCookieRequest,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertPresentationCompanionEnabled(this.config);
    const credential = await this.companion.verifyCredential(
      this.getCredential(request),
      getCompanionUserAgent(request),
      sessionId,
    );
    if (!credential) {
      throw companionUnavailable();
    }
    const asset = await this.projection.openReferencedAsset(
      sessionId,
      fileId,
      ifNoneMatch,
    );
    response.setHeader("cache-control", asset.cacheControl);
    response.setHeader("etag", asset.etag);
    if (asset.status === "not-modified") {
      response.status(304).end();
      return;
    }
    response.setHeader("content-type", asset.contentType);
    response.setHeader("content-length", String(asset.contentLength));
    return new StreamableFile(asset.body);
  }

  @Get(":sessionId/activities/:activityId")
  async getActivityProjection(
    @Param("sessionId") sessionId: string,
    @Param("activityId") activityId: string,
    @Req() request: SignedCookieRequest,
  ) {
    assertPresentationCompanionEnabled(this.config);
    const credential = await this.companion.verifyCredential(
      this.getCredential(request),
      getCompanionUserAgent(request),
      sessionId,
    );
    if (!credential) {
      throw companionUnavailable();
    }
    return this.activity.getProjection(credential, activityId);
  }

  private getCredential(request: SignedCookieRequest): string {
    const value =
      request.signedCookies?.[companionAccessCookieName];
    if (typeof value !== "string" || value.length === 0) {
      throw companionUnavailable();
    }
    return value;
  }
}

function companionUnavailable() {
  return new NotFoundException("Presentation companion unavailable");
}
