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
import { PresentationPasscodeCipher } from "./presentation-passcode-cipher";

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
    PresentationSessionsController,
    PresentationRunsController,
    ProjectPresentationRunsController,
  ],
  providers: [
    AudienceRateLimitService,
    PresentationSessionRepository,
    PresentationSessionsService,
    {
      provide: PresentationPasscodeCipher,
      useFactory: () => PresentationPasscodeCipher.fromEnvironment()
    },
    PresentationRunsService,
    PresentationCompanionSpikeGateway,
    {
      provide: PRESENTATION_ANALYSIS_ENQUEUE_JOB,
      useValue: enqueuePresentationAnalysisJob,
    },
  ],
  exports: [
    AudienceRateLimitService,
    PresentationSessionsService,
    PresentationRunsService,
  ],
})
export class PresentationSessionsModule {}
