import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { Repository } from "typeorm";
import { DecksService } from "../decks/decks.service";
import { FilesService } from "../files/files.service";
import { JobsService } from "../jobs/jobs.service";
import { ProjectEntity } from "../projects/project.entity";
import { ProjectsService } from "../projects/projects.service";
import { PresentationBriefsService } from "../presentation-briefs/presentation-briefs.service";
import { RehearsalRunEntity } from "./rehearsal-run.entity";
import { RedisRehearsalTranscriptCache } from "./rehearsal-transcript-cache";
import {
  REHEARSAL_SEMANTIC_EVALUATION_ENQUEUE_JOB,
  REHEARSAL_STT_ENQUEUE_JOB,
  RehearsalUseCasesBase,
  type RehearsalSemanticEvaluationEnqueueJob,
  type RehearsalSttEnqueueJob,
} from "./use-cases/rehearsal-use-cases.base";

export {
  REHEARSAL_SEMANTIC_EVALUATION_ENQUEUE_JOB,
  REHEARSAL_STT_ENQUEUE_JOB,
  type RehearsalSemanticEvaluationEnqueueJob,
  type RehearsalSttEnqueueJob,
} from "./use-cases/rehearsal-use-cases.base";

@Injectable()
export class RehearsalsService extends RehearsalUseCasesBase {
  constructor(
    @InjectRepository(RehearsalRunEntity)
    rehearsalRuns: Repository<RehearsalRunEntity>,
    @InjectRepository(ProjectEntity)
    projects: Repository<ProjectEntity>,
    decksService: DecksService,
    projectsService: ProjectsService,
    presentationBriefs: PresentationBriefsService,
    filesService: FilesService,
    jobsService: JobsService,
    @Inject(REHEARSAL_STT_ENQUEUE_JOB)
    enqueueJob: RehearsalSttEnqueueJob,
    @Inject(REHEARSAL_SEMANTIC_EVALUATION_ENQUEUE_JOB)
    enqueueSemanticEvaluationJob: RehearsalSemanticEvaluationEnqueueJob,
    transcriptCache: RedisRehearsalTranscriptCache,
    @InjectPinoLogger(RehearsalsService.name)
    logger: PinoLogger,
  ) {
    super(
      rehearsalRuns,
      projects,
      decksService,
      projectsService,
      presentationBriefs,
      filesService,
      jobsService,
      enqueueJob,
      enqueueSemanticEvaluationJob,
      transcriptCache,
      logger,
    );
  }
}
