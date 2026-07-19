import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import { getCurrentUser, type SignedCookieRequest } from "../auth/current-user";
import { ProjectsService } from "../projects/projects.service";
import { SlideQuestionGuidesService } from "./slide-question-guides.service";

@Controller()
export class SlideQuestionGuidesController {
  constructor(
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService,
    private readonly guidesService: SlideQuestionGuidesService,
  ) {}

  @Post("api/v1/projects/:projectId/slide-question-guides/auto")
  async autoCreate(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.guidesService.autoCreate(projectId, user.userId, body);
  }

  @Post("api/v1/projects/:projectId/slide-question-guides")
  async create(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.guidesService.create(projectId, user.userId, body);
  }

  @Get("api/v1/projects/:projectId/slide-question-guides/:guideId")
  async get(
    @Param("projectId") projectId: string,
    @Param("guideId") guideId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.projectsService.assertCanReadProject(projectId, user.userId);
    return this.guidesService.get(projectId, guideId);
  }

  @Get("api/v1/projects/:projectId/slide-question-guides")
  async list(
    @Param("projectId") projectId: string,
    @Query() query: Record<string, string | undefined>,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.projectsService.assertCanReadProject(projectId, user.userId);
    return this.guidesService.list(projectId, query);
  }
}
