import {
  focusedPracticeAttemptSchema,
  focusedPracticeAttemptSummarySchema,
  focusedPracticeSessionSchema,
  type FocusedPracticeAttempt,
  type FocusedPracticeAttemptSummary,
  type FocusedPracticeSession,
  type PracticePlanResponse,
} from "@orbit/shared/coaching";
import { normalizeCoachingAudioMimeType } from "./coachingAudioMimeType";

const jsonHeaders = { "content-type": "application/json" };
async function json(response: Response) { if (!response.ok) throw new Error("부분 연습 요청에 실패했습니다."); return response.json(); }

export async function getFocusedPracticeSummary(
  projectId: string,
  sourceFullRunId: string,
): Promise<FocusedPracticeAttemptSummary> {
  const query = new URLSearchParams({ sourceFullRunId });
  const data = await json(await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/focused-practice-summary?${query}`,
    { credentials: "include" },
  ));
  return focusedPracticeAttemptSummarySchema.parse(data);
}

export async function createFocusedSession(projectId: string, plan: Extract<PracticePlanResponse, { status: "ready" }>, goalId: string, clientRequestId: string) {
  const goal = plan.goals.find((item) => item.goalId === goalId);
  if (!goal?.targetScope) throw new Error("부분 연습 범위가 없습니다.");
  const data = await json(await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/focused-practice-sessions`, {
    method: "POST", headers: jsonHeaders, credentials: "include",
    body: JSON.stringify({ clientRequestId, sourceFullRunId: plan.sourceFullRunId,
      sourceGoalSetId: plan.goalSet.goalSetId, goalIds: [goalId], targetScope: goal.targetScope }),
  })) as { session: unknown };
  return focusedPracticeSessionSchema.parse(data.session);
}

export async function getFocusedSession(sessionId: string): Promise<{ session: FocusedPracticeSession; attempts: FocusedPracticeAttempt[]; stabilization: Array<{ goalId: string; stabilized: boolean }> }> {
  const data = await json(await fetch(`/api/v1/focused-practice-sessions/${encodeURIComponent(sessionId)}`, { credentials: "include" })) as any;
  return { session: focusedPracticeSessionSchema.parse(data.session), attempts: data.attempts.map((item: unknown) => focusedPracticeAttemptSchema.parse(item)), stabilization: data.stabilization };
}

export async function submitFocusedAudio(
  sessionId: string,
  blob: Blob,
  durationMs: number,
  slideTimeline: FocusedPracticeAttempt["slideTimeline"],
) {
  const attemptData = await json(await fetch(`/api/v1/focused-practice-sessions/${encodeURIComponent(sessionId)}/attempts`, {
    method: "POST", headers: jsonHeaders, credentials: "include",
    body: JSON.stringify({ clientRequestId: crypto.randomUUID(), mimeType: normalizeCoachingAudioMimeType(blob.type), size: blob.size }),
  })) as { attempt: unknown; upload: { uploadUrl: string; method: string; headers: Record<string, string>; fileId: string } };
  const attempt = focusedPracticeAttemptSchema.parse(attemptData.attempt);
  const uploadResponse = await fetch(attemptData.upload.uploadUrl, { method: attemptData.upload.method, headers: attemptData.upload.headers, body: blob });
  if (!uploadResponse.ok) throw new Error("부분 연습 녹음을 업로드하지 못했습니다.");
  const data = await json(await fetch(`/api/v1/focused-practice-attempts/${encodeURIComponent(attempt.attemptId)}/audio/complete`, {
    method: "POST", headers: jsonHeaders, credentials: "include",
    body: JSON.stringify({ fileId: attemptData.upload.fileId, durationMs, slideTimeline }),
  })) as { attempt: unknown };
  return focusedPracticeAttemptSchema.parse(data.attempt);
}

export async function completeFocusedSession(sessionId: string) {
  const data = await json(await fetch(`/api/v1/focused-practice-sessions/${encodeURIComponent(sessionId)}/complete`, { method: "POST", credentials: "include" })) as { session: unknown };
  return focusedPracticeSessionSchema.parse(data.session);
}
