import { describe, expect, it } from "vitest";

import {
  evaluatorLensDefinitionSchema,
  rehearsalEvaluationPlanSchema,
} from "./evaluator-lens.schema";

describe("evaluatorLensDefinitionSchema", () => {
  it("requires a deterministic complete category priority", () => {
    expect(
      evaluatorLensDefinitionSchema.parse({
        ref: { lensId: "general-novice", revision: 1 },
        label: "일반 청중",
        description: "처음 듣는 청중의 이해를 우선합니다.",
        priorityOrder: ["structure", "semantic", "timing", "delivery"],
      }).priorityOrder,
    ).toHaveLength(4);

    expect(
      evaluatorLensDefinitionSchema.safeParse({
        ref: { lensId: "general-novice", revision: 1 },
        label: "일반 청중",
        description: "처음 듣는 청중의 이해를 우선합니다.",
        priorityOrder: ["semantic", "semantic", "timing", "delivery"],
      }).success,
    ).toBe(false);
  });
});

describe("rehearsalEvaluationPlanSchema", () => {
  it("keeps only bounded evaluation references", () => {
    const plan = rehearsalEvaluationPlanSchema.parse({
      planVersion: 1,
      briefRef: { mode: "generic" },
      evaluatorLensRef: { lensId: "general-novice", revision: 1 },
      targetDurationSeconds: 600,
      criteria: [],
      metricDefinitionVersions: {
        timing: 1,
        filler: 1,
        silence: 1,
        semantic: 1,
      },
      approvedReferences: [],
      practiceGoalSetRef: null,
    });

    expect(JSON.stringify(plan)).not.toContain("speakerNotes");
    expect(JSON.stringify(plan)).not.toContain("transcript");
  });

  it("accepts the five-second silence metric definition", () => {
    const result = rehearsalEvaluationPlanSchema.safeParse({
      planVersion: 1,
      briefRef: { mode: "generic" },
      evaluatorLensRef: { lensId: "general-novice", revision: 1 },
      targetDurationSeconds: 600,
      criteria: [],
      metricDefinitionVersions: {
        timing: 1,
        filler: 1,
        silence: 2,
        semantic: 1,
      },
      approvedReferences: [],
      practiceGoalSetRef: null,
    });

    expect(result.success).toBe(true);
  });
});
