import { Controller, Get, Param, Req } from "@nestjs/common";

import { AuthService } from "../auth/auth.service";
import {
  getCurrentUser,
  type SignedCookieRequest,
} from "../auth/current-user";
import { ProjectsService } from "../projects/projects.service";
import { OoxmlReferenceTemplatePreviewService } from "./ooxml-reference-template-preview.service";

@Controller("api/v1/projects/:projectId/ooxml-reference-template-generations")
export class OoxmlReferenceTemplatePreviewController {
  constructor(
    private readonly authService: AuthService,
    private readonly previewService: OoxmlReferenceTemplatePreviewService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Get(":generationId/preview")
  async getPreview(
    @Param("projectId") projectId: string,
    @Param("generationId") generationId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.projectsService.assertCanReadProject(projectId, user.userId);
    return this.previewService.getPreview(projectId, generationId);
  }
}
