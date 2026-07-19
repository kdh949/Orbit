import {
  createRehearsalEvaluationSnapshot,
  deckSchema,
  presentationBriefSchema,
  rehearsalFocusProfileSchema,
} from "@orbit/shared";
import { describe, expect, it } from "vitest";

import {
  assertFrozenRehearsalEvaluationSources,
  buildRehearsalEvaluationPlan,
  createRehearsalFocusProfileSnapshot,
  deckContentHash,
  sha256Canonical,
} from "./evaluation-plan";

describe("evaluation plan", () => {
  it("builds the same hash and criteria regardless of object key order", () => {
    expect(sha256Canonical({ b: 2, a: 1 })).toBe(sha256Canonical({ a: 1, b: 2 }));
    expect(deckContentHash(deck())).toMatch(/^[a-f0-9]{64}$/);
  });

  it("freezes Brief, Lens, approved references, and versioned criteria", () => {
    const brief = presentationBriefSchema.parse({
      briefId: "brief_1",
      projectId: "project_1",
      revision: 2,
      audience: "decision-maker",
      purpose: "persuade",
      evaluatorLensRef: { lensId: "decision-maker", revision: 1 },
      targetDurationMinutes: 8,
      desiredOutcome: "승인을 얻는다.",
      requirements: [],
      terminology: [],
      challengeTopics: [],
      approvedReferences: [{ fileId: "file_1", fileContentHash: "a".repeat(64) }],
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
    const plan = buildRehearsalEvaluationPlan({ deck: deck(), brief, sourceGoalSetRef: null });

    expect(plan.briefRef).toEqual({ mode: "briefed", briefId: "brief_1", revision: 2 });
    expect(plan.evaluatorLensRef.lensId).toBe("decision-maker");
    expect(plan.approvedReferences).toHaveLength(1);
    expect(plan.criteria.some((criterion) => criterion.category === "timing")).toBe(true);
    expect(plan.metricDefinitionVersions.silence).toBe(2);
    expect(plan.criteria).toContainEqual(
      expect.objectContaining({
        criterionId: "criterion_system_long_silence_v2",
        revision: 2,
      }),
    );
  });

  it("turns only approved Brief requirements into criteria and keeps Q&A topics separate", () => {
    const brief = presentationBriefSchema.parse({
      briefId: "brief_criteria",
      projectId: "project_1",
      revision: 3,
      audience: "decision-maker",
      purpose: "persuade",
      evaluatorLensRef: { lensId: "decision-maker", revision: 1 },
      targetDurationMinutes: 8,
      desiredOutcome: "예산 승인을 얻는다.",
      requirements: [
        {
          requirementId: "requirement_must",
          revision: 2,
          kind: "must-cover",
          text: "예상 절감액을 설명한다.",
          reviewStatus: "approved",
        },
        {
          requirementId: "requirement_opening",
          revision: 1,
          kind: "opening",
          text: "고객 문제로 시작한다.",
          reviewStatus: "approved",
        },
        {
          requirementId: "requirement_closing",
          revision: 1,
          kind: "closing",
          text: "승인 요청으로 마무리한다.",
          reviewStatus: "approved",
        },
        {
          requirementId: "requirement_excluded",
          revision: 1,
          kind: "must-cover",
          text: "검토에서 제외된 내용",
          reviewStatus: "excluded",
        },
      ],
      terminology: [],
      challengeTopics: ["절감액 산정 근거"],
      approvedReferences: [],
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    });

    const plan = buildRehearsalEvaluationPlan({
      deck: deck(),
      brief,
      sourceGoalSetRef: null,
    });
    const briefCriteria = plan.criteria.filter((criterion) => criterion.source === "brief");

    expect(briefCriteria).toHaveLength(3);
    expect(briefCriteria.map((criterion) => criterion.scope)).toEqual([
      { type: "run" },
      { type: "time-window", window: "opening" },
      { type: "time-window", window: "closing" },
    ]);
    expect(JSON.stringify(plan.criteria)).not.toContain("절감액 산정 근거");
    expect(JSON.stringify(plan.criteria)).not.toContain("검토에서 제외된 내용");
  });

  it("detects Brief and Focus Profile revisions that differ from the frozen snapshot", () => {
    const brief = presentationBriefSchema.parse({
      briefId: "brief_snapshot",
      projectId: "project_1",
      revision: 2,
      audience: "decision-maker",
      purpose: "persuade",
      evaluatorLensRef: { lensId: "decision-maker", revision: 1 },
      targetDurationMinutes: 8,
      desiredOutcome: "승인을 얻는다.",
      requirements: [
        {
          requirementId: "requirement_snapshot",
          revision: 1,
          kind: "must-cover",
          text: "핵심 수치를 설명한다.",
          reviewStatus: "approved",
        },
      ],
      terminology: [],
      challengeTopics: [],
      approvedReferences: [],
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
    const focusProfile = rehearsalFocusProfileSchema.parse({
      profileId: "focus_profile_1",
      projectId: "project_1",
      revision: 4,
      items: [
        {
          focusItemId: "focus_item_1",
          priority: 1,
          kind: "semantic-coverage",
          label: "핵심 수치 전달",
          targetScope: { type: "slide", scopeId: "scope_1", slideId: "slide_1" },
        },
      ],
      createdBy: "user_1",
      updatedBy: "user_1",
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
    const plan = buildRehearsalEvaluationPlan({
      deck: deck(),
      brief,
      sourceGoalSetRef: null,
    });
    const snapshot = createRehearsalEvaluationSnapshot(
      deck(),
      "2026-07-11T00:01:00.000Z",
      {
        deckContentHash: deckContentHash(deck()),
        evaluationPlan: plan,
        focusProfileSnapshot: createRehearsalFocusProfileSnapshot(focusProfile),
      },
    );

    expect(() =>
      assertFrozenRehearsalEvaluationSources({ snapshot, brief, focusProfile }),
    ).not.toThrow();
    expect(() =>
      assertFrozenRehearsalEvaluationSources({
        snapshot,
        brief: { ...brief, revision: 3 },
        focusProfile,
      }),
    ).toThrow("Rehearsal evaluation sources do not match the frozen snapshot.");
    expect(() =>
      assertFrozenRehearsalEvaluationSources({
        snapshot,
        brief,
        focusProfile: { ...focusProfile, revision: 5 },
      }),
    ).toThrow("Rehearsal evaluation sources do not match the frozen snapshot.");
    expect(snapshot.evaluationPlan?.briefRef).toEqual({
      mode: "briefed",
      briefId: "brief_snapshot",
      revision: 2,
    });
    expect(snapshot.focusProfileSnapshot?.profileRef).toEqual({
      profileId: "focus_profile_1",
      revision: 4,
    });
  });
});

function deck() {
  return deckSchema.parse({
    deckId: "deck_1",
    projectId: "project_1",
    title: "테스트 덱",
    version: 1,
    targetDurationMinutes: 10,
    canvas: { preset: "wide-16-9", width: 1920, height: 1080, aspectRatio: "16:9" },
    slides: [
      {
        slideId: "slide_1",
        order: 1,
        title: "도입",
        elements: [],
        keywords: [],
        semanticCues: [],
      },
    ],
  });
}
