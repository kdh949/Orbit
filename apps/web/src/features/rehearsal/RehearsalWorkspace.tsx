import {
  createSlidePlaybackState,
  type SlidePlaybackState,
} from "@orbit/editor-core";
import {
  deriveKeywordOccurrences,
  demoIds,
  createRehearsalEvaluationSnapshot,
  matchPronunciationAliases,
  normalizePronunciationText,
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
  type PronunciationLexiconSnapshot,
  type RehearsalReport,
  type RehearsalRunComparison,
  type RehearsalEvaluationSnapshot,
  type RehearsalRun,
  type RehearsalRunMeta,
  type RetryRehearsalSemanticEvaluationResponse,
  type SemanticCapabilityEvent,
  type Slide,
  type SlideTranscriptSnapshot,
  type UpdateRehearsalRunMetaRequest,
  type BriefRef,
  type EvaluatorLensRef,
} from "@orbit/shared";
import {
  ArrowLeft,
  BarChart3,
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  Gauge,
  LoaderCircle,
  Mic,
  MoreHorizontal,
  PlayCircle,
  Presentation,
  Square,
  X,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { JobProgressDisplay } from "./JobProgressDisplay";
import { RehearsalReportDocument } from "./RehearsalReportDocument";
import { RehearsalRunNav } from "./RehearsalRunNav";
import { RehearsalRunComparisonOverview } from "./RehearsalRunComparisonOverview";
import { RehearsalScriptTeleprompter } from "./presenter/RehearsalScriptTeleprompter";
import "./rehearsal-preflight.css";
import "./rehearsal-report-detail.css";
import "./rehearsal-workspace-orbit.css";
import {
  fetchProjectRehearsalReportRuns,
  fetchRehearsalRunComparison,
} from "./reportApi";
import {
  buildRehearsalRunComparisonViewModel,
  createComparisonReminderState,
  dismissComparisonReminder,
  enterComparisonSlide,
  type ComparisonReminderState,
  type RehearsalRunComparisonViewModel,
} from "./rehearsalRunComparisonModel";
import {
  getRehearsalRunNumber,
  sortRehearsalRunsByCreatedAt,
} from "./rehearsalUtils";
import {
  logRehearsalValidationFailure,
  readRehearsalErrorMessage as readErrorMessage,
  rehearsalDeckInvalidMessage,
} from "./rehearsalErrorHandling";
import { useJobSmoothProgress } from "./useJobSmoothProgress";
import {
  clearPreparedRehearsalSlideSnapshots,
  readPreparedRehearsalSlideSnapshots,
} from "./rehearsalSlideSnapshots";
import { requestRehearsalMicrophoneStream } from "../presenter-shell/microphoneSettings";
import {
  closePresenterCompanionSession,
  ensurePresenterCompanionSession,
  type PresenterCompanionSessionIdentity,
} from "../presentation/presentationApi";
export {
  getRehearsalMicrophoneAudioConstraints,
  isLiveSttRawMicDebugEnabled,
  readRehearsalMicrophoneDeviceId,
  rehearsalMicrophoneAudioConstraints,
  rehearsalRawMicrophoneAudioConstraints,
  requestRehearsalMicrophoneStream,
  writeRehearsalMicrophoneDeviceId,
} from "../presenter-shell/microphoneSettings";
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
import { fetchLiveSttRuntimeConfig } from "./stt/liveSttRuntimeConfig";
import { normalizeLiveTranscriptText } from "./stt/liveTranscriptText";
import { SherpaLiveSttPort } from "./stt/sherpaLiveSttPort";
import {
  getKeywordOccurrenceTriggerIdsForSlide,
  resolveCueTriggeredActions,
  resolveKeywordOccurrenceTriggeredActions,
  resolveKeywordTriggeredActions,
  getTriggerAnimationIdsForSlide,
  restoreSlidePlaybackAtStep,
  resolveTriggeredActionPlaybackUpdate,
} from "./playback/triggeredActionPlayback";
import {
  AnimationFlowNavigator,
  type AnimationFlowNavigation,
} from "./presenter/AnimationFlowNavigator";
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
import {
  createSlideAssetNavigationGate,
  type SlideNavigationRequest,
  type SlideNavigationResult,
} from "./presenter/slideAssetNavigationGate";
import { createSlideshowAnimationPlan } from "./presenter/slideshowStepModel";
import { getNextPresenterStepState } from "./presenter/presenterStepNavigation";
import {
  createAudiencePresenterState,
  createSlideWindowDeckSnapshot,
  type PresenterRemoteCommand,
} from "./presenter/presentationChannel";
import { useLivePresentationOutput } from "../presentation/useLivePresentationOutput";
import { PresenterCompanionSetup } from "../presenter-companion/PresenterCompanionSetup";
import { PresenterCompanionStatus } from "../presenter-companion/PresenterCompanionStatus";
import { usePresenterCompanionFeatureFlag } from "../presenter-companion/usePresenterCompanionFeatureFlag";
import type { AudienceStreamBridgeWindow } from "./presenter/audienceStreamBridge";
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
import { RehearsalPanel } from "./panel/RehearsalPanel";
import {
  clearProjectSlideImageCache,
  preloadSlideAssets,
  prepareSlideAssets,
  retainSlideAssetWindow,
} from "../slides/rendering";
import {
  canRetryInitialRecordingLiveStt,
  createInitialLiveSttRetryCoordinator,
  sanitizeLiveSttErrorMessage,
} from "./panel/rehearsalLiveSttRecovery";
import {
  createSemanticCapabilityStatusItems,
  getNextSemanticCapabilityRecoveryDelay,
  isSemanticAutoActionAllowed,
  type SemanticCapabilityStatusItem,
} from "./panel/semanticCapabilityStatusModel";
import {
  createRehearsalScriptPrompterRows,
  type RehearsalScriptPrompterRowStatus,
} from "./panel/rehearsalScriptPrompter";
import {
  SemanticCueDebugPanel,
  shouldShowSemanticCueDebugPanel,
} from "./panel/SemanticCueDebugPanel";
import {
  SemanticSpeechDebugPanel,
  semanticSpeechDebugPanelStorageKey,
  shouldShowSemanticSpeechDebugPanel,
} from "./panel/SemanticSpeechDebugPanel";
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
  getSemanticCueRuntimeFlags,
  isSemanticCueNliEnabledForMode,
} from "./speech/semanticCueFeatureFlags";
import {
  createSemanticCueDebugRingBuffer,
  type SemanticCueDebugEvent,
} from "./speech/semanticCueDebugEvents";
import {
  createSemanticCueEmbeddingIndex,
  type SemanticCueEmbeddingIndex,
} from "./speech/semanticCueEmbeddingIndex";
import { createSemanticCueRuntime } from "./speech/semanticCueRuntime";
import { createMockSemanticCueNliProvider } from "./speech/mockSemanticCueNliProvider";
import { createBrowserTransformersSemanticCueNliProvider } from "./speech/browserSemanticCueNliProvider";
import {
  getE5EmbeddingService,
  type E5EmbeddingService,
} from "./speech/e5EmbeddingService";
import {
  createIdleSemanticDebugState,
  createSemanticDebugState,
  markSemanticModelReady,
} from "./speech/semanticSpeechDebug";
import {
  createSemanticUtteranceMatcher,
  type SemanticUtteranceMatcher,
} from "./speech/semanticUtteranceMatcher";
import {
  createPauseDetector,
  type PauseDetector,
  type PauseDetectorEvent,
  type PauseDetectorSnapshot,
} from "./speech/pauseDetector";
import { defaultSpeechTrackingConfig } from "./speech/speechTrackingConfig";
import {
  matchKeywordOccurrenceTriggers,
  type KeywordOccurrenceRuntimeMatch,
} from "./speech/keywordOccurrenceRuntime";
import {
  getPresenterTimingProgress,
  PresenterStageSection,
  PresenterTimerCard,
  PresenterTopbar,
  type PresenterTimingProgressItem,
} from "../presenter-shell/PresenterScaffold";
import type {
  ExtractedSentence,
  SpeechTrackerSnapshot,
  SpeechTrackingEvent,
} from "./speech/speechTrackingEvents";
import type { PrompterProgressSnapshot } from "./speech/prompterProgressTracker";
import { PracticeGoalSummary } from "../coaching/PracticeGoalSummary";
import { PracticeGoalReminder } from "../coaching/PracticeGoalReminder";
import { fetchPresentationBrief } from "../coaching/presentationBriefApi";
import { ActivityPresenterPanel } from "../activity-slides";

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
export { getRehearsalTeleprompterScrollBehavior } from "./presenter/RehearsalScriptTeleprompter";

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
  | "cancel"
  | "complete"
  | "job-poll"
  | "run-fetch"
  | "report-fetch"
  | "semantic-retry";
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
  | "unavailable"
  | "failed";
type RehearsalRuntimeStatus =
  | "idle"
  | "running"
  | "pausing"
  | "paused"
  | "resuming"
  | "stopping";

type RecordingSession = {
  recorder: MediaRecorder;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
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

export type LiveKeywordOccurrenceState = {
  slideId: string;
  confirmedOccurrenceIds: string[];
};

export type OccurrenceTriggerProgress = {
  targetOccurrenceIds: string[];
  confirmedOccurrenceIds: string[];
  coverage: number;
};

type LiveTranscriptBuffer = {
  committedTranscript: string;
  draftTranscript: string;
};

type BiasTermDraft = Omit<LiveSttBiasTerm, "text"> & { text: string };

const ENABLE_REHEARSAL_NLI = false;

const preferredAudioMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];
const liveSttBiasModeStorageKey = "orbit.liveStt.biasMode";
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
    readonly status?: number,
  ) {
    super(message);
    this.name = "RehearsalFlowError";
  }
}

export async function fetchRehearsalDeck(
  projectId: string = demoIds.projectId,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(`/api/v1/projects/${encodeURIComponent(projectId)}/deck`);
  if (!response.ok) {
    throw new RehearsalFlowError(
      "deck",
      await readErrorMessage(
        response,
        "발표 자료를 불러오지 못했습니다.",
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
  const response = await fetcher(`/api/v1/projects/${encodeURIComponent(projectId)}/deck`);

  if (response.ok) {
    const payload = (await response.json()) as GetDeckResponse;
    return payload.deck;
  }

  if (response.status === 404 && options.fallbackDeck) {
    const putResponse = await fetcher(`/api/v1/projects/${encodeURIComponent(projectId)}/deck`, {
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
          "리허설 발표 자료를 초기화하지 못했습니다.",
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
    await readErrorMessage(response, "발표 자료를 불러오지 못했습니다."),
  );
}

export async function createRehearsalRun(
  projectId: string,
  deckId: string,
  fetcher: Fetcher = fetch,
  options: {
    expectedDeckVersion?: number;
    semanticEvaluationMode?: "full" | "delivery-only";
    coachingContext?: {
      briefRef: BriefRef;
      evaluatorLensRef: EvaluatorLensRef;
      sourceGoalSetId: string | null;
    };
    slideSnapshots?: Array<{ fileId: string; slideId: string }>;
  } = {},
) {
  const response = await fetcher(`/api/v1/projects/${encodeURIComponent(projectId)}/rehearsals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deckId,
      ...(options.expectedDeckVersion === undefined
        ? {}
        : { expectedDeckVersion: options.expectedDeckVersion }),
      ...(options.semanticEvaluationMode === undefined
        ? {}
        : { semanticEvaluationMode: options.semanticEvaluationMode }),
      ...(options.slideSnapshots === undefined
        ? {}
        : { slideSnapshots: options.slideSnapshots }),
      ...(options.coachingContext ?? {}),
    }),
  });

  if (!response.ok) {
    throw new RehearsalFlowError(
      "run",
      await readErrorMessage(response, "리허설 실행을 만들지 못했습니다."),
      response.status,
    );
  }

  return (await response.json()) as CreateRehearsalRunResponse;
}

export async function cancelRehearsalRun(
  runId: string,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(`/api/v1/rehearsals/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new RehearsalFlowError(
      "cancel",
      await readErrorMessage(response, "리허설 실행을 취소하지 못했습니다."),
      response.status,
    );
  }

  return ((await response.json()) as { run: RehearsalRun }).run;
}

export async function createRehearsalRunForUpload(
  projectId: string,
  deckId: string,
  expectedDeckVersion: number,
  fetcher: Fetcher = fetch,
  coachingContext?: {
    briefRef: BriefRef;
    evaluatorLensRef: EvaluatorLensRef;
    sourceGoalSetId: string | null;
  },
  slideSnapshots?: Array<{ fileId: string; slideId: string }>,
) {
  try {
    const created = await createRehearsalRun(projectId, deckId, fetcher, {
      expectedDeckVersion,
      semanticEvaluationMode: "full",
      coachingContext,
      slideSnapshots,
    });
    return { run: created.run, evaluationSnapshotMismatch: false };
  } catch (cause) {
    if (!(cause instanceof RehearsalFlowError) || cause.status !== 409) {
      throw cause;
    }

    const deliveryOnly = await createRehearsalRun(projectId, deckId, fetcher, {
      expectedDeckVersion,
      semanticEvaluationMode: "delivery-only",
      slideSnapshots,
    });
    return { run: deliveryOnly.run, evaluationSnapshotMismatch: true };
  }
}

export async function prepareRehearsalEvaluationRun(
  deck: Deck,
  fetcher: Fetcher = fetch,
  coachingContext?: {
    briefRef: BriefRef;
    evaluatorLensRef: EvaluatorLensRef;
    sourceGoalSetId: string | null;
  },
  slideSnapshots?: Array<{ fileId: string; slideId: string }>,
): Promise<{
  run: RehearsalRun | null;
  evaluationSnapshot: RehearsalEvaluationSnapshot;
  serverEvaluation:
    | { state: "available" }
    | { state: "unavailable"; reason: "network_error" };
}> {
  const provisionalSnapshot = createRehearsalEvaluationSnapshot(deck);
  try {
    const created = await createRehearsalRun(
      deck.projectId,
      deck.deckId,
      fetcher,
      {
        expectedDeckVersion: deck.version,
        semanticEvaluationMode: "full",
        coachingContext,
        slideSnapshots,
      },
    );
    return {
      run: created.run,
      evaluationSnapshot: created.run.evaluationSnapshot ?? provisionalSnapshot,
      serverEvaluation: { state: "available" },
    };
  } catch {
    return {
      run: null,
      evaluationSnapshot: provisionalSnapshot,
      serverEvaluation: { state: "unavailable", reason: "network_error" },
    };
  }
}

async function resolveRehearsalCoachingContext(
  projectId: string,
  sourceGoalSetId?: string,
) {
  try {
    const brief = await fetchPresentationBrief(projectId);
    if (brief) {
      return {
        briefRef: {
          mode: "briefed" as const,
          briefId: brief.briefId,
          expectedRevision: brief.revision,
        },
        evaluatorLensRef: brief.evaluatorLensRef,
        sourceGoalSetId: sourceGoalSetId ?? null,
      };
    }
  } catch {
    // Brief 조회 실패 시에도 일반 모드 리허설은 계속할 수 있다.
  }
  return {
    briefRef: { mode: "generic" as const },
    evaluatorLensRef: { lensId: "general-novice" as const, revision: 1 as const },
    sourceGoalSetId: sourceGoalSetId ?? null,
  };
}

export async function requestRehearsalAudioUploadUrl(
  runId: string,
  file: File,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(
    `/api/v1/rehearsals/${encodeURIComponent(runId)}/audio/upload-url`,
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
        "리허설 오디오 업로드 URL을 발급하지 못했습니다.",
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
        "리허설 오디오 업로드가 중단되었습니다.",
      ),
    );
  }
}

export async function completeRehearsalAudioUpload(
  runId: string,
  fileId: string,
  liveTranscriptOrFetcher: string | null | Fetcher = null,
  fetcher: Fetcher = fetch,
  slideTranscriptSnapshots: SlideTranscriptSnapshot[] = [],
) {
  const liveTranscript =
    typeof liveTranscriptOrFetcher === "function"
      ? null
      : liveTranscriptOrFetcher;
  const requestFetcher =
    typeof liveTranscriptOrFetcher === "function"
      ? liveTranscriptOrFetcher
      : fetcher;
  const response = await requestFetcher(`/api/v1/rehearsals/${encodeURIComponent(runId)}/audio/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fileId,
      liveTranscript,
      slideTranscriptSnapshots,
    }),
  });

  if (!response.ok) {
    throw new RehearsalFlowError(
      "complete",
      await readErrorMessage(
        response,
        "리허설 음성 분석 작업을 시작하지 못했습니다.",
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
  const response = await fetcher(`/api/v1/rehearsals/${encodeURIComponent(runId)}/meta`, {
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
  const response = await fetcher(`/api/v1/rehearsals/${encodeURIComponent(runId)}`);
  if (!response.ok) {
    throw new RehearsalFlowError(
      "run-fetch",
      await readErrorMessage(
        response,
        "리허설 실행 상태를 불러오지 못했습니다.",
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
  const response = await fetcher(`/api/v1/rehearsals/${encodeURIComponent(runId)}/report`);
  if (!response.ok) {
    throw new RehearsalFlowError(
      "report-fetch",
      await readErrorMessage(response, "리허설 보고서를 불러오지 못했습니다."),
    );
  }

  return (await response.json()) as GetRehearsalReportResponse;
}

export async function retryRehearsalSemanticEvaluation(
  runId: string,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(
    `/api/v1/rehearsals/${encodeURIComponent(runId)}/semantic-evaluation/retry`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new RehearsalFlowError(
      "semantic-retry",
      await readSemanticRetryError(response),
      response.status,
    );
  }

  const payload =
    (await response.json()) as RetryRehearsalSemanticEvaluationResponse;
  return payload.job;
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

  if (response.report) {
    return { error: "", status: "ready" };
  }

  if (response.run.status === "succeeded" && !response.run.jobId) {
    return { error: "", status: "unavailable" };
  }

  return { error: "", status: "not-ready" };
}

export function getRehearsalReportPath(projectId: string, runId: string) {
  return `/rehearsal/${encodeURIComponent(projectId)}/report/${encodeURIComponent(runId)}`;
}

export async function fetchProjectRehearsalRuns(
  projectId: string,
  fetcher: Fetcher = fetch,
): Promise<RehearsalRun[]> {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/rehearsals`,
    { credentials: "include" },
  );
  if (!response.ok) return [];
  const data = (await response.json()) as { runs: RehearsalRun[] };
  return data.runs ?? [];
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
    const response = await fetcher(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (!response.ok) {
      throw new RehearsalFlowError(
        "job-poll",
        await readErrorMessage(
          response,
          "리허설 분석 작업 상태를 불러오지 못했습니다.",
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
        "리허설 분석 작업이 제한 시간 안에 끝나지 않았습니다.",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export async function runRehearsalUploadFlow(options: {
  runId: string;
  audioFile: File;
  fetcher?: Fetcher;
  onJobUpdate?: (job: Job) => void;
  pollDelayMs?: number;
  pollTimeoutMs?: number;
  runMeta?: RehearsalRunMeta | null;
  liveTranscript?: string | null;
  slideTranscriptSnapshots?: SlideTranscriptSnapshot[];
  slideTimeline?: UpdateRehearsalRunMetaRequest["slideTimeline"];
}) {
  const fetcher = options.fetcher ?? fetch;
  const uploadResponse = await requestRehearsalAudioUploadUrl(
    options.runId,
    options.audioFile,
    fetcher,
  );

  await uploadRehearsalAudio(uploadResponse.upload, options.audioFile, fetcher);

  const runMeta =
    options.runMeta ??
    (options.slideTimeline?.length
        ? {
            recordingDurationSeconds: null,
            slideTimeline: options.slideTimeline,
            missedKeywords: [],
            adviceEvents: [],
            utteranceOutcomes: [],
            semanticCueDecisions: [],
            semanticCapabilityEvents: [],
          }
        : null);

  if (
    runMeta &&
    (runMeta.slideTimeline.length > 0 ||
      runMeta.missedKeywords.length > 0 ||
      runMeta.adviceEvents.length > 0 ||
      runMeta.utteranceOutcomes.length > 0 ||
      runMeta.semanticCueDecisions.length > 0 ||
      runMeta.semanticCapabilityEvents.length > 0)
  ) {
    try {
      await updateRehearsalRunMeta(options.runId, runMeta, fetcher);
    } catch {
      // Report generation can continue without optional slide timing metadata.
    }
  }

  const completed = await completeRehearsalAudioUpload(
    options.runId,
    uploadResponse.upload.fileId,
    options.liveTranscript ?? null,
    fetcher,
    options.slideTranscriptSnapshots ?? [],
  );
  const job = await pollRehearsalJob(completed.job.jobId, {
    fetcher,
    delayMs: options.pollDelayMs,
    timeoutMs: options.pollTimeoutMs,
    onUpdate: options.onJobUpdate,
  });
  const run = await fetchRehearsalRun(options.runId, fetcher);

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
    options.onError(new Error("녹음 중 오류가 발생했습니다."));
  };
  recorder.onstop = () => {
    if (chunks.length === 0) {
      options.onError(new Error("녹음된 오디오가 비어 있습니다."));
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    options.onStop(
      createRecordingFile(blob, mimeType, options.now?.() ?? new Date()),
    );
  };

  return {
    recorder,
    pause: async () => {
      if (recorder.state === "recording") {
        await transitionMediaRecorder(recorder, "paused", "pause", () =>
          recorder.pause(),
        );
      }
    },
    resume: async () => {
      if (recorder.state === "paused") {
        await transitionMediaRecorder(recorder, "recording", "resume", () =>
          recorder.resume(),
        );
      }
    },
    start: () => recorder.start(),
    stop: () => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    },
  };
}

export async function runRehearsalPauseSequence(options: {
  pauseRecording?: () => Promise<void>;
  pauseSpeech: () => Promise<void>;
}): Promise<{
  error: unknown | null;
  status: "paused" | "running";
}> {
  let recordingPaused = options.pauseRecording === undefined;

  try {
    if (options.pauseRecording) {
      await options.pauseRecording();
      recordingPaused = true;
    }
    await options.pauseSpeech();
    return { error: null, status: "paused" };
  } catch (error) {
    return {
      error,
      status: recordingPaused ? "paused" : "running",
    };
  }
}

function transitionMediaRecorder(
  recorder: MediaRecorder,
  targetState: RecordingState,
  eventName: "pause" | "resume",
  transition: () => void,
) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      recorder.removeEventListener?.(eventName, handleTransition);
      resolve();
    };
    const handleTransition = () => {
      if (recorder.state === targetState) {
        finish();
      }
    };

    recorder.addEventListener?.(eventName, handleTransition, { once: true });
    try {
      transition();
    } catch (error) {
      recorder.removeEventListener?.(eventName, handleTransition);
      reject(error);
      return;
    }
    if (recorder.state === targetState) {
      finish();
    }
  });
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
    pronunciationLexicon?: PronunciationLexiconSnapshot;
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

  addPronunciationBiasTerms(slide.slideId, 0.93, 0.9);
  for (const nearbySlide of options.nearbySlides ?? []) {
    if (nearbySlide.slideId !== slide.slideId) {
      addPronunciationBiasTerms(nearbySlide.slideId, 0.78, 0.74);
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

  function addPronunciationBiasTerms(
    slideId: string,
    sourceWeight: number,
    aliasWeight: number,
  ) {
    for (const entry of options.pronunciationLexicon?.entries ?? []) {
      if (
        entry.status !== "active" ||
        !entry.scriptOccurrences.some(
          (occurrence) => occurrence.slideId === slideId,
        )
      ) {
        continue;
      }
      addTerm({
        text: entry.sourceText,
        source: "pronunciation-source",
        weight: sourceWeight,
        canonicalText: entry.canonicalText,
      });
      for (const alias of entry.aliases) {
        if (!alias.enabled || alias.confidence < 0.8) {
          continue;
        }
        addTerm({
          text: alias.text,
          source: "pronunciation-alias",
          weight: aliasWeight * alias.confidence,
          canonicalText: entry.canonicalText,
        });
      }
    }
  }
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
  pronunciationLexicon?: PronunciationLexiconSnapshot,
): LiveTranscriptAnalysis {
  const candidates = getLiveKeywordCandidates(slide);
  const normalizedTranscript = normalizeLiveTranscriptText(transcript);
  const pronunciationEvidence = pronunciationLexicon
    ? matchPronunciationAliases(transcript, pronunciationLexicon, {
        slideIds: [slide.slideId],
      }).evidence
    : [];
  const detectedKeywords = candidates.flatMap((candidate) => {
    const matchedText = candidate.aliases.find((alias) => {
      const normalizedAlias = normalizeLiveTranscriptText(alias);
      return normalizedAlias && normalizedTranscript.includes(normalizedAlias);
    });

    const canonicalKeys = new Set(
      candidate.aliases.map(
        (alias) => normalizePronunciationText(alias).compactText,
      ),
    );
    const matchedEvidence = pronunciationEvidence.find((evidence) =>
      canonicalKeys.has(evidence.canonicalKey),
    );

    if (!matchedText && !matchedEvidence) {
      return [];
    }

    return [
      {
        type: "keyword-detected" as const,
        slideId: slide.slideId,
        keywordId: candidate.keyword.keywordId,
        text: candidate.keyword.text,
        matchedText: matchedText ?? matchedEvidence?.matchedText ?? "",
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

export function createKeywordOccurrenceAnimationCueEvent(args: {
  match: KeywordOccurrenceRuntimeMatch;
  slideId: string;
}): LiveSttAnimationCueEvent {
  return {
    type: "animation-cue",
    slideId: args.slideId,
    keywordId: args.match.keywordId,
    occurrenceId: args.match.occurrenceId,
    cue: "emphasis",
    text: args.match.text,
  };
}

export function createLiveKeywordOccurrenceState(
  slideId: string,
): LiveKeywordOccurrenceState {
  return {
    slideId,
    confirmedOccurrenceIds: [],
  };
}

export function getLiveKeywordOccurrenceStateForSlide(
  current: LiveKeywordOccurrenceState | null,
  slideId: string,
): LiveKeywordOccurrenceState {
  return current?.slideId === slideId
    ? current
    : createLiveKeywordOccurrenceState(slideId);
}

export function confirmKeywordOccurrenceMatches(
  state: LiveKeywordOccurrenceState,
  matches: readonly Pick<KeywordOccurrenceRuntimeMatch, "occurrenceId">[],
): LiveKeywordOccurrenceState {
  const confirmedOccurrenceIds = new Set(state.confirmedOccurrenceIds);

  for (const match of matches) {
    confirmedOccurrenceIds.add(match.occurrenceId);
  }

  return {
    slideId: state.slideId,
    confirmedOccurrenceIds: [...confirmedOccurrenceIds],
  };
}

export function getOccurrenceTriggerProgress(options: {
  targetOccurrenceIds: readonly string[];
  confirmedOccurrenceIds: readonly string[];
}): OccurrenceTriggerProgress {
  const targetOccurrenceIds = [...new Set(options.targetOccurrenceIds)];
  const targetOccurrenceIdSet = new Set(targetOccurrenceIds);
  const confirmedOccurrenceIds = [
    ...new Set(
      options.confirmedOccurrenceIds.filter((occurrenceId) =>
        targetOccurrenceIdSet.has(occurrenceId),
      ),
    ),
  ];

  return {
    targetOccurrenceIds,
    confirmedOccurrenceIds,
    coverage:
      targetOccurrenceIds.length === 0
        ? 0
        : confirmedOccurrenceIds.length / targetOccurrenceIds.length,
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
    case "pronunciation-source":
      return 5;
    case "pronunciation-alias":
      return 4;
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
  snapshotPreparationId?: string;
  projectId?: string;
  sourceFullRunId?: string;
  sourceGoalSetId?: string;
  preflightMode?: "microphone" | "without-voice";
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
  const [error, setError] = useState("");
  const [run, setRun] = useState<RehearsalRun | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveSttStatus>("idle");
  const [liveError, setLiveError] = useState("");
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
  const [semanticDebugState, setSemanticDebugState] = useState(
    createIdleSemanticDebugState,
  );
  const [liveSessionTranscript, setLiveSessionTranscript] = useState("");
  const [showSemanticDebugPanel, setShowSemanticDebugPanel] = useState(() =>
    shouldShowSemanticSpeechDebugPanel({
      isDevelopment: import.meta.env.DEV,
      storage: getSemanticDebugPanelStorage(),
    }),
  );
  const [semanticCueDebugEvents, setSemanticCueDebugEvents] = useState<
    SemanticCueDebugEvent[]
  >([]);
  const [semanticCapabilityEvents, setSemanticCapabilityEvents] = useState<
    SemanticCapabilityEvent[]
  >([]);
  const [semanticCapabilityNowMs, setSemanticCapabilityNowMs] = useState(() =>
    Date.now(),
  );
  const [practiceWithoutVoiceAt, setPracticeWithoutVoiceAt] = useState<
    number | null
  >(null);
  const shouldAutoStartRef = useRef<
    "microphone" | "without-voice" | "starting" | null
  >(props.preflightMode ?? null);
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
  const [runComparison, setRunComparison] =
    useState<RehearsalRunComparison | null>(null);
  const [comparisonRefreshVersion, setComparisonRefreshVersion] = useState(0);
  const [comparisonReminderState, setComparisonReminderState] =
    useState<ComparisonReminderState>(createComparisonReminderState);
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
  const [isLiveSttRetrying, setIsLiveSttRetrying] = useState(false);
  const [isLiveStopModalOpen, setIsLiveStopModalOpen] = useState(false);
  const [displayRole, setDisplayRole] = useState<
    "presenter" | "slide-receiver" | "slide-surface"
  >("presenter");
  const [audienceOutputMode, setAudienceOutputMode] = useState<
    "slide" | "screen-share" | "black"
  >("slide");
  const [slideReceiverMessage, setSlideReceiverMessage] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [slideElapsedSeconds, setSlideElapsedSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [rehearsalRuntimeStatus, setRehearsalRuntimeStatus] =
    useState<RehearsalRuntimeStatus>("idle");
  const [scriptAutoFollowKey, setScriptAutoFollowKey] = useState(0);
  const [isSingleScreenOpen, setIsSingleScreenOpen] = useState(false);
  const [isSlidePreparationPending, setIsSlidePreparationPending] =
    useState(false);
  const [isCompletionModalOpen, setIsCompletionModalOpen] = useState(false);
  const [timeMode, setTimeMode] = useState<RehearsalTimeMode>("stopwatch");
  const [timerDurationSeconds, setTimerDurationSeconds] = useState(() =>
    props.initialDeck ? getRehearsalDeckTargetSeconds(props.initialDeck) : 5 * 60,
  );
  const [elapsedTimeInput, setElapsedTimeInput] = useState("00:00");
  const [timerDurationInput, setTimerDurationInput] = useState("05:00");
  const [editingTimeField, setEditingTimeField] = useState<
    "elapsed" | "duration" | null
  >(null);
  const sessionRef = useRef<RecordingSession | null>(null);
  const activeRunRef = useRef<RehearsalRun | null>(null);
  const preparedSlideSnapshotsRef = useRef<
    Array<{ fileId: string; slideId: string }> | undefined
  >(undefined);
  const streamRef = useRef<MediaStream | null>(null);
  const liveDemoStreamRef = useRef<MediaStream | null>(null);
  const liveSttPortRef = useRef<LiveSttPort | null>(props.liveSttPort ?? null);
  const liveSttSubscriptionCleanupRef = useRef<(() => void) | null>(null);
  const liveSttRetryCoordinatorRef = useRef(
    createInitialLiveSttRetryCoordinator(),
  );
  const p3SessionRef = useRef<P3RehearsalSession | null>(null);
  const semanticEmbeddingServicePromiseRef =
    useRef<Promise<E5EmbeddingService> | null>(null);
  const semanticMatcherRef = useRef<SemanticUtteranceMatcher | null>(null);
  const semanticCueEmbeddingIndexRef =
    useRef<SemanticCueEmbeddingIndex | null>(null);
  const semanticCueDebugBufferRef = useRef(createSemanticCueDebugRingBuffer());
  const semanticCueNliProviderRef = useRef<{
    key: string;
    provider: ReturnType<typeof createBrowserTransformersSemanticCueNliProvider>;
  } | null>(null);
  const rehearsalRuntimeStatusRef = useRef<RehearsalRuntimeStatus>("idle");
  const p3RunMetaRef = useRef<RehearsalRunMeta | null>(null);
  const pendingP3RunMetaRef = useRef<Promise<RehearsalRunMeta | null> | null>(
    null,
  );
  const pendingP3SlideIndexRef = useRef<number | null>(null);
  const finishAfterReportRef = useRef(false);
  const recordingSubmissionVersionRef = useRef(0);
  const companionSessionRef =
    useRef<PresenterCompanionSessionIdentity | null>(null);
  const [companionSession, setCompanionSession] =
    useState<PresenterCompanionSessionIdentity | null>(null);
  const companionSessionPromiseRef =
    useRef<Promise<PresenterCompanionSessionIdentity> | null>(null);
  const companionSessionPromiseKeyRef = useRef<string | null>(null);
  const closeCompanionSessionPromiseRef = useRef<Promise<void> | null>(null);
  const slideWindowRef = useRef<SlideWindowRef | null>(null);
  const reattachAudienceStreamRef = useRef<() => boolean>(() => true);
  const stopAudienceStreamRef = useRef<() => void>(() => undefined);
  const presenterCompanionEnabled = usePresenterCompanionFeatureFlag();
  const deckRef = useRef<Deck | null>(props.initialDeck ?? null);
  const currentSlideIndexRef = useRef(0);
  const liveTranscriptBufferRef = useRef<LiveTranscriptBuffer>(
    createLiveTranscriptBuffer(),
  );
  const liveSessionTranscriptBufferRef = useRef<LiveTranscriptBuffer>(
    createLiveTranscriptBuffer(),
  );
  const slideTranscriptSnapshotsRef = useRef<SlideTranscriptSnapshot[]>([]);
  const slideTranscriptVisitVersionsRef = useRef(new Map<string, number>());
  const activeSlideTranscriptVisitRef = useRef<{
    slideId: string;
    slideNum: number;
    visitedAt: string;
    visitedVer: number;
  } | null>(null);
  const liveKeywordStateRef = useRef<LiveTranscriptAnalysis | null>(null);
  const liveKeywordOccurrenceStateRef =
    useRef<LiveKeywordOccurrenceState | null>(null);
  const liveBiasContextRef = useRef<LiveSttBiasContext | null>(null);
  const liveCommandConfirmationRef = useRef(
    createRehearsalCommandConfirmationState(),
  );
  const presenterStepIndexRef = useRef(0);
  const slidePlaybackStateRef = useRef<SlidePlaybackState>(
    createSlidePlaybackState(),
  );
  const pendingFlowRestoreRef = useRef<{
    slideId: string;
    stepIndex: number;
  } | null>(null);
  const advanceControllerStateRef = useRef<AdvanceControllerState>(
    createInitialAdvanceControllerState(),
  );
  const lastSentenceSpokenAtMsRef = useRef<number | null>(null);
  const finalSentenceCommittedAtMsRef = useRef<number | null>(null);
  const pauseDetectorRef = useRef<PauseDetector | null>(null);
  const slideNavigationGateRef = useRef<ReturnType<
    typeof createSlideAssetNavigationGate
  > | null>(null);

  if (slideNavigationGateRef.current === null) {
    slideNavigationGateRef.current = createSlideAssetNavigationGate({
      commit: (request) => {
        const deckSnapshot = deckRef.current;
        presenterStepIndexRef.current = request.stepIndex;
        currentSlideIndexRef.current = request.targetSlideIndex;
        setPresenterStepIndex(request.stepIndex);
        setCurrentSlideIndex(request.targetSlideIndex);
        if (deckSnapshot) {
          retainSlideAssetWindow(deckSnapshot, request.targetSlideIndex);
        }
      },
      onPendingChange: setIsSlidePreparationPending,
      prepare: async (request) => {
        const deckSnapshot = deckRef.current;
        const slide = deckSnapshot?.slides[request.targetSlideIndex];
        if (!deckSnapshot || !slide) return;
        await prepareSlideAssets(deckSnapshot, slide);
      },
    });
  }
  const { settings: presenterSettings, save: savePresenterSettings } =
    usePresenterSettings();

  useEffect(() => {
    function handleDeveloperModeShortcut(event: KeyboardEvent) {
      if (
        event.repeat ||
        !event.ctrlKey ||
        !event.shiftKey ||
        event.altKey ||
        event.key.toLocaleLowerCase() !== "q"
      ) {
        return;
      }

      event.preventDefault();
      setShowSemanticDebugPanel((current) => {
        const next = !current;
        writeSemanticDebugPanelPreference(next);
        return next;
      });
    }

    window.addEventListener("keydown", handleDeveloperModeShortcut);
    return () =>
      window.removeEventListener("keydown", handleDeveloperModeShortcut);
  }, []);

  useEffect(() => {
    if (import.meta.env.MODE === "test" || !ENABLE_REHEARSAL_NLI) {
      return;
    }

    getOrCreateSemanticMatcher();
  }, []);

  useEffect(() => {
    if (import.meta.env.MODE === "test") {
      return;
    }
    const flags = getSemanticCueRuntimeFlags(import.meta.env);
    if (!flags.nliEnabled || flags.provider !== "browser-transformersjs") {
      return;
    }

    void getOrCreateBrowserSemanticCueNliProvider(flags).load();
  }, []);

  useEffect(
    () => () => {
      semanticCueNliProviderRef.current?.provider.dispose();
      semanticCueNliProviderRef.current = null;
    },
    [],
  );

  useEffect(
    () => () => {
      const pendingRun = activeRunRef.current;
      if (pendingRun && ["created", "uploading"].includes(pendingRun.status)) {
        void cancelRehearsalRun(pendingRun.runId).catch(() => undefined);
      }
      activeRunRef.current = null;
    },
    [],
  );

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
    if (!presenterCompanionEnabled || !deck || props.presenterWindow) {
      return;
    }
    void ensureRehearsalCompanionSession().catch(() => undefined);
  }, [
    deck?.deckId,
    deck?.version,
    presenterCompanionEnabled,
    props.presenterWindow,
  ]);

  useEffect(() => {
    const projectId = deck?.projectId ?? props.projectId ?? demoIds.projectId;
    let isCancelled = false;
    setRunComparison(null);

    void fetchProjectRehearsalReportRuns(projectId)
      .then(({ runs }) => {
        const succeededRuns = sortRehearsalRunsByCreatedAt(
          runs,
        );
        const latestRun = succeededRuns[succeededRuns.length - 1];
        return latestRun
          ? fetchRehearsalRunComparison(projectId, latestRun.runId)
          : null;
      })
      .then((comparison) => {
        if (!isCancelled) setRunComparison(comparison);
      })
      .catch(() => {
        if (!isCancelled) setRunComparison(null);
      });

    return () => {
      isCancelled = true;
    };
  }, [comparisonRefreshVersion, deck?.projectId, props.projectId]);

  useEffect(() => {
    setComparisonReminderState(createComparisonReminderState());
  }, [runComparison?.currentRunId]);

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
    if (deck) {
      setTimerDurationSeconds(getRehearsalDeckTargetSeconds(deck));
    }
  }, [deck?.deckId, deck?.targetDurationMinutes]);

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

  useEffect(() => {
    rehearsalRuntimeStatusRef.current = rehearsalRuntimeStatus;
  }, [rehearsalRuntimeStatus]);

  const displayedTimeSeconds =
    timeMode === "timer"
      ? Math.max(timerDurationSeconds - elapsedSeconds, 0)
      : elapsedSeconds;

  function requestPreparedSlideChange(
    request: SlideNavigationRequest,
  ): Promise<SlideNavigationResult> {
    const deckSnapshot = deckRef.current;
    if (!deckSnapshot || deckSnapshot.slides.length === 0) {
      return Promise.resolve("ignored");
    }

    const targetSlideIndex = Math.min(
      deckSnapshot.slides.length - 1,
      Math.max(0, request.targetSlideIndex),
    );
    const normalizedRequest = { ...request, targetSlideIndex };
    const gate = slideNavigationGateRef.current;

    if (
      targetSlideIndex === currentSlideIndexRef.current &&
      gate &&
      !gate.isPending()
    ) {
      presenterStepIndexRef.current = request.stepIndex;
      setPresenterStepIndex(request.stepIndex);
      return Promise.resolve("committed");
    }

    return gate?.request(normalizedRequest) ?? Promise.resolve("ignored");
  }

  function handlePresenterRemoteCommand(command: PresenterRemoteCommand) {
    if (command.action === "finish") {
      finishRehearsal();
      return;
    }
    const deckSnapshot = deckRef.current;
    if (!deckSnapshot) {
      return;
    }
    if (deckSnapshot.slides.length === 0) {
      return;
    }

    if (command.action === "set-audience-output") {
      setAudienceOutputMode(command.mode);
      return;
    }

    cancelAutoAdvanceForManualCommand();

    if (command.action === "timer-start") {
      if (rehearsalRuntimeStatusRef.current === "paused") {
        void resumePausedRehearsal();
        return;
      }

      if (canStartLiveDemo) {
        void startLiveDemo();
      } else if (deckSnapshot) {
        setIsTimerRunning(true);
      }
      return;
    }

    if (command.action === "timer-pause") {
      void pauseActiveRehearsal();
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
      void requestPreparedSlideChange({
        source: "manual",
        stepIndex: 0,
        targetSlideIndex: currentSlideIndexRef.current - 1,
      });
      return;
    }

    if (command.action === "goto") {
      const nextSlideIndex = Math.min(
        deckSnapshot.slides.length - 1,
        Math.max(0, Math.trunc(command.slideIndex)),
      );
      void requestPreparedSlideChange({
        source: "remote-goto",
        stepIndex: Math.max(0, Math.trunc(command.stepIndex ?? 0)),
        targetSlideIndex: nextSlideIndex,
      });
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
    void requestPreparedSlideChange({
      source: "manual",
      stepIndex: nextState.stepIndex,
      targetSlideIndex: nextState.slideIndex,
    });
  }

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

  useEffect(() => {
    const projectId = deck?.projectId;
    if (!projectId) return;

    return () => {
      slideNavigationGateRef.current?.cancel();
      clearProjectSlideImageCache(projectId);
    };
  }, [deck?.projectId]);

  useEffect(() => {
    if (!deck || !currentSlide) return;

    retainSlideAssetWindow(deck, currentSlideIndex);
    void preloadSlideAssets(deck, currentSlide, "high");
    const nextSlide = deck.slides[currentSlideIndex + 1];
    if (nextSlide) {
      void preloadSlideAssets(deck, nextSlide, "low");
    }
  }, [currentSlide?.slideId, currentSlideIndex, deck]);
  const visibleSemanticCapabilityEvents = useMemo(() => {
    if (practiceWithoutVoiceAt === null) {
      return semanticCapabilityEvents;
    }

    return [
      ...semanticCapabilityEvents,
      {
        eventId: `semantic_cap_voice_disabled_${practiceWithoutVoiceAt}`,
        capability: "stt" as const,
        fromState: "available" as const,
        toState: "unavailable" as const,
        reason: "user_disabled" as const,
        measurementMode: "none" as const,
        retryable: false,
        cueIds: [],
        at: new Date(practiceWithoutVoiceAt).toISOString(),
      },
    ];
  }, [practiceWithoutVoiceAt, semanticCapabilityEvents]);
  const semanticCapabilityItems = useMemo(
    () =>
      createSemanticCapabilityStatusItems(visibleSemanticCapabilityEvents, {
        nowMs: semanticCapabilityNowMs,
      }).slice(0, 6),
    [semanticCapabilityNowMs, visibleSemanticCapabilityEvents],
  );

  useEffect(() => {
    const delay = getNextSemanticCapabilityRecoveryDelay(
      visibleSemanticCapabilityEvents,
      semanticCapabilityNowMs,
    );
    if (delay === null) {
      return;
    }

    const timer = window.setTimeout(
      () => setSemanticCapabilityNowMs(Date.now()),
      delay + 1,
    );
    return () => window.clearTimeout(timer);
  }, [semanticCapabilityNowMs, visibleSemanticCapabilityEvents]);
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
  const p3PanelSnapshot =
    currentSlide && p3SessionState?.snapshot?.slideId === currentSlide.slideId
      ? p3SessionState.snapshot
      : createEmptySpeechTrackerSnapshot({
          slideId: currentSlide?.slideId ?? "slide-empty",
          matchableSentenceCount: p3Sentences.filter(
            (sentence) => sentence.matchable,
          ).length,
        });
  const triggerAnimationIds = useMemo(
    () => (currentSlide ? getTriggerAnimationIdsForSlide(currentSlide) : []),
    [currentSlide],
  );
  const presentationChannelState = useMemo(
    () =>
      currentSlide
        ? {
            audienceOutputMode,
            highlights: [],
            slideId: currentSlide.slideId,
            slideIndex: currentSlideIndex,
            speech: {
              coveredSentenceIds: p3PanelSnapshot.coveredSentenceIds,
              coveredSentenceMatchKinds:
                p3PanelSnapshot.coveredSentenceMatchKinds,
              matchableSentenceCount: p3PanelSnapshot.matchableSentenceCount,
              semanticDebug: semanticDebugState,
              semanticMatchingEnabled:
                presenterSettings.advancePolicy.semanticMatching,
              semanticCapabilityItems,
              snapshot: p3SessionState?.snapshot ?? null,
            },
            stepIndex: presenterStepIndex,
            timing: {
              canStartLiveStt: canStartLiveDemo,
              currentSlideElapsedSeconds: slideElapsedSeconds,
              currentSlideTargetSeconds,
              displayedSeconds: displayedTimeSeconds,
              elapsedSeconds,
              isLiveSttActive,
              isPaused: rehearsalRuntimeStatus === "paused",
              isRunning: isTimerRunning,
              liveStatus,
              mode: timeMode,
              timerDurationSeconds,
            },
          }
        : null,
    [
      canStartLiveDemo,
      audienceOutputMode,
      currentSlide?.slideId,
      currentSlideIndex,
      currentSlideTargetSeconds,
      displayedTimeSeconds,
      elapsedSeconds,
      isLiveSttActive,
      isTimerRunning,
      liveStatus,
      p3PanelSnapshot,
      p3SessionState?.snapshot,
      presenterStepIndex,
      presenterSettings.advancePolicy.semanticMatching,
      rehearsalRuntimeStatus,
      semanticDebugState,
      semanticCapabilityItems,
      slideElapsedSeconds,
      timeMode,
      timerDurationSeconds,
    ],
  );
  const livePresentationOutput = useLivePresentationOutput({
    audienceWindowConnected: Boolean(
      slideWindowRef.current && !slideWindowRef.current.closed,
    ),
    companionEnabled: presenterCompanionEnabled,
    deck,
    displayRole,
    enabled:
      !props.presenterWindow &&
      (displayRole === "presenter" ||
        displayRole === "slide-receiver" ||
        displayRole === "slide-surface"),
    getAudienceWindow: () =>
      slideWindowRef.current as unknown as AudienceStreamBridgeWindow | null,
    localWindowSessionId: props.presenterSessionId,
    onCommand: handlePresenterRemoteCommand,
    onOutputModeChange: setAudienceOutputMode,
    onPeerReady: (peer) => {
      if (peer === "slide-window") reattachAudienceStreamRef.current();
    },
    onScreenShareEnded: () => stopAudienceStreamRef.current(),
    outputMode: audienceOutputMode,
    persistedSessionId: companionSession?.sessionId,
    state: presentationChannelState,
    triggerAnimationIds,
  });
  const presentationChannel = livePresentationOutput.localChannel;
  const audienceScreenShareIdentity =
    livePresentationOutput.hostIdentity.localChannel;
  const audienceScreenShare = livePresentationOutput.screenShare;
  reattachAudienceStreamRef.current = audienceScreenShare.reattach;
  stopAudienceStreamRef.current = () =>
    audienceScreenShare.stopSharing({ returnToSlide: true });
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
  const totalTimingProgress = getPresenterTimingProgress(
    p3TimingSnapshot.elapsedSeconds,
    p3TimingSnapshot.deckTargetSeconds,
  );
  const slideTimingProgress = getPresenterTimingProgress(
    p3TimingSnapshot.currentSlideElapsedSeconds,
    p3TimingSnapshot.currentSlideTargetSeconds,
  );
  const rehearsalProgressPercent = totalTimingProgress.percent;
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

  useEffect(() => {
    const activeVisit = activeSlideTranscriptVisitRef.current;
    if (
      !activeVisit ||
      !currentSlide ||
      activeVisit.slideId === currentSlide.slideId
    ) {
      return;
    }

    captureSlideTranscriptSnapshot("slide-change");
    beginSlideTranscriptVisit(currentSlide, currentSlideIndex);
  }, [currentSlide?.slideId, currentSlideIndex]);

  const isRehearsalCompletionVisible =
    Boolean(deck) &&
    (hasLocalCompletion ||
      isLiveStopModalOpen ||
      phase === "succeeded" ||
      (Boolean(p3RunMeta) &&
        !isLiveDemoActive &&
        !isLiveSttActive &&
        !isTimerRunning &&
        phase !== "recording"));

  usePresenterKeyboard({
    enabled:
      Boolean(deck) &&
      !props.presenterWindow &&
      !isRehearsalCompletionVisible &&
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
    const pendingFlowRestore = pendingFlowRestoreRef.current;
    if (
      currentSlide &&
      pendingFlowRestore?.slideId === currentSlide.slideId
    ) {
      pendingFlowRestoreRef.current = null;
      restoreLivePlaybackAtStep(currentSlide, pendingFlowRestore.stepIndex);
    } else {
      resetLivePlaybackForSlide(currentSlide);
    }
    const nextBiasContext =
      deck && currentSlide
        ? buildLiveSttBiasContext(currentSlide, {
            nearbySlides: getNearbySlides(deck, currentSlideIndex),
            pronunciationLexicon:
              activeRunRef.current?.evaluationSnapshot?.pronunciationLexicon,
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

  const isJobActive = phase === "uploading" || phase === "processing";
  const smoothProgress = useJobSmoothProgress(job, isJobActive);
  const completionProgress = phase === "succeeded" ? 100 : smoothProgress;
  const completionMessage =
    phase === "uploading"
      ? "음성 업로드 중"
      : phase === "succeeded"
        ? "리포트 생성 완료"
        : "AI가 발표를 분석하는 중";
  const shouldShowCompletionModal = isCompletionModalOpen || isJobActive;

  async function startRecording(options: { allowDuringReport?: boolean } = {}) {
    if (!deck || (!options.allowDuringReport && !canRecord)) return;
    const activeDeck = deck;
    const activeSlide =
      activeDeck.slides[currentSlideIndexRef.current] ?? null;
    recordingSubmissionVersionRef.current += 1;
    setPracticeWithoutVoiceAt(null);
    stopLiveDemo();

    setError("");
    cancelPendingEvaluationRun();
    setRun(null);
    setJob(null);
    setHasLocalCompletion(false);
    finishAfterReportRef.current = false;
    setIsCompletionModalOpen(false);
    setLiveError("");
    setLiveAudioLevel(null);
    setLiveDebugPcmRecording(null);
    if (options.allowDuringReport) {
      setPhase("idle");
    }
    resetLiveSessionTranscript();
    resetLivePlaybackForSlide(activeSlide);
    resetAutoAdvanceRuntimeState(activeSlide?.slideId ?? null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("이 브라우저는 마이크 녹음을 지원하지 않습니다.");
      setPhase("failed");
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await requestRehearsalMicrophoneStream(navigator.mediaDevices);
      const evaluationSnapshot = await prepareEvaluationSnapshot(activeDeck);
      const session = createRecordingSession(stream, {
        onError: (recordingError) => {
          stopMediaStream(stream);
          if (streamRef.current === stream) {
            streamRef.current = null;
          }
          sessionRef.current = null;
          cancelPendingEvaluationRun();
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
      resetSlideTranscriptSnapshots(activeDeck, currentSlideIndexRef.current);
      setPhase("recording");
      setIsTimerRunning(true);
      setRehearsalRuntimeStatus("running");
      rehearsalRuntimeStatusRef.current = "running";
      void startP3Tracking(stream, evaluationSnapshot);
    } catch (cause) {
      stopMediaStream(stream);
      if (streamRef.current === stream) {
        streamRef.current = null;
      }
      sessionRef.current = null;
      cancelPendingEvaluationRun();
      const hasValidationError = logRehearsalValidationFailure(cause, {
        projectId: activeDeck.projectId,
        deckId: activeDeck.deckId,
      });
      setError(
        hasValidationError
          ? rehearsalDeckInvalidMessage
          : toMicrophoneErrorMessage(cause),
      );
      setPhase("failed");
    }
  }

  useEffect(() => {
    const mode = shouldAutoStartRef.current;
    if (!mode || mode === "starting" || !deck || phase !== "idle") {
      return;
    }
    if (mode === "microphone" && !canRecord) return;
    shouldAutoStartRef.current = "starting";
    if (mode === "without-voice") {
      startPracticeWithoutVoice();
      shouldAutoStartRef.current = null;
    } else {
      void startRecording().finally(() => {
        shouldAutoStartRef.current = null;
      });
    }
  }, [canRecord, deck, phase]);

  async function startLiveDemo() {
    if (!deck || !canStartLiveDemo) return;

    setLiveError("");
    setLiveAudioLevel(null);
    setLiveDebugPcmRecording(null);
    setHasLocalCompletion(false);
    setElapsedSeconds(0);
    setIsTimerRunning(true);
    setRehearsalRuntimeStatus("running");
    rehearsalRuntimeStatusRef.current = "running";
    resetLiveSessionTranscript();
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
        setRehearsalRuntimeStatus("idle");
        rehearsalRuntimeStatusRef.current = "idle";
      } else {
        setIsTimerRunning(true);
        setRehearsalRuntimeStatus("running");
        rehearsalRuntimeStatusRef.current = "running";
      }
    } catch (cause) {
      stopMediaStream(stream);
      if (liveDemoStreamRef.current === stream) {
        liveDemoStreamRef.current = null;
      }
      setIsLiveDemoActive(false);
      setRehearsalRuntimeStatus("idle");
      rehearsalRuntimeStatusRef.current = "idle";
      setLiveError(toMicrophoneErrorMessage(cause));
      setLiveStatus("failed");
    }
  }

  async function retryInitialRecordingLiveStt() {
    const stream = streamRef.current;
    const coordinator = liveSttRetryCoordinatorRef.current;
    if (
      !canRetryInitialRecordingLiveStt({
        hasActiveSession: p3SessionRef.current !== null,
        hasReusableStream: isReusableRehearsalMediaStream(stream),
        isRecording: phase === "recording",
        isRetrying: isLiveSttRetrying || coordinator.isRetrying(),
        liveStatus,
      }) ||
      !stream
    ) {
      return false;
    }

    setIsLiveSttRetrying(true);
    setLiveError("");
    try {
      return await coordinator.retry((isCurrent) =>
        startP3Tracking(
          stream,
          activeRunRef.current?.evaluationSnapshot ?? undefined,
          () =>
            isCurrent() &&
            streamRef.current === stream &&
            isReusableRehearsalMediaStream(stream),
        ),
      );
    } finally {
      setIsLiveSttRetrying(false);
    }
  }

  function stopLiveDemo(options: { showCompletionModal?: boolean } = {}) {
    const wasLiveDemoActive = isLiveDemoActive || isLiveSttActive;
    setRehearsalRuntimeStatus("stopping");
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
    setRehearsalRuntimeStatus("idle");
    rehearsalRuntimeStatusRef.current = "idle";
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

    captureSlideTranscriptSnapshot("rehearsal-end");
    liveSttRetryCoordinatorRef.current.cancel();
    setRehearsalRuntimeStatus("stopping");
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
    setRehearsalRuntimeStatus("idle");
    rehearsalRuntimeStatusRef.current = "idle";
  }

  async function pauseActiveRehearsal() {
    if (
      rehearsalRuntimeStatusRef.current === "paused" ||
      rehearsalRuntimeStatusRef.current === "pausing"
    ) {
      return;
    }

    cancelAutoAdvanceForManualCommand();
    pauseDetectorRef.current?.accept({ type: "reset" });
    setPauseDetectorSnapshot(null);
    setIsTimerRunning(false);
    setRehearsalRuntimeStatus("pausing");
    rehearsalRuntimeStatusRef.current = "pausing";

    const isRecordingPause = phase === "recording";
    const shouldPauseSpeech =
      isRecordingPause || isLiveDemoActive || isLiveSttActive;
    const p3Session = p3SessionRef.current;
    const pauseResult = await runRehearsalPauseSequence({
      pauseRecording: isRecordingPause
        ? async () => {
            await sessionRef.current?.pause();
          }
        : undefined,
      pauseSpeech: async () => {
        if (!shouldPauseSpeech) {
          return;
        }
        if (p3Session) {
          try {
            await p3Session.pause();
          } finally {
            setP3SessionState(p3Session.getState());
          }
        } else {
          await liveSttPortRef.current?.stop();
        }
      },
    });

    if (pauseResult.status === "paused") {
      setMediaStreamTracksEnabled(
        isRecordingPause ? streamRef.current : liveDemoStreamRef.current,
        false,
      );
      setLiveAudioLevel(null);
      setLiveStatus((current) =>
        current === "listening" || current === "starting" ? "stopped" : current,
      );
      setIsTimerRunning(false);
      setRehearsalRuntimeStatus("paused");
      rehearsalRuntimeStatusRef.current = "paused";
    } else {
      setIsTimerRunning(true);
      setRehearsalRuntimeStatus("running");
      rehearsalRuntimeStatusRef.current = "running";
    }

    if (pauseResult.error) {
      const error = toLiveSttError(pauseResult.error);
      if (isRecordingPause) {
        setError(error.message);
      } else {
        setLiveError(error.message);
      }
    }
  }

  async function resumePausedRehearsal() {
    if (rehearsalRuntimeStatusRef.current !== "paused") {
      return;
    }

    const p3Session = p3SessionRef.current;
    let stream =
      phase === "recording" ? streamRef.current : liveDemoStreamRef.current;
    setRehearsalRuntimeStatus("resuming");
    rehearsalRuntimeStatusRef.current = "resuming";
    try {
      if (phase === "recording" || p3Session) {
        if (!isReusableRehearsalMediaStream(stream)) {
          if (phase === "recording") {
            throw new LiveSttError(
              "start_failed",
              "녹음 마이크 연결이 종료되어 음성 인식을 다시 시작하지 못했습니다.",
            );
          }
          stream = await requestRehearsalMicrophoneStream(navigator.mediaDevices);
          stopMediaStream(liveDemoStreamRef.current);
          liveDemoStreamRef.current = stream;
        }
        if (!stream) {
          throw new LiveSttError(
            "start_failed",
            "음성 인식에 사용할 마이크 연결을 찾지 못했습니다.",
          );
        }

        setMediaStreamTracksEnabled(stream, true);
        if (phase === "recording") {
          await sessionRef.current?.resume();
        }
      }

      if (p3Session) {
        if (!stream) {
          throw new LiveSttError(
            "start_failed",
            "음성 인식에 사용할 마이크 연결을 찾지 못했습니다.",
          );
        }
        setLiveError("");
        setLiveStatus("starting");
        const resumedState = await p3Session.resume({ audioSource: stream });
        if (resumedState.status !== "running") {
          throw new LiveSttError(
            "start_failed",
            "음성 인식 세션을 다시 시작하지 못했습니다.",
          );
        }
        setP3SessionState(resumedState);
        setLiveStatus("listening");
      }

      setIsTimerRunning(true);
      setRehearsalRuntimeStatus("running");
      rehearsalRuntimeStatusRef.current = "running";
      setScriptAutoFollowKey((current) => current + 1);
    } catch (cause) {
      const error = toLiveSttError(cause);
      await sessionRef.current?.pause().catch(() => undefined);
      setMediaStreamTracksEnabled(stream, false);
      if (phase === "recording") {
        setError(error.message);
      } else {
        setLiveError(error.message);
        setLiveStatus(isLiveSttUnavailable(error) ? "unavailable" : "failed");
      }
      setIsTimerRunning(false);
      setRehearsalRuntimeStatus("paused");
      rehearsalRuntimeStatusRef.current = "paused";
    }
  }

  async function handleTimePrimaryAction() {
    if (rehearsalRuntimeStatus === "paused") {
      await resumePausedRehearsal();
      return;
    }

    if (isTimerRunning) {
      await pauseActiveRehearsal();
      return;
    }

    await startRecording();
  }

  function handleSideTimerPrimaryAction() {
    if (rehearsalRuntimeStatus === "paused") {
      void resumePausedRehearsal();
      return;
    }

    if (phase === "recording") {
      void pauseActiveRehearsal();
      return;
    }

    if (canStopLiveDemo) {
      void pauseActiveRehearsal();
      return;
    }

    if (isTimerRunning) {
      setIsTimerRunning(false);
      setRehearsalRuntimeStatus("paused");
      return;
    }

    if (canRecord) {
      void startRecording();
      return;
    }

    if (deck) {
      setIsTimerRunning(true);
      setRehearsalRuntimeStatus("running");
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

  function getOrCreateLiveSttPort(engineId: LiveSttEngineId) {
    if (props.liveSttPort) {
      liveSttPortRef.current = props.liveSttPort;
      return props.liveSttPort;
    }

    const cachedPort = liveSttPortRef.current;
    const activeProjectId =
      deckRef.current?.projectId ?? props.projectId ?? demoIds.projectId;
    if (
      cachedPort?.engineId === engineId &&
      (cachedPort.engineId !== "openai-realtime" ||
        readLiveSttPortProjectId(cachedPort) === activeProjectId)
    ) {
      return cachedPort;
    }

    cachedPort?.dispose();
    const port = createDefaultLiveSttPort({
      engineId,
      legacyAdapter: props.liveSttAdapter,
      onAudioLevel: setLiveAudioLevel,
      onDebugPcmAvailable: setLiveDebugPcmRecording,
      getDecodingMethod: getLiveSttDebugDecodingMethod,
      projectId: activeProjectId,
    });
    liveSttPortRef.current = port;
    return port;
  }

  async function resolveEffectiveLiveSttEngine(): Promise<LiveSttEngineId> {
    if (props.liveSttPort) {
      return props.liveSttPort.engineId;
    }

    try {
      return (await fetchLiveSttRuntimeConfig()).liveSttEngine;
    } catch {
      return presenterSettings.sttEngine;
    }
  }

  function getOrCreateSemanticMatcher() {
    if (semanticMatcherRef.current) {
      return semanticMatcherRef.current;
    }

    const servicePromise = getOrCreateSemanticEmbeddingService();
    semanticMatcherRef.current = createSemanticUtteranceMatcher({
      embeddingService: {
        embedQuery: async (text) => (await servicePromise).embedQuery(text),
        embedPassages: async (texts) =>
          (await servicePromise).embedPassages(texts),
      },
    });
    return semanticMatcherRef.current;
  }

  function createSemanticCueRuntimeFromFlags(
    mode: "rehearsal" | "presentation",
  ) {
    const flags = getSemanticCueRuntimeFlags(import.meta.env);
    const embeddingIndex = getOrCreateSemanticCueEmbeddingIndex();

    if (
      !isSemanticCueNliEnabledForMode(flags, mode) ||
      flags.provider === "off"
    ) {
      return createSemanticCueRuntime({
        enabled: false,
        embeddingIndex,
      });
    }

    if (flags.provider === "browser-transformersjs") {
      return createSemanticCueRuntime({
        provider: getOrCreateBrowserSemanticCueNliProvider(flags),
        enabled: true,
        nliMode: "shadow",
        embeddingIndex,
      });
    }

    if (flags.provider !== "mock") {
      return createSemanticCueRuntime({
        enabled: false,
        embeddingIndex,
      });
    }

    return createSemanticCueRuntime({
      provider: createMockSemanticCueNliProvider({
        modelId: flags.modelId,
      }),
      enabled: true,
      embeddingIndex,
    });
  }

  function getOrCreateBrowserSemanticCueNliProvider(
    flags: ReturnType<typeof getSemanticCueRuntimeFlags>,
  ) {
    const key = `${flags.provider}:${flags.modelId}:${flags.nliDevice ?? "none"}`;
    if (semanticCueNliProviderRef.current?.key !== key) {
      semanticCueNliProviderRef.current?.provider.dispose();
      semanticCueNliProviderRef.current = {
        key,
        provider: createBrowserTransformersSemanticCueNliProvider({
          modelId: flags.modelId,
          loadOnEvaluate: false,
          ...(flags.nliDevice === null
            ? {}
            : { deviceOverride: flags.nliDevice }),
        }),
      };
    }
    return semanticCueNliProviderRef.current.provider;
  }

  function getOrCreateSemanticCueEmbeddingIndex() {
    if (semanticCueEmbeddingIndexRef.current) {
      return semanticCueEmbeddingIndexRef.current;
    }
    semanticCueEmbeddingIndexRef.current = createSemanticCueEmbeddingIndex({
      embeddingService: {
        embedQuery: async (text) =>
          (await getOrCreateSemanticEmbeddingService()).embedQuery(text),
        embedPassages: async (texts) =>
          (await getOrCreateSemanticEmbeddingService()).embedPassages(texts),
      },
    });
    return semanticCueEmbeddingIndexRef.current;
  }

  function getOrCreateSemanticEmbeddingService() {
    semanticEmbeddingServicePromiseRef.current ??= getE5EmbeddingService(() => {
      setSemanticDebugState((current) =>
        createSemanticDebugState({
          ...current,
          status: "loading-model",
          error: null,
        }),
      );
    })
      .then((service) => {
        setSemanticDebugState(markSemanticModelReady);
        return service;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setSemanticDebugState((current) =>
          createSemanticDebugState({
            ...current,
            status: "error",
            error: message,
          }),
        );
        throw error;
      });
    return semanticEmbeddingServicePromiseRef.current;
  }

  async function startP3Tracking(
    stream: MediaStream,
    evaluationSnapshot?: RehearsalEvaluationSnapshot,
    shouldContinue: () => boolean = () => true,
  ) {
    const deckSnapshot = deckRef.current ?? deck;
    const startSlideIndex = currentSlideIndexRef.current;
    if (!deckSnapshot?.slides[startSlideIndex]) {
      return false;
    }

    let port: LiveSttPort;
    try {
      const effectiveEngineId = await resolveEffectiveLiveSttEngine();
      if (!shouldContinue()) {
        return false;
      }
      port = getOrCreateLiveSttPort(effectiveEngineId);
    } catch (cause) {
      if (!shouldContinue()) {
        return false;
      }
      const error = toLiveSttError(cause);
      setLiveStatus(isLiveSttUnavailable(error) ? "unavailable" : "failed");
      setLiveError(error.message);
      setLiveAudioLevel(null);
      resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
      return false;
    }
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
      slides: buildP3SessionSlides(
        deckSnapshot,
        evaluationSnapshot ?? createRehearsalEvaluationSnapshot(deckSnapshot),
      ),
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
      semanticMatcher:
        import.meta.env.MODE === "test" ? undefined : getOrCreateSemanticMatcher(),
      semanticCueRuntime:
        import.meta.env.MODE === "test" || !ENABLE_REHEARSAL_NLI
          ? undefined
          : createSemanticCueRuntimeFromFlags("rehearsal"),
      isSemanticMatchingEnabled: () =>
        presenterSettings.advancePolicy.semanticMatching,
      onSemanticDebugState: setSemanticDebugState,
      onSemanticCueDebugEvent: (event) => {
        semanticCueDebugBufferRef.current.push(event);
        setSemanticCueDebugEvents(semanticCueDebugBufferRef.current.snapshot());
      },
      onSemanticCapabilityEvent: (event) => {
        setSemanticCapabilityEvents((current) =>
          [...current, event].slice(-100),
        );
        setSemanticCapabilityNowMs(Date.now());
      },
    });
    p3SessionRef.current = session;

    try {
      await session.start({
        audioSource: stream,
        slideIndex: startSlideIndex,
      });
      const isStaleRetry = !shouldContinue();
      if (p3SessionRef.current !== session || isStaleRetry) {
        if (isStaleRetry) {
          await session.stop().catch(() => null);
        }
        if (p3SessionRef.current === session) {
          cleanupLiveSttSubscriptions();
          p3SessionRef.current = null;
          pendingP3SlideIndexRef.current = null;
        }
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
      const isStaleRetry = !shouldContinue();
      if (p3SessionRef.current !== session || isStaleRetry) {
        if (isStaleRetry) {
          await session.stop().catch(() => null);
        }
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

  function handleSemanticCapabilityAction(item: SemanticCapabilityStatusItem) {
    if (item.actionLabel === "Cue 검토로 이동" && deck) {
      window.location.assign(`/project/${encodeURIComponent(deck.projectId)}`);
      return;
    }

    if (item.actionLabel === "서버 재평가" && run) {
      window.location.assign(getRehearsalReportPath(run.projectId, run.runId));
      return;
    }

    if (
      item.actionLabel === "마이크 권한 확인" ||
      item.actionLabel === "재시도"
    ) {
      setPracticeWithoutVoiceAt(null);
      void startLiveDemo();
    }
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
    if (rehearsalRuntimeStatusRef.current === "paused") {
      return;
    }

    const atMs =
      "atMs" in event && typeof event.atMs === "number"
        ? event.atMs
        : Date.now();
    const detector = ensurePauseDetector();
    const outputs = detector.accept(event);
    for (const output of outputs) {
      if (output.type !== "pause-started") {
        continue;
      }
      const p3Session = p3SessionRef.current;
      if (p3Session?.acceptPrompterPauseBoundary(output.silenceDurationMs)) {
        setP3SessionState(p3Session.getState());
        setScriptAutoFollowKey((current) => current + 1);
      }
    }
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
    finalSentenceCommittedAtMsRef.current = null;
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
    finalSentenceCommitted: boolean;
    finalSentenceSpoken: boolean;
    remainingTriggerSteps: number;
  }) {
    if (
      !deck ||
      !currentSlide ||
      rehearsalRuntimeStatusRef.current !== "running"
    ) {
      return;
    }

    const nowMs = Date.now();
    if (input.finalSentenceCommitted) {
      finalSentenceCommittedAtMsRef.current ??= nowMs;
    } else {
      finalSentenceCommittedAtMsRef.current = null;
    }
    const detector = ensurePauseDetector();
    const pause = pauseDetectorSnapshot ?? detector.snapshot(nowMs);
    const result = evaluateAdvanceController(
      advanceControllerStateRef.current,
      {
        effectiveCoverage: input.effectiveCoverage,
        finalSentenceCommitted: input.finalSentenceCommitted,
        finalSentenceCommittedAtMs: finalSentenceCommittedAtMsRef.current,
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
        semanticAutoActionAllowed: isSemanticAutoActionAllowed(
          semanticCapabilityItems,
        ),
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

      void requestPreparedSlideChange({
        source: "auto",
        stepIndex: 0,
        targetSlideIndex: currentSlideIndex + 1,
      }).then((result) => {
        if (result !== "committed") return;
        setLiveSlideAdvance({
          type: "slide-advance",
          fromSlideId: currentSlide.slideId,
          toSlideId: nextSlide.slideId,
          reason: "keyword-coverage",
          coverage: input.effectiveCoverage,
        });
      });
    }
  }

  function handleLiveSttError(error: LiveSttError) {
    if (rehearsalRuntimeStatusRef.current === "paused") {
      return;
    }

    if (!p3SessionRef.current) {
      return;
    }

    setLiveStatus(isLiveSttUnavailable(error) ? "unavailable" : "failed");
    setLiveError(error.message);
    setLiveAudioLevel(null);
    resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
  }

  function handleLiveSttResult(result: LiveSttResult) {
    if (
      !p3SessionRef.current ||
      rehearsalRuntimeStatusRef.current === "paused"
    ) {
      return;
    }

    if (result.text.trim()) {
      setScriptAutoFollowKey((current) => current + 1);
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
    if (rehearsalRuntimeStatusRef.current === "paused") {
      return;
    }

    const deckSnapshot = deckRef.current;
    const slideIndex = currentSlideIndexRef.current;
    const slide = deckSnapshot?.slides[slideIndex];
    if (!deckSnapshot || !slide) {
      return;
    }

    const previousTranscript = renderLiveTranscriptBuffer(
      liveTranscriptBufferRef.current,
    );
    const nextBuffer = applyLiveTranscriptEvent(
      liveTranscriptBufferRef.current,
      event,
    );
    liveTranscriptBufferRef.current = nextBuffer;

    const nextSessionBuffer = applyLiveTranscriptEvent(
      liveSessionTranscriptBufferRef.current,
      event,
    );
    liveSessionTranscriptBufferRef.current = nextSessionBuffer;
    setLiveSessionTranscript(renderLiveTranscriptBuffer(nextSessionBuffer));

    const transcript = renderLiveTranscriptBuffer(nextBuffer);
    const biasMode = getLiveSttBiasMode();
    const biasContext = getCurrentLiveBiasContext(deckSnapshot, slideIndex);
    const matchingTranscript = shouldUseLiveSttPostprocessBias(biasMode)
      ? applyLiveTranscriptBias(transcript, biasContext)
      : transcript;
    const previousMatchingTranscript = shouldUseLiveSttPostprocessBias(biasMode)
      ? applyLiveTranscriptBias(previousTranscript, biasContext)
      : previousTranscript;
    const analysis = evaluateLiveTranscript(
      slide,
      matchingTranscript,
      activeRunRef.current?.evaluationSnapshot?.pronunciationLexicon,
    );
    const confirmedCommand = confirmRehearsalCommandCandidate(
      liveCommandConfirmationRef.current,
      detectRehearsalCommandCandidate(event),
    );
    const slideTriggerAnimationIds = getTriggerAnimationIdsForSlide(slide);
    const slideAnimationPlan = createSlideshowAnimationPlan({
      slide,
      triggerAnimationIds: slideTriggerAnimationIds,
    });
    const targetOccurrenceIds = getKeywordOccurrenceTriggerIdsForSlide(slide);
    const occurrenceState = getLiveKeywordOccurrenceStateForSlide(
      liveKeywordOccurrenceStateRef.current,
      slide.slideId,
    );
    const occurrenceMatches = matchKeywordOccurrenceTriggers({
      slide,
      targetOccurrenceIds,
      previousTranscript: previousMatchingTranscript,
      transcript: matchingTranscript,
      latestTranscript: event.transcript,
      confidence: event.confidence,
      confirmedOccurrenceIds: occurrenceState.confirmedOccurrenceIds,
    });

    for (const occurrenceMatch of occurrenceMatches) {
      setLiveCue(
        createKeywordOccurrenceAnimationCueEvent({
          match: occurrenceMatch,
          slideId: slide.slideId,
        }),
      );

      applyTriggeredSlideActions(
        slide,
        slideAnimationPlan,
        resolveKeywordOccurrenceTriggeredActions(
          slide,
          occurrenceMatch.keywordId,
          occurrenceMatch.occurrenceId,
        ),
        deckSnapshot.slides.length,
      );
    }
    liveKeywordOccurrenceStateRef.current = confirmKeywordOccurrenceMatches(
      occurrenceState,
      occurrenceMatches,
    );

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
      void requestPreparedSlideChange({
        source: "auto",
        stepIndex: 0,
        targetSlideIndex: Math.min(
          slideCount - 1,
          currentSlideIndexRef.current + 1,
        ),
      });
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
    liveKeywordOccurrenceStateRef.current = slide
      ? createLiveKeywordOccurrenceState(slide.slideId)
      : null;
    liveCommandConfirmationRef.current =
      createRehearsalCommandConfirmationState();
    setLiveKeywordState(nextKeywordState);
    setLiveCue(null);
  }

  function resetLiveSessionTranscript() {
    liveSessionTranscriptBufferRef.current = createLiveTranscriptBuffer();
    setLiveSessionTranscript("");
  }

  function beginSlideTranscriptVisit(
    slide: Slide,
    slideIndex: number,
    visitedAt = new Date().toISOString(),
  ) {
    const visitedVer =
      (slideTranscriptVisitVersionsRef.current.get(slide.slideId) ?? 0) + 1;
    slideTranscriptVisitVersionsRef.current.set(slide.slideId, visitedVer);
    activeSlideTranscriptVisitRef.current = {
      slideId: slide.slideId,
      slideNum: slideIndex + 1,
      visitedAt,
      visitedVer,
    };
  }

  function captureSlideTranscriptSnapshot(
    reason: SlideTranscriptSnapshot["reason"],
    capturedAt = new Date().toISOString(),
  ) {
    const activeVisit = activeSlideTranscriptVisitRef.current;
    if (!activeVisit) {
      return;
    }

    slideTranscriptSnapshotsRef.current.push({
      ...activeVisit,
      transcript: renderLiveTranscriptBuffer(
        liveSessionTranscriptBufferRef.current,
      ),
      capturedAt,
      reason,
    });
    activeSlideTranscriptVisitRef.current = null;
  }

  function resetSlideTranscriptSnapshots(
    activeDeck: Deck,
    slideIndex: number,
  ) {
    slideTranscriptSnapshotsRef.current = [];
    slideTranscriptVisitVersionsRef.current = new Map();
    activeSlideTranscriptVisitRef.current = null;
    const slide = activeDeck.slides[slideIndex];
    if (slide) {
      beginSlideTranscriptVisit(slide, slideIndex);
    }
  }

  function resetLivePlaybackForSlide(slide: Slide | null) {
    resetLiveTranscriptForSlide(slide);
    const nextSlidePlaybackState = createSlidePlaybackState();
    slidePlaybackStateRef.current = nextSlidePlaybackState;
    setSlidePlaybackState(nextSlidePlaybackState);
    setLiveSlideAdvance(null);
  }

  function restoreLivePlaybackAtStep(slide: Slide, stepIndex: number) {
    resetLiveTranscriptForSlide(slide);
    const restored = restoreSlidePlaybackAtStep({
      slide,
      slideAnimationPlan: createSlideshowAnimationPlan({
        slide,
        triggerAnimationIds: getTriggerAnimationIdsForSlide(slide),
      }),
      stepIndex,
    });
    slidePlaybackStateRef.current = restored.playbackState;
    setSlidePlaybackState(restored.playbackState);
    liveKeywordOccurrenceStateRef.current = {
      confirmedOccurrenceIds: restored.consumedOccurrenceIds,
      slideId: slide.slideId,
    };
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
      pronunciationLexicon:
        activeRunRef.current?.evaluationSnapshot?.pronunciationLexicon,
    });
    liveBiasContextRef.current = nextBiasContext;
    return nextBiasContext;
  }

  function cleanupLiveSttSubscriptions() {
    liveSttSubscriptionCleanupRef.current?.();
    liveSttSubscriptionCleanupRef.current = null;
  }

  async function submitRecording(activeDeck: Deck, audioFile: File) {
    const submissionVersion = recordingSubmissionVersionRef.current;
    const isCurrentSubmission = () =>
      recordingSubmissionVersionRef.current === submissionVersion;

    setPhase("uploading");
    setError("");

    try {
      let uploadRun = activeRunRef.current;
      if (!uploadRun) {
        const recovered = await createRehearsalRunForUpload(
          activeDeck.projectId,
          activeDeck.deckId,
          activeDeck.version,
          fetch,
          await resolveRehearsalCoachingContext(activeDeck.projectId, props.sourceGoalSetId),
          preparedSlideSnapshotsRef.current,
        );
        uploadRun = recovered.run;
        if (!isCurrentSubmission()) {
          void cancelRehearsalRun(uploadRun.runId).catch(() => undefined);
          return;
        }
        if (recovered.evaluationSnapshotMismatch) {
          setLiveError(
            "발표 자료가 변경되어 이번 회차는 전달 방식만 분석하고 의미 평가는 제외합니다.",
          );
        }
        activeRunRef.current = uploadRun;
        setRun(uploadRun);
        clearPreparedRehearsalSlideSnapshots(props.snapshotPreparationId);
      }

      const runMeta = pendingP3RunMetaRef.current
        ? await pendingP3RunMetaRef.current
        : p3RunMetaRef.current;
      const result = await runRehearsalUploadFlow({
        runId: uploadRun.runId,
        audioFile,
        runMeta,
        liveTranscript: renderLiveTranscriptBuffer(
          liveSessionTranscriptBufferRef.current,
        ),
        slideTranscriptSnapshots: slideTranscriptSnapshotsRef.current,
        onJobUpdate: (nextJob) => {
          if (!isCurrentSubmission()) {
            return;
          }
          setJob(nextJob);
          setPhase("processing");
        },
      });
      if (!isCurrentSubmission()) {
        return;
      }
      setRun(result.run);
      activeRunRef.current = result.run;
      setJob(result.job);

      if (result.job.status === "failed") {
        setPhase("failed");
        setIsCompletionModalOpen(false);
        setError(
          result.job.error?.message ||
            result.job.message ||
            "리허설 분석에 실패했습니다.",
        );
        return;
      }

      await loadReportForRun(
        result.run.runId,
        result.run,
        isCurrentSubmission,
      );
      if (!isCurrentSubmission()) {
        return;
      }
      setPhase("succeeded");
      setIsCompletionModalOpen(true);
      if (finishAfterReportRef.current) {
        finishAfterReportRef.current = false;
      }
    } catch (cause) {
      if (!isCurrentSubmission()) {
        return;
      }
      setError(toRehearsalFlowMessage(cause));
      setIsCompletionModalOpen(false);
      setPhase("failed");
    }
  }

  async function prepareEvaluationSnapshot(activeDeck: Deck) {
    const coachingContext = await resolveRehearsalCoachingContext(
      activeDeck.projectId,
      props.sourceGoalSetId,
    );
    const slideSnapshots =
      preparedSlideSnapshotsRef.current ??
      readPreparedRehearsalSlideSnapshots({
        deckId: activeDeck.deckId,
        deckVersion: activeDeck.version,
        preparationId: props.snapshotPreparationId,
        projectId: activeDeck.projectId,
      });
    preparedSlideSnapshotsRef.current = slideSnapshots;
    const prepared = await prepareRehearsalEvaluationRun(
      activeDeck,
      fetch,
      coachingContext,
      slideSnapshots,
    );
    activeRunRef.current = prepared.run;
    setRun(prepared.run);
    if (prepared.run) {
      clearPreparedRehearsalSlideSnapshots(props.snapshotPreparationId);
    }
    if (prepared.serverEvaluation.state === "unavailable") {
      setLiveError(
        "서버 의미 평가에 연결할 수 없습니다. 로컬 리허설은 계속되며 서버 리포트는 저장 전 다시 확인합니다.",
      );
    }
    return prepared.evaluationSnapshot;
  }

  function cancelPendingEvaluationRun() {
    const pendingRun = activeRunRef.current;
    if (!pendingRun || !["created", "uploading"].includes(pendingRun.status)) {
      return;
    }

    activeRunRef.current = null;
    void cancelRehearsalRun(pendingRun.runId).catch(() => undefined);
  }

  async function loadReportForRun(
    runId: string,
    fallbackRun: RehearsalRun,
    shouldApply: () => boolean = () => true,
  ) {
    try {
      const response = await fetchRehearsalReport(runId);
      if (shouldApply()) {
        setRun(response.run);
      }
    } catch {
      if (shouldApply()) {
        setRun(fallbackRun);
      }
    }
  }

  const goPrevious = () => {
    cancelAutoAdvanceForManualCommand();
    void requestPreparedSlideChange({
      source: "manual",
      stepIndex: 0,
      targetSlideIndex: currentSlideIndexRef.current - 1,
    });
  };
  const handleAnimationFlowNavigation = (navigation: AnimationFlowNavigation) => {
    if (!deck) return;
    cancelAutoAdvanceForManualCommand();
    const targetSlide = deck.slides[navigation.targetSlideIndex];
    if (!targetSlide) return;
    const stepIndex =
      targetSlide.kind === "activity" || targetSlide.kind === "activity-results"
        ? 0
        : navigation.stepIndex;

    if (navigation.targetSlideIndex === currentSlideIndexRef.current) {
      pendingFlowRestoreRef.current = null;
      restoreLivePlaybackAtStep(targetSlide, stepIndex);
    } else {
      pendingFlowRestoreRef.current = {
        slideId: targetSlide.slideId,
        stepIndex,
      };
    }
    void requestPreparedSlideChange({
      source: "flow-navigator",
      stepIndex,
      targetSlideIndex: navigation.targetSlideIndex,
    });
  };
  const goNext = () => {
    if (!deck) return;
    cancelAutoAdvanceForManualCommand();
    void requestPreparedSlideChange({
      source: "manual",
      stepIndex: 0,
      targetSlideIndex: currentSlideIndexRef.current + 1,
    });
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
    void requestPreparedSlideChange({
      source: "manual",
      stepIndex: nextState.stepIndex,
      targetSlideIndex: nextState.slideIndex,
    });
  };
  const finishRehearsal = () => {
    const projectId = deck?.projectId ?? props.projectId ?? demoIds.projectId;
    void closeRehearsalCompanionSession().catch(() => undefined);

    if (phase === "recording") {
      setHasLocalCompletion(true);
      finishAfterReportRef.current = true;
      setIsCompletionModalOpen(true);
      stopRecording();
      return;
    }

    if (phase === "uploading" || phase === "processing") {
      setHasLocalCompletion(true);
      finishAfterReportRef.current = true;
      setIsCompletionModalOpen(true);
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

    void leaveRehearsal(getRehearsalFinishPath(projectId, run));
  };
  const finishCompletedRehearsal = () => {
    const projectId = deck?.projectId ?? props.projectId ?? demoIds.projectId;
    setIsCompletionModalOpen(false);
    void leaveRehearsal(
      run?.runId
        ? getRehearsalReportPath(projectId, run.runId)
        : getRehearsalFinishPath(projectId, run)
    );
  };

  function ensureRehearsalCompanionSession() {
    const sessionKey = deck ? `${deck.deckId}:${deck.version}` : null;
    if (
      companionSessionRef.current &&
      deck &&
      companionSessionRef.current.deckId === deck.deckId &&
      companionSessionRef.current.deckVersion === deck.version
    ) {
      return Promise.resolve(companionSessionRef.current);
    }
    if (
      companionSessionPromiseRef.current &&
      companionSessionPromiseKeyRef.current === sessionKey
    ) {
      return companionSessionPromiseRef.current;
    }
    if (!deck) {
      return Promise.reject(new Error("리허설 자료가 준비되지 않았습니다."));
    }
    companionSessionRef.current = null;
    companionSessionPromiseKeyRef.current = sessionKey;
    const promise = ensurePresenterCompanionSession({
      deckId: deck.deckId,
      projectId: deck.projectId,
      sessionPurpose: "rehearsal",
    })
      .then((session) => {
        if (companionSessionPromiseKeyRef.current === sessionKey) {
          companionSessionRef.current = session;
          setCompanionSession(session);
        }
        return session;
      })
      .finally(() => {
        if (companionSessionPromiseKeyRef.current === sessionKey) {
          companionSessionPromiseRef.current = null;
          companionSessionPromiseKeyRef.current = null;
        }
      });
    companionSessionPromiseRef.current = promise;
    return promise;
  }

  function closeRehearsalCompanionSession() {
    if (closeCompanionSessionPromiseRef.current) {
      return closeCompanionSessionPromiseRef.current;
    }
    const session = companionSessionRef.current;
    if (!session || !deck) {
      return Promise.resolve();
    }
    const promise = closePresenterCompanionSession({
      projectId: deck.projectId,
      sessionId: session.sessionId,
    })
      .then(() => {
        if (companionSessionRef.current?.sessionId === session.sessionId) {
          companionSessionRef.current = null;
          setCompanionSession(null);
        }
      })
      .finally(() => {
        closeCompanionSessionPromiseRef.current = null;
      });
    closeCompanionSessionPromiseRef.current = promise;
    return promise;
  }

  async function leaveRehearsal(path: string) {
    await closeRehearsalCompanionSession().catch(() => undefined);
    navigateToPath(path);
  }
  const resetSlideDisplayToBeginning = () => {
    presenterStepIndexRef.current = 0;
    currentSlideIndexRef.current = 0;
    setPresenterStepIndex(0);
    setCurrentSlideIndex(0);
  };
  const resetRehearsalAttemptToBeginning = () => {
    const firstSlide = deck?.slides[0] ?? null;

    resetSlideDisplayToBeginning();
    resetLiveSessionTranscript();
    resetLivePlaybackForSlide(firstSlide);
    resetAutoAdvanceRuntimeState(firstSlide?.slideId ?? null);
    if (deck) {
      resetSlideTranscriptSnapshots(deck, 0);
    }
    setScriptAutoFollowKey((current) => current + 1);
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

    const presenterScreen = displayManager.getCurrentScreen();
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
        screen: presenterScreen,
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
    audienceScreenShare.returnToSlide();
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
  const highlightedKeywordOccurrences = useMemo(() => {
    return getHighlightedKeywordOccurrencesForSlide(currentSlide);
  }, [currentSlide]);
  const hasDeletedRawAudio = Boolean(run?.rawAudioDeletedAt);
  const nextSlide = deck?.slides[currentSlideIndex + 1] ?? null;
  const prompterRows = getRehearsalPrompterRows(
    p3Sentences,
    p3PanelSnapshot.coveredSentenceIds,
    currentSlide?.speakerNotes ?? "",
    p3PanelSnapshot.prompterProgress,
  );
  const rehearsalTimingProgressItems: PresenterTimingProgressItem[] = [
    {
      currentLabel: `현재 ${formatClock(p3TimingSnapshot.elapsedSeconds)}`,
      label: "총 발표 시간",
      percent: totalTimingProgress.percent,
      targetLabel: `예상 ${formatClock(p3TimingSnapshot.deckTargetSeconds)}`,
      tone: totalTimingProgress.tone,
    },
    {
      currentLabel: `현재 ${formatClock(p3TimingSnapshot.currentSlideElapsedSeconds)}`,
      label: "현재 슬라이드",
      percent: slideTimingProgress.percent,
      targetLabel: `예상 ${formatClock(p3TimingSnapshot.currentSlideTargetSeconds)}`,
      tone: slideTimingProgress.tone,
    },
  ];
  const rehearsalSummary = buildRehearsalCompletionSummary({
    deck,
    elapsedSeconds,
    meta: p3RunMeta,
    previousSummary: previousPracticeSummary,
    snapshot: p3PanelSnapshot,
    targetSeconds: timerDurationSeconds,
  });
  const isRehearsalRuntimeActive =
    phase === "recording" ||
    isLiveSttActive ||
    isTimerRunning ||
    rehearsalRuntimeStatus === "paused";
  const sanitizedLiveError = sanitizeLiveSttErrorMessage(liveError);
  const canRetryRecordingLiveStt = canRetryInitialRecordingLiveStt({
    hasActiveSession: p3SessionRef.current !== null,
    hasReusableStream: isReusableRehearsalMediaStream(streamRef.current),
    isRecording: phase === "recording",
    isRetrying:
      isLiveSttRetrying || liveSttRetryCoordinatorRef.current.isRetrying(),
    liveStatus,
  });
  const comparisonModel = runComparison
    ? buildRehearsalRunComparisonViewModel(
        runComparison,
        deck,
        deck?.projectId ?? props.projectId ?? demoIds.projectId,
      )
    : null;
  const nextSlideHint = nextSlide?.keywords?.[0]
    ? `"${nextSlide.keywords[0].text}"를 말하면 바로 이어집니다`
    : "마지막 문장을 정리하고 마무리하세요";
  const shouldShowRehearsalPreflight =
    Boolean(deck) &&
    !shouldAutoStartRef.current &&
    phase === "idle" &&
    liveStatus === "idle" &&
    !isLiveDemoActive &&
    !isTimerRunning &&
    rehearsalRuntimeStatus !== "paused" &&
    !p3RunMeta &&
    !hasLocalCompletion;
  useEffect(() => {
    if (!isRehearsalCompletionVisible) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isRehearsalCompletionVisible]);
  useEffect(() => {
    if (!isRehearsalRuntimeActive || !currentSlide) {
      setComparisonReminderState((state) =>
        state.active ? { ...state, active: null } : state,
      );
      return;
    }

    setComparisonReminderState((state) =>
      enterComparisonSlide(state, runComparison, currentSlide.slideId),
    );
  }, [currentSlide?.slideId, isRehearsalRuntimeActive, runComparison]);

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
    setError("");
    setPracticeWithoutVoiceAt(null);
    setSemanticCapabilityEvents([]);
    setComparisonReminderState(createComparisonReminderState());
    setComparisonRefreshVersion((version) => version + 1);
    resetRehearsalTimerState({
      setElapsedSeconds,
      setSlideElapsedSeconds,
      setIsTimerRunning,
    });
    if (phase !== "uploading" && phase !== "processing") {
      setPhase("idle");
    }
  };
  const startPracticeWithoutVoice = () => {
    const disabledAt = Date.now();
    setError("");
    setPhase("idle");
    setElapsedSeconds(0);
    setSlideElapsedSeconds(0);
    setHasLocalCompletion(false);
    setIsTimerRunning(true);
    setPracticeWithoutVoiceAt(disabledAt);
    setSemanticCapabilityNowMs(disabledAt);
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
    const shouldPracticeWithoutVoice = practiceWithoutVoiceAt !== null;

    persistCurrentPracticeSummary();
    returnToPreflight();
    resetRehearsalAttemptToBeginning();

    if (shouldPracticeWithoutVoice) {
      startPracticeWithoutVoice();
      return;
    }

    shouldAutoStartRef.current = "starting";
    void startRecording({ allowDuringReport: true }).finally(() => {
      shouldAutoStartRef.current = null;
    });
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
      finalSentenceCommitted: p3PanelSnapshot.finalSentenceCommitted === true,
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
    p3PanelSnapshot.finalSentenceCommitted,
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
        ? audienceScreenShareIdentity
        : null,
    [audienceScreenShareIdentity, deck],
  );
  const slideReceiverSnapshot = useMemo(
    () =>
      deck && presentationChannelState
        ? {
            deck: createSlideWindowDeckSnapshot(deck),
            state: createAudiencePresenterState(presentationChannelState),
            triggerAnimationIds,
          }
        : null,
    [deck, presentationChannelState, triggerAnimationIds],
  );

  if (phase === "failed" && error) {
    return (
      <RehearsalFailureScreen
        error={error}
        onPracticeWithoutVoice={deck ? startPracticeWithoutVoice : undefined}
        onRetry={deck ? returnToPreflight : () => window.location.reload()}
        projectId={deck?.projectId ?? props.projectId}
      />
    );
  }

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
        onNextStep={handleNextPresenterStep}
        slideElapsedLabel={formatClock(slideElapsedSeconds)}
        slideId={currentSlide.slideId}
        slideTargetLabel={formatClock(currentSlideTargetSeconds)}
        stepIndex={presenterStepIndex}
        totalTimeLabel={formatClock(displayedTimeSeconds)}
        triggerAnimationIds={triggerAnimationIds}
      />
    );
  }

  if (shouldShowRehearsalPreflight && deck) {
    return (
      <RehearsalPreflightScreen
        canStart={canRecord}
        companionSetup={
          presenterCompanionEnabled && companionSession ? (
            <PresenterCompanionSetup
              projectId={deck.projectId}
              sessionId={companionSession.sessionId}
              sessionPurpose={companionSession.sessionPurpose}
              variant="preflight"
            />
          ) : undefined
        }
        comparisonModel={comparisonModel}
        createLiveSttPort={(engineId) =>
          createDefaultLiveSttPort({
            engineId,
            legacyAdapter: props.liveSttAdapter,
            projectId: deck.projectId,
          })
        }
        deck={deck}
        previousSummary={previousPracticeSummary}
        resolveLiveSttEngine={resolveEffectiveLiveSttEngine}
        onPracticeWithoutVoice={startPracticeWithoutVoice}
        onStart={() => void startRecording()}
      />
    );
  }

  const showSemanticCueDebugPanel = shouldShowSemanticCueDebugPanel({
    flagEnabled: getSemanticCueRuntimeFlags(import.meta.env).debugPanelEnabled,
    locationSearch:
      typeof window === "undefined" ? "" : window.location.search,
  });

  function copySemanticCueDebugJson(json: string) {
    void navigator.clipboard?.writeText(json);
  }

  function exportSemanticCueDebugJson(json: string) {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "semantic-cue-debug-events.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="rehearsal-presenter-shell">
      {isRehearsalCompletionVisible && deck ? (
        <RehearsalCompletionScreen
          hasReportTarget={Boolean(run?.runId)}
          isReportPending={phase === "uploading" || phase === "processing"}
          onClose={() => void leaveRehearsal("/")}
          onGoHome={() => void leaveRehearsal("/")}
          onOpenProject={() =>
            void leaveRehearsal(
              `/project/${encodeURIComponent(deck.projectId)}`
            )
          }
          onPrimaryAction={handleCompletionPrimaryAction}
          onPracticeAgain={handleCompletionPracticeAgain}
        />
      ) : null}
      {isLiveStopModalOpen && !isRehearsalCompletionVisible ? (
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
      {shouldShowCompletionModal && !isRehearsalCompletionVisible ? (
        <div className="rehearsal-completion-modal-backdrop" role="presentation">
          <section
            aria-labelledby="rehearsal-completion-modal-title"
            aria-modal="true"
            className="rehearsal-completion-modal"
            role="dialog"
          >
            {phase === "succeeded" ? (
              <>
                <span className="rehearsal-completion-modal-icon" aria-hidden="true">
                  <CheckCircle2 size={28} />
                </span>
                <h2 id="rehearsal-completion-modal-title">
                  리포트 생성이 완료되었습니다
                </h2>
                <JobProgressDisplay
                  progress={completionProgress}
                  message={completionMessage}
                />
                <button
                  className="primary-action"
                  type="button"
                  onClick={finishCompletedRehearsal}
                >
                  리허설 마치기
                </button>
              </>
            ) : (
              <>
                <h2 id="rehearsal-completion-modal-title">
                  리포트를 생성하고 있습니다
                </h2>
                <p>
                  음성 업로드와 AI 분석이 끝나면 리허설을 마칠 수 있습니다.
                </p>
                <JobProgressDisplay
                  progress={completionProgress}
                  message={completionMessage}
                />
              </>
            )}
          </section>
        </div>
      ) : null}
      <PresenterTopbar
        exitButtonClassName={`rehearsal-exit-button ${
          advanceControllerState.status === "finish-suggested"
            ? "auto-advance-finish-highlight"
            : ""
        }`}
        exitButtonContent={
          <>
            <Presentation size={16} />
            {"\ub9ac\ud5c8\uc124 \ub9c8\uce58\uae30"}
          </>
        }
        onDurationInputBlur={commitTimerDurationInput}
        onDurationInputChange={(value) => {
          setEditingTimeField("duration");
          setTimerDurationInput(value);
        }}
        onDurationInputFocus={() => setEditingTimeField("duration")}
        onElapsedInputBlur={commitElapsedTimeInput}
        onElapsedInputChange={(value) => {
          setEditingTimeField("elapsed");
          setElapsedTimeInput(value);
        }}
        onElapsedInputFocus={() => setEditingTimeField("elapsed")}
        onExit={finishRehearsal}
        onPrimaryAction={() => void handleTimePrimaryAction()}
        onReset={() => {
          resetRehearsalTimerState({
            setElapsedSeconds,
            setSlideElapsedSeconds,
            setIsTimerRunning,
          });
        }}
        onTimeModeChange={(value) => {
          setTimeMode(value as RehearsalTimeMode);
          resetRehearsalTimerState({
            setElapsedSeconds,
            setSlideElapsedSeconds,
            setIsTimerRunning,
          });
        }}
        primaryActionAriaLabel={
          rehearsalRuntimeStatus === "paused"
            ? "리허설 다시 시작"
            : isTimerRunning
              ? "리허설 일시정지"
              : "리허설 시작"
        }
        primaryActionDisabled={
          rehearsalRuntimeStatus !== "paused" && !isTimerRunning && !canRecord
        }
        primaryActionRunning={
          rehearsalRuntimeStatus !== "paused" && isTimerRunning
        }
        timeMode={timeMode}
        timerDurationInput={timerDurationInput}
        title="리허설"
        toolbar={
          deck ? (
            <div className="rehearsal-display-toolbar">
              <DisplayControls
                channelStatus={presentationChannel.status}
                onOpenSlideDisplay={openSlideDisplay}
                onRequestDisplayScreens={requestDisplayScreens}
                onRequestSlideWindowFullscreen={requestSlideWindowFullscreen}
              />
              {presenterCompanionEnabled && companionSession ? (
                <PresenterCompanionStatus
                  projectId={deck.projectId}
                  sessionId={companionSession.sessionId}
                  sessionPurpose={companionSession.sessionPurpose}
                />
              ) : null}
            </div>
          ) : null
        }
        totalElapsedInput={elapsedTimeInput}
      />
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
        {hasDeletedRawAudio ? <span>raw audio 삭제 완료</span> : null}
      </div>

      <PracticeGoalReminder
        projectId={props.projectId ?? demoIds.projectId}
        sourceFullRunId={props.sourceFullRunId}
        slideId={currentSlide?.slideId}
      />

      <section className="rehearsal-presenter-layout">
        <PresenterStageSection
          currentIndex={currentSlideIndex}
          emptyStageLabel={"\ubc1c\ud45c\uc790\ub8cc \ub85c\ub529 \uc911"}
          leftPanel={
            <AnimationFlowNavigator
              currentSlideIndex={currentSlideIndex}
              currentStepIndex={presenterStepIndex}
              deck={deck}
              navigationPending={isSlidePreparationPending}
              onNavigate={handleAnimationFlowNavigation}
              placement="drawer"
            />
          }
          navigationPending={isSlidePreparationPending}
          nextHint={nextSlideHint}
          nextSlideTitle={nextSlide ? getSlideTitle(nextSlide) : "다음 슬라이드 없음"}
          onNext={handleNextPresenterStep}
          onPrevious={goPrevious}
          onStageAdvance={handleNextPresenterStep}
          previousDisabled={currentSlideIndex === 0}
          renderStage={
            deck && currentSlide && presenterScale !== null ? (
              <SlideshowRenderer
                deck={deck}
                scale={presenterScale}
                slideId={currentSlide.slideId}
                stepIndex={presenterStepIndex}
                triggerAnimationIds={triggerAnimationIds}
              />
            ) : null
          }
          stageIndexLabel={
            deck
              ? `${String(currentSlideIndex + 1).padStart(2, "0")} / ${String(
                  deck.slides.length,
                ).padStart(2, "0")}`
              : undefined
          }
          stageAdvanceDisabled={
            currentSlide?.kind === "activity" ||
            currentSlide?.kind === "activity-results"
          }
          stageRef={presenterStageRef}
          totalSlides={deck?.slides.length ?? 0}
        />

        <aside className="rehearsal-presenter-side">
          <PresenterTimerCard
            ariaLabel="리허설 타이머"
            currentTimeLabel="경과 발표 시간"
            meterPercent={liveAudioLevelPercent}
            onPrimaryAction={handleSideTimerPrimaryAction}
            onReset={() => {
              resetRehearsalTimerState({
                setElapsedSeconds,
                setSlideElapsedSeconds,
                setIsTimerRunning,
              });
            }}
            onTimeInputBlur={(value) => {
              setTimeMode("timer");
              commitTimerDurationInput(value);
            }}
            onTimeInputChange={(value) => {
              setEditingTimeField("duration");
              setTimerDurationInput(value);
            }}
            onTimeInputFocus={() => {
              setEditingTimeField("duration");
              setTimerDurationInput(formatClock(timerDurationSeconds));
            }}
            primaryActionAriaLabel={
              rehearsalRuntimeStatus === "paused"
                ? "리허설 다시 시작"
                : phase === "recording"
                  ? "리허설 일시정지"
                  : canStopLiveDemo
                    ? "Live STT 일시정지"
                    : isTimerRunning
                      ? "타이머 일시정지"
                      : "리포트 녹음 시작"
            }
            primaryActionDisabled={!deck && !isTimerRunning}
            primaryActionRunning={
              rehearsalRuntimeStatus !== "paused" &&
              (canStopLiveDemo || isTimerRunning)
            }
            progressItems={rehearsalTimingProgressItems}
            progressPercent={rehearsalProgressPercent}
            resetAriaLabel="스톱워치 초기화"
            timeInputValue={formatClock(displayedTimeSeconds)}
            timeMetaLeft={`현재 ${formatClock(p3TimingSnapshot.currentSlideElapsedSeconds)}`}
            timeMetaRight={`예상 ${formatClock(p3TimingSnapshot.currentSlideTargetSeconds)}`}
            timeReadOnly
            title="발표 스톱워치"
          />

          {currentSlide?.kind === "activity" && deck ? (
            <ActivityPresenterPanel
              autoStart
              deckId={deck.deckId}
              deckVersion={deck.version}
              projectId={deck.projectId}
              slide={currentSlide}
            />
          ) : (
            <RehearsalPanel
              mode="rehearsal"
              timing={p3TimingSnapshot}
              wordsPerMinute={p3WordsPerMinute}
              adviceState={p3AdviceState}
              highlightedKeywordOccurrences={highlightedKeywordOccurrences}
              keywords={checklistKeywords}
              scriptAutoFollowKey={scriptAutoFollowKey}
              sentences={p3Sentences}
              showAdvicePanel={false}
              showScriptPanel={true}
              speakerNotes={currentSlide?.speakerNotes ?? ""}
              snapshot={p3PanelSnapshot}
              semanticCapabilityItems={semanticCapabilityItems}
              semanticCueItems={
                ENABLE_REHEARSAL_NLI &&
                p3SessionState?.slideIndex === currentSlideIndex
                  ? p3SessionState.semanticCueProgress
                  : []
              }
              onSemanticCapabilityAction={handleSemanticCapabilityAction}
              comparisonReminder={comparisonReminderState.active}
              onDismissComparisonReminder={() =>
                setComparisonReminderState(dismissComparisonReminder)
              }
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

                  {sanitizedLiveError && (
                    <div
                      className="project-status-message project-status-danger"
                      role="status"
                    >
                      <AlertCircle size={18} />
                      <span>{sanitizedLiveError}</span>
                      {canRetryRecordingLiveStt ? (
                        <button
                          className="secondary-action"
                          disabled={isLiveSttRetrying}
                          type="button"
                          onClick={() => void retryInitialRecordingLiveStt()}
                        >
                          {isLiveSttRetrying
                            ? "다시 연결 중"
                            : "음성 인식 다시 연결"}
                        </button>
                      ) : null}
                    </div>
                  )}
                </section>
              }
            />
          )}
        </aside>

        <RehearsalTeleprompter
          countdownMs={presenterSettings.advancePolicy.countdownMs}
          focusScopeId={currentSlide?.slideId ?? "fallback"}
          nowMs={autoAdvanceNowMs}
          onCancel={cancelAutoAdvanceForManualCommand}
          rows={prompterRows}
          scriptProgressPercent={Math.round(
            (p3PanelSnapshot.scriptProgress?.ratio ?? 0) * 100,
          )}
          state={advanceControllerState}
        />
      </section>
      {showSemanticDebugPanel ? (
        <SemanticSpeechDebugPanel
          liveTranscript={liveSessionTranscript}
          semanticMatchingEnabled={
            presenterSettings.advancePolicy.semanticMatching
          }
          state={semanticDebugState}
        />
      ) : null}
      {showSemanticCueDebugPanel ? (
        <SemanticCueDebugPanel
          capabilityEvents={semanticCapabilityEvents}
          events={semanticCueDebugEvents}
          onCopyJson={copySemanticCueDebugJson}
          onExportJson={exportSemanticCueDebugJson}
        />
      ) : null}
    </main>
  );
}

export function RehearsalFailureScreen(props: {
  error: string;
  onPracticeWithoutVoice?: () => void;
  onRetry: () => void;
  projectId?: string;
}) {
  return (
    <main className="rehearsal-preflight-screen" aria-label="리허설 오류">
      <section className="rehearsal-preflight-card" role="alert">
        <div className="rehearsal-preflight-copy">
          <span className="redesign-eyebrow">REHEARSAL ERROR</span>
          <h1>리허설을 시작하지 못했습니다.</h1>
          <p>{props.error}</p>
        </div>
        <div className="rehearsal-preflight-actions">
          <button className="rehearsal-preflight-start" onClick={props.onRetry} type="button">
            다시 시도
          </button>
          {props.onPracticeWithoutVoice ? (
            <button className="rehearsal-preflight-quiet" onClick={props.onPracticeWithoutVoice} type="button">
              마이크 없이 연습
            </button>
          ) : null}
          <a href={props.projectId ? `/project/${encodeURIComponent(props.projectId)}` : "/project"}>
            프로젝트로 돌아가기
          </a>
        </div>
      </section>
    </main>
  );
}

function RehearsalPreflightScreen(props: {
  canStart: boolean;
  companionSetup?: ReactNode;
  comparisonModel: RehearsalRunComparisonViewModel | null;
  createLiveSttPort: (engineId: LiveSttEngineId) => LiveSttPort;
  deck: Deck;
  onPracticeWithoutVoice: () => void;
  onStart: () => void;
  previousSummary: RehearsalPracticeSummary | null;
  resolveLiveSttEngine: () => Promise<LiveSttEngineId>;
}) {
  const commandPhrases = defaultRehearsalCommandConfig
    .map((command) => command.phrases[0])
    .filter(Boolean)
    .slice(0, 3);
  const slideKeywordPhrases = props.deck.slides
    .flatMap((slide) => slide.keywords ?? [])
    .map((keyword) => keyword.text)
    .filter(Boolean);
  const samplePhrases = Array.from(
    new Set([...commandPhrases, ...slideKeywordPhrases]),
  ).slice(0, 4);
  const triggerCount = defaultRehearsalCommandConfig.reduce(
    (count, command) => count + command.phrases.length,
    0,
  );
  const preflightBanner = buildRehearsalPreflightBanner(
    props.deck,
    props.previousSummary,
  );
  const [microphonePermission, setMicrophonePermission] =
    useState<PreflightMicrophonePermission>("checking");
  const [voiceCheckStatus, setVoiceCheckStatus] =
    useState<PreflightVoiceCheckStatus>("idle");
  const [voiceCheckError, setVoiceCheckError] = useState("");
  const [voiceCheckTranscript, setVoiceCheckTranscript] = useState("");
  const [voiceCheckLatencyMs, setVoiceCheckLatencyMs] = useState<number | null>(
    null,
  );
  const [matchedPhrases, setMatchedPhrases] = useState<readonly string[]>([]);
  const preflightStreamRef = useRef<MediaStream | null>(null);
  const preflightLiveSttPortRef = useRef<LiveSttPort | null>(null);
  const preflightLiveSttCleanupRef = useRef<(() => void) | null>(null);
  const preflightTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let isCancelled = false;
    let permissionStatus: PermissionStatus | null = null;

    async function syncMicrophonePermission() {
      if (typeof navigator === "undefined") {
        setMicrophonePermission("unsupported");
        return;
      }

      if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
        setMicrophonePermission("unsupported");
        return;
      }

      if (typeof navigator.permissions?.query !== "function") {
        setMicrophonePermission("prompt");
        return;
      }

      try {
        permissionStatus = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });
        if (isCancelled) {
          return;
        }
        setMicrophonePermission(getPreflightMicrophonePermissionHint(permissionStatus.state));
        permissionStatus.onchange = () => {
          setMicrophonePermission(
            getPreflightMicrophonePermissionHint(permissionStatus?.state ?? "prompt"),
          );
        };
      } catch {
        if (!isCancelled) {
          setMicrophonePermission("prompt");
        }
      }
    }

    void syncMicrophonePermission();

    return () => {
      isCancelled = true;
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      stopPreflightVoiceResources();
    };
  }, []);

  const permissionStatus = getPreflightMicrophoneStatus(microphonePermission);
  const voiceStatus = getPreflightVoiceStatus(
    voiceCheckStatus,
    voiceCheckLatencyMs,
  );
  const triggerStatus = getPreflightTriggerStatus(
    matchedPhrases.length,
    samplePhrases.length,
    triggerCount,
  );
  const isMicrophoneGranted = microphonePermission === "granted";
  const canStartWithMicrophone = props.canStart && isMicrophoneGranted;
  const startDisabledReason = !props.canStart
    ? "발표자료 로딩이 끝난 뒤 시작할 수 있습니다."
    : !isMicrophoneGranted
      ? "마이크 연결을 확인해야 리허설을 시작할 수 있습니다."
      : "";

  async function requestPreflightMicrophonePermission() {
    stopPreflightVoiceResources();
    setVoiceCheckStatus("idle");
    setVoiceCheckError("");
    setVoiceCheckTranscript("");
    setVoiceCheckLatencyMs(null);
    setMatchedPhrases([]);

    if (typeof navigator === "undefined") {
      setMicrophonePermission("unsupported");
      return;
    }

    if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setMicrophonePermission("unsupported");
      return;
    }

    try {
      const stream = await requestRehearsalMicrophoneStream(navigator.mediaDevices);
      stopMediaStream(stream);
      setMicrophonePermission("granted");
    } catch (cause) {
      setMicrophonePermission(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "denied"
          : "prompt",
      );
      setVoiceCheckError(toMicrophoneErrorMessage(cause));
    }
  }

  async function startPreflightVoiceCheck() {
    if (!isMicrophoneGranted) {
      await requestPreflightMicrophonePermission();
      return;
    }

    stopPreflightVoiceResources();
    setVoiceCheckStatus("listening");
    setVoiceCheckError("");
    setVoiceCheckTranscript("");
    setVoiceCheckLatencyMs(null);
    setMatchedPhrases([]);

    if (typeof navigator === "undefined") {
      setVoiceCheckStatus("unsupported");
      setVoiceCheckError("브라우저 환경에서만 음성 체크를 실행할 수 있습니다.");
      return;
    }

    if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setMicrophonePermission("unsupported");
      setVoiceCheckStatus("unsupported");
      setVoiceCheckError("이 브라우저는 마이크 체크를 지원하지 않습니다.");
      return;
    }

    const normalizedSamples = samplePhrases.map((phrase) => ({
      phrase,
      normalized: normalizeLiveTranscriptText(phrase),
    }));
    const startTime = Date.now();
    const matched = new Set<string>();
    let finished = false;

    const finish = (status: PreflightVoiceCheckStatus, message = "") => {
      if (finished) {
        return;
      }
      finished = true;
      stopPreflightVoiceResources();
      setVoiceCheckStatus(status);
      setVoiceCheckError(message);
    };

    try {
      const stream = await requestRehearsalMicrophoneStream(navigator.mediaDevices);
      if (finished) {
        stopMediaStream(stream);
        return;
      }

      preflightStreamRef.current = stream;
      setMicrophonePermission("granted");

      const engineId = await props.resolveLiveSttEngine();
      const port = props.createLiveSttPort(engineId);
      preflightLiveSttPortRef.current = port;
      const unsubscribeResult = port.onResult((result) => {
        const transcript = result.text.trim();
        if (!transcript) {
          return;
        }

        setVoiceCheckTranscript(transcript);
        setVoiceCheckLatencyMs((current) => current ?? Date.now() - startTime);
        const normalizedTranscript = normalizeLiveTranscriptText(transcript);
        for (const sample of normalizedSamples) {
          if (
            sample.normalized &&
            normalizedTranscript.includes(sample.normalized)
          ) {
            matched.add(sample.phrase);
          }
        }
        setMatchedPhrases(Array.from(matched));
        if (matched.size > 0) {
          finish("passed");
        }
      });
      const unsubscribeError = port.onError((error) => {
        finish("error", error.message || "음성 인식 체크를 완료하지 못했습니다.");
      });
      preflightLiveSttCleanupRef.current = () => {
        unsubscribeResult();
        unsubscribeError();
      };

      preflightTimeoutRef.current = window.setTimeout(() => {
        finish(
          matched.size > 0 ? "passed" : "failed",
          matched.size > 0 ? "" : "8초 안에 예시 문구가 감지되지 않았습니다.",
        );
      }, 8000);

      await port.start({
        audioSource: stream,
        biasPhrases: samplePhrases.map((phrase) => ({
          source: "control-phrase",
          text: phrase,
          weight: 1,
        })),
        language: "ko",
      });
    } catch (cause) {
      if (preflightStreamRef.current) {
        setMicrophonePermission("granted");
      } else {
        setMicrophonePermission(
          cause instanceof DOMException && cause.name === "NotAllowedError"
            ? "denied"
            : "prompt",
        );
      }
      finish("error", toMicrophoneErrorMessage(cause));
    }
  }

  function stopPreflightVoiceResources() {
    if (preflightTimeoutRef.current !== null) {
      window.clearTimeout(preflightTimeoutRef.current);
      preflightTimeoutRef.current = null;
    }
    preflightLiveSttCleanupRef.current?.();
    preflightLiveSttCleanupRef.current = null;
    void preflightLiveSttPortRef.current?.stop();
    void preflightLiveSttPortRef.current?.dispose();
    preflightLiveSttPortRef.current = null;
    stopMediaStream(preflightStreamRef.current);
    preflightStreamRef.current = null;
  }

  return (
    <main className="rehearsal-preflight-screen" aria-label="리허설 시작 전">
      <div className="rehearsal-preflight-banner">
        <Zap size={17} />
        <span>{preflightBanner}</span>
      </div>

      {props.comparisonModel ? (
        <RehearsalRunComparisonOverview
          compact
          model={props.comparisonModel}
        />
      ) : null}

      <section className="rehearsal-preflight-card">
        <div className="rehearsal-preflight-mic" aria-hidden="true">
          <span>
            <Mic size={42} />
          </span>
        </div>
        <div className="rehearsal-preflight-copy">
          <h1>리허설을 시작할까요?</h1>
          <p>마이크 권한, 음성 인식, 지연시간을 먼저 짧게 확인할 수 있습니다.</p>
        </div>

        <div className="rehearsal-preflight-chain" aria-label="리허설 준비 상태">
          <PreflightStatusRow
            action={
              !isMicrophoneGranted ? (
                <button
                  className="rehearsal-preflight-inline-action"
                  type="button"
                  onClick={() => void requestPreflightMicrophonePermission()}
                >
                  <Mic size={14} />
                  마이크 연결 확인
                </button>
              ) : null
            }
            label="마이크 권한 확인"
            status={permissionStatus}
            value={permissionStatus.value}
          />
          {isMicrophoneGranted ? (
            <PreflightStatusRow
              details={
                <section
                  className="rehearsal-preflight-voice-check"
                  aria-label="음성 체크"
                >
                  <div>
                    <strong>아래 문구 중 하나를 말해보세요</strong>
                    <button
                      className="rehearsal-preflight-check"
                      disabled={voiceCheckStatus === "listening"}
                      type="button"
                      onClick={() => void startPreflightVoiceCheck()}
                    >
                      <Mic size={16} />
                      {voiceCheckStatus === "listening" ? "듣는 중" : "음성 체크"}
                    </button>
                  </div>
                  <div
                    className="rehearsal-preflight-commands"
                    aria-label="음성 명령 예시"
                  >
                    {samplePhrases.map((phrase) => {
                      const matched = matchedPhrases.includes(phrase);
                      return (
                        <span
                          className={
                            matched ? "rehearsal-preflight-command-hit" : ""
                          }
                          key={phrase}
                        >
                          {matched ? <CheckCircle2 size={13} /> : null}
                          "{phrase}"
                        </span>
                      );
                    })}
                  </div>
                  <p aria-live="polite">
                    {voiceCheckTranscript
                      ? `인식됨: ${voiceCheckTranscript}`
                      : voiceCheckError ||
                        "조용한 곳에서 보통 말하는 속도로 테스트하세요."}
                  </p>
                </section>
              }
              label="음성 인식 준비"
              status={voiceStatus}
              value={voiceStatus.value}
            />
          ) : null}
          <PreflightStatusRow
            label={`슬라이드 ${props.deck.slides.length}장 로드됨`}
            status={triggerStatus}
            value={triggerStatus.value}
          />
        </div>

        {props.companionSetup}

        <div className="rehearsal-preflight-actions">
          <span
            className="rehearsal-preflight-start-tooltip-wrap"
            aria-describedby={
              startDisabledReason ? "rehearsal-preflight-start-tooltip" : undefined
            }
            data-disabled={startDisabledReason ? "true" : "false"}
            tabIndex={startDisabledReason ? 0 : undefined}
          >
            <button
              className="rehearsal-preflight-start"
              disabled={!canStartWithMicrophone}
              type="button"
              onClick={props.onStart}
            >
              <PlayCircle size={18} />
              리허설 시작
            </button>
            {startDisabledReason ? (
              <span
                className="rehearsal-preflight-start-tooltip"
                id="rehearsal-preflight-start-tooltip"
                role="tooltip"
              >
                {startDisabledReason}
              </span>
            ) : null}
          </span>
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

type PreflightMicrophonePermission =
  | "checking"
  | "granted"
  | "prompt"
  | "denied"
  | "unsupported";

type PreflightVoiceCheckStatus =
  | "idle"
  | "listening"
  | "passed"
  | "failed"
  | "unsupported"
  | "error";

type PreflightStatusTone = "success" | "warning" | "danger" | "info";

type PreflightStatus = {
  icon: "check" | "warning" | "danger" | "info";
  tone: PreflightStatusTone;
  value: string;
};

function PreflightStatusRow(props: {
  action?: ReactNode;
  details?: ReactNode;
  label: string;
  status: PreflightStatus;
  value: string;
}) {
  const Icon =
    props.status.icon === "warning"
      ? AlertTriangle
      : props.status.icon === "danger"
        ? AlertCircle
        : props.status.icon === "info"
          ? Gauge
          : CheckCircle2;

  return (
    <div className={`rehearsal-preflight-status-${props.status.tone}`}>
      <span>
        <Icon size={14} />
      </span>
      <strong>{props.label}</strong>
      <div className="rehearsal-preflight-status-meta">
        <small>{props.value}</small>
        {props.action}
      </div>
      {props.details ? (
        <div className="rehearsal-preflight-status-details">
          {props.details}
        </div>
      ) : null}
    </div>
  );
}

export function getPreflightMicrophonePermissionHint(
  state: PermissionState,
): PreflightMicrophonePermission {
  if (state === "granted") {
    return "granted";
  }
  if (state === "denied") {
    return "denied";
  }
  return "prompt";
}

function getPreflightMicrophoneStatus(
  permission: PreflightMicrophonePermission,
): PreflightStatus {
  switch (permission) {
    case "granted":
      return { icon: "check", tone: "success", value: "권한 허용됨" };
    case "denied":
      return { icon: "danger", tone: "danger", value: "브라우저에서 권한 차단됨" };
    case "unsupported":
      return { icon: "danger", tone: "danger", value: "마이크 API 미지원" };
    case "checking":
      return { icon: "info", tone: "info", value: "권한 상태 확인 중" };
    case "prompt":
      return { icon: "warning", tone: "warning", value: "마이크 연결 확인 필요" };
  }
}

function getPreflightVoiceStatus(
  status: PreflightVoiceCheckStatus,
  latencyMs: number | null,
): PreflightStatus {
  switch (status) {
    case "passed":
      return {
        icon: "check",
        tone: "success",
        value:
          latencyMs === null ? "예시 문구 인식됨" : `첫 인식 ${latencyMs}ms`,
      };
    case "listening":
      return { icon: "info", tone: "info", value: "예시 문구 듣는 중" };
    case "failed":
      return { icon: "warning", tone: "warning", value: "문구 재시도 필요" };
    case "unsupported":
      return { icon: "danger", tone: "danger", value: "브라우저 인식 미지원" };
    case "error":
      return { icon: "danger", tone: "danger", value: "체크 실패" };
    case "idle":
      return { icon: "warning", tone: "warning", value: "한국어 · 테스트 대기" };
  }
}

function getPreflightTriggerStatus(
  matchedCount: number,
  sampleCount: number,
  triggerCount: number,
): PreflightStatus {
  if (matchedCount > 0) {
    return {
      icon: "check",
      tone: "success",
      value: `${matchedCount}/${sampleCount}개 예시 인식 · 트리거 ${triggerCount}개`,
    };
  }

  return {
    icon: "info",
    tone: "info",
    value: `음성 트리거 ${triggerCount}개`,
  };
}

function getSemanticDebugPanelStorage(): Pick<
  Storage,
  "getItem" | "setItem"
> | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function writeSemanticDebugPanelPreference(enabled: boolean) {
  try {
    getSemanticDebugPanelStorage()?.setItem(
      semanticSpeechDebugPanelStorageKey,
      enabled ? "1" : "0",
    );
  } catch {
    // The shortcut still works for the current page when storage is blocked.
  }
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

export function RehearsalCompletionScreen(props: {
  hasReportTarget: boolean;
  isReportPending: boolean;
  onClose: () => void;
  onGoHome: () => void;
  onOpenProject: () => void;
  onPracticeAgain: () => void;
  onPrimaryAction: () => void;
}) {
  const isReportReady = props.hasReportTarget && !props.isReportPending;

  return (
    <div className="rehearsal-completion-backdrop" role="presentation">
      <section
        aria-labelledby="rehearsal-completion-title"
        aria-modal="true"
        className="rehearsal-completion-dialog"
        role="dialog"
      >
        <button
          aria-label="완료 창 닫기"
          className="rehearsal-completion-close"
          onClick={props.onClose}
          type="button"
        >
          <X aria-hidden="true" size={22} />
        </button>

        <span className="rehearsal-completion-check" aria-hidden="true">
          <Check size={46} strokeWidth={2.5} />
        </span>
        <h1 id="rehearsal-completion-title">리허설을 마쳤어요</h1>
        <p className="rehearsal-completion-description">
          수고했어요! 결과를 확인하고 더 멋진 발표를 만들어 보세요.
        </p>

        <div
          className={`rehearsal-completion-report ${
            isReportReady ? "rehearsal-completion-report-ready" : ""
          }`}
          role="status"
        >
          {props.isReportPending ? (
            <LoaderCircle aria-hidden="true" className="rehearsal-completion-loader" size={24} />
          ) : (
            <CheckCircle2 aria-hidden="true" size={24} />
          )}
          <div>
            <strong>
              {props.isReportPending
                ? "리포트를 준비하고 있어요"
                : isReportReady
                  ? "리포트가 준비됐어요"
                  : "리포트 없이 리허설을 마쳤어요"}
            </strong>
            <span>
              {props.isReportPending
                ? "잠시만 기다려 주세요."
                : isReportReady
                  ? "자세한 분석을 확인할 수 있어요."
                  : "바로 다시 연습하거나 다른 화면으로 이동할 수 있어요."}
            </span>
          </div>
        </div>

        <div className="rehearsal-completion-actions">
          <button
            className="rehearsal-completion-report-button"
            disabled={!isReportReady}
            onClick={props.onPrimaryAction}
            type="button"
          >
            리포트 보기
          </button>
          <button
            className="rehearsal-completion-practice-button"
            onClick={props.onPracticeAgain}
            type="button"
          >
            다시 연습하기
          </button>
        </div>

        <nav className="rehearsal-completion-links" aria-label="리허설 종료 후 이동">
          <button type="button" onClick={props.onOpenProject}>
            프로젝트 편집기로
          </button>
          <span aria-hidden="true" />
          <button type="button" onClick={props.onGoHome}>
            홈으로
          </button>
        </nav>
      </section>
    </div>
  );
}

function RehearsalTeleprompter(props: {
  countdownMs: number;
  focusScopeId: string;
  nowMs: number;
  onCancel: () => void;
  rows: RehearsalPrompterRows;
  scriptProgressPercent: number;
  state: AdvanceControllerState;
}) {
  const countdownSeconds = getAutoAdvanceCountdownSeconds(
    props.state,
    props.countdownMs,
    props.nowMs,
  );

  return (
    <RehearsalScriptTeleprompter
      focusScopeId={props.focusScopeId}
      progressPercent={props.scriptProgressPercent}
      rows={props.rows.items.map((row) => ({
        id: row.sentenceId,
        isFocusTarget: row.isFocusTarget,
        status: row.status,
        text: row.text,
      }))}
    >
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
    </RehearsalScriptTeleprompter>
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
  const [audioPlaybackAvailable, setAudioPlaybackAvailable] = useState(true);
  const [transcriptDownloadAvailable, setTranscriptDownloadAvailable] =
    useState(false);
  const [report, setReport] = useState<RehearsalReport | null>(
    props.initialReport ?? null,
  );
  const [status, setStatus] = useState<RehearsalReportStatus>(
    props.initialReport ? "ready" : "loading",
  );
  const [error, setError] = useState("");
  const [reportJob, setReportJob] = useState<Job | null>(null);
  const [semanticRetryState, setSemanticRetryState] = useState<{
    message?: string;
    status: "idle" | "running" | "succeeded" | "failed";
  }>({ status: "idle" });
  const [allSucceededRuns, setAllSucceededRuns] = useState<RehearsalRun[]>(() =>
    props.initialRun?.status === "succeeded" ? [props.initialRun] : [],
  );
  const [prevReports, setPrevReports] = useState<RehearsalReport[]>([]);

  useEffect(() => {
    setDeck(props.initialDeck ?? null);
  }, [props.initialDeck, props.projectId]);

  useEffect(() => {
    setRun(props.initialRun ?? null);
    setAudioPlaybackAvailable(true);
    setReport(props.initialReport ?? null);
    setStatus(props.initialReport ? "ready" : "loading");
    setError("");
    setReportJob(null);
    setSemanticRetryState({ status: "idle" });
    setPrevReports([]);
  }, [props.initialRun, props.initialReport, props.runId]);

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
    setRun(null);
    setReport(null);
    setReportJob(null);

    void fetchRehearsalReport(props.runId)
      .then((response) => {
        if (!isMounted) return;

        const nextState = resolveRehearsalReportLoadState(
          response,
          props.projectId,
        );
        setRun(response.run);
        setAudioPlaybackAvailable(
          response.audioPlaybackAvailable ?? Boolean(response.run.audioFileId),
        );
        setTranscriptDownloadAvailable(
          response.transcriptDownloadAvailable ?? false,
        );
        setReport(nextState.status === "ready" ? response.report : null);
        setStatus(nextState.status);
        setError(nextState.error);

        if (nextState.status === "not-ready" && response.run.jobId) {
          void pollRehearsalJob(response.run.jobId, {
            onUpdate: (j) => { if (isMounted) setReportJob(j); },
          })
            .then((j) => {
              if (!isMounted) return;
              setReportJob(j);
              if (j.status === "succeeded") {
                void fetchRehearsalReport(props.runId).then((r) => {
                  if (!isMounted) return;
                  setRun(r.run);
                  setAudioPlaybackAvailable(
                    r.audioPlaybackAvailable ?? Boolean(r.run.audioFileId),
                  );
                  setTranscriptDownloadAvailable(
                    r.transcriptDownloadAvailable ?? false,
                  );
                  setReport(r.report);
                  setStatus(r.report ? "ready" : "failed");
                });
              } else {
                setStatus("failed");
                setError(j.error?.message || j.message || "리포트 생성 실패");
              }
            })
            .catch(() => {
              if (isMounted) setStatus("failed");
            });
        }
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

  useEffect(() => {
    let isMounted = true;
    setAllSucceededRuns(
      props.initialRun?.status === "succeeded" ? [props.initialRun] : [],
    );

    void fetchProjectRehearsalRuns(props.projectId).then((runs) => {
      if (!isMounted) return;
      const succeeded = sortRehearsalRunsByCreatedAt(
        runs.filter((r) => r.status === "succeeded"),
      );
      setAllSucceededRuns(succeeded);
    });
    return () => { isMounted = false; };
  }, [props.projectId]);

  useEffect(() => {
    if (allSucceededRuns.length === 0) return;
    const idx = allSucceededRuns.findIndex((r) => r.runId === props.runId);
    if (idx <= 0) {
      setPrevReports([]);
      return;
    }
    let isMounted = true;
    const toFetch = allSucceededRuns
      .slice(Math.max(0, idx - 3), idx)
      .reverse();
    void Promise.all(
      toFetch.map((r) =>
        fetchRehearsalReport(r.runId)
          .then((res) => res.report)
          .catch(() => null),
      ),
    ).then((results) => {
      if (!isMounted) return;
      setPrevReports(results.filter((r): r is RehearsalReport => r !== null));
    });
    return () => {
      isMounted = false;
    };
  }, [allSucceededRuns, props.runId]);

  const reportSmoothProgress = useJobSmoothProgress(
    reportJob,
    status === "not-ready",
  );

  const currentRunNumber = getRehearsalRunNumber(allSucceededRuns, props.runId);

  const handleSemanticRetry = useCallback(async () => {
    setSemanticRetryState({
      message: "서버에서 의미 전달을 다시 평가하고 있어요.",
      status: "running",
    });

    try {
      const job = await retryRehearsalSemanticEvaluation(props.runId);
      const completedJob = await pollRehearsalJob(job.jobId);
      if (completedJob.status !== "succeeded") {
        setSemanticRetryState({
          message:
            "서버 재평가를 완료하지 못했습니다. 발표 결과는 기존 상태로 유지됩니다.",
          status: "failed",
        });
        return;
      }

      const response = await fetchRehearsalReport(props.runId);
      const nextState = resolveRehearsalReportLoadState(
        response,
        props.projectId,
      );
      if (nextState.status !== "ready" || response.report === null) {
        setSemanticRetryState({
          message:
            "재평가는 끝났지만 새 결과를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.",
          status: "failed",
        });
        return;
      }

      setRun(response.run);
      setReport(response.report);
      setSemanticRetryState({
        message: "서버 재평가 결과를 반영했습니다.",
        status: "succeeded",
      });
    } catch (cause) {
      setSemanticRetryState({
        message:
          cause instanceof RehearsalFlowError &&
          cause.stage === "semantic-retry"
            ? cause.message
            : "서버 재평가 중 문제가 발생했습니다. 발표 결과는 기존 상태로 유지됩니다.",
        status: "failed",
      });
    }
  }, [props.projectId, props.runId]);

  return (
    <main className="rehearsal-report-page">
      <header className="rehearsal-report-topbar">
        <div className="rehearsal-report-topbar-left">
          <button
            type="button"
            className="rehearsal-report-back-button"
            onClick={() => navigateToPath(`/reports/${encodeURIComponent(props.projectId)}`)}
            aria-label="프로젝트 리포트 개요로"
          >
            <ArrowLeft size={18} />
          </button>
          <span className="report-project-title">{deck?.title ?? "리포트"}</span>
          {currentRunNumber != null && (
            <span className="report-run-label">
              리허설 {currentRunNumber}회차
            </span>
          )}
        </div>
      </header>

      <div className="rehearsal-report-body">
        <RehearsalRunNav
          runs={allSucceededRuns}
          activeRunId={props.runId}
          projectId={props.projectId}
        />

        <section className="rehearsal-report-document" aria-live="polite">
          {status === "loading" ? (
            <RehearsalReportLoadingShell />
          ) : report ? (
            <RehearsalReportDocument
              audioPlaybackAvailable={audioPlaybackAvailable}
              transcriptDownloadAvailable={transcriptDownloadAvailable}
              report={report}
              deck={deck}
              onSemanticRetry={handleSemanticRetry}
              run={run}
              runNumber={currentRunNumber}
              projectId={props.projectId}
              totalRunCount={allSucceededRuns.length}
              prevReports={prevReports}
              semanticRetryState={semanticRetryState}
              practiceGoalSummary={
                shouldLoadPracticeGoalSummary(run) ? (
                  <PracticeGoalSummary
                    projectId={props.projectId}
                    sourceFullRunId={props.runId}
                  />
                ) : null
              }
            />
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
              {status === "not-ready" && (
                <JobProgressDisplay
                  progress={reportSmoothProgress}
                  message={reportJob?.message || ""}
                />
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export function shouldLoadPracticeGoalSummary(run: RehearsalRun | null) {
  return run?.status === "succeeded";
}

type RehearsalPrompterRows = {
  current: string;
  focusSentenceId: string | null;
  items: RehearsalPrompterItem[];
  next: string;
  previous: string;
};

type RehearsalPrompterItem = {
  isFocusTarget: boolean;
  sentenceId: string;
  status: RehearsalScriptPrompterRowStatus;
  text: string;
};

export function getRehearsalPrompterRows(
  sentences: readonly ExtractedSentence[],
  coveredSentenceIds: readonly string[],
  fallbackNotes: string,
  prompterProgress?: PrompterProgressSnapshot,
): RehearsalPrompterRows {
  if (sentences.length === 0) {
    const fallback = fallbackNotes.trim() || "발표자 노트가 없습니다.";
    return {
      previous: "",
      current: fallback,
      focusSentenceId: "fallback",
      items: [
        {
          isFocusTarget: true,
          sentenceId: "fallback",
          status: "current",
          text: fallback,
        },
      ],
      next: "",
    };
  }

  const rows = createRehearsalScriptPrompterRows({
    sentences,
    coveredSentenceIds,
    prompterProgress,
  });
  const focusIndex = rows.findIndex((row) => row.isFocusTarget);
  let previous = "";
  for (let index = focusIndex - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.sentence.matchable) {
      previous = row.sentence.text;
      break;
    }
  }
  const current =
    rows.find((row) => row.status === "current")?.sentence.text ??
    rows.find((row) => row.isFocusTarget)?.sentence.text ??
    sentences[0]?.text ??
    "";
  const next = rows.find((row) => row.status === "next")?.sentence.text ?? "";

  return {
    previous,
    current,
    focusSentenceId:
      rows.find((row) => row.isFocusTarget)?.sentence.sentenceId ?? null,
    items: rows.map((row) => ({
      isFocusTarget: row.isFocusTarget,
      sentenceId: row.sentence.sentenceId,
      status: row.status,
      text: row.sentence.text,
    })),
    next,
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

function formatTargetDeltaLabel(deltaSeconds: number) {
  const absDelta = Math.abs(deltaSeconds);
  if (deltaSeconds >= 0) {
    return `${formatDuration(absDelta)} 여유`;
  }

  return `${formatDuration(absDelta)} 초과`;
}

function getTargetDurationSeconds(deck: Deck | null) {
  return deck ? getRehearsalDeckTargetSeconds(deck) : 0;
}

function formatDuration(totalSeconds: number) {
  const boundedSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(boundedSeconds / 60);
  const seconds = Math.floor(boundedSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
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

function RehearsalReportLoadingShell() {
  return (
    <div
      className="rrd-root report-loading-shell"
      role="status"
      aria-label="보고서를 불러오는 중입니다."
    >
      <section className="rrd-hero report-loading-hero" aria-hidden="true">
        <div className="rrd-hero-text report-loading-stack">
          <div className="report-loading-block report-loading-title" />
          <div className="report-loading-block report-loading-date" />
        </div>
        <div className="report-loading-block report-loading-button" />
      </section>

      <section className="rrd-card report-loading-card report-loading-card-wide" aria-hidden="true">
        <div className="rrd-card-head">
          <div className="report-loading-block report-loading-line-sm" />
        </div>
        <div className="report-loading-stack">
          <div className="report-loading-block report-loading-line-xl" />
          <div className="report-loading-block report-loading-line-lg" />
          <div className="report-loading-block report-loading-line-md" />
        </div>
      </section>

      <div className="rrd-overview-columns report-loading-columns" aria-hidden="true">
        <section className="rrd-card report-loading-card">
          <div className="rrd-card-head">
            <div className="report-loading-block report-loading-line-sm" />
          </div>
          <div className="rrd-overview-grid report-loading-metric-grid">
            <div className="report-loading-metric">
              <div className="report-loading-block report-loading-line-sm" />
              <div className="report-loading-block report-loading-metric-value" />
            </div>
            <div className="report-loading-metric">
              <div className="report-loading-block report-loading-line-sm" />
              <div className="report-loading-block report-loading-metric-value" />
            </div>
            <div className="report-loading-metric">
              <div className="report-loading-block report-loading-line-sm" />
              <div className="report-loading-block report-loading-metric-value" />
            </div>
            <div className="report-loading-metric">
              <div className="report-loading-block report-loading-line-sm" />
              <div className="report-loading-block report-loading-metric-value" />
            </div>
          </div>
        </section>

        <section className="rrd-card report-loading-card">
          <div className="rrd-card-head">
            <div className="report-loading-block report-loading-line-sm" />
          </div>
          <div className="report-loading-chart">
            <div className="report-loading-block report-loading-chart-bar" />
            <div className="report-loading-block report-loading-chart-bar report-loading-chart-bar-tall" />
            <div className="report-loading-block report-loading-chart-bar" />
            <div className="report-loading-block report-loading-chart-bar report-loading-chart-bar-short" />
            <div className="report-loading-block report-loading-chart-bar report-loading-chart-bar-mid" />
          </div>
          <div className="report-loading-stack">
            <div className="report-loading-block report-loading-line-md" />
            <div className="report-loading-block report-loading-line-sm" />
          </div>
        </section>
      </div>

      <section className="rrd-card report-loading-card" aria-hidden="true">
        <div className="rrd-card-head">
          <div className="report-loading-block report-loading-line-sm" />
        </div>
        <div className="report-loading-chip-list">
          <div className="report-loading-block report-loading-chip" />
          <div className="report-loading-block report-loading-chip" />
          <div className="report-loading-block report-loading-chip report-loading-chip-wide" />
          <div className="report-loading-block report-loading-chip" />
        </div>
        <div className="report-loading-list">
          <div className="report-loading-block report-loading-line-lg" />
          <div className="report-loading-block report-loading-line-md" />
          <div className="report-loading-block report-loading-line-lg" />
        </div>
      </section>

      <section className="rrd-card report-loading-card report-loading-card-wide" aria-hidden="true">
        <div className="rrd-card-head">
          <div className="report-loading-block report-loading-line-sm" />
        </div>
        <div className="report-loading-slide-list">
          <div className="report-loading-slide-item">
            <div className="report-loading-block report-loading-thumb" />
            <div className="report-loading-slide-copy">
              <div className="report-loading-block report-loading-line-lg" />
              <div className="report-loading-block report-loading-line-md" />
              <div className="report-loading-block report-loading-line-sm" />
            </div>
          </div>
          <div className="report-loading-slide-item">
            <div className="report-loading-block report-loading-thumb" />
            <div className="report-loading-slide-copy">
              <div className="report-loading-block report-loading-line-lg" />
              <div className="report-loading-block report-loading-line-md" />
              <div className="report-loading-block report-loading-line-sm" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
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

export function getHighlightedKeywordOccurrencesForSlide(slide: Slide | null) {
  if (!slide) {
    return undefined;
  }

  const targetOccurrenceIds = new Set([
    ...getKeywordOccurrenceTriggerIdsForSlide(slide),
    ...slide.keywords.flatMap(
      (keyword) => keyword.requiredOccurrenceIds ?? []
    )
  ]);

  if (targetOccurrenceIds.size === 0) {
    return [];
  }

  return deriveKeywordOccurrences(slide).filter(
    (occurrence) => targetOccurrenceIds.has(occurrence.occurrenceId)
  );
}

export function buildP3SessionSlides(
  deck: Deck,
  evaluationSnapshot?: RehearsalEvaluationSnapshot,
) {
  const deckSlidesById = new Map(deck.slides.map((slide) => [slide.slideId, slide]));
  const evaluationSlides = evaluationSnapshot?.slides ?? deck.slides;
  const pronunciationEntries =
    evaluationSnapshot?.pronunciationLexicon?.entries ?? [];

  return evaluationSlides.map((evaluationSlide) => {
    const slide = deckSlidesById.get(evaluationSlide.slideId);
    return {
      slideId: evaluationSlide.slideId,
      speakerNotes: slide?.speakerNotes ?? "",
      keywords: evaluationSlide.keywords ?? [],
      semanticCues: evaluationSlide.semanticCues ?? [],
      pronunciationEntries: pronunciationEntries.filter((entry) =>
        entry.scriptOccurrences.some(
          (occurrence) => occurrence.slideId === evaluationSlide.slideId,
        ),
      ),
      controlPhrases: defaultRehearsalCommandConfig.flatMap(
        (command) => command.phrases,
      ),
      legacyPhrases: [
        evaluationSlide.title,
        ...(slide ? getSlideBodyTexts(slide) : []),
      ].filter(Boolean),
    };
  });
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
    coveredSentenceMatchKinds: {},
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
  if (status === "unavailable") {
    return "공식 리포트가 생성되지 않았습니다. 연습 계획은 계속 사용할 수 있습니다.";
  }
  if (status === "failed") return error || "보고서를 불러오지 못했습니다.";
  return "보고서 대기 중";
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

export const getRehearsalTimingProgress = getPresenterTimingProgress;


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
  const [presenterStageElement, setPresenterStageElement] =
    useState<HTMLDivElement | null>(null);
  const [presenterScale, setPresenterScale] = useState<number | null>(null);
  const presenterStageRef = useCallback((node: HTMLDivElement | null) => {
    setPresenterStageElement(node);
  }, []);

  useLayoutEffect(() => {
    const stage = presenterStageElement;
    if (!stage || !deck) {
      setPresenterScale(null);
      return;
    }

    const updateScale = () => {
      const bounds = stage.getBoundingClientRect();
      const style = window.getComputedStyle(stage);
      const horizontalPadding =
        Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      const verticalPadding =
        Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      const availableWidth = Math.max(0, bounds.width - horizontalPadding);
      const availableHeight = Math.max(0, bounds.height - verticalPadding);
      const nextScale = Math.min(
        availableWidth / deck.canvas.width,
        availableHeight / deck.canvas.height,
      );
      if (Number.isFinite(nextScale) && nextScale > 0) {
        setPresenterScale((current) =>
          current === null || Math.abs(current - nextScale) > 0.001
            ? nextScale
            : current,
        );
      }
    };
    updateScale();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateScale);
      return () => {
        window.removeEventListener("resize", updateScale);
      };
    }

    const observer = new ResizeObserver(updateScale);
    observer.observe(stage);
    window.addEventListener("resize", updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [deck, presenterStageElement]);

  return { presenterScale, presenterStageRef };
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

function navigateToPath(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function setMediaStreamTracksEnabled(
  stream: MediaStream | null,
  enabled: boolean,
) {
  stream?.getAudioTracks().forEach((track) => {
    track.enabled = enabled;
  });
}

export function isReusableRehearsalMediaStream(stream: MediaStream | null) {
  if (!stream) {
    return false;
  }

  return stream.getAudioTracks().some((track) => track.readyState === "live");
}

async function readSemanticRetryError(response: Response) {
  const raw = await response.text();
  let code = "";
  try {
    const payload = JSON.parse(raw) as { code?: unknown };
    code = typeof payload.code === "string" ? payload.code : "";
  } catch {
    // The report UI intentionally does not expose raw server error details.
  }

  if (code === "REHEARSAL_SEMANTIC_EVIDENCE_EXPIRED") {
    return "재평가 가능 시간이 지났습니다. 새 리허설을 시작해 주세요.";
  }
  if (code === "REHEARSAL_SEMANTIC_EVALUATION_NOT_READY") {
    return "현재 리포트는 서버 재평가를 시작할 수 없습니다.";
  }
  return "서버 재평가를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function toMicrophoneErrorMessage(cause: unknown) {
  if (cause instanceof DOMException && cause.name === "NotAllowedError") {
    return "마이크 접근 권한이 거부되었습니다.";
  }

  if (cause instanceof DOMException && cause.name === "NotFoundError") {
    return "사용 가능한 마이크를 찾지 못했습니다.";
  }

  return "마이크를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function toRehearsalFlowMessage(cause: unknown) {
  if (cause instanceof RehearsalFlowError) {
    if (cause.stage === "storage-put") {
      return "업로드가 중단되었습니다. 네트워크와 스토리지 연결을 확인해 주세요.";
    }

    if (cause.stage === "complete" || cause.stage === "job-poll") {
      return cause.message || "음성 인식 또는 코칭 분석 작업에 실패했습니다.";
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
    : "요청을 처리하지 못했습니다.";
}

function extensionForMimeType(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}
