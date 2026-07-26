import type {
  BrowserSemanticCueNliDevice,
  BrowserSemanticCueNliDtype,
  BrowserSemanticCueNliInferMessage,
  BrowserSemanticCueNliLoadMessage,
  BrowserSemanticCueNliWorkerRequest,
  BrowserSemanticCueNliWorkerResponse
} from "./browserSemanticCueNliWorkerProtocol";
import {
  mapPairwiseNliLogits,
  resolvePairwiseNliLabelMapping,
  type PairwiseNliLabelMapping
} from "./browserSemanticCueNliLogits";

type PairwiseTokenizer = (
  text: string[],
  options: {
    text_pair: string[];
    padding: true;
    truncation: true;
    max_length: number;
  }
) => unknown;

type PairwiseModel = ((inputs: unknown) => Promise<{
  logits: { data: ArrayLike<number>; dims: readonly number[] };
}>) & {
  config: { id2label?: Record<string | number, string> };
};

type PairwiseRuntime = {
  tokenizer: PairwiseTokenizer;
  model: PairwiseModel;
  labelMapping: PairwiseNliLabelMapping;
};

let runtimePromise: Promise<PairwiseRuntime> | null = null;
let loadedModelId: string | null = null;
let loadedDevice: BrowserSemanticCueNliDevice | null = null;
let loadedDtype: BrowserSemanticCueNliDtype | null = null;

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<BrowserSemanticCueNliWorkerRequest>) => void) | null;
  postMessage: (message: BrowserSemanticCueNliWorkerResponse) => void;
  close: () => void;
};

workerScope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "dispose") {
    workerScope.close();
    return;
  }

  if (message.type === "load") {
    void handleLoad(message);
    return;
  }

  void handleInfer(message);
};

async function handleLoad(message: BrowserSemanticCueNliLoadMessage) {
  const startedAt = performance.now();
  try {
    const runtime = await loadPairwiseRuntime(message.modelId, message.device, message.dtype);
    post({
      type: "loaded",
      requestId: message.requestId,
      provider: "browser-transformersjs",
      modelId: message.modelId,
      device: message.device,
      dtype: message.dtype,
      labelMapping: runtime.labelMapping,
      loadedAtMs: Math.round(performance.now() - startedAt)
    });
  } catch (error) {
    postError(message.requestId, error);
  }
}

async function handleInfer(message: BrowserSemanticCueNliInferMessage) {
  const startedAt = performance.now();
  try {
    const runtime = await requirePairwiseRuntime();
    const premises = message.hypotheses.map(() => message.premise);
    const pairedHypotheses = message.hypotheses.map((hypothesis) => hypothesis.hypothesis);
    const inputs = runtime.tokenizer(premises, {
      text_pair: pairedHypotheses,
      padding: true,
      truncation: true,
      max_length: 96
    });
    const output = await runtime.model(inputs);
    const rows = readLogitRows(output.logits, message.hypotheses.length);
    const latencyMs = Math.round(performance.now() - startedAt);

    post({
      type: "result",
      requestId: message.requestId,
      jobId: message.jobId,
      decisions: message.hypotheses.map((hypothesis, index) => {
        const scores = mapPairwiseNliLogits(rows[index]!, runtime.labelMapping);
        return {
          cueId: hypothesis.cueId,
          hypothesis: hypothesis.hypothesis,
          ...scores,
          latencyMs
        };
      })
    });
  } catch (error) {
    postError(message.requestId, error);
  }
}

async function loadPairwiseRuntime(
  modelId: string,
  device: BrowserSemanticCueNliDevice,
  dtype: BrowserSemanticCueNliDtype
): Promise<PairwiseRuntime> {
  if (
    runtimePromise &&
    loadedModelId === modelId &&
    loadedDevice === device &&
    loadedDtype === dtype
  ) {
    return runtimePromise;
  }

  loadedModelId = modelId;
  loadedDevice = device;
  loadedDtype = dtype;
  runtimePromise = import("@huggingface/transformers").then(
    async ({ AutoModelForSequenceClassification, AutoTokenizer, env }) => {
      env.useBrowserCache = true;
      env.allowLocalModels = false;
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(modelId),
        AutoModelForSequenceClassification.from_pretrained(modelId, {
          device,
          dtype
        })
      ]);
      const pairwiseModel = model as unknown as PairwiseModel;
      const id2label = pairwiseModel.config.id2label;
      if (!id2label) {
        throw new Error("Pairwise NLI model config does not define id2label.");
      }
      return {
        tokenizer: tokenizer as unknown as PairwiseTokenizer,
        model: pairwiseModel,
        labelMapping: resolvePairwiseNliLabelMapping(id2label)
      };
    }
  );
  return runtimePromise;
}

async function requirePairwiseRuntime() {
  if (!runtimePromise) {
    throw new Error("Semantic cue NLI model is not loaded.");
  }

  return runtimePromise;
}

function readLogitRows(
  logits: { data: ArrayLike<number>; dims: readonly number[] },
  expectedRows: number
): number[][] {
  const [rowCount, labelCount] = logits.dims;
  if (rowCount !== expectedRows || labelCount !== 3) {
    throw new Error(`Pairwise NLI logits must have shape [${expectedRows}, 3].`);
  }
  if (logits.data.length !== expectedRows * labelCount) {
    throw new Error("Pairwise NLI logits data length does not match its shape.");
  }

  return Array.from({ length: expectedRows }, (_, rowIndex) =>
    Array.from({ length: labelCount }, (_, labelIndex) =>
      Number(logits.data[rowIndex * labelCount + labelIndex])
    )
  );
}

function post(message: BrowserSemanticCueNliWorkerResponse) {
  workerScope.postMessage(message);
}

function postError(requestId: string, error: unknown) {
  post({
    type: "error",
    requestId,
    message: error instanceof Error ? error.message : String(error)
  });
}
