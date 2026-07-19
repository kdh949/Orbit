import {
  LiveSttAdapterError,
  type LiveSttAdapter,
  type LiveSttAudioLevelEvent,
  type LiveSttBiasContext,
  type LiveSttDecodingMethod
} from "../liveStt";
import type { LiveSttDebugPcmRecording } from "../liveSttPcmDebug";
import { SherpaOnnxLiveSttAdapter } from "../sherpaOnnxLiveSttAdapter";
import {
  LiveSttError,
  mapPartialTranscriptToLiveSttResult,
  normalizeLiveSttBiasPhrases,
  type LiveSttBiasPhrase,
  type LiveSttCapabilities,
  type LiveSttErrorCode,
  type LiveSttPort,
  type LiveSttResult,
  type LiveSttSessionConfig,
  type LiveSttUnsubscribe
} from "./liveSttPort";

type SherpaLiveSttPortOptions = {
  adapter?: LiveSttAdapter;
  now?: () => number;
  onAudioLevel?: (event: LiveSttAudioLevelEvent) => void;
  onDebugPcmAvailable?: (recording: LiveSttDebugPcmRecording) => void;
  getDecodingMethod?: () => LiveSttDecodingMethod | null;
};

export class SherpaLiveSttPort implements LiveSttPort {
  readonly engineId = "sherpa";
  readonly capabilities: LiveSttCapabilities = {
    onDevice: true,
    streaming: true,
    keywordBiasing: true,
    languages: ["ko"]
  };

  private readonly adapter: LiveSttAdapter;
  private readonly now: () => number;
  private readonly onAudioLevel?: (event: LiveSttAudioLevelEvent) => void;
  private readonly onDebugPcmAvailable?: (
    recording: LiveSttDebugPcmRecording
  ) => void;
  private readonly getDecodingMethod?: () => LiveSttDecodingMethod | null;
  private readonly resultSubscribers = new Set<(result: LiveSttResult) => void>();
  private readonly errorSubscribers = new Set<(error: LiveSttError) => void>();
  private startedAtMs: number | null = null;

  constructor(options: SherpaLiveSttPortOptions = {}) {
    this.adapter = options.adapter ?? new SherpaOnnxLiveSttAdapter();
    this.now = options.now ?? (() => Date.now());
    this.onAudioLevel = options.onAudioLevel;
    this.onDebugPcmAvailable = options.onDebugPcmAvailable;
    this.getDecodingMethod = options.getDecodingMethod;
  }

  async start(config: LiveSttSessionConfig) {
    this.startedAtMs = this.now();

    try {
      await this.adapter.start(
        config.audioSource,
        {
          onPartialTranscript: (event) => {
            if (this.startedAtMs === null) {
              return;
            }

            const elapsedMs = Math.max(this.now() - this.startedAtMs, 0);
            this.emitResult(mapPartialTranscriptToLiveSttResult(event, elapsedMs));
          },
          onError: (error) => this.emitError(mapAdapterError(error)),
          onAudioLevel: this.onAudioLevel,
          onDebugPcmAvailable: this.onDebugPcmAvailable
        },
        {
          biasContext: toSherpaBiasContext(config.biasPhrases),
          decodingMethod: this.getDecodingMethod?.() ?? null
        }
      );
    } catch (error) {
      this.startedAtMs = null;
      throw mapAdapterError(error);
    }
  }

  async stop() {
    this.startedAtMs = null;
    this.adapter.stop();
  }

  updateBiasPhrases(phrases: readonly LiveSttBiasPhrase[]) {
    this.adapter.updateBiasContext?.(toSherpaBiasContext(phrases));
  }

  onResult(cb: (result: LiveSttResult) => void): LiveSttUnsubscribe {
    this.resultSubscribers.add(cb);
    return () => {
      this.resultSubscribers.delete(cb);
    };
  }

  onError(cb: (error: LiveSttError) => void): LiveSttUnsubscribe {
    this.errorSubscribers.add(cb);
    return () => {
      this.errorSubscribers.delete(cb);
    };
  }

  dispose() {
    this.startedAtMs = null;
    this.resultSubscribers.clear();
    this.errorSubscribers.clear();
    this.adapter.dispose();
  }

  private emitResult(result: LiveSttResult) {
    for (const subscriber of this.resultSubscribers) {
      subscriber(result);
    }
  }

  private emitError(error: LiveSttError) {
    for (const subscriber of this.errorSubscribers) {
      subscriber(error);
    }
  }
}

export function createSherpaLiveSttPort() {
  return new SherpaLiveSttPort();
}

function toSherpaBiasContext(
  phrases: readonly LiveSttBiasPhrase[] = []
): LiveSttBiasContext | null {
  const terms = normalizeLiveSttBiasPhrases(phrases).map((phrase) => ({
    text: phrase.text,
    source: toSherpaBiasSource(phrase.source),
    weight: phrase.weight,
    ...(phrase.keywordId === undefined ? {} : { keywordId: phrase.keywordId }),
    canonicalText: phrase.canonicalText ?? phrase.text
  }));

  if (terms.length === 0) {
    return null;
  }

  return {
    slideId: "live-stt-port",
    terms
  };
}

function toSherpaBiasSource(
  source: ReturnType<typeof normalizeLiveSttBiasPhrases>[number]["source"]
): LiveSttBiasContext["terms"][number]["source"] {
  switch (source) {
    case "semantic-cue-term":
    case "pronunciation-source":
      return "keyword";
    case "semantic-cue-alias":
    case "pronunciation-alias":
      return "synonym";
    case "keyword":
    case "synonym":
    case "abbreviation":
    case "title":
    case "slide-text":
    case "speaker-notes":
    case "nearby-slide-text":
    case "control-phrase":
      return source;
    case "final-trigger":
    case "cue-trigger":
    case "representative-phrase":
    case "legacy":
    case undefined:
      return "control-phrase";
  }
}

function mapAdapterError(error: unknown) {
  if (error instanceof LiveSttError) {
    return error;
  }

  if (error instanceof LiveSttAdapterError) {
    return new LiveSttError(mapAdapterErrorCode(error.code), error.message);
  }

  return new LiveSttError(
    "runtime_error",
    error instanceof Error ? error.message : "Live STT 실행 중 오류가 발생했습니다."
  );
}

function mapAdapterErrorCode(code: LiveSttAdapterError["code"]): LiveSttErrorCode {
  switch (code) {
    case "LIVE_STT_MODEL_UNAVAILABLE":
      return "model_unavailable";
    case "LIVE_STT_START_FAILED":
      return "start_failed";
  }
}
