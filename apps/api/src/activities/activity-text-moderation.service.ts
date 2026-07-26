import {
  moderateActivityTextResponseSchema,
  type ModerateActivityTextRequest,
} from "@orbit/shared/activities";
import { ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { ActivityRealtimePublisher } from "./activity-realtime.publisher";
import { ActivityResultsService } from "./activity-results.service";
import { ActivityTextModerationRepository } from "./activity-text-moderation.repository";

@Injectable()
export class ActivityTextModerationService {
  constructor(
    private readonly repository: ActivityTextModerationRepository,
    private readonly resultsService: ActivityResultsService,
    @InjectPinoLogger(ActivityTextModerationService.name)
    private readonly logger: PinoLogger,
    @Optional() private readonly realtimePublisher?: ActivityRealtimePublisher
  ) {}

  async moderate(
    projectId: string,
    sessionId: string,
    entryId: string,
    input: ModerateActivityTextRequest
  ) {
    const changed = await this.repository.transaction(async (manager) => {
      const target = await this.repository.lockTarget(manager, projectId, sessionId, entryId);
      if (!target) throw new NotFoundException("Activity text entry not found");
      if (target.revision !== input.expectedRevision) {
        throw new ConflictException("Activity result revision changed");
      }
      const now = new Date();
      await this.repository.updateEntry(manager, entryId, input, now);
      const revision = await this.repository.bumpRunRevision(
        manager,
        target.activity_run_id,
        now
      );
      return { ...target, revision };
    });

    this.logger.info(
      {
        event: "activity_text.moderated",
        projectId,
        presentationSessionId: sessionId,
        activityRunId: changed.activity_run_id,
        activityId: changed.activity_id,
        textEntryId: entryId,
        moderationStatus: input.moderationStatus,
        answered: input.answered
      },
      "activity text entry moderated"
    );
    this.realtimePublisher?.publishResultsUpdated({
      sessionId,
      runId: changed.activity_run_id,
      revision: changed.revision
    });
    return moderateActivityTextResponseSchema.parse(
      await this.resultsService.getPresenterResult(
        projectId,
        sessionId,
        changed.activity_run_id
      )
    );
  }
}
