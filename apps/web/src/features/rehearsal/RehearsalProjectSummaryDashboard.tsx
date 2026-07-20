import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  MessageCircle,
  MessageCircleMore,
  Pause,
  Presentation,
  Target,
  type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, type CSSProperties } from "react";
import type { RehearsalProjectSummary } from "@orbit/shared";
import { DurationLineChart, MetricTrendChart } from "./ReportProgressCharts";
import {
  buildRehearsalProjectSummaryDashboardModel,
  formatDuration,
  formatPercent,
  type ProjectSummaryKpi,
  type ProjectSummarySlideRow,
} from "./rehearsalProjectSummaryModel";
import type { RehearsalRunComparisonViewModel } from "./rehearsalRunComparisonModel";

const ProjectSlidePreview = lazy(
  () => import("../projects/ProjectSlidePreview"),
);

export function RehearsalProjectSummaryDashboard({
  comparison,
  summary,
}: {
  comparison: RehearsalRunComparisonViewModel | null;
  summary: RehearsalProjectSummary;
}) {
  const model = buildRehearsalProjectSummaryDashboardModel(summary, comparison);
  if (!model) {
    return (
      <section className="project-summary-dashboard is-empty">
        <Target size={22} />
        <div>
          <h2>회차별 분석을 준비하고 있습니다</h2>
          <p>측정 가능한 리허설이 완료되면 변화 추이가 이곳에 나타납니다.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="project-summary-dashboard" aria-labelledby="project-summary-title">
      <article className="project-summary-next-action" aria-label="다음 연습 우선 행동">
        <span className="project-summary-next-action-icon" aria-hidden="true">
          <Target size={23} />
        </span>
        <div>
          <span>다음 연습에서 먼저 할 일</span>
          <strong>{model.primaryAction.label}</strong>
          {model.primaryAction.slideLabel ? <small>{model.primaryAction.slideLabel}</small> : null}
          <p>{model.primaryAction.reason}</p>
        </div>
        {model.primaryAction.href ? (
          <a href={model.primaryAction.href}>
            상세 리포트에서 보기
            <ArrowUpRight size={17} />
          </a>
        ) : (
          <span className="project-summary-next-action-ready">
            <CheckCircle2 size={17} /> 흐름 유지
          </span>
        )}
      </article>

      <section className="project-summary-card project-summary-kpi-section">
        <header className="project-summary-plain-heading">
          <h2 id="project-summary-title">발표 개선 요약</h2>
          <span>{summary.runCount}회차 기반</span>
        </header>
        <div className="project-summary-kpi-grid" aria-label="최신 회차 핵심 지표">
          {model.kpis.map((kpi) => (
            <KpiCard key={kpi.key} kpi={kpi} />
          ))}
        </div>
        <p className="project-summary-keyword-help">
          핵심 키워드 전달률은 발표자료에 등록된 키워드를 유의어와 약어를 포함해
          한 번 이상 언급했는지 확인합니다. 설명의 정확성은 평가하지 않습니다.
        </p>
      </section>

      <section className="project-summary-card project-summary-slide-section">
        <SectionHeading
          title="슬라이드별 누적 패턴"
          description="모든 완료 회차의 평균과 최신 슬라이드 기준을 함께 봅니다."
          aside={`${model.slideRows.length}개 슬라이드`}
        />
        {model.slideRows.length > 0 ? (
          <div className="project-summary-slide-table-wrap">
            <div className="project-summary-slide-table" role="table" aria-label="슬라이드별 누적 발표 지표">
              <div className="project-summary-slide-row is-header" role="row">
                <span role="columnheader">#</span>
                <span role="columnheader">슬라이드</span>
                <span role="columnheader">평균 소요시간</span>
                <span role="columnheader">권장 시간</span>
                <span role="columnheader">시간 초과<br />회차 비율</span>
                <span role="columnheader">핵심 키워드<br />전달률</span>
                <span role="columnheader">상태</span>
              </div>
              {model.slideRows.map((slide) => (
                <SlidePerformanceRow
                  key={slide.slideId}
                  projectId={summary.projectId}
                  slide={slide}
                />
              ))}
            </div>
          </div>
        ) : (
          <MetricEmptyState message="슬라이드별 측정 데이터가 아직 없습니다." />
        )}
      </section>

      <section className="project-summary-card project-summary-trends-section">
        <SectionHeading
          title="회차별 변화"
          description="미측정 회차는 0으로 바꾸지 않고 추이에서 제외합니다."
          aside={model.latestMeasuredRunLabel ? `최근 측정 ${model.latestMeasuredRunLabel}` : "측정 대기"}
        />

        <article className="project-summary-duration-chart">
          <div className="project-summary-chart-title">
            <div>
              <span>회차별 총 소요시간</span>
              <small>권장 시간과 실제 발표 시간을 비교합니다.</small>
            </div>
            <strong>
              {model.latest.duration.measurementState === "measured"
                ? formatDuration(model.latest.duration.actualSeconds)
                : "N/A"}
            </strong>
          </div>
          {model.durationSeries.length >= 2 ? (
            <DurationLineChart
              series={model.durationSeries}
              targetValue={model.latestDurationTarget}
            />
          ) : (
            <MetricEmptyState message="총 소요시간 추이는 측정 회차가 2개 이상일 때 표시됩니다." />
          )}
        </article>

        <div className="project-summary-mini-chart-grid">
          <TrendPanel
            tone="primary"
            title="긴 침묵 추이"
            description="3초 이상 침묵 횟수"
            series={model.metricSeries.longSilence}
            ariaLabel="회차별 긴 침묵 횟수 추이"
            valueFormatter={(value) => `${Math.round(value)}회`}
          />
          <TrendPanel
            tone="secondary"
            title="핵심 키워드 전달률"
            description="등록 키워드를 한 번 이상 언급한 비율"
            series={model.metricSeries.keywordCoverage}
            ariaLabel="회차별 핵심 키워드 전달률 추이"
            valueFormatter={formatPercent}
          />
          <TrendPanel
            tone="danger"
            title="시간 초과 슬라이드 비율"
            description="권장 시간의 120%를 넘긴 비율"
            series={model.metricSeries.timingOverrun}
            ariaLabel="회차별 시간 초과 슬라이드 비율 추이"
            valueFormatter={formatPercent}
          />
        </div>
      </section>

    </section>
  );
}

function KpiCard({ kpi }: { kpi: ProjectSummaryKpi }) {
  const visual = KPI_VISUALS[kpi.key];
  const hasComparison = kpi.comparisonValue !== null;
  const showValueTransition = hasComparison && kpi.key !== "duration";
  const isTargetMatch =
    kpi.key === "duration" && kpi.deltaLabel === "권장과 일치";
  const currentDisplayValue = toKpiDisplayValue(kpi.key, kpi.value);
  const comparisonDisplayValue = kpi.comparisonValue
    ? toKpiDisplayValue(kpi.key, kpi.comparisonValue)
    : null;
  const ariaLabel = [
    kpi.label,
    hasComparison
      ? `${kpi.comparisonLabel} ${kpi.comparisonValue}에서 현재 ${kpi.value}`
      : `현재 ${kpi.value}`,
    kpi.deltaLabel ?? kpi.detail,
  ].join(". ");

  return (
    <article
      aria-label={ariaLabel}
      className={`project-summary-kpi is-${kpi.state}${isTargetMatch ? " is-target-match" : ""}`}
    >
      <strong className="project-summary-kpi-label">{kpi.label}</strong>
      <div
        className={`project-summary-kpi-visual${hasComparison ? " is-comparison" : ""}`}
        aria-hidden="true"
      >
        {hasComparison ? (
          <KpiVisualState icon={visual.previous} tone="previous" />
        ) : null}
        {hasComparison ? (
          <ArrowRight
            className="project-summary-kpi-arrow"
            size={22}
            strokeWidth={2}
          />
        ) : null}
        <KpiVisualState icon={visual.current} tone="current" />
      </div>
      <div
        className={`project-summary-kpi-readout${showValueTransition ? " is-comparison" : ""}`}
      >
        {showValueTransition ? (
          <>
            <span>{comparisonDisplayValue}</span>
            <ArrowRight aria-hidden="true" size={20} strokeWidth={2.25} />
          </>
        ) : null}
        <strong>{currentDisplayValue}</strong>
      </div>
      {kpi.deltaLabel ? (
        <span className="project-summary-kpi-delta">{kpi.deltaLabel}</span>
      ) : (
        <span className="project-summary-kpi-delta is-context">
          {kpi.detail}
        </span>
      )}
    </article>
  );
}

const KPI_VISUALS: Record<
  ProjectSummaryKpi["key"],
  { current: LucideIcon; previous: LucideIcon }
> = {
  duration: { current: Target, previous: Clock3 },
  silence: { current: Pause, previous: Pause },
  "keyword-coverage": {
    current: MessageCircle,
    previous: MessageCircleMore,
  },
  "timing-overrun": { current: CheckCircle2, previous: Presentation },
};

function KpiVisualState({
  icon: Icon,
  tone,
}: {
  icon: LucideIcon;
  tone: "current" | "previous";
}) {
  return (
    <span className={`project-summary-kpi-icon is-${tone}`}>
      <Icon size={44} strokeWidth={1.75} />
    </span>
  );
}

function toKpiDisplayValue(key: ProjectSummaryKpi["key"], value: string) {
  if (key === "silence") return value.replace(/회$/, "");
  if (key === "keyword-coverage") return value.replace(/ 전달$/, "");
  if (key === "timing-overrun") return value.split("/")[0];
  return value;
}

function SectionHeading({
  aside,
  description,
  title,
}: {
  aside: string;
  description: string;
  title: string;
}) {
  return (
    <header className="project-summary-section-heading">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <small>{aside}</small>
    </header>
  );
}

function SlidePerformanceRow({
  projectId,
  slide,
}: {
  projectId: string;
  slide: ProjectSummarySlideRow;
}) {
  const average = slide.avgActualSeconds;
  const target = slide.targetSeconds;
  const chartMax = Math.max(average ?? 0, target ?? 0, 1);
  const timeStyle = {
    "--actual-width": `${((average ?? 0) / chartMax) * 100}%`,
  } as CSSProperties;
  const overrunRate =
    slide.timingOverrun.measurementState === "measured"
      ? slide.timingOverrun.rate
      : null;
  const coverageRate =
    slide.keywordCoverage.measurementState === "measured"
      ? slide.keywordCoverage.rate
      : null;
  const metricStyle = (rate: number | null) =>
    ({ "--metric-width": `${(rate ?? 0) * 100}%` }) as CSSProperties;

  const content = (
    <>
      <span className="project-summary-slide-number" role="cell">
        {slide.order}
      </span>
      <span className="project-summary-slide-identity" role="cell">
        <SlideThumbnail
          order={slide.order}
          projectId={projectId}
          slideId={slide.slideId}
          title={slide.title}
        />
        <span>
          <strong>{slide.title}</strong>
        </span>
      </span>

      <span className="project-summary-slide-time" role="cell">
        <span className="project-summary-slide-time-track" style={timeStyle} aria-hidden="true">
          <i />
        </span>
        <strong>{average === null ? "N/A" : formatDuration(average)}</strong>
      </span>

      <span className="project-summary-slide-target" role="cell">
        <i aria-hidden="true" />
        <strong>{target === null ? "N/A" : formatDuration(target)}</strong>
      </span>

      <span className="project-summary-slide-metric" role="cell">
        <strong>
          {overrunRate !== null
            ? formatPercent(overrunRate * 100)
            : "N/A"}
        </strong>
        <span
          className="project-summary-slide-metric-track is-overrun"
          style={metricStyle(overrunRate)}
          aria-hidden="true"
        >
          <i />
        </span>
      </span>

      <span className="project-summary-slide-metric" role="cell">
        <strong>
          {coverageRate !== null
            ? formatPercent(coverageRate * 100)
            : "N/A"}
        </strong>
        <span
          className="project-summary-slide-metric-track is-coverage"
          style={metricStyle(coverageRate)}
          aria-hidden="true"
        >
          <i />
        </span>
      </span>

      <span className={`project-summary-slide-status is-${slide.statusTone}`} role="cell">
        {slide.status}
      </span>
    </>
  );

  const rowClass = `project-summary-slide-row${
    slide.statusTone === "danger" ? " is-attention" : ""
  }`;

  return slide.href ? (
    <a className={rowClass} role="row" href={slide.href}>
      {content}
    </a>
  ) : (
    <div className={rowClass} role="row">
      {content}
    </div>
  );
}

function SlideThumbnail({
  order,
  projectId,
  slideId,
  title,
}: {
  order: number;
  projectId: string;
  slideId: string;
  title: string;
}) {
  return (
    <span
      className="project-summary-slide-thumbnail"
      role="img"
      aria-label={`${order}번 슬라이드 미리보기`}
    >
      <span className="project-summary-slide-thumbnail-fallback" aria-hidden="true">
        <i>{order}</i>
        <strong>{title}</strong>
      </span>
      <Suspense fallback={null}>
        <ProjectSlidePreview
          className="project-summary-slide-thumbnail-canvas"
          projectId={projectId}
          slideId={slideId}
          slideOrder={order}
        />
      </Suspense>
    </span>
  );
}

function TrendPanel({
  ariaLabel,
  description,
  series,
  title,
  tone,
  valueFormatter,
}: {
  ariaLabel: string;
  description: string;
  series: Array<{ label: string; value: number }>;
  title: string;
  tone: "danger" | "primary" | "secondary";
  valueFormatter: (value: number) => string;
}) {
  return (
    <article className={`project-summary-mini-chart is-${tone}`}>
      <div className="project-summary-chart-title">
        <div>
          <span>{title}</span>
          <small>{description}</small>
        </div>
        <strong>{series.length > 0 ? valueFormatter(series.at(-1)!.value) : "N/A"}</strong>
      </div>
      {series.length >= 2 ? (
        <MetricTrendChart
          ariaLabel={ariaLabel}
          series={series}
          valueFormatter={valueFormatter}
        />
      ) : (
        <MetricEmptyState message="측정 회차가 2개 이상 필요합니다." />
      )}
    </article>
  );
}

function MetricEmptyState({ message }: { message: string }) {
  return <p className="project-summary-metric-empty">{message}</p>;
}
