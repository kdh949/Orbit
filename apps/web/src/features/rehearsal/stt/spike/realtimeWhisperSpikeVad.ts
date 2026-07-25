export type SpeechDetectorState = {
  candidateStartedAtMs: number | null;
  isSpeaking: boolean;
  lastVoiceAtMs: number | null;
};

export type SpeechDetectorTransition = {
  state: SpeechDetectorState;
  speechStartedAtMs: number | null;
  speechEndedAtMs: number | null;
};

export const initialSpeechDetectorState: SpeechDetectorState = {
  candidateStartedAtMs: null,
  isSpeaking: false,
  lastVoiceAtMs: null
};

export function calculateNoiseFloorDb(samples: readonly number[]) {
  const usableSamples = samples
    .filter((value) => Number.isFinite(value) && value > -100 && value <= 0)
    .sort((left, right) => left - right);
  if (usableSamples.length === 0) {
    return null;
  }

  return percentile(usableSamples, 50);
}

export function resolveAdaptiveSpeechThresholdDb(
  noiseFloorDb: number,
  marginDb: number
) {
  return clamp(noiseFloorDb + marginDb, -60, -20);
}

export function advanceSpeechDetector(
  state: SpeechDetectorState,
  input: {
    nowMs: number;
    rmsDb: number;
    thresholdDb: number;
    attackMs: number;
    releaseMs: number;
  }
): SpeechDetectorTransition {
  const aboveThreshold = input.rmsDb >= input.thresholdDb;

  if (aboveThreshold) {
    if (state.isSpeaking) {
      return {
        state: { ...state, lastVoiceAtMs: input.nowMs },
        speechStartedAtMs: null,
        speechEndedAtMs: null
      };
    }

    const candidateStartedAtMs = state.candidateStartedAtMs ?? input.nowMs;
    if (input.nowMs - candidateStartedAtMs < input.attackMs) {
      return {
        state: { ...state, candidateStartedAtMs },
        speechStartedAtMs: null,
        speechEndedAtMs: null
      };
    }

    return {
      state: {
        candidateStartedAtMs: null,
        isSpeaking: true,
        lastVoiceAtMs: input.nowMs
      },
      speechStartedAtMs: candidateStartedAtMs,
      speechEndedAtMs: null
    };
  }

  if (!state.isSpeaking) {
    return {
      state: initialSpeechDetectorState,
      speechStartedAtMs: null,
      speechEndedAtMs: null
    };
  }

  const lastVoiceAtMs = state.lastVoiceAtMs ?? input.nowMs;
  if (input.nowMs - lastVoiceAtMs < input.releaseMs) {
    return {
      state,
      speechStartedAtMs: null,
      speechEndedAtMs: null
    };
  }

  return {
    state: initialSpeechDetectorState,
    speechStartedAtMs: null,
    speechEndedAtMs: input.nowMs
  };
}

function percentile(values: readonly number[], target: number) {
  const index = Math.ceil((target / 100) * values.length) - 1;
  return values[Math.max(index, 0)] ?? values[0] ?? -100;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
