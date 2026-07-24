import {
  completePresentationAudioResponseSchema,
  createPresentationAudioUploadResponseSchema,
  createPresentationRunResponseSchema,
  getDeckResponseSchema,
  getPresentationRunReportResponseSchema,
  getPresentationRunResponseSchema,
  presentationSessionResponseSchema,
  putDeckResponseSchema,
  type AssetUploadUrlResponse,
  type Deck,
  type PresentationRecordingMode,
  type PresentationSessionPurpose,
  type SlideTranscriptSnapshot,
} from "@orbit/shared";

import { activityApi } from "../activity-slides/api/activityApi";
import { normalizePresentationRecordingFile } from "./presentationRecording";

export type PresentationRuntimeIdentity = {
  accessMode: "passcode" | "public";
  audienceUrl: string | null;
  displayPasscode: string | null;
  recordingMode: PresentationRecordingMode;
  runId: string;
  sessionId: string;
  status:
    | "created"
    | "uploading"
    | "processing"
    | "succeeded"
    | "failed"
    | "cancelled";
};

export type PresenterCompanionSessionIdentity = {
  audienceAccessEnabled: boolean;
  audienceUrl: string | null;
  deckId: string;
  deckVersion: number;
  sessionId: string;
  sessionPurpose: PresentationSessionPurpose;
};

export async function fetchOrCreatePresentationDeck(input: {
  fallbackDeck?: Deck;
  projectId?: string;
  fetcher?: typeof fetch;
}) {
  const projectId = input.projectId ?? input.fallbackDeck?.projectId;
  if (!projectId) {
    throw new Error("발표 자료를 불러올 프로젝트가 지정되지 않았습니다.");
  }

  const fetcher = input.fetcher ?? fetch;
  const url = `/api/v1/projects/${segment(projectId)}/deck`;
  const response = await fetcher(url);
  if (response.ok) {
    return getDeckResponseSchema.parse(await response.json()).deck;
  }

  if (response.status === 404 && input.fallbackDeck) {
    const putResponse = await fetcher(url, {
      body: JSON.stringify({
        deck: input.fallbackDeck,
        snapshotReason: "deck-replaced",
      }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    if (!putResponse.ok) {
      throw new Error(
        await readPresentationError(
          putResponse,
          "발표 자료를 초기화하지 못했습니다.",
        ),
      );
    }
    return putDeckResponseSchema.parse(await putResponse.json()).deck;
  }

  if (
    input.fallbackDeck &&
    (response.status === 401 || response.status === 403)
  ) {
    return input.fallbackDeck;
  }

  throw new Error(
    await readPresentationError(response, "발표 자료를 불러오지 못했습니다."),
  );
}

export async function ensurePresenterCompanionSession(input: {
  deckId: string;
  projectId: string;
  sessionPurpose: PresentationSessionPurpose;
}): Promise<PresenterCompanionSessionIdentity> {
  const { audienceUrl, session } = await activityApi.createSession(
    input.projectId,
    {
      audienceAccessEnabled: false,
      deckId: input.deckId,
      reuseCurrent: true,
      sessionPurpose: input.sessionPurpose,
    },
  );
  return {
    audienceAccessEnabled: session.audienceAccessEnabled,
    audienceUrl,
    deckId: session.deckId,
    deckVersion: session.deckVersion,
    sessionId: session.sessionId,
    sessionPurpose: session.sessionPurpose,
  };
}

export async function startPresentationRuntime(input: {
  projectId: string;
  recordingMode: PresentationRecordingMode;
  session: PresenterCompanionSessionIdentity;
}): Promise<PresentationRuntimeIdentity> {
  const response = await requestJson(
    runsUrl(input.projectId, input.session.sessionId),
    {
      body: JSON.stringify({
        expectedDeckVersion: input.session.deckVersion,
        recordingMode: input.recordingMode,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  const { run } = createPresentationRunResponseSchema.parse(response);
  const [current, presenterAccess] = await Promise.all([
    activityApi.getCurrentSession(input.projectId, input.session.deckId),
    activityApi.getPresenterAccess(input.projectId, input.session.sessionId),
  ]);
  const audienceUrl =
    current.session?.sessionId === input.session.sessionId
      ? current.audienceUrl
      : input.session.audienceUrl;
  return {
    accessMode: presenterAccess.accessMode,
    audienceUrl,
    displayPasscode: presenterAccess.displayPasscode,
    recordingMode: run.recordingMode,
    runId: run.runId,
    sessionId: input.session.sessionId,
    status: run.status,
  };
}

export async function closePresenterCompanionSession(input: {
  projectId: string;
  sessionId: string;
}) {
  const response = await requestJson(
    `/api/v1/projects/${segment(input.projectId)}/presentation-sessions/${segment(input.sessionId)}/close`,
    {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  return presentationSessionResponseSchema.parse(response).session;
}

export async function uploadPresentationRecording(input: {
  file: File;
  liveTranscript?: string;
  projectId: string;
  runId: string;
  sessionId: string;
  slideTranscriptSnapshots?: SlideTranscriptSnapshot[];
}) {
  const file = normalizePresentationRecordingFile(input.file);
  const current = await getPresentationRun(input);
  if (hasCompletedAudioStep(current.run.status)) {
    return;
  }

  if (current.run.status === "uploading" && current.run.audioFileId) {
    const completed = await completePendingPresentationRecording({
      ...input,
      fileId: current.run.audioFileId,
    });
    if (completed) {
      return;
    }
  }

  const uploadResponse = await requestJson(
    `${runsUrl(input.projectId, input.sessionId)}/${segment(input.runId)}/audio-upload`,
    {
      body: JSON.stringify({
        mimeType: file.type,
        originalName: file.name,
        size: file.size,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  const { upload } =
    createPresentationAudioUploadResponseSchema.parse(uploadResponse);
  await putPresentationRecording(upload, file);
  const completed = await completePendingPresentationRecording({
    ...input,
    fileId: upload.fileId,
  });
  if (!completed) {
    throw new Error("발표 녹음 완료 상태를 확인하지 못했습니다.");
  }
}

export async function completePresentationWithoutAudio(input: {
  projectId: string;
  runId: string;
  sessionId: string;
}) {
  const current = await getPresentationRun(input);
  if (hasCompletedAudioStep(current.run.status)) {
    return;
  }
  if (current.run.status !== "created") {
    throw new Error("마이크 없이 종료할 수 없는 발표 상태입니다.");
  }

  if (current.run.recordingMode === "microphone") {
    const response = await requestJson(
      runsUrl(input.projectId, input.sessionId),
      {
        body: JSON.stringify({
          expectedDeckVersion: current.run.deckVersion,
          recordingMode: "none",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    const { run } = createPresentationRunResponseSchema.parse(response);
    if (run.runId !== input.runId || run.recordingMode !== "none") {
      throw new Error("빈 발표 녹음을 마이크 없이 완료하지 못했습니다.");
    }
  }

  try {
    await completePresentationRecording({
      ...input,
      body: { withoutAudio: true },
    });
  } catch (cause) {
    const reconciled = await getPresentationRun(input);
    if (!hasCompletedAudioStep(reconciled.run.status)) {
      throw cause;
    }
  }
}

export async function getPresentationRun(input: {
  projectId: string;
  runId: string;
  sessionId: string;
}) {
  const response = await requestJson(
    `${runsUrl(input.projectId, input.sessionId)}/${segment(input.runId)}`,
  );
  return getPresentationRunResponseSchema.parse(response);
}

export async function getPresentationSessionRun(input: {
  projectId: string;
  sessionId: string;
}) {
  const response = await requestJson(runsUrl(input.projectId, input.sessionId));
  return getPresentationRunResponseSchema.parse(response);
}

export async function getPresentationReport(input: {
  projectId: string;
  runId: string;
  sessionId: string;
}) {
  const response = await requestJson(
    `${runsUrl(input.projectId, input.sessionId)}/${segment(input.runId)}/report`,
  );
  return getPresentationRunReportResponseSchema.parse(response);
}

export async function retryPresentationAnalysis(input: {
  projectId: string;
  runId: string;
  sessionId: string;
}) {
  const response = await requestJson(
    `${runsUrl(input.projectId, input.sessionId)}/${segment(input.runId)}/retry-analysis`,
    { method: "POST" },
  );
  return completePresentationAudioResponseSchema.parse(response);
}

async function completePresentationRecording(input: {
  body:
    | {
        fileId: string;
        liveTranscript?: string;
        slideTranscriptSnapshots?: SlideTranscriptSnapshot[];
      }
    | { withoutAudio: true };
  projectId: string;
  runId: string;
  sessionId: string;
}) {
  const response = await requestJson(
    `${runsUrl(input.projectId, input.sessionId)}/${segment(input.runId)}/audio-complete`,
    {
      body: JSON.stringify(input.body),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  return completePresentationAudioResponseSchema.parse(response);
}

async function completePendingPresentationRecording(input: {
  fileId: string;
  liveTranscript?: string;
  projectId: string;
  runId: string;
  sessionId: string;
  slideTranscriptSnapshots?: SlideTranscriptSnapshot[];
}) {
  try {
    await completePresentationRecording({
      body: {
        fileId: input.fileId,
        liveTranscript: input.liveTranscript,
        slideTranscriptSnapshots: input.slideTranscriptSnapshots,
      },
      projectId: input.projectId,
      runId: input.runId,
      sessionId: input.sessionId,
    });
    return true;
  } catch (cause) {
    const reconciled = await getPresentationRun(input);
    if (hasCompletedAudioStep(reconciled.run.status)) {
      return true;
    }
    if (reconciled.run.status === "uploading") {
      return false;
    }
    throw cause;
  }
}

function hasCompletedAudioStep(status: PresentationRuntimeIdentity["status"]) {
  return (
    status === "processing" || status === "succeeded" || status === "failed"
  );
}

async function putPresentationRecording(
  upload: AssetUploadUrlResponse,
  file: File,
) {
  const response = await fetch(upload.uploadUrl, {
    body: file,
    headers: upload.headers,
    method: upload.method,
  });
  if (!response.ok) {
    throw new Error("발표 녹음 파일을 업로드하지 못했습니다.");
  }
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { credentials: "include", ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : "실전 발표 요청을 처리하지 못했습니다.";
    throw new Error(message);
  }
  return payload;
}

async function readPresentationError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null);
  return payload && typeof payload === "object" && "message" in payload
    ? String(payload.message)
    : fallback;
}

function runsUrl(projectId: string, sessionId: string) {
  return `/api/v1/projects/${segment(projectId)}/presentation-sessions/${segment(sessionId)}/runs`;
}

function segment(value: string) {
  return encodeURIComponent(value);
}
