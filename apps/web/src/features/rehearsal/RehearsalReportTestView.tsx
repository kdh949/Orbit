import type { Deck, RehearsalReport } from "@orbit/shared";
import {
  ArrowRight,
  AudioLines,
  CirclePause,
  Clock3,
  Gauge,
  MessageCircleMore,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { RehearsalReportTestNavigator } from "./RehearsalReportTestNavigator";
import { RehearsalReportTestOverview } from "./RehearsalReportTestOverview";
import { RehearsalSlideCanvasPreview } from "./RehearsalSlideCanvasPreview";
import { buildRehearsalTimingAssessment } from "./rehearsalReportTimingAssessment";
import {
  buildRehearsalReportTestSlideMetrics,
  type TestMetricTone,
} from "./rehearsalReportTestViewModel";
import { navigateTo } from "./rehearsalUtils";
import "./rehearsal-report-test-view.css";

type Props = {
  audioPlaybackAvailable?: boolean;
  deck: Deck | null;
  formatDuration: (seconds: number) => string;
  report: RehearsalReport;
};

export function RehearsalReportTestView({
  audioPlaybackAvailable = true,
  deck,
  formatDuration,
  report,
}: Props) {
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const effectiveSelectedSlideId = selectedSlideId;

  useEffect(() => {
    if (
      typeof selectedSlideId === "string" &&
      !deck?.slides.some((slide) => slide.slideId === selectedSlideId)
    ) {
      setSelectedSlideId(null);
    }
  }, [deck, selectedSlideId]);

  const foundIndex =
    deck?.slides.findIndex(
      (slide) => slide.slideId === effectiveSelectedSlideId,
    ) ?? -1;
  const selectedIndex = foundIndex;
  const selectedSlide =
    selectedIndex >= 0 ? (deck?.slides[selectedIndex] ?? null) : null;
  const isOverall = effectiveSelectedSlideId === null;
  const timing = useMemo(
    () =>
      report.slideTimings.find(
        (item) => item.slideId === selectedSlide?.slideId,
      ),
    [report.slideTimings, selectedSlide?.slideId],
  );
  const actualSeconds = timing?.actualSeconds ?? 0;
  const targetSeconds =
    timing?.targetSeconds ?? selectedSlide?.estimatedSeconds ?? 0;
  const actualRatio =
    timing && targetSeconds > 0
      ? Math.min(100, Math.max(4, (actualSeconds / targetSeconds) * 100))
      : 0;
  const actualDurationLabel = timing
    ? formatDuration(actualSeconds)
    : "측정 불가";
  const targetDurationLabel =
    targetSeconds > 0 ? formatDuration(targetSeconds) : "권장 시간 없음";
  const timeAssessment = buildRehearsalTimingAssessment(
    timing ? actualSeconds : null,
    targetSeconds > 0 ? targetSeconds : null,
    formatDuration,
  );
  const timeDeltaLabel = timeAssessment.label;
  const timeTone = timeAssessment.tone;
  const slideTitle =
    selectedSlide?.title?.trim() ||
    (selectedIndex >= 0 ? `슬라이드 ${selectedIndex + 1}` : "전체 발표");
  const slideMetrics = useMemo(
    () =>
      buildRehearsalReportTestSlideMetrics(
        report,
        selectedSlide?.slideId ?? null,
        selectedSlide?.keywords ?? [],
      ),
    [report, selectedSlide?.keywords, selectedSlide?.slideId],
  );
  const findingRows = [
    { icon: Gauge, label: "말하기 속도", ...slideMetrics.speakingRate },
    { icon: MessageCircleMore, label: "습관어", ...slideMetrics.filler },
    { icon: CirclePause, label: "긴 침묵", ...slideMetrics.longSilence },
    { icon: Target, label: "발표 체크포인트", ...slideMetrics.keyMessage },
  ];

  return (
    <section
      className="rrd-test-view"
      aria-label="슬라이드 상세 리포트 테스트 화면"
    >
      {deck && deck.slides.length > 0 ? (
        <RehearsalReportTestNavigator
          deck={deck}
          onSelect={setSelectedSlideId}
          selectedSlideId={effectiveSelectedSlideId}
        />
      ) : (
        <div className="rrd-test-empty">렌더링할 슬라이드가 없습니다.</div>
      )}

      {isOverall && deck && deck.slides.length > 0 ? (
        <RehearsalReportTestOverview
          audioPlaybackAvailable={audioPlaybackAvailable}
          deck={deck}
          formatDuration={formatDuration}
          report={report}
        />
      ) : null}

      <div className={`rrd-test-primary-grid${isOverall ? " is-hidden" : ""}`}>
        <article className="rrd-test-card rrd-test-slide-detail">
          <header>
            <span>SELECTED SLIDE</span>
            <h3>
              {selectedIndex + 1}. {slideTitle}
            </h3>
          </header>
          <div className="rrd-test-slide-body">
            <div className="rrd-test-main-canvas">
              {deck && selectedSlide ? (
                <RehearsalSlideCanvasPreview
                  deck={deck}
                  label={`${selectedIndex + 1}번 슬라이드 ${slideTitle}`}
                  slide={selectedSlide}
                />
              ) : null}
            </div>
            <div className="rrd-test-duration">
              <div className="rrd-test-duration-title">
                <Clock3 aria-hidden="true" size={20} />
                <strong>소요 시간 비교</strong>
              </div>
              <div
                className="rrd-test-duration-legend"
                aria-label="소요 시간 그래프 범례"
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
            <h3>이 슬라이드 핵심 요약</h3>
          </header>
          <div className="rrd-test-summary-list">
            <SummaryRow
              icon={Clock3}
              label="실제 / 권장 시간"
              value={`${actualDurationLabel} / ${targetDurationLabel}`}
              meta={timeDeltaLabel}
              tone={timeTone}
            />
            <SummaryRow
              icon={AudioLines}
              label="말하기 속도"
              value={slideMetrics.speakingRate.value}
              meta={slideMetrics.speakingRate.meta}
              tone={slideMetrics.speakingRate.tone}
            />
            <SummaryRow
              icon={MessageCircleMore}
              label="습관어"
              value={slideMetrics.filler.value}
              meta={slideMetrics.filler.meta}
              tone={slideMetrics.filler.tone}
            />
            <SummaryRow
              icon={CirclePause}
              label="긴 침묵(5초 이상)"
              value={slideMetrics.longSilence.value}
              meta={slideMetrics.longSilence.meta}
              tone={slideMetrics.longSilence.tone}
            />
          </div>
          <p className="rrd-test-mock-note">
            리허설 분석 결과를 기준으로 표시합니다.
          </p>
        </aside>
      </div>

      <section className={`rrd-test-findings${isOverall ? " is-hidden" : ""}`}>
        <header>
          <span>COACHING CHECK</span>
          <h3>이 슬라이드에서 확인한 점</h3>
        </header>
        <div className="rrd-test-findings-list">
          {findingRows.map((finding) => {
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

      <section
        className={`rrd-test-next-practice${isOverall ? " is-hidden" : ""}`}
      >
        <span className="rrd-test-next-icon">
          <Target aria-hidden="true" size={24} />
        </span>
        <div>
          <span>NEXT PRACTICE</span>
          <strong>{slideMetrics.nextPractice}</strong>
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
    </section>
  );
}

type SummaryRowProps = {
  icon: typeof Clock3;
  label: string;
  meta: string;
  tone?: TestMetricTone;
  value: string;
};

function SummaryRow({ icon: Icon, label, meta, tone, value }: SummaryRowProps) {
  return (
    <div className="rrd-test-summary-row">
      <span className="rrd-test-summary-icon">
        <Icon aria-hidden="true" size={20} />
      </span>
      <span>{label}</span>
      <strong>{value}</strong>
      <em className={tone ? `is-${tone}` : undefined}>{meta}</em>
    </div>
  );
}
