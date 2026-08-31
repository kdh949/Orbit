import {
  DeterministicImageProvider,
  OpenAiGeneratedImageProvider,
  OfficialWebImageProvider,
  OpenversePublicImageSearchProvider,
} from "@orbit/ai";
import type { OrbitConfig } from "@orbit/config";
import type { ImageAssetRuntime } from "./image-asset-pipeline";

export function createImageAssetRuntime(
  config: OrbitConfig,
): ImageAssetRuntime {
  if (config.LOAD_TEST_PROVIDER_MODE === "deterministic") {
    const deterministic = new DeterministicImageProvider({
      seed: config.LOAD_TEST_PROVIDER_SEED,
      delayMs: config.LOAD_TEST_PROVIDER_DELAY_MS,
      errorRatePercent: config.LOAD_TEST_PROVIDER_ERROR_RATE_PERCENT,
    });
    return {
      generated: deterministic,
      official: deterministic,
      publicSearch: deterministic,
      maxPerDeck: config.IMAGE_MAX_PER_DECK,
      maxPerUserPerDay: config.IMAGE_MAX_PER_USER_PER_DAY,
    };
  }
  return {
    generated:
      config.IMAGE_PROVIDER === "openai" && config.OPENAI_API_KEY
        ? new OpenAiGeneratedImageProvider(
            config.OPENAI_API_KEY,
            config.OPENAI_IMAGE_MODEL,
          )
        : undefined,
    official: new OfficialWebImageProvider(),
    publicSearch:
      config.PUBLIC_IMAGE_PROVIDER === "openverse"
        ? new OpenversePublicImageSearchProvider()
        : undefined,
    maxPerDeck: config.IMAGE_MAX_PER_DECK,
    maxPerUserPerDay: config.IMAGE_MAX_PER_USER_PER_DAY,
  };
}
