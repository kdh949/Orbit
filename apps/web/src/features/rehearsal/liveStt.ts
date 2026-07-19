import type { LiveSttPartialTranscriptEvent } from "@orbit/shared";
import type { LiveSttDebugPcmRecording } from "./liveSttPcmDebug";

export type LiveSttAudioLevelEvent = {
  type: "audio-level";
  rms: number;
  peak: number;
  rmsDb: number;
  peakDb: number;
  isLikelySilence: boolean;
};

export type LiveSttCallbacks = {
  onPartialTranscript: (event: LiveSttPartialTranscriptEvent) => void;
  onError: (error: LiveSttAdapterError) => void;
  onAudioLevel?: (event: LiveSttAudioLevelEvent) => void;
  onDebugPcmAvailable?: (recording: LiveSttDebugPcmRecording) => void;
};

export type LiveSttBiasSource =
  | "keyword"
  | "synonym"
  | "abbreviation"
  | "title"
  | "slide-text"
  | "speaker-notes"
  | "nearby-slide-text"
  | "pronunciation-source"
  | "pronunciation-alias"
  | "control-phrase";

export type LiveSttBiasTerm = {
  text: string;
  source: LiveSttBiasSource;
  weight: number;
  keywordId?: string;
  canonicalText?: string;
};

export type LiveSttBiasContext = {
  slideId: string;
  terms: LiveSttBiasTerm[];
};

export type LiveSttBiasMode = "none" | "postprocess" | "hotword" | "combined";
export type LiveSttDecodingMethod = "greedy_search" | "modified_beam_search";

export type LiveSttStartOptions = {
  biasContext?: LiveSttBiasContext | null;
  decodingMethod?: LiveSttDecodingMethod | null;
};

export type LiveSttAdapter = {
  start: (
    stream: MediaStream,
    callbacks: LiveSttCallbacks,
    options?: LiveSttStartOptions
  ) => Promise<void>;
  updateBiasContext?: (biasContext: LiveSttBiasContext | null) => void;
  stop: () => void;
  dispose: () => void;
};

export type LiveSttAdapterErrorCode =
  | "LIVE_STT_MODEL_UNAVAILABLE"
  | "LIVE_STT_START_FAILED";

export class LiveSttAdapterError extends Error {
  constructor(
    readonly code: LiveSttAdapterErrorCode,
    message: string
  ) {
    super(message);
    this.name = "LiveSttAdapterError";
  }
}

declare global {
  interface Window {
    __orbitCreateLiveSttAdapter?: () => LiveSttAdapter;
  }
}
