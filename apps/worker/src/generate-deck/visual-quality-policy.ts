import type {
  GenerateDeckValidation,
  GenerateDeckVisualIssueCode,
} from "@orbit/shared";

export type VisualQualityPolicyDecision =
  | "publish"
  | "publish-advisory"
  | "repair"
  | "safe-remap"
  | "block";

export type VisualQualityPolicyResult = {
  decision: VisualQualityPolicyDecision;
  publicationAllowed: boolean;
  p0IssueCodes: string[];
  p1IssueCodes: GenerateDeckVisualIssueCode[];
  p2IssueCodes: string[];
};

export function evaluateVisualQualityPolicy(input: {
  validation: GenerateDeckValidation;
  visualQaStatus: "passed" | "failed" | "unavailable";
  visualIssueCodes?: readonly GenerateDeckVisualIssueCode[];
  repairAttempts?: number;
  maxRepairAttempts?: number;
  safeRemapAttempted?: boolean;
  qaStrictness?: "standard" | "strict";
  usesApprovedLayouts?: boolean;
}): VisualQualityPolicyResult {
  const p0IssueCodes = validationIssues(input.validation)
    .filter((issue) => issue.blocking)
    .map((issue) => issue.code);
  const p1IssueCodes = [...new Set(input.visualIssueCodes ?? [])];

  if (p0IssueCodes.length > 0) {
    return result("block", p0IssueCodes, p1IssueCodes, []);
  }

  if (input.visualQaStatus === "unavailable") {
    if (
      input.qaStrictness === "strict" ||
      input.usesApprovedLayouts !== true
    ) {
      return result("block", [], [], ["VISUAL_QA_UNAVAILABLE"]);
    }
    return result("publish-advisory", [], [], ["VISUAL_QA_UNAVAILABLE"]);
  }

  if (input.visualQaStatus === "failed" || p1IssueCodes.length > 0) {
    const repairAttempts = input.repairAttempts ?? 0;
    const maxRepairAttempts = input.maxRepairAttempts ?? 2;
    if (repairAttempts < maxRepairAttempts) {
      return result("repair", [], p1IssueCodes, []);
    }
    if (!input.safeRemapAttempted) {
      return result("safe-remap", [], p1IssueCodes, []);
    }
    return result("block", [], p1IssueCodes, []);
  }

  const p2IssueCodes = validationIssues(input.validation)
    .filter((issue) => !issue.blocking)
    .map((issue) => issue.code);
  return result(
    p2IssueCodes.length > 0 ? "publish-advisory" : "publish",
    [],
    [],
    p2IssueCodes,
  );
}

function validationIssues(validation: GenerateDeckValidation) {
  return [
    ...validation.layoutIssues,
    ...validation.contentIssues,
    ...validation.designIssues,
    ...validation.presentationIssues,
  ];
}

function result(
  decision: VisualQualityPolicyDecision,
  p0IssueCodes: string[],
  p1IssueCodes: GenerateDeckVisualIssueCode[],
  p2IssueCodes: string[],
): VisualQualityPolicyResult {
  return {
    decision,
    publicationAllowed:
      decision === "publish" || decision === "publish-advisory",
    p0IssueCodes: [...new Set(p0IssueCodes)],
    p1IssueCodes,
    p2IssueCodes: [...new Set(p2IssueCodes)],
  };
}
