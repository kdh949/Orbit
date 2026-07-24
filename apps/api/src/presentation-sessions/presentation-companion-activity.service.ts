import {
  activityIdSchema,
  presentationCompanionActivityProjectionSchema,
  type PresentationCompanionActivityProjection,
} from "@orbit/shared";
import { Injectable, NotFoundException } from "@nestjs/common";

import { ActivityResultsService } from "../activities/activity-results.service";
import { ActivityRunsService } from "../activities/activity-runs.service";
import type { CompanionAccessTokenPayload } from "./companion-access-cookie";
import { PresentationSessionsService } from "./presentation-sessions.service";

@Injectable()
export class PresentationCompanionActivityService {
  constructor(
    private readonly runs: ActivityRunsService,
    private readonly results: ActivityResultsService,
    private readonly sessions: PresentationSessionsService,
  ) {}

  async getProjection(
    credential: CompanionAccessTokenPayload,
    activityIdInput: string,
  ): Promise<PresentationCompanionActivityProjection> {
    const parsedActivityId = activityIdSchema.safeParse(activityIdInput);
    if (!parsedActivityId.success) {
      throw companionActivityUnavailable();
    }
    const activityId = parsedActivityId.data;
    const session = await this.sessions.getSessionForPresenter(
      credential.projectId,
      credential.sessionId,
    );
    if (!session.audienceAccessEnabled) {
      return presentationCompanionActivityProjectionSchema.parse({
        activityId,
        audienceUrl: null,
        run: null,
        publicResult: null,
      });
    }
    const { run } = await this.runs.getCurrentRun(
      credential.projectId,
      credential.sessionId,
      activityId,
    );
    if (!run) {
      return presentationCompanionActivityProjectionSchema.parse({
        activityId,
        audienceUrl: null,
        run: null,
        publicResult: null,
      });
    }
    const { result } = await this.results.getPublicResult(
      credential.projectId,
      credential.sessionId,
      run.activityRunId,
    );
    return presentationCompanionActivityProjectionSchema.parse({
      activityId,
      audienceUrl: `/audience/${encodeURIComponent(
        credential.sessionId,
      )}/a/${encodeURIComponent(activityId)}`,
      run: { status: run.status },
      publicResult: result,
    });
  }
}

function companionActivityUnavailable() {
  return new NotFoundException("Presentation companion activity unavailable");
}
