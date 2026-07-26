import type { ActivitySessionResultItem } from "@orbit/shared/activities";
import type { PresentationRunStatus } from "@orbit/shared/presentation";

export function isPresentationAnalysisPending(status?: PresentationRunStatus) {
  return (
    status === "created" || status === "uploading" || status === "processing"
  );
}

export function countAudienceResponses(items: ActivitySessionResultItem[]) {
  return items.reduce(
    (total, item) =>
      total + (item.result?.responseCount ?? item.run.responseCount),
    0,
  );
}
