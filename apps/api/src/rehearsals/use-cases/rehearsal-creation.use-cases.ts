import {
  createRehearsalEvaluationSnapshot,
  createRehearsalRunRequestSchema,
  createRehearsalRunResponseSchema,
  type RehearsalEvaluationSnapshot,
} from "@orbit/shared/rehearsals";
import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { parseRequest } from "../../common/zod-request";
import {
  assertFrozenRehearsalEvaluationSources,
  buildRehearsalEvaluationPlan,
  createRehearsalFocusProfileSnapshot,
  deckContentHash,
} from "../../practice-goals/evaluation-plan";
import { toRehearsalRun } from "../mappers/rehearsal-run.mapper";
import { RehearsalUseCasesBase } from "./rehearsal-use-cases.base";

export class RehearsalCreationUseCases extends RehearsalUseCasesBase {
  async createRun(projectId: string, body: unknown) {
    const request = parseRequest(createRehearsalRunRequestSchema, body);
    const deckResponse = await this.decksService.getDeck(projectId);
    if (deckResponse.deck.deckId !== request.deckId) {
      throw new BadRequestException("deckId does not match the project deck.");
    }

    if (
      request.semanticEvaluationMode === "full" &&
      request.expectedDeckVersion !== undefined &&
      request.expectedDeckVersion !== deckResponse.deck.version
    ) {
      throw new ConflictException({
        code: "REHEARSAL_DECK_VERSION_MISMATCH",
        message:
          "The expected deck version does not match the server deck version.",
        expectedDeckVersion: request.expectedDeckVersion,
        actualDeckVersion: deckResponse.deck.version,
      });
    }

    const now = new Date();
    const adaptiveBrief = request.briefRef
      ? await this.resolveAdaptiveBrief(
          projectId,
          request.briefRef,
          request.evaluatorLensRef,
        )
      : undefined;
    const focusProfile = request.briefRef
      ? await this.resolveFocusProfile(projectId)
      : null;
    const sourceGoalSetRef = request.briefRef
      ? await this.resolveSourceGoalSetRef(
          projectId,
          request.sourceGoalSetId ?? null,
        )
      : null;
    const evaluationPlan = request.briefRef
      ? buildRehearsalEvaluationPlan({
          deck: deckResponse.deck,
          brief: adaptiveBrief ?? null,
          sourceGoalSetRef,
        })
      : null;
    const slideThumbnailUrls = await this.resolveSlideSnapshotUrls(
      projectId,
      deckResponse.deck.slides.map((slide) => slide.slideId),
      request.slideSnapshots,
    );
    let evaluationSnapshot: RehearsalEvaluationSnapshot | null = null;
    if (request.semanticEvaluationMode === "full") {
      try {
        evaluationSnapshot = createRehearsalEvaluationSnapshot(
          deckResponse.deck,
          now.toISOString(),
          {
            deckContentHash: evaluationPlan
              ? deckContentHash(deckResponse.deck)
              : null,
            evaluationPlan,
            focusProfileSnapshot:
              createRehearsalFocusProfileSnapshot(focusProfile),
            slideThumbnailUrls,
          },
        );
        if (evaluationPlan) {
          assertFrozenRehearsalEvaluationSources({
            snapshot: evaluationSnapshot,
            brief: adaptiveBrief ?? null,
            focusProfile,
          });
        }
      } catch (error) {
        if (!(error instanceof ZodError)) {
          throw error;
        }

        this.logger.error(
          {
            event: "rehearsal.evaluation_snapshot.validation_failed",
            projectId,
            deckId: request.deckId,
            issues: error.issues.map((issue) => ({
              code: issue.code,
              path: issue.path,
            })),
          },
          "Rehearsal evaluation snapshot validation failed.",
        );
        throw new UnprocessableEntityException({
          code: "REHEARSAL_DECK_INVALID",
          message: "The presentation could not be prepared for rehearsal.",
        });
      }
    }
    const run = await this.rehearsalRuns.save(
      this.rehearsalRuns.create({
        runId: `run_${randomUUID()}`,
        projectId,
        deckId: request.deckId,
        audioFileId: null,
        transcriptJsonFileId: null,
        transcriptTextFileId: null,
        jobId: null,
        deckVersion: evaluationSnapshot?.deckVersion ?? null,
        evaluationSnapshot,
        semanticEvaluationMode: request.semanticEvaluationMode,
        analysisRevision: 0,
        analysisFinalizedAt: null,
        status: "created",
        error: null,
        rehearsalReport: null,
        metaJson: {},
        transcriptRetained: false,
        rawAudioDeletedAt: null,
        rawAudioDeleteDeadlineAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );

    if (evaluationSnapshot) {
      this.logger.info(
        {
          event: "rehearsal.evaluation_snapshot.created",
          projectId,
          deckId: run.deckId,
          deckVersion: evaluationSnapshot.deckVersion,
          runId: run.runId,
          slideCount: evaluationSnapshot.slides.length,
          cueCount: evaluationSnapshot.slides.reduce(
            (count, slide) => count + slide.semanticCues.length,
            0,
          ),
        },
        "Rehearsal evaluation snapshot created.",
      );
    }

    return createRehearsalRunResponseSchema.parse({ run: toRehearsalRun(run) });
  }
}
