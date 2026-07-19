import { beforeEach, describe, expect, it } from "vitest";
import { runLiveSttPortContractTests } from "./liveSttPortContract";
import type {
  BrowserSpeechRecognition,
  BrowserSpeechRecognitionAvailability,
  BrowserSpeechRecognitionAvailabilityOptions,
  BrowserSpeechRecognitionGlobal
} from "./browserSpeechRecognition";
import type { LiveSttResult } from "./liveSttPort";
import {
  WEB_SPEECH_ON_DEVICE_POLICY,
  WebSpeechLiveSttPort
} from "./webSpeechLiveSttPort";

runLiveSttPortContractTests("WebSpeech", () => {
  const recognition = new FakeSpeechRecognition({ phrases: [] });
  const port = new WebSpeechLiveSttPort({
    consentGranted: true,
    createRecognition: () => recognition,
    recognitionConstructor: FakeSpeechRecognition,
    speechRecognitionGlobal: fakeSpeechRecognitionGlobal,
    now: () => 1000
  });

  return {
    port,
    audioSource: fakeMediaStream(),
    emitResult: (result) => recognition.emitResult(result),
    emitError: (error) => recognition.emitError(error.message),
    readBiasPhrases: () => port.readBiasPhrasesForTest()
  };
});

describe("WebSpeechLiveSttPort", () => {
  beforeEach(() => {
    FakeSpeechRecognition.reset();
  });

  it("원격 Web Speech 모드는 동의 없이 시작하면 consent_required 오류를 던진다", async () => {
    const port = new WebSpeechLiveSttPort({
      consentGranted: false,
      createRecognition: () => new FakeSpeechRecognition(),
      processLocally: false,
      now: () => 1000
    });

    await expect(
      port.start({ language: "ko", audioSource: fakeMediaStream() })
    ).rejects.toMatchObject({
      code: "consent_required"
    });
  });

  it("브라우저 API가 없으면 unsupported_runtime 오류를 던진다", async () => {
    const port = new WebSpeechLiveSttPort({
      consentGranted: true,
      createRecognition: null,
      now: () => 1000
    });

    await expect(
      port.start({ language: "ko", audioSource: fakeMediaStream() })
    ).rejects.toMatchObject({
      code: "unsupported_runtime"
    });
  });

  it("Korean on-device continuous interim recognition 설정으로 시작한다", async () => {
    const recognition = new FakeSpeechRecognition({ phrases: [] });
    const port = new WebSpeechLiveSttPort({
      createRecognition: () => recognition,
      recognitionConstructor: FakeSpeechRecognition,
      speechRecognitionGlobal: fakeSpeechRecognitionGlobal,
      now: () => 1000
    });

    await port.start({ language: "ko", audioSource: fakeMediaStream() });

    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    expect(recognition.lang).toBe("ko-KR");
    expect(recognition.maxAlternatives).toBe(3);
    expect(recognition.processLocally).toBe(true);
    expect(recognition.startCount).toBe(1);
    expect(recognition.startCalls).toEqual([undefined]);
    expect(port.capabilities.onDevice).toBe(true);
    expect(port.capabilities.keywordBiasing).toBe(true);
    expect(FakeSpeechRecognition.availableCalls).toEqual([
      { langs: ["ko-KR"], processLocally: true, quality: "command" }
    ]);
    expect(FakeSpeechRecognition.installCalls).toEqual([]);
  });

  it("온디바이스 인식은 Chrome의 기본 마이크 경로로 시작한다", async () => {
    const recognition = new FakeSpeechRecognition();
    const audioTrack = fakeMediaStreamTrack("audio", "live");
    const port = new WebSpeechLiveSttPort({
      createRecognition: () => recognition,
      recognitionConstructor: FakeSpeechRecognition,
      now: () => 1000
    });

    await port.start({
      language: "ko",
      audioSource: fakeMediaStream([audioTrack])
    });

    expect(recognition.startCalls).toEqual([undefined]);
  });

  it("명시적 원격 모드에서는 config.audioSource의 live audio track을 사용한다", async () => {
    const recognition = new FakeSpeechRecognition();
    const audioTrack = fakeMediaStreamTrack("audio", "live");
    const port = new WebSpeechLiveSttPort({
      consentGranted: true,
      createRecognition: () => recognition,
      processLocally: false,
      now: () => 1000
    });

    await port.start({
      language: "ko",
      audioSource: fakeMediaStream([audioTrack])
    });

    expect(recognition.startCalls).toEqual([audioTrack]);
  });

  it("브라우저가 Web Speech 세션을 끝내면 같은 ko-KR track으로 재시작한다", async () => {
    const recognition = new FakeSpeechRecognition();
    const audioTrack = fakeMediaStreamTrack("audio", "live");
    const port = new WebSpeechLiveSttPort({
      createRecognition: () => recognition,
      recognitionConstructor: FakeSpeechRecognition,
      now: () => 1000
    });

    await port.start({
      language: "ko",
      audioSource: fakeMediaStream([audioTrack])
    });
    recognition.lang = "en-US";
    recognition.processLocally = false;
    recognition.emitEnd();

    expect(recognition.lang).toBe("ko-KR");
    expect(recognition.processLocally).toBe(true);
    expect(recognition.startCalls).toEqual([undefined, undefined]);
  });

  it("명시적으로 stop하면 Web Speech 세션을 재시작하지 않는다", async () => {
    const recognition = new FakeSpeechRecognition();
    const port = new WebSpeechLiveSttPort({
      createRecognition: () => recognition,
      recognitionConstructor: FakeSpeechRecognition,
      now: () => 1000
    });

    await port.start({ language: "ko", audioSource: fakeMediaStream() });
    await port.stop();

    expect(recognition.stopCount).toBe(1);
    expect(recognition.startCount).toBe(1);
  });

  it("stop 중 도착한 마지막 final 결과를 방출한 뒤 종료한다", async () => {
    const recognition = new FakeSpeechRecognition();
    recognition.endOnStop = false;
    const port = new WebSpeechLiveSttPort({
      createRecognition: () => recognition,
      recognitionConstructor: FakeSpeechRecognition,
      now: () => 1000
    });
    const results: LiveSttResult[] = [];
    port.onResult((result) => results.push(result));

    await port.start({ language: "ko", audioSource: fakeMediaStream() });
    const stopPromise = port.stop();
    let stopCompleted = false;
    void stopPromise.then(() => {
      stopCompleted = true;
    });
    await Promise.resolve();

    expect(stopCompleted).toBe(false);

    recognition.emitResult({ text: "음 어", isFinal: true });
    recognition.emitEnd();
    await stopPromise;

    expect(results).toEqual([
      {
        text: "음 어",
        isFinal: true,
        timestampMs: [0, 0]
      }
    ]);
    expect(stopCompleted).toBe(true);
    expect(recognition.startCount).toBe(1);
  });

  it("fatal Web Speech 오류 후에는 onend가 와도 재시작하지 않는다", async () => {
    const recognition = new FakeSpeechRecognition();
    const port = new WebSpeechLiveSttPort({
      createRecognition: () => recognition,
      recognitionConstructor: FakeSpeechRecognition,
      now: () => 1000
    });
    const errors: string[] = [];
    port.onError((error) => errors.push(error.message));

    await port.start({ language: "ko", audioSource: fakeMediaStream() });
    recognition.emitError("network", "");
    recognition.emitEnd();

    expect(errors).toEqual(["Web Speech 인식 오류: network"]);
    expect(recognition.startCount).toBe(1);
  });

  it("권한 거부를 permission_denied 코드로 구분한다", async () => {
    const recognition = new FakeSpeechRecognition();
    const port = new WebSpeechLiveSttPort({
      createRecognition: () => recognition,
      recognitionConstructor: FakeSpeechRecognition,
      now: () => 1000
    });
    const codes: string[] = [];
    port.onError((error) => codes.push(error.code));

    await port.start({ language: "ko", audioSource: fakeMediaStream() });
    recognition.emitError("not-allowed", "permission denied");

    expect(codes).toEqual(["permission_denied"]);
  });

  it("final result에는 alternatives를 방출하고 interim result에는 생략한다", async () => {
    const recognition = new FakeSpeechRecognition();
    const port = new WebSpeechLiveSttPort({
      createRecognition: () => recognition,
      recognitionConstructor: FakeSpeechRecognition,
      now: () => 1000
    });
    const results: LiveSttResult[] = [];
    port.onResult((result) => results.push(result));

    await port.start({ language: "ko", audioSource: fakeMediaStream() });
    recognition.emitResult({
      text: "중간",
      isFinal: false,
      alternatives: [
        { text: "중간", confidence: 0.4 },
        { text: "중안", confidence: 0.2 }
      ]
    });
    recognition.emitResult({
      text: "결재 승인",
      isFinal: true,
      alternatives: [
        { text: "결재 승인", confidence: 0.8 },
        { text: "결제 승인", confidence: 0.6 }
      ]
    });

    expect(results[0]).toEqual({
      text: "중간",
      isFinal: false,
      timestampMs: [0, 0],
      confidence: 0.4
    });
    expect(results[1]).toEqual({
      text: "결재 승인",
      isFinal: true,
      timestampMs: [0, 0],
      confidence: 0.8,
      alternatives: [
        { text: "결재 승인", confidence: 0.8 },
        { text: "결제 승인", confidence: 0.6 }
      ]
    });
  });

  it("start와 updateBiasPhrases에서 Web Speech phrases를 적용한다", async () => {
    const recognition = new FakeSpeechRecognition({ phrases: [] });
    const port = new WebSpeechLiveSttPort({
      createRecognition: () => recognition,
      recognitionConstructor: FakeSpeechRecognition,
      speechRecognitionGlobal: fakeSpeechRecognitionGlobal,
      now: () => 1000
    });

    port.updateBiasPhrases([{ text: "시작 전", weight: 0.5 }]);
    await port.start({
      language: "ko",
      audioSource: fakeMediaStream(),
      biasPhrases: [{ text: "오르빗", weight: 1 }]
    });

    expect(recognition.phrases).toEqual([new FakeSpeechRecognitionPhrase("오르빗", 5)]);

    port.updateBiasPhrases([{ text: "결재", weight: 0.45 }]);

    expect(recognition.phrases).toEqual([new FakeSpeechRecognitionPhrase("결재", 2.8)]);
    expect(port.readBiasPhrasesForTest()).toEqual([{ text: "결재", weight: 0.45 }]);
  });

  it("phrases 미지원 환경에서는 no-op으로 시작한다", async () => {
    const recognition = new FakeSpeechRecognition();
    const port = new WebSpeechLiveSttPort({
      createRecognition: () => recognition,
      recognitionConstructor: FakeSpeechRecognition,
      speechRecognitionGlobal: fakeSpeechRecognitionGlobal,
      now: () => 1000
    });

    await port.start({
      language: "ko",
      audioSource: fakeMediaStream(),
      biasPhrases: [{ text: "오르빗", weight: 1 }]
    });

    expect(recognition.startCount).toBe(1);
    expect(port.capabilities.keywordBiasing).toBe(false);
  });

  it("온디바이스 언어팩이 downloadable이면 설치 후 시작한다", async () => {
    const recognition = new FakeSpeechRecognition();
    FakeSpeechRecognition.availableResult = "downloadable";
    FakeSpeechRecognition.installResult = true;
    const port = new WebSpeechLiveSttPort({
      createRecognition: () => recognition,
      recognitionConstructor: FakeSpeechRecognition,
      now: () => 1000
    });

    await port.start({ language: "ko", audioSource: fakeMediaStream() });

    expect(recognition.startCount).toBe(1);
    expect(FakeSpeechRecognition.installCalls).toEqual([
      { langs: ["ko-KR"], processLocally: true, quality: "command" }
    ]);
    expect(FakeSpeechRecognition.availableCalls).toEqual([
      { langs: ["ko-KR"], processLocally: true, quality: "command" },
      { langs: ["ko-KR"], processLocally: true, quality: "command" }
    ]);
  });

  it("온디바이스 정책을 command로 고정하고 런타임 변경을 막는다", () => {
    expect(WEB_SPEECH_ON_DEVICE_POLICY).toEqual({
      processLocally: true,
      quality: "command"
    });
    expect(Object.isFrozen(WEB_SPEECH_ON_DEVICE_POLICY)).toBe(true);
  });

  it("processLocally를 지원하지 않으면 unsupported_runtime 오류를 던진다", async () => {
    const recognition = new FakeSpeechRecognition();
    delete (recognition as Partial<BrowserSpeechRecognition>).processLocally;
    const port = new WebSpeechLiveSttPort({
      createRecognition: () => recognition,
      recognitionConstructor: FakeSpeechRecognition,
      now: () => 1000
    });

    await expect(
      port.start({ language: "ko", audioSource: fakeMediaStream() })
    ).rejects.toMatchObject({
      code: "unsupported_runtime"
    });
    expect(recognition.startCount).toBe(0);
  });

  it("온디바이스 언어팩을 사용할 수 없으면 model_unavailable 오류를 던진다", async () => {
    FakeSpeechRecognition.availableResult = "unavailable";
    const port = new WebSpeechLiveSttPort({
      createRecognition: () => new FakeSpeechRecognition(),
      recognitionConstructor: FakeSpeechRecognition,
      now: () => 1000
    });

    await expect(
      port.start({ language: "ko", audioSource: fakeMediaStream() })
    ).rejects.toMatchObject({
      code: "model_unavailable"
    });
  });

  it("registry에서 Web Speech 엔진을 생성한다", async () => {
    const { createLiveSttPort } = await import("./liveSttEngineRegistry");
    const { RerankingLiveSttPort } = await import("./rerankingLiveSttPort");

    expect(createLiveSttPort("web-speech")).toBeInstanceOf(RerankingLiveSttPort);
  });
});

class FakeSpeechRecognition {
  static availableResult: BrowserSpeechRecognitionAvailability = "available";
  static installResult = true;
  static availableCalls: BrowserSpeechRecognitionAvailabilityOptions[] = [];
  static installCalls: BrowserSpeechRecognitionAvailabilityOptions[] = [];

  static reset() {
    FakeSpeechRecognition.availableResult = "available";
    FakeSpeechRecognition.installResult = true;
    FakeSpeechRecognition.availableCalls = [];
    FakeSpeechRecognition.installCalls = [];
  }

  static async available(options: BrowserSpeechRecognitionAvailabilityOptions) {
    FakeSpeechRecognition.availableCalls.push(options);
    return FakeSpeechRecognition.availableResult;
  }

  static async install(options: BrowserSpeechRecognitionAvailabilityOptions) {
    FakeSpeechRecognition.installCalls.push(options);
    if (FakeSpeechRecognition.installResult) {
      FakeSpeechRecognition.availableResult = "available";
    }
    return FakeSpeechRecognition.installResult;
  }

  declare phrases?: FakeSpeechRecognitionPhrase[];
  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 0;
  processLocally = false;
  onresult: BrowserSpeechRecognition["onresult"] = null;
  onerror: BrowserSpeechRecognition["onerror"] = null;
  onend: BrowserSpeechRecognition["onend"] = null;
  startCount = 0;
  startCalls: Array<MediaStreamTrack | undefined> = [];
  stopCount = 0;
  abortCount = 0;
  endOnStop = true;

  constructor(options: { phrases?: FakeSpeechRecognitionPhrase[] } = {}) {
    if (options.phrases) {
      this.phrases = options.phrases;
    }
  }

  start(audioTrack?: MediaStreamTrack) {
    this.startCount += 1;
    this.startCalls.push(audioTrack);
  }

  stop() {
    this.stopCount += 1;
    if (this.endOnStop) {
      this.onend?.();
    }
  }

  abort() {
    this.abortCount += 1;
  }

  emitResult(result: {
    text: string;
    isFinal?: boolean;
    confidence?: number;
    alternatives?: Array<{ text: string; confidence?: number }>;
  }) {
    const alternatives = result.alternatives ?? [
      { text: result.text, confidence: result.confidence }
    ];
    this.onresult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: {
          isFinal: result.isFinal ?? false,
          length: alternatives.length,
          ...Object.fromEntries(
            alternatives.map((alternative, index) => [
              index,
              {
                transcript: alternative.text,
                confidence: alternative.confidence
              }
            ])
          )
        }
      }
    });
  }

  emitError(errorOrMessage: string, message?: string) {
    this.onerror?.({
      error: message === undefined ? "test-error" : errorOrMessage,
      message: message ?? errorOrMessage
    });
  }

  emitEnd() {
    this.onend?.();
  }
}

class FakeSpeechRecognitionPhrase {
  constructor(
    readonly phrase: string,
    readonly boost: number
  ) {}
}

const fakeSpeechRecognitionGlobal: BrowserSpeechRecognitionGlobal = {
  SpeechRecognitionPhrase: FakeSpeechRecognitionPhrase
};

function fakeMediaStream(tracks: MediaStreamTrack[] = []) {
  return {
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
    getTracks: () => tracks
  } as unknown as MediaStream;
}

function fakeMediaStreamTrack(kind: string, readyState: MediaStreamTrackState) {
  return { kind, readyState } as MediaStreamTrack;
}
