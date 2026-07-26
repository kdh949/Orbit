import {
  createDesignAgentMessageRequestSchema,
  createDesignImageGenerationRequestSchema,
  type CreateDesignImageGenerationRequest,
  type CreateDesignAgentMessageRequest,
} from "@orbit/shared/deck";
import { Body, Controller, Param, Post, Req } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { getCurrentUser, type SignedCookieRequest } from "../auth/current-user";
import { parseRequest } from "../common/zod-request";
import { ProjectsService } from "../projects/projects.service";
import { DesignAgentService } from "./design-agent.service";
import { DesignImageGenerationService } from "./design-image-generation.service";

@Controller("api/v1/projects/:projectId/design-agent")
export class DesignAgentController {
  constructor(
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService,
    private readonly designAgentService: DesignAgentService,
    private readonly designImageGenerationService: DesignImageGenerationService,
  ) {}

  @Post("messages")
  async createMessage(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    const input = parseRequest<CreateDesignAgentMessageRequest>(
      createDesignAgentMessageRequestSchema,
      body,
    );
    return this.designAgentService.createMessage(projectId, user.userId, input);
  }

  @Post("image-generations")
  async createImageGeneration(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    const input = parseRequest<CreateDesignImageGenerationRequest>(
      createDesignImageGenerationRequestSchema,
      body,
    );
    return this.designImageGenerationService.create(
      projectId,
      user.userId,
      input,
    );
  }

  @Post("proposals/:proposalId/apply")
  async applyProposal(
    @Param("projectId") projectId: string,
    @Param("proposalId") proposalId: string,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    await this.projectsService.assertCanWriteProject(projectId, user.userId);
    return this.designAgentService.applyProposal(
      projectId,
      proposalId,
      user.userId,
    );
  }
}
