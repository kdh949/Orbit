import {
  evaluationCriterionSchema,
  reportObservationSchema,
  type EvaluationCriterion,
  type ReportObservation,
} from "@orbit/shared/coaching";
import { describe, expect, it } from "vitest";

import { evaluateCriterion } from "./criterion-evaluator";

const evaluatedAt = "2026-07-13T00:00:00.000Z";

// 이 테스트는 evaluator의 외부 의존성을 모두 제거하고, Criterion과 Observation의
// 조합이 CriterionResult로 어떻게 변환되는지만 검증한다.
describe("evaluateCriterion", () => {
  // semantic 상태가 partial/missed 사이에서 뒤바뀌지 않고 계약대로 변환되는지 확인한다.
  it.each([
    ["covered", "passed", "PASSED"],
    ["partial", "partial", "PARTIAL"],
    ["missed", "failed", "CONCEPT_MISSED"],
    ["contradicted", "failed", "CONCEPT_MISSED"],
  ] as const)(
    "maps semantic %s without swapping partial and missed",
    (value, evaluationStatus, reasonCode) => {
      const criterion = semanticCriterion();
      const result = evaluateCriterion({
        criterion,
        observation: observation(criterion, { kind: "semantic", value }),
        evaluatedAt,
      });

      expect(result).toMatchObject({
        measurementState: "measured",
        evaluationStatus,
        reasonCode,
      });
    },
  );

  // 최대값은 허용하고, 아주 조금이라도 초과하면 실패시킨다.
  it.each([
    [12, "passed", "PASSED"],
    [12.01, "failed", "THRESHOLD_EXCEEDED"],
  ] as const)(
    "applies the duration maximum boundary",
    (value, status, reason) => {
      const criterion = durationCriterion();
      expect(
        evaluateCriterion({
          criterion,
          observation: observation(criterion, {
            kind: "duration-seconds",
            value,
          }),
          evaluatedAt,
        }),
      ).toMatchObject({ evaluationStatus: status, reasonCode: reason });
    },
  );

  // 습관어와 긴 침묵은 각각 독립적인 count metric으로 평가한다.
  it.each([
    ["filler-word-count", 1, "passed"],
    ["filler-word-count", 2, "failed"],
    ["long-silence-count", 0, "passed"],
    ["long-silence-count", 1, "failed"],
  ] as const)("applies the %s boundary at %s", (metric, value, status) => {
    const criterion = countCriterion(metric);
    expect(
      evaluateCriterion({
        criterion,
        observation: observation(criterion, { kind: "count", metric, value }),
        evaluatedAt,
      }).evaluationStatus,
    ).toBe(status);
  });

  // 측정 자료가 없을 때 실패 결과가 생성되지 않는 것이 핵심 계약이다.
  it("keeps missing and unmeasured observations out of failure results", () => {
    const criterion = semanticCriterion();
    const missing = evaluateCriterion({
      criterion,
      observation: null,
      evaluatedAt,
    });
    const unmeasured = evaluateCriterion({
      criterion,
      observation: observation(criterion, { kind: "none" }, "unmeasured"),
      unavailableReason: "EVALUATION_UNAVAILABLE",
      evaluatedAt,
    });

    expect(missing).toMatchObject({
      measurementState: "unmeasured",
      evaluationStatus: "not-evaluated",
      observationId: null,
      reasonCode: "NO_MEASUREMENT",
    });
    expect(unmeasured).toMatchObject({
      measurementState: "unmeasured",
      evaluationStatus: "not-evaluated",
      observationId: null,
      reasonCode: "EVALUATION_UNAVAILABLE",
    });
  });

  // Criterion의 revision 또는 평가 범위가 다르면 값이 있어도 비교하지 않는다.
  it("marks criterion ref and scope mismatches as incomparable", () => {
    const criterion = durationCriterion();
    // 값 13은 maximum 12를 초과하지만, ref가 먼저 다르므로 threshold 실패가 아니라
    // SOURCE_INCOMPARABLE이 되어야 한다.
    const mismatchedRef = observation(criterion, {
      kind: "duration-seconds",
      value: 13,
    });
    // 이번에는 ref는 맞지만 slide scope가 다르므로 동일한 비교 불가 결과를 기대한다.
    const mismatchedScope = observation(criterion, {
      kind: "duration-seconds",
      value: 13,
    });

    expect(
      evaluateCriterion({
        criterion,
        observation: {
          ...mismatchedRef,
          criterionRef: { criterionId: "criterion_other", revision: 1 },
        },
        evaluatedAt,
      }).reasonCode,
    ).toBe("SOURCE_INCOMPARABLE");
    expect(
      evaluateCriterion({
        criterion,
        observation: {
          ...mismatchedScope,
          scope: { type: "slide", slideId: "slide_other" },
        },
        evaluatedAt,
      }).reasonCode,
    ).toBe("SOURCE_INCOMPARABLE");
  });

  // 값의 종류나 metric이 Criterion의 measurement와 다르면 평가 불가로 처리한다.
  it("marks value type and metric mismatches as evaluation unavailable", () => {
    const duration = durationCriterion();
    const filler = countCriterion("filler-word-count");

    expect(
      evaluateCriterion({
        criterion: duration,
        observation: observation(duration, {
          kind: "count",
          metric: "long-silence-count",
          value: 1,
        }),
        evaluatedAt,
      }).reasonCode,
    ).toBe("EVALUATION_UNAVAILABLE");
    expect(
      evaluateCriterion({
        criterion: filler,
        observation: observation(filler, {
          kind: "count",
          metric: "long-silence-count",
          value: 1,
        }),
        evaluatedAt,
      }).reasonCode,
    ).toBe("EVALUATION_UNAVAILABLE");
  });

  // 이 함수는 실행 경로 종류에 의존하지 않는 순수 함수여야 한다.
  it("returns the same result for identical inputs without an execution-kind branch", () => {
    const criterion = countCriterion("long-silence-count");
    const input = {
      criterion,
      observation: observation(criterion, {
        kind: "count" as const,
        metric: "long-silence-count" as const,
        value: 1,
      }),
      evaluatedAt,
    };

    expect(evaluateCriterion(input)).toEqual(evaluateCriterion(input));
  });
});

// 테스트 fixture도 shared schema를 거쳐 실제 런타임 계약과 같은 형태를 만든다.
function semanticCriterion(): EvaluationCriterion {
  return evaluationCriterionSchema.parse({
    criterionId: "criterion_semantic_1",
    revision: 2,
    category: "semantic",
    source: "brief",
    scope: { type: "run" },
    label: "핵심 내용을 전달한다.",
    measurement: {
      type: "semantic-coverage",
      expectedConceptIds: ["concept_1"],
    },
  });
}

// slide 단위의 max-duration-seconds Criterion이다. duration 분기와 scope 비교를
// 동시에 확인할 수 있도록 slide scope와 maximum 12를 사용한다.
function durationCriterion(): EvaluationCriterion {
  return evaluationCriterionSchema.parse({
    criterionId: "criterion_timing_1",
    revision: 1,
    category: "timing",
    source: "system",
    scope: { type: "slide", slideId: "slide_1" },
    label: "첫 슬라이드 목표 시간",
    measurement: { type: "max-duration-seconds", maximum: 12 },
  });
}

// delivery category에서 지원하는 두 count metric을 같은 helper로 생성한다.
// filler-word-count는 1개까지, long-silence-count는 0개까지 통과하도록 서로 다른 경계를 둔다.
function countCriterion(
  metric: "filler-word-count" | "long-silence-count",
): EvaluationCriterion {
  return evaluationCriterionSchema.parse({
    criterionId: `criterion_${metric}`,
    revision: 1,
    category: "delivery",
    source: "system",
    scope: { type: "run" },
    label: metric,
    measurement: {
      type: "max-count",
      metric,
      maximum: metric === "filler-word-count" ? 1 : 0,
    },
  });
}

// 정상 측정과 미측정 Observation을 모두 만들 수 있는 공통 fixture다.
// 실제 코드와 마찬가지로 reportObservationSchema.parse를 거치므로, 테스트가
// evaluator의 가정과 어긋난 잘못된 Observation을 조용히 사용하지 않게 한다.
function observation(
  criterion: EvaluationCriterion,
  value: ReportObservation["value"],
  measurementState: ReportObservation["measurementState"] = "measured",
): ReportObservation {
  return reportObservationSchema.parse({
    observationId: `observation_${criterion.criterionId}`,
    criterionRef: {
      criterionId: criterion.criterionId,
      revision: criterion.revision,
    },
    scope: criterion.scope,
    measurementState,
    value,
    evidenceRefs: [],
    observedAt: "2026-07-13T00:00:00.000Z",
  });
}
