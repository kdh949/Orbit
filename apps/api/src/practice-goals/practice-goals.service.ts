import {
  practiceGoalSchema,
  practiceGoalSetSchema,
  practicePlanResponseSchema,
  type EvaluationCriterion,
  type PracticeGoal,
} from "@orbit/shared/coaching";
import {
  rehearsalEvaluationSnapshotSchema,
  rehearsalReportSchema,
  type RehearsalEvaluationSnapshot,
  type RehearsalReport,
} from "@orbit/shared/rehearsals";
import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

import { ProjectsService } from "../projects/projects.service";

@Injectable()
export class PracticeGoalsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly projects: ProjectsService,
  ) {}

  async getPlan(
    projectId: string,
    sourceFullRunId: string,
    actorUserId: string,
  ) {
    await this.projects.assertCanReadProject(projectId, actorUserId);
    const run = firstRow(
      await this.dataSource.query(
        `SELECT status, analysis_revision, analysis_finalized_at
       FROM rehearsal_runs WHERE project_id = $1 AND run_id = $2`,
        [projectId, sourceFullRunId],
      ),
    );
    if (!run) {
      return practicePlanResponseSchema.parse({
        status: "error",
        sourceFullRunId,
        code: "SOURCE_NOT_FOUND",
      });
    }
    if (run.status === "failed" || run.status === "cancelled") {
      return practicePlanResponseSchema.parse({
        status: "error",
        sourceFullRunId,
        code: "SOURCE_FAILED",
      });
    }

    const setRow = firstRow(
      await this.dataSource.query(
        `SELECT sets.* FROM practice_goal_heads heads
       JOIN practice_goal_sets sets ON sets.project_id = heads.project_id
        AND sets.goal_set_id = heads.current_goal_set_id
       WHERE heads.project_id = $1 AND heads.source_full_run_id = $2`,
        [projectId, sourceFullRunId],
      ),
    );
    if (!setRow) {
      return practicePlanResponseSchema.parse({
        status: run.status === "succeeded" ? "no-goal" : "processing",
        sourceFullRunId,
      });
    }
    if (setRow.analysis_state === "partial") {
      return practicePlanResponseSchema.parse({
        status: "processing",
        sourceFullRunId,
      });
    }

    const goalRows = await this.dataSource.query(
      `SELECT * FROM practice_goals WHERE project_id = $1 AND goal_set_id = $2 ORDER BY priority ASC`,
      [projectId, setRow.goal_set_id],
    );
    const goals = (Array.isArray(goalRows) ? goalRows : [])
      .filter((row): row is Record<string, unknown> =>
        Boolean(row && typeof row === "object" && !isLegacyPauseGoalRow(row)),
      )
      .map((row, index) => toGoal({ ...row, priority: index + 1 }));
    const goalSet = practiceGoalSetSchema.parse({
      goalSetId: setRow.goal_set_id,
      projectId,
      sourceFullRunId,
      revision: setRow.revision,
      sourceAnalysisRevision: setRow.source_analysis_revision,
      isCurrent: true,
      analysisState: setRow.analysis_state,
      dataOrigin: setRow.data_origin,
      derivationVersion: setRow.derivation_version,
      goals,
      createdAt: toIso(setRow.created_at),
    });
    if (goals.length === 0) {
      return practicePlanResponseSchema.parse({
        status: "no-goal",
        sourceFullRunId,
      });
    }

    const historyRows = await this.dataSource.query(
      `WITH current_run AS (
         SELECT created_at, run_id
         FROM rehearsal_runs
         WHERE project_id = $1 AND run_id = $2
       ), recent_full_runs AS (
         SELECT runs.run_id, runs.created_at, runs.evaluation_snapshot_json,
                runs.report_json AS rehearsal_report_json
         FROM rehearsal_runs runs
         CROSS JOIN current_run current
         WHERE runs.project_id = $1
           AND runs.status = 'succeeded'
           AND runs.semantic_evaluation_mode = 'full'
           AND runs.evaluation_snapshot_json IS NOT NULL
           AND runs.report_json IS NOT NULL
           AND (runs.created_at, runs.run_id) <= (current.created_at, current.run_id)
         ORDER BY runs.created_at DESC, runs.run_id DESC
         LIMIT 5
       )
       SELECT runs.run_id, runs.created_at AS run_created_at,
              runs.evaluation_snapshot_json, runs.rehearsal_report_json
       FROM recent_full_runs runs
       ORDER BY runs.created_at DESC, runs.run_id DESC`,
      [projectId, sourceFullRunId],
    );
    const history = historyByComparableRuns(
      goals,
      Array.isArray(historyRows) ? historyRows : [],
    );
    return practicePlanResponseSchema.parse({
      status: "ready",
      sourceFullRunId,
      goalSet,
      goals: goals.map((goal) => ({
        ...goal,
        history: history.get(goal.patternKey) ?? {
          label: "current",
          occurrenceCount: 1,
          comparableRunCount: 0,
          lastSeenAt: goal.createdAt,
        },
        canStartFocusedPractice:
          goal.recommendedPracticeMode === "focused" &&
          goal.measurementState === "measured",
        unavailableReason:
          goal.recommendedPracticeMode === "full-run-only"
            ? "FULL_RUN_ONLY"
            : goal.measurementState === "unmeasured"
              ? "UNMEASURED"
              : null,
      })),
      fullRehearsalCta: { projectId, sourceGoalSetId: goalSet.goalSetId },
    });
  }
}

function toGoal(row: Record<string, unknown>): PracticeGoal {
  return practiceGoalSchema.parse({
    goalId: row.goal_id,
    goalSetId: row.goal_set_id,
    projectId: row.project_id,
    originFullRunId: row.origin_full_run_id,
    priority: row.priority,
    patternKey: row.pattern_key,
    category: row.category,
    criterionRef: row.criterion_ref_json,
    targetScope: row.target_scope_json,
    recommendedPracticeMode: row.recommended_practice_mode,
    evidenceRefs: row.evidence_refs_json,
    problemLabel: row.problem_label,
    nextAction: row.next_action,
    successCondition: row.success_condition,
    measurementState: row.measurement_state,
    createdAt: toIso(row.created_at),
  });
}

function isLegacyPauseGoalRow(row: object) {
  const evidenceRefs = (row as Record<string, unknown>).evidence_refs_json;
  return (
    Array.isArray(evidenceRefs) &&
    evidenceRefs.some(
      (evidence) =>
        evidence &&
        typeof evidence === "object" &&
        !Array.isArray(evidence) &&
        (evidence as Record<string, unknown>).metric === "pause-count",
    )
  );
}

function historyByComparableRuns(goals: PracticeGoal[], rows: unknown[]) {
  const runs = groupHistoryRuns(rows);
  const histories = goals.map((goal) => {
    const currentRun = runs.find((run) => run.runId === goal.originFullRunId);
    const currentCriterion = currentRun
      ? criterionForGoal(currentRun.snapshot, goal)
      : null;
    if (!currentRun || !currentCriterion) {
      return [goal.patternKey, defaultHistory(goal)] as const;
    }

    const comparableRuns = runs.flatMap((run) => {
      const criterion = criterionForGoal(run.snapshot, goal);
      if (
        criterion === null ||
        !comparableCriterionSources(
          currentRun.snapshot,
          currentCriterion,
          run.snapshot,
          criterion,
        )
      ) {
        return [];
      }
      const state = criterionProblemState(run.report, criterion);
      return state === "unmeasured" ? [] : [{ ...run, state }];
    });
    const currentState = comparableRuns.find(
      (run) => run.runId === goal.originFullRunId,
    )?.state;
    if (currentState !== "problem") {
      return [goal.patternKey, defaultHistory(goal)] as const;
    }

    const occurrenceCount = comparableRuns.filter(
      (run) => run.state === "problem",
    ).length;
    const previousComparableRuns = comparableRuns.filter(
      (run) => run.runId !== goal.originFullRunId,
    );
    const previousRun = previousComparableRuns[0];
    const isRecentTwice = previousRun?.state === "problem";
    const hasPreviousOccurrence = previousComparableRuns.some(
      (run) => run.state === "problem",
    );
    const label =
      comparableRuns.length >= 3 && hasPreviousOccurrence
        ? "persistent"
        : isRecentTwice
          ? "recent-twice"
          : "current";

    return [
      goal.patternKey,
      {
        label,
        occurrenceCount,
        comparableRunCount: previousComparableRuns.length,
        lastSeenAt: goal.createdAt,
      },
    ] as const;
  });
  return new Map(histories);
}

type ComparableRun = {
  runId: string;
  createdAt: string;
  snapshot: RehearsalEvaluationSnapshot;
  report: RehearsalReport;
};

function groupHistoryRuns(rows: unknown[]): ComparableRun[] {
  const grouped = new Map<string, ComparableRun>();
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.run_id !== "string") continue;
    const snapshot = rehearsalEvaluationSnapshotSchema.safeParse(
      row.evaluation_snapshot_json,
    );
    const report = rehearsalReportSchema.safeParse(row.rehearsal_report_json);
    if (!snapshot.success || !report.success) continue;
    const current = grouped.get(row.run_id) ?? {
      runId: row.run_id,
      createdAt: toIso(row.run_created_at),
      snapshot: snapshot.data,
      report: report.data,
    };
    grouped.set(row.run_id, current);
  }
  return [...grouped.values()]
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.runId.localeCompare(left.runId),
    )
    .slice(0, 5);
}

function criterionForGoal(
  snapshot: RehearsalEvaluationSnapshot,
  goal: PracticeGoal,
) {
  return (
    snapshot.evaluationPlan?.criteria.find(
      (criterion) =>
        criterion.criterionId === goal.criterionRef.criterionId &&
        criterion.revision === goal.criterionRef.revision,
    ) ?? null
  );
}

function comparableCriterionSources(
  currentSnapshot: RehearsalEvaluationSnapshot,
  currentCriterion: EvaluationCriterion,
  previousSnapshot: RehearsalEvaluationSnapshot,
  previousCriterion: EvaluationCriterion,
) {
  const currentPlan = currentSnapshot.evaluationPlan;
  const previousPlan = previousSnapshot.evaluationPlan;
  if (!currentPlan || !previousPlan) return false;
  if (!currentSnapshot.deckContentHash || !previousSnapshot.deckContentHash) {
    return false;
  }
  return (
    currentSnapshot.deckContentHash === previousSnapshot.deckContentHash &&
    sameJson(currentPlan.briefRef, previousPlan.briefRef) &&
    sameJson(currentPlan.evaluatorLensRef, previousPlan.evaluatorLensRef) &&
    currentCriterion.criterionId === previousCriterion.criterionId &&
    currentCriterion.revision === previousCriterion.revision &&
    sameJson(currentCriterion.scope, previousCriterion.scope) &&
    metricDefinitionVersion(currentSnapshot, currentCriterion) ===
      metricDefinitionVersion(previousSnapshot, previousCriterion)
  );
}

function metricDefinitionVersion(
  snapshot: RehearsalEvaluationSnapshot,
  criterion: EvaluationCriterion,
) {
  const versions = snapshot.evaluationPlan?.metricDefinitionVersions;
  if (!versions) return null;
  if (criterion.measurement.type === "semantic-coverage")
    return versions.semantic;
  if (criterion.measurement.type === "max-duration-seconds")
    return versions.timing;
  return criterion.measurement.metric === "filler-word-count"
    ? versions.filler
    : versions.silence;
}

type CriterionProblemState = "problem" | "passed" | "unmeasured";

function criterionProblemState(
  report: RehearsalReport,
  criterion: EvaluationCriterion,
): CriterionProblemState {
  if (criterion.measurement.type === "semantic-coverage") {
    const outcome = report.semanticCueOutcomes.find(
      (outcome) =>
        criterion.source === "deck-cue" &&
        criterion.scope.type === "slide" &&
        criterion.scope.slideId === outcome.slideId &&
        criterion.criterionId ===
          `criterion_cue_${outcome.cueId}_r${outcome.cueRevision}`.slice(
            0,
            128,
          ),
    );
    if (
      !outcome ||
      outcome.status === "unmeasured" ||
      outcome.status === "excluded"
    ) {
      return "unmeasured";
    }
    const contradicted = report.semanticCueDecisions.some(
      (decision) =>
        decision.slideId === outcome.slideId &&
        decision.cueId === outcome.cueId &&
        decision.label === "contradicted",
    );
    return contradicted || outcome.status !== "covered" ? "problem" : "passed";
  }
  if (criterion.measurement.type === "max-duration-seconds") {
    if (criterion.scope.type !== "slide") return "unmeasured";
    const slideId = criterion.scope.slideId;
    const timing = report.slideTimings.find((item) => item.slideId === slideId);
    if (!timing) return "unmeasured";
    return timing.actualSeconds > criterion.measurement.maximum
      ? "problem"
      : "passed";
  }
  const value = countMeasurementValue(
    report,
    criterion.scope,
    criterion.measurement,
  );
  if (value === null) return "unmeasured";
  return value > criterion.measurement.maximum ? "problem" : "passed";
}

function countMeasurementValue(
  report: RehearsalReport,
  scope: EvaluationCriterion["scope"],
  measurement: Extract<
    EvaluationCriterion["measurement"],
    { type: "max-count" }
  >,
) {
  const metric = measurement.metric;
  if (scope.type === "run") {
    return metric === "filler-word-count"
      ? report.metrics.fillerWordCount
      : report.metrics.longSilenceCount;
  }
  if (scope.type !== "slide") return null;
  const slideId = scope.slideId;
  const insight = report.slideInsights.find((item) => item.slideId === slideId);
  if (!insight) return null;
  return metric === "filler-word-count"
    ? insight.fillerWordCount
    : insight.longSilenceCount;
}

function defaultHistory(goal: PracticeGoal) {
  return {
    label: "current" as const,
    occurrenceCount: 1,
    comparableRunCount: 0,
    lastSeenAt: goal.createdAt,
  };
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function firstRow(rows: unknown): Record<string, unknown> | undefined {
  return Array.isArray(rows) && rows[0] && typeof rows[0] === "object"
    ? (rows[0] as Record<string, unknown>)
    : undefined;
}

function toIso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}
