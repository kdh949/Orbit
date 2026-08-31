import { describe, expect, it } from "vitest";

import { createImageAssetRuntime } from "./image-providers";

describe("createImageAssetRuntime", () => {
  it("replaces every external image source in deterministic load-test mode", () => {
    const runtime = createImageAssetRuntime({
      LOAD_TEST_PROVIDER_MODE: "deterministic",
      LOAD_TEST_PROVIDER_SEED: 42,
      LOAD_TEST_PROVIDER_DELAY_MS: 0,
      LOAD_TEST_PROVIDER_ERROR_RATE_PERCENT: 0,
      IMAGE_PROVIDER: "openai",
      OPENAI_API_KEY: "must-not-be-used",
      OPENAI_IMAGE_MODEL: "gpt-image-1",
      PUBLIC_IMAGE_PROVIDER: "openverse",
      IMAGE_MAX_PER_DECK: 3,
      IMAGE_MAX_PER_USER_PER_DAY: 10,
    } as never);

    expect(runtime.generated).toBeDefined();
    expect(runtime.official).toBe(runtime.generated);
    expect(runtime.publicSearch).toBe(runtime.generated);
  });
});
