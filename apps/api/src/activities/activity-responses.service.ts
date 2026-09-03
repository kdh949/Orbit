import { randomUUID } from "node:crypto";
import {
  activityAnswerSchema,
  activityDefinitionSchema,
  activityResponseSchema,
  upsertActivityResponseResponseSchema,
} from "@orbit/shared/activities";
import type {
  ActivityAnswer,
  UpsertActivityResponseRequest,
} from "@orbit/shared/activities";
import { BadRequestException, ConflictException, Injectable, Optional } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import {
  ActivityResponseRepository,
  type ActivityResponseRow
} from "./activity-response.repository";
import {
  ActivityResponseValidationError,
  validateActivityResponseInput
} from "./activity-response-validator";
import { ActivityRealtimePublisher } from "./activity-realtime.publisher";
import { AudienceRateLimitService } from "../presentation-sessions/audience-rate-limit.service";

@Injectable()
export class ActivityResponsesService {
  constructor(
    private readonly repository: ActivityResponseRepository,
    @InjectPinoLogger(ActivityResponsesService.name)
    private readonly logger: PinoLogger,
    @Optional() private readonly realtimePublisher?: ActivityRealtimePublisher,
    @Optional() private readonly audienceRateLimit?: AudienceRateLimitService
  ) {}

  async upsert(
    projectId: string,
    sessionId: string,
    activityId: string,
    audienceId: string,
    input: UpsertActivityResponseRequest
  ) {
    const result = await this.repository.transaction(async (manager) => {
      const target = await this.repository.findTarget(manager, projectId, sessionId, activityId);
      if (!target) throw new ConflictException("Activity is not open for responses");
      await this.audienceRateLimit?.consumeResponseMutation(
        audienceId,
        target.activity_run_id
      );
      await this.repository.lockAudienceMutation(manager, target.activity_run_id, audienceId);
      const existing = await this.repository.findForAudience(
        manager,
        projectId,
        target.activity_run_id,
        audienceId
      );
      if (existing?.last_client_mutation_id === input.clientMutationId) {
        const commitTarget = await this.lockTargetForCommit(
          manager,
          projectId,
          sessionId,
          activityId,
          target.activity_run_id
        );
        return {
          changed: false,
          response: existing,
          runRevision: commitTarget.revision
        };
      }

      const definition = activityDefinitionSchema.parse(target.definition_snapshot);
      let validated: ReturnType<typeof validateActivityResponseInput>;
      try {
        validated = validateActivityResponseInput(definition, input);
      } catch (error) {
        if (error instanceof ActivityResponseValidationError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }
      const now = new Date();
      const response = existing
        ? await this.repository.update(
            manager,
            existing.response_id,
            validated.answers,
            validated.displayName,
            input.clientMutationId,
            now
          )
        : await this.repository.insert(manager, {
            responseId: `activity_response_${randomUUID()}`,
            projectId,
            runId: target.activity_run_id,
            audienceId,
            answers: validated.answers,
            displayName: validated.displayName,
            mutationId: input.clientMutationId,
            now
          });
      await this.syncTextEntries(
        manager,
        projectId,
        response.response_id,
        validated.answers,
        now
      );
      await this.lockTargetForCommit(
        manager,
        projectId,
        sessionId,
        activityId,
        target.activity_run_id
      );
      const runRevision = await this.repository.bumpRunRevision(
        manager,
        target.activity_run_id,
        existing === null,
        now
      );
      return { changed: true, response, runRevision };
    });

    if (result.changed) {
      this.logger.info(
        {
          event: "activity_response.upserted",
          projectId,
          presentationSessionId: sessionId,
          activityId,
          activityRunId: result.response.activity_run_id,
          responseId: result.response.response_id
        },
        "activity response upserted"
      );
      this.realtimePublisher?.publishResultsUpdated({
        sessionId,
        runId: result.response.activity_run_id,
        revision: result.runRevision
      });
    }
    return upsertActivityResponseResponseSchema.parse({
      response: this.toResponse(result.response),
      runRevision: result.runRevision
    });
  }

  private async lockTargetForCommit(
    manager: Parameters<ActivityResponseRepository["findForAudience"]>[0],
    projectId: string,
    sessionId: string,
    activityId: string,
    runId: string
  ) {
    const target = await this.repository.lockTargetForCommit(
      manager,
      projectId,
      sessionId,
      activityId,
      runId
    );
    if (!target) throw new ConflictException("Activity is not open for responses");
    return target;
  }

  private async syncTextEntries(
    manager: Parameters<ActivityResponseRepository["findForAudience"]>[0],
    projectId: string,
    responseId: string,
    answers: ActivityAnswer[],
    now: Date
  ): Promise<void> {
    const existing = await this.repository.listTextEntries(manager, responseId);
    const existingByQuestion = new Map(existing.map((entry) => [entry.question_id, entry]));
    const freeTextAnswers = answers.filter(
      (answer): answer is Extract<ActivityAnswer, { type: "free-text" }> =>
        answer.type === "free-text"
    );
    for (const answer of freeTextAnswers) {
      const previous = existingByQuestion.get(answer.questionId);
      if (previous?.text_value === answer.text) continue;
      await this.repository.upsertTextEntry(manager, {
        entryId: previous?.entry_id ?? `activity_text_${randomUUID()}`,
        projectId,
        responseId,
        questionId: answer.questionId,
        text: answer.text,
        now
      });
    }
    const nextQuestionIds = new Set(freeTextAnswers.map((answer) => answer.questionId));
    await this.repository.deleteTextEntries(
      manager,
      responseId,
      existing
        .filter((entry) => !nextQuestionIds.has(entry.question_id))
        .map((entry) => entry.question_id)
    );
  }

  private toResponse(row: ActivityResponseRow) {
    return activityResponseSchema.parse({
      responseId: row.response_id,
      activityRunId: row.activity_run_id,
      answers: activityAnswerSchema.array().parse(row.answers_json),
      displayName: row.display_name,
      revision: row.revision,
      submittedAt: toIso(row.submitted_at),
      updatedAt: toIso(row.updated_at)
    });
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
