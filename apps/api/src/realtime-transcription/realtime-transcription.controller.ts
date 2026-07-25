import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { Request } from "express";
import { authSessionCookieName } from "../auth/auth.constants";
import { AuthService } from "../auth/auth.service";
import { ProjectsService } from "../projects/projects.service";
import { RealtimeTranscriptionService } from "./realtime-transcription.service";

type SignedCookieRequest = Request & {
  signedCookies?: Record<string, string | false | undefined>;
};

@Controller("api/v1/projects/:projectId/realtime-transcription")
export class RealtimeTranscriptionController {
  constructor(
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService,
    private readonly realtimeTranscriptionService: RealtimeTranscriptionService
  ) {}

  @Post("client-secret")
  @HttpCode(HttpStatus.OK)
  async createClientSecret(
    @Param("projectId") projectId: string,
    @Req() request: SignedCookieRequest
  ) {
    const user = await this.getCurrentUser(request);
    await this.projectsService.assertCanReadProject(projectId, user.userId);

    return this.realtimeTranscriptionService.createClientSecret({
      projectId,
      userId: user.userId
    });
  }

  private async getCurrentUser(request: SignedCookieRequest) {
    const sessionId = getSignedSessionId(request);
    if (!sessionId) {
      throw new UnauthorizedException("Authentication required");
    }

    return (await this.authService.me(sessionId)).user;
  }
}

function getSignedSessionId(request: SignedCookieRequest): string | null {
  const value = request.signedCookies?.[authSessionCookieName];
  return typeof value === "string" && value.length > 0 ? value : null;
}
