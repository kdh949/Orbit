import {
  getBrowserSpeechRecognitionConstructor,
  type BrowserSpeechRecognition,
  type BrowserSpeechRecognitionAvailabilityOptions,
  type BrowserSpeechRecognitionConstructor,
  type BrowserSpeechRecognitionErrorEvent,
  type BrowserSpeechRecognitionEvent,
  type BrowserSpeechRecognitionResult,
  type BrowserSpeechRecognitionGlobal
} from "./browserSpeechRecognition";
import {
  LiveSttError,
  normalizeLiveSttBiasPhrases,
  type LiveSttAlternative,
  type LiveSttBiasPhrase,
  type LiveSttCapabilities,
  type LiveSttPort,
  type LiveSttResult,
  type LiveSttSessionConfig,
  type LiveSttUnsubscribe
} from "./liveSttPort";
import { applyWebSpeechPhrases, isWebSpeechPhrasesSupported } from "./webSpeechPhrases";
import { resolveWebSpeechAudioTrack, startRecognitionWithAudioTrack } from "./webSpeechAudioTrack";

export type BrowserSpeechRecognitionFactory = () => BrowserSpeechRecognition;

export const WEB_SPEECH_LANGUAGE = "ko-KR";
export const WEB_SPEECH_ON_DEVICE_POLICY = Object.freeze({
  processLocally: true,
  quality: "command"
} as const);
export type WebSpeechOnDeviceQuality = typeof WEB_SPEECH_ON_DEVICE_POLICY.quality;
export const WEB_SPEECH_MAX_ALTERNATIVES = 3;
type WebSpeechLiveSttPortOptions = {
  consentGranted?: boolean;
  createRecognition?: BrowserSpeechRecognitionFactory | null;
  recognitionConstructor?: BrowserSpeechRecognitionConstructor | null;
  speechRecognitionGlobal?: BrowserSpeechRecognitionGlobal;
  processLocally?: boolean;
  now?: () => number;
};

type PendingStop = {
  recognition: BrowserSpeechRecognition;
  promise: Promise<void>;
  resolve: () => void;
};

export class WebSpeechLiveSttPort implements LiveSttPort {
  readonly engineId = "web-speech";
  readonly capabilities: LiveSttCapabilities;

  private readonly createRecognition: BrowserSpeechRecognitionFactory | null;
  private readonly recognitionConstructor: BrowserSpeechRecognitionConstructor | null;
  private readonly speechRecognitionGlobal: BrowserSpeechRecognitionGlobal;
  private readonly processLocally: boolean;
  private readonly now: () => number;
  private readonly resultSubscribers = new Set<(result: LiveSttResult) => void>();
  private readonly errorSubscribers = new Set<(error: LiveSttError) => void>();
  private recognition: BrowserSpeechRecognition | null = null;
  private startedAtMs: number | null = null;
  private activeAudioTrack: MediaStreamTrack | null = null;
  private activeLang = WEB_SPEECH_LANGUAGE;
  private biasPhrases: LiveSttBiasPhrase[] = [];
  private pendingStop: PendingStop | null = null;

  constructor(private readonly options: WebSpeechLiveSttPortOptions) {
    const Recognition =
      options.recognitionConstructor === undefined
        ? getDefaultBrowserSpeechRecognitionConstructor()
        : options.recognitionConstructor;
    this.recognitionConstructor = Recognition;
    this.createRecognition =
      options.createRecognition === undefined
        ? Recognition
          ? () => new Recognition()
          : null
        : options.createRecognition;
    this.processLocally = options.processLocally ?? true;
    this.speechRecognitionGlobal =
      options.speechRecognitionGlobal ?? getDefaultBrowserSpeechRecognitionGlobal();
    this.now = options.now ?? (() => Date.now());
    this.capabilities = {
      onDevice: this.processLocally,
      streaming: true,
      keywordBiasing: false,
      languages: ["ko"]
    };
  }

  async start(config: LiveSttSessionConfig) {
    if (!this.processLocally && !this.options.consentGranted) {
      throw new LiveSttError(
        "consent_required",
        "Web Speech는 브라우저에 따라 외부 인식 서비스를 사용할 수 있어 명시적 동의가 필요합니다."
      );
    }

    if (!this.createRecognition) {
      throw new LiveSttError(
        "unsupported_runtime",
        "이 브라우저는 Web Speech 인식을 지원하지 않습니다."
      );
    }

    const recognition = this.createRecognition();
    const lang = config.language === "ko" ? WEB_SPEECH_LANGUAGE : config.language;
    if (this.processLocally) {
      if (!("processLocally" in recognition)) {
        throw new LiveSttError(
          "unsupported_runtime",
          "이 브라우저는 온디바이스 Web Speech 인식을 지원하지 않습니다."
        );
      }
      recognition.processLocally = true;
      await this.ensureLocalLanguagePack(lang);
    }

    this.recognition = recognition;
    this.startedAtMs = this.now();
    this.activeLang = lang;
    // Chrome's MediaStreamTrack recognition path is independent from the
    // on-device microphone path and has produced remote-style `network`
    // failures even with processLocally enabled. Let Chrome's local recognizer
    // capture the already-authorized default microphone directly.
    this.activeAudioTrack = this.processLocally
      ? null
      : resolveWebSpeechAudioTrack(config.audioSource);
    this.biasPhrases = normalizeLiveSttBiasPhrases(config.biasPhrases ?? this.biasPhrases);

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.maxAlternatives = WEB_SPEECH_MAX_ALTERNATIVES;
    recognition.onresult = (event) => this.handleResult(event);
    recognition.onerror = (event) => this.handleError(event);
    recognition.onend = () => this.handleEnd(recognition);
    this.capabilities.keywordBiasing = isWebSpeechPhrasesSupported(
      recognition,
      this.speechRecognitionGlobal
    );
    applyWebSpeechPhrases(recognition, this.biasPhrases, this.speechRecognitionGlobal);

    try {
      startRecognitionWithAudioTrack(recognition, this.activeAudioTrack);
    } catch (error) {
      this.startedAtMs = null;
      this.recognition = null;
      this.activeAudioTrack = null;
      throw new LiveSttError(
        "start_failed",
        error instanceof Error ? error.message : "Web Speech 인식을 시작하지 못했습니다."
      );
    }
  }

  async stop() {
    if (this.pendingStop) {
      return this.pendingStop.promise;
    }

    const recognition = this.recognition;
    if (!recognition) {
      return;
    }

    let resolveStop = () => {};
    const promise = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    this.pendingStop = { recognition, promise, resolve: resolveStop };

    try {
      recognition.stop();
      await promise;
    } catch (error) {
      this.completeStop(recognition);
      throw error;
    }
  }

  updateBiasPhrases(phrases: readonly LiveSttBiasPhrase[]) {
    this.biasPhrases = normalizeLiveSttBiasPhrases(phrases);
    if (!this.recognition) {
      return;
    }

    this.capabilities.keywordBiasing = applyWebSpeechPhrases(
      this.recognition,
      this.biasPhrases,
      this.speechRecognitionGlobal
    );
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
    const recognition = this.recognition;
    this.startedAtMs = null;
    this.activeAudioTrack = null;
    this.resultSubscribers.clear();
    this.errorSubscribers.clear();
    recognition?.abort();
    if (recognition) {
      this.completeStop(recognition);
    }
    this.recognition = null;
  }

  readBiasPhrasesForTest() {
    return this.biasPhrases;
  }

  private handleResult(event: BrowserSpeechRecognitionEvent) {
    if (this.startedAtMs === null) {
      return;
    }

    const elapsedMs = Math.max(this.now() - this.startedAtMs, 0);
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const alternative = result?.[0];
      const text = alternative?.transcript.trim();
      if (!result || !alternative || !text) {
        continue;
      }

      const alternatives = result.isFinal ? collectFinalAlternatives(result) : [];
      this.emitResult({
        text,
        isFinal: result.isFinal,
        timestampMs: [elapsedMs, elapsedMs],
        ...(typeof alternative.confidence === "number"
          ? { confidence: alternative.confidence }
          : {}),
        ...(alternatives.length > 1 ? { alternatives } : {})
      });
    }
  }

  private async ensureLocalLanguagePack(lang: string) {
    const Recognition = this.recognitionConstructor;
    const available = Recognition?.available;
    if (!Recognition || !available) {
      throw new LiveSttError(
        "unsupported_runtime",
        "이 브라우저는 온디바이스 Web Speech 언어팩 확인을 지원하지 않습니다."
      );
    }

    const options = {
      langs: [lang],
      ...WEB_SPEECH_ON_DEVICE_POLICY
    } satisfies BrowserSpeechRecognitionAvailabilityOptions;
    const availability = await available(options);
    if (availability === "available") {
      return;
    }
    if (availability !== "unavailable") {
      await this.installLocalLanguagePack(Recognition, available, options, lang);
      return;
    }

    throw new LiveSttError(
      "model_unavailable",
      `${lang} 온디바이스 Web Speech 언어팩을 사용할 수 없습니다.`
    );
  }

  private async installLocalLanguagePack(
    Recognition: BrowserSpeechRecognitionConstructor,
    available: NonNullable<BrowserSpeechRecognitionConstructor["available"]>,
    options: BrowserSpeechRecognitionAvailabilityOptions,
    lang: string
  ) {
    if (!Recognition.install) {
      throw new LiveSttError(
        "model_unavailable",
        `${lang} 온디바이스 Web Speech 언어팩 설치 API를 사용할 수 없습니다.`
      );
    }

    const installed = await Recognition.install(options);
    if (!installed) {
      throw new LiveSttError(
        "model_unavailable",
        `${lang} 온디바이스 Web Speech 언어팩 설치에 실패했습니다.`
      );
    }

    const installedAvailability = await available(options);
    if (installedAvailability !== "available") {
      throw new LiveSttError(
        "model_unavailable",
        `${lang} 온디바이스 Web Speech 언어팩 설치가 아직 완료되지 않았습니다. 잠시 후 다시 시도해주세요.`
      );
    }
  }

  private handleError(event: BrowserSpeechRecognitionErrorEvent) {
    if (shouldStopAfterWebSpeechError(event.error)) {
      const recognition = this.recognition;
      if (recognition && this.pendingStop?.recognition === recognition) {
        this.completeStop(recognition);
      } else {
        this.startedAtMs = null;
        this.recognition = null;
        this.activeAudioTrack = null;
      }
    }

    this.emitError(
      new LiveSttError(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "permission_denied"
          : "runtime_error",
        event.message || `Web Speech 인식 오류: ${event.error ?? "unknown"}`
      )
    );
  }

  private handleEnd(recognition: BrowserSpeechRecognition) {
    if (this.pendingStop?.recognition === recognition) {
      this.completeStop(recognition);
      return;
    }

    if (this.recognition !== recognition || this.startedAtMs === null) {
      return;
    }

    try {
      recognition.lang = this.activeLang;
      if (this.processLocally) {
        recognition.processLocally = true;
      }
      startRecognitionWithAudioTrack(recognition, this.activeAudioTrack);
    } catch (error) {
      this.startedAtMs = null;
      this.recognition = null;
      this.activeAudioTrack = null;
      this.emitError(
        new LiveSttError(
          "start_failed",
          error instanceof Error ? error.message : "Web Speech 인식을 재시작하지 못했습니다."
        )
      );
    }
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

  private completeStop(recognition: BrowserSpeechRecognition) {
    const pendingStop = this.pendingStop;
    if (!pendingStop || pendingStop.recognition !== recognition) {
      return;
    }

    this.startedAtMs = null;
    this.activeAudioTrack = null;
    if (this.recognition === recognition) {
      this.recognition = null;
    }
    this.pendingStop = null;
    pendingStop.resolve();
  }
}

function getDefaultBrowserSpeechRecognitionConstructor() {
  if (typeof window === "undefined") {
    return null;
  }

  return getBrowserSpeechRecognitionConstructor();
}

function collectFinalAlternatives(result: BrowserSpeechRecognitionResult): LiveSttAlternative[] {
  const alternatives: LiveSttAlternative[] = [];
  for (let index = 0; index < result.length; index += 1) {
    const alternative = result[index];
    const text = alternative?.transcript.trim();
    if (!alternative || !text) {
      continue;
    }

    alternatives.push({
      text,
      ...(typeof alternative.confidence === "number" ? { confidence: alternative.confidence } : {})
    });
  }

  return alternatives;
}

function getDefaultBrowserSpeechRecognitionGlobal(): BrowserSpeechRecognitionGlobal {
  if (typeof window === "undefined") {
    return globalThis as BrowserSpeechRecognitionGlobal;
  }

  return window;
}

function shouldStopAfterWebSpeechError(error: string | undefined) {
  return (
    error === "audio-capture" ||
    error === "language-not-supported" ||
    error === "network" ||
    error === "not-allowed" ||
    error === "service-not-allowed"
  );
}
