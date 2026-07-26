import {
  runtimeConfigResponseSchema,
  type RuntimeConfigResponse,
} from "@orbit/shared/config";

import { LiveSttError } from "./liveSttPort";

export type LiveSttRuntimeConfigFetcher = typeof fetch;

export async function fetchLiveSttRuntimeConfig(
  fetcher: LiveSttRuntimeConfigFetcher = defaultFetch,
): Promise<RuntimeConfigResponse> {
  let response: Response;
  try {
    response = await fetcher("/api/v1/runtime-config", {
      credentials: "include",
      method: "GET",
    });
  } catch {
    throw new LiveSttError(
      "start_failed",
      "Live STT runtime config를 불러오지 못했습니다.",
    );
  }

  if (!response.ok) {
    throw new LiveSttError(
      "start_failed",
      `Live STT runtime config request failed: ${response.status}`,
    );
  }

  try {
    return runtimeConfigResponseSchema.parse(await response.json());
  } catch {
    throw new LiveSttError(
      "start_failed",
      "Live STT runtime config 응답이 올바르지 않습니다.",
    );
  }
}

const defaultFetch: typeof fetch = (input, init) =>
  globalThis.fetch(input, init);
