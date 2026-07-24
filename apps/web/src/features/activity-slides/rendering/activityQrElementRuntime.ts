import { canonicalActivityUrl } from "./ActivityAudienceSlideRenderer";
import type { ActivityElementRuntime } from "./ActivityElementRuntimeContext";
import type { ActivityQrRuntimeState } from "./activityQrRuntime";

export function resolveActivityQrElementAudienceUrl(input: {
  activityId: string;
  lookupState: ActivityQrRuntimeState;
  runtime: ActivityElementRuntime | null;
}) {
  if (input.runtime) {
    return input.runtime.audienceUrl
      ? canonicalActivityUrl(input.runtime.audienceUrl, input.activityId)
      : null;
  }

  return input.lookupState.status === "ready"
    ? input.lookupState.audienceUrl
    : null;
}
