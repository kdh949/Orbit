import type { PauseDetectorConfig } from "../../../runtime/presentation/advance/autoAdvanceConfig";

export type PauseDetectorEvent =
  | { type: "audio-level"; atMs: number; rmsDb: number }
  | { type: "reset"; atMs?: number }
  | { type: "tick"; atMs: number }
  | { type: "transcript-activity"; atMs: number; isFinal: boolean };

export type PauseDetectorOutput =
  | { type: "pause-started"; atMs: number; silenceDurationMs: number }
  | { type: "speech-resumed"; atMs: number };

export type PauseDetectorSnapshot = {
  isPaused: boolean;
  isSilent: boolean;
  lastTranscriptActivityAtMs: number | null;
  silenceDurationMs: number;
  silenceStartedAtMs: number | null;
};

export type PauseDetector = {
  accept: (event: PauseDetectorEvent) => PauseDetectorOutput[];
  snapshot: (atMs?: number) => PauseDetectorSnapshot;
};

export function createPauseDetector(options: {
  config: PauseDetectorConfig;
  pauseMs: number;
}): PauseDetector {
  const pauseMs = Math.max(1, Math.trunc(options.pauseMs));
  let isPaused = false;
  let isSilent = false;
  let hasAudioLevelEvidence = false;
  let lastTranscriptActivityAtMs: number | null = null;
  let silenceStartedAtMs: number | null = null;

  function accept(event: PauseDetectorEvent): PauseDetectorOutput[] {
    switch (event.type) {
      case "audio-level":
        return acceptAudioLevel(event.atMs, event.rmsDb);
      case "transcript-activity":
        return acceptTranscriptActivity(event.atMs);
      case "tick":
        return evaluatePause(event.atMs);
      case "reset":
        reset();
        return [];
    }
  }

  function snapshot(atMs = Date.now()): PauseDetectorSnapshot {
    return {
      isPaused,
      isSilent,
      lastTranscriptActivityAtMs,
      silenceDurationMs: getSilenceDurationMs(atMs),
      silenceStartedAtMs
    };
  }

  function acceptAudioLevel(atMs: number, rmsDb: number): PauseDetectorOutput[] {
    hasAudioLevelEvidence = true;
    if (rmsDb <= options.config.silenceThresholdDb) {
      if (!isSilent) {
        isSilent = true;
        silenceStartedAtMs = atMs;
      }
      return evaluatePause(atMs);
    }

    isSilent = false;
    silenceStartedAtMs = null;
    if (!isPaused) {
      return [];
    }

    isPaused = false;
    return [{ type: "speech-resumed", atMs }];
  }

  function acceptTranscriptActivity(atMs: number): PauseDetectorOutput[] {
    lastTranscriptActivityAtMs = atMs;
    // Web Speech처럼 RMS를 제공하지 않는 엔진은 전사 무갱신을 휴지 후보로 사용한다.
    if (!hasAudioLevelEvidence) {
      isSilent = true;
      silenceStartedAtMs = atMs;
    }
    if (!isPaused) {
      return [];
    }

    isPaused = false;
    return [{ type: "speech-resumed", atMs }];
  }

  function evaluatePause(atMs: number): PauseDetectorOutput[] {
    const silenceDurationMs = getSilenceDurationMs(atMs);
    if (!isPaused && silenceDurationMs >= pauseMs) {
      isPaused = true;
      return [{ type: "pause-started", atMs, silenceDurationMs }];
    }

    return [];
  }

  function getSilenceDurationMs(atMs: number) {
    if (!isSilent || silenceStartedAtMs === null) {
      return 0;
    }

    // partial/final 전사 활동은 발화 중 신호이므로 침묵 지속 시간의 기준점을 갱신한다.
    const activityBoundary = Math.max(
      silenceStartedAtMs,
      lastTranscriptActivityAtMs ?? silenceStartedAtMs
    );
    return Math.max(0, atMs - activityBoundary);
  }

  function reset() {
    isPaused = false;
    isSilent = false;
    hasAudioLevelEvidence = false;
    lastTranscriptActivityAtMs = null;
    silenceStartedAtMs = null;
  }

  return {
    accept,
    snapshot
  };
}
