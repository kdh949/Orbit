import type { LiveSttPartialTranscriptEvent } from "@orbit/shared";
import { describe, expect, it, vi } from "vitest";
import {
  LiveSttAdapterError,
  type LiveSttAdapter,
  type LiveSttBiasContext,
  type LiveSttCallbacks,
  type LiveSttStartOptions
} from "../liveStt";
import { LiveSttError } from "../../../runtime/speech/stt/liveSttPort";
import { runLiveSttPortContractTests } from "./liveSttPortContract";
import { SherpaLiveSttPort } from "./sherpaLiveSttPort";

runLiveSttPortContractTests("Sherpa", () => {
  const adapter = new FakeLegacyAdapter();

  return {
    port: new SherpaLiveSttPort({ adapter, now: () => 1000 }),
    audioSource: fakeMediaStream(),
    emitResult: (result) => adapter.emitTranscript(result),
    emitError: (error) => adapter.emitError(error),
    readBiasPhrases: () => adapter.latestBiasPhrases(),
    expectedBiasPhrasesAfterUpdate: [
      {
        text: "두 번째",
        weight: 0.8,
        source: "synonym",
        keywordId: "kw_second",
        canonicalText: "둘째"
      },
      {
        text: "세 번째",
        weight: 1,
        source: "control-phrase",
        canonicalText: "세 번째"
      }
    ]
  };
});

describe("SherpaLiveSttPort", () => {
  it("기존 Sherpa adapter error를 LiveSttError 코드로 변환한다", async () => {
    const adapter = new FakeLegacyAdapter({
      startError: new LiveSttAdapterError(
        "LIVE_STT_MODEL_UNAVAILABLE",
        "모델을 찾을 수 없습니다"
      )
    });
    const port = new SherpaLiveSttPort({ adapter, now: () => 1000 });

    await expect(
      port.start({ language: "ko", audioSource: fakeMediaStream() })
    ).rejects.toMatchObject({
      code: "model_unavailable",
      message: "모델을 찾을 수 없습니다"
    });
  });

  it("capabilities가 온디바이스 streaming keyword biasing을 선언한다", () => {
    const port = new SherpaLiveSttPort({
      adapter: new FakeLegacyAdapter(),
      now: () => 1000
    });

    expect(port.capabilities).toEqual({
      onDevice: true,
      streaming: true,
      keywordBiasing: true,
      languages: ["ko"]
    });
  });

  it("기존 Sherpa adapter에 진단 콜백과 decoding method를 전달한다", async () => {
    const adapter = new FakeLegacyAdapter();
    const onAudioLevel = vi.fn();
    const onDebugPcmAvailable = vi.fn();
    const port = new SherpaLiveSttPort({
      adapter,
      now: () => 1000,
      onAudioLevel,
      onDebugPcmAvailable,
      getDecodingMethod: () => "modified_beam_search"
    });

    await port.start({ language: "ko", audioSource: fakeMediaStream() });

    expect(adapter.callbacks?.onAudioLevel).toBe(onAudioLevel);
    expect(adapter.callbacks?.onDebugPcmAvailable).toBe(onDebugPcmAvailable);
    expect(adapter.startOptions?.decodingMethod).toBe("modified_beam_search");
  });
});

class FakeLegacyAdapter implements LiveSttAdapter {
  callbacks: LiveSttCallbacks | null = null;
  startOptions: LiveSttStartOptions | null = null;
  biasContexts: Array<LiveSttBiasContext | null> = [];
  stopCount = 0;
  disposeCount = 0;

  constructor(private readonly options: { startError?: Error } = {}) {}

  async start(
    _stream: MediaStream,
    callbacks: LiveSttCallbacks,
    options?: LiveSttStartOptions
  ) {
    if (this.options.startError) {
      throw this.options.startError;
    }

    this.callbacks = callbacks;
    this.startOptions = options ?? null;
    this.biasContexts.push(options?.biasContext ?? null);
  }

  updateBiasContext(biasContext: LiveSttBiasContext | null) {
    this.biasContexts.push(biasContext);
  }

  stop() {
    this.stopCount += 1;
  }

  dispose() {
    this.disposeCount += 1;
  }

  emitTranscript(result: { text: string; isFinal?: boolean; confidence?: number }) {
    const event: LiveSttPartialTranscriptEvent = {
      type: "partial-transcript",
      transcript: result.text,
      isFinal: result.isFinal ?? false,
      confidence: result.confidence ?? null
    };
    this.callbacks?.onPartialTranscript(event);
  }

  emitError(error: LiveSttError) {
    this.callbacks?.onError(
      new LiveSttAdapterError("LIVE_STT_START_FAILED", error.message)
    );
  }

  latestBiasPhrases() {
    const latest = this.biasContexts[this.biasContexts.length - 1];
    return (
      latest?.terms.map((term) => ({
        text: term.text,
        weight: term.weight,
        source: term.source,
        ...(term.keywordId === undefined ? {} : { keywordId: term.keywordId }),
        ...(term.canonicalText === undefined
          ? {}
          : { canonicalText: term.canonicalText })
      })) ?? []
    );
  }
}

function fakeMediaStream() {
  return { getTracks: () => [] } as unknown as MediaStream;
}
