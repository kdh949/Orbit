import type { PracticePlanResponse } from "@orbit/shared/coaching";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PracticeGoalSummary, PracticePassMarks } from "./PracticeGoalSummary";

describe("PracticeGoalSummary", () => {
  it("shows only three visible success marks when passed count is higher", () => {
    const html = renderToStaticMarkup(<PracticePassMarks passedCount={4} />);

    expect(html).toContain('aria-label="4회 통과"');
    expect((html.match(/is-passed/g) ?? []).length).toBe(3);
  });

  it("keeps the practice plan entry visible while goal derivation is processing", () => {
    const html = render({ status: "processing", sourceFullRunId: "run-a" });

    expect(html).toContain("연습 계획 준비 중");
    expect(html).toContain("연습하기");
    expect(html).toContain("/rehearsal/project-a/plan/run-a");
  });

  it("keeps the practice plan entry visible when no priority goals exist", () => {
    const html = render({ status: "no-goal", sourceFullRunId: "run-a" });

    expect(html).toContain("지금 바로 반복할 목표가 없어요");
    expect(html).toContain("연습하기");
    expect(html).toContain("/rehearsal/project-a/plan/run-a");
  });
});

function render(plan: PracticePlanResponse) {
  return renderToStaticMarkup(
    <PracticeGoalSummary
      initialPlan={plan}
      projectId="project-a"
      sourceFullRunId="run-a"
    />,
  );
}
