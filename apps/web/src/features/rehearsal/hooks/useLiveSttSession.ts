import { demoIds } from "@orbit/shared/common";
import type { Deck } from "@orbit/shared/deck";
import { useEffect, useRef, useState } from "react";
import {
  LiveSttAdapterError,
  type LiveSttAdapter,
  type LiveSttAudioLevelEvent,
  type LiveSttBiasContext,
} from "../../../runtime/speech/stt/liveSttAdapter";
import type { LiveSttDebugPcmRecording } from "../../../runtime/speech/stt/liveSttPcmDebug";
import { createLiveSttPort } from "../../../runtime/speech/stt/liveSttEngineRegistry";
import {
  LiveSttError,
  type LiveSttBiasPhrase,
  type LiveSttEngineId,
  type LiveSttPort,
  type LiveSttResult,
} from "../../../runtime/speech/stt/liveSttPort";
import { fetchLiveSttRuntimeConfig } from "../../../runtime/speech/stt/liveSttRuntimeConfig";
import { SherpaLiveSttPort } from "../../../runtime/speech/stt/sherpa/sherpaLiveSttPort";
import {
  canRetryInitialRecordingLiveStt,
  createInitialLiveSttRetryCoordinator,
} from "../panel/rehearsalLiveSttRecovery";
import { buildLiveSttBiasContext } from "../stt/liveSttBias";
import {
  downloadLiveSttDebugPcm,
  getLiveAudioLevelLabel,
  getLiveAudioLevelPercent,
  getLiveSttDebugDecodingMethod,
  shouldShowLiveSttDebugPcmDownload,
} from "../stt/liveSttUiModel";

export type LiveSttSessionStatus =
  | "idle"
  | "starting"
  | "listening"
  | "unavailable"
  | "failed"
  | "stopped";

type UseLiveSttSessionOptions = {
  fallbackEngineId: LiveSttEngineId;
  initialPort?: LiveSttPort;
  legacyAdapter?: LiveSttAdapter;
  projectId?: string;
};
type LiveSttBiasContextOptions = NonNullable<
  Parameters<typeof buildLiveSttBiasContext>[1]
>;

export function useLiveSttSession(options: UseLiveSttSessionOptions) {
  const [status, setStatus] = useState<LiveSttSessionStatus>("idle");
  const [error, setError] = useState("");
  const [audioLevel, setAudioLevel] = useState<LiveSttAudioLevelEvent | null>(
    null,
  );
  const [debugPcmRecording, setDebugPcmRecording] =
    useState<LiveSttDebugPcmRecording | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const portRef = useRef<LiveSttPort | null>(options.initialPort ?? null);
  const subscriptionCleanupRef = useRef<(() => void) | null>(null);
  const retryCoordinatorRef = useRef(createInitialLiveSttRetryCoordinator());
  const biasContextRef = useRef<LiveSttBiasContext | null>(null);

  useEffect(
    () => () => {
      retryCoordinatorRef.current.cancel();
      cleanupSubscriptions();
      void portRef.current?.dispose();
    },
    [],
  );

  async function preparePort(
    callbacks: {
      onError: (error: LiveSttError) => void;
      onResult: (result: LiveSttResult) => void;
    },
    shouldContinue: () => boolean = () => true,
  ) {
    try {
      const engineId = await resolveEffectiveEngine();
      if (!shouldContinue()) {
        return null;
      }
      const port = getOrCreatePort(engineId);
      portRef.current = port;
      setStatus("starting");
      setAudioLevel(null);
      cleanupSubscriptions();
      const unsubscribeResult = port.onResult(callbacks.onResult);
      const unsubscribeError = port.onError(callbacks.onError);
      subscriptionCleanupRef.current = () => {
        unsubscribeResult();
        unsubscribeError();
      };
      return port;
    } catch (cause) {
      if (!shouldContinue()) {
        return null;
      }
      fail(cause);
      return null;
    }
  }

  async function resolveEffectiveEngine(): Promise<LiveSttEngineId> {
    if (options.initialPort) {
      return options.initialPort.engineId;
    }

    try {
      return (await fetchLiveSttRuntimeConfig()).liveSttEngine;
    } catch {
      return options.fallbackEngineId;
    }
  }

  function getOrCreatePort(engineId: LiveSttEngineId) {
    if (options.initialPort) {
      portRef.current = options.initialPort;
      return options.initialPort;
    }

    const cachedPort = portRef.current;
    const activeProjectId = options.projectId ?? demoIds.projectId;
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
      legacyAdapter: options.legacyAdapter,
      onAudioLevel: setAudioLevel,
      onDebugPcmAvailable: setDebugPcmRecording,
      projectId: activeProjectId,
    });
    portRef.current = port;
    return port;
  }

  function getPort() {
    return portRef.current;
  }

  function cleanupSubscriptions() {
    subscriptionCleanupRef.current?.();
    subscriptionCleanupRef.current = null;
  }

  function markListening() {
    setStatus("listening");
  }

  function markStarting() {
    setError("");
    setStatus("starting");
    setAudioLevel(null);
  }

  function markStopped() {
    setAudioLevel(null);
    setStatus((current) =>
      current === "listening" || current === "starting" ? "stopped" : current,
    );
  }

  function fail(cause: unknown) {
    const liveSttError = toLiveSttError(cause);
    setStatus(isLiveSttUnavailable(liveSttError) ? "unavailable" : "failed");
    setError(liveSttError.message);
    setAudioLevel(null);
    return liveSttError;
  }

  function reset() {
    setStatus("idle");
    setError("");
    setAudioLevel(null);
    setDebugPcmRecording(null);
  }

  function resetAttempt() {
    setError("");
    setAudioLevel(null);
    setDebugPcmRecording(null);
  }

  async function stopPort() {
    cleanupSubscriptions();
    await portRef.current?.stop();
    markStopped();
  }

  function cancelRetry() {
    retryCoordinatorRef.current.cancel();
  }

  function canRetryRecording(options: {
    hasActiveSession: boolean;
    hasReusableStream: boolean;
    isRecording: boolean;
  }) {
    return canRetryInitialRecordingLiveStt({
      ...options,
      isRetrying: isRetrying || retryCoordinatorRef.current.isRetrying(),
      liveStatus: status,
    });
  }

  async function retryRecording(
    options: {
      hasActiveSession: boolean;
      hasReusableStream: boolean;
      isRecording: boolean;
    },
    retry: (isCurrent: () => boolean) => Promise<boolean>,
  ) {
    if (!canRetryRecording(options)) {
      return false;
    }

    setIsRetrying(true);
    setError("");
    try {
      return await retryCoordinatorRef.current.retry(retry);
    } finally {
      setIsRetrying(false);
    }
  }

  function getBiasContext(
    deck: Deck,
    slideIndex: number,
    contextOptions: LiveSttBiasContextOptions,
  ) {
    const slide = deck.slides[slideIndex];
    if (!slide) {
      return null;
    }

    const current = biasContextRef.current;
    if (current?.slideId === slide.slideId) {
      return current;
    }

    const next = buildLiveSttBiasContext(slide, contextOptions);
    biasContextRef.current = next;
    return next;
  }

  function updateBias(
    deck: Deck,
    slideIndex: number,
    contextOptions: LiveSttBiasContextOptions,
  ) {
    const context = getBiasContext(deck, slideIndex, contextOptions);
    void portRef.current?.updateBiasPhrases(getBiasPhrasesFromContext(context));
    return context;
  }

  const audioLevelLabel = getLiveAudioLevelLabel(audioLevel);
  const audioLevelPercent = getLiveAudioLevelPercent(audioLevel);
  const canDownloadDebugPcm =
    shouldShowLiveSttDebugPcmDownload(debugPcmRecording);

  return {
    audioLevel,
    audioLevelLabel,
    audioLevelPercent,
    canDownloadDebugPcm,
    canRetryRecording,
    cancelRetry,
    cleanupSubscriptions,
    debugPcmRecording,
    downloadDebugPcm: () => {
      if (debugPcmRecording) {
        downloadLiveSttDebugPcm(debugPcmRecording);
      }
    },
    error,
    fail,
    getBiasContext,
    getPort,
    isRetrying,
    markListening,
    markStarting,
    markStopped,
    normalizeError: toLiveSttError,
    preparePort,
    reset,
    resetAttempt,
    resolveEffectiveEngine,
    retryRecording,
    setError,
    setStatus,
    status,
    stopPort,
    updateBias,
  };
}

export function createDefaultLiveSttPort(
  options: {
    engineId?: LiveSttEngineId;
    legacyAdapter?: LiveSttAdapter;
    onAudioLevel?: (event: LiveSttAudioLevelEvent) => void;
    onDebugPcmAvailable?: (recording: LiveSttDebugPcmRecording) => void;
    projectId?: string;
  } = {},
) {
  const {
    engineId,
    legacyAdapter,
    onAudioLevel,
    onDebugPcmAvailable,
    projectId,
  } = options;
  const sherpaOptions = {
    onAudioLevel,
    onDebugPcmAvailable,
    getDecodingMethod: getLiveSttDebugDecodingMethod,
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
    ...sherpaOptions,
    projectId,
  });
}

function readLiveSttPortProjectId(port: LiveSttPort) {
  return "projectId" in port && typeof port.projectId === "string"
    ? port.projectId
    : null;
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
