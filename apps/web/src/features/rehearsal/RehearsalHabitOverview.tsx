import { MessageSquareWarning } from "lucide-react";
import type { RehearsalReport } from "@orbit/shared";

const FILLER_CHART_COLORS = [
  "#0072B2",
  "#E69F00",
  "#009E73",
  "#D55E00",
  "#CC79A7",
] as const;

export const FILLER_DONUT_WIDTH = 680;
export const FILLER_DONUT_HEIGHT = 300;
export const FILLER_DONUT_CENTER_X = FILLER_DONUT_WIDTH / 2;
export const FILLER_DONUT_CENTER_Y = FILLER_DONUT_HEIGHT / 2;
export const FILLER_DONUT_RADIUS = 92;
export const FILLER_DONUT_STROKE_WIDTH = 42;
export const FILLER_DONUT_CIRCUMFERENCE = 2 * Math.PI * FILLER_DONUT_RADIUS;

type FillerDistributionItem = {
  color: string;
  count: number;
  sharePercent: number;
  word: string;
};

export function fmtPercent(value: number) {
  return `${Math.round(value)}%`;
}

export function buildFillerDistribution(
  fillerWordDetails: RehearsalReport["fillerWordDetails"],
  fillerWordCount: number,
): FillerDistributionItem[] {
  return [...fillerWordDetails]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((fw, index) => ({
      ...fw,
      color: FILLER_CHART_COLORS[index % FILLER_CHART_COLORS.length]!,
      sharePercent: Math.min(
        100,
        fillerWordCount > 0 ? (fw.count / fillerWordCount) * 100 : 0,
      ),
    }));
}

type FillerDonutSegment = FillerDistributionItem & {
  dashArray: string;
  dashOffset: number;
  labelSide: "left" | "right";
  labelX: number;
  labelY: number;
  linePath: string;
  midRad: number;
  startX: number;
  startY: number;
};

export function buildFillerDonutSegments(
  distribution: FillerDistributionItem[],
): FillerDonutSegment[] {
  let cumulativePercent = 0;

  const rawSegments = distribution.map((item) => {
    const segmentLength = (item.sharePercent / 100) * FILLER_DONUT_CIRCUMFERENCE;
    const midPercent = cumulativePercent + item.sharePercent / 2;
    const midRad = (midPercent / 100) * 2 * Math.PI;
    const labelSide: FillerDonutSegment["labelSide"] =
      Math.sin(midRad) >= 0 ? "right" : "left";
    const lineStartRadius = FILLER_DONUT_RADIUS + FILLER_DONUT_STROKE_WIDTH / 2;
    const segment = {
      ...item,
      dashArray: `${segmentLength} ${FILLER_DONUT_CIRCUMFERENCE - segmentLength}`,
      dashOffset: -((cumulativePercent / 100) * FILLER_DONUT_CIRCUMFERENCE),
      labelSide,
      midRad,
      startX: FILLER_DONUT_CENTER_X + lineStartRadius * Math.sin(midRad),
      startY: FILLER_DONUT_CENTER_Y - lineStartRadius * Math.cos(midRad),
    };
    cumulativePercent += item.sharePercent;
    return segment;
  });

  const positioned = (["left", "right"] as const).flatMap((side) => {
    const sideSegments = rawSegments
      .filter((segment) => segment.labelSide === side)
      .sort((a, b) => a.startY - b.startY);
    const minY = 58;
    const maxY = FILLER_DONUT_HEIGHT - 58;
    const elbowX = side === "left" ? 176 : FILLER_DONUT_WIDTH - 176;
    const labelX = side === "left" ? 78 : FILLER_DONUT_WIDTH - 78;

    return sideSegments.map((segment, index) => {
      const labelY =
        sideSegments.length === 1
          ? FILLER_DONUT_CENTER_Y
          : minY + ((maxY - minY) * index) / (sideSegments.length - 1);
      const lineEndX = side === "left" ? labelX + 8 : labelX - 8;
      return {
        ...segment,
        labelX,
        labelY,
        linePath: `M ${segment.startX.toFixed(1)} ${segment.startY.toFixed(1)} L ${elbowX} ${labelY.toFixed(1)} L ${lineEndX} ${labelY.toFixed(1)}`,
      };
    });
  });

  return positioned;
}

type Props = {
  prevReport: RehearsalReport | null;
  report: RehearsalReport;
};

export function RehearsalHabitOverview({ prevReport, report }: Props) {
  const metrics = report.metrics;
  const fillerDistribution = buildFillerDistribution(
    report.fillerWordDetails,
    metrics.fillerWordCount,
  );
  const fillerDonutSegments = buildFillerDonutSegments(fillerDistribution);
  const fillerDelta = prevReport
    ? metrics.fillerWordCount - prevReport.metrics.fillerWordCount
    : null;

  return (
    <section className="rrd-card rrd-habit-panel">
      <header className="rrd-card-head rrd-habit-panel-head">
        <MessageSquareWarning size={20} className="rrd-card-icon" />
        <div className="rrd-habit-panel-title">
          <h2>말버릇</h2>
          <span>말버릇 총량</span>
        </div>
        <div className="rrd-habit-panel-stat">
          <strong>{metrics.fillerWordCount}회</strong>
          <em>
            {fillerDelta === null
              ? "이전 비교 없음"
              : `직전 대비 ${fillerDelta === 0 ? "변화 없음" : `${fillerDelta > 0 ? "+" : ""}${fillerDelta}회`}`}
          </em>
        </div>
      </header>

      {fillerDistribution.length > 0 ? (
        <>
          <h3 className="rrd-section-label">상위 표현</h3>
          <div className="rrd-filler-distribution">
            <div className="rrd-filler-distribution-chart">
              <svg
                viewBox={`0 0 ${FILLER_DONUT_WIDTH} ${FILLER_DONUT_HEIGHT}`}
                className="rrd-filler-donut-svg"
                role="img"
                aria-label={`표현별 사용 횟수와 비중: ${fillerDistribution
                  .map((item) => `\"${item.word}\" ${item.count}회 ${fmtPercent(item.sharePercent)}`)
                  .join(", ")}`}
              >
                <circle
                  className="rrd-filler-donut-track"
                  cx={FILLER_DONUT_CENTER_X}
                  cy={FILLER_DONUT_CENTER_Y}
                  r={FILLER_DONUT_RADIUS}
                  fill="none"
                  strokeWidth={FILLER_DONUT_STROKE_WIDTH}
                />
                <g
                  transform={`rotate(-90 ${FILLER_DONUT_CENTER_X} ${FILLER_DONUT_CENTER_Y})`}
                >
                  {fillerDonutSegments.map((segment) => (
                    <circle
                      key={segment.word}
                      cx={FILLER_DONUT_CENTER_X}
                      cy={FILLER_DONUT_CENTER_Y}
                      r={FILLER_DONUT_RADIUS}
                      fill="none"
                      stroke={segment.color}
                      strokeWidth={FILLER_DONUT_STROKE_WIDTH}
                      strokeDasharray={segment.dashArray}
                      strokeDashoffset={segment.dashOffset}
                    />
                  ))}
                </g>
                {fillerDonutSegments.map((segment) => (
                  <g key={`${segment.word}-callout`}>
                    <path
                      className="rrd-filler-donut-callout"
                      d={segment.linePath}
                    />
                    <circle
                      className="rrd-filler-donut-callout-dot"
                      cx={segment.startX}
                      cy={segment.startY}
                      r="3"
                    />
                    <text
                      className="rrd-filler-donut-callout-label"
                      x={segment.labelX}
                      y={segment.labelY - 7}
                      textAnchor={segment.labelSide === "left" ? "end" : "start"}
                    >
                      <tspan className="rrd-filler-donut-callout-word">
                        "{segment.word}"
                      </tspan>
                      <tspan
                        x={segment.labelX}
                        dy="23"
                        className="rrd-filler-donut-callout-value"
                      >
                        {segment.count}회 · {fmtPercent(segment.sharePercent)}
                      </tspan>
                    </text>
                  </g>
                ))}
                <text
                  className="rrd-filler-donut-center"
                  x={FILLER_DONUT_CENTER_X}
                  y={FILLER_DONUT_CENTER_Y - 5}
                  textAnchor="middle"
                >
                  <tspan className="rrd-filler-donut-center-value">
                    {metrics.fillerWordCount}회
                  </tspan>
                  <tspan
                    x={FILLER_DONUT_CENTER_X}
                    dy="24"
                    className="rrd-filler-donut-center-label"
                  >
                    상위 표현
                  </tspan>
                </text>
              </svg>
            </div>
          </div>
        </>
      ) : (
        <p className="rrd-empty-hint">말버릇 기록이 없습니다.</p>
      )}
    </section>
  );
}
