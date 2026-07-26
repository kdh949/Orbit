import type {
  BrowserSemanticCueNliDevice,
  BrowserSemanticCueNliWorkerRequest,
  BrowserSemanticCueNliWorkerResponse
} from "./browserSemanticCueNliWorkerProtocol";
import { resolveBrowserSemanticCueNliWorkerUrl } from "./browserSemanticCueNliWorkerAsset";
import type {
  SemanticCueNliDecision,
  SemanticCueNliProvider,
  SemanticCueNliProviderInfo
} from "./semanticCueNliProvider";
import { SemanticCueNliProviderError } from "./semanticCueNliProvider";

type BrowserSemanticCueNliWorker = Pick<
  Worker,
  "postMessage" | "terminate" | "onmessage" | "onerror"
>;

export type BrowserSemanticCueNliProviderOptions = {
  modelId: string;
  createWorker?: () => BrowserSemanticCueNliWorker;
  loadTimeoutMs?: number;
  inferenceTimeoutMs?: number;
  loadOnEvaluate?: boolean;
  deviceOverride?: BrowserSemanticCueNliDevice;
  now?: () => number;
  globalScope?: Pick<typeof globalThis, "Worker" | "navigator">;
};

export function createBrowserTransformersSemanticCueNliProvider(
  options: BrowserSemanticCueNliProviderOptions
): SemanticCueNliProvider & { dispose: () => void } {
  const now = options.now ?? (() => Date.now());
  const loadTimeoutMs = options.loadTimeoutMs ?? 45_000;
  const inferenceTimeoutMs = options.inferenceTimeoutMs ?? 15_000;
  const scope = options.globalScope ?? globalThis;
  let worker: BrowserSemanticCueNliWorker | null = null;
  let loadPromise: Promise<SemanticCueNliProviderInfo> | null = null;
  let lastInfo: SemanticCueNliProviderInfo | null = null;
  let requestSequence = 0;
  let latestJobId = 0;
  const pendingRequests = new Map<
    string,
    {
      resolve: (response: BrowserSemanticCueNliWorkerResponse) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
    }
  >();

  return {
    async load() {
      const capability = getBrowserSemanticCueNliCapability(scope);
      if (!capability.enabled) {
        lastInfo = {
          provider: "browser-transformersjs",
          status: "disabled-low-capability",
          modelId: options.modelId,
          error: capability.reason
        };
        return lastInfo;
      }

      loadPromise ??= requestWorker(
        getOrCreateWorker(),
        {
          type: "load",
          requestId: nextRequestId(),
          modelId: options.modelId,
          device: options.deviceOverride ?? capability.device,
          dtype: "fp32"
        },
        loadTimeoutMs,
        pendingRequests
      ).then((response) => {
        if (response.type !== "loaded") {
          throw new Error(readWorkerError(response));
        }

        return {
          provider: "browser-transformersjs",
          status: "ready",
          modelId: response.modelId,
          loadedAtMs: response.loadedAtMs,
          device: response.device,
          dtype: response.dtype,
          labelMapping: response.labelMapping
        };
      });

      try {
        lastInfo = await loadPromise;
        return lastInfo;
      } catch (error) {
        loadPromise = null;
        lastInfo = {
          provider: "browser-transformersjs",
          status: "failed",
          modelId: options.modelId,
          error: error instanceof Error ? error.message : String(error)
        };
        return lastInfo;
      }
    },

    async evaluate(input) {
      const info = options.loadOnEvaluate === false ? lastInfo : await this.load();
      if (!info) {
        const capability = getBrowserSemanticCueNliCapability(scope);
        if (!capability.enabled) {
          throw new SemanticCueNliProviderError(
            "provider_unavailable",
            `Semantic cue NLI is unavailable: ${capability.reason}.`
          );
        }
        throw new SemanticCueNliProviderError(
          "model_not_ready",
          "Semantic cue NLI model is not prewarmed."
        );
      }
      if (info.status !== "ready") {
        throw new SemanticCueNliProviderError(
          info.status === "failed" ? "model_load_failed" : "provider_unavailable",
          info.status === "failed"
            ? "Semantic cue NLI model failed to load."
            : "Semantic cue NLI is unavailable on this device."
        );
      }

      const jobId = ++latestJobId;
      let response: BrowserSemanticCueNliWorkerResponse;
      try {
        response = await requestWorker(
          getOrCreateWorker(),
          {
            type: "infer",
            requestId: nextRequestId(),
            jobId,
            premise: input.premise,
            hypotheses: input.hypotheses
          },
          inferenceTimeoutMs,
          pendingRequests,
          input.signal
        );
      } catch (error) {
        if (error instanceof BrowserSemanticCueNliTimeoutError) {
          throw new SemanticCueNliProviderError("timeout", "Semantic cue NLI inference timed out.");
        }
        throw error;
      }

      if (response.type !== "result" || response.jobId !== latestJobId) {
        return [];
      }

      return response.decisions.map(
        (decision): SemanticCueNliDecision => ({
          ...decision,
          provider: "browser-transformersjs",
          modelId: info.modelId
        })
      );
    },

    dispose() {
      if (worker) {
        worker.postMessage({
          type: "dispose"
        } satisfies BrowserSemanticCueNliWorkerRequest);
        worker.terminate();
        worker = null;
      }
      rejectPendingRequests(pendingRequests, "Semantic cue NLI worker disposed.");
      loadPromise = null;
      lastInfo = null;
    }
  };

  function getOrCreateWorker() {
    if (!worker) {
      worker = options.createWorker?.() ?? createBrowserSemanticCueNliWorker();
      worker.onmessage = (event: MessageEvent<BrowserSemanticCueNliWorkerResponse>) => {
        const pending = pendingRequests.get(event.data.requestId);
        if (!pending) {
          return;
        }

        pending.cleanup();
        if (event.data.type === "error") {
          pending.reject(new Error(event.data.message));
          return;
        }
        pending.resolve(event.data);
      };
      worker.onerror = (event) => {
        rejectPendingRequests(pendingRequests, event.message || "Semantic cue NLI worker failed.");
      };
    }
    return worker;
  }

  function nextRequestId() {
    requestSequence += 1;
    return `semantic-cue-nli-${Math.round(now())}-${requestSequence}`;
  }
}

export function createBrowserSemanticCueNliWorker(): BrowserSemanticCueNliWorker {
  return new Worker(resolveBrowserSemanticCueNliWorkerUrl(), {
    type: "module"
  });
}

export function getBrowserSemanticCueNliCapability(
  scope: Pick<typeof globalThis, "Worker" | "navigator"> = globalThis
): { enabled: true; device: BrowserSemanticCueNliDevice } | { enabled: false; reason: string } {
  if (typeof scope.Worker !== "function") {
    return { enabled: false, reason: "web-worker-unavailable" };
  }

  const navigatorLike = scope.navigator as Navigator & {
    gpu?: unknown;
    deviceMemory?: number;
  };
  if (typeof navigatorLike.deviceMemory === "number" && navigatorLike.deviceMemory <= 2) {
    return { enabled: false, reason: "low-device-memory" };
  }

  return {
    enabled: true,
    device: navigatorLike.gpu ? "webgpu" : "wasm"
  };
}

function requestWorker(
  worker: BrowserSemanticCueNliWorker,
  message: BrowserSemanticCueNliWorkerRequest,
  timeoutMs: number,
  pendingRequests: Map<
    string,
    {
      resolve: (response: BrowserSemanticCueNliWorkerResponse) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
    }
  >,
  signal?: AbortSignal
): Promise<BrowserSemanticCueNliWorkerResponse> {
  return new Promise((resolve, reject) => {
    const requestId = "requestId" in message ? message.requestId : "";
    const timeoutId = globalThis.setTimeout(() => {
      cleanup();
      reject(new BrowserSemanticCueNliTimeoutError());
    }, timeoutMs);

    const abortHandler = () => {
      cleanup();
      reject(new DOMException("Semantic cue NLI request aborted.", "AbortError"));
    };

    const cleanup = () => {
      globalThis.clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener("abort", abortHandler);
      }
      pendingRequests.delete(requestId);
    };

    if (signal?.aborted) {
      abortHandler();
      return;
    }
    signal?.addEventListener("abort", abortHandler, { once: true });
    pendingRequests.set(requestId, { resolve, reject, cleanup });
    worker.postMessage(message);
  });
}

class BrowserSemanticCueNliTimeoutError extends Error {
  constructor() {
    super("Semantic cue NLI worker timed out.");
  }
}

function rejectPendingRequests(
  pendingRequests: Map<
    string,
    {
      reject: (error: Error) => void;
      cleanup: () => void;
    }
  >,
  message: string
) {
  for (const pending of pendingRequests.values()) {
    pending.cleanup();
    pending.reject(new Error(message));
  }
  pendingRequests.clear();
}

function readWorkerError(response: BrowserSemanticCueNliWorkerResponse) {
  return response.type === "error"
    ? response.message
    : "Semantic cue NLI worker returned an unexpected response.";
}
