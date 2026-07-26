import type { PresentationSession } from "@orbit/shared/presentation";
import { NotFoundException } from "@nestjs/common";

import type { PresentationSessionRow } from "./presentation-session.repository";

export function toPresentationSession(
  row: PresentationSessionRow,
): PresentationSession {
  if (
    !row.deck_id ||
    !row.deck_version ||
    !row.presenter_user_id ||
    !row.created_by
  ) {
    throw new NotFoundException(
      "Presentation session deck link is unavailable",
    );
  }
  return {
    sessionId: row.session_id,
    projectId: row.project_id,
    deckId: row.deck_id,
    deckVersion: row.deck_version,
    presenterUserId: row.presenter_user_id,
    createdBy: row.created_by,
    status: row.status,
    sessionPurpose: row.session_purpose,
    audienceAccessEnabled: row.audience_access_enabled,
    accessMode: row.access_mode,
    startsAt: toIso(row.starts_at),
    expiresAt: toIso(row.expires_at),
    activeActivityRunId: row.active_activity_run_id,
    startedAt: toOptionalIso(row.started_at),
    endedAt: toOptionalIso(row.ended_at),
    closedAt: toOptionalIso(row.closed_at),
    rawResponsesDeleteAfter: toOptionalIso(row.raw_responses_delete_after),
    rawResponsesDeletedAt: toOptionalIso(row.raw_responses_deleted_at),
    resultsDeletedAt: toOptionalIso(row.results_deleted_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toOptionalIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}
