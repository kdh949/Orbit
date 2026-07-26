import type { PracticePlanResponse } from "@orbit/shared/coaching";

export function practiceGoalCategoryLabel(category: string) {
  return ({
    semantic: "핵심 메시지",
    timing: "시간 배분",
    delivery: "전달 방식",
    structure: "발표 구조",
  } as Record<string, string>)[category] ?? "발표 목표";
}

export function practiceHistoryLabel(label: string) {
  return ({
    current: "이번에 발견",
    "last-run": "직전에도 발견",
    "recent-twice": "최근 2회 반복",
    persistent: "반복되는 패턴",
    improving: "개선 중",
    regressed: "다시 나타남",
  } as Record<string, string>)[label] ?? "이번에 발견";
}

export function firstSelectableGoal(plan: PracticePlanResponse) {
  return plan.status === "ready" ? plan.goals[0]?.goalId ?? null : null;
}
