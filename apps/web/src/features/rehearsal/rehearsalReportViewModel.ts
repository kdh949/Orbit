import type { Deck } from "@orbit/shared/deck";
import type {
  RehearsalReport,
  RehearsalSemanticCueOutcome,
  SemanticFallbackReason,
} from "@orbit/shared/rehearsals";

type SemanticTone = "success" | "warning" | "danger" | "muted";

export type RehearsalSemanticSystemNotice = {
  detail: string;
  label: string;
  source: "system-status";
};

export type RehearsalSemanticReportItem = {
  coveredConcepts: string[];
  cueId: string;
  cueRevision: number;
  evidence: string | null;
  feedback: string | null;
  importanceLabel: string;
  label: string;
  measurementLabel: string;
  missingConcepts: string[];
  reason: RehearsalSemanticSystemNotice | null;
  slideId: string;
  slideLabel: string;
  status: RehearsalSemanticCueOutcome["status"];
  statusLabel: string;
  tone: SemanticTone;
};

export type RehearsalSemanticGoal = {
  cueId: string;
  detail: string;
  evidence: string | null;
  label: string;
  slideLabel: string;
  status: "missed" | "partial";
};

export type RehearsalReportViewModel = {
  keywordCoverage: {
    detail: string;
    valueLabel: string;
  };
  semantic: {
    coverage: {
      coveredCount: number;
      denominator: number;
      missedCount: number;
      partialCount: number;
      percent: number | null;
    };
    excludedItems: RehearsalSemanticReportItem[];
    items: RehearsalSemanticReportItem[];
    measurementLabel: string;
    retryable: boolean;
    state: RehearsalReport["semanticEvaluation"]["state"];
    stateDetail: string;
    stateLabel: string;
    systemNotices: RehearsalSemanticSystemNotice[];
    tone: SemanticTone;
    topGoals: RehearsalSemanticGoal[];
    unmeasuredItems: RehearsalSemanticReportItem[];
  };
};

const FALLBACK_COPY = {
  user_disabled: {
    label: "의미 체크 꺼짐",
    detail: "사용자 설정에 따라 의미 전달을 측정하지 않았어요.",
  },
  permission_denied: {
    label: "마이크 권한 없음",
    detail: "마이크 권한이 없어 음성 근거를 수집하지 못했어요.",
  },
  stt_unavailable: {
    label: "음성 인식 사용 불가",
    detail: "음성 인식을 사용할 수 없어 의미 전달을 측정하지 못했어요.",
  },
  network_error: {
    label: "네트워크 연결 실패",
    detail: "네트워크 연결 문제로 의미 평가를 완료하지 못했어요.",
  },
  provider_unavailable: {
    label: "의미 평가 서비스 사용 불가",
    detail:
      "정밀 의미 평가 서비스를 사용할 수 없어 해당 항목을 측정하지 않았어요.",
  },
  model_not_ready: {
    label: "의미 평가 모델 준비 중",
    detail: "평가 모델이 준비되지 않아 해당 항목을 측정하지 않았어요.",
  },
  model_load_failed: {
    label: "의미 평가 모델 실행 실패",
    detail: "평가 모델을 불러오지 못해 해당 항목을 측정하지 않았어요.",
  },
  timeout: {
    label: "정밀 의미 평가 시간 초과",
    detail: "평가 응답이 늦어 해당 항목은 결과 계산에서 제외했어요.",
  },
  runtime_error: {
    label: "의미 평가 실행 오류",
    detail: "평가 실행 중 오류가 발생해 해당 항목을 측정하지 않았어요.",
  },
  server_evaluation_failed: {
    label: "서버 의미 평가 연결 실패",
    detail:
      "서버 평가를 완료하지 못했어요. 발표 내용과 다른 점수로 계산하지 않았습니다.",
  },
  stale_cue: {
    label: "Cue 재검토 필요",
    detail:
      "슬라이드 내용과 달라진 Cue라서 다시 검토하기 전까지 평가에서 제외했어요.",
  },
  transcript_incomplete: {
    label: "발화 근거 일부 누락",
    detail: "완료된 발화 구간이 부족해 해당 항목을 확정하지 않았어요.",
  },
  no_transcript: {
    label: "발화 근거 없음",
    detail: "확인할 발화 기록이 없어 해당 항목을 측정하지 않았어요.",
  },
  insufficient_evidence: {
    label: "판단할 근거 부족",
    detail: "확실한 발화 근거가 부족해 결과를 단정하지 않았어요.",
  },
  slide_not_visited: {
    label: "발표하지 않은 슬라이드",
    detail: "방문하지 않은 슬라이드라서 의미 전달을 측정하지 않았어요.",
  },
  evaluation_not_run: {
    label: "의미 평가 기록 없음",
    detail: "이 리허설은 의미 평가 기능이 적용되기 전에 생성되었어요.",
  },
  evaluation_snapshot_mismatch: {
    label: "발표 자료 버전 불일치",
    detail:
      "리허설 당시 자료와 현재 평가 기준이 달라 결과 계산에서 제외했어요.",
  },
  queue_dropped: {
    label: "의미 근거 처리 지연",
    detail: "발화 근거를 제시간에 처리하지 못해 해당 항목을 확정하지 않았어요.",
  },
  needs_confirmation: {
    label: "Cue 확인 필요",
    detail: "확실하지 않은 Cue라서 확인하기 전까지 결과 계산에서 제외했어요.",
  },
} satisfies Record<
  SemanticFallbackReason,
  Omit<RehearsalSemanticSystemNotice, "source">
>;

const STATUS_COPY = {
  covered: { label: "전달됨", tone: "success" },
  partial: { label: "일부 전달", tone: "warning" },
  missed: { label: "놓친 의미", tone: "danger" },
  unmeasured: { label: "측정하지 못함", tone: "muted" },
  excluded: { label: "검토 제외", tone: "muted" },
} satisfies Record<
  RehearsalSemanticCueOutcome["status"],
  { label: string; tone: SemanticTone }
>;

const IMPORTANCE_LABELS = {
  core: "핵심",
  supporting: "보조",
  optional: "선택",
} satisfies Record<RehearsalSemanticCueOutcome["importance"], string>;

const IMPORTANCE_ORDER = { core: 0, supporting: 1, optional: 2 } as const;
const STATUS_ORDER = { missed: 0, partial: 1 } as const;

export function buildRehearsalReportViewModel(
  report: RehearsalReport,
  deck: Deck | null,
): RehearsalReportViewModel {
  const slideLabels = buildSlideLabels(deck);
  const semanticItems = report.semanticCueOutcomes.map((outcome) =>
    buildSemanticItem(outcome, slideLabels),
  );
  const items = semanticItems.filter(
    (item) => item.status !== "unmeasured" && item.status !== "excluded",
  );
  const unmeasuredItems = semanticItems.filter(
    (item) => item.status === "unmeasured",
  );
  const excludedItems = semanticItems.filter(
    (item) => item.status === "excluded",
  );
  const coveredCount = items.filter((item) => item.status === "covered").length;
  const partialCount = items.filter((item) => item.status === "partial").length;
  const missedCount = items.filter((item) => item.status === "missed").length;
  const denominator = coveredCount + partialCount + missedCount;
  const evaluation = report.semanticEvaluation;
  const evaluationCopy = getEvaluationCopy(evaluation.state);

  return {
    keywordCoverage: getKeywordCoverage(report),
    semantic: {
      coverage: {
        coveredCount,
        denominator,
        missedCount,
        partialCount,
        percent:
          denominator === 0
            ? null
            : Math.round((coveredCount / denominator) * 100),
      },
      excludedItems,
      items,
      measurementLabel: getMeasurementLabel(evaluation.measurementMode),
      retryable: evaluation.retryable,
      state: evaluation.state,
      stateDetail: evaluationCopy.detail,
      stateLabel: evaluationCopy.label,
      systemNotices: [...new Set(evaluation.reasons)].map(getFallbackCopy),
      tone: evaluationCopy.tone,
      topGoals: buildTopGoals(report.semanticCueOutcomes, slideLabels),
      unmeasuredItems,
    },
  };
}

function buildSemanticItem(
  outcome: RehearsalSemanticCueOutcome,
  slideLabels: ReadonlyMap<string, string>,
): RehearsalSemanticReportItem {
  const statusCopy = STATUS_COPY[outcome.status];
  const reasonCode = outcome.unmeasuredReason ?? outcome.fallbackReason;
  const reason = reasonCode
    ? getFallbackCopy(reasonCode)
    : outcome.status === "excluded"
      ? {
          detail:
            "승인되지 않았거나 현재 슬라이드와 맞지 않는 Cue라서 결과 계산에서 제외했어요.",
          label: "Cue 평가 제외",
          source: "system-status" as const,
        }
      : null;

  return {
    coveredConcepts: outcome.coveredConcepts,
    cueId: outcome.cueId,
    cueRevision: outcome.cueRevision,
    evidence: outcome.evidence?.excerpt ?? null,
    feedback: outcome.feedback ?? null,
    importanceLabel: IMPORTANCE_LABELS[outcome.importance],
    label: outcome.reportLabelSnapshot,
    measurementLabel: getMeasurementLabel(outcome.measurementMode),
    missingConcepts: outcome.missingConcepts,
    reason,
    slideId: outcome.slideId,
    slideLabel: slideLabels.get(outcome.slideId) ?? outcome.slideId,
    status: outcome.status,
    statusLabel: statusCopy.label,
    tone: statusCopy.tone,
  };
}

function buildTopGoals(
  outcomes: readonly RehearsalSemanticCueOutcome[],
  slideLabels: ReadonlyMap<string, string>,
): RehearsalSemanticGoal[] {
  return outcomes
    .filter(
      (
        outcome,
      ): outcome is RehearsalSemanticCueOutcome & {
        status: "missed" | "partial";
      } =>
        outcome.status === "missed" ||
        (outcome.status === "partial" &&
          (outcome.evidence !== undefined ||
            outcome.coveredConcepts.length > 0)),
    )
    .sort((a, b) => {
      const importanceDelta =
        IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance];
      if (importanceDelta !== 0) return importanceDelta;
      const statusDelta = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (statusDelta !== 0) return statusDelta;
      return (
        a.slideId.localeCompare(b.slideId) || a.cueId.localeCompare(b.cueId)
      );
    })
    .slice(0, 3)
    .map((outcome) => ({
      cueId: outcome.cueId,
      detail:
        outcome.missingConcepts.length > 0
          ? `빠진 내용: ${outcome.missingConcepts.join(", ")}`
          : "다음 연습에서 이 핵심 내용을 분명하게 설명해 보세요.",
      evidence: outcome.evidence?.excerpt ?? null,
      label: outcome.reportLabelSnapshot,
      slideLabel: slideLabels.get(outcome.slideId) ?? outcome.slideId,
      status: outcome.status,
    }));
}

function buildSlideLabels(deck: Deck | null) {
  const labels = new Map<string, string>();
  deck?.slides.forEach((slide, index) => {
    const title = slide.title.trim();
    labels.set(
      slide.slideId,
      title ? `슬라이드 ${index + 1} · ${title}` : `슬라이드 ${index + 1}`,
    );
  });
  return labels;
}

function getKeywordCoverage(report: RehearsalReport) {
  if (report.metrics.keywordCoverageMeasurement.state === "unmeasured") {
    return {
      detail: "저장된 장표 키워드가 없어 측정하지 않았어요.",
      valueLabel: "N/A",
    };
  }

  return {
    detail: "저장된 장표 키워드 기준",
    valueLabel: `${Math.round(report.metrics.keywordCoverage * 100)}%`,
  };
}

function getMeasurementLabel(
  mode: RehearsalReport["semanticEvaluation"]["measurementMode"],
) {
  switch (mode) {
    case "full":
      return "정밀 의미 체크";
    case "basic":
      return "기본 의미 체크";
    case "none":
      return "측정 안 됨";
  }
}

function getEvaluationCopy(
  state: RehearsalReport["semanticEvaluation"]["state"],
): { detail: string; label: string; tone: SemanticTone } {
  switch (state) {
    case "succeeded":
      return {
        detail: "측정 가능한 Cue의 의미 전달 결과를 정리했어요.",
        label: "의미 전달 측정 완료",
        tone: "success",
      };
    case "partial":
      return {
        detail: "측정하지 못한 항목은 점수와 개선 목표에서 제외했어요.",
        label: "일부 의미 항목을 측정하지 못했어요",
        tone: "warning",
      };
    case "unavailable":
      return {
        detail:
          "발표가 부족하다는 뜻이 아니며, 측정되지 않은 항목은 점수에 넣지 않았어요.",
        label: "의미 전달 측정을 완료하지 못했어요",
        tone: "muted",
      };
  }
}

function getFallbackCopy(
  reason: SemanticFallbackReason,
): RehearsalSemanticSystemNotice {
  return {
    ...FALLBACK_COPY[reason],
    source: "system-status",
  };
}
