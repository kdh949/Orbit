import type { PracticePlanResponse } from "@orbit/shared/coaching";
import { describe, expect, it } from "vitest";

import { markPracticeGoalReminderSeen, selectPracticeGoalReminder } from "./practiceGoalReminderModel";

describe("practice goal reminder", () => {
  it("shows a bounded measured slide goal only once", () => {
    const plan = { status: "ready", goals: [{
      goalId: "goal-1",
      measurementState: "measured",
      targetScope: { type: "slide", scopeId: "scope-1", slideId: "slide-1" },
      nextAction: "가".repeat(180),
    }] } as unknown as PracticePlanResponse;
    const reminder = selectPracticeGoalReminder(plan, "slide-1", { seenKeys: [] });

    expect(reminder?.message).toHaveLength(120);
    expect(selectPracticeGoalReminder(
      plan,
      "slide-1",
      markPracticeGoalReminderSeen({ seenKeys: [] }, reminder!.key),
    )).toBeNull();
  });
});
