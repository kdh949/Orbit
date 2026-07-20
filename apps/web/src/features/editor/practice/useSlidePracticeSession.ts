import type {
  SlidePracticeReport,
  VoiceBaselineMetrics,
  VoiceBaselineRecord,
} from "@orbit/shared";
import { useEffect, useRef, useState } from "react";

import { useFocusedPracticeAudio, type FocusedPracticeCapture } from "../../coaching/useFocusedPracticeAudio";
import { fetchLiveSttRuntimeConfig } from "../../rehearsal/stt/liveSttRuntimeConfig";
import type { LiveSttResult } from "../../rehearsal/stt/liveSttPort";
import {
  getStableDeviceIdHash,
  getVoiceBaseline,
  submitSlidePracticeAudio,
  upsertVoiceBaseline,
} from "./slidePracticeApi";

export type PracticeSessionState =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "completed"
  | "error";

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
  "부분 슬라이드 연습 기능이 현재 환경에서 꺼져 있습니다.";

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

export function useSlidePracticeSession(input: {
  beforeStart?: () => Promise<void>;
  projectId: string;
  deckId: string;
  deckVersion: number;
  slideId: string | null;
  slideOrder: number;
}) {
  const audio = useFocusedPracticeAudio(300_000, slidePracticeAudioConstraints);
  const [state, setState] = useState<PracticeSessionState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [report, setReport] = useState<SlidePracticeReport | null>(null);
  const [message, setMessage] = useState("");
  const [slidePracticeEnabled, setSlidePracticeEnabled] = useState<
    boolean | null
  >(null);
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
  } | null>(null);

  async function start(): Promise<MediaStream | null> {
    if (!input.slideId || state === "starting" || state === "recording") return null;
    setState("starting");
    setMessage("");
    setReport(null);
    try {
      const enabled =
        slidePracticeEnabled ??
        (await fetchLiveSttRuntimeConfig()).slidePracticeEnabled;
      setSlidePracticeEnabled(enabled);
      if (!enabled) {
        throw new Error(slidePracticeDisabledMessage);
      }
      await input.beforeStart?.();
      deviceIdHashRef.current = await getStableDeviceIdHash().catch(() => null);
      const stream = await audio.start();
      const startedAt = Date.now();
      startedAtRef.current = startedAt;
      sessionSnapshotRef.current = {
        practiceSessionId: `slide_practice_${crypto.randomUUID()}`,
        slideId: input.slideId,
        slideOrder: input.slideOrder,
        deckId: input.deckId,
        deckVersion: input.deckVersion,
        startedAt: new Date(startedAt).toISOString(),
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
    setMessage(slidePracticeEnabled === false ? slidePracticeDisabledMessage : "");
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
    void fetchLiveSttRuntimeConfig()
      .then((runtimeConfig) => {
        if (cancelled) return;
        setSlidePracticeEnabled(runtimeConfig.slidePracticeEnabled);
        if (!runtimeConfig.slidePracticeEnabled) {
          setMessage(slidePracticeDisabledMessage);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    state,
    elapsedMs,
    report,
    message,
    reset,
    slidePracticeEnabled,
    start,
    stop,
  };
}

export function getSlidePracticeErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("Slide practice is not enabled")
    ? slidePracticeDisabledMessage
    : message || fallback;
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
