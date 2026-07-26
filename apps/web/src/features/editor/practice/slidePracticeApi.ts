import {
  createSlidePracticeAnalysisResponseSchema,
  slidePracticeAnalysisResultResponseSchema,
  slidePracticeReportListResponseSchema,
  slidePracticeReportRecordSchema,
  voiceBaselineRecordSchema,
  type CreateSlidePracticeReportRequest,
  type SlidePracticeReportListResponse,
  type VoiceBaselineMetrics,
  type VoiceBaselineRecord,
} from "@orbit/shared/slide-practice";
import { normalizeCoachingAudioMimeType } from "../../coaching/coachingAudioMimeType";

const pendingReportStoreName = "pending-reports";
const databaseName = "orbit-slide-practice";

export async function persistSlidePracticeReport(
  request: CreateSlidePracticeReportRequest,
) {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(request.report.projectId)}/slide-practice-reports`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!response.ok) throw new Error(await responseMessage(response, "연습 결과를 저장하지 못했습니다."));
  const payload = await response.json() as { report?: unknown };
  return slidePracticeReportRecordSchema.parse(payload.report);
}

export async function listSlidePracticeReports(input: {
  projectId: string;
  deckId?: string;
  slideId?: string;
  slideContentHash?: string;
  limit?: number;
}): Promise<SlidePracticeReportListResponse> {
  const search = new URLSearchParams();
  if (input.deckId) search.set("deckId", input.deckId);
  if (input.slideId) search.set("slideId", input.slideId);
  if (input.slideContentHash) search.set("slideContentHash", input.slideContentHash);
  search.set("limit", String(input.limit ?? 30));
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(input.projectId)}/slide-practice-reports?${search}`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error(await responseMessage(response, "연습 기록을 불러오지 못했습니다."));
  return slidePracticeReportListResponseSchema.parse(await response.json());
}

export async function submitSlidePracticeAudio(input: {
  projectId: string;
  practiceSessionId: string;
  deckId: string;
  deckVersion: number;
  slideId: string;
  slideOrder: number;
  slideContentHash: string;
  startedAt: string;
  deviceIdHash: string | null;
  blob: Blob;
  durationMs: number;
}) {
  const createResponse = await fetchWithNetworkError(
    `/api/v1/projects/${encodeURIComponent(input.projectId)}/slide-practice-analyses`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: crypto.randomUUID(),
        practiceSessionId: input.practiceSessionId,
        deckId: input.deckId,
        deckVersion: input.deckVersion,
        slideId: input.slideId,
        slideOrder: input.slideOrder,
        contentHashVersion: "slide-text-v1",
        slideContentHash: input.slideContentHash,
        startedAt: input.startedAt,
        mimeType: normalizeCoachingAudioMimeType(input.blob.type),
        size: input.blob.size,
        deviceIdHash: input.deviceIdHash,
      }),
    },
    "연습 분석 서버에 연결하지 못했습니다.",
  );
  if (!createResponse.ok) {
    throw new Error(await responseMessage(createResponse, "연습 분석을 준비하지 못했습니다."));
  }
  const created = createSlidePracticeAnalysisResponseSchema.parse(await createResponse.json());
  if (!created.upload) throw new Error("연습 녹음 업로드 정보를 찾지 못했습니다.");
  const uploadResponse = await fetchWithNetworkError(
    created.upload.uploadUrl,
    {
      method: created.upload.method,
      headers: created.upload.headers,
      body: input.blob,
    },
    "연습 녹음 업로드 서버에 연결하지 못했습니다.",
  );
  if (!uploadResponse.ok) throw new Error("연습 녹음을 업로드하지 못했습니다.");

  const completeResponse = await fetchWithNetworkError(
    `/api/v1/slide-practice-analyses/${encodeURIComponent(created.analysis.analysisId)}/audio/complete`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileId: created.upload.fileId,
        durationMs: input.durationMs,
      }),
    },
    "연습 분석 시작 요청을 보내지 못했습니다.",
  );
  if (!completeResponse.ok) {
    throw new Error(await responseMessage(completeResponse, "연습 분석을 시작하지 못했습니다."));
  }
  let result = slidePracticeAnalysisResultResponseSchema.parse(await completeResponse.json());
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (result.analysis.status === "succeeded") {
      if (result.report) return result.report;
      throw new Error("완료된 연습 분석 결과를 찾지 못했습니다.");
    }
    if (result.analysis.status === "failed" || result.analysis.status === "cancelled") {
      throw new Error("서버에서 연습 음성을 분석하지 못했습니다. 다시 시도해 주세요.");
    }
    await delay(1_000);
    const statusResponse = await fetchWithNetworkError(
      `/api/v1/slide-practice-analyses/${encodeURIComponent(created.analysis.analysisId)}`,
      { credentials: "include" },
      "연습 분석 상태 서버에 연결하지 못했습니다.",
    );
    if (!statusResponse.ok) {
      throw new Error(await responseMessage(statusResponse, "연습 분석 상태를 확인하지 못했습니다."));
    }
    result = slidePracticeAnalysisResultResponseSchema.parse(await statusResponse.json());
  }
  throw new Error("연습 분석 시간이 오래 걸리고 있습니다. 잠시 후 연습 기록에서 확인해 주세요.");
}

export async function getVoiceBaseline(deviceIdHash: string): Promise<VoiceBaselineRecord | null> {
  const response = await fetch(
    `/api/v1/users/me/voice-baselines/${encodeURIComponent(deviceIdHash)}`,
    { credentials: "include" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await responseMessage(response, "목소리 기준값을 불러오지 못했습니다."));
  const payload = await response.json() as { baseline?: unknown };
  return voiceBaselineRecordSchema.parse(payload.baseline);
}

export async function upsertVoiceBaseline(input: {
  deviceIdHash: string;
  sampleCount: number;
  metrics: VoiceBaselineMetrics;
}) {
  const response = await fetch(
    `/api/v1/users/me/voice-baselines/${encodeURIComponent(input.deviceIdHash)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) throw new Error(await responseMessage(response, "목소리 기준값을 저장하지 못했습니다."));
}

export async function enqueueOfflinePracticeReport(request: CreateSlidePracticeReportRequest) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(pendingReportStoreName, "readwrite");
    transaction.objectStore(pendingReportStoreName).put(request, request.clientRequestId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function flushOfflinePracticeReports() {
  if (!navigator.onLine || typeof indexedDB === "undefined") return 0;
  const database = await openDatabase();
  const records = await new Promise<CreateSlidePracticeReportRequest[]>((resolve, reject) => {
    const request = database.transaction(pendingReportStoreName).objectStore(pendingReportStoreName).getAll();
    request.onsuccess = () => resolve(request.result as CreateSlidePracticeReportRequest[]);
    request.onerror = () => reject(request.error);
  });
  let flushed = 0;
  for (const record of records) {
    try {
      await persistSlidePracticeReport(record);
      await deletePending(database, record.clientRequestId);
      flushed += 1;
    } catch {
      break;
    }
  }
  database.close();
  return flushed;
}

export async function getStableDeviceIdHash() {
  const storageKey = "orbit.slide-practice.device-id.v1";
  let deviceId = localStorage.getItem(storageKey);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(storageKey, deviceId);
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceId));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(pendingReportStoreName)) {
        request.result.createObjectStore(pendingReportStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deletePending(database: IDBDatabase, key: string) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(pendingReportStoreName, "readwrite");
    transaction.objectStore(pendingReportStoreName).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { message?: string };
    return payload.message || fallback;
  } catch {
    return fallback;
  }
}

function delay(durationMs: number) {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}

async function fetchWithNetworkError(
  input: RequestInfo | URL,
  init: RequestInit,
  message: string,
) {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error(message);
  }
}
