import {
  enqueueDeckExportJob,
  enqueuePptxOoxmlSyncJob,
  enqueueSemanticCueExtractionJob,
  enqueueSpeakerNotesSuggestionJob,
} from "@orbit/job-queue";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { DataSource } from "typeorm";
import { JobsService } from "../jobs/jobs.service";
import {
  DECK_EXPORT_ENQUEUE_JOB,
  PPTX_OOXML_SYNC_ENQUEUE_JOB,
  SEMANTIC_CUE_EXTRACTION_ENQUEUE_JOB,
  SPEAKER_NOTES_SUGGESTION_ENQUEUE_JOB,
  type PptxOoxmlSyncEnqueueJob,
  type SemanticCueExtractionEnqueueJob,
  type SpeakerNotesSuggestionEnqueueJob,
} from "./use-cases/deck-use-cases.base";
import { DeckAutomationUseCases } from "./use-cases/deck-automation.use-cases";

export {
  DECK_EXPORT_ENQUEUE_JOB,
  PPTX_OOXML_SYNC_ENQUEUE_JOB,
  SEMANTIC_CUE_EXTRACTION_ENQUEUE_JOB,
  SPEAKER_NOTES_SUGGESTION_ENQUEUE_JOB,
  type InitialDeckWriteResult,
  type PptxOoxmlSyncEnqueueJob,
  type SemanticCueExtractionEnqueueJob,
  type SpeakerNotesSuggestionEnqueueJob,
} from "./use-cases/deck-use-cases.base";

type DeckExportEnqueueJob = typeof enqueueDeckExportJob;

@Injectable()
export class DecksService extends DeckAutomationUseCases {
  constructor(
    @InjectDataSource() dataSource: DataSource,
    @Optional() jobsService?: JobsService,
    @Optional()
    @Inject(PPTX_OOXML_SYNC_ENQUEUE_JOB)
    enqueueSyncJob: PptxOoxmlSyncEnqueueJob = enqueuePptxOoxmlSyncJob,
    @Optional()
    @Inject(DECK_EXPORT_ENQUEUE_JOB)
    enqueueDeckExport: DeckExportEnqueueJob = enqueueDeckExportJob,
    @Optional()
    @Inject(SEMANTIC_CUE_EXTRACTION_ENQUEUE_JOB)
    enqueueSemanticCueJob: SemanticCueExtractionEnqueueJob = enqueueSemanticCueExtractionJob,
    @Optional()
    @InjectPinoLogger(DecksService.name)
    logger?: PinoLogger,
    @Optional()
    @Inject(SPEAKER_NOTES_SUGGESTION_ENQUEUE_JOB)
    enqueueSpeakerNotesSuggestion: SpeakerNotesSuggestionEnqueueJob = enqueueSpeakerNotesSuggestionJob,
  ) {
    super(
      dataSource,
      jobsService,
      enqueueSyncJob,
      enqueueDeckExport,
      enqueueSemanticCueJob,
      logger,
      enqueueSpeakerNotesSuggestion,
    );
  }
}
