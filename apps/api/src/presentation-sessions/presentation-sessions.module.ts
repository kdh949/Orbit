import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DecksModule } from "../decks/decks.module";
import { ProjectsModule } from "../projects/projects.module";
import { AudienceSessionsController } from "./audience-sessions.controller";
import { PresentationSessionsController } from "./presentation-sessions.controller";
import { PresentationSessionsService } from "./presentation-sessions.service";
import { PresentationSessionRepository } from "./presentation-session.repository";
import { AudienceRateLimitService } from "./audience-rate-limit.service";

@Module({
  imports: [AuthModule, DecksModule, ProjectsModule],
  controllers: [AudienceSessionsController, PresentationSessionsController],
  providers: [
    AudienceRateLimitService,
    PresentationSessionRepository,
    PresentationSessionsService
  ],
  exports: [AudienceRateLimitService, PresentationSessionsService]
})
export class PresentationSessionsModule {}
