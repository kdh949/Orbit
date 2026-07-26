import type { SemanticCueNliProviderId } from "../nli/semanticCueNliProvider";
import type { BrowserSemanticCueNliDevice } from "../nli/browserSemanticCueNliWorkerProtocol";

export type SemanticCueRuntimeFlags = {
  nliEnabled: boolean;
  nliMode: "off" | "shadow" | "active";
  benchmarkGatePassed: boolean;
  nliDevice: BrowserSemanticCueNliDevice | null;
  provider: SemanticCueNliProviderId | "off";
  modelId: string;
  debugPanelEnabled: boolean;
};

export function getSemanticCueRuntimeFlags(
  env: Record<string, string | boolean | undefined>
): SemanticCueRuntimeFlags {
  const provider = providerFlag(env.VITE_SEMANTIC_CUE_NLI_PROVIDER);
  const requested = booleanFlag(env.VITE_SEMANTIC_CUE_NLI_ENABLED);
  const benchmarkGatePassed = booleanFlag(env.VITE_SEMANTIC_CUE_NLI_BENCHMARK_PASSED);
  const nliDevice = deviceFlag(env.VITE_SEMANTIC_CUE_NLI_BENCHMARK_DEVICE);
  const browserProvider = provider === "browser-transformersjs" || provider === "browser-onnx";
  const nliEnabled =
    requested &&
    provider !== "off" &&
    (!browserProvider || (benchmarkGatePassed && nliDevice !== null));

  return {
    nliEnabled,
    nliMode: nliEnabled ? (browserProvider ? "shadow" : "active") : "off",
    benchmarkGatePassed,
    nliDevice,
    provider,
    modelId:
      stringFlag(env.VITE_SEMANTIC_CUE_NLI_MODEL_ID) ??
      "MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli",
    debugPanelEnabled: booleanFlag(env.VITE_SEMANTIC_CUE_DEBUG_PANEL)
  };
}

export function isSemanticCueNliEnabledForMode(
  flags: SemanticCueRuntimeFlags,
  mode: "rehearsal" | "presentation"
) {
  if (!flags.nliEnabled) {
    return false;
  }
  const browserProvider =
    flags.provider === "browser-transformersjs" || flags.provider === "browser-onnx";
  return !browserProvider || mode === "rehearsal";
}

function deviceFlag(value: string | boolean | undefined): BrowserSemanticCueNliDevice | null {
  return value === "webgpu" || value === "wasm" ? value : null;
}

function booleanFlag(value: string | boolean | undefined) {
  return value === true || value === "true" || value === "1";
}

function stringFlag(value: string | boolean | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function providerFlag(value: string | boolean | undefined): SemanticCueRuntimeFlags["provider"] {
  if (
    value === "mock" ||
    value === "browser-transformersjs" ||
    value === "browser-onnx" ||
    value === "off"
  ) {
    return value;
  }

  return "off";
}
