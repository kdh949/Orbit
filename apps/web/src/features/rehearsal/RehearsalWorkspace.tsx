import {
  createSlidePlaybackState,
  type SlidePlaybackState,
} from "@orbit/editor-core";
import {
  demoIds,
  type AssetUploadUrlResponse,
  type CompleteRehearsalAudioUploadResponse,
  type CreateRehearsalAudioUploadUrlResponse,
  type CreateRehearsalRunResponse,
  type Deck,
  type DeckElement,
  type GetRehearsalReportResponse,
  type GetDeckResponse,
  type Job,
  type Keyword,
  type LiveSttAnimationCueEvent,
  type LiveSttKeywordDetectedEvent,
  type LiveSttPartialTranscriptEvent,
  type LiveSttSlideAdvanceEvent,
  type PutDeckResponse,
  type RehearsalReport,
  type RehearsalRun,
  type RehearsalRunMeta,
  type Slide,
  type UpdateRehearsalRunMetaRequest,
} from "@orbit/shared";
import {
  BarChart3,
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Download,
  Gauge,
  Home,
  Mic,
  Monitor,
  MoreHorizontal,
  PlayCircle,
  Presentation,
  RotateCcw,
  Save,
  Square,
  Target,
  Volume2,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LiveSttAdapterError,
  type LiveSttAdapter,
  type LiveSttAudioLevelEvent,
  type LiveSttBiasContext,
  type LiveSttBiasMode,
  type LiveSttBiasSource,
  type LiveSttBiasTerm,
  type LiveSttDecodingMethod,
} from "./liveStt";
import {
  isLiveSttPcmDebugEnabled,
  type LiveSttDebugPcmRecording,
} from "./liveSttPcmDebug";
import {
  confirmRehearsalCommandCandidate,
  createRehearsalCommandConfirmationState,
  defaultRehearsalCommandConfig,
  detectRehearsalCommandCandidate,
  getRehearsalCommandBiasTerms,
  type RehearsalCommandCandidate,
  type RehearsalCommandDefinition,
} from "./rehearsalCommands";
import {
  LiveSttError,
  type LiveSttBiasPhrase,
  type LiveSttEngineId,
  type LiveSttPort,
  type LiveSttResult,
} from "./stt/liveSttPort";
import { createLiveSttPort } from "./stt/liveSttEngineRegistry";
import { normalizeLiveTranscriptText } from "./stt/liveTranscriptText";
import { SherpaLiveSttPort } from "./stt/sherpaLiveSttPort";
import {
  resolveCueTriggeredActions,
  resolveKeywordTriggeredActions,
  getTriggerAnimationIdsForSlide,
  resolveTriggeredActionPlaybackUpdate,
} from "./playback/triggeredActionPlayback";
import {
  DisplayControls,
  type RequestDisplayScreensResult,
  type RequestSlideWindowFullscreenResult,
  type SlideDisplayOptions,
} from "./presenter/DisplayControls";
import {
  PresentWindowReceiver,
  requestPresentWindowFullscreen,
} from "./presenter/PresentWindow";
import { PresenterRemoteWindow } from "./presenter/PresenterRemoteWindow";
import {
  createDisplayManager,
  type DisplayManagerErrorCode,
  type DisplayScreenDescriptor,
  type SlideWindowRef,
} from "./presenter/displayManager";
import { SingleScreenPresenter } from "./presenter/SingleScreenPresenter";
import { SlideshowRenderer } from "./presenter/SlideshowRenderer";
import { createSlideshowAnimationPlan } from "./presenter/slideshowStepModel";
import { getNextPresenterStepState } from "./presenter/presenterStepNavigation";
import {
  createSlideWindowDeckSnapshot,
  type PresenterRemoteCommand,
} from "./presenter/presentationChannel";
import { usePresentationChannelPublisher } from "./presenter/usePresentationChannelPublisher";
import { usePresenterKeyboard } from "./presenter/usePresenterKeyboard";
import { AutoAdvanceSettings } from "./advance/AutoAdvanceSettings";
import { AutoAdvanceStatus } from "./advance/AutoAdvanceStatus";
import { defaultAutoAdvanceConfig } from "./advance/autoAdvanceConfig";
import {
  cancelAdvanceCountdown,
  createInitialAdvanceControllerState,
  evaluateAdvanceController,
  resetAdvanceControllerForSlide,
  type AdvanceControllerState,
} from "./advance/advanceController";
import {
  RehearsalPanel,
  getRehearsalScriptFocusSentenceId,
} from "./panel/RehearsalPanel";
import {
  calculateFinalTranscriptWpm,
  getDeckTargetSeconds as getRehearsalDeckTargetSeconds,
  getTimingAdviceState,
  type RehearsalTimingSnapshot,
} from "./panel/rehearsalTiming";
import { usePresenterSettings } from "./settings/presenterSettings";
import { createDefaultPhraseExtractor } from "./speech/phraseExtractor";
import {
  createP3RehearsalSession,
  type P3RehearsalSession,
  type P3RehearsalSessionState,
} from "./speech/p3RehearsalSession";
import {
  createPauseDetector,
  type PauseDetector,
  type PauseDetectorEvent,
  type PauseDetectorSnapshot,
} from "./speech/pauseDetector";
import { defaultSpeechTrackingConfig } from "./speech/speechTrackingConfig";
import type {
  ExtractedSentence,
  SpeechTrackerSnapshot,
  SpeechTrackingEvent,
} from "./speech/speechTrackingEvents";

export {
  LiveSttAdapterError,
  type LiveSttAdapter,
  type LiveSttAudioLevelEvent,
  type LiveSttCallbacks,
} from "./liveStt";
export {
  SherpaLiveSttAdapter,
  SherpaOnnxLiveSttAdapter,
  resampleFloat32Audio,
} from "./sherpaOnnxLiveSttAdapter";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type RehearsalPhase =
  | "idle"
  | "loading"
  | "recording"
  | "uploading"
  | "processing"
  | "succeeded"
  | "failed";
type RehearsalTimeMode = "stopwatch" | "timer";
type RehearsalFlowStage =
  | "deck"
  | "run"
  | "upload-url"
  | "storage-put"
  | "meta"
  | "complete"
  | "job-poll"
  | "run-fetch"
  | "report-fetch";
type LiveSttStatus =
  | "idle"
  | "starting"
  | "listening"
  | "unavailable"
  | "failed"
  | "stopped";
type RehearsalReportStatus =
  | "idle"
  | "loading"
  | "ready"
  | "not-ready"
  | "failed";

type RecordingSession = {
  recorder: MediaRecorder;
  start: () => void;
  stop: () => void;
};

type LiveKeywordCandidate = {
  keyword: Keyword;
  aliases: string[];
};

type LiveTranscriptAnalysis = {
  slideId: string;
  transcript: string;
  coverage: number;
  detectedKeywords: LiveSttKeywordDetectedEvent[];
  missingKeywordIds: string[];
};

type LiveTranscriptBuffer = {
  committedTranscript: string;
  draftTranscript: string;
};

type BiasTermDraft = Omit<LiveSttBiasTerm, "text"> & { text: string };

const preferredAudioMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];
export const rehearsalMicrophoneAudioConstraints: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};
export const rehearsalRawMicrophoneAudioConstraints: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};
const liveSttBiasModeStorageKey = "orbit.liveStt.biasMode";
const liveSttRawMicDebugStorageKey = "orbit.liveStt.debugRawMic";
const liveSttDebugDecodingMethodStorageKey =
  "orbit.liveStt.debugDecodingMethod";
const rehearsalPracticeSummaryStoragePrefix = "orbit.rehearsal.lastSummary";
const maxLiveSttBiasTerms = 32;
const maxLiveSttContextBiasTermLength = 36;

type RehearsalPracticeSummary = {
  completedAt: string;
  coveragePercent: number;
  deckId: string;
  durationSeconds: number;
  missedKeywordCount: number;
  projectId: string;
  targetSeconds: number;
};

export class RehearsalFlowError extends Error {
  constructor(
    readonly stage: RehearsalFlowStage,
    message: string,
  ) {
    super(message);
    this.name = "RehearsalFlowError";
  }
}

export async function fetchRehearsalDeck(
  projectId: string = demoIds.projectId,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(`/api/v1/projects/${projectId}/deck`);
  if (!response.ok) {
    throw new RehearsalFlowError(
      "deck",
      await readErrorMessage(
        response,
        "諛쒗몴?먮즺瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??",
      ),
    );
  }

  const payload = (await response.json()) as GetDeckResponse;
  return payload.deck;
}

export async function fetchOrCreateRehearsalDeck(
  options: {
    projectId?: string;
    fallbackDeck?: Deck;
    fetcher?: Fetcher;
  } = {},
) {
  const projectId =
    options.projectId ?? options.fallbackDeck?.projectId ?? demoIds.projectId;
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(`/api/v1/projects/${projectId}/deck`);

  if (response.ok) {
    const payload = (await response.json()) as GetDeckResponse;
    return payload.deck;
  }

  if (response.status === 404 && options.fallbackDeck) {
    const putResponse = await fetcher(`/api/v1/projects/${projectId}/deck`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deck: options.fallbackDeck,
        snapshotReason: "deck-replaced",
      }),
    });

    if (!putResponse.ok) {
      throw new RehearsalFlowError(
        "deck",
        await readErrorMessage(
          putResponse,
          "由ы뿀??諛쒗몴?먮즺瑜?珥덇린?뷀븯吏 紐삵뻽?듬땲??",
        ),
      );
    }

    const payload = (await putResponse.json()) as PutDeckResponse;
    return payload.deck;
  }

  if (
    options.fallbackDeck &&
    (response.status === 401 || response.status === 403)
  ) {
    return options.fallbackDeck;
  }

  throw new RehearsalFlowError(
    "deck",
    await readErrorMessage(response, "諛쒗몴?먮즺瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??"),
  );
}

export async function createRehearsalRun(
  projectId: string,
  deckId: string,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(`/api/v1/projects/${projectId}/rehearsals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deckId }),
  });

  if (!response.ok) {
    throw new RehearsalFlowError(
      "run",
      await readErrorMessage(response, "由ы뿀??run??留뚮뱾吏 紐삵뻽?듬땲??"),
    );
  }

  return (await response.json()) as CreateRehearsalRunResponse;
}

export async function requestRehearsalAudioUploadUrl(
  runId: string,
  file: File,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(
    `/api/v1/rehearsals/${runId}/audio/upload-url`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        originalName: file.name,
        mimeType: file.type || "audio/webm",
        size: file.size,
      }),
    },
  );

  if (!response.ok) {
    throw new RehearsalFlowError(
      "upload-url",
      await readErrorMessage(
        response,
        "由ы뿀???ㅻ뵒???낅줈??URL??諛쒓툒?섏? 紐삵뻽?듬땲??",
      ),
    );
  }

  return (await response.json()) as CreateRehearsalAudioUploadUrlResponse;
}

export async function uploadRehearsalAudio(
  upload: AssetUploadUrlResponse,
  file: File,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(upload.uploadUrl, {
    method: upload.method,
    headers: upload.headers,
    body: file,
  });

  if (!response.ok) {
    throw new RehearsalFlowError(
      "storage-put",
      await readErrorMessage(
        response,
        "由ы뿀???ㅻ뵒???낅줈?쒓? 以묐떒?섏뿀?듬땲??",
      ),
    );
  }
}

export async function completeRehearsalAudioUpload(
  runId: string,
  fileId: string,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(`/api/v1/rehearsals/${runId}/audio/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileId }),
  });

  if (!response.ok) {
    throw new RehearsalFlowError(
      "complete",
      await readErrorMessage(
        response,
        "由ы뿀??STT ?묒뾽???쒖옉?섏? 紐삵뻽?듬땲??",
      ),
    );
  }

  return (await response.json()) as CompleteRehearsalAudioUploadResponse;
}

export async function updateRehearsalRunMeta(
  runId: string,
  meta: UpdateRehearsalRunMetaRequest,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(`/api/v1/rehearsals/${runId}/meta`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(meta),
  });

  if (!response.ok) {
    throw new RehearsalFlowError(
      "meta",
      await readErrorMessage(
        response,
        "리허설 진행 메타데이터를 저장하지 못했습니다.",
      ),
    );
  }
}

export async function fetchRehearsalRun(
  runId: string,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(`/api/v1/rehearsals/${runId}`);
  if (!response.ok) {
    throw new RehearsalFlowError(
      "run-fetch",
      await readErrorMessage(
        response,
        "由ы뿀??run ?곹깭瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??",
      ),
    );
  }

  const payload = (await response.json()) as { run: RehearsalRun };
  return payload.run;
}

export async function fetchRehearsalReport(
  runId: string,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(`/api/v1/rehearsals/${runId}/report`);
  if (!response.ok) {
    throw new RehearsalFlowError(
      "report-fetch",
      await readErrorMessage(response, "리허설 보고서를 불러오지 못했습니다."),
    );
  }

  return (await response.json()) as GetRehearsalReportResponse;
}

export function resolveRehearsalReportLoadState(
  response: GetRehearsalReportResponse,
  requestedProjectId: string,
): { error: string; status: RehearsalReportStatus } {
  if (response.run.projectId !== requestedProjectId) {
    return {
      error: "요청한 프로젝트와 리허설 실행 정보가 일치하지 않습니다.",
      status: "failed",
    };
  }

  if (response.run.status === "failed") {
    return {
      error: response.run.error?.message || "리허설 분석 작업이 실패했습니다.",
      status: "failed",
    };
  }

  return {
    error: "",
    status: response.report ? "ready" : "not-ready",
  };
}

export function getRehearsalReportPath(projectId: string, runId: string) {
  return `/rehearsal/${encodeURIComponent(projectId)}/report/${encodeURIComponent(runId)}`;
}

export function getRehearsalPresenterWindowPath(
  projectId: string,
  sessionId: string,
  state?: { slideIndex?: number; stepIndex?: number },
) {
  const params = new URLSearchParams({
    presenterSessionId: sessionId,
    presenterWindow: "1",
  });
  if (typeof state?.slideIndex === "number") {
    params.set("slideIndex", String(Math.max(0, Math.floor(state.slideIndex))));
  }
  if (typeof state?.stepIndex === "number") {
    params.set("stepIndex", String(Math.max(0, Math.floor(state.stepIndex))));
  }

  return `/rehearsal/${encodeURIComponent(projectId)}?${params.toString()}`;
}

function getCurrentRehearsalPresenterWindowPath(
  sessionId: string,
  state: { slideIndex: number; stepIndex: number },
) {
  if (typeof window === "undefined") {
    return `?presenterSessionId=${encodeURIComponent(sessionId)}&presenterWindow=1&slideIndex=${state.slideIndex}&stepIndex=${state.stepIndex}`;
  }

  const params = new URLSearchParams(window.location.search);
  params.set("presenterSessionId", sessionId);
  params.set("presenterWindow", "1");
  params.set("slideIndex", String(Math.max(0, Math.floor(state.slideIndex))));
  params.set("stepIndex", String(Math.max(0, Math.floor(state.stepIndex))));
  return `${window.location.pathname}?${params.toString()}`;
}

export function getRehearsalFinishPath(
  projectId: string,
  run: Pick<RehearsalRun, "runId" | "status"> | null,
) {
  if (run?.runId) {
    return getRehearsalReportPath(projectId, run.runId);
  }

  return `/project/${encodeURIComponent(projectId)}`;
}

export function resetRehearsalTimerState(actions: {
  setElapsedSeconds: (value: number) => void;
  setSlideElapsedSeconds: (value: number) => void;
  setIsTimerRunning: (value: boolean) => void;
}) {
  actions.setElapsedSeconds(0);
  actions.setSlideElapsedSeconds(0);
  actions.setIsTimerRunning(false);
}

export function shouldRenderRehearsalThumbnailImage(
  thumbnailUrl: string,
  failedThumbnailUrls: ReadonlySet<string>,
) {
  return Boolean(thumbnailUrl && !failedThumbnailUrls.has(thumbnailUrl));
}

export async function pollRehearsalJob(
  jobId: string,
  options: {
    delayMs?: number;
    fetcher?: Fetcher;
    onUpdate?: (job: Job) => void;
    timeoutMs?: number;
  } = {},
) {
  const delayMs = options.delayMs ?? 1000;
  const fetcher = options.fetcher ?? fetch;
  const timeoutAt = Date.now() + (options.timeoutMs ?? 120_000);

  for (;;) {
    const response = await fetcher(`/api/jobs/${jobId}`);
    if (!response.ok) {
      throw new RehearsalFlowError(
        "job-poll",
        await readErrorMessage(
          response,
          "由ы뿀???묒뾽 ?곹깭瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??",
        ),
      );
    }

    const job = (await response.json()) as Job;
    options.onUpdate?.(job);
    if (job.status === "succeeded" || job.status === "failed") {
      return job;
    }

    if (Date.now() > timeoutAt) {
      throw new RehearsalFlowError(
        "job-poll",
        "由ы뿀???묒뾽???쒓컙 ?댁뿉 ?앸굹吏 ?딆븯?듬땲??",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export async function runRehearsalUploadFlow(options: {
  projectId: string;
  deckId: string;
  audioFile: File;
  fetcher?: Fetcher;
  onJobUpdate?: (job: Job) => void;
  pollDelayMs?: number;
  pollTimeoutMs?: number;
  runMeta?: RehearsalRunMeta | null;
  slideTimeline?: UpdateRehearsalRunMetaRequest["slideTimeline"];
}) {
  const fetcher = options.fetcher ?? fetch;
  const created = await createRehearsalRun(
    options.projectId,
    options.deckId,
    fetcher,
  );
  const uploadResponse = await requestRehearsalAudioUploadUrl(
    created.run.runId,
    options.audioFile,
    fetcher,
  );

  await uploadRehearsalAudio(uploadResponse.upload, options.audioFile, fetcher);

  const runMeta =
    options.runMeta ??
    (options.slideTimeline?.length
      ? {
          slideTimeline: options.slideTimeline,
          missedKeywords: [],
          adviceEvents: [],
        }
      : null);

  if (
    runMeta &&
    (runMeta.slideTimeline.length > 0 ||
      runMeta.missedKeywords.length > 0 ||
      runMeta.adviceEvents.length > 0)
  ) {
    try {
      await updateRehearsalRunMeta(created.run.runId, runMeta, fetcher);
    } catch {
      // Report generation can continue without optional slide timing metadata.
    }
  }

  const completed = await completeRehearsalAudioUpload(
    created.run.runId,
    uploadResponse.upload.fileId,
    fetcher,
  );
  const job = await pollRehearsalJob(completed.job.jobId, {
    fetcher,
    delayMs: options.pollDelayMs,
    timeoutMs: options.pollTimeoutMs,
    onUpdate: options.onJobUpdate,
  });
  const run = await fetchRehearsalRun(created.run.runId, fetcher);

  return { run, job };
}

export function selectRecordingMimeType(
  recorderCtor: typeof MediaRecorder | undefined = globalThis.MediaRecorder,
) {
  if (!recorderCtor) {
    return null;
  }

  if (typeof recorderCtor.isTypeSupported !== "function") {
    return "audio/webm";
  }

  return (
    preferredAudioMimeTypes.find((mimeType) =>
      recorderCtor.isTypeSupported(mimeType),
    ) ?? "audio/webm"
  );
}

export function createRecordingFile(
  blob: Blob,
  mimeType: string,
  now: Date = new Date(),
) {
  const normalizedMimeType = normalizeRecordingMimeType(mimeType || blob.type);
  const safeTimestamp = now.toISOString().replace(/[:.]/g, "-");
  return new File(
    [blob],
    `rehearsal-${safeTimestamp}.${extensionForMimeType(normalizedMimeType)}`,
    {
      type: normalizedMimeType,
    },
  );
}

export function normalizeRecordingMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() || "audio/webm";
}

export function createRecordingSession(
  stream: MediaStream,
  options: {
    recorderCtor?: typeof MediaRecorder;
    now?: () => Date;
    onError: (error: Error) => void;
    onStop: (file: File) => void;
  },
): RecordingSession {
  const Recorder = options.recorderCtor ?? globalThis.MediaRecorder;
  const mimeType = selectRecordingMimeType(Recorder);
  if (!Recorder || !mimeType) {
    throw new Error("MediaRecorder is not supported.");
  }

  const recorder = new Recorder(stream, { mimeType });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };
  recorder.onerror = () => {
    options.onError(new Error("?뱀쓬 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎."));
  };
  recorder.onstop = () => {
    if (chunks.length === 0) {
      options.onError(new Error("?뱀쓬???ㅻ뵒?ㅺ? 鍮꾩뼱 ?덉뒿?덈떎."));
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    options.onStop(
      createRecordingFile(blob, mimeType, options.now?.() ?? new Date()),
    );
  };

  return {
    recorder,
    start: () => recorder.start(),
    stop: () => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    },
  };
}

export function getLiveSttBiasMode(): LiveSttBiasMode {
  if (typeof window === "undefined") {
    return "combined";
  }

  try {
    const value = window.localStorage?.getItem(liveSttBiasModeStorageKey);
    return isLiveSttBiasMode(value) ? value : "combined";
  } catch {
    return "combined";
  }
}

export function buildLiveSttBiasContext(
  slide: Slide,
  options: {
    nearbySlides?: Slide[];
    commandConfig?: RehearsalCommandDefinition[];
  } = {},
): LiveSttBiasContext {
  const terms = new Map<string, LiveSttBiasTerm>();
  const addTerm = (draft: BiasTermDraft) => {
    const text = normalizeBiasTermText(draft.text);
    const normalized = normalizeLiveTranscriptText(text);
    if (!text || !normalized) {
      return;
    }
    if (
      !isKeywordBiasSource(draft.source) &&
      normalized.length > maxLiveSttContextBiasTermLength
    ) {
      return;
    }

    const existing = terms.get(normalized);
    const next: LiveSttBiasTerm = { ...draft, text };
    if (!existing || existing.weight < next.weight) {
      terms.set(normalized, next);
    }
  };

  for (const keyword of slide.keywords) {
    addTerm({
      text: keyword.text,
      source: "keyword",
      weight: 1,
      keywordId: keyword.keywordId,
      canonicalText: keyword.text,
    });
    for (const synonym of keyword.synonyms) {
      addTerm({
        text: synonym,
        source: "synonym",
        weight: 0.95,
        keywordId: keyword.keywordId,
        canonicalText: keyword.text,
      });
    }
    for (const abbreviation of keyword.abbreviations) {
      addTerm({
        text: abbreviation,
        source: "abbreviation",
        weight: 0.9,
        keywordId: keyword.keywordId,
        canonicalText: keyword.text,
      });
    }
  }

  addTerm({ text: getSlideTitle(slide), source: "title", weight: 0.7 });

  for (const text of getSlideBodyTexts(slide)) {
    addTerm({ text, source: "slide-text", weight: 0.55 });
    for (const extracted of extractBiasTermsFromText(text)) {
      addTerm({ text: extracted, source: "slide-text", weight: 0.5 });
    }
  }

  for (const extracted of extractBiasTermsFromText(slide.speakerNotes)) {
    addTerm({ text: extracted, source: "speaker-notes", weight: 0.45 });
  }

  for (const nearbySlide of options.nearbySlides ?? []) {
    if (nearbySlide.slideId === slide.slideId) {
      continue;
    }

    addTerm({
      text: getSlideTitle(nearbySlide),
      source: "nearby-slide-text",
      weight: 0.35,
    });
    for (const text of getSlideBodyTexts(nearbySlide)) {
      for (const extracted of extractBiasTermsFromText(text)) {
        addTerm({
          text: extracted,
          source: "nearby-slide-text",
          weight: 0.3,
        });
      }
    }
  }

  for (const term of getRehearsalCommandBiasTerms(
    options.commandConfig ?? defaultRehearsalCommandConfig,
  )) {
    addTerm(term);
  }

  const sortedTerms = Array.from(terms.values()).sort(compareBiasTerms);
  const controlTerms = sortedTerms.filter(
    (term) => term.source === "control-phrase",
  );
  const otherTerms = sortedTerms.filter(
    (term) => term.source !== "control-phrase",
  );
  const reservedControlTerms = controlTerms.slice(0, maxLiveSttBiasTerms);
  const remainingSlots = Math.max(
    0,
    maxLiveSttBiasTerms - reservedControlTerms.length,
  );
  const selectedTerms = [
    ...otherTerms.slice(0, remainingSlots),
    ...reservedControlTerms,
  ].sort(compareBiasTerms);

  return {
    slideId: slide.slideId,
    terms: selectedTerms,
  };
}

export function applyLiveTranscriptBias(
  transcript: string,
  biasContext: LiveSttBiasContext | null | undefined,
) {
  if (!biasContext || biasContext.terms.length === 0) {
    return transcript;
  }

  const normalizedTranscript = normalizeLiveTranscriptText(transcript);
  if (!normalizedTranscript) {
    return transcript;
  }

  const additions: string[] = [];
  const seenAdditions = new Set<string>();
  for (const term of biasContext.terms) {
    if (!term.keywordId || term.weight < 0.85) {
      continue;
    }

    const normalizedTerm = normalizeLiveTranscriptText(term.text);
    if (
      normalizedTerm.length < 3 ||
      normalizedTranscript.includes(normalizedTerm) ||
      !hasFuzzyBiasMatch(transcript, normalizedTerm)
    ) {
      continue;
    }

    const addition = normalizeBiasTermText(term.canonicalText ?? term.text);
    const additionKey = normalizeLiveTranscriptText(addition);
    if (addition && !seenAdditions.has(additionKey)) {
      seenAdditions.add(additionKey);
      additions.push(addition);
    }
  }

  return appendLiveTranscriptText(transcript, additions.join(" "));
}

export function createLiveTranscriptBuffer(): LiveTranscriptBuffer {
  return {
    committedTranscript: "",
    draftTranscript: "",
  };
}

export function applyLiveTranscriptEvent(
  buffer: LiveTranscriptBuffer,
  event: Pick<LiveSttPartialTranscriptEvent, "transcript" | "isFinal">,
): LiveTranscriptBuffer {
  const transcript = normalizeLiveTranscriptDisplayText(event.transcript);

  if (event.isFinal) {
    return {
      committedTranscript: appendLiveTranscriptText(
        buffer.committedTranscript,
        transcript,
      ),
      draftTranscript: "",
    };
  }

  return {
    ...buffer,
    draftTranscript: transcript,
  };
}

export function renderLiveTranscriptBuffer(buffer: LiveTranscriptBuffer) {
  return appendLiveTranscriptText(
    buffer.committedTranscript,
    buffer.draftTranscript,
  );
}

function appendLiveTranscriptText(current: string, next: string) {
  return [current, next]
    .map(normalizeLiveTranscriptDisplayText)
    .filter((part) => part.length > 0)
    .join(" ");
}

function normalizeLiveTranscriptDisplayText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function evaluateLiveTranscript(
  slide: Slide,
  transcript: string,
): LiveTranscriptAnalysis {
  const candidates = getLiveKeywordCandidates(slide);
  const normalizedTranscript = normalizeLiveTranscriptText(transcript);
  const detectedKeywords = candidates.flatMap((candidate) => {
    const matchedText = candidate.aliases.find((alias) => {
      const normalizedAlias = normalizeLiveTranscriptText(alias);
      return normalizedAlias && normalizedTranscript.includes(normalizedAlias);
    });

    if (!matchedText) {
      return [];
    }

    return [
      {
        type: "keyword-detected" as const,
        slideId: slide.slideId,
        keywordId: candidate.keyword.keywordId,
        text: candidate.keyword.text,
        matchedText,
        coverage: 0,
      },
    ];
  });
  const coverage =
    candidates.length === 0 ? 0 : detectedKeywords.length / candidates.length;
  const missingKeywordIds = candidates
    .filter(
      (candidate) =>
        !detectedKeywords.some(
          (event) => event.keywordId === candidate.keyword.keywordId,
        ),
    )
    .map((candidate) => candidate.keyword.keywordId);

  return {
    slideId: slide.slideId,
    transcript,
    coverage,
    detectedKeywords: detectedKeywords.map((event) => ({
      ...event,
      coverage,
    })),
    missingKeywordIds,
  };
}

export function getLiveAudioLevelLabel(level: LiveSttAudioLevelEvent | null) {
  if (!level) {
    return "입력 대기";
  }

  if (level.peakDb > -3) {
    return "입력 과대";
  }

  return level.isLikelySilence ? "입력 낮음" : "입력 적정";
}

export function getLiveAudioLevelPercent(level: LiveSttAudioLevelEvent | null) {
  if (!level) {
    return 0;
  }

  return clamp(((level.rmsDb + 55) / 55) * 100, 0, 100);
}

export function requestRehearsalMicrophoneStream(
  mediaDevices: Pick<MediaDevices, "getUserMedia"> = navigator.mediaDevices,
) {
  return mediaDevices.getUserMedia({
    audio: getRehearsalMicrophoneAudioConstraints(),
  });
}

export function getRehearsalMicrophoneAudioConstraints(
  storage: Pick<Storage, "getItem"> | null = readBrowserLocalStorage(),
) {
  return isLiveSttRawMicDebugEnabled(storage)
    ? rehearsalRawMicrophoneAudioConstraints
    : rehearsalMicrophoneAudioConstraints;
}

export function isLiveSttRawMicDebugEnabled(
  storage: Pick<Storage, "getItem"> | null = readBrowserLocalStorage(),
) {
  try {
    return storage?.getItem(liveSttRawMicDebugStorageKey) === "1";
  } catch {
    return false;
  }
}

export function getLiveSttDebugDecodingMethod(
  storage: Pick<Storage, "getItem"> | null = readBrowserLocalStorage(),
): LiveSttDecodingMethod | null {
  try {
    const value = storage?.getItem(liveSttDebugDecodingMethodStorageKey);
    return isLiveSttDecodingMethod(value) ? value : null;
  } catch {
    return null;
  }
}

export function shouldShowLiveSttDebugPcmDownload(
  recording: LiveSttDebugPcmRecording | null,
  storage: Pick<Storage, "getItem"> | null = readBrowserLocalStorage(),
) {
  return Boolean(recording) && isLiveSttPcmDebugEnabled(storage);
}

export function downloadLiveSttDebugPcm(recording: LiveSttDebugPcmRecording) {
  const url = URL.createObjectURL(recording.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = recording.filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getLiveKeywordCandidates(slide: Slide): LiveKeywordCandidate[] {
  return slide.keywords.map((keyword) => ({
    keyword,
    aliases: [
      keyword.text,
      ...keyword.synonyms,
      ...keyword.abbreviations,
    ].filter((value) => value.trim().length > 0),
  }));
}

function isLiveSttBiasMode(value: unknown): value is LiveSttBiasMode {
  return (
    value === "none" ||
    value === "postprocess" ||
    value === "hotword" ||
    value === "combined"
  );
}

function isLiveSttDecodingMethod(
  value: unknown,
): value is LiveSttDecodingMethod {
  return value === "greedy_search" || value === "modified_beam_search";
}

function readBrowserLocalStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function shouldUseLiveSttPostprocessBias(mode: LiveSttBiasMode) {
  return mode === "postprocess" || mode === "combined";
}

function normalizeBiasTermText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractBiasTermsFromText(value: string) {
  const terms = new Set<string>();
  const text = normalizeBiasTermText(value);
  if (!text) {
    return [];
  }

  for (const match of text.matchAll(
    /["'([{<]([^"'()[\]{}<>]{2,40})["'\])}>]/g,
  )) {
    addExtractedBiasTerm(terms, match[1] ?? "");
  }

  for (const match of text.matchAll(
    /[A-Za-z][A-Za-z0-9.+#-]*(?:\s+[A-Za-z][A-Za-z0-9.+#-]*){0,3}/g,
  )) {
    addExtractedBiasTerm(terms, match[0]);
  }

  for (const segment of text.split(/[\n\r,.;:!?，。！？、•·|/]+/)) {
    addExtractedBiasTerm(terms, segment);
  }

  return Array.from(terms);
}

function addExtractedBiasTerm(terms: Set<string>, value: string) {
  const term = normalizeBiasTermText(value);
  const normalized = normalizeLiveTranscriptText(term);
  if (
    normalized.length >= 3 &&
    normalized.length <= 24 &&
    /[A-Za-z0-9\u3131-\uD79D]/.test(term)
  ) {
    terms.add(term);
  }
}

function compareBiasTerms(left: LiveSttBiasTerm, right: LiveSttBiasTerm) {
  const weightDelta = right.weight - left.weight;
  if (weightDelta !== 0) {
    return weightDelta;
  }

  const sourceDelta =
    biasSourcePriority(right.source) - biasSourcePriority(left.source);
  if (sourceDelta !== 0) {
    return sourceDelta;
  }

  return right.text.length - left.text.length;
}

function biasSourcePriority(source: LiveSttBiasSource) {
  switch (source) {
    case "keyword":
      return 6;
    case "synonym":
      return 5;
    case "abbreviation":
      return 4;
    case "title":
      return 3;
    case "slide-text":
      return 2;
    case "speaker-notes":
      return 1;
    case "nearby-slide-text":
      return 0;
    case "control-phrase":
      return 7;
  }
}

function isKeywordBiasSource(source: LiveSttBiasSource) {
  return (
    source === "keyword" || source === "synonym" || source === "abbreviation"
  );
}

function hasFuzzyBiasMatch(transcript: string, normalizedTerm: string) {
  const normalizedTermText = normalizedTerm.normalize("NFC");
  const term = normalizeBiasDistanceText(normalizedTermText);
  const maxDistance = maxBiasTermDistance(normalizedTermText);
  if (maxDistance === 0) {
    return false;
  }

  for (const candidateText of extractFuzzyBiasCandidates(transcript)) {
    const candidate = normalizeBiasDistanceText(candidateText);
    if (
      !candidate ||
      isStrictPrefixBiasCandidate(candidate, term) ||
      Math.abs(candidate.length - term.length) > maxDistance ||
      levenshteinDistance(candidate, term) > maxDistance
    ) {
      continue;
    }

    return true;
  }

  return false;
}

function normalizeBiasDistanceText(value: string) {
  return value.normalize("NFD");
}

function extractFuzzyBiasCandidates(transcript: string) {
  return Array.from(
    new Set(
      transcript
        .split(/[^\p{L}\p{N}.+#-]+/u)
        .map(normalizeLiveTranscriptText)
        .map((value) => value.normalize("NFC"))
        .filter((value) => value.length > 0),
    ),
  );
}

function isStrictPrefixBiasCandidate(candidate: string, term: string) {
  return candidate.length < term.length && term.startsWith(candidate);
}

function maxBiasTermDistance(term: string) {
  const length = Array.from(term.normalize("NFC")).length;
  if (/^[a-z0-9]+$/i.test(term) && length < 5) {
    return 0;
  }

  if (length <= 4) {
    return 2;
  }

  if (length <= 8) {
    return 1;
  }

  if (length <= 12) {
    return 2;
  }

  return 3;
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) {
    return 0;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        previous[rightIndex - 1]! + substitutionCost,
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[right.length] ?? 0;
}

function createDefaultLiveSttPort(
  options: {
    engineId?: LiveSttEngineId;
    legacyAdapter?: LiveSttAdapter;
    onAudioLevel?: (event: LiveSttAudioLevelEvent) => void;
    onDebugPcmAvailable?: (recording: LiveSttDebugPcmRecording) => void;
    getDecodingMethod?: () => LiveSttDecodingMethod | null;
    projectId?: string;
  } = {},
) {
  const {
    engineId,
    legacyAdapter,
    onAudioLevel,
    onDebugPcmAvailable,
    getDecodingMethod,
    projectId,
  } = options;
  const sherpaOptions = {
    onAudioLevel,
    onDebugPcmAvailable,
    getDecodingMethod,
  };
  const shouldUseSherpaCompatibility = !engineId || engineId === "sherpa";

  if (shouldUseSherpaCompatibility && legacyAdapter) {
    return new SherpaLiveSttPort({ ...sherpaOptions, adapter: legacyAdapter });
  }

  if (shouldUseSherpaCompatibility) {
    const windowAdapter = window.__orbitCreateLiveSttAdapter?.();
    if (windowAdapter) {
      return new SherpaLiveSttPort({
        ...sherpaOptions,
        adapter: windowAdapter,
      });
    }
    return new SherpaLiveSttPort(sherpaOptions);
  }

  return createLiveSttPort(engineId, {
    onAudioLevel,
    projectId,
  });
}

function readLiveSttPortProjectId(port: LiveSttPort) {
  return "projectId" in port && typeof port.projectId === "string"
    ? port.projectId
    : null;
}

export function RehearsalWorkspace(props: {
  initialDeck?: Deck;
  fallbackDeck?: Deck;
  liveSttAdapter?: LiveSttAdapter;
  liveSttPort?: LiveSttPort;
  presenterInitialSlideIndex?: number;
  presenterInitialStepIndex?: number;
  presenterSessionId?: string;
  presenterWindow?: boolean;
  projectId?: string;
}) {
  const [deck, setDeck] = useState<Deck | null>(props.initialDeck ?? null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(
    props.presenterInitialSlideIndex ?? 0,
  );
  const [presenterStepIndex, setPresenterStepIndex] = useState(
    props.presenterInitialStepIndex ?? 0,
  );
  const [phase, setPhase] = useState<RehearsalPhase>(
    props.initialDeck ? "idle" : "loading",
  );
  const [, setError] = useState("");
  const [run, setRun] = useState<RehearsalRun | null>(null);
  const [, setJob] = useState<Job | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveSttStatus>("idle");
  const [liveError, setLiveError] = useState("");
  const [, setLiveTranscriptBuffer] = useState(createLiveTranscriptBuffer);
  const [liveKeywordState, setLiveKeywordState] =
    useState<LiveTranscriptAnalysis | null>(null);
  const [liveAudioLevel, setLiveAudioLevel] =
    useState<LiveSttAudioLevelEvent | null>(null);
  const [liveDebugPcmRecording, setLiveDebugPcmRecording] =
    useState<LiveSttDebugPcmRecording | null>(null);
  const [liveCue, setLiveCue] = useState<LiveSttAnimationCueEvent | null>(null);
  const [liveSlideAdvance, setLiveSlideAdvance] =
    useState<LiveSttSlideAdvanceEvent | null>(null);
  const [p3SessionState, setP3SessionState] =
    useState<P3RehearsalSessionState | null>(null);
  const [p3RunMeta, setP3RunMeta] = useState<RehearsalRunMeta | null>(null);
  const [previousPracticeSummary, setPreviousPracticeSummary] =
    useState<RehearsalPracticeSummary | null>(() =>
      props.initialDeck
        ? readRehearsalPracticeSummary(
            props.initialDeck.projectId,
            props.initialDeck.deckId,
          )
        : null,
    );
  const [hasLocalCompletion, setHasLocalCompletion] = useState(false);
  const [slidePlaybackState, setSlidePlaybackState] = useState(
    createSlidePlaybackState,
  );
  const [advanceControllerState, setAdvanceControllerState] =
    useState<AdvanceControllerState>(() =>
      createInitialAdvanceControllerState(),
    );
  const [autoAdvanceNowMs, setAutoAdvanceNowMs] = useState(0);
  const [lastSentenceSpokenAtMs, setLastSentenceSpokenAtMs] = useState<
    number | null
  >(null);
  const [pauseDetectorSnapshot, setPauseDetectorSnapshot] =
    useState<PauseDetectorSnapshot | null>(null);
  const [isLiveDemoActive, setIsLiveDemoActive] = useState(false);
  const [isLiveStopModalOpen, setIsLiveStopModalOpen] = useState(false);
  const [displayRole, setDisplayRole] = useState<
    "presenter" | "slide-receiver" | "slide-surface"
  >("presenter");
  const [slideReceiverMessage, setSlideReceiverMessage] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [slideElapsedSeconds, setSlideElapsedSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isSingleScreenOpen, setIsSingleScreenOpen] = useState(false);
  const [timeMode, setTimeMode] = useState<RehearsalTimeMode>("timer");
  const [timerDurationSeconds, setTimerDurationSeconds] = useState(5 * 60);
  const [elapsedTimeInput, setElapsedTimeInput] = useState("00:00");
  const [timerDurationInput, setTimerDurationInput] = useState("05:00");
  const [editingTimeField, setEditingTimeField] = useState<
    "elapsed" | "duration" | null
  >(null);
  const sessionRef = useRef<RecordingSession | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveDemoStreamRef = useRef<MediaStream | null>(null);
  const liveSttPortRef = useRef<LiveSttPort | null>(props.liveSttPort ?? null);
  const liveSttSubscriptionCleanupRef = useRef<(() => void) | null>(null);
  const p3SessionRef = useRef<P3RehearsalSession | null>(null);
  const p3RunMetaRef = useRef<RehearsalRunMeta | null>(null);
  const pendingP3RunMetaRef = useRef<Promise<RehearsalRunMeta | null> | null>(
    null,
  );
  const pendingP3SlideIndexRef = useRef<number | null>(null);
  const finishAfterReportRef = useRef(false);
  const slideWindowRef = useRef<SlideWindowRef | null>(null);
  const deckRef = useRef<Deck | null>(props.initialDeck ?? null);
  const currentSlideIndexRef = useRef(0);
  const liveTranscriptBufferRef = useRef<LiveTranscriptBuffer>(
    createLiveTranscriptBuffer(),
  );
  const liveKeywordStateRef = useRef<LiveTranscriptAnalysis | null>(null);
  const liveBiasContextRef = useRef<LiveSttBiasContext | null>(null);
  const liveCommandConfirmationRef = useRef(
    createRehearsalCommandConfirmationState(),
  );
  const presenterStepIndexRef = useRef(0);
  const slidePlaybackStateRef = useRef<SlidePlaybackState>(
    createSlidePlaybackState(),
  );
  const advanceControllerStateRef = useRef<AdvanceControllerState>(
    createInitialAdvanceControllerState(),
  );
  const lastSentenceSpokenAtMsRef = useRef<number | null>(null);
  const pauseDetectorRef = useRef<PauseDetector | null>(null);
  const { settings: presenterSettings, save: savePresenterSettings } =
    usePresenterSettings();

  useEffect(() => {
    if (props.initialDeck) {
      return;
    }

    let isCancelled = false;
    setPhase("loading");
    void fetchOrCreateRehearsalDeck({
      projectId: props.projectId,
      fallbackDeck: props.fallbackDeck,
    })
      .then((nextDeck) => {
        if (!isCancelled) {
          setDeck(nextDeck);
          setPhase("idle");
        }
      })
      .catch((cause) => {
        if (!isCancelled) {
          setError(toErrorMessage(cause));
          setPhase("failed");
        }
      });

    return () => {
      isCancelled = true;
      stopMediaStream(streamRef.current);
      stopMediaStream(liveDemoStreamRef.current);
    };
  }, [props.fallbackDeck, props.initialDeck, props.projectId]);

  useEffect(() => {
    deckRef.current = deck;
  }, [deck]);

  useEffect(() => {
    if (!deck) {
      setPreviousPracticeSummary(null);
      return;
    }

    setPreviousPracticeSummary(
      readRehearsalPracticeSummary(deck.projectId, deck.deckId),
    );
  }, [deck?.deckId, deck?.projectId]);

  useEffect(() => {
    currentSlideIndexRef.current = currentSlideIndex;
  }, [currentSlideIndex]);

  useEffect(() => {
    presenterStepIndexRef.current = presenterStepIndex;
  }, [presenterStepIndex]);

  useEffect(() => {
    liveKeywordStateRef.current = liveKeywordState;
  }, [liveKeywordState]);

  useEffect(() => {
    slidePlaybackStateRef.current = slidePlaybackState;
  }, [slidePlaybackState]);

  useEffect(() => {
    if (!isTimerRunning) {
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
      setSlideElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isTimerRunning]);

  const displayedTimeSeconds =
    timeMode === "timer"
      ? Math.max(timerDurationSeconds - elapsedSeconds, 0)
      : elapsedSeconds;

  function handlePresenterRemoteCommand(command: PresenterRemoteCommand) {
    const deckSnapshot = deckRef.current;
    if (!deckSnapshot) {
      return;
    }
    if (deckSnapshot.slides.length === 0) {
      return;
    }

    cancelAutoAdvanceForManualCommand();

    if (command.action === "timer-start") {
      if (timeMode === "timer" && elapsedSeconds >= timerDurationSeconds) {
        setElapsedSeconds(0);
      }

      if (canStartLiveDemo) {
        void startLiveDemo();
      } else if (deckSnapshot) {
        setIsTimerRunning(true);
      }
      return;
    }

    if (command.action === "timer-pause") {
      if (phase === "recording") {
        stopRecording();
      } else {
        stopLiveDemo();
      }
      return;
    }

    if (command.action === "timer-reset") {
      if (phase === "recording") {
        stopRecording();
      } else {
        stopLiveDemo();
      }
      resetRehearsalTimerState({
        setElapsedSeconds,
        setSlideElapsedSeconds,
        setIsTimerRunning,
      });
      return;
    }

    if (command.action === "prev") {
      presenterStepIndexRef.current = 0;
      setPresenterStepIndex(0);
      setCurrentSlideIndex((current) => Math.max(0, current - 1));
      return;
    }

    if (command.action === "goto") {
      const nextSlideIndex = Math.min(
        deckSnapshot.slides.length - 1,
        Math.max(0, Math.trunc(command.slideIndex)),
      );
      presenterStepIndexRef.current = Math.max(
        0,
        Math.trunc(command.stepIndex ?? 0),
      );
      setPresenterStepIndex(presenterStepIndexRef.current);
      setCurrentSlideIndex(nextSlideIndex);
      return;
    }

    const slide = deckSnapshot.slides[currentSlideIndexRef.current];
    if (!slide) {
      return;
    }

    const plan = createSlideshowAnimationPlan({
      slide,
      triggerAnimationIds: getTriggerAnimationIdsForSlide(slide),
    });
    const nextState = getNextPresenterStepState({
      currentSlideIndex: currentSlideIndexRef.current,
      currentStepIndex: presenterStepIndexRef.current,
      maxStepIndex: plan.maxStepIndex,
      slideCount: deckSnapshot.slides.length,
    });
    presenterStepIndexRef.current = nextState.stepIndex;
    setPresenterStepIndex(nextState.stepIndex);
    setCurrentSlideIndex(nextState.slideIndex);
  }

  useEffect(() => {
    if (timeMode === "timer" && elapsedSeconds >= timerDurationSeconds) {
      setIsTimerRunning(false);
    }
  }, [elapsedSeconds, timeMode, timerDurationSeconds]);

  useEffect(() => {
    if (editingTimeField !== "elapsed") {
      setElapsedTimeInput(formatClock(displayedTimeSeconds));
    }
  }, [displayedTimeSeconds, editingTimeField]);

  useEffect(() => {
    if (editingTimeField !== "duration") {
      setTimerDurationInput(formatClock(timerDurationSeconds));
    }
  }, [editingTimeField, timerDurationSeconds]);

  useEffect(() => {
    return () => {
      resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
      cleanupLiveSttSubscriptions();
      const p3Session = p3SessionRef.current;
      p3SessionRef.current = null;
      pendingP3SlideIndexRef.current = null;
      if (p3Session) {
        void p3Session.stop();
      } else {
        void liveSttPortRef.current?.stop();
      }
      void liveSttPortRef.current?.dispose();
      stopMediaStream(streamRef.current);
      stopMediaStream(liveDemoStreamRef.current);
    };
  }, []);

  useEffect(() => {
    pauseDetectorRef.current = createPauseDetector({
      config: presenterSettings.pauseDetector,
      pauseMs: presenterSettings.advancePolicy.pauseMs,
    });
    setPauseDetectorSnapshot(null);
  }, [
    presenterSettings.advancePolicy.pauseMs,
    presenterSettings.pauseDetector.silenceThresholdDb,
  ]);

  const currentSlide = deck?.slides[currentSlideIndex] ?? null;
  const currentSlideTargetSeconds =
    deck && currentSlide ? getSlideTargetSeconds(deck, currentSlide) : 0;
  const canRecord =
    Boolean(deck) && !["recording", "uploading", "processing"].includes(phase);
  const isLiveSttActive =
    liveStatus === "starting" || liveStatus === "listening";
  const isP3TrackingActive = p3SessionState?.status === "running";
  const isReportBusy = ["recording", "uploading", "processing"].includes(phase);
  const canStartLiveDemo =
    Boolean(deck) && !isReportBusy && !isLiveSttActive && !isLiveDemoActive;
  const canStopLiveDemo = isLiveDemoActive && isLiveSttActive;
  const p3Sentences = useMemo(
    () =>
      currentSlide
        ? createDefaultPhraseExtractor({
            controlPhrases: defaultRehearsalCommandConfig
              .map((command) => command.phrases)
              .flatMap((phrases) => phrases),
            keywordTerms: (currentSlide.keywords ?? []).flatMap((keyword) => [
              keyword.text,
              ...keyword.synonyms,
              ...keyword.abbreviations,
            ]),
          }).extract(currentSlide.speakerNotes)
        : [],
    [currentSlide?.slideId, currentSlide?.speakerNotes],
  );
  const triggerAnimationIds = useMemo(
    () => (currentSlide ? getTriggerAnimationIdsForSlide(currentSlide) : []),
    [currentSlide],
  );
  const presentationChannelState = useMemo(
    () =>
      currentSlide
        ? {
            highlights: [],
            slideId: currentSlide.slideId,
            slideIndex: currentSlideIndex,
            stepIndex: presenterStepIndex,
            timing: {
              canStartLiveStt: canStartLiveDemo,
              currentSlideElapsedSeconds: slideElapsedSeconds,
              currentSlideTargetSeconds,
              displayedSeconds: displayedTimeSeconds,
              elapsedSeconds,
              isLiveSttActive,
              isRunning: isTimerRunning,
              liveStatus,
              mode: timeMode,
              timerDurationSeconds,
            },
          }
        : null,
    [
      canStartLiveDemo,
      currentSlide?.slideId,
      currentSlideIndex,
      currentSlideTargetSeconds,
      displayedTimeSeconds,
      elapsedSeconds,
      isLiveSttActive,
      isTimerRunning,
      liveStatus,
      presenterStepIndex,
      slideElapsedSeconds,
      timeMode,
      timerDurationSeconds,
    ],
  );
  const presentationChannel = usePresentationChannelPublisher({
    deck,
    enabled:
      !props.presenterWindow &&
      (displayRole === "presenter" ||
        displayRole === "slide-receiver" ||
        displayRole === "slide-surface"),
    onCommand: handlePresenterRemoteCommand,
    sessionId: props.presenterSessionId,
    state: presentationChannelState,
    triggerAnimationIds,
  });
  const displayManager = useMemo(() => createDisplayManager(), []);
  const slideshowAnimationPlan = currentSlide
    ? createSlideshowAnimationPlan({
        slide: currentSlide,
        triggerAnimationIds,
      })
    : null;
  const remainingTriggerSteps = slideshowAnimationPlan
    ? getRemainingTriggerStepsFromPlan(
        slideshowAnimationPlan.maxStepIndex,
        presenterStepIndex,
      )
    : 0;
  const liveAudioLevelLabel = getLiveAudioLevelLabel(liveAudioLevel);
  const liveAudioLevelPercent = getLiveAudioLevelPercent(liveAudioLevel);
  const liveAudioMeterState = liveAudioLevel
    ? liveAudioLevelLabel === "입력 과대"
      ? "clipped"
      : liveAudioLevel.isLikelySilence
        ? "quiet"
        : "active"
    : "idle";
  const canDownloadLiveSttDebugPcm = shouldShowLiveSttDebugPcmDownload(
    liveDebugPcmRecording,
  );
  const p3TimingSnapshot: RehearsalTimingSnapshot = deck
    ? {
        deckTargetSeconds: getRehearsalDeckTargetSeconds(deck),
        elapsedSeconds,
        remainingSeconds: getRehearsalDeckTargetSeconds(deck) - elapsedSeconds,
        currentSlideElapsedSeconds: slideElapsedSeconds,
        currentSlideTargetSeconds,
        currentSlideOvertime:
          currentSlideTargetSeconds > 0 &&
          slideElapsedSeconds > currentSlideTargetSeconds,
      }
    : {
        deckTargetSeconds: 0,
        elapsedSeconds: 0,
        remainingSeconds: 0,
        currentSlideElapsedSeconds: 0,
        currentSlideTargetSeconds: 0,
        currentSlideOvertime: false,
      };
  const rehearsalProgressPercent =
    timerDurationSeconds > 0
      ? Math.min(
          100,
          Math.max(
            0,
            (p3TimingSnapshot.elapsedSeconds / timerDurationSeconds) * 100,
          ),
        )
      : 0;
  const p3WordsPerMinute =
    p3SessionState?.startedAtMs !== null &&
    p3SessionState?.startedAtMs !== undefined
      ? calculateFinalTranscriptWpm({
          segments: p3SessionState.finalSegments,
          nowMs: p3SessionState.startedAtMs + elapsedSeconds * 1000,
          startedAtMs: p3SessionState.startedAtMs,
          windowMs: 30000,
        })
      : 0;
  const p3AdviceState = getTimingAdviceState({
    wordsPerMinute: p3WordsPerMinute,
    currentSlideOvertime: p3TimingSnapshot.currentSlideOvertime,
    paceAdvice: presenterSettings.paceAdvice,
  });

  useEffect(() => {
    const p3Session = p3SessionRef.current;
    if (!p3Session || p3Session.getState().status !== "running") {
      return;
    }

    syncP3AdviceState(p3Session);
  }, [p3AdviceState.pace, p3AdviceState.slideOvertime]);

  useEffect(() => {
    setSlideElapsedSeconds(0);
  }, [currentSlide?.slideId]);

  usePresenterKeyboard({
    enabled:
      Boolean(deck) &&
      !props.presenterWindow &&
      (displayRole === "presenter" ||
        displayRole === "slide-receiver" ||
        displayRole === "slide-surface"),
    onNextStep: () => {
      handleNextPresenterStep();
    },
    onPreviousSlide: () => {
      goPrevious();
    },
  });

  useEffect(() => {
    if (displayRole !== "slide-surface" || typeof document === "undefined") {
      return;
    }

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setDisplayRole("presenter");
        setSlideReceiverMessage("");
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [displayRole]);

  useEffect(() => {
    resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
    resetLivePlaybackForSlide(currentSlide);
    const nextBiasContext =
      deck && currentSlide
        ? buildLiveSttBiasContext(currentSlide, {
            nearbySlides: getNearbySlides(deck, currentSlideIndex),
          })
        : null;
    liveBiasContextRef.current = nextBiasContext;
    void liveSttPortRef.current?.updateBiasPhrases(
      getBiasPhrasesFromContext(nextBiasContext),
    );
    const p3Session = p3SessionRef.current;
    if (p3Session && (isLiveDemoActive || phase === "recording")) {
      const p3State = p3Session.getState();
      if (p3State.status === "starting") {
        pendingP3SlideIndexRef.current = currentSlideIndex;
      } else if (p3State.status === "running") {
        p3Session.enterSlide(currentSlideIndex);
        setP3SessionState(p3Session.getState());
      }
    }
  }, [currentSlide?.slideId, currentSlideIndex, deck]);

  async function startRecording() {
    if (!deck || !canRecord) return;
    const activeDeck = deck;
    stopLiveDemo();

    setError("");
    setRun(null);
    setJob(null);
    setHasLocalCompletion(false);
    finishAfterReportRef.current = false;
    setLiveError("");
    setLiveAudioLevel(null);
    setLiveDebugPcmRecording(null);
    resetLivePlaybackForSlide(currentSlide);
    resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("이 브라우저는 마이크 녹음을 지원하지 않습니다.");
      setPhase("failed");
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await requestRehearsalMicrophoneStream(navigator.mediaDevices);
      const session = createRecordingSession(stream, {
        onError: (recordingError) => {
          stopMediaStream(stream);
          if (streamRef.current === stream) {
            streamRef.current = null;
          }
          sessionRef.current = null;
          setError(recordingError.message);
          setPhase("failed");
        },
        onStop: (audioFile) => {
          stopMediaStream(stream);
          if (streamRef.current === stream) {
            streamRef.current = null;
          }
          sessionRef.current = null;
          void submitRecording(activeDeck, audioFile);
        },
      });
      streamRef.current = stream;
      sessionRef.current = session;
      session.start();
      setPhase("recording");
      setIsTimerRunning(true);
      void startP3Tracking(stream);
    } catch (cause) {
      stopMediaStream(stream);
      if (streamRef.current === stream) {
        streamRef.current = null;
      }
      sessionRef.current = null;
      setError(toMicrophoneErrorMessage(cause));
      setPhase("failed");
    }
  }

  async function startLiveDemo() {
    if (!deck || !canStartLiveDemo) return;

    setLiveError("");
    setLiveAudioLevel(null);
    setLiveDebugPcmRecording(null);
    setHasLocalCompletion(false);
    setElapsedSeconds(0);
    setIsTimerRunning(true);
    resetLivePlaybackForSlide(currentSlide);
    resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setLiveError("이 브라우저는 마이크 녹음을 지원하지 않습니다.");
      setLiveStatus("failed");
      return;
    }

    let stream: MediaStream | null = null;
    setIsLiveDemoActive(true);
    try {
      stream = await requestRehearsalMicrophoneStream(navigator.mediaDevices);
      liveDemoStreamRef.current = stream;
      const started = await startP3Tracking(stream);
      if (!started) {
        stopMediaStream(stream);
        if (liveDemoStreamRef.current === stream) {
          liveDemoStreamRef.current = null;
        }
        setIsLiveDemoActive(false);
      } else {
        setIsTimerRunning(true);
      }
    } catch (cause) {
      stopMediaStream(stream);
      if (liveDemoStreamRef.current === stream) {
        liveDemoStreamRef.current = null;
      }
      setIsLiveDemoActive(false);
      setLiveError(toMicrophoneErrorMessage(cause));
      setLiveStatus("failed");
    }
  }

  function stopLiveDemo(options: { showCompletionModal?: boolean } = {}) {
    const wasLiveDemoActive = isLiveDemoActive || isLiveSttActive;
    cleanupLiveSttSubscriptions();
    const p3Session = p3SessionRef.current;
    p3SessionRef.current = null;
    pendingP3SlideIndexRef.current = null;
    if (p3Session) {
      const runMetaPromise = p3Session
        .stop()
        .then((meta) => {
          p3RunMetaRef.current = meta;
          setP3RunMeta(meta);
          setP3SessionState(p3Session.getState());
          return meta;
        })
        .catch(() => null);
      pendingP3RunMetaRef.current = runMetaPromise;
      void runMetaPromise;
    } else {
      void liveSttPortRef.current?.stop();
    }
    stopMediaStream(liveDemoStreamRef.current);
    liveDemoStreamRef.current = null;
    setLiveAudioLevel(null);
    setIsLiveDemoActive(false);
    setIsTimerRunning(false);
    setLiveStatus((current) =>
      current === "listening" || current === "starting" ? "stopped" : current,
    );
    resetLivePlaybackForSlide(currentSlide);
    resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
    if (options.showCompletionModal && wasLiveDemoActive) {
      setIsLiveStopModalOpen(true);
    }
  }

  function stopRecording() {
    if (phase !== "recording") return;

    setPhase("uploading");
    setIsTimerRunning(false);
    resetLivePlaybackForSlide(currentSlide);
    resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
    cleanupLiveSttSubscriptions();
    const p3Session = p3SessionRef.current;
    p3SessionRef.current = null;
    pendingP3SlideIndexRef.current = null;
    if (p3Session) {
      const runMetaPromise = p3Session
        .stop()
        .then((meta) => {
          p3RunMetaRef.current = meta;
          setP3RunMeta(meta);
          setP3SessionState(p3Session.getState());
          return meta;
        })
        .catch(() => null);
      pendingP3RunMetaRef.current = runMetaPromise;
      void runMetaPromise;
    } else {
      void liveSttPortRef.current?.stop();
    }
    setLiveAudioLevel(null);
    setLiveStatus((current) =>
      current === "listening" || current === "starting" ? "stopped" : current,
    );
    sessionRef.current?.stop();
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    sessionRef.current = null;
  }

  async function handleTimePrimaryAction() {
    if (isTimerRunning) {
      if (phase === "recording") {
        stopRecording();
      } else if (isLiveDemoActive || isLiveSttActive) {
        stopLiveDemo();
      } else {
        setIsTimerRunning(false);
      }
      return;
    }

    if (timeMode === "timer" && elapsedSeconds >= timerDurationSeconds) {
      setElapsedSeconds(0);
    }

    await startRecording();
  }

  function handleSideTimerPrimaryAction() {
    if (phase === "recording") {
      setHasLocalCompletion(true);
      stopRecording();
      return;
    }

    if (canStopLiveDemo) {
      stopLiveDemo({ showCompletionModal: true });
      return;
    }

    if (isTimerRunning) {
      setIsTimerRunning(false);
      setHasLocalCompletion(true);
      return;
    }

    if (timeMode === "timer" && elapsedSeconds >= timerDurationSeconds) {
      setElapsedSeconds(0);
    }

    if (canRecord) {
      void startRecording();
      return;
    }

    if (deck) {
      setIsTimerRunning(true);
    }
  }

  function commitElapsedTimeInput(value: string) {
    const nextSeconds = parseClockInput(value);
    setEditingTimeField(null);

    if (nextSeconds === null) {
      setElapsedTimeInput(formatClock(displayedTimeSeconds));
      return;
    }

    const boundedSeconds = Math.min(nextSeconds, 60 * 60 * 24 - 1);
    setElapsedSeconds(
      timeMode === "timer"
        ? Math.max(timerDurationSeconds - boundedSeconds, 0)
        : boundedSeconds,
    );
  }

  function commitTimerDurationInput(value: string) {
    const nextSeconds = parseClockInput(value);
    setEditingTimeField(null);

    if (nextSeconds === null || nextSeconds <= 0) {
      setTimerDurationInput(formatClock(timerDurationSeconds));
      return;
    }

    setTimerDurationSeconds(Math.min(nextSeconds, 60 * 60 * 24 - 1));
  }

  function getOrCreateLiveSttPort() {
    if (props.liveSttPort) {
      liveSttPortRef.current = props.liveSttPort;
      return props.liveSttPort;
    }

    const cachedPort = liveSttPortRef.current;
    const activeProjectId =
      deckRef.current?.projectId ?? props.projectId ?? demoIds.projectId;
    if (
      cachedPort?.engineId === presenterSettings.sttEngine &&
      (cachedPort.engineId !== "openai-realtime" ||
        readLiveSttPortProjectId(cachedPort) === activeProjectId)
    ) {
      return cachedPort;
    }

    cachedPort?.dispose();
    const port = createDefaultLiveSttPort({
      engineId: presenterSettings.sttEngine,
      legacyAdapter: props.liveSttAdapter,
      onAudioLevel: setLiveAudioLevel,
      onDebugPcmAvailable: setLiveDebugPcmRecording,
      getDecodingMethod: getLiveSttDebugDecodingMethod,
      projectId: activeProjectId,
    });
    liveSttPortRef.current = port;
    return port;
  }

  async function startP3Tracking(stream: MediaStream) {
    const deckSnapshot = deckRef.current ?? deck;
    const startSlideIndex = currentSlideIndexRef.current;
    if (!deckSnapshot?.slides[startSlideIndex]) {
      return false;
    }

    const port = getOrCreateLiveSttPort();
    liveSttPortRef.current = port;
    setLiveStatus("starting");
    setLiveAudioLevel(null);
    pendingP3SlideIndexRef.current = null;
    cleanupLiveSttSubscriptions();

    const unsubscribeResult = port.onResult(handleLiveSttResult);
    const unsubscribeError = port.onError(handleLiveSttError);
    liveSttSubscriptionCleanupRef.current = () => {
      unsubscribeResult();
      unsubscribeError();
    };

    let session: P3RehearsalSession | null = null;
    session = createP3RehearsalSession({
      slides: buildP3SessionSlides(deckSnapshot),
      port,
      threshold: presenterSettings.advancePolicy.threshold,
      config: {
        ...presenterSettings.speechTracking,
        paceAdvice: {
          ...presenterSettings.paceAdvice,
          movingAverageWindowMs:
            defaultSpeechTrackingConfig.paceAdvice.movingAverageWindowMs,
        },
      },
      onEvents: (events) => {
        handleP3Events(events);
        if (session) {
          setP3SessionState(session.getState());
        }
      },
      onSnapshot: () => {
        if (session) {
          setP3SessionState(session.getState());
        }
      },
    });
    p3SessionRef.current = session;

    try {
      await session.start({
        audioSource: stream,
        slideIndex: startSlideIndex,
      });
      if (p3SessionRef.current !== session) {
        return false;
      }
      const latestSlideIndex =
        pendingP3SlideIndexRef.current ?? currentSlideIndexRef.current;
      pendingP3SlideIndexRef.current = null;
      if (
        latestSlideIndex !== startSlideIndex &&
        deckSnapshot.slides[latestSlideIndex]
      ) {
        session.enterSlide(latestSlideIndex);
      }
      syncP3AdviceState(session);
      p3RunMetaRef.current = null;
      pendingP3RunMetaRef.current = null;
      setP3RunMeta(null);
      setP3SessionState(session.getState());
      setLiveStatus("listening");
      return true;
    } catch (cause) {
      if (p3SessionRef.current !== session) {
        return false;
      }
      cleanupLiveSttSubscriptions();
      p3SessionRef.current = null;
      pendingP3SlideIndexRef.current = null;
      const error = toLiveSttError(cause);
      setLiveStatus(isLiveSttUnavailable(error) ? "unavailable" : "failed");
      setLiveError(error.message);
      setLiveAudioLevel(null);
      resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
      return false;
    }
  }

  function syncP3AdviceState(p3Session: P3RehearsalSession) {
    p3Session.setAdviceState("slide-overtime", p3AdviceState.slideOvertime);
    p3Session.setAdviceState(
      "pace-too-fast",
      p3AdviceState.pace === "too-fast",
    );
    p3Session.setAdviceState(
      "pace-too-slow",
      p3AdviceState.pace === "too-slow",
    );
  }

  function ensurePauseDetector() {
    if (!pauseDetectorRef.current) {
      pauseDetectorRef.current = createPauseDetector({
        config: presenterSettings.pauseDetector,
        pauseMs: presenterSettings.advancePolicy.pauseMs,
      });
    }

    return pauseDetectorRef.current;
  }

  function updatePauseDetector(event: PauseDetectorEvent) {
    const atMs =
      "atMs" in event && typeof event.atMs === "number"
        ? event.atMs
        : Date.now();
    const detector = ensurePauseDetector();
    detector.accept(event);
    setPauseDetectorSnapshot(detector.snapshot(atMs));
    setAutoAdvanceNowMs(atMs);
  }

  function updateAdvanceControllerState(nextState: AdvanceControllerState) {
    advanceControllerStateRef.current = nextState;
    setAdvanceControllerState(nextState);
  }

  function resetAutoAdvanceRuntimeState(slideId: string | null) {
    pauseDetectorRef.current?.accept({ type: "reset" });
    setPauseDetectorSnapshot(null);
    setLastSentenceSpokenAtMs(null);
    lastSentenceSpokenAtMsRef.current = null;
    updateAdvanceControllerState(
      slideId
        ? resetAdvanceControllerForSlide(slideId)
        : createInitialAdvanceControllerState(),
    );
  }

  function cancelAutoAdvanceForManualCommand() {
    const result = cancelAdvanceCountdown(
      advanceControllerStateRef.current,
      "manual",
    );
    updateAdvanceControllerState(result.state);
  }

  function handleP3Events(events: SpeechTrackingEvent[]) {
    if (events.some((event) => event.type === "last-sentence-spoken")) {
      const spokenAt = Date.now();
      lastSentenceSpokenAtMsRef.current = spokenAt;
      setLastSentenceSpokenAtMs(spokenAt);
    }
  }

  function runAdvanceControllerEvaluation(input: {
    effectiveCoverage: number;
    finalSentenceSpoken: boolean;
    remainingTriggerSteps: number;
  }) {
    if (!deck || !currentSlide) {
      return;
    }

    const nowMs = Date.now();
    const detector = ensurePauseDetector();
    const pause = pauseDetectorSnapshot ?? detector.snapshot(nowMs);
    const result = evaluateAdvanceController(
      advanceControllerStateRef.current,
      {
        effectiveCoverage: input.effectiveCoverage,
        finalSentenceSpoken: input.finalSentenceSpoken,
        finalSentenceSpokenAtMs: lastSentenceSpokenAtMsRef.current,
        isLastSlide: currentSlideIndex >= deck.slides.length - 1,
        mode: "rehearsal",
        nowMs,
        pause: {
          isPaused: pause.isPaused,
          silenceDurationMs: pause.silenceDurationMs,
        },
        policy: presenterSettings.advancePolicy,
        remainingTriggerSteps: input.remainingTriggerSteps,
        slideId: currentSlide.slideId,
      },
      defaultAutoAdvanceConfig,
    );

    updateAdvanceControllerState(result.state);
    setAutoAdvanceNowMs(nowMs);

    for (const command of result.commands) {
      if (command.type !== "advance-slide") {
        continue;
      }

      const nextSlide = deck.slides[currentSlideIndex + 1];
      if (!nextSlide) {
        continue;
      }

      setPresenterStepIndex(0);
      setCurrentSlideIndex(currentSlideIndex + 1);
      setLiveSlideAdvance({
        type: "slide-advance",
        fromSlideId: currentSlide.slideId,
        toSlideId: nextSlide.slideId,
        reason: "keyword-coverage",
        coverage: input.effectiveCoverage,
      });
    }
  }

  function handleLiveSttError(error: LiveSttError) {
    if (!p3SessionRef.current) {
      return;
    }

    setLiveStatus(isLiveSttUnavailable(error) ? "unavailable" : "failed");
    setLiveError(error.message);
    setLiveAudioLevel(null);
    setIsTimerRunning(false);
    resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
  }

  function handleLiveSttResult(result: LiveSttResult) {
    if (!p3SessionRef.current) {
      return;
    }

    updatePauseDetector({
      type: "transcript-activity",
      atMs: Date.now(),
      isFinal: result.isFinal,
    });
    handleLivePartialTranscript({
      type: "partial-transcript",
      transcript: result.text,
      isFinal: result.isFinal,
      confidence: result.confidence ?? null,
    });
  }

  function handleLivePartialTranscript(event: LiveSttPartialTranscriptEvent) {
    const deckSnapshot = deckRef.current;
    const slideIndex = currentSlideIndexRef.current;
    const slide = deckSnapshot?.slides[slideIndex];
    if (!deckSnapshot || !slide) {
      return;
    }

    const nextBuffer = applyLiveTranscriptEvent(
      liveTranscriptBufferRef.current,
      event,
    );
    liveTranscriptBufferRef.current = nextBuffer;
    setLiveTranscriptBuffer(nextBuffer);

    const transcript = renderLiveTranscriptBuffer(nextBuffer);
    const biasMode = getLiveSttBiasMode();
    const biasContext = getCurrentLiveBiasContext(deckSnapshot, slideIndex);
    const matchingTranscript = shouldUseLiveSttPostprocessBias(biasMode)
      ? applyLiveTranscriptBias(transcript, biasContext)
      : transcript;
    const analysis = evaluateLiveTranscript(slide, matchingTranscript);
    const confirmedCommand = confirmRehearsalCommandCandidate(
      liveCommandConfirmationRef.current,
      detectRehearsalCommandCandidate(event),
    );
    const slideTriggerAnimationIds = getTriggerAnimationIdsForSlide(slide);
    const slideAnimationPlan = createSlideshowAnimationPlan({
      slide,
      triggerAnimationIds: slideTriggerAnimationIds,
    });

    const previousDetectedIds = new Set(
      liveKeywordStateRef.current?.slideId === slide.slideId
        ? liveKeywordStateRef.current.detectedKeywords.map(
            (keyword) => keyword.keywordId,
          )
        : [],
    );
    const newlyDetected = analysis.detectedKeywords.find(
      (keyword) => !previousDetectedIds.has(keyword.keywordId),
    );

    if (newlyDetected) {
      setLiveCue({
        type: "animation-cue",
        slideId: slide.slideId,
        keywordId: newlyDetected.keywordId,
        cue: "emphasis",
        text: newlyDetected.text,
      });

      applyTriggeredSlideActions(
        slide,
        slideAnimationPlan,
        resolveKeywordTriggeredActions(slide, newlyDetected.keywordId),
        deckSnapshot.slides.length,
      );
    }

    if (isEmphasisCommand(confirmedCommand)) {
      setLiveCue({
        type: "animation-cue",
        slideId: slide.slideId,
        keywordId: "command-emphasis",
        cue: "emphasis",
        text: confirmedCommand.phrase,
      });

      applyTriggeredSlideActions(
        slide,
        slideAnimationPlan,
        resolveCueTriggeredActions(slide, "emphasis"),
        deckSnapshot.slides.length,
      );
    }

    setLiveKeywordState(analysis);
    liveKeywordStateRef.current = analysis;
    setLiveStatus("listening");

    if (isAdvanceSlideCommand(confirmedCommand)) {
      cancelAutoAdvanceForManualCommand();
      goNext();
    }
  }

  function applyTriggeredSlideActions(
    slide: Slide,
    slideAnimationPlan: ReturnType<typeof createSlideshowAnimationPlan>,
    actions: Slide["actions"],
    slideCount: number,
  ) {
    if (actions.length === 0) {
      return;
    }

    const playbackUpdate = resolveTriggeredActionPlaybackUpdate({
      actions,
      playbackState: slidePlaybackStateRef.current,
      presenterStepIndex: presenterStepIndexRef.current,
      slide,
      slideAnimationPlan,
    });

    if (playbackUpdate.playbackState !== slidePlaybackStateRef.current) {
      slidePlaybackStateRef.current = playbackUpdate.playbackState;
      setSlidePlaybackState(playbackUpdate.playbackState);
    }

    if (playbackUpdate.shouldAdvanceSlide) {
      cancelAutoAdvanceForManualCommand();
      presenterStepIndexRef.current = 0;
      setPresenterStepIndex(0);
      setCurrentSlideIndex((current) => Math.min(slideCount - 1, current + 1));
      return;
    }

    if (playbackUpdate.presenterStepIndex !== presenterStepIndexRef.current) {
      presenterStepIndexRef.current = playbackUpdate.presenterStepIndex;
      setPresenterStepIndex(playbackUpdate.presenterStepIndex);
    }
  }

  function resetLiveTranscriptForSlide(slide: Slide | null) {
    const nextBuffer = createLiveTranscriptBuffer();
    const nextKeywordState = slide ? evaluateLiveTranscript(slide, "") : null;

    liveTranscriptBufferRef.current = nextBuffer;
    liveKeywordStateRef.current = nextKeywordState;
    liveCommandConfirmationRef.current =
      createRehearsalCommandConfirmationState();
    setLiveTranscriptBuffer(nextBuffer);
    setLiveKeywordState(nextKeywordState);
    setLiveCue(null);
  }

  function resetLivePlaybackForSlide(slide: Slide | null) {
    resetLiveTranscriptForSlide(slide);
    const nextSlidePlaybackState = createSlidePlaybackState();
    slidePlaybackStateRef.current = nextSlidePlaybackState;
    setSlidePlaybackState(nextSlidePlaybackState);
    setLiveSlideAdvance(null);
  }

  function getCurrentLiveBiasContext(deckSnapshot: Deck, slideIndex: number) {
    const slide = deckSnapshot.slides[slideIndex];
    if (!slide) {
      return null;
    }

    const current = liveBiasContextRef.current;
    if (current?.slideId === slide.slideId) {
      return current;
    }

    const nextBiasContext = buildLiveSttBiasContext(slide, {
      nearbySlides: getNearbySlides(deckSnapshot, slideIndex),
    });
    liveBiasContextRef.current = nextBiasContext;
    return nextBiasContext;
  }

  function cleanupLiveSttSubscriptions() {
    liveSttSubscriptionCleanupRef.current?.();
    liveSttSubscriptionCleanupRef.current = null;
  }

  async function submitRecording(activeDeck: Deck, audioFile: File) {
    setPhase("uploading");
    setError("");

    try {
      const runMeta = pendingP3RunMetaRef.current
        ? await pendingP3RunMetaRef.current
        : p3RunMetaRef.current;
      const result = await runRehearsalUploadFlow({
        projectId: activeDeck.projectId,
        deckId: activeDeck.deckId,
        audioFile,
        runMeta,
        onJobUpdate: (nextJob) => {
          setJob(nextJob);
          setPhase("processing");
        },
      });
      setRun(result.run);
      setJob(result.job);

      if (result.job.status === "failed") {
        setPhase("failed");
        setError(
          result.job.error?.message ||
            result.job.message ||
            "由ы뿀??遺꾩꽍???ㅽ뙣?덉뒿?덈떎.",
        );
        return;
      }

      await loadReportForRun(result.run.runId, result.run);
      setPhase("succeeded");
      if (finishAfterReportRef.current) {
        finishAfterReportRef.current = false;
        navigateToPath(
          getRehearsalReportPath(activeDeck.projectId, result.run.runId),
        );
      }
    } catch (cause) {
      setError(toRehearsalFlowMessage(cause));
      setPhase("failed");
    }
  }

  async function loadReportForRun(runId: string, fallbackRun: RehearsalRun) {
    try {
      const response = await fetchRehearsalReport(runId);
      setRun(response.run);
    } catch {
      setRun(fallbackRun);
    }
  }

  const goPrevious = () => {
    cancelAutoAdvanceForManualCommand();
    setPresenterStepIndex(0);
    setCurrentSlideIndex((current) => Math.max(0, current - 1));
  };
  const goNext = () => {
    if (!deck) return;
    cancelAutoAdvanceForManualCommand();
    setPresenterStepIndex(0);
    setCurrentSlideIndex((current) =>
      Math.min(deck.slides.length - 1, current + 1),
    );
  };
  const handleNextPresenterStep = () => {
    if (!deck || !slideshowAnimationPlan) return;
    cancelAutoAdvanceForManualCommand();

    const nextState = getNextPresenterStepState({
      currentSlideIndex,
      currentStepIndex: presenterStepIndex,
      maxStepIndex: slideshowAnimationPlan.maxStepIndex,
      slideCount: deck.slides.length,
    });
    setPresenterStepIndex(nextState.stepIndex);
    setCurrentSlideIndex(nextState.slideIndex);
  };
  const finishRehearsal = () => {
    const projectId = deck?.projectId ?? props.projectId ?? demoIds.projectId;

    if (phase === "recording") {
      setHasLocalCompletion(true);
      stopRecording();
      return;
    }

    if (phase === "uploading" || phase === "processing") {
      setHasLocalCompletion(true);
      return;
    }

    if (isLiveDemoActive || isLiveSttActive) {
      stopLiveDemo({ showCompletionModal: true });
      return;
    }

    if (isTimerRunning) {
      setIsTimerRunning(false);
      setHasLocalCompletion(true);
      return;
    }

    navigateToPath(getRehearsalFinishPath(projectId, run));
  };
  const resetSlideDisplayToBeginning = () => {
    presenterStepIndexRef.current = 0;
    currentSlideIndexRef.current = 0;
    setPresenterStepIndex(0);
    setCurrentSlideIndex(0);
  };
  const publishSlideWindowSnapshot = (deferUntilNextRender: boolean) => {
    if (deferUntilNextRender && typeof window !== "undefined") {
      window.setTimeout(() => presentationChannel.publishSnapshot(), 0);
      return;
    }

    presentationChannel.publishSnapshot();
  };
  const requestDisplayScreens =
    async (): Promise<RequestDisplayScreensResult> => {
      const result = await displayManager.listExternalScreens();

      if (result.ok) {
        return { ok: true, screens: result.value };
      }

      return { code: result.code, ok: false };
    };
  const resolveAutoPlacementScreen = (
    options: SlideDisplayOptions,
  ): {
    placementCode?: DisplayManagerErrorCode;
    targetScreen: DisplayScreenDescriptor | null;
  } => {
    if (!options.autoPlace) {
      return { targetScreen: null };
    }

    return { targetScreen: options.targetScreen ?? null };
  };
  const buildPresenterRemoteWindowPath = (state: {
    slideIndex: number;
    stepIndex: number;
  }) =>
    props.projectId
      ? getRehearsalPresenterWindowPath(
          props.projectId,
          presentationChannel.sessionId,
          state,
        )
      : getCurrentRehearsalPresenterWindowPath(
          presentationChannel.sessionId,
          state,
        );
  const closeSlideWindow = (windowRef: SlideWindowRef | null) => {
    if (windowRef && !windowRef.closed) {
      windowRef.close?.();
    }
  };
  const closeExistingSlideWindow = () => {
    closeSlideWindow(slideWindowRef.current);
    slideWindowRef.current = null;
  };
  const requestSlideWindowFullscreen =
    async (): Promise<RequestSlideWindowFullscreenResult> => {
      if (!slideWindowRef.current || slideWindowRef.current.closed) {
        return { code: "fullscreen-blocked", ok: false };
      }

      const result = displayManager.delegateSlideWindowFullscreen(
        slideWindowRef.current,
      );
      if (!result.ok) {
        return { code: result.code, ok: false };
      }

      return { ok: true };
    };
  const openSurfaceSwapDisplay = async (
    options: SlideDisplayOptions,
    targetScreen: DisplayScreenDescriptor,
    placementCode?: DisplayManagerErrorCode,
  ) => {
    if (!slideReceiverIdentity) {
      return {
        autoPlaced: false,
        displayOpened: false,
        fullscreenStarted: false,
        placementCode,
        placementTargetLabel: targetScreen.label,
      };
    }

    if (options.startFromBeginning) {
      resetSlideDisplayToBeginning();
    }

    const fullscreenResult = await displayManager.requestFullscreenOnScreen(
      typeof document === "undefined" ? null : document.documentElement,
      targetScreen.screenIndex,
    );
    if (!fullscreenResult.ok) {
      return {
        autoPlaced: false,
        displayOpened: false,
        fullscreenStarted: false,
        placementCode: fullscreenResult.code,
        placementTargetLabel: targetScreen.label,
      };
    }

    closeExistingSlideWindow();
    const remoteWindowResult = displayManager.openPresenterRemoteWindow(
      buildPresenterRemoteWindowPath({
        slideIndex: currentSlideIndexRef.current,
        stepIndex: presenterStepIndexRef.current,
      }),
      {
        screen: displayManager.getCurrentScreen(),
        target: `orbit-presenter-${presentationChannel.sessionId}-${Date.now()}`,
      },
    );

    setSlideReceiverMessage(
      remoteWindowResult.ok
        ? ""
        : "팝업이 차단되었습니다. 발표는 계속 진행됩니다. 이 화면의 제어 버튼으로 진행해주세요.",
    );
    setDisplayRole("slide-surface");
    publishSlideWindowSnapshot(options.startFromBeginning);

    return {
      autoPlaced: true,
      displayOpened: true,
      fullscreenStarted: true,
      placementCode: remoteWindowResult.ok
        ? placementCode
        : remoteWindowResult.code,
      placementTargetLabel: targetScreen.label,
    };
  };
  const openSlideWindowForDisplay = async (options: SlideDisplayOptions) => {
    if (!slideReceiverIdentity) {
      closeExistingSlideWindow();
      return {
        autoPlaced: false,
        displayOpened: false,
        fullscreenStarted: false,
        placementCode: undefined,
        placementTargetLabel: undefined,
      };
    }

    if (options.startFromBeginning) {
      resetSlideDisplayToBeginning();
    }

    const { placementCode, targetScreen } = resolveAutoPlacementScreen(options);
    if (
      options.presenterView &&
      options.fullscreen &&
      options.autoPlace &&
      targetScreen
    ) {
      const surfaceSwapResult = await openSurfaceSwapDisplay(
        options,
        targetScreen,
        placementCode,
      );
      if (surfaceSwapResult.fullscreenStarted) {
        return surfaceSwapResult;
      }
    }

    const previousSlideWindow = slideWindowRef.current;
    const openResult = displayManager.openSlideWindow(slideReceiverIdentity, {
      screen: targetScreen,
      target: `orbit-slide-${presentationChannel.sessionId}-${Date.now()}`,
    });
    if (!openResult.ok) {
      return {
        autoPlaced: false,
        displayOpened: false,
        fullscreenStarted: false,
        placementCode: openResult.code,
        placementTargetLabel: targetScreen?.label,
      };
    }

    if (previousSlideWindow !== openResult.value) {
      closeSlideWindow(previousSlideWindow);
    }
    slideWindowRef.current = openResult.value;
    publishSlideWindowSnapshot(options.startFromBeginning);
    return {
      autoPlaced: Boolean(targetScreen),
      displayOpened: true,
      fullscreenStarted: false,
      placementCode,
      placementTargetLabel: targetScreen?.label,
    };
  };
  const openCurrentWindowSlideDisplay = async (
    options: SlideDisplayOptions,
  ) => {
    if (options.startFromBeginning) {
      resetSlideDisplayToBeginning();
    }

    const fullscreenStarted = options.fullscreen
      ? await requestPresentWindowFullscreen(
          typeof document === "undefined" ? null : document.documentElement,
        )
      : false;

    setSlideReceiverMessage(
      options.fullscreen && !fullscreenStarted
        ? "전체화면 전환이 차단되었습니다. 아래 전체화면 버튼을 눌러주세요."
        : "",
    );
    setDisplayRole("slide-receiver");
    return fullscreenStarted;
  };
  const openSlideDisplay = async (options: SlideDisplayOptions) => {
    if (!deck || !currentSlide) {
      return {
        displayMode: options.displayMode,
        displayOpened: false,
        fullscreenStarted: false,
      };
    }

    if (options.displayMode === "current-window") {
      return {
        displayMode: "current-window" as const,
        displayOpened: true,
        fullscreenStarted: await openCurrentWindowSlideDisplay(options),
      };
    }

    const slideWindowResult = await openSlideWindowForDisplay(options);

    return {
      autoPlaced: slideWindowResult.autoPlaced,
      displayMode: "slide-window" as const,
      displayOpened: slideWindowResult.displayOpened,
      fullscreenStarted: slideWindowResult.fullscreenStarted,
      placementCode: slideWindowResult.placementCode,
      placementTargetLabel: slideWindowResult.placementTargetLabel,
    };
  };

  const checklistKeywords = getChecklistKeywords(currentSlide);
  const p3PanelSnapshot =
    currentSlide && p3SessionState?.snapshot?.slideId === currentSlide.slideId
      ? p3SessionState.snapshot
      : createEmptySpeechTrackerSnapshot({
          slideId: currentSlide?.slideId ?? "slide-empty",
          matchableSentenceCount: p3Sentences.filter(
            (sentence) => sentence.matchable,
          ).length,
        });
  const hasDeletedRawAudio = Boolean(run?.rawAudioDeletedAt);
  const nextSlide = deck?.slides[currentSlideIndex + 1] ?? null;
  const miniSlideScale = deck ? getMiniSlideScale(deck) : 0.14;
  const prompterRows = getRehearsalPrompterRows(
    p3Sentences,
    p3PanelSnapshot.coveredSentenceIds,
    currentSlide?.speakerNotes ?? "",
  );
  const rehearsalSummary = buildRehearsalCompletionSummary({
    deck,
    elapsedSeconds,
    meta: p3RunMeta,
    previousSummary: previousPracticeSummary,
    snapshot: p3PanelSnapshot,
    targetSeconds: timerDurationSeconds,
  });
  const isRehearsalRuntimeActive =
    phase === "recording" || isLiveSttActive || isTimerRunning;
  const rehearsalRuntimeStatusLabel =
    phase === "recording"
      ? "녹음 · 음성 인식 중"
      : isLiveSttActive
        ? "음성 인식 중"
        : isTimerRunning
          ? "리허설 진행 중"
          : "준비됨";
  const shouldShowRehearsalPreflight =
    Boolean(deck) &&
    phase === "idle" &&
    liveStatus === "idle" &&
    !isLiveDemoActive &&
    !isTimerRunning &&
    !p3RunMeta &&
    !hasLocalCompletion;
  const shouldShowRehearsalCompletion =
    Boolean(deck) &&
    (hasLocalCompletion ||
      isLiveStopModalOpen ||
      phase === "succeeded" ||
      (Boolean(p3RunMeta) &&
        !isLiveDemoActive &&
        !isLiveSttActive &&
        !isTimerRunning &&
        phase !== "recording"));
  const returnToPreflight = () => {
    setIsLiveStopModalOpen(false);
    setP3RunMeta(null);
    setP3SessionState(null);
    p3RunMetaRef.current = null;
    pendingP3RunMetaRef.current = null;
    setRun(null);
    setHasLocalCompletion(false);
    setLiveStatus("idle");
    setLiveError("");
    resetRehearsalTimerState({
      setElapsedSeconds,
      setSlideElapsedSeconds,
      setIsTimerRunning,
    });
    if (phase !== "uploading" && phase !== "processing") {
      setPhase("idle");
    }
  };
  const persistCurrentPracticeSummary = () => {
    if (!deck) {
      return;
    }

    const nextSummary = createRehearsalPracticeSummary(
      deck,
      rehearsalSummary,
    );
    writeRehearsalPracticeSummary(nextSummary);
    setPreviousPracticeSummary(nextSummary);
  };
  const handleCompletionPracticeAgain = () => {
    persistCurrentPracticeSummary();
    returnToPreflight();
  };
  const handleCompletionPrimaryAction = () => {
    persistCurrentPracticeSummary();

    if (phase === "uploading" || phase === "processing") {
      finishAfterReportRef.current = true;
      return;
    }

    if (run?.runId) {
      finishRehearsal();
      return;
    }

    returnToPreflight();
  };

  useEffect(() => {
    if (!isP3TrackingActive || !liveAudioLevel) {
      return;
    }

    updatePauseDetector({
      type: "audio-level",
      atMs: Date.now(),
      rmsDb: liveAudioLevel.rmsDb,
    });
  }, [isP3TrackingActive, liveAudioLevel?.rmsDb]);

  useEffect(() => {
    if (!isP3TrackingActive) {
      resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
      return;
    }

    const timer = window.setInterval(() => {
      updatePauseDetector({ type: "tick", atMs: Date.now() });
    }, 250);

    return () => window.clearInterval(timer);
  }, [currentSlide?.slideId, isP3TrackingActive]);

  useEffect(() => {
    if (!deck || !currentSlide || !isP3TrackingActive) {
      return;
    }

    runAdvanceControllerEvaluation({
      effectiveCoverage: p3PanelSnapshot.effectiveCoverage,
      finalSentenceSpoken: p3PanelSnapshot.finalSentenceSpoken,
      remainingTriggerSteps,
    });
  }, [
    currentSlide?.slideId,
    currentSlideIndex,
    deck?.slides.length,
    isP3TrackingActive,
    lastSentenceSpokenAtMs,
    pauseDetectorSnapshot?.isPaused,
    pauseDetectorSnapshot?.silenceDurationMs,
    p3PanelSnapshot.effectiveCoverage,
    p3PanelSnapshot.finalSentenceSpoken,
    presenterSettings.advancePolicy.countdownMs,
    presenterSettings.advancePolicy.live,
    presenterSettings.advancePolicy.pauseMs,
    presenterSettings.advancePolicy.rehearsal,
    presenterSettings.advancePolicy.threshold,
    presenterStepIndex,
    remainingTriggerSteps,
  ]);

  const { presenterScale, presenterStageRef } = usePresenterStageScale(deck);
  const slideReceiverIdentity = useMemo(
    () =>
      deck
        ? {
            deckId: deck.deckId,
            sessionId: presentationChannel.sessionId,
          }
        : null,
    [deck?.deckId, presentationChannel.sessionId],
  );
  const slideReceiverSnapshot = useMemo(
    () =>
      deck && presentationChannelState
        ? {
            deck: createSlideWindowDeckSnapshot(deck),
            state: presentationChannelState,
            triggerAnimationIds,
          }
        : null,
    [deck, presentationChannelState, triggerAnimationIds],
  );

  if (
    props.presenterWindow &&
    (!deck || !slideReceiverIdentity || !presentationChannelState)
  ) {
    return (
      <main className="presenter-remote-shell" aria-label="발표자 제어 창">
        <section className="presenter-remote-status" role="status">
          발표자 제어를 준비하는 중입니다.
        </section>
      </main>
    );
  }

  if (
    props.presenterWindow &&
    deck &&
    slideReceiverIdentity &&
    presentationChannelState
  ) {
    return (
      <PresenterRemoteWindow
        deck={deck}
        identity={slideReceiverIdentity}
        initialState={presentationChannelState}
      />
    );
  }

  if (
    (displayRole === "slide-receiver" || displayRole === "slide-surface") &&
    slideReceiverIdentity &&
    slideReceiverSnapshot
  ) {
    return (
      <PresentWindowReceiver
        controlOverlayMode={
          displayRole === "slide-receiver" ? "always" : "fallback"
        }
        fullscreenMessage={slideReceiverMessage}
        identity={slideReceiverIdentity}
        initialSnapshot={slideReceiverSnapshot}
        onNextStep={handleNextPresenterStep}
        onPreviousSlide={goPrevious}
        onReconnectPresenter={(snapshot) => {
          const presenterWindowPath = props.projectId
            ? getRehearsalPresenterWindowPath(
                props.projectId,
                presentationChannel.sessionId,
                {
                  slideIndex: snapshot.state.slideIndex,
                  stepIndex: snapshot.state.stepIndex,
                },
              )
            : getCurrentRehearsalPresenterWindowPath(
                presentationChannel.sessionId,
                {
                  slideIndex: snapshot.state.slideIndex,
                  stepIndex: snapshot.state.stepIndex,
                },
              );
          const presenterWindow =
            typeof window === "undefined"
              ? null
              : window.open(
                  presenterWindowPath,
                  `orbit-presenter-${presentationChannel.sessionId}`,
                  "popup=yes,width=1512,height=900",
                );
          presenterWindow?.focus();
          if (presenterWindow) return setSlideReceiverMessage("");

          setSlideReceiverMessage(
            "팝업이 차단되었습니다. 브라우저 팝업을 허용한 뒤 발표자 창 다시 열기를 눌러주세요.",
          );
        }}
        onExit={() => {
          if (typeof document !== "undefined" && document.fullscreenElement) {
            void document.exitFullscreen();
          }
          setDisplayRole("presenter");
          setSlideReceiverMessage("");
        }}
      />
    );
  }

  if (isSingleScreenOpen && deck && currentSlide) {
    return (
      <SingleScreenPresenter
        deck={deck}
        onExit={() => setIsSingleScreenOpen(false)}
        slideElapsedLabel={formatClock(slideElapsedSeconds)}
        slideId={currentSlide.slideId}
        slideTargetLabel={formatClock(currentSlideTargetSeconds)}
        stepIndex={presenterStepIndex}
        totalTimeLabel={formatClock(displayedTimeSeconds)}
        triggerAnimationIds={triggerAnimationIds}
      />
    );
  }

  if (shouldShowRehearsalCompletion && deck) {
    return (
      <RehearsalCompletionScreen
        hasReportTarget={Boolean(run?.runId)}
        isReportPending={phase === "uploading" || phase === "processing"}
        onPrimaryAction={handleCompletionPrimaryAction}
        onPracticeAgain={handleCompletionPracticeAgain}
        summary={rehearsalSummary}
      />
    );
  }

  if (shouldShowRehearsalPreflight && deck) {
    return (
      <RehearsalPreflightScreen
        canStart={canRecord}
        deck={deck}
        previousSummary={previousPracticeSummary}
        onPracticeWithoutVoice={() => {
          setElapsedSeconds(0);
          setSlideElapsedSeconds(0);
          setHasLocalCompletion(false);
          setIsTimerRunning(true);
        }}
        onStart={() => void startRecording()}
      />
    );
  }

  return (
    <main className="rehearsal-presenter-shell">
      <div className="rehearsal-legacy-test-marker" aria-hidden="true">
        Live STT / Report AI / Speaker notes
      </div>
      {isLiveStopModalOpen ? (
        <div className="rehearsal-live-stop-modal-backdrop" role="presentation">
          <section
            aria-labelledby="rehearsal-live-stop-modal-title"
            aria-modal="true"
            className="rehearsal-live-stop-modal"
            role="dialog"
          >
            <span className="rehearsal-live-stop-modal-icon" aria-hidden="true">
              <CheckCircle2 size={28} />
            </span>
            <h2 id="rehearsal-live-stop-modal-title">
              Live STT가 종료되었습니다
            </h2>
            <p>
              {run?.runId
                ? `현재 리허설 runId는 ${run.runId}입니다.`
                : "Live STT 단독 실행은 runId를 만들지 않습니다. 리포트 녹음 흐름에서 runId가 생성됩니다."}
            </p>
            <button
              className="primary-action"
              type="button"
              onClick={() => setIsLiveStopModalOpen(false)}
            >
              확인
            </button>
          </section>
        </div>
      ) : null}
      <header className="rehearsal-presenter-topbar">
        <button
          className={`rehearsal-exit-button ${
            advanceControllerState.status === "finish-suggested"
              ? "auto-advance-finish-highlight"
              : ""
          }`}
          type="button"
          onClick={finishRehearsal}
        >
          <Presentation size={16} />
          {"\ub9ac\ud5c8\uc124 \ub9c8\uce58\uae30"}
        </button>
        <h1 className="rehearsal-smoke-heading">리허설</h1>
        <span className="rehearsal-session-status">
          <span aria-hidden="true" />
          리허설 · 자동 따라가기
        </span>

        {deck ? (
          <div className="rehearsal-display-toolbar">
            <DisplayControls
              channelStatus={presentationChannel.status}
              onOpenSlideDisplay={openSlideDisplay}
              onRequestDisplayScreens={requestDisplayScreens}
              onRequestSlideWindowFullscreen={requestSlideWindowFullscreen}
            />
            <button
              className="presenter-single-screen-button"
              type="button"
              onClick={() => setIsSingleScreenOpen(true)}
            >
              <Monitor size={16} />
              단일 화면
            </button>
          </div>
        ) : null}

        <span
          className={`rehearsal-recording-status ${
            isRehearsalRuntimeActive ? "rehearsal-recording-status-active" : ""
          }`}
        >
          <span aria-hidden="true" />
          {rehearsalRuntimeStatusLabel}
        </span>

        <div className="rehearsal-timer-pill" aria-live="polite">
          <span className="timer-wave" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <label className="rehearsal-time-mode">
            <select
              aria-label="Time display mode"
              value={timeMode}
              onChange={(event) => {
                setTimeMode(event.target.value as RehearsalTimeMode);
                resetRehearsalTimerState({
                  setElapsedSeconds,
                  setSlideElapsedSeconds,
                  setIsTimerRunning,
                });
              }}
            >
              <option value="stopwatch">{"\uc2a4\ud1b1\uc6cc\uce58"}</option>
              <option value="timer">{"\ud0c0\uc774\uba38"}</option>
            </select>
            <span className="rehearsal-select-caret" aria-hidden="true" />
          </label>
          <div className="rehearsal-time-fields">
            <input
              aria-label="Elapsed time"
              inputMode="numeric"
              value={elapsedTimeInput}
              onBlur={(event) => commitElapsedTimeInput(event.target.value)}
              onChange={(event) => {
                setEditingTimeField("elapsed");
                setElapsedTimeInput(event.target.value);
              }}
              onFocus={() => setEditingTimeField("elapsed")}
            />
            <span aria-hidden="true">/</span>
            <input
              aria-label="Target time"
              inputMode="numeric"
              value={timerDurationInput}
              onBlur={(event) => commitTimerDurationInput(event.target.value)}
              onChange={(event) => {
                setEditingTimeField("duration");
                setTimerDurationInput(event.target.value);
              }}
              onFocus={() => setEditingTimeField("duration")}
            />
          </div>
          <button
            type="button"
            aria-label={isTimerRunning ? "Pause time" : "Start time"}
            onClick={() => void handleTimePrimaryAction()}
            disabled={!isTimerRunning && !canRecord}
          >
            {isTimerRunning ? <Square size={16} /> : <PlayCircle size={16} />}
          </button>
          <button
            type="button"
            aria-label="Reset timer"
            onClick={() => {
              resetRehearsalTimerState({
                setElapsedSeconds,
                setSlideElapsedSeconds,
                setIsTimerRunning,
              });
            }}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </header>
      <div
        className="rehearsal-smoke-controls"
        aria-label="리허설 smoke controls"
      >
        <button
          type="button"
          onClick={() => void startRecording()}
          disabled={!canRecord}
        >
          리포트 녹음 시작
        </button>
        <button
          type="button"
          onClick={stopRecording}
          disabled={phase !== "recording"}
        >
          리포트 녹음 종료
        </button>
        <span>{phase}</span>
        <span>{liveStatus}</span>
        {hasDeletedRawAudio ? <span>raw audio 삭제 완료</span> : null}
      </div>

      <section className="rehearsal-presenter-layout">
        <section className="rehearsal-presenter-main">
          <div className="rehearsal-stage-wrap" ref={presenterStageRef}>
            {deck && currentSlide ? (
              <>
                <span className="rehearsal-stage-label">현재</span>
                <SlideshowRenderer
                  deck={deck}
                  scale={presenterScale}
                  slideId={currentSlide.slideId}
                  stepIndex={presenterStepIndex}
                  triggerAnimationIds={triggerAnimationIds}
                />
                <span className="rehearsal-stage-index">
                  {String(currentSlideIndex + 1).padStart(2, "0")} /{" "}
                  {String(deck.slides.length).padStart(2, "0")}
                </span>
              </>
            ) : (
              <div className="rehearsal-empty-stage">
                {"\ubc1c\ud45c\uc790\ub8cc \ub85c\ub529 \uc911"}
              </div>
            )}
          </div>

          <div className="rehearsal-slide-controls">
            <button
              type="button"
              onClick={goPrevious}
              disabled={currentSlideIndex === 0}
              aria-label="이전 슬라이드"
              title="이전 슬라이드"
            >
              <ChevronLeft size={24} />
            </button>
            <span>
              {currentSlideIndex + 1} / {deck?.slides.length ?? 0}
            </span>
            <button
              type="button"
              onClick={goNext}
              disabled={!deck || currentSlideIndex >= deck.slides.length - 1}
              aria-label="다음 슬라이드"
              title="다음 슬라이드"
            >
              <ChevronRight size={24} />
            </button>
          </div>

          <section className="rehearsal-next-slide-preview" aria-label="다음 슬라이드">
            <div className="rehearsal-next-slide-frame">
              {deck && nextSlide ? (
                <SlideshowRenderer
                  deck={deck}
                  playInitialEntryAnimations={false}
                  renderMode="presenter"
                  scale={miniSlideScale}
                  slideId={nextSlide.slideId}
                  stepIndex={0}
                />
              ) : (
                <span>마지막 슬라이드</span>
              )}
            </div>
            <div>
              <span>다음 슬라이드</span>
              <strong>{nextSlide ? getSlideTitle(nextSlide) : "다음 슬라이드 없음"}</strong>
              {nextSlide?.keywords?.[0] ? (
                <p>"{nextSlide.keywords[0].text}"를 말하면 바로 이어집니다</p>
              ) : (
                <p>마지막 문장을 정리하고 마무리하세요</p>
              )}
            </div>
          </section>
        </section>

        <aside className="rehearsal-presenter-side">
          <section
            className="rehearsal-side-timer-card"
            aria-label="리허설 타이머"
          >
            <div className="rehearsal-side-timer-hero">
              <div className="rehearsal-side-timer-header">
                <div>
                  <span className="rehearsal-side-timer-title">
                    {"\ubc1c\ud45c \uc2dc\uac04"}
                  </span>
                  <input
                    className="rehearsal-side-timer-time"
                    aria-label="발표 시간 설정"
                    inputMode="numeric"
                    value={
                      editingTimeField === "duration"
                        ? timerDurationInput
                        : formatClock(displayedTimeSeconds)
                    }
                    onBlur={(event) => {
                      setTimeMode("timer");
                      commitTimerDurationInput(event.target.value);
                    }}
                    onChange={(event) => {
                      setEditingTimeField("duration");
                      setTimerDurationInput(event.target.value);
                    }}
                    onFocus={() => {
                      setEditingTimeField("duration");
                      setTimerDurationInput(formatClock(timerDurationSeconds));
                    }}
                  />
                </div>
                <div className="rehearsal-side-timer-actions">
                  <button
                    type="button"
                    aria-label={
                      phase === "recording"
                        ? "리포트 녹음 종료"
                        : canStopLiveDemo
                        ? "Live STT 종료"
                        : isTimerRunning
                          ? "타이머 일시정지"
                          : "리포트 녹음 시작"
                    }
                    onClick={handleSideTimerPrimaryAction}
                    disabled={!deck && !isTimerRunning}
                  >
                    {canStopLiveDemo || isTimerRunning ? (
                      <Square size={15} />
                    ) : (
                      <PlayCircle size={15} />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="타이머 초기화"
                    onClick={() => {
                      resetRehearsalTimerState({
                        setElapsedSeconds,
                        setSlideElapsedSeconds,
                        setIsTimerRunning,
                      });
                    }}
                  >
                    <RotateCcw size={15} />
                  </button>
                </div>
              </div>

              <div className="rehearsal-side-audio-gauge" aria-hidden="true">
                <span className="rehearsal-side-timer-wave" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className="rehearsal-side-audio-track">
                  <span style={{ width: `${liveAudioLevelPercent}%` }} />
                </span>
              </div>

              <div className="rehearsal-side-timer-progress" aria-hidden="true">
                <span style={{ width: `${rehearsalProgressPercent}%` }} />
              </div>

              <div className="rehearsal-side-timer-meta">
                <span>
                  {"\ud604\uc7ac "}
                  {formatClock(p3TimingSnapshot.currentSlideElapsedSeconds)}
                </span>
                <span>
                  {"\uc608\uc0c1 "}
                  {formatClock(p3TimingSnapshot.currentSlideTargetSeconds)}
                </span>
              </div>
            </div>

            <div className="rehearsal-side-detail-grid">
              <article className="rehearsal-side-detail-card">
                <span>{"\ud604\uc7ac \uc2ac\ub77c\uc774\ub4dc"}</span>
                <strong>
                  {"\uc2ac\ub77c\uc774\ub4dc "}
                  {currentSlideIndex + 1} / {deck?.slides.length ?? 0}
                </strong>
                <small>
                  {currentSlide ? getSlideTitle(currentSlide) : "-"}
                </small>
              </article>
              <article className="rehearsal-side-detail-card rehearsal-side-advice-card">
                <span>{"\uc870\uc5b8"}</span>
                <strong>{p3WordsPerMinute} WPM</strong>
                <small>
                  {getRehearsalPaceSummaryLabel(p3AdviceState.pace)}
                  {p3AdviceState.slideOvertime
                    ? " / 슬라이드 시간 초과"
                    : " / 슬라이드 정상"}
                </small>
              </article>
            </div>
          </section>

          <RehearsalPanel
            mode="rehearsal"
            timing={p3TimingSnapshot}
            wordsPerMinute={p3WordsPerMinute}
            adviceState={p3AdviceState}
            keywords={checklistKeywords}
            sentences={p3Sentences}
            showAdvicePanel={false}
            showScriptPanel={false}
            snapshot={p3PanelSnapshot}
            liveSlot={
              <section className="rehearsal-assist-card checklist-card">
                <header>
                  <span>
                    <Mic size={16} />
                    Live STT
                  </span>
                  <button type="button" aria-label="More checklist options">
                    <MoreHorizontal size={18} />
                  </button>
                </header>

                <div
                  className={`rehearsal-live-status rehearsal-live-status-${liveStatus}`}
                >
                  <strong>{liveStatus}</strong>
                  <span>
                    {p3RunMeta
                      ? `로컬 메타 ${p3RunMeta.slideTimeline.length}개 슬라이드`
                      : advanceControllerState.status === "countdown"
                        ? "자동 전환 카운트다운"
                        : advanceControllerState.status === "blocked-by-builds"
                          ? "빌드 대기"
                          : advanceControllerState.status === "finish-suggested"
                            ? "종료 제안"
                            : "자동 전환 활성"}
                  </span>
                </div>

                <AutoAdvanceStatus
                  countdownMs={presenterSettings.advancePolicy.countdownMs}
                  nowMs={autoAdvanceNowMs}
                  onFinish={finishRehearsal}
                  state={advanceControllerState}
                />

                <AutoAdvanceSettings
                  policy={presenterSettings.advancePolicy}
                  saveSettings={savePresenterSettings}
                />

                <div className="rehearsal-live-actions rehearsal-live-actions-legacy">
                  <button
                    className="primary-action"
                    type="button"
                    onClick={() => void startLiveDemo()}
                    disabled={!canStartLiveDemo}
                  >
                    <Mic size={18} />
                    Live STT 시작
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => stopLiveDemo({ showCompletionModal: true })}
                    disabled={!canStopLiveDemo}
                  >
                    <Square size={18} />
                    Live STT 종료
                  </button>
                </div>

                <div
                  className={`rehearsal-live-audio-meter rehearsal-live-audio-meter-${liveAudioMeterState}`}
                >
                  <div className="rehearsal-live-audio-meter-header">
                    <span>Mic input</span>
                    <strong>{liveAudioLevelLabel}</strong>
                  </div>
                  <div
                    className="rehearsal-live-audio-meter-track"
                    role="meter"
                    aria-label="Mic input level"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(liveAudioLevelPercent)}
                    aria-valuetext={liveAudioLevelLabel}
                  >
                    <span style={{ width: `${liveAudioLevelPercent}%` }} />
                  </div>
                  <small>
                    {liveAudioLevel
                      ? `${Math.round(liveAudioLevel.rmsDb)} dB RMS`
                      : "-100 dB RMS"}
                  </small>
                </div>
                {canDownloadLiveSttDebugPcm ? (
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => {
                      if (liveDebugPcmRecording) {
                        downloadLiveSttDebugPcm(liveDebugPcmRecording);
                      }
                    }}
                  >
                    <Download size={16} />
                    모델 입력 WAV 다운로드
                  </button>
                ) : null}

                {liveCue && (
                  <div className="job-status" aria-live="polite">
                    <div>
                      <strong>emphasis</strong>
                      <span>{liveCue.text}</span>
                    </div>
                    <p>현재 슬라이드에서 키워드를 감지했습니다.</p>
                  </div>
                )}

                {liveSlideAdvance && (
                  <div className="project-status-message project-status-success">
                    <CheckCircle2 size={18} />
                    <span>
                      키워드 {Math.round(liveSlideAdvance.coverage * 100)}%
                      감지로 자동 전환
                    </span>
                  </div>
                )}

                {liveError && (
                  <div
                    className="project-status-message project-status-danger"
                    role="status"
                  >
                    <AlertCircle size={18} />
                    <span>{liveError}</span>
                  </div>
                )}
              </section>
            }
          />
        </aside>

        <RehearsalTeleprompter
          countdownMs={presenterSettings.advancePolicy.countdownMs}
          nowMs={autoAdvanceNowMs}
          onCancel={cancelAutoAdvanceForManualCommand}
          rows={prompterRows}
          state={advanceControllerState}
        />
      </section>
    </main>
  );
}

function RehearsalPreflightScreen(props: {
  canStart: boolean;
  deck: Deck;
  onPracticeWithoutVoice: () => void;
  onStart: () => void;
  previousSummary: RehearsalPracticeSummary | null;
}) {
  const commandPhrases = defaultRehearsalCommandConfig
    .map((command) => command.phrases[0])
    .filter(Boolean)
    .slice(0, 3);
  const triggerCount = defaultRehearsalCommandConfig.reduce(
    (count, command) => count + command.phrases.length,
    0,
  );
  const preflightBanner = buildRehearsalPreflightBanner(
    props.deck,
    props.previousSummary,
  );
  const microphoneReadiness = getMicrophoneReadinessLabel();

  return (
    <main className="rehearsal-preflight-screen" aria-label="리허설 시작 전">
      <div className="rehearsal-legacy-test-marker" aria-hidden="true">
        Live STT / Report AI / Speaker notes
      </div>
      <div className="rehearsal-preflight-banner">
        <Zap size={17} />
        <span>{preflightBanner}</span>
      </div>

      <section className="rehearsal-preflight-card">
        <div className="rehearsal-preflight-mic" aria-hidden="true">
          <span>
            <Mic size={42} />
          </span>
        </div>
        <div className="rehearsal-preflight-copy">
          <h1>리허설을 시작할까요?</h1>
          <p>시작하면 마이크를 확인하고 바로 준비 완료 상태로 이어집니다.</p>
        </div>

        <div className="rehearsal-preflight-chain" aria-label="리허설 준비 상태">
          <PreflightStatusRow label="마이크 권한 확인" value={microphoneReadiness} />
          <PreflightStatusRow label="음성 인식 준비" value="한국어 · Live STT" />
          <PreflightStatusRow
            label={`슬라이드 ${props.deck.slides.length}장 로드됨`}
            value={`음성 트리거 ${triggerCount}개`}
          />
        </div>

        <div className="rehearsal-preflight-commands" aria-label="음성 명령 예시">
          {commandPhrases.map((phrase) => (
            <span key={phrase}>"{phrase}"</span>
          ))}
        </div>

        <div className="rehearsal-preflight-actions">
          <button
            className="rehearsal-preflight-start"
            disabled={!props.canStart}
            type="button"
            onClick={props.onStart}
          >
            <PlayCircle size={18} />
            리허설 시작
          </button>
          <button
            className="rehearsal-preflight-quiet"
            type="button"
            onClick={props.onPracticeWithoutVoice}
          >
            음성 없이 연습하기
          </button>
        </div>
      </section>
    </main>
  );
}

function PreflightStatusRow(props: { label: string; value: string }) {
  return (
    <div>
      <span>
        <CheckCircle2 size={14} />
      </span>
      <strong>{props.label}</strong>
      <small>{props.value}</small>
    </div>
  );
}

type RehearsalCompletionSummary = {
  comparisonLabel: string;
  coverageLabel: string;
  coveragePercent: number;
  durationLabel: string;
  durationSeconds: number;
  hasSpeechTrackingData: boolean;
  missedKeywordRows: Array<{
    key: string;
    label: string;
    slideLabel: string;
  }>;
  missedKeywordCount: number;
  missedKeywordCountLabel: string;
  missedKeywordEmptyLabel: string;
  targetDeltaLabel: string;
  targetLabel: string;
  targetSeconds: number;
};

function RehearsalCompletionScreen(props: {
  hasReportTarget: boolean;
  isReportPending: boolean;
  onPracticeAgain: () => void;
  onPrimaryAction: () => void;
  summary: RehearsalCompletionSummary;
}) {
  return (
    <main className="rehearsal-completion-screen" aria-label="리허설 종료 후 요약">
      <section className="rehearsal-completion-card">
        <header>
          <div>
            <span>리허설 완료</span>
            <h1>수고했어요, 잘 마쳤어요</h1>
          </div>
          {props.summary.comparisonLabel ? (
            <strong>
              <Zap size={15} />
              {props.summary.comparisonLabel}
            </strong>
          ) : null}
        </header>

        <div className="rehearsal-completion-body">
          <section className="rehearsal-completion-time">
            <span>발표 시간</span>
            <strong>{props.summary.durationLabel}</strong>
            <small>
              목표 {props.summary.targetLabel} · {props.summary.targetDeltaLabel}
            </small>
          </section>

          <section className="rehearsal-completion-details">
            <div className="rehearsal-completion-coverage">
              <div>
                <span>대본 커버리지</span>
                <strong>{props.summary.coverageLabel}</strong>
              </div>
              <span aria-hidden="true">
                <i style={{ width: `${props.summary.coveragePercent}%` }} />
              </span>
            </div>

            <div className="rehearsal-completion-missed">
              <h2>
                놓친 항목 <strong>{props.summary.missedKeywordCountLabel}</strong>
              </h2>
              {props.summary.missedKeywordRows.length > 0 ? (
                props.summary.missedKeywordRows.map((row) => (
                  <div key={row.key}>
                    <span aria-hidden="true" />
                    <strong>{row.label}</strong>
                    <small>{row.slideLabel}</small>
                  </div>
                ))
              ) : (
                <p>{props.summary.missedKeywordEmptyLabel}</p>
              )}
            </div>
          </section>
        </div>

        <div className="rehearsal-completion-report-state" role="status">
          {props.isReportPending ? <span aria-hidden="true" /> : <CheckCircle2 size={16} />}
          <p>
            {props.isReportPending
              ? "자세한 리포트 준비 중 — 잠시 후 청중 반응·페이스 분석이 도착해요"
              : props.hasReportTarget
                ? "자세한 리포트를 열어 더 깊은 분석을 확인할 수 있어요"
                : "로컬 요약이 준비됐어요. 서버 리포트 없이 바로 다시 연습할 수 있어요"}
          </p>
        </div>

        <footer>
          <button type="button" onClick={props.onPracticeAgain}>
            다시 연습
          </button>
          <button type="button" onClick={props.onPrimaryAction}>
            {props.isReportPending
              ? "리포트 기다리기"
              : props.hasReportTarget
                ? "리포트 보기"
                : "확인"}
          </button>
        </footer>
      </section>
    </main>
  );
}

function RehearsalTeleprompter(props: {
  countdownMs: number;
  nowMs: number;
  onCancel: () => void;
  rows: RehearsalPrompterRows;
  state: AdvanceControllerState;
}) {
  const countdownSeconds = getAutoAdvanceCountdownSeconds(
    props.state,
    props.countdownMs,
    props.nowMs,
  );

  return (
    <section className="rehearsal-teleprompter-band" aria-label="발표 대본 프롬프터">
      <p>{props.rows.previous}</p>
      <p>
        <span>{props.rows.currentLead}</span>
        <strong>{props.rows.currentEmphasis}</strong>
        <span>{props.rows.currentTail}</span>
      </p>
      <p>{props.rows.next}</p>

      {countdownSeconds !== null ? (
        <div className="rehearsal-auto-advance-card" role="status">
          <strong>{countdownSeconds}</strong>
          <span>다음으로 자동 전환</span>
          <button type="button" onClick={props.onCancel}>
            취소
          </button>
        </div>
      ) : props.state.status === "blocked-by-builds" ? (
        <div className="rehearsal-auto-advance-card rehearsal-auto-advance-card-muted" role="status">
          <strong>{props.state.remainingTriggerSteps}</strong>
          <span>빌드가 남아 있어요</span>
        </div>
      ) : props.state.status === "finish-suggested" ? (
        <div className="rehearsal-auto-advance-card rehearsal-auto-advance-card-muted" role="status">
          <CheckCircle2 size={22} />
          <span>발표 종료 준비됨</span>
        </div>
      ) : null}
    </section>
  );
}

export function RehearsalReportPage(props: {
  initialDeck?: Deck;
  initialReport?: RehearsalReport | null;
  initialRun?: RehearsalRun | null;
  projectId: string;
  runId: string;
}) {
  const [deck, setDeck] = useState<Deck | null>(props.initialDeck ?? null);
  const [run, setRun] = useState<RehearsalRun | null>(props.initialRun ?? null);
  const [report, setReport] = useState<RehearsalReport | null>(
    props.initialReport ?? null,
  );
  const [status, setStatus] = useState<RehearsalReportStatus>(
    props.initialReport ? "ready" : "loading",
  );
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    if (!props.initialDeck) {
      void fetchRehearsalDeck(props.projectId)
        .then((nextDeck) => {
          if (isMounted) setDeck(nextDeck);
        })
        .catch(() => {
          if (isMounted) setDeck(null);
        });
    }

    if (props.initialReport !== undefined) {
      return () => {
        isMounted = false;
      };
    }

    setStatus("loading");
    setError("");

    void fetchRehearsalReport(props.runId)
      .then((response) => {
        if (!isMounted) return;

        const nextState = resolveRehearsalReportLoadState(
          response,
          props.projectId,
        );
        setRun(response.run);
        setReport(nextState.status === "ready" ? response.report : null);
        setStatus(nextState.status);
        setError(nextState.error);
      })
      .catch((cause) => {
        if (!isMounted) return;

        setReport(null);
        setStatus("failed");
        setError(toRehearsalFlowMessage(cause));
      });

    return () => {
      isMounted = false;
    };
  }, [props.initialDeck, props.initialReport, props.projectId, props.runId]);

  const reportDate = formatReportDate(
    report?.generatedAt ?? run?.updatedAt ?? run?.createdAt,
  );
  const slideCount = deck?.slides.length;
  const coachingHeadline = buildCoachingHeadline(report);
  const coachingDetail = buildCoachingDetail(report, deck);
  const missedKeywords = report?.missedKeywords ?? [];
  const missedKeywordRows = buildMissedKeywordRows(deck, missedKeywords);
  const slideTimings = report?.slideTimings ?? [];
  const qnaSummary = report?.qnaSummary;
  const speedAssessment = report
    ? getSpeakingSpeedAssessment(report.metrics.wordsPerMinute)
    : null;
  const speakingSpeedValue = report
    ? formatSpeakingSpeedValue(report.metrics.wordsPerMinute)
    : "-";
  const completionPercent = formatRehearsalCompletionPercent(
    deck,
    slideTimings,
  );

  return (
    <main className="rehearsal-report-page">
      <header className="rehearsal-report-topbar">
        <div className="rehearsal-report-topbar-left">
          <span className="report-brand-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <strong>Orbit AI</strong>
          <button
            type="button"
            onClick={() => navigateToRehearsal(props.projectId)}
            aria-label="홈으로 이동"
          >
            <Home size={18} />
          </button>
          <span className="report-project-title">{deck?.title ?? "제목"}</span>
          <ChevronDown size={16} />
          <span className="report-save-state">
            <Save size={15} />
            저장됨
          </span>
        </div>
        <div className="rehearsal-report-topbar-actions">
          <span>알렉스</span>
          <span className="report-avatar" aria-hidden="true">
            김
          </span>
          <span className="report-mode-switch" aria-label="보기 모드">
            <button type="button">편집</button>
            <button className="active" type="button">
              보기
            </button>
          </span>
          <button type="button">
            <Monitor size={18} />
            리허설
          </button>
          <button type="button">
            <BarChart3 size={18} />
            AI 리포트
          </button>
          <button className="report-present-button" type="button">
            <PlayCircle size={18} />
            프레젠테이션
            <ChevronDown size={16} />
          </button>
        </div>
      </header>

      <div className="rehearsal-report-body">
        <aside className="rehearsal-report-nav" aria-label="리허설 리포트 목록">
          <section className="report-nav-section-active">
            <h2>
              <ChevronDown size={24} />
              리허설 리포트
            </h2>
            <button className="rehearsal-report-nav-item active" type="button">
              <strong>
                <CalendarDays size={15} />
                1회차
              </strong>
              <span>{reportDate}</span>
            </button>
          </section>

          <section>
            <h2>
              <ChevronRight size={24} />
              실전 리포트
            </h2>
          </section>
        </aside>

        <section className="rehearsal-report-document" aria-live="polite">
          <header className="rehearsal-report-document-header">
            <h1>1회차 리허설 리포트</h1>
            <time>{reportDate}</time>
          </header>

          {report ? (
            <div className="rehearsal-report-document-grid">
              <section className="report-overview-card">
                <div className="report-overview-copy">
                  <h2>{coachingHeadline}</h2>
                  <p>{coachingDetail}</p>
                </div>
                <div className="report-score-list">
                  <div>
                    <span>평균 속도</span>
                    <strong>{speakingSpeedValue}</strong>
                  </div>
                  <div>
                    <span>키워드 커버리지</span>
                    <strong>
                      {Math.round(report.metrics.keywordCoverage * 100)}%
                    </strong>
                  </div>
                  <div>
                    <span>코칭 상태</span>
                    <strong>{report.coaching?.status ?? "대기"}</strong>
                  </div>
                </div>
              </section>

              <section className="report-summary-card report-dashboard-card">
                <div className="report-summary-row">
                  <span>총 소요 시간</span>
                  <strong>
                    {formatDuration(report.metrics.durationSeconds)}
                  </strong>
                </div>
                <div className="report-summary-row">
                  <span>사용한 슬라이드 수</span>
                  <strong>
                    {typeof slideCount === "number" ? slideCount : "-"}
                  </strong>
                </div>
                <div className="report-mini-metrics">
                  <div>
                    <span>목표 시간</span>
                    <strong>
                      {formatDuration(getTargetDurationSeconds(deck))}
                    </strong>
                  </div>
                  <div>
                    <span>완료율</span>
                    <strong>{completionPercent}</strong>
                  </div>
                </div>
              </section>

              <section className="report-speed-card report-dashboard-card">
                <h2>
                  <Gauge size={18} />
                  평균 발표 속도
                </h2>
                <div
                  className="report-speed-gauge"
                  role="meter"
                  aria-label="평균 발표 속도"
                  aria-valuemin={80}
                  aria-valuemax={180}
                  aria-valuenow={speedAssessment?.meterValue ?? 80}
                >
                  <span className="speed-mark speed-mark-left">100</span>
                  <span className="speed-mark speed-mark-right">150</span>
                  <strong
                    className={
                      speedAssessment?.isUnreliable
                        ? "report-speed-warning"
                        : undefined
                    }
                  >
                    {speedAssessment?.displayValue ?? "-"}
                  </strong>
                </div>
                <p>{speedAssessment?.message}</p>
              </section>

              <section className="report-voice-card report-dashboard-card">
                <h2>
                  <Volume2 size={20} />
                  음성 분석
                </h2>
                <div className="report-official-metrics">
                  <div>
                    <span>불필요한 표현</span>
                    <strong>{report.metrics.fillerWordCount}회</strong>
                  </div>
                  <div>
                    <span>긴 멈춤</span>
                    <strong>{report.metrics.pauseCount}회</strong>
                  </div>
                </div>
                <p>서버 리포트가 제공한 말버릇과 멈춤 지표만 표시합니다.</p>
              </section>

              <section className="report-keyword-card report-dashboard-card">
                <h2>
                  <Target size={20} />
                  누락 키워드
                </h2>
                <p>실전 발표 중 다시 알려줄 핵심 데이터입니다.</p>
                {missedKeywords.length > 0 ? (
                  <>
                    <span className="report-keyword-count">
                      총 {missedKeywords.length}개
                    </span>
                    <div className="report-keyword-slide-list">
                      {missedKeywordRows.map((row) => (
                        <p key={row.slideId}>
                          <strong>{row.label}</strong>
                          {row.keywords.map((keyword) => (
                            <span
                              key={`${keyword.slideId}-${keyword.keywordId}`}
                            >
                              {keyword.text}
                            </span>
                          ))}
                        </p>
                      ))}
                    </div>
                    <strong className="report-keyword-warning">
                      서버 리포트가 확인한 누락 키워드만 표시합니다.
                    </strong>
                  </>
                ) : (
                  <strong className="report-keyword-empty">
                    공식 누락 키워드 상세 데이터가 없습니다.
                  </strong>
                )}
              </section>

              <section className="report-dashboard-card">
                <h2>
                  <CalendarDays size={20} />
                  슬라이드별 시간
                </h2>
                {slideTimings.length > 0 ? (
                  <div className="report-official-metrics">
                    {slideTimings.slice(0, 4).map((timing) => (
                      <div key={timing.slideId}>
                        <span>
                          {formatSlideTimingLabel(deck, timing.slideId)}
                        </span>
                        <strong>
                          {formatDuration(timing.actualSeconds)} /{" "}
                          {formatDuration(timing.targetSeconds)}
                        </strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <strong className="report-keyword-empty">
                    공식 슬라이드 시간 데이터가 아직 없습니다.
                  </strong>
                )}
              </section>

              <section className="report-dashboard-card">
                <h2>
                  <BarChart3 size={20} />
                  QnA 피드백
                </h2>
                <div className="report-official-metrics">
                  <div>
                    <span>질문 수</span>
                    <strong>{qnaSummary?.questionCount ?? 0}개</strong>
                  </div>
                </div>
                <p>
                  {qnaSummary?.questionSummary ||
                    "질문 원문은 저장하지 않으며, 요약 데이터가 생기면 이 영역에 표시합니다."}
                </p>
                {qnaSummary?.unclearTopics.length ? (
                  <div className="report-keyword-chips">
                    {qnaSummary.unclearTopics.map((topic) => (
                      <span
                        key={`${topic.slideId ?? "general"}-${topic.topic}`}
                      >
                        {topic.topic}
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="report-coaching-card report-dashboard-card">
                <h2>
                  <Presentation size={20} />
                  다음 연습
                </h2>
                <div className="report-coaching-columns">
                  <div>
                    <strong>강점</strong>
                    <ul>
                      {(report.coaching?.strengths.length
                        ? report.coaching.strengths
                        : ["말이 분명하고 빠르지 않음", "불필요한 말버릇 없음"]
                      )
                        .slice(0, 3)
                        .map((strength) => (
                          <li key={strength}>{strength}</li>
                        ))}
                    </ul>
                  </div>
                  <div>
                    <strong>개선 포인트</strong>
                    <ul>
                      {(report.coaching?.improvements.length
                        ? report.coaching.improvements
                        : [
                            "자료 설명을 짧게 줄이기",
                            "누락 키워드를 노트에 고정하기",
                          ]
                      )
                        .slice(0, 3)
                        .map((improvement) => (
                          <li key={improvement}>{improvement}</li>
                        ))}
                    </ul>
                  </div>
                </div>
                <p>
                  {report.coaching?.nextPracticeFocus ||
                    "핵심 메시지를 먼저 말하는 흐름을 연습하세요."}
                </p>
              </section>
            </div>
          ) : (
            <div
              className={
                status === "failed"
                  ? "report-page-state status-error"
                  : "report-page-state"
              }
            >
              <BarChart3 size={28} />
              <strong>{formatEmptyReportMessage(status, error)}</strong>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

type RehearsalPrompterRows = {
  currentEmphasis: string;
  currentLead: string;
  currentTail: string;
  next: string;
  previous: string;
};

function getRehearsalPrompterRows(
  sentences: readonly ExtractedSentence[],
  coveredSentenceIds: readonly string[],
  fallbackNotes: string,
): RehearsalPrompterRows {
  if (sentences.length === 0) {
    const fallback = fallbackNotes.trim() || "발표자 노트가 없습니다.";
    return {
      previous: "",
      ...splitPrompterSentence(fallback),
      next: "",
    };
  }

  const focusSentenceId = getRehearsalScriptFocusSentenceId(
    sentences,
    coveredSentenceIds,
  );
  const focusIndex = Math.max(
    0,
    sentences.findIndex((sentence) => sentence.sentenceId === focusSentenceId),
  );
  const current = sentences[focusIndex]?.text ?? sentences[0]?.text ?? "";

  return {
    previous: sentences[focusIndex - 1]?.text ?? "",
    ...splitPrompterSentence(current),
    next: sentences[focusIndex + 1]?.text ?? "",
  };
}

function splitPrompterSentence(text: string) {
  const quoteMatch = text.match(/("[^"]+"|'[^']+'|“[^”]+”)/);
  if (quoteMatch?.index !== undefined) {
    const emphasis = quoteMatch[0];
    return {
      currentLead: text.slice(0, quoteMatch.index),
      currentEmphasis: emphasis,
      currentTail: text.slice(quoteMatch.index + emphasis.length),
    };
  }

  const words = text.trim().split(/\s+/).filter(Boolean);
  const emphasisWordCount = Math.min(words.length, words.length > 4 ? 2 : 1);
  const currentEmphasis = words.slice(0, emphasisWordCount).join(" ");
  return {
    currentLead: "",
    currentEmphasis,
    currentTail: text.trim().slice(currentEmphasis.length),
  };
}

function buildRehearsalCompletionSummary(options: {
  deck: Deck | null;
  elapsedSeconds: number;
  meta: RehearsalRunMeta | null;
  previousSummary: RehearsalPracticeSummary | null;
  snapshot: SpeechTrackerSnapshot;
  targetSeconds: number;
}): RehearsalCompletionSummary {
  const targetSeconds =
    options.targetSeconds > 0
      ? options.targetSeconds
      : getTargetDurationSeconds(options.deck);
  const elapsedSeconds =
    options.elapsedSeconds > 0 ? options.elapsedSeconds : targetSeconds;
  const missedKeywordRows = buildLocalMissedKeywordRows(
    options.deck,
    options.meta,
  );
  const hasSpeechTrackingData = Boolean(options.meta);
  const coveragePercent =
    hasSpeechTrackingData && options.snapshot.matchableSentenceCount > 0
      ? Math.round(options.snapshot.effectiveCoverage * 100)
      : hasSpeechTrackingData && missedKeywordRows.length > 0
        ? 0
        : hasSpeechTrackingData
          ? 100
          : 0;
  const missedKeywordCount = options.meta?.missedKeywords.length ?? 0;

  return {
    comparisonLabel: buildRehearsalComparisonLabel(
      elapsedSeconds,
      targetSeconds,
      options.previousSummary,
    ),
    coverageLabel: hasSpeechTrackingData
      ? `${clamp(coveragePercent, 0, 100)}%`
      : "측정 안 됨",
    coveragePercent: clamp(coveragePercent, 0, 100),
    durationLabel: formatClock(elapsedSeconds),
    durationSeconds: elapsedSeconds,
    hasSpeechTrackingData,
    missedKeywordRows,
    missedKeywordCount,
    missedKeywordCountLabel: hasSpeechTrackingData
      ? String(missedKeywordCount)
      : "-",
    missedKeywordEmptyLabel: hasSpeechTrackingData
      ? "놓친 핵심 항목이 없습니다."
      : "음성 추적 데이터가 없습니다.",
    targetDeltaLabel: formatTargetDeltaLabel(targetSeconds - elapsedSeconds),
    targetLabel: formatClock(targetSeconds),
    targetSeconds,
  };
}

function buildLocalMissedKeywordRows(
  deck: Deck | null,
  meta: RehearsalRunMeta | null,
): RehearsalCompletionSummary["missedKeywordRows"] {
  if (!deck || !meta) {
    return [];
  }

  const slidesById = new Map(deck.slides.map((slide) => [slide.slideId, slide]));
  return meta.missedKeywords.slice(0, 2).map((missedKeyword) => {
    const slide = slidesById.get(missedKeyword.slideId);
    const keyword = slide?.keywords?.find(
      (candidate) => candidate.keywordId === missedKeyword.keywordId,
    );

    return {
      key: `${missedKeyword.slideId}-${missedKeyword.keywordId}`,
      label: keyword?.text ?? missedKeyword.keywordId,
      slideLabel: slide ? `슬라이드 ${slide.order}` : missedKeyword.slideId,
    };
  });
}

function createRehearsalPracticeSummary(
  deck: Deck,
  summary: RehearsalCompletionSummary,
): RehearsalPracticeSummary {
  return {
    completedAt: new Date().toISOString(),
    coveragePercent: summary.coveragePercent,
    deckId: deck.deckId,
    durationSeconds: summary.durationSeconds,
    missedKeywordCount: summary.missedKeywordCount,
    projectId: deck.projectId,
    targetSeconds: summary.targetSeconds,
  };
}

function buildRehearsalPreflightBanner(
  deck: Deck,
  previousSummary: RehearsalPracticeSummary | null,
) {
  const targetLabel = formatDuration(getTargetDurationSeconds(deck));
  if (!previousSummary) {
    return `이번 목표는 ${targetLabel}입니다. 슬라이드와 음성 트리거를 확인하고 시작하세요.`;
  }

  return `지난 리허설은 ${formatDuration(
    previousSummary.durationSeconds,
  )}였습니다. 이번엔 ${targetLabel} 목표로 가볼까요?`;
}

function buildRehearsalComparisonLabel(
  elapsedSeconds: number,
  targetSeconds: number,
  previousSummary: RehearsalPracticeSummary | null,
) {
  if (previousSummary) {
    const previousDelta = previousSummary.durationSeconds - elapsedSeconds;
    if (previousDelta > 0) {
      return `지난번보다 ${formatDuration(previousDelta)} 빨랐어요`;
    }
    if (previousDelta < 0) {
      return `지난번보다 ${formatDuration(Math.abs(previousDelta))} 늦었어요`;
    }
    return "지난번과 같은 시간이에요";
  }

  const targetDelta = targetSeconds - elapsedSeconds;
  if (targetDelta > 0) {
    return `목표보다 ${formatDuration(targetDelta)} 빨랐어요`;
  }
  if (targetDelta < 0) {
    return `목표보다 ${formatDuration(Math.abs(targetDelta))} 초과했어요`;
  }
  return "목표 시간에 맞췄어요";
}

function readRehearsalPracticeSummary(
  projectId: string,
  deckId: string,
  storage: Pick<Storage, "getItem"> | null = readBrowserLocalStorage(),
): RehearsalPracticeSummary | null {
  try {
    const raw = storage?.getItem(getRehearsalPracticeSummaryStorageKey(projectId, deckId));
    if (!raw) {
      return null;
    }

    return parseRehearsalPracticeSummary(JSON.parse(raw), projectId, deckId);
  } catch {
    return null;
  }
}

function writeRehearsalPracticeSummary(
  summary: RehearsalPracticeSummary,
  storage: Pick<Storage, "setItem"> | null = readBrowserLocalStorage(),
) {
  try {
    storage?.setItem(
      getRehearsalPracticeSummaryStorageKey(summary.projectId, summary.deckId),
      JSON.stringify(summary),
    );
  } catch {
    // Summary persistence is best-effort; the rehearsal flow must keep working.
  }
}

function getRehearsalPracticeSummaryStorageKey(
  projectId: string,
  deckId: string,
) {
  return `${rehearsalPracticeSummaryStoragePrefix}:${projectId}:${deckId}`;
}

function parseRehearsalPracticeSummary(
  value: unknown,
  projectId: string,
  deckId: string,
): RehearsalPracticeSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<RehearsalPracticeSummary>;
  if (
    candidate.projectId !== projectId ||
    candidate.deckId !== deckId ||
    typeof candidate.completedAt !== "string" ||
    typeof candidate.durationSeconds !== "number" ||
    typeof candidate.targetSeconds !== "number" ||
    typeof candidate.coveragePercent !== "number" ||
    typeof candidate.missedKeywordCount !== "number"
  ) {
    return null;
  }

  return {
    completedAt: candidate.completedAt,
    coveragePercent: clamp(Math.round(candidate.coveragePercent), 0, 100),
    deckId,
    durationSeconds: Math.max(0, Math.round(candidate.durationSeconds)),
    missedKeywordCount: Math.max(0, Math.round(candidate.missedKeywordCount)),
    projectId,
    targetSeconds: Math.max(0, Math.round(candidate.targetSeconds)),
  };
}

function getMicrophoneReadinessLabel() {
  if (typeof navigator === "undefined") {
    return "권한 확인 예정";
  }

  return typeof navigator.mediaDevices?.getUserMedia === "function"
    ? "시작 시 권한 확인"
    : "브라우저 미지원";
}

function formatTargetDeltaLabel(deltaSeconds: number) {
  const absDelta = Math.abs(deltaSeconds);
  if (deltaSeconds >= 0) {
    return `${formatDuration(absDelta)} 여유`;
  }

  return `${formatDuration(absDelta)} 초과`;
}

function getAutoAdvanceCountdownSeconds(
  state: AdvanceControllerState,
  countdownMs: number,
  nowMs: number,
) {
  if (state.status !== "countdown" || state.countdownStartedAtMs === null) {
    return null;
  }

  const remainingMs = Math.max(
    countdownMs - (nowMs - state.countdownStartedAtMs),
    0,
  );
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

function getMiniSlideScale(deck: Deck) {
  return Math.min(0.16, 154 / deck.canvas.width, 87 / deck.canvas.height);
}

function getSlideTitle(slide: Slide) {
  const title = slide.title.trim();
  if (title) return title;

  const titleElement = slide.elements.find(
    (element): element is Extract<DeckElement, { type: "text" }> =>
      element.type === "text" && element.role === "title",
  );
  return titleElement?.props.text || `Slide ${slide.order}`;
}

function getSlideBodyTexts(slide: Slide) {
  return slide.elements
    .filter(
      (element): element is Extract<DeckElement, { type: "text" }> =>
        element.type === "text" && Boolean(element.props.text.trim()),
    )
    .map((element) => element.props.text.trim())
    .filter((text) => text !== slide.title.trim());
}

function getChecklistKeywords(slide: Slide | null): Keyword[] {
  return slide?.keywords ?? [];
}

function buildP3SessionSlides(deck: Deck) {
  return deck.slides.map((slide) => ({
    slideId: slide.slideId,
    speakerNotes: slide.speakerNotes,
    keywords: slide.keywords ?? [],
    controlPhrases: defaultRehearsalCommandConfig.flatMap(
      (command) => command.phrases,
    ),
    legacyPhrases: [slide.title, ...getSlideBodyTexts(slide)].filter(Boolean),
  }));
}

export function getRemainingTriggerStepsFromPlan(
  maxStepIndex: number,
  stepIndex: number,
) {
  return Math.max(0, maxStepIndex - stepIndex);
}

export function getRemainingTriggerStepsForSlide(options: {
  slide: Slide;
  stepIndex: number;
  triggerAnimationIds: Iterable<string>;
}) {
  const plan = createSlideshowAnimationPlan({
    slide: options.slide,
    triggerAnimationIds: options.triggerAnimationIds,
  });

  return getRemainingTriggerStepsFromPlan(plan.maxStepIndex, options.stepIndex);
}

function createEmptySpeechTrackerSnapshot(options: {
  slideId: string;
  matchableSentenceCount: number;
}): SpeechTrackerSnapshot {
  return {
    slideId: options.slideId,
    coveredSentenceIds: [],
    matchableSentenceCount: options.matchableSentenceCount,
    sentenceCoverage: 0,
    wordCoverage: 0,
    effectiveCoverage: 0,
    finalSentenceSpoken: false,
    hitKeywordIds: [],
    provisionalMissingKeywordIds: [],
  };
}

function getNearbySlides(deck: Deck, currentSlideIndex: number) {
  return deck.slides.filter(
    (_slide, index) =>
      index !== currentSlideIndex && Math.abs(index - currentSlideIndex) <= 2,
  );
}

function isEmphasisCommand(
  candidate: RehearsalCommandCandidate | null,
): candidate is RehearsalCommandCandidate & { cue: "emphasis" } {
  return candidate?.action === "animation-cue" && candidate.cue === "emphasis";
}

function isAdvanceSlideCommand(
  candidate: RehearsalCommandCandidate | null,
): candidate is RehearsalCommandCandidate & { action: "advance-slide" } {
  return candidate?.action === "advance-slide";
}

function formatEmptyReportMessage(
  status: RehearsalReportStatus,
  error: string,
) {
  if (status === "loading") return "보고서를 불러오는 중입니다.";
  if (status === "not-ready") return "보고서 생성 중입니다.";
  if (status === "failed") return error || "보고서를 불러오지 못했습니다.";
  return "보고서 대기 중";
}

function buildCoachingHeadline(report: RehearsalReport | null) {
  if (report?.coaching?.summary) {
    return report.coaching.summary;
  }

  if (!report) {
    return "리허설 데이터를 불러오고 있어요.";
  }

  if (report.metrics.keywordCoverage < 0.8) {
    return "핵심 흐름은 안정적이지만, 일부 키워드 회수가 부족했어요.";
  }

  if (isUnreliableSpeakingSpeed(report.metrics.wordsPerMinute)) {
    return "발표 속도 분석 시간이 불안정해 결과 확인이 필요해요.";
  }

  if (report.metrics.wordsPerMinute > 150) {
    return "핵심 메시지는 좋지만, 빠르게 지나간 구간이 있어요.";
  }

  return "핵심 흐름은 안정적이고, 발표 속도도 적절했어요.";
}

function buildCoachingDetail(
  report: RehearsalReport | null,
  deck: Deck | null,
) {
  if (!report) {
    return "보고서가 준비되면 다음 연습에 집중할 내용을 보여드립니다.";
  }

  if (report.coaching?.nextPracticeFocus) {
    return report.coaching.nextPracticeFocus;
  }

  const nextSlide =
    deck?.slides[Math.min(2, Math.max(0, deck.slides.length - 1))];
  const focus = nextSlide?.title ? `"${nextSlide.title}"` : "다음";
  return `다음 리허설은 ${focus} 슬라이드의 자료 설명을 짧게 줄이고, 누락 키워드를 노트에 고정하는 데 집중하면 됩니다.`;
}

function getSpeakingSpeedAssessment(wordsPerMinute: number) {
  if (isUnreliableSpeakingSpeed(wordsPerMinute)) {
    return {
      displayValue: "확인 필요",
      isUnreliable: true,
      meterValue: 180,
      message: "발표 시간 데이터가 불안정해 속도 판단을 확인해야 합니다.",
    };
  }

  if (wordsPerMinute <= 0) {
    return {
      displayValue: "-",
      isUnreliable: true,
      meterValue: 80,
      message: "발표 시간 데이터를 확인할 수 없어 속도 판단이 어렵습니다.",
    };
  }

  if (wordsPerMinute < 100) {
    return {
      displayValue: String(Math.round(wordsPerMinute)),
      isUnreliable: false,
      meterValue: clamp(Math.round(wordsPerMinute), 80, 180),
      message: "권장 범위보다 다소 느린 속도로 발표했어요.",
    };
  }

  if (wordsPerMinute <= 150) {
    return {
      displayValue: String(Math.round(wordsPerMinute)),
      isUnreliable: false,
      meterValue: clamp(Math.round(wordsPerMinute), 80, 180),
      message: "권장 범위 안에서 안정적인 속도로 발표했어요.",
    };
  }

  return {
    displayValue: String(Math.round(wordsPerMinute)),
    isUnreliable: false,
    meterValue: clamp(Math.round(wordsPerMinute), 80, 180),
    message: "권장 범위보다 빠른 속도로 발표했어요.",
  };
}

function isUnreliableSpeakingSpeed(wordsPerMinute: number) {
  return !Number.isFinite(wordsPerMinute) || wordsPerMinute > 250;
}

function formatSpeakingSpeedValue(wordsPerMinute: number) {
  if (isUnreliableSpeakingSpeed(wordsPerMinute)) {
    return "확인 필요";
  }

  if (wordsPerMinute <= 0) {
    return "-";
  }

  return `${Math.round(wordsPerMinute)} wpm`;
}

function buildMissedKeywordRows(
  deck: Deck | null,
  missedKeywords: RehearsalReport["missedKeywords"],
) {
  const rowsBySlideId = new Map<
    string,
    {
      label: string;
      keywords: RehearsalReport["missedKeywords"];
      slideId: string;
    }
  >();
  const slideOrder = new Map(
    deck?.slides.map((slide, index) => [slide.slideId, index + 1]) ?? [],
  );

  for (const keyword of missedKeywords) {
    const slideNumber = slideOrder.get(keyword.slideId);
    const row = rowsBySlideId.get(keyword.slideId) ?? {
      label:
        typeof slideNumber === "number"
          ? `슬라이드${slideNumber}`
          : keyword.slideId,
      keywords: [],
      slideId: keyword.slideId,
    };
    row.keywords.push(keyword);
    rowsBySlideId.set(keyword.slideId, row);
  }

  return Array.from(rowsBySlideId.values()).sort((left, right) => {
    const leftOrder = slideOrder.get(left.slideId) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = slideOrder.get(right.slideId) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return 0;
  });
}

function formatRehearsalCompletionPercent(
  deck: Deck | null,
  slideTimings: RehearsalReport["slideTimings"],
) {
  const totalSlides = deck?.slides.length ?? 0;
  if (totalSlides <= 0 || slideTimings.length === 0) {
    return "-";
  }

  const deckSlideIds = new Set(deck?.slides.map((slide) => slide.slideId));
  const completedSlideIds = new Set(
    slideTimings
      .filter(
        (timing) =>
          timing.actualSeconds > 0 && deckSlideIds.has(timing.slideId),
      )
      .map((timing) => timing.slideId),
  );
  if (completedSlideIds.size === 0) {
    return "-";
  }

  return `${Math.min(100, Math.round((completedSlideIds.size / totalSlides) * 100))}%`;
}

function getTargetDurationSeconds(deck: Deck | null) {
  return Math.max(60, (deck?.targetDurationMinutes ?? 10) * 60);
}

function getSlideTargetSeconds(deck: Deck, slide: Slide) {
  if (slide.estimatedSeconds) {
    return slide.estimatedSeconds;
  }

  return Math.max(
    1,
    Math.round((deck.targetDurationMinutes * 60) / deck.slides.length),
  );
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = (safeSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatSlideTimingLabel(deck: Deck | null, slideId: string) {
  const slide = deck?.slides.find((candidate) => candidate.slideId === slideId);
  return slide ? `Slide ${slide.order}` : slideId;
}

function formatReportDate(value?: string) {
  if (!value) return "-";

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  const date = new Date(parsed);
  return `${date.getFullYear().toString().slice(2)}.${(date.getMonth() + 1)
    .toString()
    .padStart(2, "0")}.${date.getDate().toString().padStart(2, "0")}.`;
}

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function usePresenterStageScale(deck: Deck | null) {
  const presenterStageRef = useRef<HTMLDivElement | null>(null);
  const [presenterScale, setPresenterScale] = useState(0.44);

  useEffect(() => {
    const stage = presenterStageRef.current;
    if (!stage || !deck) {
      return;
    }

    const updateScale = () => {
      const bounds = stage.getBoundingClientRect();
      const nextScale = Math.min(
        bounds.width / deck.canvas.width,
        bounds.height / deck.canvas.height,
      );
      if (Number.isFinite(nextScale) && nextScale > 0) {
        setPresenterScale((current) =>
          Math.abs(current - nextScale) > 0.001 ? nextScale : current,
        );
      }
    };

    updateScale();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateScale);
      return () => window.removeEventListener("resize", updateScale);
    }

    const observer = new ResizeObserver(updateScale);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [deck]);

  return { presenterScale, presenterStageRef };
}

function getRehearsalPaceSummaryLabel(
  pace: "too-fast" | "too-slow" | "normal",
) {
  switch (pace) {
    case "too-fast":
      return "말 속도 빠름";
    case "too-slow":
      return "말 속도 느림";
    case "normal":
      return "말 속도 정상";
  }
}

function parseClockInput(value: string): number | null {
  const normalizedValue = value.trim();
  const match = normalizedValue.match(/^(\d{1,3})(?::([0-5]?\d))?$/);

  if (!match) {
    return null;
  }

  const minutes = Number(match[1]);
  const seconds = Number(match[2] ?? 0);

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }

  return minutes * 60 + seconds;
}

function navigateToRehearsal(projectId: string) {
  navigateToPath(`/rehearsal/${encodeURIComponent(projectId)}`);
}

function navigateToPath(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

async function readErrorMessage(response: Response, fallback: string) {
  const message = await response.text();
  return message || fallback;
}

function toMicrophoneErrorMessage(cause: unknown) {
  if (cause instanceof DOMException && cause.name === "NotAllowedError") {
    return "마이크 접근 권한이 거부되었습니다.";
  }

  if (cause instanceof DOMException && cause.name === "NotFoundError") {
    return "사용 가능한 마이크를 찾지 못했습니다.";
  }

  return toErrorMessage(cause) || "마이크를 시작하지 못했습니다.";
}

function toRehearsalFlowMessage(cause: unknown) {
  if (cause instanceof RehearsalFlowError) {
    if (cause.stage === "storage-put") {
      return "?낅줈?쒓? 以묐떒?섏뿀?듬땲?? ?ㅽ듃?뚰겕? ?ㅽ넗由ъ? ?곌껐???뺤씤?섏꽭??";
    }

    if (cause.stage === "complete" || cause.stage === "job-poll") {
      return cause.message || "STT ?먮뒗 肄붿묶 遺꾩꽍 ?묒뾽???ㅽ뙣?덉뒿?덈떎.";
    }
  }

  return toErrorMessage(cause);
}

function toLiveSttError(cause: unknown) {
  if (cause instanceof LiveSttError) {
    return cause;
  }

  if (cause instanceof LiveSttAdapterError) {
    return new LiveSttError(
      cause.code === "LIVE_STT_MODEL_UNAVAILABLE"
        ? "model_unavailable"
        : "start_failed",
      cause.message,
    );
  }

  return new LiveSttError(
    "start_failed",
    cause instanceof Error ? cause.message : "Live STT를 시작하지 못했습니다.",
  );
}

function isLiveSttUnavailable(error: LiveSttError) {
  return (
    error.code === "model_unavailable" || error.code === "unsupported_runtime"
  );
}

function getBiasPhrasesFromContext(
  context: LiveSttBiasContext | null,
): LiveSttBiasPhrase[] {
  return (
    context?.terms.map((term) => ({
      text: term.text,
      weight: term.weight,
      source: term.source,
      ...(term.keywordId === undefined ? {} : { keywordId: term.keywordId }),
      ...(term.canonicalText === undefined
        ? {}
        : { canonicalText: term.canonicalText }),
    })) ?? []
  );
}

function toErrorMessage(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : "?붿껌??泥섎━?섏? 紐삵뻽?듬땲??";
}

function extensionForMimeType(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}
