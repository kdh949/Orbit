import { Body, Controller, Param, Post, Req } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import {
  getCurrentUser,
  type SignedCookieRequest,
} from "../auth/current-user";
import { ProjectsService } from "../projects/projects.service";
import { OoxmlReferenceTemplateGenerationsService } from "./ooxml-reference-template-generations.service";

@Controller("api/v1/projects/:projectId/ooxml-reference-template-generations")
export class OoxmlReferenceTemplateGenerationsController {
  constructor(
    private readonly authService: AuthService,
    private readonly generationsService: OoxmlReferenceTemplateGenerationsService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post()
  async createGeneration(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.generationsService.createGeneration(projectId, body);
  }
}
