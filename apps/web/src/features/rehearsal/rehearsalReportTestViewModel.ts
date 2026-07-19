import type { Deck, RehearsalReport } from "@orbit/shared";
import { buildFiveSecondLongSilenceCountBySlide } from "./rehearsalSlideAnalysisModel";

export type TestMetricTone = "danger" | "muted" | "success" | "warning";

export type TestViewMetric = {
  description: string;
  meta: string;
  status: string;
  tone: TestMetricTone;
  value: string;
};

export type RehearsalReportTestSlideMetrics = {
  filler: TestViewMetric;
  keyMessage: TestViewMetric;
  longSilence: TestViewMetric;
  nextPractice: string;
  speakingRate: TestViewMetric;
};

const SPEAKING_RATE_REASON: Record<
  RehearsalReport["slideInsights"][number]["speakingRate"]["reasonCode"] &
    string,
  string
> = {
  UNSUPPORTED_LANGUAGE: "발화 언어를 확인할 수 없음",
  SEGMENT_TIMESTAMPS_UNAVAILABLE: "발화 구간 시간 정보 없음",
  INSUFFICIENT_SLIDE_SPEECH: "분석할 발화가 부족함",
  BASELINE_UNAVAILABLE: "비교할 슬라이드 발화가 부족함",
  LEGACY_REPORT: "이전 형식의 리포트",
};

export function buildRehearsalReportTestSlideMetrics(
  report: RehearsalReport,
  slideId: string | null,
  keywords: Deck["slides"][number]["keywords"] = [],
): RehearsalReportTestSlideMetrics {
  if (!slideId) {
    const unavailable = unavailableMetric("선택된 슬라이드가 없습니다.");
    return {
      filler: unavailable,
      keyMessage: unavailable,
      longSilence: unavailable,
      nextPractice: defaultNextPractice(report),
      speakingRate: unavailable,
    };
  }

  const insight = report.slideInsights.find((item) => item.slideId === slideId);
  const longSilenceCounts = buildFiveSecondLongSilenceCountBySlide(report);

  return {
    filler: buildFillerMetric(insight?.fillerWordCount),
    keyMessage: buildRequiredKeywordMetric(report, slideId, keywords),
    longSilence: buildLongSilenceMetric(
      longSilenceCounts?.get(slideId) ?? null,
    ),
    nextPractice: buildNextPractice(report, slideId),
    speakingRate: buildSpeakingRateMetric(insight?.speakingRate),
  };
}

function buildSpeakingRateMetric(
  rate: RehearsalReport["slideInsights"][number]["speakingRate"] | undefined,
): TestViewMetric {
  if (!rate) {
    return unavailableMetric("슬라이드별 속도 분석 결과 없음");
  }

  const charactersPerMinute =
    rate.activeSpeechSeconds > 0 && rate.characterCount > 0
      ? Math.round((rate.characterCount / rate.activeSpeechSeconds) * 60)
      : null;

  if (rate.measurementState === "unmeasured") {
    if (
      rate.reasonCode === "BASELINE_UNAVAILABLE" &&
      charactersPerMinute !== null
    ) {
      return {
        description: `분당 ${charactersPerMinute}자로 측정됐지만 비교할 슬라이드 발화가 부족합니다.`,
        meta: "유효한 슬라이드 발화 3개 이상 필요",
        status: "비교 불가",
        tone: "muted",
        value: `분당 ${charactersPerMinute}자`,
      };
    }
    const reason = rate.reasonCode
      ? SPEAKING_RATE_REASON[rate.reasonCode]
      : "슬라이드별 속도 분석 결과 없음";
    return unavailableMetric(reason);
  }

  const measuredCharactersPerMinute = Math.round(rate.charactersPerSecond * 60);
  const deltaPercent = Math.round((rate.relativeRateRatio - 1) * 100);
  const absoluteDelta = Math.abs(deltaPercent);
  const meta =
    deltaPercent === 0
      ? "이번 발표 기준과 동일"
      : `이번 발표 기준 대비 ${deltaPercent > 0 ? "+" : "-"}${absoluteDelta}%`;

  if (rate.paceCategory === "faster") {
    return {
      description: `이번 발표 기준보다 약 ${absoluteDelta}% 빠르게 말했습니다.`,
      meta,
      status: "빠름",
      tone: "danger",
      value: `분당 ${measuredCharactersPerMinute}자`,
    };
  }
  if (rate.paceCategory === "slower") {
    return {
      description: `이번 발표 기준보다 약 ${absoluteDelta}% 느리게 말했습니다.`,
      meta,
      status: "느림",
      tone: "warning",
      value: `분당 ${measuredCharactersPerMinute}자`,
    };
  }
  return {
    description: "이번 발표의 다른 슬라이드와 비슷한 속도로 말했습니다.",
    meta,
    status: "비슷",
    tone: "success",
    value: `분당 ${measuredCharactersPerMinute}자`,
  };
}
function buildFillerMetric(count: number | null | undefined): TestViewMetric {
  if (count == null)
    return unavailableMetric("슬라이드별 습관어 분석 결과 없음");
  const isHigh = count >= 2;
  return {
    description:
      count === 0
        ? "이 슬라이드에서 습관어가 감지되지 않았습니다."
        : `이 슬라이드에서 습관어가 ${count}회 감지되었습니다.`,
    meta: "권장 0~1회",
    status: isHigh ? "많음" : "적정",
    tone: isHigh ? "danger" : "success",
    value: `${count}회`,
  };
}

function buildLongSilenceMetric(count: number | null): TestViewMetric {
  if (count == null) return unavailableMetric("5초 이상 침묵 분석 결과 없음");
  const occurred = count > 0;
  return {
    description:
      count === 0
        ? "5초 이상 발화가 없었던 구간이 없습니다."
        : `5초 이상 발화가 없었던 구간이 ${count}회 발생했습니다.`,
    meta: "권장 0회",
    status: occurred ? "발생" : "없음",
    tone: occurred ? "warning" : "success",
    value: `${count}회`,
  };
}

function buildRequiredKeywordMetric(
  report: RehearsalReport,
  slideId: string,
  keywords: Deck["slides"][number]["keywords"],
): TestViewMetric {
  const requiredKeywords = keywords.filter((keyword) => keyword.required);
  if (requiredKeywords.length === 0) {
    return unavailableMetric("이 슬라이드에 등록된 필수 키워드가 없습니다.");
  }

  if (report.metrics.keywordCoverageMeasurement.state !== "measured") {
    return unavailableMetric(
      "슬라이드별 발화 기록이 부족해 필수 키워드를 확인할 수 없습니다.",
    );
  }

  const requiredKeywordIds = new Set(
    requiredKeywords.map((keyword) => keyword.keywordId),
  );
  const missed = report.missedKeywords.filter(
    (keyword) =>
      keyword.slideId === slideId && requiredKeywordIds.has(keyword.keywordId),
  );
  const matchedCount = requiredKeywords.length - missed.length;
  const tone: TestMetricTone =
    missed.length === 0 ? "success" : matchedCount === 0 ? "danger" : "warning";

  return {
    description: `필수 키워드 ${requiredKeywords.length}개 중 ${matchedCount}개가 발화 기록에서 확인됐습니다.`,
    meta:
      missed.length > 0
        ? `미전달: ${missed.map((keyword) => keyword.text).join(", ")}`
        : "모든 필수 키워드 전달",
    status:
      tone === "success" ? "전달" : tone === "warning" ? "일부 전달" : "미전달",
    tone,
    value: `${matchedCount} / ${requiredKeywords.length}개`,
  };
}
function buildNextPractice(report: RehearsalReport, slideId: string) {
  const slideFeedback = report.semanticCueOutcomes.find(
    (outcome) =>
      outcome.slideId === slideId &&
      (outcome.status === "missed" || outcome.status === "partial") &&
      outcome.feedback,
  )?.feedback;

  return slideFeedback || defaultNextPractice(report);
}

function defaultNextPractice(report: RehearsalReport) {
  return (
    report.coaching?.nextPracticeFocus.trim() ||
    "측정된 개선 항목을 중심으로 같은 슬라이드를 한 번 더 연습해 보세요."
  );
}

function unavailableMetric(description: string): TestViewMetric {
  return {
    description,
    meta: "데이터 없음",
    status: "확인 불가",
    tone: "muted",
    value: "측정 불가",
  };
}
