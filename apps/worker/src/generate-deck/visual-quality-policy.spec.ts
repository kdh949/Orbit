import type { GenerateDeckValidation } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import { evaluateVisualQualityPolicy } from "./visual-quality-policy";

const passingValidation: GenerateDeckValidation = {
  passed: true,
  layoutIssues: [],
  contentIssues: [],
  designIssues: [],
  presentationIssues: [],
};

describe("evaluateVisualQualityPolicy", () => {
  it.each([
    ["P0 contract failure", blockingValidation(), "passed", "block", false],
    ["P1 before repair", passingValidation, "failed", "repair", false],
    [
      "P1 after repair budget",
      passingValidation,
      "failed",
      "safe-remap",
      false,
    ],
    [
      "P1 after safe remap",
      passingValidation,
      "failed",
      "block",
      false,
    ],
    ["clean review", passingValidation, "passed", "publish", true],
  ] as const)(
    "%s resolves to %s",
    (_, validation, visualQaStatus, expectedDecision, publicationAllowed) => {
      const result = evaluateVisualQualityPolicy({
        validation,
        visualQaStatus,
        visualIssueCodes:
          visualQaStatus === "failed" ? ["BALANCE_WEAK"] : [],
        repairAttempts:
          expectedDecision === "repair" ? 0 : visualQaStatus === "failed" ? 2 : 0,
        maxRepairAttempts: 2,
        safeRemapAttempted: expectedDecision === "block" && visualQaStatus === "failed",
        usesApprovedLayouts: true,
      });

      expect(result.decision).toBe(expectedDecision);
      expect(result.publicationAllowed).toBe(publicationAllowed);
    },
  );

  it.each([
    ["standard approved layouts", "standard", true, "publish-advisory", true],
    ["strict approved layouts", "strict", true, "block", false],
    ["standard unapproved layouts", "standard", false, "block", false],
  ] as const)(
    "handles unavailable Vision QA for %s",
    (_, qaStrictness, usesApprovedLayouts, decision, publicationAllowed) => {
      const result = evaluateVisualQualityPolicy({
        validation: passingValidation,
        visualQaStatus: "unavailable",
        qaStrictness,
        usesApprovedLayouts,
      });

      expect(result).toMatchObject({ decision, publicationAllowed });
      expect(result.p2IssueCodes).toEqual(["VISUAL_QA_UNAVAILABLE"]);
    },
  );

  it("allows non-blocking deterministic issues only as P2 advisory", () => {
    const validation = structuredClone(passingValidation);
    validation.passed = false;
    validation.designIssues.push({
      code: "MEDIA_BUDGET_UNDERSUPPLIED",
      scope: "deck",
      severity: "warning",
      blocking: false,
      path: "slides",
      message: "Media target was not met without leaving placeholders.",
    });

    expect(
      evaluateVisualQualityPolicy({
        validation,
        visualQaStatus: "passed",
      }),
    ).toMatchObject({
      decision: "publish-advisory",
      publicationAllowed: true,
      p2IssueCodes: ["MEDIA_BUDGET_UNDERSUPPLIED"],
    });
  });
});

function blockingValidation(): GenerateDeckValidation {
  return {
    ...structuredClone(passingValidation),
    passed: false,
    designIssues: [
      {
        code: "TEXT_OVERFLOW",
        scope: "element",
        severity: "error",
        blocking: true,
        path: "slides.0.elements.0",
        message: "Text exceeds its approved frame.",
      },
    ],
  };
}
