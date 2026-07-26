import { Body, Controller, Post, Req } from "@nestjs/common";
import type { PptAdvisorRequest } from "@orbit/shared/deck";
import { pptAdvisorRequestSchema } from "@orbit/shared/deck";
import { AuthService } from "../auth/auth.service";
import { getCurrentUser, type SignedCookieRequest } from "../auth/current-user";
import { parseRequest } from "../common/zod-request";
import { PptAdvisorService } from "./ppt-advisor.service";

@Controller("api/v1/ai/ppt-advisor")
export class PptAdvisorController {
  constructor(
    private readonly authService: AuthService,
    private readonly pptAdvisorService: PptAdvisorService,
  ) {}

  @Post()
  async advise(
    @Body() body: unknown,
    @Req() request: SignedCookieRequest,
  ) {
    const user = await getCurrentUser(this.authService, request);
    const input = parseRequest<PptAdvisorRequest>(pptAdvisorRequestSchema, body);
    return this.pptAdvisorService.advise(input, user.userId);
  }
}
