import type { RehearsalRun } from "@orbit/shared/rehearsals";

export function getRehearsalReportPath(projectId: string, runId: string) {
  return `/rehearsal/${encodeURIComponent(projectId)}/report/${encodeURIComponent(runId)}`;
}

export function getRehearsalPresenterWindowPath(
  projectId: string,
  sessionId: string,
  state?: { slideIndex?: number; stepIndex?: number },
) {
  const params = new URLSearchParams({
    presenterSessionId: sessionId,
    presenterWindow: "1",
  });
  if (typeof state?.slideIndex === "number") {
    params.set("slideIndex", String(Math.max(0, Math.floor(state.slideIndex))));
  }
  if (typeof state?.stepIndex === "number") {
    params.set("stepIndex", String(Math.max(0, Math.floor(state.stepIndex))));
  }

  return `/rehearsal/${encodeURIComponent(projectId)}?${params.toString()}`;
}

export function getRehearsalFinishPath(
  projectId: string,
  run: Pick<RehearsalRun, "runId" | "status"> | null,
) {
  if (run?.runId) {
    return getRehearsalReportPath(projectId, run.runId);
  }

  return `/project/${encodeURIComponent(projectId)}`;
}
