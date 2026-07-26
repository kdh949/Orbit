import type {
  SlidePracticeCoaching,
  SlidePracticeLoudnessSample,
  SlidePracticeReport,
  SlidePracticeSpeedSample,
} from "@orbit/shared/slide-practice";

const graphWidth = 700;
const graphHeight = 270;
const graphPadding = { top: 28, right: 24, bottom: 42, left: 54 };
const graphPlotWidth = graphWidth - graphPadding.left - graphPadding.right;
const graphPlotHeight = graphHeight - graphPadding.top - graphPadding.bottom;

export function PracticeReportContent({ report }: { report: SlidePracticeReport }) {
  return (
    <div className="editor-practice-report-content">
      <div className="editor-practice-graph-grid">
        <LoudnessBarChart
          durationMs={report.durationMs}
          emptyMessage={getLoudnessGraphEmptyMessage(report)}
          average={report.voice.loudnessDb}
          samples={report.loudnessSamples ?? []}
        />
        <SpeedLineChart
          durationMs={report.durationMs}
          emptyMessage={getSpeedGraphEmptyMessage(report)}
          average={report.voice.syllablesPerSecond}
          samples={report.speedSamples ?? []}
        />
      </div>
      <PracticeCoachingCard coaching={report.coaching} />
    </div>
  );
}

export function LoudnessBarChart(props: {
  durationMs: number;
  emptyMessage?: string;
  average: number | null;
  samples: readonly SlidePracticeLoudnessSample[];
}) {
  const yMin = -60;
  const yMax = -10;
  const durationMs = resolveDuration(props.durationMs, props.samples);
  const barSlotWidth = graphPlotWidth / Math.max(1, props.samples.length);
  const barWidth = Math.max(5, Math.min(22, barSlotWidth * 0.56));
  const baselineY = scaleY(yMin, yMin, yMax);
  return (
    <section className="editor-practice-graph-card" aria-labelledby="practice-loudness-title">
      <header>
        <div>
          <h3 id="practice-loudness-title">데시벨 변화</h3>
          <p>시간에 따른 목소리 크기</p>
        </div>
        <strong>평균 {formatMetric(props.average, "dBFS")}</strong>
      </header>
      {props.samples.length === 0 ? (
        <GraphEmptyState>
          {props.emptyMessage ?? "이 기록에는 시간별 데시벨 데이터가 없습니다."}
        </GraphEmptyState>
      ) : (
        <>
          <div className="editor-practice-graph-legend" aria-label="데시벨 범례">
            <span><i className="quiet" />작음</span>
            <span><i className="recommended" />적정</span>
            <span><i className="loud" />큼</span>
          </div>
          <svg
            aria-label="시간별 데시벨 세로 막대 그래프"
            className="editor-practice-graph"
            role="img"
            viewBox={`0 0 ${graphWidth} ${graphHeight}`}
          >
            <rect
              className="editor-practice-recommended-band"
              x={graphPadding.left}
              y={scaleY(-30, yMin, yMax)}
              width={graphPlotWidth}
              height={scaleY(-45, yMin, yMax) - scaleY(-30, yMin, yMax)}
            />
            {[-60, -50, -40, -30, -20].map((tick) => (
              <g key={tick}>
                <line
                  className="editor-practice-grid-line"
                  x1={graphPadding.left}
                  x2={graphPadding.left + graphPlotWidth}
                  y1={scaleY(tick, yMin, yMax)}
                  y2={scaleY(tick, yMin, yMax)}
                />
                <text className="editor-practice-axis-label" x={44} y={scaleY(tick, yMin, yMax) + 4} textAnchor="end">
                  {tick}
                </text>
              </g>
            ))}
            {props.samples.map((sample, index) => {
              const valueY = scaleY(sample.loudnessDb, yMin, yMax);
              const x = graphPadding.left + index * barSlotWidth + (barSlotWidth - barWidth) / 2;
              return (
                <rect
                  className={`editor-practice-loudness-bar ${loudnessLevel(sample.loudnessDb)}`}
                  height={Math.max(2, baselineY - valueY)}
                  key={`${sample.startMs}-${sample.endMs}`}
                  rx={3}
                  width={barWidth}
                  x={x}
                  y={valueY}
                >
                  <title>{`${formatSeconds(sample.startMs)}–${formatSeconds(sample.endMs)}: ${sample.loudnessDb.toFixed(1)} dBFS`}</title>
                </rect>
              );
            })}
            <GraphTimeTicks durationMs={durationMs} />
          </svg>
          <p className="editor-practice-graph-note">0 dBFS에 가까울수록 더 큰 소리예요.</p>
        </>
      )}
    </section>
  );
}

export function SpeedLineChart(props: {
  durationMs: number;
  emptyMessage?: string;
  average: number | null;
  samples: readonly SlidePracticeSpeedSample[];
}) {
  const yMin = 0;
  const yMax = Math.max(6, Math.ceil(Math.max(...props.samples.map((sample) => sample.syllablesPerSecond), 0) + 1));
  const durationMs = resolveDuration(props.durationMs, props.samples);
  const points = props.samples.map((sample) => {
    const midpoint = (sample.startMs + sample.endMs) / 2;
    return `${scaleX(midpoint, durationMs)},${scaleY(sample.syllablesPerSecond, yMin, yMax)}`;
  }).join(" ");
  const ticks = Array.from({ length: yMax + 1 }, (_, index) => index)
    .filter((tick) => tick === 0 || tick === yMax || tick % 2 === 0);
  return (
    <section className="editor-practice-graph-card" aria-labelledby="practice-speed-title">
      <header>
        <div>
          <h3 id="practice-speed-title">말 속도 변화</h3>
          <p>시간에 따른 말하기 속도</p>
        </div>
        <strong>평균 {formatMetric(props.average, "음절/초")}</strong>
      </header>
      {props.samples.length === 0 ? (
        <GraphEmptyState>
          {props.emptyMessage ?? "STT 시간 정보가 없어 속도 그래프를 만들지 못했습니다."}
        </GraphEmptyState>
      ) : (
        <svg
          aria-label="시간별 말 속도 선 그래프"
          className="editor-practice-graph speed"
          role="img"
          viewBox={`0 0 ${graphWidth} ${graphHeight}`}
        >
          <rect
            className="editor-practice-recommended-band"
            x={graphPadding.left}
            y={scaleY(4.5, yMin, yMax)}
            width={graphPlotWidth}
            height={scaleY(3.5, yMin, yMax) - scaleY(4.5, yMin, yMax)}
          />
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className="editor-practice-grid-line"
                x1={graphPadding.left}
                x2={graphPadding.left + graphPlotWidth}
                y1={scaleY(tick, yMin, yMax)}
                y2={scaleY(tick, yMin, yMax)}
              />
              <text className="editor-practice-axis-label" x={44} y={scaleY(tick, yMin, yMax) + 4} textAnchor="end">
                {tick}
              </text>
            </g>
          ))}
          <polyline className="editor-practice-speed-line" points={points} />
          {props.samples.map((sample) => {
            const midpoint = (sample.startMs + sample.endMs) / 2;
            return (
              <circle
                className="editor-practice-speed-point"
                cx={scaleX(midpoint, durationMs)}
                cy={scaleY(sample.syllablesPerSecond, yMin, yMax)}
                key={`${sample.startMs}-${sample.endMs}`}
                r={4}
              >
                <title>{`${formatSeconds(sample.startMs)}–${formatSeconds(sample.endMs)}: ${sample.syllablesPerSecond.toFixed(1)} 음절/초`}</title>
              </circle>
            );
          })}
          <GraphTimeTicks durationMs={durationMs} />
        </svg>
      )}
    </section>
  );
}

export function PracticeCoachingCard(props: {
  coaching: SlidePracticeCoaching | undefined;
}) {
  const coaching = props.coaching;
  return (
    <section className="editor-practice-coaching" aria-labelledby="practice-coaching-title">
      <header>
        <h3 id="practice-coaching-title">개선할 점</h3>
      </header>
      {!coaching || coaching.status === "unavailable" ? (
        <p className="editor-practice-coaching-state">
          {coaching?.summary ?? "이전 연습 기록에는 AI 개선점이 없습니다."}
        </p>
      ) : coaching.status === "not-needed" ? (
        <div className="editor-practice-coaching-success" role="status">
          <span aria-hidden="true">✓</span>
          <strong>{coaching.summary}</strong>
        </div>
      ) : (
        <>
          <p className="editor-practice-coaching-summary">{coaching.summary}</p>
          {coaching.items[0] ? <SingleCoachingItem item={coaching.items[0]} /> : null}
        </>
      )}
    </section>
  );
}

function SingleCoachingItem({ item }: { item: SlidePracticeCoaching["items"][number] }) {
  const evidence = item.scriptEvidence;
  return (
    <article className="editor-practice-coaching-item editor-practice-coaching-single">
      <header><h4>{item.title}</h4></header>
      <p>{item.reason}</p>
      {evidence ? (
        <>
          <section className="editor-practice-script-evidence">
            <strong>{evidence.alignment === "matched" ? "측정된 실제 대본" : "연습할 실제 대본"}</strong>
            <blockquote>{evidence.originalText}</blockquote>
            <dl className="editor-practice-evidence-metrics">
              <Metric label="말 속도" value={formatMetric(evidence.metrics.syllablesPerSecond, "음절/초")} />
              <Metric label="음량" value={formatMetric(evidence.metrics.loudnessDb, "dBFS")} />
              <Metric label="쉼 구간" value={formatPause(evidence.metrics.pauseBeforeMs, evidence.metrics.pauseAfterMs)} />
              <Metric label="피치폭" value={formatMetric(evidence.metrics.pitchSpanHz, "Hz")} />
              <Metric label="습관어" value={formatFillers(evidence.metrics.fillerTotalCount, evidence.metrics.fillerWords)} />
              <Metric label="음량 변화폭" value={formatMetric(evidence.metrics.loudnessVariationDb, "dB")} />
              <Metric label="리듬 규칙성" value={formatRatio(evidence.metrics.rhythmRegularity)} />
            </dl>
          </section>
          <div className="editor-practice-coaching-methods">
            <section><strong>대본과 연결한 방법</strong><p>{item.action}</p></section>
            <section><strong>다른 연습 방법</strong><p>{item.practiceTip}</p></section>
          </div>
        </>
      ) : item.scriptEdit ? (
        <div className="editor-practice-script-edit">
          <div><strong>현재 대본</strong><p>{item.scriptEdit.originalText}</p></div>
          <span aria-hidden="true">→</span>
          <div><strong>추천 대본</strong><p>{item.scriptEdit.suggestedText}</p></div>
          <small><strong>이유</strong> {item.scriptEdit.reason}</small>
        </div>
      ) : (
        <div className="editor-practice-coaching-action">
          <strong>바로 해보기</strong>
          <p>{item.action}</p>
          <small>{item.practiceTip}</small>
        </div>
      )}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatPause(beforeMs: number | null, afterMs: number | null) {
  if (beforeMs === null && afterMs === null) return "측정 안 됨";
  const values = [beforeMs, afterMs].filter((value): value is number => value !== null);
  return `${Math.max(...values) / 1_000}초`;
}

function formatFillers(totalCount: number, words: readonly string[]) {
  if (totalCount === 0) return "0회";
  return `${totalCount}회${words.length > 0 ? ` (${words.join(", ")})` : ""}`;
}

function formatRatio(value: number | null) {
  return value === null ? "측정 안 됨" : `${Math.round(value * 100)}%`;
}

function GraphEmptyState({ children }: { children: string }) {
  return <div className="editor-practice-graph-empty">{children}</div>;
}

export function getLoudnessGraphEmptyMessage(
  report: Pick<SlidePracticeReport, "quality" | "reportVersion">
) {
  if (report.reportVersion === 1) {
    return "이전 분석 버전의 기록이라 시간별 데시벨 그래프가 없습니다. 새 연습부터 제공됩니다.";
  }
  if (report.quality.reasons.includes("audio-analysis-unavailable")) {
    return "오디오를 해석하지 못해 시간별 데시벨 데이터를 만들지 못했습니다.";
  }
  return "이 기록에는 시간별 데시벨 데이터가 없습니다.";
}

export function getSpeedGraphEmptyMessage(
  report: Pick<SlidePracticeReport, "quality" | "reportVersion">
) {
  if (report.reportVersion === 1) {
    return "이전 분석 버전의 기록이라 시간별 말 속도 그래프가 없습니다. 새 연습부터 제공됩니다.";
  }
  if (report.quality.reasons.includes("stt-unavailable")) {
    return "음성 전사를 사용할 수 없어 말 속도 그래프를 만들지 못했습니다.";
  }
  if (report.quality.reasons.includes("insufficient-speech")) {
    return "발화량이 부족해 말 속도 그래프를 만들지 못했습니다. 10초 이상 말해 주세요.";
  }
  return "STT 시간 정보가 없어 속도 그래프를 만들지 못했습니다.";
}

function GraphTimeTicks({ durationMs }: { durationMs: number }) {
  return (
    <>
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
        <text
          className="editor-practice-axis-label"
          key={ratio}
          textAnchor={ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"}
          x={graphPadding.left + graphPlotWidth * ratio}
          y={graphHeight - 13}
        >
          {Math.round((durationMs / 1_000) * ratio)}초
        </text>
      ))}
    </>
  );
}

function resolveDuration(
  durationMs: number,
  samples: readonly { endMs: number }[],
) {
  return Math.max(1, durationMs, ...samples.map((sample) => sample.endMs));
}

function scaleX(value: number, durationMs: number) {
  return graphPadding.left + (Math.max(0, Math.min(durationMs, value)) / durationMs) * graphPlotWidth;
}

function scaleY(value: number, min: number, max: number) {
  const bounded = Math.max(min, Math.min(max, value));
  return graphPadding.top + ((max - bounded) / (max - min)) * graphPlotHeight;
}

function loudnessLevel(value: number) {
  if (value < -45) return "quiet";
  if (value > -30) return "loud";
  return "recommended";
}

function formatMetric(value: number | null, unit: string) {
  return value === null ? "측정 안 됨" : `${value.toFixed(1)} ${unit}`;
}

function formatSeconds(valueMs: number) {
  return `${(valueMs / 1_000).toFixed(1)}초`;
}
