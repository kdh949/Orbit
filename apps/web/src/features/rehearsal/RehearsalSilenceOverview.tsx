import { CircleAlert, MicOff, Pause, PauseCircle, Play } from "lucide-react";
import type { Deck, RehearsalReport } from "@orbit/shared";
import { useRehearsalAudioSegmentPlayback } from "./useRehearsalAudioSegmentPlayback";

type Props = {
  audioPlaybackAvailable?: boolean;
  deck: Deck | null;
  formatDuration: (totalSeconds: number) => string;
  report: RehearsalReport;
};

export function RehearsalSilenceOverview({
  audioPlaybackAvailable = true,
  deck,
  formatDuration,
  report,
}: Props) {
  const analysis = report.silenceAnalysis;
  const dangerousSilences = analysis.segments.filter(
    (segment) => segment.durationSeconds >= 5,
  );
  const dangerousSilenceCount = dangerousSilences.length;
  const transitions = buildSlideTransitions(deck, report.slideTimings);
  const timelineDuration = Math.max(
    1,
    report.metrics.durationSeconds,
    ...dangerousSilences.map((silence) => silence.endSeconds),
  );
  const playback = useRehearsalAudioSegmentPlayback(report.runId);

  return (
    <section className="rrd-card rrd-pause-section">
      <header className="rrd-pause-section-head">
        <div className="rrd-pause-section-title">
          <div className="rrd-pause-section-heading">
            <PauseCircle size={22} aria-hidden="true" />
            <h2>긴 침묵 구간 분석</h2>
          </div>
          <p>실제 음성에서 5초 이상 발화가 없었던 위험 구간을 확인하세요.</p>
        </div>
        <div className="rrd-pause-section-stats" aria-label="긴 침묵 요약">
          <div>
            <span>LONG SILENCE</span>
            <strong>
              {dangerousSilenceCount}
              <em>회</em>
            </strong>
          </div>
          <div>
            <span>TOTAL SILENCE</span>
            <strong>{formatDuration(analysis.totalSilenceSeconds ?? 0)}</strong>
          </div>
        </div>
      </header>

      {analysis.measurementState === "unmeasured" ? (
        <p className="rrd-empty-hint">
          이 회차는 음성 기반 침묵 구간을 측정하지 못했습니다.
        </p>
      ) : (
        <div className="rrd-pause-dashboard">
          <div className="rrd-pause-legend" aria-label="타임라인 범례">
            <span>
              <i className="is-transition" />
              슬라이드 전환
            </span>
            <span>
              <i className="is-pause" />
              5초 이상 발화 없음
            </span>
          </div>
          <div className="rrd-pause-timeline-wrap">
            <div
              className="rrd-pause-timeline"
              role="img"
              aria-label={`음성 타임라인. 위험 구간 ${dangerousSilenceCount}개`}
            >
              <span className="rrd-pause-timeline-line" aria-hidden="true" />
              <span className="rrd-pause-timeline-start" aria-hidden="true" />
              {transitions.map((transition) => (
                <span
                  key={`${transition.slideId}-${transition.index}`}
                  className="rrd-pause-timeline-transition"
                  style={{
                    left: `${(transition.atSecond / timelineDuration) * 100}%`,
                  }}
                  title={`${transition.index + 1}장 · ${transition.slideName}`}
                >
                  <b>{transition.index + 1}장</b>
                </span>
              ))}
              {dangerousSilences.map((silence, index) => (
                <i
                  key={`${silence.startSeconds}-${index}`}
                  className="rrd-pause-timeline-segment is-critical"
                  style={{
                    left: `${(silence.startSeconds / timelineDuration) * 100}%`,
                    width: `${Math.max(1.5, (silence.durationSeconds / timelineDuration) * 100)}%`,
                  }}
                  title={`긴 침묵 · ${formatDuration(silence.startSeconds)} · ${formatDuration(silence.durationSeconds)}`}
                >
                  <b>긴 침묵 · {formatDuration(silence.durationSeconds)}</b>
                </i>
              ))}
            </div>
          </div>
          {playback.error && (
            <p className="rrd-volume-playback-error" role="alert">
              {playback.error}
            </p>
          )}
          {dangerousSilences.length > 0 ? (
            <div className="rrd-pause-alert-grid">
              {dangerousSilences.map((silence, index) => {
                const range = getSilencePlaybackRange(
                  silence.startSeconds,
                  silence.endSeconds,
                  timelineDuration,
                );
                const segmentId = `silence-${range.startSeconds}-${range.endSeconds}`;
                const isLoading =
                  playback.status === "loading" &&
                  playback.segmentId === segmentId;
                const isPlaying =
                  playback.status === "playing" &&
                  playback.segmentId === segmentId;

                return (
                  <article
                    key={`${silence.startSeconds}-detail-${index}`}
                    className="rrd-pause-alert is-critical"
                  >
                    <header>
                      <CircleAlert size={18} />
                      <strong>긴 침묵 위험 구간</strong>
                      <span>{formatDuration(silence.durationSeconds)}</span>
                    </header>
                    <p>
                      {formatDuration(silence.startSeconds)} 지점에서 5초 이상
                      발화가 없었어요.
                    </p>
                    {audioPlaybackAvailable ? (
                      <button
                        type="button"
                        className="rrd-volume-playback-button rrd-pause-playback-button"
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
                        aria-label={`긴 침묵 ${formatDuration(silence.startSeconds)} 지점 ${isPlaying ? "재생 중지" : "앞뒤 연결 구간 재생"}`}
                      >
                        {isPlaying ? (
                          <Pause size={15} aria-hidden="true" />
                        ) : (
                          <Play size={15} aria-hidden="true" />
                        )}
                        {isLoading
                          ? "불러오는 중"
                          : isPlaying
                            ? "재생 중지"
                            : "이 구간 들어보기"}
                      </button>
                    ) : (
                      <span
                        className="rrd-volume-playback-unavailable rrd-pause-playback-unavailable"
                        role="status"
                      >
                        <MicOff size={15} aria-hidden="true" />
                        녹음 재생 불가
                      </span>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="rrd-empty-hint">
              5초 이상 발화가 없었던 위험 구간이 없습니다.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export const silencePlaybackContextSeconds = 2;

export function getSilencePlaybackRange(
  startSeconds: number,
  endSeconds: number,
  recordingDurationSeconds: number,
) {
  return {
    startSeconds: Math.max(0, startSeconds - silencePlaybackContextSeconds),
    endSeconds: Math.min(
      recordingDurationSeconds,
      endSeconds + silencePlaybackContextSeconds,
    ),
  };
}

function buildSlideTransitions(
  deck: Deck | null,
  slideTimings: RehearsalReport["slideTimings"],
) {
  let elapsed = 0;
  return slideTimings.map((timing, index) => {
    const slide = deck?.slides.find((item) => item.slideId === timing.slideId);
    const transition = {
      atSecond: elapsed,
      index,
      slideId: timing.slideId,
      slideName: slide?.title.trim() || `슬라이드 ${slide?.order ?? index + 1}`,
    };
    elapsed += timing.actualSeconds;
    return transition;
  });
}
