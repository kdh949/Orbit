export type AutoAdvanceConfig = {
  manualGuidanceDelayMs: number;
};

export type AutoAdvancePolicy = {
  countdownMs: number;
  live: boolean;
  pauseMs: number;
  rehearsal: boolean;
  semanticMatching: boolean;
  threshold: number;
};

export type PauseDetectorConfig = {
  silenceThresholdDb: number;
};

export const autoAdvanceThresholdSteps = Object.freeze([
  0.5,
  0.55,
  0.6,
  0.65,
  0.7,
  0.75,
  0.8,
  0.85,
  0.9,
  0.95
]);

export const defaultAutoAdvanceConfig: AutoAdvanceConfig = Object.freeze({
  manualGuidanceDelayMs: 5000
});

export const defaultAutoAdvancePolicy: AutoAdvancePolicy = Object.freeze({
  countdownMs: 2000,
  live: false,
  pauseMs: 600,
  rehearsal: true,
  semanticMatching: true,
  threshold: 0.7
});

export const defaultPauseDetectorConfig: PauseDetectorConfig = Object.freeze({
  silenceThresholdDb: -55
});

export function normalizeAutoAdvanceThreshold(value: number) {
  const bounded = clamp(value, 0.5, 0.95);
  const stepIndex = Math.round((bounded - 0.5) / 0.05);
  return Number((0.5 + stepIndex * 0.05).toFixed(2));
}

export function formatAutoAdvanceThresholdPercent(value: number) {
  return Math.round(normalizeAutoAdvanceThreshold(value) * 100);
}

export function isAutoAdvanceEnabledForMode(
  policy: Pick<AutoAdvancePolicy, "live" | "rehearsal">,
  mode: "live" | "rehearsal"
) {
  return mode === "live" ? policy.live : policy.rehearsal;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
