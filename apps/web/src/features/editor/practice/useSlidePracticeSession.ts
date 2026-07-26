import {
  slideQuestionGuideTextHashInput,
  type Deck,
  type SlidePracticeReport,
  type VoiceBaselineMetrics,
  type VoiceBaselineRecord,
} from "@orbit/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { useFocusedPracticeAudio, type FocusedPracticeCapture } from "../../coaching/useFocusedPracticeAudio";
import { fetchLiveSttRuntimeConfig } from "../../../runtime/speech/stt/liveSttRuntimeConfig";
import type { LiveSttResult } from "../../../runtime/speech/stt/liveSttPort";
import {
  getStableDeviceIdHash,
  getVoiceBaseline,
  submitSlidePracticeAudio,
  upsertVoiceBaseline,
} from "./slidePracticeApi";
import { sha256Canonical } from "./slideQuestionGuideApi";

export type PracticeSessionState =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "completed"
  | "error";

export type SlidePracticeRuntimeState =
  | "checking"
  | "enabled"
  | "disabled"
  | "unavailable";

const slidePracticeAudioConstraints: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false,
};

export type PracticeTranscriptState = {
  finalParts: string[];
  interim: string;
};

export const slidePracticeDisabledMessage =
  "이 환경에서는 슬라이드 연습 기능을 사용할 수 없습니다.";
export const slidePracticeRuntimeUnavailableMessage =
  "슬라이드 연습 설정을 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";

export function createPracticeTranscriptState(): PracticeTranscriptState {
  return { finalParts: [], interim: "" };
}

export function updatePracticeTranscript(
  current: PracticeTranscriptState,
  result: Pick<LiveSttResult, "isFinal" | "text">,
): PracticeTranscriptState {
  const text = result.text.trim();
  if (!text) return current;
  if (result.isFinal) {
    return { finalParts: [...current.finalParts, text], interim: "" };
  }
  return { ...current, interim: text };
}

export function finalizePracticeTranscript(state: PracticeTranscriptState) {
  return [...state.finalParts, state.interim]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

export function shouldUpdateVoiceBaseline(
  qualityState: SlidePracticeReport["quality"]["state"],
  activeSpeechMs: number,
) {
  return qualityState !== "unmeasured" && activeSpeechMs >= 5_000;
}

export async function resolveSlidePracticeRuntimeState(
  fetchRuntimeConfig: () => Promise<{ slidePracticeEnabled: boolean }> = fetchLiveSttRuntimeConfig,
): Promise<Exclude<SlidePracticeRuntimeState, "checking">> {
  try {
    const runtimeConfig = await fetchRuntimeConfig();
    return runtimeConfig.slidePracticeEnabled ? "enabled" : "disabled";
  } catch {
    return "unavailable";
  }
}

export function getSlidePracticeRuntimeMessage(
  runtimeState: SlidePracticeRuntimeState,
) {
  if (runtimeState === "disabled") return slidePracticeDisabledMessage;
  if (runtimeState === "unavailable") {
    return slidePracticeRuntimeUnavailableMessage;
  }
  return "";
}

export async function prepareSlidePracticeStart<T, TBeforeStart = void>(input: {
  runtimeState: SlidePracticeRuntimeState;
  beforeStart: () => Promise<TBeforeStart>;
  getDeviceIdHash: () => Promise<string | null>;
  startAudio: () => Promise<T>;
}) {
  if (input.runtimeState !== "enabled") {
    throw new Error(
      getSlidePracticeRuntimeMessage(input.runtimeState) ||
        "슬라이드 연습 기능을 확인하고 있습니다.",
    );
  }
  const beforeStartResult = await input.beforeStart();
  const deviceIdHash = await input.getDeviceIdHash();
  const stream = await input.startAudio();
  return { beforeStartResult, deviceIdHash, stream };
}

export async function createSlidePracticeSessionSnapshot(input: {
  deck: Deck;
  practiceSessionId: string;
  slideId: string;
  startedAt: string;
}) {
  const source = await createSlidePracticeSourceSnapshot(input.deck, input.slideId);
  return {
    practiceSessionId: input.practiceSessionId,
    ...source,
    startedAt: input.startedAt,
  };
}

async function createSlidePracticeSourceSnapshot(deck: Deck, slideId: string) {
  const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
  if (!slide) throw new Error("현재 슬라이드가 서버 덱에 없습니다.");
  return {
    slideId: slide.slideId,
    slideOrder: slide.order,
    deckId: deck.deckId,
    deckVersion: deck.version,
    slideContentHash: await sha256Canonical(slideQuestionGuideTextHashInput(slide)),
  };
}

export function useSlidePracticeSession(input: {
  beforeStart?: () => Promise<Deck | void>;
  projectId: string;
  deckId: string;
  deckVersion: number;
  slideId: string | null;
  slideOrder: number;
  slideContentHashInput: unknown | null;
}) {
  const audio = useFocusedPracticeAudio(300_000, slidePracticeAudioConstraints);
  const [state, setState] = useState<PracticeSessionState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [report, setReport] = useState<SlidePracticeReport | null>(null);
  const [message, setMessage] = useState("");
  const [runtimeState, setRuntimeState] =
    useState<SlidePracticeRuntimeState>("checking");
  const [runtimeConfigRequest, setRuntimeConfigRequest] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deviceIdHashRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const sessionSnapshotRef = useRef<{
    practiceSessionId: string;
    slideId: string;
    slideOrder: number;
    deckId: string;
    deckVersion: number;
    startedAt: string;
    slideContentHash: string;
  } | null>(null);

  async function start(): Promise<MediaStream | null> {
    if (
      !input.slideId
      || input.slideContentHashInput === null
      || state === "starting"
      || state === "recording"
    ) return null;
    if (runtimeState !== "enabled") {
      setMessage(
        getSlidePracticeRuntimeMessage(runtimeState) ||
          "슬라이드 연습 기능을 확인하고 있습니다.",
      );
      return null;
    }
    setState("starting");
    setMessage("");
    setReport(null);
    try {
      const slideId = input.slideId;
      const prepared = await prepareSlidePracticeStart({
        runtimeState,
        beforeStart: async () => {
          const persistedDeck = await input.beforeStart?.();
          return persistedDeck
            ? createSlidePracticeSourceSnapshot(persistedDeck, slideId)
            : {
                slideId,
                slideOrder: input.slideOrder,
                deckId: input.deckId,
                deckVersion: input.deckVersion,
                slideContentHash: await sha256Canonical(input.slideContentHashInput),
              };
        },
        getDeviceIdHash: () => getStableDeviceIdHash().catch(() => null),
        startAudio: audio.start,
      });
      deviceIdHashRef.current = prepared.deviceIdHash;
      const stream = prepared.stream;
      const sourceSnapshot = prepared.beforeStartResult;
      const startedAt = Date.now();
      startedAtRef.current = startedAt;
      const practiceSessionId = `slide_practice_${crypto.randomUUID()}`;
      const startedAtIso = new Date(startedAt).toISOString();
      sessionSnapshotRef.current = {
        practiceSessionId,
        ...sourceSnapshot,
        startedAt: startedAtIso,
      };
      timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 200);
      setElapsedMs(0);
      setState("recording");
      return stream;
    } catch (error) {
      clearTimer();
      setState("error");
      setMessage(getSlidePracticeErrorMessage(error, "마이크를 시작하지 못했습니다."));
      return null;
    }
  }

  async function stop() {
    if (state !== "recording" || !sessionSnapshotRef.current || submittingRef.current) return;
    setState("stopping");
    clearTimer();
    try {
      const capture = await audio.stop();
      await finishCapture(capture);
    } catch (error) {
      setState("error");
      setMessage(getSlidePracticeErrorMessage(error, "연습 녹음을 완료하지 못했습니다."));
    }
  }

  function reset() {
    if (state === "starting" || state === "recording" || state === "stopping") {
      return false;
    }
    clearTimer();
    sessionSnapshotRef.current = null;
    startedAtRef.current = null;
    setElapsedMs(0);
    setMessage(getSlidePracticeRuntimeMessage(runtimeState));
    setReport(null);
    setState("idle");
    return true;
  }

  async function finishCapture(capture: FocusedPracticeCapture) {
    if (submittingRef.current) return;
    const snapshot = sessionSnapshotRef.current;
    if (!snapshot) throw new Error("연습 세션 정보를 찾지 못했습니다.");
    submittingRef.current = true;
    const durationMs = Math.min(300_000, capture.durationMs);
    setElapsedMs(durationMs);
    setMessage("녹음을 업로드하고 서버에서 말 속도·쉼·피치·음량·습관어를 분석하고 있습니다.");
    try {
      const nextReport = await submitSlidePracticeAudio({
        projectId: input.projectId,
        practiceSessionId: snapshot.practiceSessionId,
        deckId: snapshot.deckId,
        deckVersion: snapshot.deckVersion,
        slideId: snapshot.slideId,
        slideOrder: snapshot.slideOrder,
        slideContentHash: snapshot.slideContentHash,
        startedAt: snapshot.startedAt,
        deviceIdHash: deviceIdHashRef.current,
        blob: capture.blob,
        durationMs,
      });
      setReport(nextReport);
      setMessage("서버 분석을 완료했습니다. 전사 원문은 저장하지 않으며 원본 음성은 분석 후 삭제됩니다.");
      void updateBaseline(nextReport);
      setState("completed");
    } finally {
      submittingRef.current = false;
    }
  }

  async function updateBaseline(nextReport: SlidePracticeReport) {
    const deviceIdHash = deviceIdHashRef.current;
    if (!deviceIdHash || !shouldUpdateVoiceBaseline(nextReport.quality.state, nextReport.voice.activeSpeechMs)) return;
    const previous: VoiceBaselineRecord | null = await getVoiceBaseline(deviceIdHash).catch(() => null);
    const sampleCount = Math.min(10_000, (previous?.sampleCount ?? 0) + 1);
    const metrics = mergeBaseline(previous?.metrics ?? null, nextReport.voice, sampleCount);
    await upsertVoiceBaseline({ deviceIdHash, sampleCount, metrics }).catch(() => undefined);
  }

  function clearTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  useEffect(() => () => clearTimer(), []);

  useEffect(() => {
    const capture = audio.automaticCapture;
    if (!capture || state !== "recording" || submittingRef.current) return;
    audio.clearAutomaticCapture();
    clearTimer();
    setState("stopping");
    void finishCapture(capture).catch((error) => {
      setState("error");
      setMessage(getSlidePracticeErrorMessage(error, "연습 녹음을 완료하지 못했습니다."));
    });
  }, [audio.automaticCapture, state]);

  useEffect(() => {
    let cancelled = false;
    setRuntimeState("checking");
    void resolveSlidePracticeRuntimeState().then((nextState) => {
      if (cancelled) return;
      setRuntimeState(nextState);
      setMessage((current) =>
        current &&
        current !== slidePracticeDisabledMessage &&
        current !== slidePracticeRuntimeUnavailableMessage
          ? current
          : getSlidePracticeRuntimeMessage(nextState),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [runtimeConfigRequest]);

  const retryRuntimeConfig = useCallback(() => {
    setRuntimeState("checking");
    setMessage((current) =>
      current === slidePracticeRuntimeUnavailableMessage ? "" : current,
    );
    setRuntimeConfigRequest((current) => current + 1);
  }, []);

  return {
    state,
    elapsedMs,
    report,
    message,
    reset,
    retryRuntimeConfig,
    runtimeState,
    start,
    stop,
  };
}

export function getSlidePracticeErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Slide practice is not enabled")) return slidePracticeDisabledMessage;
  if (message.includes("content hash") || message.includes("slide content")) {
    return "슬라이드 내용이 변경되었습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.";
  }
  return message || fallback;
}

function mergeBaseline(
  previous: VoiceBaselineMetrics | null,
  current: SlidePracticeReport["voice"],
  sampleCount: number,
): VoiceBaselineMetrics {
  const previousWeight = Math.max(0, sampleCount - 1);
  const merge = (oldValue: number | null | undefined, newValue: number | null) => {
    if (newValue === null) return oldValue ?? null;
    if (oldValue === null || oldValue === undefined || previousWeight === 0) return newValue;
    return (oldValue * previousWeight + newValue) / sampleCount;
  };
  return {
    pitchMedianHz: merge(previous?.pitchMedianHz, current.pitchMedianHz),
    pitchSpanHz: merge(previous?.pitchSpanHz, current.pitchSpanHz),
    loudnessDb: merge(previous?.loudnessDb, current.loudnessDb),
    loudnessMadDb: merge(previous?.loudnessMadDb, current.loudnessMadDb),
    syllablesPerSecond: merge(previous?.syllablesPerSecond, current.syllablesPerSecond),
    rhythmRegularity: merge(previous?.rhythmRegularity, current.rhythmRegularity),
  };
}
