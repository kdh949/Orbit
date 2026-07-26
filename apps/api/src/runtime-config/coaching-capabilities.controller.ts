import { isAdaptiveCoachingProjectAllowed, loadOrbitConfig } from "@orbit/config";
import { coachingCapabilitiesResponseSchema } from "@orbit/shared/config";
import { Controller, Get, Param, Req } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { getCurrentUser, type SignedCookieRequest } from "../auth/current-user";
import { ProjectsService } from "../projects/projects.service";

@Controller("api/v1/projects/:projectId/coaching-capabilities")
export class CoachingCapabilitiesController {
  private readonly config = loadOrbitConfig(process.env, { service: "api" });
  constructor(private readonly auth: AuthService, private readonly projects: ProjectsService) {}
  @Get()
  async get(@Param("projectId") projectId: string, @Req() request: SignedCookieRequest) {
    const user = await getCurrentUser(this.auth, request);
    await this.projects.assertCanReadProject(projectId, user.userId);
    const allowed = isAdaptiveCoachingProjectAllowed(this.config, projectId);
    const core = allowed && this.config.ADAPTIVE_REHEARSAL_COACH_ENABLED;
    return coachingCapabilitiesResponseSchema.parse({
      adaptiveRehearsalCoachEnabled: core,
      focusedPracticeEnabled: core && this.config.FOCUSED_PRACTICE_ENABLED,
      challengeQnaEnabled: core && this.config.CHALLENGE_QNA_ENABLED,
    });
  }
}
