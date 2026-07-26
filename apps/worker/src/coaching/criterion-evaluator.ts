import {
  criterionResultSchema,
  evaluationCriterionSchema,
  reportObservationSchema,
  type CriterionResult,
  type EvaluationCriterion,
  type ReportObservation,
} from "@orbit/shared/coaching";

export type CriterionUnavailableReason = Extract<
  CriterionResult["reasonCode"],
  | "NO_MEASUREMENT"
  | "NOT_APPLICABLE"
  | "SOURCE_INCOMPARABLE"
  | "EVALUATION_UNAVAILABLE"
>;

// `CriterionResult`에서 실제 측정 실패가 아닌 "평가하지 못함"에 해당하는 사유만 허용한다.
// 따라서 호출부가 `THRESHOLD_EXCEEDED` 같은 실패 사유를 `unavailableReason`으로
// 잘못 전달하면 TypeScript 단계에서 걸러진다.
export type CriterionEvaluationInput = {
  criterion: EvaluationCriterion;
  observation: ReportObservation | null;
  // 관측이 없거나 `unmeasured`인 경우의 구체적인 사유다. 생략하면
  // 관측 부재를 뜻하는 `NO_MEASUREMENT`를 기본값으로 사용한다.
  unavailableReason?: CriterionUnavailableReason;
  evaluatedAt: string;
};

/**
 * 하나의 Criterion과 그에 대응하는 Observation을 동일한 결과 계약으로 변환한다.
 *
 * 판정 순서는 다음과 같다.
 * 1. Criterion/Observation의 schema를 검증한다.
 * 2. 관측 존재 여부와 Criterion 참조, 평가 범위를 먼저 확인한다.
 * 3. 측정 가능한 경우에만 measurement 종류별 판정 규칙을 적용한다.
 * 4. 모든 분기에서 `CriterionResult` schema를 통과한 결과를 반환한다.
 *
 * 이 함수는 분석기나 STT를 실행하지 않는다. 분석기가 이미 만든 Observation을
 * Criterion의 기대 조건에 맞춰 통과/부분 통과/실패/측정 불가로 정규화하는 역할만 한다.
 */
export function evaluateCriterion(
  input: CriterionEvaluationInput,
): CriterionResult {
  // 이 모듈의 입력 경계다. 타입이 선언되어 있어도 런타임 데이터는 신뢰하지 않고,
  // shared schema를 통과한 값만 아래 판정 로직으로 보낸다.
  const criterion = evaluationCriterionSchema.parse(input.criterion);
  const observation = input.observation
    ? reportObservationSchema.parse(input.observation)
    : null;

  if (!observation) {
    // Criterion은 존재하지만 대응 Observation이 없다는 뜻이다.
    // 이를 `failed`로 만들면 "발표를 못했다"와 "측정 자료가 없다"를 구분할 수 없으므로,
    // `unmeasured / not-evaluated` 결과로 남긴다.
    return unavailableResult(
      criterion,
      input.evaluatedAt,
      input.unavailableReason ?? "NO_MEASUREMENT",
    );
  }

  if (!sameCriterionRef(criterion, observation)) {
    // criterionId뿐 아니라 revision까지 일치해야 같은 평가 정의에서 나온 자료다.
    // 예를 들어 Criterion이 수정된 뒤 예전 revision의 Observation을 재사용하면
    // threshold나 의미가 달라질 수 있으므로 실패 판정을 내리지 않고 비교 불가로 처리한다.
    return unavailableResult(
      criterion,
      input.evaluatedAt,
      "SOURCE_INCOMPARABLE",
    );
  }

  if (!sameScope(criterion.scope, observation.scope)) {
    // 같은 Criterion이라도 run/slide/slide-range/time-window가 다르면 측정 대상이 다르다.
    // 특히 다른 slide의 시간값을 현재 slide Criterion에 적용하지 않도록 여기서 차단한다.
    return unavailableResult(
      criterion,
      input.evaluatedAt,
      "SOURCE_INCOMPARABLE",
    );
  }

  if (observation.measurementState === "unmeasured") {
    // Observation 레코드는 만들어졌지만 value가 `none`인 경우다.
    // 이 상태는 shared schema상 실제 수치/semantic 결과가 없다는 의미이므로,
    // 아래 measurement 분기로 내려가 임의의 실패 판정을 만들지 않는다.
    return unavailableResult(
      criterion,
      input.evaluatedAt,
      input.unavailableReason ?? "NO_MEASUREMENT",
    );
  }

  if (
    criterion.measurement.type === "semantic-coverage" &&
    observation.value.kind === "semantic"
  ) {
    // semantic 분석 자체는 앞 단계에서 끝났고, 여기서는 그 결과를 공통 계약으로 매핑한다.
    // `partial`을 실패로 취급하지 않는 것이 이 매핑의 핵심이다.
    // `expectedConceptIds`를 다시 계산하지 않는 이유도 Observation의 semantic value가
    // 이미 분석 결과를 요약하고 있기 때문이다.
    const semanticResult = {
      covered: { evaluationStatus: "passed", reasonCode: "PASSED" },
      partial: { evaluationStatus: "partial", reasonCode: "PARTIAL" },
      missed: { evaluationStatus: "failed", reasonCode: "CONCEPT_MISSED" },
      contradicted: {
        evaluationStatus: "failed",
        reasonCode: "CONCEPT_MISSED",
      },
    } as const;
    return measuredResult(
      criterion,
      observation,
      input.evaluatedAt,
      semanticResult[observation.value.value],
    );
  }

  if (
    criterion.measurement.type === "max-duration-seconds" &&
    observation.value.kind === "duration-seconds"
  ) {
    // 시간 Criterion은 "최대 허용 시간"이므로 경계값을 포함해 통과시킨다.
    // 즉, 측정값이 maximum과 같으면 PASSED이고, 초과할 때만 THRESHOLD_EXCEEDED다.
    const passed = observation.value.value <= criterion.measurement.maximum;
    return passed
      ? measuredResult(criterion, observation, input.evaluatedAt, {
          evaluationStatus: "passed",
          reasonCode: "PASSED",
        })
      : measuredResult(criterion, observation, input.evaluatedAt, {
          evaluationStatus: "failed",
          reasonCode: "THRESHOLD_EXCEEDED",
        });
  }

  if (
    criterion.measurement.type === "max-count" &&
    observation.value.kind === "count" &&
    observation.value.metric === criterion.measurement.metric
  ) {
    // `count`라는 kind만 같은 것으로는 부족하다. filler-word-count와
    // long-silence-count는
    // 단위와 의미가 다르므로 metric까지 일치할 때만 동일한 maximum과 비교한다.
    const passed = observation.value.value <= criterion.measurement.maximum;
    return passed
      ? measuredResult(criterion, observation, input.evaluatedAt, {
          evaluationStatus: "passed",
          reasonCode: "PASSED",
        })
      : measuredResult(criterion, observation, input.evaluatedAt, {
          evaluationStatus: "failed",
          reasonCode: "THRESHOLD_EXCEEDED",
        });
  }

  // 예: duration Criterion에 count Observation이 들어오거나, filler-word Criterion에
  // long-silence-count가 들어온 경우다. 값이 존재하더라도 올바른 비교가 아니므로
  // 실패가 아니라
  // `EVALUATION_UNAVAILABLE`로 반환한다.
  return unavailableResult(
    criterion,
    input.evaluatedAt,
    "EVALUATION_UNAVAILABLE",
  );
}

function measuredResult(
  criterion: EvaluationCriterion,
  observation: ReportObservation,
  evaluatedAt: string,
  result:
    | { evaluationStatus: "passed"; reasonCode: "PASSED" }
    | { evaluationStatus: "partial"; reasonCode: "PARTIAL" }
    | {
        evaluationStatus: "failed";
        reasonCode: "THRESHOLD_EXCEEDED" | "CONCEPT_MISSED";
      },
): CriterionResult {
  // 측정 성공 결과의 공통 형태를 한 곳에서 만든다.
  // shared schema의 invariant에 따라 measured 결과는 반드시 평가 상태와 observationId를
  // 가져야 하며, reasonCode도 해당 상태에 맞는 값이어야 한다.
  return criterionResultSchema.parse({
    criterionRef: criterionRef(criterion),
    category: criterion.category,
    scope: criterion.scope,
    measurementState: "measured",
    evaluationStatus: result.evaluationStatus,
    observationId: observation.observationId,
    reasonCode: result.reasonCode,
    evaluatedAt,
  });
}

function unavailableResult(
  criterion: EvaluationCriterion,
  evaluatedAt: string,
  reasonCode: CriterionUnavailableReason,
): CriterionResult {
  // 측정 불가 결과의 공통 형태를 한 곳에서 만든다.
  // 관측값이 없거나 비교할 수 없으므로 observationId는 null이고, evaluationStatus는
  // 항상 `not-evaluated`다. 구체적인 원인은 reasonCode로만 구분한다.
  return criterionResultSchema.parse({
    criterionRef: criterionRef(criterion),
    category: criterion.category,
    scope: criterion.scope,
    measurementState: "unmeasured",
    evaluationStatus: "not-evaluated",
    observationId: null,
    reasonCode,
    evaluatedAt,
  });
}

function criterionRef(criterion: EvaluationCriterion) {
  // 결과가 어떤 Criterion 정의와 연결되는지 식별한다. revision을 포함해야
  // 같은 criterionId의 서로 다른 정의를 구분할 수 있다.
  return {
    criterionId: criterion.criterionId,
    revision: criterion.revision,
  };
}

function sameCriterionRef(
  criterion: EvaluationCriterion,
  observation: ReportObservation,
) {
  // Observation이 선언한 출처와 현재 평가 대상이 완전히 같은지 확인한다.
  return (
    criterion.criterionId === observation.criterionRef.criterionId &&
    criterion.revision === observation.criterionRef.revision
  );
}

function sameScope(
  criterionScope: EvaluationCriterion["scope"],
  observationScope: ReportObservation["scope"],
) {
  // scope의 종류와 식별자가 모두 일치해야 동일한 평가 범위로 본다.
  // `run`은 추가 식별자가 없으므로 type만 같으면 일치하고, 나머지는 각 scope의
  // 식별자를 비교한다. 마지막 false는 schema에 새 scope 종류가 추가됐을 때
  // 명시적으로 지원하기 전까지 안전하게 비교 불가로 처리하기 위한 방어선이다.
  if (criterionScope.type !== observationScope.type) return false;
  if (criterionScope.type === "run") return true;
  if (criterionScope.type === "slide" && observationScope.type === "slide") {
    return criterionScope.slideId === observationScope.slideId;
  }
  if (
    criterionScope.type === "slide-range" &&
    observationScope.type === "slide-range"
  ) {
    return (
      criterionScope.startSlideId === observationScope.startSlideId &&
      criterionScope.endSlideId === observationScope.endSlideId
    );
  }
  if (
    criterionScope.type === "time-window" &&
    observationScope.type === "time-window"
  ) {
    return criterionScope.window === observationScope.window;
  }
  return false;
}
