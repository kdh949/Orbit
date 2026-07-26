import { describe, expect, it } from "vitest";

import {
  getSemanticCueRuntimeFlags,
  isSemanticCueNliEnabledForMode
} from "./semanticCueFeatureFlags";

describe("getSemanticCueRuntimeFlags", () => {
  it("keeps semantic cue NLI off by default", () => {
    expect(getSemanticCueRuntimeFlags({})).toMatchObject({
      nliEnabled: false,
      provider: "off",
      debugPanelEnabled: false
    });
  });

  it("accepts the mock provider behind an explicit Vite flag", () => {
    expect(
      getSemanticCueRuntimeFlags({
        VITE_SEMANTIC_CUE_NLI_ENABLED: "true",
        VITE_SEMANTIC_CUE_NLI_PROVIDER: "mock",
        VITE_SEMANTIC_CUE_DEBUG_PANEL: "1"
      })
    ).toMatchObject({
      nliEnabled: true,
      nliMode: "active",
      provider: "mock",
      debugPanelEnabled: true
    });
  });

  it("브라우저 provider는 benchmark 승인 시에만 shadow mode로 연다", () => {
    expect(
      getSemanticCueRuntimeFlags({
        VITE_SEMANTIC_CUE_NLI_ENABLED: "true",
        VITE_SEMANTIC_CUE_NLI_PROVIDER: "browser-transformersjs",
        VITE_SEMANTIC_CUE_NLI_BENCHMARK_PASSED: "true"
      })
    ).toMatchObject({
      nliEnabled: false,
      nliMode: "off",
      benchmarkGatePassed: true,
      nliDevice: null
    });

    expect(
      getSemanticCueRuntimeFlags({
        VITE_SEMANTIC_CUE_NLI_ENABLED: "true",
        VITE_SEMANTIC_CUE_NLI_PROVIDER: "browser-transformersjs",
        VITE_SEMANTIC_CUE_NLI_BENCHMARK_PASSED: "true",
        VITE_SEMANTIC_CUE_NLI_BENCHMARK_DEVICE: "wasm"
      })
    ).toMatchObject({
      nliEnabled: true,
      nliMode: "shadow",
      benchmarkGatePassed: true,
      nliDevice: "wasm"
    });
  });

  it("브라우저 NLI shadow는 리허설에서만 실행한다", () => {
    const flags = getSemanticCueRuntimeFlags({
      VITE_SEMANTIC_CUE_NLI_ENABLED: "true",
      VITE_SEMANTIC_CUE_NLI_PROVIDER: "browser-transformersjs",
      VITE_SEMANTIC_CUE_NLI_BENCHMARK_PASSED: "true",
      VITE_SEMANTIC_CUE_NLI_BENCHMARK_DEVICE: "wasm"
    });

    expect(isSemanticCueNliEnabledForMode(flags, "rehearsal")).toBe(true);
    expect(isSemanticCueNliEnabledForMode(flags, "presentation")).toBe(false);
  });
});
