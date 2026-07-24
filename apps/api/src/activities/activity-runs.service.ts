import { randomUUID } from "node:crypto";
import {
  activityDefinitionSchema,
  activityRunSchema,
  ensureActivityRunResponseSchema,
  getCurrentActivityRunResponseSchema,
  supersedeActivityRunResponseSchema,
  updateActivityRunStatusResponseSchema
} from "@orbit/shared";
import type {
  ActivityDefinition,
  ActivityRun,
  ActivityRuntimeStatus,
  Deck,
  SupersedeActivityRunRequest,
  UpdateActivityRunStatusRequest
} from "@orbit/shared";
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { DecksService } from "../decks/decks.service";
import { createActivityDefinitionFingerprint } from "./activity-definition-fingerprint";
import {
  ActivityRunRepository,
  type ActivityRunRow,
  type ActivitySessionRow
} from "./activity-run.repository";
import { ActivityRealtimePublisher } from "./activity-realtime.publisher";

const allowedTransitions: Record<ActivityRuntimeStatus, ActivityRuntimeStatus[]> = {
  draft: ["open"],
  open: ["closed"],
  closed: ["open", "results"],
  results: ["closed"]
};

@Injectable()
export class ActivityRunsService {
  constructor(
    private readonly repository: ActivityRunRepository,
    private readonly decksService: DecksService,
    @InjectPinoLogger(ActivityRunsService.name)
    private readonly logger: PinoLogger,
    @Optional() private readonly realtimePublisher?: ActivityRealtimePublisher
  ) {}

  async ensureCurrentRun(projectId: string, sessionId: string, activityId: string) {
    const run = await this.repository.transaction(async (manager) => {
      const { deck } = await this.lockSessionDeck(
        manager,
        projectId,
        sessionId
      );
      const source = findActivitySource(deck, activityId);
      const fingerprint = createActivityDefinitionFingerprint(source.definition);
      const current = await this.repository.findCurrent(manager, projectId, sessionId, activityId);
      if (!current) {
        return this.repository.insert(manager, {
          runId: `activity_run_${randomUUID()}`,
          projectId,
          sessionId,
          activityId,
          sourceSlideId: source.slideId,
          version: 1,
          supersedesRunId: null,
          definition: source.definition,
          fingerprint,
          now: new Date()
        });
      }
      return this.syncDefinition(manager, current, source, fingerprint);
    });
    return ensureActivityRunResponseSchema.parse({ run: this.toRun(run) });
  }

  async getCurrentRun(projectId: string, sessionId: string, activityId: string) {
    const run = await this.repository.findCurrentForRead(
      projectId,
      sessionId,
      activityId
    );
    return getCurrentActivityRunResponseSchema.parse({
      run: run ? this.toRun(run) : null
    });
  }

  async supersede(
    projectId: string,
    sessionId: string,
    runId: string,
    input: SupersedeActivityRunRequest
  ) {
    const result = await this.repository.transaction(async (manager) => {
      const { deck } = await this.lockSessionDeck(manager, projectId, sessionId);
      const previous = await this.repository.findById(manager, projectId, sessionId, runId);
      if (!previous || !previous.is_current) throw new NotFoundException("Current activity run not found");
      assertRevision(previous, input.expectedRevision);
      const source = findActivitySource(deck, previous.activity_id);
      const now = new Date();
      await this.repository.markSuperseded(manager, previous, now);
      const run = await this.repository.insert(manager, {
        runId: `activity_run_${randomUUID()}`,
        projectId,
        sessionId,
        activityId: previous.activity_id,
        sourceSlideId: source.slideId,
        version: previous.version + 1,
        supersedesRunId: previous.activity_run_id,
        definition: source.definition,
        fingerprint: createActivityDefinitionFingerprint(source.definition),
        now
      });
      return { previous, run };
    });
    this.logger.info(
      {
        event: "activity_run.superseded",
        projectId,
        presentationSessionId: sessionId,
        activityRunId: result.previous.activity_run_id,
        replacementActivityRunId: result.run.activity_run_id
      },
      "activity run superseded"
    );
    return supersedeActivityRunResponseSchema.parse({
      previousRunId: result.previous.activity_run_id,
      run: this.toRun(result.run)
    });
  }

  async updateStatus(
    projectId: string,
    sessionId: string,
    runId: string,
    input: UpdateActivityRunStatusRequest
  ) {
    const result = await this.repository.transaction(async (manager) => {
      const { deck } = await this.lockSessionDeck(
        manager,
        projectId,
        sessionId,
        input.status === "open"
      );
      let run = await this.repository.findById(manager, projectId, sessionId, runId);
      if (!run) throw new NotFoundException("Activity run not found");
      if (run.status === input.status) return { autoClosedRunIds: [], run, changed: false };
      assertRevision(run, input.expectedRevision);
      if (!allowedTransitions[run.status].includes(input.status)) {
        throw activityConflict(
          "ACTIVITY_INVALID_STATE_TRANSITION",
          `Cannot transition activity run from ${run.status} to ${input.status}`,
          run
        );
      }
      if (input.status === "open" && !run.is_current) {
        throw activityConflict("ACTIVITY_RUN_NOT_CURRENT", "Only the current activity run can open", run);
      }
      if (input.status === "open") {
        const source = findActivitySource(deck, run.activity_id);
        run = await this.syncDefinition(
          manager,
          run,
          source,
          createActivityDefinitionFingerprint(source.definition)
        );
      }
      const now = new Date();
      const autoClosedRunIds =
        input.status === "open"
          ? await this.repository.closeOtherOpenRuns(manager, projectId, sessionId, runId, now)
          : [];
      run = await this.repository.updateStatus(manager, runId, input.status, now);
      await this.repository.setActiveRun(
        manager,
        projectId,
        sessionId,
        input.status === "open" ? runId : null,
        now
      );
      return { autoClosedRunIds, run, changed: true };
    });

    result.autoClosedRunIds.forEach((closedRunId) => {
      this.logRunEvent("activity_run.closed", projectId, sessionId, closedRunId);
    });
    if (result.changed) {
      this.logRunEvent(eventForStatus(input.status), projectId, sessionId, runId);
      this.realtimePublisher?.publishStateChanged({
        sessionId,
        activityId: result.run.activity_id,
        runId,
        status: result.run.status,
        revision: result.run.revision
      });
      if (result.run.status === "open") {
        this.realtimePublisher?.publishActiveActivityChanged({
          sessionId,
          activityId: result.run.activity_id,
          runId,
          revision: result.run.revision
        });
      }
    }
    return updateActivityRunStatusResponseSchema.parse({ run: this.toRun(result.run) });
  }

  private async lockSessionDeck(
    manager: Parameters<ActivityRunRepository["findCurrent"]>[0],
    projectId: string,
    sessionId: string,
    requireStarted = false
  ): Promise<{ deck: Deck; session: ActivitySessionRow }> {
    const identity = await this.repository.findSessionIdentity(
      manager,
      projectId,
      sessionId
    );
    if (!identity?.deck_id) {
      throw new NotFoundException("Presentation session not found");
    }

    const deck = await this.decksService.getDeckForUpdate(
      manager,
      projectId,
      identity.deck_id
    );
    const session = await this.requireUsableSession(
      await this.repository.lockSession(manager, projectId, sessionId),
      requireStarted
    );
    if (session.deck_id !== identity.deck_id || session.deck_id !== deck.deckId) {
      throw new NotFoundException("Presentation session not found");
    }
    return { deck, session };
  }

  private async requireUsableSession(
    session: ActivitySessionRow | null,
    requireStarted = false
  ): Promise<ActivitySessionRow> {
    if (!session || session.session_status === "ended") {
      throw new NotFoundException("Presentation session not found");
    }
    if (
      session.session_purpose !== "presentation" ||
      !session.audience_access_enabled
    ) {
      throw new ConflictException(
        "Audience access must be enabled for activity runs",
      );
    }
    const now = Date.now();
    if (new Date(session.expires_at).getTime() <= now) {
      throw new ConflictException("Presentation session has expired");
    }
    if (requireStarted && new Date(session.starts_at).getTime() > now) {
      throw new ConflictException("Presentation session has not started");
    }
    return session;
  }

  private async syncDefinition(
    manager: Parameters<ActivityRunRepository["findCurrent"]>[0],
    current: ActivityRunRow,
    source: { slideId: string; definition: ActivityDefinition },
    fingerprint: string
  ): Promise<ActivityRunRow> {
    if (current.definition_fingerprint === fingerprint) return current;
    if (current.response_count > 0) {
      throw activityConflict(
        "ACTIVITY_DEFINITION_LOCKED",
        "Activity definition cannot change after the first response",
        current
      );
    }
    return this.repository.updateSnapshot(
      manager,
      current.activity_run_id,
      source.slideId,
      source.definition,
      fingerprint,
      new Date()
    );
  }

  private toRun(row: ActivityRunRow): ActivityRun {
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

  private logRunEvent(event: string, projectId: string, sessionId: string, runId: string) {
    this.logger.info(
      { event, projectId, presentationSessionId: sessionId, activityRunId: runId },
      "activity run state changed"
    );
  }
}

function findActivitySource(deck: Deck, activityId: string) {
  const slide = deck.slides.find(
    (candidate) => candidate.kind === "activity" && candidate.activity.activityId === activityId
  );
  if (!slide || slide.kind !== "activity") {
    throw new NotFoundException("Activity definition not found in stored Deck");
  }
  return { slideId: slide.slideId, definition: slide.activity };
}

function assertRevision(run: ActivityRunRow, expectedRevision: number): void {
  if (run.revision !== expectedRevision) {
    throw activityConflict("ACTIVITY_REVISION_CONFLICT", "Activity run revision is stale", run);
  }
}

function activityConflict(code: string, message: string, run: ActivityRunRow) {
  return new HttpException(
    {
      code,
      message,
      currentRun: {
        activityRunId: run.activity_run_id,
        status: run.status,
        revision: run.revision,
        version: run.version,
        responseCount: run.response_count
      }
    },
    HttpStatus.CONFLICT
  );
}

function eventForStatus(status: ActivityRuntimeStatus): string {
  if (status === "open") return "activity_run.opened";
  if (status === "results") return "activity_run.revealed";
  return "activity_run.closed";
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toOptionalIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}
