import type { PracticePlanResponse } from "@orbit/shared/coaching";

export type PracticeGoalReminderState = { seenKeys: string[] };

export function selectPracticeGoalReminder(
  plan: PracticePlanResponse | undefined,
  slideId: string | undefined,
  state: PracticeGoalReminderState,
) {
  if (!plan || plan.status !== "ready" || !slideId) return null;
  const goal = plan.goals.find((item) =>
    item.measurementState === "measured" &&
    item.targetScope?.type === "slide" &&
    item.targetScope.slideId === slideId &&
    !state.seenKeys.includes(`${item.goalId}:${slideId}`),
  );
  if (!goal) return null;
  return {
    key: `${goal.goalId}:${slideId}`,
    goalId: goal.goalId,
    message: goal.nextAction.slice(0, 120),
  };
}

export function markPracticeGoalReminderSeen(
  state: PracticeGoalReminderState,
  key: string,
): PracticeGoalReminderState {
  return state.seenKeys.includes(key)
    ? state
    : { seenKeys: [...state.seenKeys, key] };
}
