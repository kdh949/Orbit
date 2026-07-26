import {
  classifyLoudnessStability,
  isWithinTargetRange,
  slidePracticeMetricTargets,
  type SlidePracticeReportRecord,
} from "@orbit/shared/slide-practice";
import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  buildPracticeTrendSeries,
  comparablePracticeReports,
  practiceTrendMetricOptions,
  type PracticeTrendMetric,
  type PracticeTrendSeries,
} from "./practiceTrend";
import { PracticeCelebrationFeedback } from "./PracticeCelebrationFeedback";
import { practiceCelebrationOutcome } from "./practiceCelebration";

export function PracticeTrendDashboard(props: {
  animationSessionId?: string | null;
  reports: readonly SlidePracticeReportRecord[];
  slideContentHash: string;
}) {
  const [metric, setMetric] = useState<PracticeTrendMetric>("fillerRate");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const comparable = comparablePracticeReports(props.reports, props.slideContentHash);
  const series = buildPracticeTrendSeries({
    reports: comparable,
    slideContentHash: props.slideContentHash,
    metric,
  });
  const latest = comparable.at(-1) ?? null;
  const celebration = latest ? practiceCelebrationOutcome(latest) : null;
  const selectedMetric = practiceTrendMetricOptions.find((option) => option.id === metric)!;

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const nextMetric = nextPracticeTrendMetric(metric, event.key);
    if (!nextMetric) return;
    event.preventDefault();
    setMetric(nextMetric);
    const nextIndex = practiceTrendMetricOptions.findIndex((option) => option.id === nextMetric);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section aria-labelledby="practice-growth-title" className="editor-practice-growth-dashboard">
      <header className="editor-practice-growth-header">
        <div>
          <h2 id="practice-growth-title">최근 5회 성장 추세</h2>
          <p>현재 슬라이드와 내용이 같은 연습만 비교합니다.</p>
        </div>
        <span>{comparable.length}회 비교</span>
      </header>
      {comparable.length === 0 ? (
        <p className="editor-practice-growth-empty">이 내용으로 연습한 기록이 아직 없습니다.</p>
      ) : (
        <div className="editor-practice-growth-grid">
          <section className="editor-practice-trend-card" aria-labelledby="practice-trend-card-title">
            <header>
              <div>
                <h3 id="practice-trend-card-title">{selectedMetric.label}</h3>
                <p>{selectedMetric.guidance}</p>
              </div>
              <TrendDirectionLabel series={series} />
            </header>
            <div aria-label="추세 지표 선택" className="editor-practice-trend-tabs" role="tablist">
              {practiceTrendMetricOptions.map((option, index) => (
                <button
                  aria-controls="practice-trend-chart-panel"
                  aria-selected={metric === option.id}
                  id={`practice-trend-tab-${option.id}`}
                  key={option.id}
                  ref={(element) => { tabRefs.current[index] = element; }}
                  role="tab"
                  tabIndex={metric === option.id ? 0 : -1}
                  type="button"
                  onClick={() => setMetric(option.id)}
                  onKeyDown={handleTabKeyDown}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div
              aria-labelledby={`practice-trend-tab-${metric}`}
              id="practice-trend-chart-panel"
              role="tabpanel"
            >
              <PracticeTrendChart series={series} unit={selectedMetric.unit} />
            </div>
          </section>
          <PracticeMetricCards latest={latest!} reports={comparable} />
          {latest && celebration?.noFiller ? (
            <PracticeCelebrationFeedback
              animate={props.animationSessionId === latest.practiceSessionId}
              report={latest}
            />
          ) : (
            <aside className="editor-practice-growth-context" aria-label="비교 기준 안내">
              <strong>{series.mode === "current" ? "이번 회차" : series.mode === "comparison" ? "이전 대비" : "최근 추세"}</strong>
              <p>다른 슬라이드 내용이나 측정 기준의 기록은 선으로 연결하지 않습니다.</p>
            </aside>
          )}
        </div>
      )}
    </section>
  );
}

export function nextPracticeTrendMetric(
  current: PracticeTrendMetric,
  key: string,
): PracticeTrendMetric | null {
  const index = practiceTrendMetricOptions.findIndex((option) => option.id === current);
  if (key === "Home") return practiceTrendMetricOptions[0]!.id;
  if (key === "End") return practiceTrendMetricOptions.at(-1)!.id;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const offset = key === "ArrowRight" ? 1 : -1;
  const nextIndex = (index + offset + practiceTrendMetricOptions.length)
    % practiceTrendMetricOptions.length;
  return practiceTrendMetricOptions[nextIndex]!.id;
}

function PracticeTrendChart(props: { series: PracticeTrendSeries; unit: string }) {
  const width = 560;
  const height = 180;
  const left = 36;
  const right = 20;
  const top = 28;
  const bottom = 42;
  const measured = props.series.points.flatMap((point) => point.value === null ? [] : [point.value]);
  const minimum = Math.min(...measured, 0);
  const maximum = Math.max(...measured, minimum + 1);
  const padding = Math.max((maximum - minimum) * 0.15, 0.1);
  const yMin = minimum - padding;
  const yMax = maximum + padding;
  const x = (index: number) => props.series.points.length <= 1
    ? width / 2
    : left + index * ((width - left - right) / (props.series.points.length - 1));
  const y = (value: number) => top + ((yMax - value) / (yMax - yMin)) * (height - top - bottom);
  const description = props.series.points.map((point) => (
    `${point.dateLabel} ${point.value === null ? "측정 불가" : `${formatChartValue(point.value)}${props.unit}`}`
  )).join(", ");

  return (
    <svg
      aria-label={`${practiceTrendMetricOptions.find((option) => option.id === props.series.metric)?.label} 최근 추세`}
      className="editor-practice-trend-chart"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <desc>{description}</desc>
      <line className="editor-practice-trend-baseline" x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} />
      {props.series.segments.map(([start, end]) => {
        const startValue = props.series.points[start]?.value;
        const endValue = props.series.points[end]?.value;
        if (startValue === null || startValue === undefined || endValue === null || endValue === undefined) return null;
        return <line className="editor-practice-trend-line" key={`${start}-${end}`} x1={x(start)} x2={x(end)} y1={y(startValue)} y2={y(endValue)} />;
      })}
      {props.series.points.map((point, index) => (
        <g key={point.reportId}>
          {point.value === null ? (
            <>
              <line className="editor-practice-trend-gap" x1={x(index)} x2={x(index)} y1={top + 24} y2={height - bottom} />
              <text className="editor-practice-trend-gap-label" textAnchor="middle" x={x(index)} y={top + 16}>측정 불가</text>
            </>
          ) : (
            <>
              <circle className="editor-practice-trend-point" cx={x(index)} cy={y(point.value)} r={5}>
                <title>{`${point.dateLabel}: ${formatChartValue(point.value)} ${props.unit}`}</title>
              </circle>
              <text className="editor-practice-trend-value" textAnchor="middle" x={x(index)} y={y(point.value) - 10}>{formatChartValue(point.value)}</text>
            </>
          )}
          <text className="editor-practice-trend-date" textAnchor="middle" x={x(index)} y={height - 16}>{point.dateLabel}</text>
        </g>
      ))}
    </svg>
  );
}

function PracticeMetricCards(props: {
  latest: SlidePracticeReportRecord;
  reports: readonly SlidePracticeReportRecord[];
}) {
  const fillerSeries = buildPracticeTrendSeries({
    reports: props.reports,
    slideContentHash: props.latest.reportVersion === 3 ? props.latest.slideContentHash : "",
    metric: "fillerRate",
  });
  const fillerRate = fillerSeries.points.at(-1)?.value ?? null;
  const voice = props.latest.voice;
  const isMeasured = props.latest.quality.state === "measured";
  const pace = isMeasured ? voice.syllablesPerSecond : null;
  const loudness = isMeasured ? voice.loudnessDb : null;
  const loudnessMad = isMeasured ? voice.loudnessMadDb : null;
  return (
    <section aria-label="이번 회차 핵심 지표" className="editor-practice-key-metrics">
      <MetricCard
        accessibleValue={fillerRate === null ? "측정 불가" : `${fillerRate.toFixed(1)} 회/분`}
        label="습관어"
        value={fillerRate === null ? "측정 불가" : `${fillerRate.toFixed(1)}회/분`}
      />
      <MetricCard
        accessibleValue={formatAccessibleMetric(pace, "음절/초", 1)}
        label="말 속도"
        value={formatRangeMetric(pace, "음절/초", slidePracticeMetricTargets.syllablesPerSecond)}
      />
      <MetricCard
        accessibleValue={formatAccessibleMetric(loudness, "dBFS", 0)}
        label="평균 음량"
        value={formatRangeMetric(loudness, "dBFS", slidePracticeMetricTargets.loudnessDb, 0)}
      />
      <MetricCard
        accessibleValue={formatAccessibleMetric(loudnessMad, "dB", 1)}
        label="음량 변화폭"
        value={formatLoudnessStability(loudnessMad)}
      />
    </section>
  );
}

function MetricCard(props: { accessibleValue: string; label: string; value: string }) {
  return <div><span>{props.label}</span><strong aria-label={props.accessibleValue}>{props.value}</strong></div>;
}

function TrendDirectionLabel({ series }: { series: PracticeTrendSeries }) {
  const label = series.direction === "improved"
    ? "개선 중"
    : series.direction === "declined"
      ? "목표 범위 확인"
      : series.direction === "unchanged"
        ? "유지 중"
        : "비교 대기";
  return <span className={`editor-practice-trend-direction ${series.direction}`}>{label}</span>;
}

function formatRangeMetric(
  value: number | null,
  unit: string,
  target: { min: number; max: number },
  fractionDigits = 1,
) {
  if (value === null) return "측정 불가";
  return `${value.toFixed(fractionDigits)}${unit} · ${isWithinTargetRange(value, target) ? "적정" : "범위 밖"}`;
}

function formatLoudnessStability(value: number | null) {
  if (value === null) return "측정 불가";
  const stability = classifyLoudnessStability(value);
  return `${value.toFixed(1)}dB · ${stability === "stable" ? "안정" : "불안정"}`;
}

function formatAccessibleMetric(value: number | null, unit: string, fractionDigits: number) {
  return value === null ? "측정 불가" : `${value.toFixed(fractionDigits)} ${unit}`;
}

function formatChartValue(value: number) {
  return value.toFixed(1);
}
