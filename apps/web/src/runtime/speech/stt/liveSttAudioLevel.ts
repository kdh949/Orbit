import type { LiveSttAudioLevelEvent } from "./liveSttAdapter";

export const defaultLiveSttSilenceThresholdDb = -55;
export const liveSttAudioLevelFloorDb = -100;

export function calculatePcmAudioLevel(
  samples: Float32Array,
  options: { silenceThresholdDb?: number } = {},
): LiveSttAudioLevelEvent {
  const silenceThresholdDb =
    options.silenceThresholdDb ?? defaultLiveSttSilenceThresholdDb;

  if (samples.length === 0) {
    return createAudioLevelEvent(0, 0, silenceThresholdDb);
  }

  let peak = 0;
  let sumSquares = 0;
  for (const sample of samples) {
    const amplitude = Number.isFinite(sample) ? Math.abs(sample) : 0;
    peak = Math.max(peak, amplitude);
    sumSquares += amplitude * amplitude;
  }

  const rms = Math.sqrt(sumSquares / samples.length);
  return createAudioLevelEvent(rms, peak, silenceThresholdDb);
}

function createAudioLevelEvent(
  rms: number,
  peak: number,
  silenceThresholdDb: number,
): LiveSttAudioLevelEvent {
  const rmsDb = amplitudeToDecibels(rms);
  const peakDb = amplitudeToDecibels(peak);

  return {
    type: "audio-level",
    rms,
    peak,
    rmsDb,
    peakDb,
    isLikelySilence: rmsDb <= silenceThresholdDb,
  };
}

function amplitudeToDecibels(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return liveSttAudioLevelFloorDb;
  }

  return Math.max(liveSttAudioLevelFloorDb, 20 * Math.log10(value));
}
