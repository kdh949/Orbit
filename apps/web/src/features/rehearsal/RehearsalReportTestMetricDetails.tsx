import type { Deck, RehearsalReport } from "@orbit/shared";
import { MicOff, Pause, Play } from "lucide-react";
import {
  buildFillerDistribution,
  buildFillerDonutSegments,
  FILLER_DONUT_CENTER_X,
  FILLER_DONUT_CENTER_Y,
  FILLER_DONUT_HEIGHT,
  FILLER_DONUT_RADIUS,
  FILLER_DONUT_STROKE_WIDTH,
  FILLER_DONUT_WIDTH,
  fmtPercent,
} from "./RehearsalHabitOverview";
import { RehearsalSlideCanvasPreview } from "./RehearsalSlideCanvasPreview";
import { getSilencePlaybackRange } from "./RehearsalSilenceOverview";
import { buildRehearsalReportTestSlideMetrics } from "./rehearsalReportTestViewModel";
import { useRehearsalAudioSegmentPlayback } from "./useRehearsalAudioSegmentPlayback";

type CommonProps = {
  deck: Deck;
  report: RehearsalReport;
};

export function SpeakingRateMetricDetails({ deck, report }: CommonProps) {
  return (
    <div className="rrd-test-metric-detail-list">
      {deck.slides.map((slide, index) => {
        const metric = buildRehearsalReportTestSlideMetrics(
          report,
          slide.slideId,
          slide.keywords,
        ).speakingRate;
        return (
          <article className="rrd-test-metric-slide" key={slide.slideId}>
            <div className="rrd-test-metric-thumbnail">
              <RehearsalSlideCanvasPreview
                ariaHidden
                deck={deck}
                slide={slide}
              />
            </div>
            <div>
              <span>슬라이드 {index + 1}</span>
              <strong>{metric.value}</strong>
              <small>{metric.meta}</small>
            </div>
            <em className={`is-${metric.tone}`}>{metric.status}</em>
          </article>
        );
      })}
    </div>
  );
}

export function FillerMetricDetails({ report }: Pick<CommonProps, "report">) {
  const distribution = buildFillerDistribution(
    report.fillerWordDetails,
    report.metrics.fillerWordCount,
  );
  const segments = buildFillerDonutSegments(distribution);

  if (segments.length === 0) {
    return (
      <p className="rrd-test-metric-empty">
        {report.metrics.fillerWordCount > 0
          ? "습관어 횟수는 기록됐지만 단어별 상세 기록이 없습니다."
          : "감지된 습관어가 없습니다."}
      </p>
    );
  }

  return (
    <svg
      aria-label={`습관어별 사용 횟수와 비중: ${distribution
        .map(
          (item) =>
            `“${item.word}” ${item.count}회 ${fmtPercent(item.sharePercent)}`,
        )
        .join(", ")}`}
      className="rrd-filler-donut-svg rrd-test-filler-donut-svg"
      role="img"
      viewBox={`0 0 ${FILLER_DONUT_WIDTH} ${FILLER_DONUT_HEIGHT}`}
    >
      <circle
        className="rrd-filler-donut-track"
        cx={FILLER_DONUT_CENTER_X}
        cy={FILLER_DONUT_CENTER_Y}
        fill="none"
        r={FILLER_DONUT_RADIUS}
        strokeWidth={FILLER_DONUT_STROKE_WIDTH}
      />
      <g
        transform={`rotate(-90 ${FILLER_DONUT_CENTER_X} ${FILLER_DONUT_CENTER_Y})`}
      >
        {segments.map((segment) => (
          <circle
            cx={FILLER_DONUT_CENTER_X}
            cy={FILLER_DONUT_CENTER_Y}
            fill="none"
            key={segment.word}
            r={FILLER_DONUT_RADIUS}
            stroke={segment.color}
            strokeDasharray={segment.dashArray}
            strokeDashoffset={segment.dashOffset}
            strokeWidth={FILLER_DONUT_STROKE_WIDTH}
          />
        ))}
      </g>
      {segments.map((segment) => (
        <g key={`${segment.word}-callout`}>
          <path className="rrd-filler-donut-callout" d={segment.linePath} />
          <circle
            className="rrd-filler-donut-callout-dot"
            cx={segment.startX}
            cy={segment.startY}
            r="3"
          />
          <text
            className="rrd-filler-donut-callout-label"
            textAnchor={segment.labelSide === "left" ? "end" : "start"}
            x={segment.labelX}
            y={segment.labelY - 7}
          >
            <tspan className="rrd-filler-donut-callout-word">
              “{segment.word}”
            </tspan>
            <tspan
              className="rrd-filler-donut-callout-value"
              dy="23"
              x={segment.labelX}
            >
              {segment.count}회 · {fmtPercent(segment.sharePercent)}
            </tspan>
          </text>
        </g>
      ))}
      <text
        className="rrd-filler-donut-center"
        textAnchor="middle"
        x={FILLER_DONUT_CENTER_X}
        y={FILLER_DONUT_CENTER_Y - 5}
      >
        <tspan className="rrd-filler-donut-center-value">
          {report.metrics.fillerWordCount}회
        </tspan>
        <tspan
          className="rrd-filler-donut-center-label"
          dy="24"
          x={FILLER_DONUT_CENTER_X}
        >
          상위 표현
        </tspan>
      </text>
    </svg>
  );
}
type SilenceProps = CommonProps & {
  audioPlaybackAvailable: boolean;
  formatDuration: (seconds: number) => string;
};

export function LongSilenceMetricDetails({
  audioPlaybackAvailable,
  deck,
  formatDuration,
  report,
}: SilenceProps) {
  const playback = useRehearsalAudioSegmentPlayback(report.runId);
  const silences = buildLongSilenceDetails(deck, report);

  if (silences.length === 0) {
    return (
      <p className="rrd-test-metric-empty">
        5초 이상 발화가 없었던 구간이 없습니다.
      </p>
    );
  }

  return (
    <div className="rrd-test-metric-detail-list">
      {playback.error ? (
        <p className="rrd-test-metric-error" role="alert">
          {playback.error}
        </p>
      ) : null}
      {silences.map((item, index) => {
        const range = getSilencePlaybackRange(
          item.startSeconds,
          item.endSeconds,
          Math.max(report.metrics.durationSeconds, item.endSeconds),
        );
        const segmentId = `test-silence-${range.startSeconds}-${range.endSeconds}`;
        const isLoading =
          playback.status === "loading" && playback.segmentId === segmentId;
        const isPlaying =
          playback.status === "playing" && playback.segmentId === segmentId;

        return (
          <article
            className="rrd-test-metric-slide is-silence"
            key={`${item.startSeconds}-${index}`}
          >
            <div className="rrd-test-metric-thumbnail">
              <RehearsalSlideCanvasPreview
                ariaHidden
                deck={deck}
                slide={item.slide}
              />
            </div>
            <div>
              <span>슬라이드 {item.slideIndex + 1}</span>
              <strong>
                {formatDuration(item.startSeconds)} ·{" "}
                {formatDuration(item.durationSeconds)}
              </strong>
              {audioPlaybackAvailable ? (
                <button
                  disabled={isLoading}
                  onClick={() => {
                    if (isPlaying) {
                      playback.stop();
                      return;
                    }
                    void playback.playSegment(
                      segmentId,
                      range.startSeconds,
                      range.endSeconds,
                    );
                  }}
                  type="button"
                >
                  {isPlaying ? (
                    <Pause aria-hidden="true" size={14} />
                  ) : (
                    <Play aria-hidden="true" size={14} />
                  )}
                  {isLoading
                    ? "불러오는 중"
                    : isPlaying
                      ? "재생 중지"
                      : "이 구간 들어보기"}
                </button>
              ) : (
                <small className="rrd-test-metric-unavailable">
                  <MicOff aria-hidden="true" size={14} /> 녹음 재생 불가
                </small>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function buildLongSilenceDetails(deck: Deck, report: RehearsalReport) {
  const longSilences = report.silenceAnalysis.segments.filter(
    (segment) => segment.durationSeconds >= 5,
  );
  let elapsed = 0;
  const windows = report.slideTimings.map((timing, index) => {
    const startSeconds = elapsed;
    elapsed += Math.max(0, timing.actualSeconds);
    return {
      endSeconds:
        index === report.slideTimings.length - 1
          ? Math.max(elapsed, report.metrics.durationSeconds)
          : elapsed,
      slideId: timing.slideId,
      startSeconds,
    };
  });

  return longSilences.flatMap((silence) => {
    const midpoint = (silence.startSeconds + silence.endSeconds) / 2;
    const windowIndex = windows.findIndex(
      (window, index) =>
        midpoint >= window.startSeconds &&
        (index === windows.length - 1
          ? midpoint <= window.endSeconds
          : midpoint < window.endSeconds),
    );
    const window = windows[windowIndex];
    const slide = window
      ? deck.slides.find((candidate) => candidate.slideId === window.slideId)
      : undefined;
    if (!slide) return [];

    return [
      {
        durationSeconds: silence.durationSeconds,
        endSeconds: silence.endSeconds,
        slide,
        slideIndex: deck.slides.findIndex(
          (candidate) => candidate.slideId === slide.slideId,
        ),
        startSeconds: silence.startSeconds,
      },
    ];
  });
}
