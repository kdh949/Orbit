import { enqueueOoxmlReferenceTemplateGenerationJob } from "@orbit/job-queue";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { JobsModule } from "../jobs/jobs.module";
import { ProjectsModule } from "../projects/projects.module";
import { OoxmlReferenceTemplateGenerationsController } from "./ooxml-reference-template-generations.controller";
import {
  OOXML_REFERENCE_TEMPLATE_GENERATION_ENQUEUE_JOB,
  OoxmlReferenceTemplateGenerationsService,
} from "./ooxml-reference-template-generations.service";

@Module({
  imports: [AuthModule, JobsModule, ProjectsModule],
  controllers: [OoxmlReferenceTemplateGenerationsController],
  providers: [
    OoxmlReferenceTemplateGenerationsService,
    {
      provide: OOXML_REFERENCE_TEMPLATE_GENERATION_ENQUEUE_JOB,
      useValue: enqueueOoxmlReferenceTemplateGenerationJob,
    },
  ],
})
export class OoxmlReferenceTemplateGenerationsModule {}
