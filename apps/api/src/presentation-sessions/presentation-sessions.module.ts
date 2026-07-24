import { enqueuePresentationAnalysisJob } from "@orbit/job-queue";
import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { DecksModule } from "../decks/decks.module";
import { FilesModule } from "../files/files.module";
import { JobsModule } from "../jobs/jobs.module";
import { ProjectsModule } from "../projects/projects.module";
import { ActivitiesModule } from "../activities/activities.module";
import { AudienceSessionsController } from "./audience-sessions.controller";
import { PresentationSessionsController } from "./presentation-sessions.controller";
import { PresentationSessionsService } from "./presentation-sessions.service";
import { PresentationSessionRepository } from "./presentation-session.repository";
import { AudienceRateLimitService } from "./audience-rate-limit.service";
import { PresentationRunEntity } from "./presentation-run.entity";
import {
  PresentationRunsController,
  ProjectPresentationRunsController,
} from "./presentation-runs.controller";
import {
  PRESENTATION_ANALYSIS_ENQUEUE_JOB,
  PresentationRunsService,
} from "./presentation-runs.service";
import { PresentationCompanionSpikeGateway } from "./presentation-companion-spike.gateway";
import { PresentationCompanionProjectionService } from "./presentation-companion-projection.service";
import { PresentationCompanionActivityService } from "./presentation-companion-activity.service";
import { PresentationCompanionService } from "./presentation-companion.service";
import {
  ProjectPresentationCompanionController,
  PublicPresentationCompanionController,
} from "./presentation-companion.controller";
import { PresentationCompanionRateLimitService } from "./presentation-companion-request-security";
import { PresentationCompanionGateway } from "./presentation-companion.gateway";
import { PresentationCompanionPublisher } from "./presentation-companion.publisher";
import { PresentationCompanionCommandRateLimitService } from "./presentation-companion-rate-limit.service";
import {
  createRedisPresentationCompanionStore,
  PresentationCompanionStore,
} from "./presentation-companion.store";

@Module({
  imports: [
    TypeOrmModule.forFeature([PresentationRunEntity]),
    AuthModule,
    DecksModule,
    FilesModule,
    JobsModule,
    ProjectsModule,
    forwardRef(() => ActivitiesModule),
  ],
  controllers: [
    AudienceSessionsController,
    ProjectPresentationCompanionController,
    PublicPresentationCompanionController,
    PresentationSessionsController,
    PresentationRunsController,
    ProjectPresentationRunsController,
  ],
  providers: [
    AudienceRateLimitService,
    PresentationSessionRepository,
    PresentationSessionsService,
    PresentationRunsService,
    PresentationCompanionSpikeGateway,
    PresentationCompanionProjectionService,
    PresentationCompanionActivityService,
    PresentationCompanionPublisher,
    PresentationCompanionCommandRateLimitService,
    PresentationCompanionRateLimitService,
    PresentationCompanionService,
    PresentationCompanionGateway,
    {
      provide: PresentationCompanionStore,
      useFactory: createRedisPresentationCompanionStore,
    },
    {
      provide: PRESENTATION_ANALYSIS_ENQUEUE_JOB,
      useValue: enqueuePresentationAnalysisJob,
    },
  ],
  exports: [
    AudienceRateLimitService,
    PresentationSessionsService,
    PresentationRunsService,
    PresentationCompanionProjectionService,
    PresentationCompanionPublisher,
    PresentationCompanionRateLimitService,
    PresentationCompanionService,
    PresentationCompanionStore,
  ],
})
export class PresentationSessionsModule {}
