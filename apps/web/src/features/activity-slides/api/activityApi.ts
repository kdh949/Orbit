import {
  audiencePresentationAccessResponseSchema,
  ensureActivityRunResponseSchema,
  getCurrentActivityRunResponseSchema,
  getPresentationSessionResultsResponseSchema,
  getActivityPresenterResultResponseSchema,
  getActivityPublicResultResponseSchema,
  getAudienceActiveActivityResponseSchema,
  getAudienceActivityResponseSchema,
  getAudiencePresentationPublicInfoResponseSchema,
  getCurrentPresentationSessionResponseSchema,
  listPresentationSessionsResponseSchema,
  moderateActivityTextResponseSchema,
  presenterAccessResponseSchema,
  presentationSessionResponseSchema,
  presentationSessionWithAudienceUrlResponseSchema,
  supersedeActivityRunResponseSchema,
  updateActivityRunStatusResponseSchema,
  upsertActivityResponseResponseSchema
} from "@orbit/shared";
import type {
  CreatePresentationSessionRequest,
  JoinAudiencePresentationRequest,
  ModerateActivityTextRequest,
  SupersedeActivityRunRequest,
  UpdateActivityRunStatusRequest,
  UpsertActivityResponseRequest
} from "@orbit/shared";
import type { DeletePresentationSessionResultsRequest } from "@orbit/shared";
export const activityApi = {
  getCurrentSession(projectId: string, deckId: string) {
    return request(
      `/api/v1/projects/${segment(projectId)}/presentation-sessions/current?deckId=${segment(deckId)}`,
      undefined,
      getCurrentPresentationSessionResponseSchema
    );
  },
  listSessions(projectId: string, deckId: string) {
    return request(
      `/api/v1/projects/${segment(projectId)}/presentation-sessions?deckId=${segment(deckId)}`,
      undefined,
      listPresentationSessionsResponseSchema
    );
  },
  createSession(projectId: string, input: CreatePresentationSessionRequest) {
    return request(
      `/api/v1/projects/${segment(projectId)}/presentation-sessions`,
      jsonRequest("POST", input),
      presentationSessionWithAudienceUrlResponseSchema
    );
  },
  closeSession(projectId: string, sessionId: string) {
    return request(
      `/api/v1/projects/${segment(projectId)}/presentation-sessions/${segment(sessionId)}/close`,
      jsonRequest("POST", {}),
      presentationSessionResponseSchema
    );
  },
  getPresenterAccess(projectId: string, sessionId: string) {
    return request(
      `/api/v1/projects/${segment(projectId)}/presentation-sessions/${segment(sessionId)}/presenter-access`,
      undefined,
      presenterAccessResponseSchema
    );
  },
  ensureRun(projectId: string, sessionId: string, activityId: string) {
    return request(
      presenterActivityUrl(projectId, sessionId, `activities/${segment(activityId)}/current-run`),
      jsonRequest("PUT", {}),
      ensureActivityRunResponseSchema
    );
  },
  getCurrentRun(projectId: string, sessionId: string, activityId: string) {
    return request(
      presenterActivityUrl(projectId, sessionId, `activities/${segment(activityId)}/current-run`),
      undefined,
      getCurrentActivityRunResponseSchema
    );
  },
  getSessionResults(projectId: string, sessionId: string) {
    return request(
      presenterActivityUrl(projectId, sessionId, "results"),
      undefined,
      getPresentationSessionResultsResponseSchema
    );
  },
  deleteSessionResults(
    projectId: string,
    sessionId: string,
    input: DeletePresentationSessionResultsRequest
  ) {
    return request(
      presenterActivityUrl(projectId, sessionId, "results"),
      jsonRequest("DELETE", input),
      getPresentationSessionResultsResponseSchema
    );
  },
  updateRunStatus(
    projectId: string,
    sessionId: string,
    runId: string,
    input: UpdateActivityRunStatusRequest
  ) {
    return request(
      presenterActivityUrl(projectId, sessionId, `activity-runs/${segment(runId)}/status`),
      jsonRequest("PATCH", input),
      updateActivityRunStatusResponseSchema
    );
  },
  supersedeRun(
    projectId: string,
    sessionId: string,
    runId: string,
    input: SupersedeActivityRunRequest
  ) {
    return request(
      presenterActivityUrl(projectId, sessionId, `activity-runs/${segment(runId)}/supersede`),
      jsonRequest("POST", input),
      supersedeActivityRunResponseSchema
    );
  },
  getPresenterResult(projectId: string, sessionId: string, runId: string) {
    return request(
      presenterActivityUrl(projectId, sessionId, `activity-runs/${segment(runId)}/results`),
      undefined,
      getActivityPresenterResultResponseSchema
    );
  },
  getPublicResult(projectId: string, sessionId: string, runId: string) {
    return request(
      presenterActivityUrl(projectId, sessionId, `activity-runs/${segment(runId)}/public-results`),
      undefined,
      getActivityPublicResultResponseSchema
    );
  },
  moderateTextEntry(
    projectId: string,
    sessionId: string,
    entryId: string,
    input: ModerateActivityTextRequest
  ) {
    return request(
      presenterActivityUrl(projectId, sessionId, `text-entries/${segment(entryId)}`),
      jsonRequest("PATCH", input),
      moderateActivityTextResponseSchema
    );
  },
  getAudiencePublicInfo(sessionId: string) {
    return request(
      `/api/v1/audience-sessions/${segment(sessionId)}/public`,
      undefined,
      getAudiencePresentationPublicInfoResponseSchema
    );
  },
  joinAudience(sessionId: string, input: JoinAudiencePresentationRequest) {
    return request(
      `/api/v1/audience-sessions/${segment(sessionId)}/join`,
      jsonRequest("POST", input),
      audiencePresentationAccessResponseSchema
    );
  },
  getAudienceAccess(sessionId: string) {
    return request(
      `/api/v1/audience-sessions/${segment(sessionId)}/access`,
      undefined,
      audiencePresentationAccessResponseSchema
    );
  },
  getAudienceActivity(sessionId: string, activityId: string) {
    return request(
      `/api/v1/audience-sessions/${segment(sessionId)}/activities/${segment(activityId)}`,
      undefined,
      getAudienceActivityResponseSchema
    );
  },
  getAudienceActiveActivity(sessionId: string) {
    return request(
      `/api/v1/audience-sessions/${segment(sessionId)}/active-activity`,
      undefined,
      getAudienceActiveActivityResponseSchema
    );
  },
  upsertAudienceResponse(
    sessionId: string,
    activityId: string,
    input: UpsertActivityResponseRequest
  ) {
    return request(
      `/api/v1/audience-sessions/${segment(sessionId)}/activities/${segment(activityId)}/response`,
      jsonRequest("PUT", input),
      upsertActivityResponseResponseSchema
    );
  }
};

async function request<T>(
  url: string,
  init: RequestInit | undefined,
  schema: { parse(input: unknown): T }
): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : `Activity request failed (${response.status})`;
    throw new ActivityApiError(message, response.status, readErrorCode(payload));
  }
  return schema.parse(payload);
}

export class ActivityApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
    this.name = "ActivityApiError";
  }
}

function readErrorCode(payload: unknown): string | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("code" in payload) ||
    typeof payload.code !== "string"
  ) {
    return null;
  }
  return payload.code;
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

function presenterActivityUrl(projectId: string, sessionId: string, path: string) {
  return `/api/v1/projects/${segment(projectId)}/presentation-sessions/${segment(sessionId)}/${path}`;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}
