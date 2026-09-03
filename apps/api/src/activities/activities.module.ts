import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DecksModule } from "../decks/decks.module";
import { ProjectsModule } from "../projects/projects.module";
import { PresentationSessionPersistenceModule } from "../presentation-sessions/presentation-session-persistence.module";
import { ActivityRunRepository } from "./activity-run.repository";
import { ActivityRunsController } from "./activity-runs.controller";
import { ActivityRunsService } from "./activity-runs.service";
import { ActivityResponseRepository } from "./activity-response.repository";
import { ActivityResponsesService } from "./activity-responses.service";
import { AudienceActivityController } from "./audience-activity.controller";
import { AudienceActiveActivityController } from "./audience-active-activity.controller";
import { ActivityResultsRepository } from "./activity-results.repository";
import { ActivityResultsService } from "./activity-results.service";
import { ActivityRealtimeGateway } from "./activity-realtime.gateway";
import { ActivityRealtimeMetricsService } from "./activity-realtime-metrics.service";
import { ActivityRealtimePublisher } from "./activity-realtime.publisher";
import { ActivityTextModerationRepository } from "./activity-text-moderation.repository";
import { ActivityTextModerationService } from "./activity-text-moderation.service";

@Module({
  imports: [
    AuthModule,
    DecksModule,
    ProjectsModule,
    PresentationSessionPersistenceModule
  ],
  controllers: [
    ActivityRunsController,
    AudienceActivityController,
    AudienceActiveActivityController
  ],
  providers: [
    ActivityRunRepository,
    ActivityRunsService,
    ActivityResponseRepository,
    ActivityResponsesService,
    ActivityResultsRepository,
    ActivityResultsService,
    ActivityTextModerationRepository,
    ActivityTextModerationService,
    ActivityRealtimeMetricsService,
    ActivityRealtimePublisher,
    ActivityRealtimeGateway
  ],
  exports: [ActivityRunsService, ActivityResponsesService, ActivityResultsService]
})
export class ActivitiesModule {}
