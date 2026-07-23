import {
  emitLiveSttResultToSubscribers,
  LiveSttError,
  normalizeLiveSttBiasPhrases,
  type LiveSttCapabilities,
  type LiveSttBiasPhrase,
  type LiveSttPort,
  type LiveSttResult,
  type LiveSttSessionConfig,
  type LiveSttUnsubscribe
} from "./liveSttPort";
import {
  loadMoonshineModelManifest,
  type ResolvedMoonshineModelManifest
} from "./moonshineManifest";

export type MoonshineRuntimeResult = {
  text: string;
  isFinal?: boolean;
  confidence?: number;
};

export type MoonshineRuntime = {
  start: (config: {
    audioSource: MediaStream;
    manifest: ResolvedMoonshineModelManifest;
    onResult: (result: MoonshineRuntimeResult) => void;
    onError: (error: Error) => void;
  }) => Promise<void>;
  stop: () => void;
  dispose: () => void;
};

type MoonshineLiveSttPortOptions = {
  manifestUrl?: string;
  fetcher?: typeof fetch;
  createRuntime?: () => MoonshineRuntime;
  now?: () => number;
};

export class MoonshineLiveSttPort implements LiveSttPort {
  readonly engineId = "moonshine";
  readonly capabilities: LiveSttCapabilities = {
    onDevice: true,
    streaming: false,
    keywordBiasing: false,
    languages: ["ko"]
  };

  private readonly now: () => number;
  private readonly resultSubscribers = new Set<(result: LiveSttResult) => void>();
  private readonly errorSubscribers = new Set<(error: LiveSttError) => void>();
  private runtime: MoonshineRuntime | null = null;
  private startedAtMs: number | null = null;
  private biasPhrases: LiveSttBiasPhrase[] = [];

  constructor(private readonly options: MoonshineLiveSttPortOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  async start(config: LiveSttSessionConfig) {
    this.biasPhrases = normalizeLiveSttBiasPhrases(config.biasPhrases);
    this.startedAtMs = this.now();

    try {
      const manifest = await loadMoonshineModelManifest({
        manifestUrl: this.options.manifestUrl,
        fetcher: this.options.fetcher
      });
      const runtime = this.options.createRuntime?.() ?? createUnavailableRuntime();
      this.runtime = runtime;
      await runtime.start({
        audioSource: config.audioSource,
        manifest,
        onResult: (result) => this.handleRuntimeResult(result),
        onError: (error) => this.handleRuntimeError(error)
      });
    } catch (error) {
      this.startedAtMs = null;
      throw toMoonshineError(error);
    }
  }

  async stop() {
    this.startedAtMs = null;
    this.runtime?.stop();
  }

  updateBiasPhrases(phrases: readonly LiveSttBiasPhrase[]) {
    this.biasPhrases = normalizeLiveSttBiasPhrases(phrases);
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
    this.runtime?.dispose();
    this.runtime = null;
  }

  readBiasPhrasesForTest() {
    return this.biasPhrases;
  }

  private handleRuntimeResult(result: MoonshineRuntimeResult) {
    if (this.startedAtMs === null) {
      return;
    }

    const elapsedMs = Math.max(this.now() - this.startedAtMs, 0);
    this.emitResult({
      text: result.text,
      isFinal: result.isFinal ?? true,
      timestampMs: [elapsedMs, elapsedMs],
      ...(typeof result.confidence === "number"
        ? { confidence: result.confidence }
        : {})
    });
  }

  private handleRuntimeError(error: Error) {
    this.emitError(toMoonshineError(error));
  }

  private emitResult(result: LiveSttResult) {
    emitLiveSttResultToSubscribers(this.engineId, this.resultSubscribers, result);
  }

  private emitError(error: LiveSttError) {
    for (const subscriber of this.errorSubscribers) {
      subscriber(error);
    }
  }
}

function createUnavailableRuntime(): MoonshineRuntime {
  return {
    async start() {
      throw new LiveSttError(
        "model_unavailable",
        "Moonshine 로컬 runtime이 아직 준비되지 않았습니다. 모델 README를 확인하세요."
      );
    },
    stop() {},
    dispose() {}
  };
}

function toMoonshineError(error: unknown) {
  if (error instanceof LiveSttError) {
    return error;
  }

  return new LiveSttError(
    "model_unavailable",
    error instanceof Error ? error.message : "Moonshine 인식을 시작하지 못했습니다."
  );
}
