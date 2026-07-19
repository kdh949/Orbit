
import { useId, useMemo, useState } from "react";
import type { Deck, RehearsalReport } from "@orbit/shared";
import { RehearsalSlideCanvasPreview } from "./RehearsalSlideCanvasPreview";

type Props = {
  deck: Deck | null;
  formatDuration: (totalSeconds: number) => string;
  slideInsights: RehearsalReport["slideInsights"];
  slideTimings: RehearsalReport["slideTimings"];
};

type SlideSpeakingRate =
  RehearsalReport["slideInsights"][number]["speakingRate"];

type SlideDurationPoint = RehearsalReport["slideTimings"][number] & {
  cumulativeActualSeconds: number;
  index: number;
  isOver: boolean;
  slideName: string;
  slide: Deck["slides"][number] | null;
};

function getSlide(deck: Deck, slideId: string) {
  return deck.slides.find((slide) => slide.slideId === slideId);
}

function getSlideName(deck: Deck, slideId: string) {
  const slide = getSlide(deck, slideId);
  if (!slide) return slideId;
  const title = slide.title.trim();
  return title || `슬라이드 ${slide.order}`;
}

function formatAxis(totalSeconds: number) {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  if (minutes === 0) {
    return `${seconds}초`;
  }
  return `${minutes}분 ${seconds.toString().padStart(2, "0")}초`;
}

export function speakingRateLabel(speakingRate: SlideSpeakingRate | undefined) {
  if (!speakingRate) return "발화 속도 분석 정보가 없어요";
  if (speakingRate.measurementState === "unmeasured") {
    switch (speakingRate.reasonCode) {
      case "UNSUPPORTED_LANGUAGE": return "발화 언어를 확인할 수 없어요";
      case "SEGMENT_TIMESTAMPS_UNAVAILABLE": return "발화 구간 시간 정보가 없어요";
      case "BASELINE_UNAVAILABLE": return "비교할 슬라이드 발화가 부족해요";
      case "LEGACY_REPORT": return "이전 분석에는 발화 속도 정보가 없어요";
      case "INSUFFICIENT_SLIDE_SPEECH": return "분석할 발화가 부족해요";
    }
  }
  if (speakingRate.paceCategory === "slower") return "이번 발표 기준보다 느린 편";
  if (speakingRate.paceCategory === "faster") return "이번 발표 기준보다 빠른 편";
  return "이번 발표 기준과 비슷";
}

function timingDeltaLabel(actualSeconds: number, targetSeconds: number, formatDuration: (totalSeconds: number) => string) {
  const deltaSeconds = actualSeconds - targetSeconds;
  if (Math.abs(deltaSeconds) < 0.5) return "권장 시간과 같아요";
  return deltaSeconds > 0
    ? `권장보다 ${formatDuration(deltaSeconds)} 길어요`
    : `권장보다 ${formatDuration(Math.abs(deltaSeconds))} 짧아요`;
}

function roundedTopBarPath(
  x: number,
  width: number,
  top: number,
  bottom: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, Math.max(0, bottom - top));
  if (bottom - top <= 0) return "";
  if (r <= 0) {
    return `M ${x} ${bottom} L ${x} ${top} L ${x + width} ${top} L ${x + width} ${bottom} Z`;
  }
  return [
    `M ${x} ${bottom}`,
    `L ${x} ${top + r}`,
    `Q ${x} ${top} ${x + r} ${top}`,
    `L ${x + width - r} ${top}`,
    `Q ${x + width} ${top} ${x + width} ${top + r}`,
    `L ${x + width} ${bottom}`,
    "Z",
  ].join(" ");
}

function buildSlideDurationSeries(
  deck: Deck | null,
  slideTimings: RehearsalReport["slideTimings"],
): SlideDurationPoint[] {
  if (!deck || slideTimings.length === 0) {
    return [];
  }

  let cumulativeActualSeconds = 0;
  return slideTimings.map((timing, index) => {
    cumulativeActualSeconds += timing.actualSeconds;
    const slide = getSlide(deck, timing.slideId);
    return {
      ...timing,
      cumulativeActualSeconds,
      index,
      isOver: timing.actualSeconds > timing.targetSeconds,
      slideName: getSlideName(deck, timing.slideId),
      slide: slide ?? null,
    };
  });
}

function buildSlideTimingChartModel(slideDurationSeries: SlideDurationPoint[]) {
  if (slideDurationSeries.length === 0) {
    return null;
  }

  const chartWidth = 720;
  const chartHeight = 216;
  const paddingX = 28;
  const paddingTop = 20;
  const paddingBottom = 30;
  const plotWidth = chartWidth - paddingX * 2;
  const plotHeight = chartHeight - paddingTop - paddingBottom;
  const bottomY = chartHeight - paddingBottom;
  const pointCount = slideDurationSeries.length;
  const columnWidth = plotWidth / pointCount;
  const barWidth = columnWidth * 0.44;
  const maxSeconds = Math.max(
    1,
    ...slideDurationSeries.map((item) =>
      Math.max(item.actualSeconds, item.targetSeconds),
    ),
  );

  const toY = (seconds: number) =>
    paddingTop + (1 - seconds / maxSeconds) * plotHeight;

  const points = slideDurationSeries.map((item, index) => {
    const centerX = paddingX + columnWidth * index + columnWidth / 2;
    const barX = centerX - barWidth / 2;
    const baseSeconds = Math.min(item.actualSeconds, item.targetSeconds);
    const baseTopY = toY(baseSeconds);
    const overflowTopY = toY(item.actualSeconds);
    const targetY = toY(item.targetSeconds);

    return {
      ...item,
      barPath: roundedTopBarPath(
        barX,
        barWidth,
        baseTopY,
        bottomY,
        item.isOver ? 0 : 6,
      ),
      actualY: toY(item.actualSeconds),
      barX,
      centerX,
      overflowPath: item.isOver
        ? roundedTopBarPath(barX, barWidth, overflowTopY, baseTopY, 6)
        : "",
      targetY,
    };
  });

  const targetLinePath = points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.centerX.toFixed(2)} ${point.targetY.toFixed(2)}`,
    )
    .join(" ");
  const yTicks = [maxSeconds, maxSeconds / 2, 0].map((seconds) => ({
    label: formatAxis(seconds),
    y: toY(seconds),
  }));

  return {
    bottomY,
    chartHeight,
    chartWidth,
    points,
    targetLinePath,
    yTicks,
  };
}

export function RehearsalSlideTimingOverview({ deck, formatDuration, slideInsights, slideTimings }: Props) {
  const gradientId = useId();
  const slideDurationSeries = useMemo(() => buildSlideDurationSeries(deck, slideTimings), [deck, slideTimings]);
  const chart = useMemo(() => buildSlideTimingChartModel(slideDurationSeries), [slideDurationSeries]);
  const speakingRateBySlideId = useMemo(() => new Map(slideInsights.map((insight) => [insight.slideId, insight.speakingRate])), [slideInsights]);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const selectedPoint = chart?.points.find((point) => point.slideId === selectedSlideId) ?? chart?.points[0] ?? null;
  const selectedSpeakingRate = selectedPoint ? speakingRateBySlideId.get(selectedPoint.slideId) : undefined;
  const overCount = slideDurationSeries.filter((item) => item.isOver).length;
  const actualGradientId = `${gradientId}-actual`;
  const overGradientId = `${gradientId}-over`;

  return (
    <div className="rrd-overview-panel rrd-overview-panel-wide rrd-timing-overview">
      <div className="rrd-overview-panel-head">
        <div className="rrd-timing-heading">
          <h3 className="rrd-section-label">슬라이드별 소요 시간</h3>
          <span>슬라이드를 선택하면 해당 시간 수치를 강조해서 보여드려요.</span>
        </div>
        {slideDurationSeries.length > 0 && (
          <div className="rrd-overview-panel-actions">
            {overCount > 0 && <strong className="rrd-timing-over-badge">{overCount}개 슬라이드 초과</strong>}
            <strong className="rrd-cumulative-total">전체 {slideDurationSeries.length}개</strong>
          </div>
        )}
      </div>
      {chart && selectedPoint ? (
        <div className="rrd-timing-explorer">
          <div className="rrd-timing-graph-pane">
            <div className="rrd-timing-selection-summary" aria-live="polite">
              <div className="rrd-timing-selection-title">
                <span>{selectedPoint.index + 1}번 슬라이드</span>
                <strong title={selectedPoint.slideName}>{selectedPoint.slideName}</strong>
              </div>
              <dl className="rrd-timing-selection-values">
                <div><dt>소요</dt><dd>{formatDuration(selectedPoint.actualSeconds)}</dd></div>
                <div><dt>권장</dt><dd>{formatDuration(selectedPoint.targetSeconds)}</dd></div>
              </dl>
              <p className={`rrd-timing-selection-delta ${selectedPoint.actualSeconds > selectedPoint.targetSeconds ? "is-over" : "is-under"}`}>
                {timingDeltaLabel(selectedPoint.actualSeconds, selectedPoint.targetSeconds, formatDuration)}
              </p>
              <span className={`rrd-slide-speaking-rate is-${selectedSpeakingRate?.paceCategory ?? "unmeasured"}`}>{speakingRateLabel(selectedSpeakingRate)}</span>
            </div>
            <div className="rrd-timing-legend">
              <span className="rrd-timing-legend-item"><i className="rrd-timing-legend-swatch is-actual" />실제 소요 시간</span>
              <span className="rrd-timing-legend-item"><i className="rrd-timing-legend-swatch is-over" />권장 시간 초과</span>
              <span className="rrd-timing-legend-item"><i className="rrd-timing-legend-line" />권장 소요 시간</span>
            </div>
            <div className="rrd-cumulative-chart-shell">
              <div className="rrd-cumulative-axis">
                {chart.yTicks.map((tick) => <span key={tick.label} className="rrd-cumulative-axis-label" style={{ top: `${(tick.y / chart.chartHeight) * 100}%` }}>{tick.label}</span>)}
              </div>
              <svg viewBox={`0 0 ${chart.chartWidth} ${chart.chartHeight}`} className="rrd-cumulative-chart" role="img" aria-label="슬라이드별 권장 소요 시간과 실제 소요 시간 비교 그래프">
                <defs>
                  <linearGradient id={actualGradientId} x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="var(--redesign-color-primary-container)" /><stop offset="100%" stopColor="var(--redesign-color-primary)" /></linearGradient>
                  <linearGradient id={overGradientId} x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="var(--redesign-color-error-container)" /><stop offset="100%" stopColor="var(--redesign-color-error)" /></linearGradient>
                </defs>
                {chart.yTicks.map((tick) => <line key={tick.label} className="rrd-cumulative-gridline" x1="0" x2={chart.chartWidth} y1={tick.y} y2={tick.y} />)}
                {chart.points.map((point) => {
                  const isSelected = point.slideId === selectedPoint.slideId;
                  return <path key={`${point.slideId}-base`} className={`rrd-timing-bar${isSelected ? " is-selected" : " is-muted"}`} d={point.barPath} fill={`url(#${actualGradientId})`} />;
                })}
                {chart.points.map((point) => {
                  const isSelected = point.slideId === selectedPoint.slideId;
                  return point.overflowPath ? <path key={`${point.slideId}-over`} className={`rrd-timing-bar rrd-timing-overflow${isSelected ? " is-selected" : " is-muted"}`} d={point.overflowPath} fill={`url(#${overGradientId})`} /> : null;
                })}
                <path d={chart.targetLinePath} className="rrd-timing-target-line" />
                {chart.points.map((point) => {
                  const isSelected = point.slideId === selectedPoint.slideId;
                  return <g key={`${point.slideId}-target`} className={`rrd-timing-target-marker${isSelected ? " is-selected" : " is-muted"}`}><circle className="rrd-timing-target-point-ring" cx={point.centerX} cy={point.targetY} r={isSelected ? 8 : 6} /><circle className="rrd-timing-target-point" cx={point.centerX} cy={point.targetY} r={isSelected ? 4 : 3} /></g>;
                })}
                {chart.points.map((point) => <text key={`${point.slideId}-x-label`} className={`rrd-cumulative-x-label${point.slideId === selectedPoint.slideId ? " is-selected" : " is-muted"}`} x={point.centerX} y={chart.chartHeight - 8} textAnchor="middle">{point.index + 1}</text>)}
                <text className="rrd-timing-selected-value" x={selectedPoint.centerX} y={Math.max(14, selectedPoint.actualY - 8)} textAnchor="middle">{formatAxis(selectedPoint.actualSeconds)}</text>
              </svg>
            </div>
          </div>
          <nav className="rrd-timing-slide-rail" aria-label="소요 시간 슬라이드 선택">
            <div className="rrd-timing-slide-rail-head"><span>슬라이드</span><strong>{chart.points.length}</strong></div>
            <div className="rrd-timing-slide-rail-list">
              {chart.points.map((point) => {
                const isSelected = point.slideId === selectedPoint.slideId;
                return (
                  <button key={`${point.slideId}-${point.index}`} type="button" className={`rrd-timing-slide-option${isSelected ? " is-selected" : ""}`} aria-label={`${point.index + 1}번 슬라이드 ${point.slideName} 선택`} aria-pressed={isSelected} onClick={() => setSelectedSlideId(point.slideId)}>
                    <span className="rrd-timing-slide-thumb" aria-hidden="true">{point.slide && deck ? <RehearsalSlideCanvasPreview ariaHidden deck={deck} slide={point.slide} /> : null}</span>
                    <span className="rrd-timing-slide-option-meta">
                      <strong>{point.index + 1}번 슬라이드</strong>
                      <em className={point.isOver ? "is-over" : ""}>
                        {point.isOver ? "권장 초과" : "권장 이내"}
                      </em>
                    </span>
                    <span className="rrd-timing-slide-option-title" title={point.slideName}>{point.slideName}</span>
                    <span className="rrd-timing-slide-option-times">
                      <span><small>소요</small><strong>{formatDuration(point.actualSeconds)}</strong></span>
                      <span><small>권장</small><strong>{formatDuration(point.targetSeconds)}</strong></span>
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>
        </div>
      ) : <p className="rrd-empty-hint">슬라이드 타이밍 데이터가 없습니다.</p>}
    </div>
  );
}
