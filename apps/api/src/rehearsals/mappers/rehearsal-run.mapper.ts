import {
  rehearsalFocusProfileSchema,
  type RehearsalFocusProfile,
} from "@orbit/shared/coaching";
import { type RehearsalRun } from "@orbit/shared/rehearsals";

import type { RehearsalRunEntity } from "../rehearsal-run.entity";

export function toRehearsalRun(run: RehearsalRunEntity): RehearsalRun {
  return {
    runId: run.runId,
    projectId: run.projectId,
    deckId: run.deckId,
    audioFileId: run.audioFileId,
    jobId: run.jobId,
    deckVersion: run.deckVersion,
    evaluationSnapshot: run.evaluationSnapshot,
    semanticEvaluationMode: run.semanticEvaluationMode,
    analysisRevision: run.analysisRevision ?? 0,
    analysisFinalizedAt: run.analysisFinalizedAt?.toISOString() ?? null,
    status: run.status,
    error: run.error,
    rawAudioDeletedAt: run.rawAudioDeletedAt?.toISOString() ?? null,
    rawAudioDeleteDeadlineAt:
      run.rawAudioDeleteDeadlineAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

export function toRehearsalFocusProfile(
  row: unknown,
): RehearsalFocusProfile | null {
  if (!row || typeof row !== "object") return null;
  const value = row as Record<string, unknown>;

  return rehearsalFocusProfileSchema.parse({
    profileId: value.profile_id,
    projectId: value.project_id,
    revision: value.revision,
    items: value.items_json,
    createdBy: value.created_by,
    updatedBy: value.updated_by,
    createdAt: databaseDateToIso(value.created_at),
    updatedAt: databaseDateToIso(value.updated_at),
  });
}

function databaseDateToIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new Error("Rehearsal focus profile date is invalid.");
}
