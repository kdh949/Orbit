import { createBrowserTransformersSemanticCueNliProvider } from "../../../runtime/speech/semantic/nli/browserSemanticCueNliProvider";
import {
  buildSemanticCueNliBenchmarkResult,
  evaluateSemanticCueNliBenchmarkGate,
} from "./semanticCueNliBenchmark";
import type { BrowserSemanticCueNliDevice } from "../../../runtime/speech/semantic/nli/browserSemanticCueNliWorkerProtocol";

const MODEL_ID = "MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli";
const MODEL_BYTES = 428_000_000;
const FIXTURES = [
  { hypothesis: "발표자는 고객 획득 비용을 설명했다", expectedCovered: true },
  {
    hypothesis: "발표자는 서버 장애가 원인이라고 설명했다",
    expectedCovered: false,
  },
  {
    hypothesis: "발표자는 CAC가 초기 영업 비용이라고 설명했다",
    expectedCovered: true,
  },
  {
    hypothesis: "발표자는 마케팅 비용이 전혀 없다고 설명했다",
    expectedCovered: false,
  },
] as const;

const params = new URLSearchParams(window.location.search);
const device = readDevice(params.get("device"));
const loadTimeoutMs = readPositiveNumber(params.get("loadTimeoutMs"), 45_000);
const inferenceTimeoutMs = readPositiveNumber(
  params.get("inferenceTimeoutMs"),
  5_000,
);
const statusElement = document.querySelector<HTMLOutputElement>("#status");
const resultElement = document.querySelector<HTMLPreElement>("#result");

void runBenchmark();

async function runBenchmark() {
  setStatus("running", `${device} 모델을 prewarm하고 있습니다.`);
  const longTasks: number[] = [];
  const observer = createLongTaskObserver(longTasks);
  const memoryBeforeBytes = readHeapBytes();
  const loadStartedAt = performance.now();
  const provider = createBrowserTransformersSemanticCueNliProvider({
    modelId: MODEL_ID,
    deviceOverride: device,
    loadTimeoutMs,
    inferenceTimeoutMs,
    loadOnEvaluate: false,
  });

  try {
    const load = await provider.load();
    if (load.status !== "ready") {
      render({
        status: "load-failed",
        device,
        dtype: "fp32",
        modelId: MODEL_ID,
        modelBytes: MODEL_BYTES,
        coldLoadMs: performance.now() - loadStartedAt,
        memoryBeforeBytes,
        memoryAfterBytes: readHeapBytes(),
        reason: load.error ?? load.status,
      });
      setStatus("failed", `${device} model load gate를 통과하지 못했습니다.`);
      return;
    }

    const warmLatenciesMs: number[] = [];
    let predictedCovered: boolean[] = [];
    for (let sample = 0; sample < 5; sample += 1) {
      const startedAt = performance.now();
      const decisions = await provider.evaluate({
        premise:
          "CAC는 고객 한 명을 얻는 데 필요한 초기 영업 비용이며 마케팅 효율을 보여줍니다.",
        hypotheses: FIXTURES.map((fixture, index) => ({
          cueId: `benchmark_${index}`,
          hypothesis: fixture.hypothesis,
        })),
      });
      warmLatenciesMs.push(performance.now() - startedAt);
      predictedCovered = decisions.map(
        (decision) =>
          decision.entailmentScore >= 0.7 &&
          decision.entailmentScore > decision.neutralScore &&
          decision.entailmentScore > decision.contradictionScore,
      );
    }

    const benchmark = buildSemanticCueNliBenchmarkResult({
      device,
      modelId: MODEL_ID,
      dtype: load.dtype ?? "fp32",
      modelBytes: MODEL_BYTES,
      memoryBeforeBytes,
      memoryAfterBytes: readHeapBytes(),
      coldLoadMs: load.loadedAtMs ?? 0,
      warmLatenciesMs,
      mainThreadLongTasksMs: longTasks,
      expectedCovered: FIXTURES.map((fixture) => fixture.expectedCovered),
      predictedCovered,
      coldLoadsDuringPresentation: 0,
    });
    const gate = evaluateSemanticCueNliBenchmarkGate(benchmark);
    render({ status: "completed", benchmark, gate });
    setStatus(
      gate.passed ? "passed" : "failed",
      gate.passed ? "gate 통과" : "gate 실패",
    );
  } catch (error) {
    render({
      status: "runtime-failed",
      device,
      reason: error instanceof Error ? error.message : String(error),
    });
    setStatus("failed", `${device} benchmark 실행에 실패했습니다.`);
  } finally {
    observer?.disconnect();
    provider.dispose();
  }
}

function createLongTaskObserver(samples: number[]) {
  if (typeof PerformanceObserver !== "function") {
    return null;
  }
  try {
    const observer = new PerformanceObserver((list) => {
      samples.push(...list.getEntries().map((entry) => entry.duration));
    });
    observer.observe({ entryTypes: ["longtask"] });
    return observer;
  } catch {
    return null;
  }
}

function readDevice(value: string | null): BrowserSemanticCueNliDevice {
  return value === "wasm" ? "wasm" : "webgpu";
}

function readPositiveNumber(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readHeapBytes() {
  const memory = performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  };
  return typeof memory.memory?.usedJSHeapSize === "number"
    ? memory.memory.usedJSHeapSize
    : null;
}

function setStatus(state: string, text: string) {
  if (!statusElement) return;
  statusElement.dataset.state = state;
  statusElement.textContent = text;
}

function render(value: unknown) {
  if (resultElement) {
    resultElement.textContent = JSON.stringify(value, null, 2);
  }
}
