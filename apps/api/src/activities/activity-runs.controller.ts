import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import {
  ensureActivityRunRequestSchema,
  deletePresentationSessionResultsRequestSchema,
  moderateActivityTextRequestSchema,
  supersedeActivityRunRequestSchema,
  updateActivityRunStatusRequestSchema,
} from "@orbit/shared/activities";
import type { Request } from "express";

import { authSessionCookieName } from "../auth/auth.constants";
import { AuthService } from "../auth/auth.service";
import { parseRequest } from "../common/zod-request";
import { ProjectsService } from "../projects/projects.service";
import { ActivityRunsService } from "./activity-runs.service";
import { ActivityResultsService } from "./activity-results.service";
import { ActivityTextModerationService } from "./activity-text-moderation.service";

type SignedCookieRequest = Request & {
  signedCookies?: Record<string, string | false | undefined>;
};

@Controller("api/v1/projects/:projectId/presentation-sessions/:sessionId")
export class ActivityRunsController {
  constructor(
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService,
    private readonly activityRunsService: ActivityRunsService,
    private readonly activityResultsService: ActivityResultsService,
    private readonly activityTextModerationService: ActivityTextModerationService
  ) {}

  @Put("activities/:activityId/current-run")
  async ensureCurrentRun(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("activityId") activityId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest
  ) {
    parseRequest(ensureActivityRunRequestSchema, body ?? {});
    await this.assertCanOperate(projectId, request);
    return this.activityRunsService.ensureCurrentRun(projectId, sessionId, activityId);
  }

  @Get("activities/:activityId/current-run")
  async getCurrentRun(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("activityId") activityId: string,
    @Req() request: SignedCookieRequest
  ) {
    await this.assertCanOperate(projectId, request);
    return this.activityRunsService.getCurrentRun(projectId, sessionId, activityId);
  }

  @Post("activity-runs/:runId/supersede")
  async supersede(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest
  ) {
    const input = parseRequest(supersedeActivityRunRequestSchema, body ?? {});
    await this.assertCanOperate(projectId, request);
    return this.activityRunsService.supersede(projectId, sessionId, runId, input);
  }

  @Patch("activity-runs/:runId/status")
  async updateStatus(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest
  ) {
    const input = parseRequest(updateActivityRunStatusRequestSchema, body ?? {});
    await this.assertCanOperate(projectId, request);
    return this.activityRunsService.updateStatus(projectId, sessionId, runId, input);
  }

  @Get("activity-runs/:runId/results")
  async getResults(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("runId") runId: string,
    @Req() request: SignedCookieRequest
  ) {
    await this.assertCanOperate(projectId, request);
    return this.activityResultsService.getPresenterResult(projectId, sessionId, runId);
  }

  @Get("results")
  async getSessionResults(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Req() request: SignedCookieRequest
  ) {
    await this.assertCanOperate(projectId, request);
    return this.activityResultsService.getSessionArchive(projectId, sessionId);
  }

  @Delete("results")
  async deleteSessionResults(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest
  ) {
    const input = parseRequest(
      deletePresentationSessionResultsRequestSchema,
      body ?? {}
    );
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertIsProjectOwner(projectId, user.userId);
    return this.activityResultsService.deleteSessionResults(
      projectId,
      sessionId,
      input
    );
  }

  @Get("activity-runs/:runId/public-results")
  async getPublicResults(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("runId") runId: string,
    @Req() request: SignedCookieRequest
  ) {
    await this.assertCanOperate(projectId, request);
    return this.activityResultsService.getPublicResult(projectId, sessionId, runId);
  }

  @Patch("text-entries/:entryId")
  async moderateTextEntry(
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("entryId") entryId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest
  ) {
    const input = parseRequest(moderateActivityTextRequestSchema, body ?? {});
    await this.assertCanOperate(projectId, request);
    return this.activityTextModerationService.moderate(
      projectId,
      sessionId,
      entryId,
      input
    );
  }

  private async assertCanOperate(projectId: string, request: SignedCookieRequest) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
  }

  private async getCurrentUser(request: SignedCookieRequest) {
    const value = request.signedCookies?.[authSessionCookieName];
    if (typeof value !== "string" || value.length === 0) {
      throw new UnauthorizedException("Authentication required");
    }
    const user = (await this.authService.me(value)).user;
    return user;
  }
}
