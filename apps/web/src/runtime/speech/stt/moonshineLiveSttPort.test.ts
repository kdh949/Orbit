import { describe, expect, it, vi } from "vitest";
import { runLiveSttPortContractTests } from "./liveSttPortContract";
import {
  MoonshineLiveSttPort,
  type MoonshineRuntime,
} from "./moonshineLiveSttPort";

runLiveSttPortContractTests("Moonshine", () => {
  const runtime = new FakeMoonshineRuntime();
  const port = new MoonshineLiveSttPort({
    fetcher: vi.fn(async () =>
      jsonResponse(manifestFixture()),
    ) as unknown as typeof fetch,
    createRuntime: () => runtime,
    now: () => 1000,
  });

  return {
    port,
    audioSource: fakeMediaStream(),
    emitResult: (result) => runtime.emitResult(result),
    emitError: (error) => runtime.emitError(error),
    readBiasPhrases: () => port.readBiasPhrasesForTest(),
  };
});

describe("MoonshineLiveSttPort", () => {
  it("capabilities가 로컬 non-streaming 엔진을 선언한다", () => {
    const port = new MoonshineLiveSttPort();

    expect(port.capabilities).toEqual({
      onDevice: true,
      streaming: false,
      keywordBiasing: false,
      languages: ["ko"],
    });
  });

  it("manifest가 없으면 model_unavailable 오류를 던진다", async () => {
    const port = new MoonshineLiveSttPort({
      fetcher: vi.fn(async () => ({
        ok: false,
        status: 404,
      })) as unknown as typeof fetch,
      now: () => 1000,
    });

    await expect(
      port.start({ language: "ko", audioSource: fakeMediaStream() }),
    ).rejects.toMatchObject({
      code: "model_unavailable",
    });
  });
});

class FakeMoonshineRuntime implements MoonshineRuntime {
  onResult:
    | ((result: {
        text: string;
        isFinal?: boolean;
        confidence?: number;
      }) => void)
    | null = null;
  onError: ((error: Error) => void) | null = null;

  async start(config: Parameters<MoonshineRuntime["start"]>[0]) {
    this.onResult = config.onResult;
    this.onError = config.onError;
  }

  stop() {}

  dispose() {}

  emitResult(result: { text: string; isFinal?: boolean; confidence?: number }) {
    this.onResult?.({
      text: result.text,
      isFinal: result.isFinal,
      confidence: result.confidence,
    });
  }

  emitError(error: Error) {
    this.onError?.(error);
  }
}

function manifestFixture() {
  return {
    provider: "moonshine",
    modelId: "moonshine-korean-local",
    version: "2026-07-03",
    baseUrl: ".",
    sampleRate: 16000,
    language: "ko",
    runtime: {
      worker: "moonshine-worker.js",
    },
    model: {
      model: "moonshine.onnx",
    },
  };
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function fakeMediaStream() {
  return { getTracks: () => [] } as unknown as MediaStream;
}
