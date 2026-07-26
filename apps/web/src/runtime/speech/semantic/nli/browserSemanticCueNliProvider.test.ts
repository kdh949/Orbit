import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createBrowserTransformersSemanticCueNliProvider,
  getBrowserSemanticCueNliCapability
} from "./browserSemanticCueNliProvider";
import { SemanticCueNliProviderError } from "./semanticCueNliProvider";
import type {
  BrowserSemanticCueNliWorkerRequest,
  BrowserSemanticCueNliWorkerResponse
} from "./browserSemanticCueNliWorkerProtocol";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("getBrowserSemanticCueNliCapability", () => {
  it("selects WebGPU when available and falls back to WASM otherwise", () => {
    expect(
      getBrowserSemanticCueNliCapability({
        Worker: FakeWorker as unknown as typeof Worker,
        navigator: { gpu: {} } as unknown as Navigator
      })
    ).toEqual({ enabled: true, device: "webgpu" });

    expect(
      getBrowserSemanticCueNliCapability({
        Worker: FakeWorker as unknown as typeof Worker,
        navigator: {} as Navigator
      })
    ).toEqual({ enabled: true, device: "wasm" });
  });

  it("disables browser NLI on very low memory devices", () => {
    expect(
      getBrowserSemanticCueNliCapability({
        Worker: FakeWorker as unknown as typeof Worker,
        navigator: { deviceMemory: 2 } as unknown as Navigator
      })
    ).toEqual({ enabled: false, reason: "low-device-memory" });
  });
});

describe("createBrowserTransformersSemanticCueNliProvider", () => {
  it("keeps the default NLI worker outside Vite import-meta worker bundling", async () => {
    const source = await readFile(resolve(currentDir, "browserSemanticCueNliProvider.ts"), "utf8");

    expect(source).not.toContain('new URL("./browserSemanticCueNliWorker.ts", import.meta.url)');
    expect(source).toContain("resolveBrowserSemanticCueNliWorkerUrl");
  });

  it("loads the worker and maps NLI decisions", async () => {
    const worker = new FakeWorker();
    const provider = createBrowserTransformersSemanticCueNliProvider({
      modelId: "MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli",
      createWorker: () => worker,
      globalScope: {
        Worker: FakeWorker as unknown as typeof Worker,
        navigator: { gpu: {} } as unknown as Navigator
      }
    });

    const decisions = await provider.evaluate({
      premise: "문제 정의를 설명했습니다.",
      hypotheses: [{ cueId: "scue_1", hypothesis: "문제 정의를 설명했다" }]
    });

    expect(worker.messages[0]).toMatchObject({
      type: "load",
      device: "webgpu"
    });
    expect(worker.messages[1]).toMatchObject({
      type: "infer",
      premise: "문제 정의를 설명했습니다."
    });
    expect(decisions).toEqual([
      expect.objectContaining({
        cueId: "scue_1",
        provider: "browser-transformersjs",
        modelId: "MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli",
        entailmentScore: 0.82
      })
    ]);
  });

  it("benchmark harness가 WebGPU 장비에서도 WASM backend를 명시적으로 검증할 수 있다", async () => {
    const worker = new FakeWorker();
    const provider = createBrowserTransformersSemanticCueNliProvider({
      modelId: "model",
      deviceOverride: "wasm",
      createWorker: () => worker,
      globalScope: {
        Worker: FakeWorker as unknown as typeof Worker,
        navigator: { gpu: {} } as unknown as Navigator
      }
    });

    await provider.load();

    expect(worker.messages[0]).toMatchObject({
      type: "load",
      device: "wasm",
      dtype: "fp32"
    });
  });

  it("prewarm 전에는 발표 중 cold load하지 않고 model_not_ready를 반환한다", async () => {
    const worker = new FakeWorker();
    const provider = createBrowserTransformersSemanticCueNliProvider({
      modelId: "model",
      loadOnEvaluate: false,
      createWorker: () => worker,
      globalScope: {
        Worker: FakeWorker as unknown as typeof Worker,
        navigator: { gpu: {} } as unknown as Navigator
      }
    });

    await expect(
      provider.evaluate({
        premise: "발표 중 입력",
        hypotheses: [{ cueId: "scue_1", hypothesis: "가설" }]
      })
    ).rejects.toMatchObject({
      name: "SemanticCueNliProviderError",
      reason: "model_not_ready"
    } satisfies Partial<SemanticCueNliProviderError>);
    expect(worker.messages).toEqual([]);

    await expect(provider.load()).resolves.toMatchObject({ status: "ready" });
    await expect(
      provider.evaluate({
        premise: "prewarm 이후 입력",
        hypotheses: [{ cueId: "scue_1", hypothesis: "가설" }]
      })
    ).resolves.toHaveLength(1);
  });

  it("low-memory disable을 provider_unavailable capability reason으로 보존한다", async () => {
    const provider = createBrowserTransformersSemanticCueNliProvider({
      modelId: "model",
      loadOnEvaluate: false,
      createWorker: () => new FakeWorker(),
      globalScope: {
        Worker: FakeWorker as unknown as typeof Worker,
        navigator: { deviceMemory: 2 } as unknown as Navigator
      }
    });

    await expect(provider.load()).resolves.toMatchObject({
      status: "disabled-low-capability",
      error: "low-device-memory"
    });
    await expect(provider.evaluate({ premise: "입력", hypotheses: [] })).rejects.toMatchObject({
      reason: "provider_unavailable"
    });
  });

  it("inference timeout을 구조화된 fallback reason으로 반환한다", async () => {
    const provider = createBrowserTransformersSemanticCueNliProvider({
      modelId: "model",
      inferenceTimeoutMs: 5,
      createWorker: () => new FakeWorker({ skipInferenceResponse: true }),
      globalScope: {
        Worker: FakeWorker as unknown as typeof Worker,
        navigator: {} as Navigator
      }
    });

    await expect(
      provider.evaluate({
        premise: "입력",
        hypotheses: [{ cueId: "scue_1", hypothesis: "가설" }]
      })
    ).rejects.toMatchObject({ reason: "timeout" });
  });

  it("drops stale inference results after a newer job completes", async () => {
    const worker = new FakeWorker({ delayFirstInferenceMs: 10 });
    const provider = createBrowserTransformersSemanticCueNliProvider({
      modelId: "model",
      createWorker: () => worker,
      inferenceTimeoutMs: 100,
      globalScope: {
        Worker: FakeWorker as unknown as typeof Worker,
        navigator: {} as Navigator
      }
    });

    const first = provider.evaluate({
      premise: "첫 발화",
      hypotheses: [{ cueId: "scue_1", hypothesis: "첫 의미" }]
    });
    const second = provider.evaluate({
      premise: "두 번째 발화",
      hypotheses: [{ cueId: "scue_2", hypothesis: "두 번째 의미" }]
    });

    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([expect.objectContaining({ cueId: "scue_2" })]);
  });
});

class FakeWorker {
  onmessage: ((event: MessageEvent<BrowserSemanticCueNliWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: BrowserSemanticCueNliWorkerRequest[] = [];
  private inferenceCount = 0;

  constructor(
    private readonly options: {
      delayFirstInferenceMs?: number;
      skipInferenceResponse?: boolean;
    } = {}
  ) {}

  postMessage(message: BrowserSemanticCueNliWorkerRequest) {
    this.messages.push(message);
    if (message.type === "load") {
      queueMicrotask(() =>
        this.emit({
          type: "loaded",
          requestId: message.requestId,
          provider: "browser-transformersjs",
          modelId: message.modelId,
          device: message.device,
          dtype: message.dtype,
          labelMapping: { entailment: 0, neutral: 1, contradiction: 2 },
          loadedAtMs: 12
        })
      );
      return;
    }

    if (message.type === "infer") {
      if (this.options.skipInferenceResponse) {
        return;
      }
      this.inferenceCount += 1;
      const delay = this.inferenceCount === 1 ? (this.options.delayFirstInferenceMs ?? 0) : 0;
      globalThis.setTimeout(() => {
        const hypothesis = message.hypotheses[0];
        this.emit({
          type: "result",
          requestId: message.requestId,
          jobId: message.jobId,
          decisions: hypothesis
            ? [
                {
                  cueId: hypothesis.cueId,
                  hypothesis: hypothesis.hypothesis,
                  entailmentScore: 0.82,
                  neutralScore: 0.12,
                  contradictionScore: 0.06,
                  latencyMs: 8
                }
              ]
            : []
        });
      }, delay);
    }
  }

  terminate() {
    return undefined;
  }

  private emit(message: BrowserSemanticCueNliWorkerResponse) {
    this.onmessage?.({
      data: message
    } as MessageEvent<BrowserSemanticCueNliWorkerResponse>);
  }
}
