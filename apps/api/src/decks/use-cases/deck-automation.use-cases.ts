import { loadOrbitConfig } from "@orbit/config";
import {
  createSemanticCueExtractionJobResponseSchema,
  createSpeakerNotesSuggestionJobResponseSchema,
  semanticCueExtractionJobPayloadSchema,
  semanticCueExtractionRequestSchema,
  speakerNotesSuggestionJobPayloadSchema,
  speakerNotesSuggestionRequestSchema,
} from "@orbit/shared/deck";
import type {
  CreateSemanticCueExtractionJobResponse,
  CreateSpeakerNotesSuggestionJobResponse,
} from "@orbit/shared/deck";
import { HttpStatus } from "@nestjs/common";
import { serializeLogError } from "../../logging";
import {
  nowIso,
  parseDeckRow,
  throwDeckApiException,
  toIso,
} from "./deck-use-cases.base";
import { DeckExportUseCases } from "./deck-export.use-cases";

export class DeckAutomationUseCases extends DeckExportUseCases {
  async createSemanticCueExtractionJob(
    projectId: string,
    body: unknown,
  ): Promise<CreateSemanticCueExtractionJobResponse> {
    const request = semanticCueExtractionRequestSchema.parse(body ?? {});

    if (!this.jobsService) {
      throwDeckApiException(
        "DECK_VALIDATION_FAILED",
        HttpStatus.SERVICE_UNAVAILABLE,
        "Jobs service is not available",
      );
    }

    const preparedRequest = await this.dataSource.transaction(
      async (manager) => {
        const deckRow = await this.findProjectDeckRowForUpdate(
          manager,
          projectId,
        );

        if (!deckRow) {
          throwDeckApiException(
            "DECK_NOT_FOUND",
            HttpStatus.NOT_FOUND,
            `Deck not found for project: ${projectId}`,
          );
        }

        const requestedDeckId = request.deckId ?? deckRow.deck_id;
        if (requestedDeckId !== deckRow.deck_id) {
          throwDeckApiException(
            "DECK_MISMATCH",
            HttpStatus.BAD_REQUEST,
            "Requested deckId must match project deck",
            [
              `deck.deckId=${deckRow.deck_id}`,
              `request.deckId=${requestedDeckId}`,
            ],
          );
        }

        const materializedState = await this.readCurrentDeckState(
          manager,
          parseDeckRow(deckRow),
          projectId,
          deckRow.deck_id,
          toIso(deckRow.updated_at),
          true,
        );
        const deck = await this.writeDeckCheckpoint(
          manager,
          materializedState.deck,
          nowIso(),
        );

        return semanticCueExtractionJobPayloadSchema.shape.request.parse({
          deckId: deck.deckId,
          force: request.force,
          baseVersion: deck.version,
        });
      },
    );

    const queuedJob = await this.jobsService.create({
      projectId,
      type: "semantic-cue-extraction",
      payload: { request: preparedRequest },
    });

    try {
      const config = loadOrbitConfig(process.env, { service: "api" });
      await this.enqueueSemanticCueJob({
        driver: config.JOB_QUEUE_DRIVER,
        redisUrl: config.REDIS_URL,
        jobId: queuedJob.jobId,
        projectId,
        request: preparedRequest,
      });
      this.logger?.info(
        {
          event: "semantic_cue.extraction.queued",
          jobId: queuedJob.jobId,
          jobType: queuedJob.type,
          projectId,
          deckId: preparedRequest.deckId,
          deckVersion: preparedRequest.baseVersion,
          force: preparedRequest.force,
        },
        "Semantic cue extraction job enqueued.",
      );
    } catch (error) {
      await this.jobsService.update(queuedJob.jobId, {
        status: "failed",
        progress: 0,
        message: "Semantic cue extraction enqueue failed.",
        error: {
          code: "SEMANTIC_CUE_EXTRACTION_ENQUEUE_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Semantic cue extraction enqueue failed.",
        },
      });
      this.logger?.error(
        {
          event: "semantic_cue.extraction.failed",
          jobId: queuedJob.jobId,
          jobType: queuedJob.type,
          projectId,
          deckId: preparedRequest.deckId,
          deckVersion: preparedRequest.baseVersion,
          reason: "enqueue_failed",
          error: serializeLogError(error),
        },
        "Semantic cue extraction enqueue failed.",
      );
      throw error;
    }

    return createSemanticCueExtractionJobResponseSchema.parse({
      job: queuedJob,
    });
  }

  async createSpeakerNotesSuggestionJob(
    projectId: string,
    body: unknown,
  ): Promise<CreateSpeakerNotesSuggestionJobResponse> {
    const request = speakerNotesSuggestionRequestSchema.parse(body);

    if (!this.jobsService) {
      throwDeckApiException(
        "DECK_VALIDATION_FAILED",
        HttpStatus.SERVICE_UNAVAILABLE,
        "Jobs service is not available",
      );
    }

    const preparedRequest = await this.dataSource.transaction(
      async (manager) => {
        const deckRow = await this.findProjectDeckRowForUpdate(
          manager,
          projectId,
        );
        if (!deckRow) {
          throwDeckApiException(
            "DECK_NOT_FOUND",
            HttpStatus.NOT_FOUND,
            `Deck not found for project: ${projectId}`,
          );
        }
        if (request.deckId !== deckRow.deck_id) {
          throwDeckApiException(
            "DECK_MISMATCH",
            HttpStatus.BAD_REQUEST,
            "Requested deckId must match project deck",
          );
        }

        const materializedState = await this.readCurrentDeckState(
          manager,
          parseDeckRow(deckRow),
          projectId,
          deckRow.deck_id,
          toIso(deckRow.updated_at),
          true,
        );
        if (materializedState.deck.version !== request.baseVersion) {
          throwDeckApiException(
            "STALE_BASE_VERSION",
            HttpStatus.CONFLICT,
            "Deck changed before the speaker notes suggestion started",
          );
        }
        const slide = materializedState.deck.slides.find(
          (candidate) => candidate.slideId === request.slideId,
        );
        if (!slide) {
          throwDeckApiException(
            "DECK_VALIDATION_FAILED",
            HttpStatus.BAD_REQUEST,
            "Requested slide does not exist in the deck",
          );
        }
        const hasNotes = slide.speakerNotes.trim().length > 0;
        const requiresExistingNotes =
          request.mode !== "draft" && request.mode !== "icebreaker";
        if (
          (request.mode === "draft" && hasNotes) ||
          (requiresExistingNotes && !hasNotes)
        ) {
          throwDeckApiException(
            "DECK_VALIDATION_FAILED",
            HttpStatus.BAD_REQUEST,
            hasNotes
              ? "Draft mode is only available when speaker notes are empty"
              : "Refinement modes require existing speaker notes",
          );
        }

        const deck = await this.writeDeckCheckpoint(
          manager,
          materializedState.deck,
          nowIso(),
        );
        return speakerNotesSuggestionJobPayloadSchema.shape.request.parse({
          ...request,
          baseVersion: deck.version,
        });
      },
    );

    const queuedJob = await this.jobsService.create({
      projectId,
      type: "speaker-notes-suggestion",
      payload: { request: preparedRequest },
    });

    try {
      const config = loadOrbitConfig(process.env, { service: "api" });
      await this.enqueueSpeakerNotesSuggestion({
        driver: config.JOB_QUEUE_DRIVER,
        redisUrl: config.REDIS_URL,
        jobId: queuedJob.jobId,
        projectId,
        request: preparedRequest,
      });
      this.logger?.info(
        {
          event: "speaker_notes.suggestion.queued",
          jobId: queuedJob.jobId,
          jobType: queuedJob.type,
          projectId,
          deckId: preparedRequest.deckId,
          slideId: preparedRequest.slideId,
          deckVersion: preparedRequest.baseVersion,
          mode: preparedRequest.mode,
        },
        "Speaker notes suggestion job enqueued.",
      );
    } catch (error) {
      await this.jobsService.update(queuedJob.jobId, {
        status: "failed",
        progress: 0,
        message: "Speaker notes suggestion enqueue failed.",
        error: {
          code: "SPEAKER_NOTES_SUGGESTION_ENQUEUE_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Speaker notes suggestion enqueue failed.",
        },
      });
      this.logger?.error(
        {
          event: "speaker_notes.suggestion.failed",
          jobId: queuedJob.jobId,
          jobType: queuedJob.type,
          projectId,
          deckId: preparedRequest.deckId,
          slideId: preparedRequest.slideId,
          deckVersion: preparedRequest.baseVersion,
          mode: preparedRequest.mode,
          reason: "enqueue_failed",
          error: serializeLogError(error),
        },
        "Speaker notes suggestion enqueue failed.",
      );
      throw error;
    }

    return createSpeakerNotesSuggestionJobResponseSchema.parse({
      job: queuedJob,
    });
  }
}
