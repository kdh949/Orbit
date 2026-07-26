import { loadOrbitConfig } from "@orbit/config";
import { Body, Controller, Get, Param, Put, Req } from "@nestjs/common";
import { upsertActivityResponseRequestSchema } from "@orbit/shared/activities";

import { parseRequest } from "../common/zod-request";
import {
  assertAudienceJsonSameOrigin,
  requireAudienceIdentity,
  type SignedCookieRequest
} from "../presentation-sessions/audience-request-security";
import { PresentationSessionsService } from "../presentation-sessions/presentation-sessions.service";
import { ActivityResponsesService } from "./activity-responses.service";
import { ActivityResultsService } from "./activity-results.service";

@Controller("api/v1/audience-sessions/:sessionId/activities")
export class AudienceActivityController {
  private readonly config = loadOrbitConfig(process.env, { service: "api" });

  constructor(
    private readonly activityResponsesService: ActivityResponsesService,
    private readonly activityResultsService: ActivityResultsService,
    private readonly presentationSessionsService: PresentationSessionsService
  ) {}

  @Get(":activityId")
  async getActivity(
    @Param("sessionId") sessionId: string,
    @Param("activityId") activityId: string,
    @Req() request: SignedCookieRequest
  ) {
    const identity = requireAudienceIdentity(this.config, request, sessionId);
    await this.presentationSessionsService.getAudienceAccess(
      sessionId,
      identity.projectId
    );
    return this.activityResultsService.getAudienceActivity(
      identity.projectId,
      sessionId,
      activityId,
      identity.audienceId
    );
  }

  @Put(":activityId/response")
  async upsertResponse(
    @Param("sessionId") sessionId: string,
    @Param("activityId") activityId: string,
    @Body() body: unknown,
    @Req() request: SignedCookieRequest
  ) {
    assertAudienceJsonSameOrigin(this.config, request);
    const identity = requireAudienceIdentity(this.config, request, sessionId);
    await this.presentationSessionsService.getAudienceAccess(
      sessionId,
      identity.projectId
    );
    const input = parseRequest(upsertActivityResponseRequestSchema, body ?? {});
    return this.activityResponsesService.upsert(
      identity.projectId,
      sessionId,
      activityId,
      identity.audienceId,
      input
    );
  }
}
