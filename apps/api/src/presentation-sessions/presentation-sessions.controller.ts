import { Body, Controller, Get, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import {
  createPresentationSessionRequestSchema,
  deckIdSchema,
  presentationSessionPurposeSchema,
  updatePresentationSessionAccessRequestSchema
} from "@orbit/shared";
import type { Request } from "express";

import { authSessionCookieName } from "../auth/auth.constants";
import { AuthService } from "../auth/auth.service";
import { parseRequest } from "../common/zod-request";
import { ProjectsService } from "../projects/projects.service";
import { PresentationSessionsService } from "./presentation-sessions.service";

type SignedCookieRequest = Request & {
  signedCookies?: Record<string, string | false | undefined>;
};

@Controller("api/v1/projects/:projectId/presentation-sessions")
export class PresentationSessionsController {
  constructor(
    private readonly authService: AuthService,
    private readonly presentationSessionsService: PresentationSessionsService,
    private readonly projectsService: ProjectsService
  ) {}

  @Get("current")
  async getCurrent(
    @Param("projectId") projectId: string,
    @Query("deckId") rawDeckId: string,
    @Query("sessionPurpose") rawSessionPurpose: string | undefined,
    @Req() request: SignedCookieRequest
  ) {
    const deckId = deckIdSchema.parse(rawDeckId);
    const sessionPurpose = presentationSessionPurposeSchema
      .default("presentation")
      .parse(rawSessionPurpose);
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.presentationSessionsService.getCurrent(
      projectId,
      deckId,
      sessionPurpose,
    );
  }

  @Get()
  async list(
    @Param("projectId") projectId: string,
    @Query("deckId") rawDeckId: string,
    @Req() request: SignedCookieRequest
  ) {
    const deckId = deckIdSchema.parse(rawDeckId);
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.presentationSessionsService.list(projectId, deckId);
  }

  @Post()
  async create(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest
  ) {
    const input = parseRequest(createPresentationSessionRequestSchema, body ?? {});
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.presentationSessionsService.create(projectId, user.userId, input);
  }

  @Patch(":sessionId/access")
  async updateAccess(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest
  ) {
    const input = parseRequest(updatePresentationSessionAccessRequestSchema, body ?? {});
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.presentationSessionsService.updateAccess(projectId, sessionId, input);
  }

  @Post(":sessionId/close")
  async close(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Req() request: SignedCookieRequest
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.presentationSessionsService.close(projectId, sessionId);
  }

  private async getCurrentUser(request: SignedCookieRequest) {
    const value = request.signedCookies?.[authSessionCookieName];
    if (typeof value !== "string" || value.length === 0) {
      throw new UnauthorizedException("Authentication required");
    }
    return (await this.authService.me(value)).user;
  }
}
