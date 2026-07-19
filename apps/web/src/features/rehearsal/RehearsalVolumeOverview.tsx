import { Pause, Play, MicOff, Volume1, Volume2 } from "lucide-react";
import { useMemo } from "react";
import type { RehearsalReport } from "@orbit/shared";
import { useRehearsalAudioSegmentPlayback } from "./useRehearsalAudioSegmentPlayback";

type Props = {
  audioPlaybackAvailable?: boolean;
  formatDuration: (totalSeconds: number) => string;
  report: RehearsalReport;
};

export function RehearsalVolumeOverview({
  audioPlaybackAvailable = true,
  formatDuration,
  report,
}: Props) {
  const analysis = report.volumeAnalysis;
  const issues = useMemo(
    () => selectRepresentativeVolumeIssues(analysis.issueSegments),
    [analysis.issueSegments],
  );
  const quietCount = issues.filter((issue) => issue.kind === "quiet").length;
  const loudCount = issues.length - quietCount;
  const timelineDuration = Math.max(
    1,
    report.metrics.durationSeconds,
    ...issues.map((issue) => issue.endSeconds),
  );
  const playback = useRehearsalAudioSegmentPlayback(report.runId);

  return (
    <section className="rrd-card rrd-volume-section">
      <header className="rrd-volume-section-head">
        <div className="rrd-volume-section-title">
          <div className="rrd-volume-section-heading">
            <Volume2 size={22} aria-hidden="true" />
            <h2>음량 변화 구간</h2>
          </div>
          <p>이 리허설의 전체 발화와 비교해 음량이 달라진 구간을 확인하세요.</p>
        </div>
        <div className="rrd-volume-section-stats" aria-label="음량 변화 요약">
          <div>
            <span>전체 발화보다 작게 말한 주요 구간</span>
            <strong>
              {quietCount}
              <em>개</em>
            </strong>
          </div>
          <div>
            <span>전체 발화보다 크게 말한 주요 구간</span>
            <strong>
              {loudCount}
              <em>개</em>
            </strong>
          </div>
        </div>
      </header>

      {analysis.measurementState === "unmeasured" ? (
        <p className="rrd-empty-hint">
          {analysis.reasonCode === "LEGACY_REPORT"
            ? "이 리허설은 음량 분석 기능이 적용되기 전에 생성되었어요."
            : "이 회차는 음량 변화를 측정하지 못했어요."}
        </p>
      ) : issues.length === 0 ? (
        <p className="rrd-empty-hint">
          전체 발화와 비교해 음량 변화가 큰 구간이 없었어요.
        </p>
      ) : (
        <div className="rrd-volume-dashboard">
          <div className="rrd-volume-legend" aria-label="음량 타임라인 범례">
            <span>
              <i className="is-quiet" />
              전체 발화보다 작게 말함
            </span>
            <span>
              <i className="is-loud" />
              전체 발화보다 크게 말함
            </span>
          </div>
          <div className="rrd-volume-timeline-wrap">
            <div
              className="rrd-volume-timeline"
              role="img"
              aria-label={`음량 변화 타임라인. 작게 말한 구간 ${quietCount}개, 크게 말한 구간 ${loudCount}개`}
            >
              <span className="rrd-volume-timeline-line" aria-hidden="true" />
              {issues.map((issue, index) => (
                <i
                  key={`${issue.kind}-${issue.startSeconds}-${index}`}
                  className={`rrd-volume-timeline-segment is-${issue.kind}`}
                  style={{
                    left: `${(issue.startSeconds / timelineDuration) * 100}%`,
                    width: `${Math.max(1.5, (issue.durationSeconds / timelineDuration) * 100)}%`,
                  }}
                  title={`${issueLabel(issue.kind)} · ${formatDuration(issue.startSeconds)} · ${formatDuration(issue.durationSeconds)}`}
                />
              ))}
            </div>
            <div className="rrd-volume-timeline-axis" aria-hidden="true">
              <span>0분 00초</span>
              <span>{formatDuration(timelineDuration)}</span>
            </div>
          </div>

          {playback.error && (
            <p className="rrd-volume-playback-error" role="alert">
              {playback.error}
            </p>
          )}

          <div className="rrd-volume-issue-list">
            {issues.map((issue, index) => {
              const segmentId = `${issue.kind}-${issue.startSeconds}-${issue.endSeconds}`;
              const isLoading =
                playback.status === "loading" &&
                playback.segmentId === segmentId;
              const isPlaying =
                playback.status === "playing" &&
                playback.segmentId === segmentId;
              return (
                <article
                  key={`${segmentId}-${index}`}
                  className={`rrd-volume-issue is-${issue.kind}`}
                >
                  <div className="rrd-volume-issue-icon" aria-hidden="true">
                    {issue.kind === "quiet" ? (
                      <Volume1 size={19} />
                    ) : (
                      <Volume2 size={19} />
                    )}
                  </div>
                  <div className="rrd-volume-issue-copy">
                    <strong>{issueLabel(issue.kind)}</strong>
                    <p>
                      {formatDuration(issue.startSeconds)} 지점부터{" "}
                      {formatDuration(issue.durationSeconds)} 동안 이어졌어요.
                    </p>
                  </div>
                  {audioPlaybackAvailable ? (
                    <button
                      type="button"
                      className="rrd-volume-playback-button"
                      disabled={isLoading}
                      onClick={() => {
                        if (isPlaying) {
                          playback.stop();
                          return;
                        }
                        void playback.playSegment(
                          segmentId,
                          issue.startSeconds,
                          issue.endSeconds,
                        );
                      }}
                      aria-label={`${issueLabel(issue.kind)} ${formatDuration(issue.startSeconds)} 지점 ${isPlaying ? "재생 중지" : "재생"}`}
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
                      className="rrd-volume-playback-unavailable"
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
        </div>
      )}
    </section>
  );
}

type VolumeIssue = RehearsalReport["volumeAnalysis"]["issueSegments"][number];

const minimumRepresentativeSeconds = 2;
const representativeMergeGapSeconds = 1;
const maximumRepresentativeSegments = 5;

export function selectRepresentativeVolumeIssues(
  issueSegments: readonly VolumeIssue[],
): VolumeIssue[] {
  const merged: Array<{ issue: VolumeIssue; evidenceSeconds: number }> = [];
  const ordered = [...issueSegments].sort(
    (left, right) => left.startSeconds - right.startSeconds,
  );

  for (const issue of ordered) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.issue.kind === issue.kind &&
      issue.startSeconds - previous.issue.endSeconds <=
        representativeMergeGapSeconds
    ) {
      const previousEvidenceSeconds = previous.evidenceSeconds;
      const issueEvidenceSeconds = issue.durationSeconds;
      const evidenceSeconds = previousEvidenceSeconds + issueEvidenceSeconds;
      previous.issue.endSeconds = Math.max(
        previous.issue.endSeconds,
        issue.endSeconds,
      );
      previous.issue.durationSeconds =
        previous.issue.endSeconds - previous.issue.startSeconds;
      previous.issue.meanDeviationDb =
        (previous.issue.meanDeviationDb * previousEvidenceSeconds +
          issue.meanDeviationDb * issueEvidenceSeconds) /
        evidenceSeconds;
      previous.evidenceSeconds = evidenceSeconds;
      continue;
    }

    merged.push({
      issue: { ...issue },
      evidenceSeconds: issue.durationSeconds,
    });
  }

  return merged
    .map(({ issue }) => issue)
    .filter((issue) => issue.durationSeconds >= minimumRepresentativeSeconds)
    .sort((left, right) => {
      const scoreDifference =
        right.durationSeconds * Math.abs(right.meanDeviationDb) -
        left.durationSeconds * Math.abs(left.meanDeviationDb);
      return scoreDifference || right.durationSeconds - left.durationSeconds;
    })
    .slice(0, maximumRepresentativeSegments)
    .sort((left, right) => left.startSeconds - right.startSeconds);
}
function issueLabel(kind: "quiet" | "loud") {
  return kind === "quiet"
    ? "전체 발화보다 작게 말한 주요 구간"
    : "전체 발화보다 크게 말한 주요 구간";
}
