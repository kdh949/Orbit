import { useCallback, useState } from "react";

import {
  defaultAutoAdvancePolicy,
  defaultPauseDetectorConfig,
  normalizeAutoAdvanceThreshold
} from "../advance/autoAdvanceConfig";
import {
  type HybridCoverageConfig,
  defaultSpeechTrackingConfig
} from "../speech/speechTrackingConfig";
import type { LiveSttEngineId } from "../stt/liveSttPort";
import { defaultLiveSttEngineId } from "../stt/liveSttEngineRegistry";

export const presenterGlobalSettingsStorageKey = "orbit:presenter:global:v1";
export const presenterDeckSettingsStorageKeyPrefix = "orbit:presenter:deck:";
export const presenterDeckSettingsStorageKeyVersion = ":v1";

const liveSttEngineIds: readonly LiveSttEngineId[] = [
  "openai-realtime",
  "sherpa",
  "web-speech",
  "moonshine"
];

export type PresenterAdvancePolicySettings = {
  countdownMs: number;
  rehearsal: boolean;
  live: boolean;
  pauseMs: number;
  threshold: number;
};

export type PresenterPaceAdviceSettings = {
  slowWpm: number;
  fastWpm: number;
};

export type PresenterRecordingSettings = {
  enabled: boolean;
};

export type PresenterPauseDetectorSettings = {
  silenceThresholdDb: number;
};

export type PresenterSpeechTrackingSettings = {
  diceThreshold: number;
  matchingTailCharacters: number;
  hybridCoverage: HybridCoverageConfig;
  adviceReentryCooldownMs: number;
  biasPhraseBudget: number;
};

export type PresenterSettings = {
  sttEngine: LiveSttEngineId;
  advancePolicy: PresenterAdvancePolicySettings;
  paceAdvice: PresenterPaceAdviceSettings;
  pauseDetector: PresenterPauseDetectorSettings;
  recording: PresenterRecordingSettings;
  speechTracking: PresenterSpeechTrackingSettings;
};

export type PresenterSettingsInput = DeepPartial<PresenterSettings>;
export type PresenterSettingsUpdater =
  | PresenterSettingsInput
  | ((current: PresenterSettings) => PresenterSettingsInput);

type PresenterSettingsStorage = Pick<Storage, "getItem" | "setItem">;

type DeepPartial<T> = {
  [Key in keyof T]?: T[Key] extends object ? DeepPartial<T[Key]> : T[Key];
};

export const defaultPresenterSettings: PresenterSettings = Object.freeze({
  sttEngine: defaultLiveSttEngineId,
  advancePolicy: Object.freeze({
    ...defaultAutoAdvancePolicy
  }),
  paceAdvice: Object.freeze({
    slowWpm: defaultSpeechTrackingConfig.paceAdvice.slowWpm,
    fastWpm: defaultSpeechTrackingConfig.paceAdvice.fastWpm
  }),
  pauseDetector: Object.freeze({
    ...defaultPauseDetectorConfig
  }),
  recording: Object.freeze({
    enabled: true
  }),
  speechTracking: Object.freeze({
    diceThreshold: defaultSpeechTrackingConfig.diceThreshold,
    matchingTailCharacters: defaultSpeechTrackingConfig.matchingTailCharacters,
    hybridCoverage: Object.freeze({
      ...defaultSpeechTrackingConfig.hybridCoverage
    }),
    adviceReentryCooldownMs:
      defaultSpeechTrackingConfig.adviceReentryCooldownMs,
    biasPhraseBudget: defaultSpeechTrackingConfig.biasPhraseBudget
  })
});

export function getPresenterDeckSettingsStorageKey(deckId: string) {
  return `${presenterDeckSettingsStorageKeyPrefix}${deckId}${presenterDeckSettingsStorageKeyVersion}`;
}

export function loadPresenterSettings(
  storage: PresenterSettingsStorage | null | undefined = getPresenterSettingsStorage()
): PresenterSettings {
  if (!storage) {
    return defaultPresenterSettings;
  }

  try {
    const serialized = storage.getItem(presenterGlobalSettingsStorageKey);
    if (!serialized) {
      return defaultPresenterSettings;
    }

    return normalizePresenterSettings(JSON.parse(serialized));
  } catch {
    return defaultPresenterSettings;
  }
}

export function savePresenterSettings(
  input: PresenterSettingsInput,
  storage: PresenterSettingsStorage | null | undefined = getPresenterSettingsStorage()
): PresenterSettings {
  const settings = normalizePresenterSettings(input, loadPresenterSettings(storage));

  if (storage) {
    try {
      storage.setItem(presenterGlobalSettingsStorageKey, JSON.stringify(settings));
    } catch {
      return settings;
    }
  }

  return settings;
}

export function updatePresenterSettings(
  updater: PresenterSettingsUpdater,
  storage: PresenterSettingsStorage | null | undefined = getPresenterSettingsStorage()
): PresenterSettings {
  const current = loadPresenterSettings(storage);
  const patch = typeof updater === "function" ? updater(current) : updater;

  return savePresenterSettings(mergePresenterSettingsInput(current, patch), storage);
}

export function usePresenterSettings(
  storage: PresenterSettingsStorage | null | undefined = getPresenterSettingsStorage()
) {
  const [settings, setSettings] = useState(() => loadPresenterSettings(storage));

  const save = useCallback(
    (updater: PresenterSettingsUpdater) => {
      const next = updatePresenterSettings((current) => {
        const patch = typeof updater === "function" ? updater(current) : updater;
        return mergePresenterSettingsInput(current, patch);
      }, storage);
      setSettings(next);
      return next;
    },
    [storage]
  );

  return { settings, save };
}

function getPresenterSettingsStorage(): PresenterSettingsStorage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function normalizePresenterSettings(
  input: unknown,
  fallback: PresenterSettings = defaultPresenterSettings
): PresenterSettings {
  const value = isRecord(input) ? input : {};
  const advancePolicy = isRecord(value.advancePolicy) ? value.advancePolicy : {};
  const paceAdvice = isRecord(value.paceAdvice) ? value.paceAdvice : {};
  const pauseDetector = isRecord(value.pauseDetector) ? value.pauseDetector : {};
  const recording = isRecord(value.recording) ? value.recording : {};
  const speechTracking = isRecord(value.speechTracking) ? value.speechTracking : {};
  const hybridCoverage = isRecord(speechTracking.hybridCoverage)
    ? speechTracking.hybridCoverage
    : {};

  const slowWpm = numberOrFallback(paceAdvice.slowWpm, fallback.paceAdvice.slowWpm);
  const fastWpm = numberOrFallback(paceAdvice.fastWpm, fallback.paceAdvice.fastWpm);
  const pacePair =
    slowWpm > 0 && fastWpm > slowWpm
      ? { slowWpm, fastWpm }
      : fallback.paceAdvice;

  return {
    sttEngine: isLiveSttEngineId(value.sttEngine)
      ? value.sttEngine
      : fallback.sttEngine,
    advancePolicy: {
      countdownMs: integerOrFallback(
        advancePolicy.countdownMs,
        fallback.advancePolicy.countdownMs,
        1
      ),
      rehearsal: booleanOrFallback(
        advancePolicy.rehearsal,
        fallback.advancePolicy.rehearsal
      ),
      live: booleanOrFallback(advancePolicy.live, fallback.advancePolicy.live),
      pauseMs: integerOrFallback(
        advancePolicy.pauseMs,
        fallback.advancePolicy.pauseMs,
        1
      ),
      threshold: normalizeAutoAdvanceThreshold(
        numberOrFallback(advancePolicy.threshold, fallback.advancePolicy.threshold)
      )
    },
    paceAdvice: pacePair,
    pauseDetector: {
      silenceThresholdDb: numberOrFallback(
        pauseDetector.silenceThresholdDb,
        fallback.pauseDetector.silenceThresholdDb
      )
    },
    recording: {
      enabled: booleanOrFallback(recording.enabled, fallback.recording.enabled)
    },
    speechTracking: {
      diceThreshold: clamp(
        numberOrFallback(
          speechTracking.diceThreshold,
          fallback.speechTracking.diceThreshold
        ),
        0,
        1
      ),
      matchingTailCharacters: integerOrFallback(
        speechTracking.matchingTailCharacters,
        fallback.speechTracking.matchingTailCharacters,
        0
      ),
      hybridCoverage: {
        sentenceWeight: clamp(
          numberOrFallback(
            hybridCoverage.sentenceWeight,
            fallback.speechTracking.hybridCoverage.sentenceWeight
          ),
          0,
          1
        ),
        wordWeight: clamp(
          numberOrFallback(
            hybridCoverage.wordWeight,
            fallback.speechTracking.hybridCoverage.wordWeight
          ),
          0,
          1
        ),
        correctionWindow: clamp(
          numberOrFallback(
            hybridCoverage.correctionWindow,
            fallback.speechTracking.hybridCoverage.correctionWindow
          ),
          0,
          1
        )
      },
      adviceReentryCooldownMs: integerOrFallback(
        speechTracking.adviceReentryCooldownMs,
        fallback.speechTracking.adviceReentryCooldownMs,
        0
      ),
      biasPhraseBudget: integerOrFallback(
        speechTracking.biasPhraseBudget,
        fallback.speechTracking.biasPhraseBudget,
        1
      )
    }
  };
}

function mergePresenterSettingsInput(
  current: PresenterSettings,
  patch: PresenterSettingsInput
): PresenterSettingsInput {
  return {
    ...current,
    ...patch,
    advancePolicy: {
      ...current.advancePolicy,
      ...patch.advancePolicy
    },
    paceAdvice: {
      ...current.paceAdvice,
      ...patch.paceAdvice
    },
    pauseDetector: {
      ...current.pauseDetector,
      ...patch.pauseDetector
    },
    recording: {
      ...current.recording,
      ...patch.recording
    },
    speechTracking: {
      ...current.speechTracking,
      ...patch.speechTracking,
      hybridCoverage: {
        ...current.speechTracking.hybridCoverage,
        ...patch.speechTracking?.hybridCoverage
      }
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLiveSttEngineId(value: unknown): value is LiveSttEngineId {
  return typeof value === "string" && liveSttEngineIds.includes(value as LiveSttEngineId);
}

function booleanOrFallback(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function numberOrFallback(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function integerOrFallback(value: unknown, fallback: number, min: number) {
  const numberValue = numberOrFallback(value, fallback);
  const integerValue = Math.trunc(numberValue);

  return integerValue >= min ? integerValue : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
