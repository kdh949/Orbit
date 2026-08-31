import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LoggerModule } from "nestjs-pino";
import { AuthModule } from "./auth/auth.module";
import { DecksModule } from "./decks/decks.module";
import { DesignAgentModule } from "./design-agent/design-agent.module";
import { FilesModule } from "./files/files.module";
import { HealthModule } from "./health/health.module";
import { JobsModule } from "./jobs/jobs.module";
import { createApiLoggerParams } from "./logging";
import { databaseOptions } from "./database/data-source";
import { ExtractModule } from "./extract/extract.module";
import { GenerateDeckModule } from "./generate-deck/generate-deck.module";
import { PptxOoxmlGenerationsModule } from "./pptx-ooxml-generations/pptx-ooxml-generations.module";
import { ProjectsModule } from "./projects/projects.module";
import { PresentationSessionsModule } from "./presentation-sessions/presentation-sessions.module";
import { ActivitiesModule } from "./activities/activities.module";
import { PptAdvisorModule } from "./ppt-advisor/ppt-advisor.module";
import { ReferencesModule } from "./references/references.module";
import { RealtimeGateway } from "./realtime/realtime.gateway";
import { RealtimeTranscriptionModule } from "./realtime-transcription/realtime-transcription.module";
import { RehearsalsModule } from "./rehearsals/rehearsals.module";
import { RuntimeConfigModule } from "./runtime-config/runtime-config.module";
import { SavedDesignPacksModule } from "./saved-design-packs/saved-design-packs.module";
import { EvaluatorLensesModule } from "./evaluator-lenses/evaluator-lenses.module";
import { PresentationBriefsModule } from "./presentation-briefs/presentation-briefs.module";
import { PracticeGoalsModule } from "./practice-goals/practice-goals.module";
import { FocusedPracticeModule } from "./focused-practice/focused-practice.module";
import { ChallengeQnaModule } from "./challenge-qna/challenge-qna.module";
import { SlidePracticeModule } from "./slide-practice/slide-practice.module";
import { SlideQuestionGuidesModule } from "./slide-question-guides/slide-question-guides.module";
import { CommunityTemplatesModule } from "./community-templates/community-templates.module";
import { ApiMetricsModule } from "./metrics/api-metrics.module";

@Module({
  imports: [
    LoggerModule.forRoot(createApiLoggerParams()),
    ApiMetricsModule,
    TypeOrmModule.forRoot(databaseOptions),
    AuthModule,
    HealthModule,
    ProjectsModule,
    DecksModule,
    DesignAgentModule,
    FilesModule,
    ExtractModule,
    GenerateDeckModule,
    PptxOoxmlGenerationsModule,
    JobsModule,
    PresentationSessionsModule,
    ActivitiesModule,
    PptAdvisorModule,
    ReferencesModule,
    RuntimeConfigModule,
    SavedDesignPacksModule,
    RealtimeTranscriptionModule,
    RehearsalsModule,
    EvaluatorLensesModule,
    PresentationBriefsModule,
    PracticeGoalsModule,
    FocusedPracticeModule,
    ChallengeQnaModule,
    SlidePracticeModule,
    SlideQuestionGuidesModule,
    CommunityTemplatesModule,
  ],
  providers: [RealtimeGateway],
})
export class AppModule {}
