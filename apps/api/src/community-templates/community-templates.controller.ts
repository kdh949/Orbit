import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import {
  communityTemplateCommentIdSchema,
  communityTemplateCommentListQuerySchema,
  communityTemplateCommentMutationSchema,
  communityTemplateTagListQuerySchema,
  communityTemplateDiscoverQuerySchema,
  communityTemplateIdSchema,
  communityTemplateListQuerySchema,
  communityTemplateModerationQuerySchema,
  communityTemplateReportIdSchema,
  createCommunityTemplateReportRequestSchema,
  publishCommunityTemplateRequestSchema,
  updateCommunityTemplateReportRequestSchema,
  updateCommunityTemplateRequestSchema,
  useCommunityTemplateRequestSchema,
} from "@orbit/shared/community-templates";
import { z } from "zod";

import { AuthService } from "../auth/auth.service";
import { getCurrentUser, SignedCookieRequest } from "../auth/current-user";
import { parseRequest } from "../common/zod-request";
import { CommunityTemplateRateLimitService } from "./community-template-rate-limit.service";
import { CommunityTemplatesService } from "./community-templates.service";

const workspaceIdSchema = z.string().trim().min(1).max(200);

@Controller("api/v1/community-templates")
export class CommunityTemplatesController {
  constructor(
    private readonly authService: AuthService,
    private readonly service: CommunityTemplatesService,
    private readonly rateLimit: CommunityTemplateRateLimitService,
  ) {}

  @Get()
  async list(@Query() query: unknown, @Req() request: SignedCookieRequest) {
    await getCurrentUser(this.authService, request);
    return this.service.list(
      parseRequest(communityTemplateListQuerySchema, query ?? {}),
    );
  }

  @Get("recent")
  async recent(@Req() request: SignedCookieRequest) {
    const user = await getCurrentUser(this.authService, request);
    return this.service.listRecent(user.userId);
  }

  @Get("discover")
  async discover(@Query() query: unknown, @Req() request: SignedCookieRequest) {
    const user = await getCurrentUser(this.authService, request);
    return this.service.discover(
      parseRequest(communityTemplateDiscoverQuerySchema, query ?? {}),
      user.userId,
    );
  }

  @Get("categories")
  async categories(@Req() request: SignedCookieRequest) {
    await getCurrentUser(this.authService, request);
    return this.service.listCategories();
  }

  @Get("tags")
  async tags(@Query() query: unknown, @Req() request: SignedCookieRequest) {
    await getCurrentUser(this.authService, request);
    return this.service.listTags(
      parseRequest(communityTemplateTagListQuerySchema, query ?? {}),
    );
  }

  @Get("mine")
  async mine(@Query() query: unknown, @Req() request: SignedCookieRequest) {
    const user = await getCurrentUser(this.authService, request);
    return this.service.listMine(
      parseRequest(communityTemplateDiscoverQuerySchema, query ?? {}),
      user.userId,
    );
  }

  @Get("moderation/reports")
  async moderationReports(
    @Query() query: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    return this.service.listReports(
      parseRequest(communityTemplateModerationQuerySchema, query ?? {}),
      user.userId,
    );
  }

  @Patch("moderation/reports/:reportId")
  async moderateReport(
    @Param("reportId") rawReportId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    return this.service.updateReport(
      parseRequest(communityTemplateReportIdSchema, rawReportId),
      parseRequest(updateCommunityTemplateReportRequestSchema, body ?? {}),
      user.userId,
    );
  }

  @Get(":templateId")
  async detail(
    @Param("templateId") rawTemplateId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    const templateId = parseRequest(communityTemplateIdSchema, rawTemplateId);
    return this.service.getCommunityDetail(templateId, user.userId);
  }

  @Put(":templateId/like")
  async like(
    @Param("templateId") rawTemplateId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.rateLimit.consume("engagement", user.userId);
    return this.service.setLike(
      parseRequest(communityTemplateIdSchema, rawTemplateId),
      user.userId,
      true,
    );
  }

  @Delete(":templateId/like")
  async unlike(
    @Param("templateId") rawTemplateId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.rateLimit.consume("engagement", user.userId);
    return this.service.setLike(
      parseRequest(communityTemplateIdSchema, rawTemplateId),
      user.userId,
      false,
    );
  }

  @Post(":templateId/view")
  async view(
    @Param("templateId") rawTemplateId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.rateLimit.consume("view", user.userId);
    return this.service.recordView(
      parseRequest(communityTemplateIdSchema, rawTemplateId),
      user.userId,
    );
  }

  @Post(":templateId/share")
  async share(
    @Param("templateId") rawTemplateId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.rateLimit.consume("share", user.userId);
    return this.service.recordShare(
      parseRequest(communityTemplateIdSchema, rawTemplateId),
      user.userId,
    );
  }

  @Get(":templateId/comments")
  async comments(
    @Param("templateId") rawTemplateId: string,
    @Query() query: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    return this.service.listComments(
      parseRequest(communityTemplateIdSchema, rawTemplateId),
      parseRequest(communityTemplateCommentListQuerySchema, query ?? {}),
      user.userId,
    );
  }

  @Post(":templateId/comments")
  async createComment(
    @Param("templateId") rawTemplateId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.rateLimit.consume("comment", user.userId);
    return this.service.createComment(
      parseRequest(communityTemplateIdSchema, rawTemplateId),
      parseRequest(communityTemplateCommentMutationSchema, body ?? {}),
      user.userId,
    );
  }

  @Patch(":templateId/comments/:commentId")
  async updateComment(
    @Param("templateId") rawTemplateId: string,
    @Param("commentId") rawCommentId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.rateLimit.consume("comment", user.userId);
    return this.service.updateComment(
      parseRequest(communityTemplateIdSchema, rawTemplateId),
      parseRequest(communityTemplateCommentIdSchema, rawCommentId),
      parseRequest(communityTemplateCommentMutationSchema, body ?? {}),
      user.userId,
    );
  }

  @Delete(":templateId/comments/:commentId")
  async deleteComment(
    @Param("templateId") rawTemplateId: string,
    @Param("commentId") rawCommentId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.rateLimit.consume("comment", user.userId);
    return this.service.deleteComment(
      parseRequest(communityTemplateIdSchema, rawTemplateId),
      parseRequest(communityTemplateCommentIdSchema, rawCommentId),
      user.userId,
    );
  }

  @Patch(":templateId")
  async updateTemplate(
    @Param("templateId") rawTemplateId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.rateLimit.consume("manage", user.userId);
    return this.service.updateTemplate(
      parseRequest(communityTemplateIdSchema, rawTemplateId),
      parseRequest(updateCommunityTemplateRequestSchema, body ?? {}),
      user.userId,
    );
  }

  @Delete(":templateId")
  async unpublishTemplate(
    @Param("templateId") rawTemplateId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.rateLimit.consume("manage", user.userId);
    return this.service.unpublishTemplate(
      parseRequest(communityTemplateIdSchema, rawTemplateId),
      user.userId,
    );
  }

  @Post(":templateId/reports")
  async reportTemplate(
    @Param("templateId") rawTemplateId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.rateLimit.consume("report", user.userId);
    return this.service.createReport(
      parseRequest(communityTemplateIdSchema, rawTemplateId),
      parseRequest(createCommunityTemplateReportRequestSchema, body ?? {}),
      user.userId,
    );
  }
}

@Controller("api/v1/workspaces/:workspaceId/community-templates")
export class WorkspaceCommunityTemplatesController {
  constructor(
    private readonly authService: AuthService,
    private readonly service: CommunityTemplatesService,
    private readonly rateLimit: CommunityTemplateRateLimitService,
  ) {}

  @Get("sources")
  async sources(
    @Param("workspaceId") rawWorkspaceId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    const workspaceId = parseRequest(workspaceIdSchema, rawWorkspaceId);
    return this.service.listSources(workspaceId, user.userId);
  }

  @Post()
  async publish(
    @Param("workspaceId") rawWorkspaceId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.rateLimit.consume("publish", user.userId);
    const workspaceId = parseRequest(workspaceIdSchema, rawWorkspaceId);
    const input = parseRequest(
      publishCommunityTemplateRequestSchema,
      body ?? {},
    );
    return this.service.publish(workspaceId, input, user.userId);
  }

  @Post(":templateId/use")
  async use(
    @Param("workspaceId") rawWorkspaceId: string,
    @Param("templateId") rawTemplateId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    const workspaceId = parseRequest(workspaceIdSchema, rawWorkspaceId);
    const templateId = parseRequest(communityTemplateIdSchema, rawTemplateId);
    const input = parseRequest(useCommunityTemplateRequestSchema, body ?? {});
    return this.service.use(workspaceId, templateId, input, user.userId);
  }
}
