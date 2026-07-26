import type { PracticePlanResponse } from "@orbit/shared/coaching";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PracticePlanPage } from "./PracticePlanPage";

describe("PracticePlanPage", () => {
  it("keeps unavailable advanced practice actions visible with a reason", () => {
    const html = render(false);

    expect(html).toContain("선택한 구간 연습");
    expect(html).toContain("도전 질문 3개 연습");
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("현재 사용할 수 없습니다");
  });

  it("uses Korean labels for the coaching flow", () => {
    const html = render(true);

    expect(html).toContain("맞춤 연습");
    expect(html).toContain("다음 리허설");
    expect(html).not.toContain("Adaptive coach");
    expect(html).not.toContain("Next rehearsal");
  });
});

function render(enabled: boolean) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <PracticePlanPage
        previewCapabilities={{
          challengeQnaEnabled: enabled,
          focusedPracticeEnabled: enabled,
        }}
        previewPlan={practicePlan}
        projectId="project-a"
        sourceFullRunId="run-a"
      />
    </QueryClientProvider>,
  );
}

const goal = {
  goalId: "goal-a",
  goalSetId: "goalset-a",
  projectId: "project-a",
  originFullRunId: "run-a",
  priority: 1,
  patternKey: "a".repeat(64),
  category: "timing",
  criterionRef: { criterionId: "criterion-a", revision: 1 },
  targetScope: { type: "slide", scopeId: "scope-a", slideId: "slide-a" },
  recommendedPracticeMode: "focused",
  evidenceRefs: [],
  problemLabel: "도입 결론을 30초 안에 전달하기",
  nextAction: "결론을 먼저 말하고 근거를 한 문장으로 연결하세요.",
  successCondition: "30초 안에 결론과 근거를 모두 전달합니다.",
  measurementState: "measured",
  createdAt: "2026-07-12T00:00:00.000Z",
  history: {
    label: "current",
    occurrenceCount: 1,
    comparableRunCount: 1,
    lastSeenAt: "2026-07-12T00:00:00.000Z",
  },
  canStartFocusedPractice: true,
  unavailableReason: null,
} as const;

const practicePlan = {
  status: "ready",
  sourceFullRunId: "run-a",
  goalSet: {
    goalSetId: "goalset-a",
    projectId: "project-a",
    sourceFullRunId: "run-a",
    revision: 1,
    sourceAnalysisRevision: 1,
    isCurrent: true,
    analysisState: "final",
    dataOrigin: "fixture",
    derivationVersion: 1,
    goals: [goal],
    createdAt: "2026-07-12T00:00:00.000Z",
  },
  goals: [goal],
  fullRehearsalCta: { projectId: "project-a", sourceGoalSetId: "goalset-a" },
} as unknown as Extract<PracticePlanResponse, { status: "ready" }>;
