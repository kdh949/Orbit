import type { Deck, RehearsalReport } from "@orbit/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  AudioLines,
  CirclePause,
  Clock3,
  Layers3,
  MessageCircleMore,
  Target,
} from "lucide-react";
import {
  FillerMetricDetails,
  LongSilenceMetricDetails,
  SpeakingRateMetricDetails,
} from "./RehearsalReportTestMetricDetails";
import { resolveOverallSpeakingRate } from "./rehearsalReportOverallSpeakingRate";
import { buildRehearsalTimingAssessment } from "./rehearsalReportTimingAssessment";
import { navigateTo } from "./rehearsalUtils";

type Props = {
  audioPlaybackAvailable: boolean;
  deck: Deck;
  formatDuration: (seconds: number) => string;
  report: RehearsalReport;
};

export function RehearsalReportTestOverview({
  audioPlaybackAvailable,
  deck,
  formatDuration,
  report,
}: Props) {
  const totalActualSeconds = report.slideTimings.reduce(
    (sum, timing) => sum + timing.actualSeconds,
    0,
  );
  const totalTargetSeconds = report.slideTimings.reduce(
    (sum, timing) => sum + timing.targetSeconds,
    0,
  );
  const actualDurationLabel =
    report.slideTimings.length > 0
      ? formatDuration(totalActualSeconds)
      : "측정 불가";
  const targetDurationLabel =
    totalTargetSeconds > 0
      ? formatDuration(totalTargetSeconds)
      : "권장 시간 없음";
  const actualRatio =
    totalTargetSeconds > 0
      ? Math.min(
          100,
          Math.max(4, (totalActualSeconds / totalTargetSeconds) * 100),
        )
      : 0;
  const timeAssessment = buildRehearsalTimingAssessment(
    report.slideTimings.length > 0 ? totalActualSeconds : null,
    totalTargetSeconds > 0 ? totalTargetSeconds : null,
    formatDuration,
  );
  const timeDeltaLabel = timeAssessment.label;
  const timeTone = timeAssessment.tone;

  const overallSpeakingRate = resolveOverallSpeakingRate(report);
  const speakingRateAvailable =
    overallSpeakingRate.charactersPerMinute !== null;
  const speakingRateValue = speakingRateAvailable
    ? `분당 ${overallSpeakingRate.charactersPerMinute}자`
    : "확인 불가";
  const speakingRateMeta =
    overallSpeakingRate.source === "overall"
      ? "전체 발화 기준"
      : overallSpeakingRate.source === "slide-average"
        ? "슬라이드 평균"
        : "발화 분석 정보 없음";
  const longSilenceValue =
    report.metrics.longSilenceCount == null
      ? "확인 불가"
      : `${report.metrics.longSilenceCount}회`;
  const measuredSpeakingRates = report.slideInsights
    .map((insight) => insight.speakingRate)
    .filter((rate) => rate.measurementState === "measured");
  const fasterSlideCount = measuredSpeakingRates.filter(
    (rate) => rate.paceCategory === "faster",
  ).length;
  const slowerSlideCount = measuredSpeakingRates.filter(
    (rate) => rate.paceCategory === "slower",
  ).length;
  const speakingRateFinding =
    measuredSpeakingRates.length === 0
      ? {
          description: "비교할 수 있는 슬라이드별 발화 속도 기록이 없습니다.",
          status: "확인 불가",
          tone: "muted" as const,
        }
      : fasterSlideCount + slowerSlideCount > 0
        ? {
            description: `분석된 ${measuredSpeakingRates.length}개 슬라이드 중 빠른 구간 ${fasterSlideCount}개, 느린 구간 ${slowerSlideCount}개가 확인됐습니다.`,
            status: "편차 있음",
            tone: "warning" as const,
          }
        : {
            description: `분석된 ${measuredSpeakingRates.length}개 슬라이드가 이번 발표 기준과 비슷한 속도였습니다.`,
            status: "비슷",
            tone: "success" as const,
          };
  const overallFindings = [
    { icon: AudioLines, label: "말하기 속도", ...speakingRateFinding },
    {
      icon: MessageCircleMore,
      label: "습관어",
      description:
        report.metrics.fillerWordCount === 0
          ? "전체 발표에서 습관어가 감지되지 않았습니다."
          : `전체 발표에서 습관어가 ${report.metrics.fillerWordCount}회 감지됐습니다.`,
      status: report.metrics.fillerWordCount >= 2 ? "많음" : "적정",
      tone:
        report.metrics.fillerWordCount >= 2
          ? ("warning" as const)
          : ("success" as const),
    },
    {
      icon: CirclePause,
      label: "긴 침묵",
      description:
        report.metrics.longSilenceCount == null
          ? "전체 긴 침묵 분석 결과를 확인할 수 없습니다."
          : report.metrics.longSilenceCount === 0
            ? "5초 이상 발화가 없었던 구간이 없습니다."
            : `5초 이상 발화가 없었던 구간이 ${report.metrics.longSilenceCount}회 있었습니다.`,
      status:
        report.metrics.longSilenceCount == null
          ? "확인 불가"
          : report.metrics.longSilenceCount > 0
            ? "발생"
            : "없음",
      tone:
        report.metrics.longSilenceCount == null
          ? ("muted" as const)
          : report.metrics.longSilenceCount > 0
            ? ("warning" as const)
            : ("success" as const),
    },
  ];
  const nextPractice =
    report.coaching?.nextPracticeFocus?.trim() ||
    "슬라이드 전환마다 핵심 문장을 한 번씩 강조해 보세요.";

  return (
    <div className="rrd-test-overall">
      <div className="rrd-test-primary-grid">
        <article className="rrd-test-card rrd-test-slide-detail rrd-test-overall-detail">
          <header>
            <span>ALL SLIDES</span>
            <h3>전체 발표 · {deck.slides.length}장</h3>
          </header>
          <div className="rrd-test-slide-body">
            <div className="rrd-test-overall-slide-count">
              <span>
                <Layers3 aria-hidden="true" size={28} />
              </span>
              <strong>{deck.slides.length}장</strong>
              <small>전체 슬라이드</small>
            </div>
            <div className="rrd-test-duration">
              <div className="rrd-test-duration-title">
                <Clock3 aria-hidden="true" size={20} />
                <strong>소요 시간 비교</strong>
              </div>
              <div
                className="rrd-test-duration-legend"
                aria-label="전체 소요 시간 그래프 범례"
              >
                <span>
                  <i className="is-actual" aria-hidden="true" />
                  실제 소요 시간
                </span>
                <span>
                  <i className="is-target" aria-hidden="true" />
                  권장 소요 시간
                </span>
              </div>
              <div className="rrd-test-duration-row">
                <span>실제 소요 시간</span>
                <b>{actualDurationLabel}</b>
                <div className="rrd-test-duration-track">
                  <i style={{ width: `${actualRatio}%` }} />
                </div>
              </div>
              <div className="rrd-test-duration-row is-target">
                <span>권장 소요 시간</span>
                <b>{targetDurationLabel}</b>
                <div className="rrd-test-duration-track">
                  <i />
                </div>
              </div>
              <div className="rrd-test-duration-delta">
                <span>시간 차이</span>
                <strong className={`is-${timeTone}`}>{timeDeltaLabel}</strong>
              </div>
            </div>
          </div>
        </article>

        <aside className="rrd-test-card rrd-test-summary">
          <header>
            <span>AT A GLANCE</span>
            <h3>전체 발표 핵심 요약</h3>
          </header>
          <div className="rrd-test-summary-list">
            <OverviewSummaryRow
              icon={Clock3}
              label="실제 / 권장 시간"
              value={`${actualDurationLabel} / ${targetDurationLabel}`}
              meta={timeDeltaLabel}
              tone={timeTone}
            />
            <OverviewSummaryRow
              details={
                <SpeakingRateMetricDetails deck={deck} report={report} />
              }
              detailsHint="슬라이드별 속도와 판정"
              detailsLabel="슬라이드별 말하기 속도"
              icon={AudioLines}
              label="말하기 속도"
              value={speakingRateValue}
              meta={speakingRateMeta}
              tone={speakingRateAvailable ? "success" : "muted"}
            />
            <OverviewSummaryRow
              details={<FillerMetricDetails report={report} />}
              detailsHint="단어별 사용 횟수와 비중"
              detailsLabel="사용한 습관어"
              icon={MessageCircleMore}
              label="습관어"
              value={`${report.metrics.fillerWordCount}회`}
              meta="전체 발표 합계"
              tone={report.metrics.fillerWordCount >= 2 ? "warning" : "success"}
            />
            <OverviewSummaryRow
              details={
                <LongSilenceMetricDetails
                  audioPlaybackAvailable={audioPlaybackAvailable}
                  deck={deck}
                  formatDuration={formatDuration}
                  report={report}
                />
              }
              detailsHint="5초 이상 발화가 없었던 위치"
              detailsLabel="긴 침묵 발생 구간"
              icon={CirclePause}
              label="긴 침묵(5초 이상)"
              value={longSilenceValue}
              meta={
                report.metrics.longSilenceCount == null
                  ? "음성 분석 정보 없음"
                  : "전체 발표 합계"
              }
              tone={
                report.metrics.longSilenceCount == null
                  ? "muted"
                  : report.metrics.longSilenceCount > 0
                    ? "warning"
                    : "success"
              }
            />
          </div>
          <p className="rrd-test-mock-note">
            모든 슬라이드의 리허설 분석 결과를 합산합니다.
          </p>
        </aside>
      </div>

      <section className="rrd-test-findings">
        <header>
          <span>COACHING CHECK</span>
          <h3>전체 발표에서 확인한 점</h3>
        </header>
        <div className="rrd-test-findings-list">
          {overallFindings.map((finding) => {
            const Icon = finding.icon;
            return (
              <div className="rrd-test-finding" key={finding.label}>
                <span className="rrd-test-finding-icon">
                  <Icon aria-hidden="true" size={20} />
                </span>
                <strong>{finding.label}</strong>
                <p>{finding.description}</p>
                <em className={`is-${finding.tone}`}>{finding.status}</em>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rrd-test-next-practice">
        <span className="rrd-test-next-icon">
          <Target aria-hidden="true" size={24} />
        </span>
        <div>
          <span>NEXT PRACTICE</span>
          <strong>{nextPractice}</strong>
        </div>
        <button
          type="button"
          onClick={() =>
            navigateTo(`/rehearsal/${encodeURIComponent(report.projectId)}`)
          }
        >
          연습하기 <ArrowRight aria-hidden="true" size={18} />
        </button>
      </section>
    </div>
  );
}

type OverviewSummaryRowProps = {
  details?: ReactNode;
  detailsHint?: string;
  detailsLabel?: string;
  icon: typeof Clock3;
  label: string;
  meta: string;
  tone: "danger" | "muted" | "success" | "warning";
  value: string;
};

function OverviewSummaryRow({
  details,
  detailsHint,
  detailsLabel,
  icon: Icon,
  label,
  meta,
  tone,
  value,
}: OverviewSummaryRowProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelDetailsClose = () => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const openDetails = () => {
    cancelDetailsClose();
    setDetailsOpen(true);
  };
  const scheduleDetailsClose = () => {
    cancelDetailsClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setDetailsOpen(false);
    }, 250);
  };

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

  return (
    <div
      className={`rrd-test-summary-row${details ? " has-details" : ""}`}
      onMouseEnter={openDetails}
      onMouseLeave={scheduleDetailsClose}
    >
      <span className="rrd-test-summary-icon">
        <Icon aria-hidden="true" size={20} />
      </span>
      <span>{label}</span>
      <strong>{value}</strong>
      <em className={`is-${tone}`}>{meta}</em>
      {details && detailsOpen ? (
        <aside
          aria-label={detailsLabel}
          className="rrd-test-metric-popover"
          onMouseEnter={openDetails}
          onMouseLeave={scheduleDetailsClose}
        >
          <header>
            <strong>{detailsLabel}</strong>
            <span>{detailsHint}</span>
          </header>
          {details}
        </aside>
      ) : null}
    </div>
  );
}
