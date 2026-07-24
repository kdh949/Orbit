import {
  presentationCompanionBootstrapSchema,
  presentationCompanionActivityProjectionSchema,
  presentationCompanionExchangeResponseSchema,
  presentationCompanionPairingResponseSchema,
  presentationCompanionStatusSchema,
  runtimeConfigResponseSchema,
  type PresentationCompanionBootstrap,
  type PresentationCompanionActivityProjection,
  type PresentationCompanionPairingResponse,
  type PresentationCompanionStatus,
} from "@orbit/shared";

type Fetcher = typeof fetch;

export async function isPresenterCompanionEnabled(
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  const response = await fetcher("/api/v1/runtime-config", {
    credentials: "include",
  });
  if (!response.ok) {
    return false;
  }
  return runtimeConfigResponseSchema.parse(await response.json())
    .ipadPresenterCompanionEnabled;
}

export async function createPresenterCompanionPairing(
  input: {
    projectId: string;
    sessionId: string;
  },
  fetcher: Fetcher = fetch,
): Promise<PresentationCompanionPairingResponse> {
  return requestJson(
    companionSessionUrl(input, "companion-pairings"),
    presentationCompanionPairingResponseSchema,
    fetcher,
    { method: "POST" },
  );
}

export async function fetchPresenterCompanionStatus(
  input: {
    projectId: string;
    sessionId: string;
  },
  fetcher: Fetcher = fetch,
): Promise<PresentationCompanionStatus> {
  return requestJson(
    companionSessionUrl(input, "companion-status"),
    presentationCompanionStatusSchema,
    fetcher,
  );
}

export async function disconnectPresenterCompanion(
  input: {
    projectId: string;
    sessionId: string;
  },
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(companionSessionUrl(input, "companion"), {
    credentials: "include",
    method: "DELETE",
  });
  if (!response.ok) {
    throw new PresenterCompanionRequestError(
      "iPad 연결을 해제하지 못했습니다.",
      response.status,
    );
  }
}

export async function exchangePresenterCompanionPairing(
  code: string,
  fetcher: Fetcher = fetch,
) {
  return requestJson(
    `/api/v1/presentation-companion/pairings/${encodeURIComponent(code)}/exchange`,
    presentationCompanionExchangeResponseSchema,
    fetcher,
    { method: "POST" },
  );
}

export async function fetchPresenterCompanionBootstrap(
  sessionId: string,
  fetcher: Fetcher = fetch,
): Promise<PresentationCompanionBootstrap> {
  return requestJson(
    `/api/v1/presentation-companion/${encodeURIComponent(sessionId)}/bootstrap`,
    presentationCompanionBootstrapSchema,
    fetcher,
  );
}

export async function fetchPresenterCompanionActivityProjection(
  sessionId: string,
  activityId: string,
  fetcher: Fetcher = fetch,
): Promise<PresentationCompanionActivityProjection> {
  return requestJson(
    `/api/v1/presentation-companion/${encodeURIComponent(
      sessionId,
    )}/activities/${encodeURIComponent(activityId)}`,
    presentationCompanionActivityProjectionSchema,
    fetcher,
  );
}

export class PresenterCompanionRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PresenterCompanionRequestError";
  }
}

function companionSessionUrl(
  input: { projectId: string; sessionId: string },
  suffix: string,
) {
  return `/api/v1/projects/${encodeURIComponent(input.projectId)}/presentation-sessions/${encodeURIComponent(input.sessionId)}/${suffix}`;
}

async function requestJson<T>(
  url: string,
  schema: { parse: (value: unknown) => T },
  fetcher: Fetcher,
  init: RequestInit = {},
): Promise<T> {
  const sendsJson = init.method?.toUpperCase() === "POST";
  const response = await fetcher(url, {
    ...init,
    body:
      sendsJson && init.body === undefined
        ? JSON.stringify({})
        : init.body,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(sendsJson ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new PresenterCompanionRequestError(
      getPublicRequestFailureMessage(response.status),
      response.status,
    );
  }
  return schema.parse(await response.json());
}

function getPublicRequestFailureMessage(status: number) {
  if (status === 404 || status === 410) {
    return "iPad 연결 정보가 만료되었거나 사용할 수 없습니다.";
  }
  if (status === 429) {
    return "연결 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
  }
  return "iPad 연결을 준비하지 못했습니다.";
}
