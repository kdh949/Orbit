export type TrendPoint = {
  label: string;
  value: number;
};

type TrendChartProps = {
  ariaLabel: string;
  className?: string;
  series: TrendPoint[];
  targetValue?: number | null;
  valueFormatter?: (value: number) => string;
};

export function DurationLineChart({
  series,
  targetValue = null,
}: {
  series: Array<{ label: string; seconds: number }>;
  targetValue?: number | null;
}) {
  return (
    <TrendLineChart
      ariaLabel="회차별 총 소요시간 추이"
      className="is-duration"
      series={series.map((point) => ({
        label: point.label,
        value: point.seconds,
      }))}
      targetValue={targetValue}
      valueFormatter={formatDuration}
    />
  );
}

export function MetricTrendChart({
  ariaLabel,
  series,
  valueFormatter,
}: Omit<TrendChartProps, "className" | "targetValue">) {
  return (
    <TrendLineChart
      ariaLabel={ariaLabel}
      className="is-compact"
      series={series}
      valueFormatter={valueFormatter}
    />
  );
}

function TrendLineChart({
  ariaLabel,
  className = "",
  series,
  targetValue = null,
  valueFormatter = (value) => String(Math.round(value)),
}: TrendChartProps) {
  if (series.length < 2) return null;

  const values = [
    ...series.map((point) => point.value),
    ...(targetValue !== null ? [targetValue] : []),
  ];
  const rawMax = Math.max(...values, 1);
  const rawMin = Math.min(...values, 0);
  const range = Math.max(rawMax - rawMin, 1);
  const max = rawMax + range * 0.16;
  const min = Math.max(0, rawMin - range * 0.08);
  const isCompact = className === "is-compact";
  const width = isCompact ? 320 : 720;
  const height = isCompact ? 120 : 350;
  const padX = isCompact ? 30 : 48;
  const padTop = 30;
  const bottomPad = 38;
  const chartW = width - padX * 2;
  const chartH = height - padTop - bottomPad;
  const axisStep = Math.max(1, Math.ceil((series.length - 1) / 5));
  const axisIndexes = new Set<number>([0, series.length - 1]);
  for (let index = 0; index < series.length; index += axisStep) {
    axisIndexes.add(index);
  }
  if (!isCompact) {
    const latestIndex = series.length - 1;
    for (const index of axisIndexes) {
      const distanceFromLatest = ((latestIndex - index) / latestIndex) * chartW;
      if (index !== latestIndex && distanceFromLatest < 72) {
        axisIndexes.delete(index);
      }
    }
  }

  const toY = (value: number) =>
    padTop + (1 - (value - min) / Math.max(max - min, 1)) * chartH;
  const points = series.map((point, index) => ({
    ...point,
    x: padX + (index / (series.length - 1)) * chartW,
    y: toY(point.value),
  }));
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const latest = points.at(-1)!;
  const maxPointIndex = points.reduce(
    (bestIndex, point, index, allPoints) =>
      point.value > allPoints[bestIndex].value ? index : bestIndex,
    0,
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`report-project-chart-svg ${className}`.trim()}
      role="img"
      aria-label={ariaLabel}
    >
      {targetValue !== null ? (
        <rect
          x={padX}
          y={toY(targetValue + 30)}
          width={chartW}
          height={Math.max(0, toY(Math.max(0, targetValue - 30)) - toY(targetValue + 30))}
          className="report-project-chart-target-band"
        />
      ) : null}

      {[0, 0.5, 1].map((ratio) => {
        const y = padTop + ratio * chartH;
        const tickValue = max - ratio * (max - min);
        return (
          <g key={ratio}>
            <line
              x1={padX}
              x2={width - padX}
              y1={y}
              y2={y}
              className="report-project-chart-grid"
            />
            <text
              x={padX - 7}
              y={y + 4}
              textAnchor="end"
              className="report-project-chart-axis-value"
            >
              {isCompact ? Math.round(tickValue) : valueFormatter(tickValue)}
            </text>
          </g>
        );
      })}

      {targetValue !== null ? (
        <g>
          <line
            x1={padX}
            x2={width - padX}
            y1={toY(targetValue)}
            y2={toY(targetValue)}
            className="report-project-chart-target"
          />
          <text
            x={padX + 8}
            y={Math.max(14, toY(targetValue) - 8)}
            textAnchor="start"
            className="report-project-chart-target-label"
          >
            목표 {valueFormatter(targetValue)}
          </text>
        </g>
      ) : null}

      <polyline points={polyline} className="report-project-chart-line" />
      {points.map((point, index) => (
        <g key={`${point.label}-${index}`}>
          <circle
            cx={point.x}
            cy={point.y}
            r={index === points.length - 1 ? 5.5 : 4}
            className={
              index === points.length - 1
                ? "report-project-chart-point is-latest"
                : "report-project-chart-point"
            }
          />
          {isCompact || index === points.length - 1 || index === maxPointIndex ? (
            <text
              x={point.x}
              y={Math.max(14, point.y - 13)}
              textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
              className="report-project-chart-latest-value"
            >
              {valueFormatter(point.value)}
            </text>
          ) : null}
          {axisIndexes.has(index) ? (
            <text
              x={point.x}
              y={height - 10}
              textAnchor={
                index === 0
                  ? "start"
                  : index === series.length - 1
                    ? "end"
                    : "middle"
              }
              className="report-project-chart-axis-label"
            >
              {point.label}
            </text>
          ) : null}
          <title>{`${point.label}: ${valueFormatter(point.value)}`}</title>
        </g>
      ))}
      <title>{`${ariaLabel}. 최근 값 ${valueFormatter(latest.value)}`}</title>
    </svg>
  );
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}초`;
}
