import {
  activityAnswerSchema,
  calculateActivityResponseRate,
  activityDefinitionSchema,
  activityPresenterResultSchema,
  activityRetentionSnapshotSchema,
  activityPublicResultSchema,
  activityResponseSchema,
  activityRunSchema,
  getActivityPresenterResultResponseSchema,
  getActivityPublicResultResponseSchema,
  getPresentationSessionResultsResponseSchema,
  type DeletePresentationSessionResultsRequest,
  getAudienceActiveActivityResponseSchema,
  getAudienceActivityResponseSchema
} from "@orbit/shared";
import type { ActivityAnswer, ActivityPresenterResult, ActivityPublicResult } from "@orbit/shared";
import {
  ConflictException,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { toPresentationSession } from "../presentation-sessions/presentation-session.mapper";
import { PresentationSessionRepository } from "../presentation-sessions/presentation-session.repository";

import { buildActivityAggregates } from "./activity-aggregate";
import {
  ActivityResultsRepository,
  type ActivityResultResponseRow,
  type ActivityResultRunRow
} from "./activity-results.repository";

@Injectable()
export class ActivityResultsService {
  constructor(
    private readonly repository: ActivityResultsRepository,
    private readonly presentationSessions: PresentationSessionRepository,
    @InjectPinoLogger(ActivityResultsService.name)
    @Optional()
    private readonly logger?: PinoLogger
  ) {}

  async getSessionArchive(projectId: string, sessionId: string) {
    const session = await this.getPresentationSession(projectId, sessionId);
    const [runs, snapshots, participantCount] = await Promise.all([
      this.repository.listSessionRuns(projectId, sessionId),
      this.repository.listSessionSnapshots(projectId, sessionId),
      this.repository.countSessionAudiences(projectId, sessionId)
    ]);
    const snapshotsByRun = new Map(
      snapshots.map((snapshot) => [snapshot.activity_run_id, snapshot.aggregate_json])
    );
    const availability = session.resultsDeletedAt
      ? "results-deleted"
      : session.rawResponsesDeletedAt
        ? "aggregate-only"
        : "raw-retained";
    const activities = await Promise.all(
      runs.map(async (run) => ({
        availability,
        result:
          availability === "raw-retained"
            ? await this.buildPresenterResult(run, participantCount)
            : availability === "aggregate-only"
              ? this.parseRetentionSnapshot(snapshotsByRun.get(run.activity_run_id))
              : null,
        run: this.toRun(run)
      }))
    );
    return getPresentationSessionResultsResponseSchema.parse({
      activities,
      session,
      sessionName: createSessionName(session.sessionId, session.createdAt)
    });
  }

  private parseRetentionSnapshot(value: unknown) {
    if (value === undefined) return null;
    return activityRetentionSnapshotSchema.parse(value);
  }

  async deleteSessionResults(
    projectId: string,
    sessionId: string,
    input: DeletePresentationSessionResultsRequest
  ) {
    const session = await this.getPresentationSession(projectId, sessionId);
    const sessionName = createSessionName(session.sessionId, session.createdAt);
    if (input.confirmation.trim() !== sessionName) {
      throw new ConflictException("Presentation session name confirmation does not match");
    }
    const deleted = await this.repository.transaction((manager) =>
      this.repository.hardDeleteSessionResults(
        manager,
        projectId,
        sessionId,
        new Date()
      )
    );
    if (!deleted) throw new NotFoundException("Presentation session not found");
    this.logger?.info(
      {
        event: "activity_results.deleted",
        projectId,
        presentationSessionId: sessionId
      },
      "presentation session activity results permanently deleted"
    );
    return this.getSessionArchive(projectId, sessionId);
  }

  private async getPresentationSession(projectId: string, sessionId: string) {
    const row = await this.presentationSessions.findByIdForRead(
      projectId,
      sessionId
    );
    if (!row) throw new NotFoundException("Presentation session not found");
    return toPresentationSession(row);
  }

  async getPresenterResult(projectId: string, sessionId: string, runId: string) {
    const run = await this.repository.findRun(projectId, sessionId, runId);
    if (!run) throw new NotFoundException("Activity run not found");
    if (run.results_deleted_at) throw new NotFoundException("Activity results deleted");
    const participantCount = await this.repository.countSessionAudiences(
      projectId,
      sessionId
    );
    return getActivityPresenterResultResponseSchema.parse({
      result: await this.buildPresenterResult(run, participantCount)
    });
  }

  async getPublicResult(projectId: string, sessionId: string, runId: string) {
    const run = await this.repository.findRun(projectId, sessionId, runId);
    if (!run) throw new NotFoundException("Activity run not found");
    return getActivityPublicResultResponseSchema.parse({
      result:
        !run.results_deleted_at && run.status === "results"
          ? await this.buildPublicResult(run)
          : null
    });
  }

  async getAudienceActivity(
    projectId: string,
    sessionId: string,
    activityId: string,
    audienceId: string
  ) {
    const run = await this.repository.findCurrentRun(projectId, sessionId, activityId);
    if (!run || run.results_deleted_at) throw new NotFoundException("Activity run not found");
    return this.buildAudienceActivity(run, audienceId);
  }

  async getAudienceActiveActivity(
    projectId: string,
    sessionId: string,
    audienceId: string
  ) {
    const run = await this.repository.findActiveRun(projectId, sessionId);
    return getAudienceActiveActivityResponseSchema.parse({
      activity: run && !run.results_deleted_at ? await this.buildAudienceActivity(run, audienceId) : null
    });
  }

  private async buildAudienceActivity(
    run: ActivityResultRunRow,
    audienceId: string
  ) {
    const ownResponse = await this.repository.findOwnResponse(
      run.project_id,
      run.activity_run_id,
      audienceId
    );
    return getAudienceActivityResponseSchema.parse({
      activityId: run.activity_id,
      run: this.toRun(run),
      ownResponse: ownResponse ? this.toResponse(run.activity_run_id, ownResponse) : null,
      publicResult: run.status === "results" ? await this.buildPublicResult(run) : null
    });
  }

  private async buildPresenterResult(
    run: ActivityResultRunRow,
    participantCount: number
  ): Promise<ActivityPresenterResult> {
    const definition = activityDefinitionSchema.parse(run.definition_snapshot);
    const [responses, textEntries] = await Promise.all([
      this.repository.listResponses(run.project_id, run.activity_run_id),
      this.repository.listTextEntries(run.project_id, run.activity_run_id)
    ]);
    return activityPresenterResultSchema.parse({
      ...this.resultBase(run, buildActivityAggregates(definition, responses.map(toAnswers))),
      participantCount,
      responseRate: calculateActivityResponseRate(run.response_count, participantCount),
      textEntries: textEntries.map((entry) => ({
        entryId: entry.entry_id,
        questionId: entry.question_id,
        text: entry.text_value,
        displayName: entry.display_name,
        moderationStatus: entry.moderation_status,
        answeredAt: toOptionalIso(entry.answered_at),
        updatedAt: toIso(entry.updated_at)
      }))
    });
  }

  private async buildPublicResult(run: ActivityResultRunRow): Promise<ActivityPublicResult> {
    const definition = activityDefinitionSchema.parse(run.definition_snapshot);
    const [responses, textEntries] = await Promise.all([
      this.repository.listResponses(run.project_id, run.activity_run_id),
      this.repository.listTextEntries(run.project_id, run.activity_run_id)
    ]);
    return activityPublicResultSchema.parse({
      ...this.resultBase(run, buildActivityAggregates(definition, responses.map(toAnswers))),
      approvedTextEntries: textEntries
        .filter((entry) => entry.moderation_status === "approved")
        .map((entry) => ({
          entryId: entry.entry_id,
          questionId: entry.question_id,
          text: entry.text_value,
          answered: entry.answered_at !== null
        }))
    });
  }

  private resultBase(
    run: ActivityResultRunRow,
    aggregates: ReturnType<typeof buildActivityAggregates>
  ) {
    return {
      activityRunId: run.activity_run_id,
      activityId: run.activity_id,
      status: run.status,
      revision: run.revision,
      responseCount: run.response_count,
      aggregates
    };
  }

  private toRun(row: ActivityResultRunRow) {
    return activityRunSchema.parse({
      activityRunId: row.activity_run_id,
      presentationSessionId: row.session_id,
      activityId: row.activity_id,
      sourceSlideId: row.source_slide_id,
      version: row.version,
      supersedesActivityRunId: row.supersedes_activity_run_id,
      definitionSnapshot: activityDefinitionSchema.parse(row.definition_snapshot),
      definitionFingerprint: row.definition_fingerprint,
      status: row.status,
      revision: row.revision,
      isCurrent: row.is_current,
      responseCount: row.response_count,
      openedAt: toOptionalIso(row.opened_at),
      closedAt: toOptionalIso(row.closed_at),
      revealedAt: toOptionalIso(row.revealed_at),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at)
    });
  }

  private toResponse(runId: string, row: ActivityResultResponseRow) {
    return activityResponseSchema.parse({
      responseId: row.response_id,
      activityRunId: runId,
      answers: toAnswers(row),
      displayName: row.display_name,
      revision: row.revision,
      submittedAt: toIso(row.submitted_at),
      updatedAt: toIso(row.updated_at)
    });
  }
}

function toAnswers(row: ActivityResultResponseRow): ActivityAnswer[] {
  return activityAnswerSchema.array().parse(row.answers_json);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toOptionalIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function createSessionName(sessionId: string, createdAt: string) {
  const date = createdAt.slice(0, 10);
  return `발표 세션 ${date} ${sessionId.slice(-8)}`;
}
