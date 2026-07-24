import type {
  ActivityDefinition,
  ActivityPublicResult,
  ActivityRatingAggregateItem,
  ActivityRuntimeStatus,
  ActivitySlide,
  Deck
} from "@orbit/shared";
import {
  IconChartBar,
  IconCircleFilled,
  IconGridDots,
  IconQrcode,
  IconUsers
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { createQrDataUrl } from "../../editor/audience-link/audienceLinkUtils";
import { activityApi } from "../api/activityApi";
import { useActivityPublicProjection } from "./activityPublicProjectionContext";
import { createActivityThemeStyle } from "./activityThemeStyle";
import "./activity-audience-slide.css";

type AudienceProjection = {
  audienceUrl: string | null;
  publicResult: ActivityPublicResult | null;
  status: ActivityRuntimeStatus | "preparing";
};

const emptyProjection: AudienceProjection = {
  audienceUrl: null,
  publicResult: null,
  status: "preparing"
};

export function ActivityAudienceRuntime(props: {
  activity: ActivityDefinition;
  deckId: string;
  projectId: string;
  scale: number;
  slideStyle?: ActivitySlide["style"];
  theme?: Deck["theme"];
}) {
  const [projection, setProjection] = useState<AudienceProjection>(emptyProjection);
  const providedProjection = useActivityPublicProjection(
    props.activity.activityId,
  );
  const usesProvidedProjection = providedProjection !== null;

  useEffect(() => {
    if (usesProvidedProjection) {
      return;
    }
    let cancelled = false;

    const refresh = async () => {
      try {
        const current = await activityApi.getCurrentSession(props.projectId, props.deckId);
        if (!current.session || !current.audienceUrl) {
          if (!cancelled) setProjection(emptyProjection);
          return;
        }
        const { run } = await activityApi.ensureRun(
          props.projectId,
          current.session.sessionId,
          props.activity.activityId
        );
        const { result } = await activityApi.getPublicResult(
          props.projectId,
          current.session.sessionId,
          run.activityRunId
        );
        if (!cancelled) {
          setProjection({
            audienceUrl: canonicalActivityUrl(current.audienceUrl, run.activityId),
            publicResult: result,
            status: run.status
          });
        }
      } catch {
        if (!cancelled) setProjection(emptyProjection);
      }
    };

    void refresh();
    const timerId = window.setInterval(() => void refresh(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [
    props.activity.activityId,
    props.deckId,
    props.projectId,
    usesProvidedProjection,
  ]);

  const visibleProjection: AudienceProjection = providedProjection
    ? {
        audienceUrl: providedProjection.audienceUrl,
        publicResult: providedProjection.publicResult,
        status: providedProjection.run?.status ?? "preparing",
      }
    : projection;

  return (
    <ActivityAudienceSlideRenderer
      activity={props.activity}
      audienceUrl={visibleProjection.audienceUrl}
      publicResult={visibleProjection.publicResult}
      scale={props.scale}
      slideStyle={props.slideStyle}
      status={visibleProjection.status}
      theme={props.theme}
    />
  );
}

export function ActivityAudienceSlideRenderer(props: {
  activity: ActivityDefinition;
  audienceUrl: string | null;
  previewQr?: boolean;
  publicResult: ActivityPublicResult | null;
  scale?: number;
  slideStyle?: ActivitySlide["style"];
  status: ActivityRuntimeStatus | "preparing";
  theme?: Deck["theme"];
}) {
  const { activity } = props;
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!props.audienceUrl) {
      setQrDataUrl("");
      return;
    }
    void createQrDataUrl(props.audienceUrl, { width: 640 })
      .then((value) => {
        if (!cancelled) setQrDataUrl(value);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [props.audienceUrl]);

  const publicResult = props.status === "results" ? props.publicResult : null;

  const scale = props.scale ?? 1;
  const statusHeading = activityStatusHeading(props.status);

  return (
    <div
      className="activity-audience-slide-viewport"
      style={{ height: 1080 * scale, width: 1920 * scale }}
    >
      <section
        aria-label="청중 참여 장표"
        className="activity-audience-slide"
        data-activity-status={props.status}
        style={{
          ...createActivityThemeStyle(props.theme, props.slideStyle),
          transform: `scale(${scale})`
        }}
      >
        <IconCircleFilled
          aria-hidden="true"
          className="activity-audience-decoration activity-audience-decoration-orb"
          size={720}
        />
        <IconGridDots
          aria-hidden="true"
          className="activity-audience-decoration activity-audience-decoration-dots-top"
          size={112}
          stroke={2.2}
        />
        <IconGridDots
          aria-hidden="true"
          className="activity-audience-decoration activity-audience-decoration-dots-bottom"
          size={112}
          stroke={2.2}
        />
        <header>
          <div className="activity-audience-live-badge">
            <span>
              <IconChartBar aria-hidden="true" size={28} stroke={2.4} />
            </span>
            <strong>{activityTemplateBadge(activity.template)}</strong>
          </div>
          <h1>{activity.title}</h1>
          {activity.description ? <p>{activity.description}</p> : null}
        </header>

        {publicResult ? (
          <ActivityPublicResults activity={activity} result={publicResult} />
        ) : (
          <section className="activity-audience-participation" aria-live="polite">
            <div className="activity-audience-qr-frame">
              {props.previewQr ? (
                <ActivityPreviewQr />
              ) : qrDataUrl ? (
                <img alt="참여 페이지 QR 코드" src={qrDataUrl} />
              ) : (
                <IconQrcode aria-hidden="true" size={160} stroke={1.4} />
              )}
            </div>
            <div className="activity-audience-participation-copy">
              <strong aria-label={statusHeading.full}>
                <span>{statusHeading.accent}</span>
                {statusHeading.rest}
              </strong>
              <p>{activityStatusMessage(props.status)}</p>
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

function ActivityPreviewQr() {
  return (
    <svg
      aria-hidden="true"
      className="activity-audience-preview-qr"
      shapeRendering="crispEdges"
      viewBox="0 0 29 29"
    >
      <rect fill="#fff" height="29" width="29" />
      <path
        d="M2 2h7v7H2zm18 0h7v7h-7zM2 20h7v7H2zM11 2h2v2h-2zm4 0h3v2h-3zm-4 4h2v3h-2zm4-1h3v2h-3zm-4 6h3v2h-3zm5-2h2v4h-2zm4 2h2v3h-2zm4-1h3v2h-3zM2 11h2v3H2zm4 0h3v2H6zm-4 5h3v2H2zm5-1h2v3H7zm4 0h2v2h-2zm3 1h4v2h-4zm6 0h2v3h-2zm4-1h3v3h-3zM11 20h2v3h-2zm4-1h3v2h-3zm5 2h3v2h-3zm4-1h3v4h-3zm-13 5h4v2h-4zm6-1h2v3h-2zm4 2h2v1h-2zm4 0h2v1h-2z"
        fill="#09090b"
      />
      <path d="M3 3h5v5H3zm18 0h5v5h-5zM3 21h5v5H3z" fill="#fff" />
      <path d="M4 4h3v3H4zm18 0h3v3h-3zM4 22h3v3H4z" fill="#09090b" />
    </svg>
  );
}

export function ActivityPublicResults(props: {
  activity: ActivityDefinition;
  result: ActivityPublicResult;
}) {
  const pollQuestion = props.activity.template === "poll"
    ? props.activity.questions[0]
    : undefined;
  const pollAggregate = pollQuestion
    ? props.result.aggregates.find((candidate) => candidate.questionId === pollQuestion.questionId)
    : undefined;

  if (
    pollQuestion &&
    pollAggregate &&
    (pollQuestion.type === "single-choice" || pollQuestion.type === "multiple-choice")
  ) {
    const rankedOptions = pollQuestion.options
      .map((option, index) => {
        const choice = pollAggregate.choices.find(
          (candidate) => candidate.optionId === option.optionId
        );
        return {
          color: pollChoiceColor(index),
          count: choice?.count ?? 0,
          index,
          label: option.label,
          optionId: option.optionId,
          ratio: choice?.ratio ?? 0
        };
      })
      .sort((left, right) =>
        right.ratio - left.ratio ||
        right.count - left.count ||
        left.index - right.index
      );
    const winner = pollAggregate.responseCount > 0 ? rankedOptions[0] : undefined;

    return (
      <section
        aria-label="공개 결과"
        className="activity-public-results activity-public-poll-results"
      >
        <div className="activity-public-poll-content">
          <section className="activity-public-poll-overview">
            <strong className="activity-public-poll-heading">
              <IconChartBar aria-hidden="true" size={34} stroke={2.4} />
              실시간 결과
            </strong>
            <div
              aria-label="선택지 응답 비율 도넛 차트"
              className="activity-public-poll-donut"
              role="img"
              style={{ background: createPollDonutBackground(pollQuestion, pollAggregate) }}
            >
              <span
                aria-hidden="true"
                className="activity-public-poll-winner-highlight"
                style={{
                  background: createPollWinnerHighlightBackground(
                    rankedOptions,
                    winner?.ratio
                  )
                }}
              />
              <div className="activity-public-poll-winner">
                {winner ? (
                  <>
                    <span>1위</span>
                    <strong>{winner.label}</strong>
                    <em>{Math.round(winner.ratio * 100)}%</em>
                  </>
                ) : (
                  <>
                    <strong>응답 대기 중</strong>
                    <em>0%</em>
                  </>
                )}
              </div>
            </div>
            <div className="activity-public-poll-participants">
              <IconUsers aria-hidden="true" size={34} stroke={2} />
              <span>총 <strong>{pollAggregate.responseCount}</strong>명 참여</span>
            </div>
          </section>
          <section
            aria-label={pollQuestion.prompt}
            className="activity-public-poll-ranking"
          >
            <strong className="activity-public-poll-question">{pollQuestion.prompt}</strong>
            <ol className="activity-public-poll-ranking-list">
              {rankedOptions.map((option, index) => {
                const displayedRank = winner
                  ? rankedOptions.findIndex(
                      (candidate) => candidate.ratio === option.ratio
                    ) + 1
                  : index + 1;
                const isWinner = winner?.ratio === option.ratio;
                return (
                  <li
                    className={isWinner ? "is-winner" : undefined}
                    key={option.optionId}
                  >
                    <span className="activity-public-poll-rank">{displayedRank}</span>
                    <div>
                      <strong>{option.label}</strong>
                      <i>
                        <span
                          style={{
                            background: option.color,
                            width: `${option.ratio * 100}%`
                          }}
                        />
                      </i>
                    </div>
                    <em>{Math.round(option.ratio * 100)}%</em>
                  </li>
                );
              })}
            </ol>
            <p className="activity-public-poll-live-status">
              <span aria-hidden="true" />
              결과가 실시간으로 생성되었습니다.
            </p>
          </section>
        </div>
      </section>
    );
  }

  return (
    <section className="activity-public-results" aria-label="공개 결과">
      <div className="activity-public-result-summary">
        <IconChartBar aria-hidden="true" size={28} stroke={1.6} />
        <span>응답</span>
        <strong>{props.result.responseCount}</strong>
      </div>
      <div className="activity-public-result-grid">
        {props.activity.questions.map((question) => {
          const aggregate = props.result.aggregates.find(
            (candidate) => candidate.questionId === question.questionId
          );
          if (!aggregate) return null;
          return (
            <article key={question.questionId}>
              <span>{question.prompt}</span>
              {question.type === "rating" ? (
                <div className="activity-public-rating-result">
                  <strong>
                    {aggregate.average === null ? "–" : aggregate.average.toFixed(1)}
                    <small>/ 5</small>
                  </strong>
                  <ActivityRatingDistribution items={aggregate.ratingDistribution} />
                </div>
              ) : question.type === "single-choice" || question.type === "multiple-choice" ? (
                <ActivityChoiceChart aggregate={aggregate} question={question} />
              ) : (
                <strong>{aggregate.responseCount}<small>개 의견</small></strong>
              )}
            </article>
          );
        })}
      </div>
      {props.result.approvedTextEntries.length > 0 ? (
        <ul className="activity-public-text-list" aria-label="공개 의견">
          {props.result.approvedTextEntries.slice(0, 3).map((entry) => (
            <li key={entry.entryId}>{entry.text}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

type ChoiceQuestion = Extract<
  ActivityDefinition["questions"][number],
  { type: "single-choice" | "multiple-choice" }
>;

type PublicAggregate = ActivityPublicResult["aggregates"][number];

function ActivityChoiceChart(props: {
  aggregate: PublicAggregate;
  colorize?: boolean;
  question: ChoiceQuestion;
}) {
  return (
    <ul className="activity-public-choice-chart">
      {props.question.options.map((option, index) => {
        const choice = props.aggregate.choices.find(
          (candidate) => candidate.optionId === option.optionId
        );
        const ratio = choice?.ratio ?? 0;
        return (
          <li key={option.optionId}>
            <span><b>{option.label}</b><em>{Math.round(ratio * 100)}%</em></span>
            <i>
              <span
                style={{
                  background: props.colorize ? pollChoiceColor(index) : undefined,
                  width: `${ratio * 100}%`
                }}
              />
            </i>
          </li>
        );
      })}
    </ul>
  );
}

function createPollDonutBackground(
  question: ChoiceQuestion,
  aggregate: PublicAggregate
) {
  let cursor = 0;
  const segments = question.options
    .map((option, index) => ({
      color: pollChoiceColor(index),
      index,
      ratio: aggregate.choices.find(
        (candidate) => candidate.optionId === option.optionId
      )?.ratio ?? 0
    }))
    .sort((left, right) => right.ratio - left.ratio || left.index - right.index)
    .flatMap((choice) => {
      if (choice.ratio <= 0) return [];
      const start = cursor;
      cursor += choice.ratio * 100;
      return `${choice.color} ${start}% ${cursor}%`;
    });
  return segments.length > 0
    ? `conic-gradient(${segments.join(", ")})`
    : "var(--activity-color-muted)";
}

function createPollWinnerHighlightBackground(
  options: Array<{ color: string; ratio: number }>,
  winnerRatio?: number
) {
  if (winnerRatio === undefined) return "transparent";

  let cursor = 0;
  const segments = options.flatMap((option) => {
    if (option.ratio !== winnerRatio) return [];
    const start = cursor;
    cursor += option.ratio * 100;
    return `${option.color} ${start}% ${cursor}%`;
  });
  if (cursor < 100) segments.push(`transparent ${cursor}% 100%`);
  return `conic-gradient(${segments.join(", ")})`;
}

function pollChoiceColor(index: number) {
  const colors = [
    "color-mix(in srgb, var(--activity-color-accent) 76%, var(--activity-color-on-surface))",
    "color-mix(in srgb, var(--activity-color-secondary) 76%, var(--activity-color-on-surface))",
    "var(--activity-color-on-surface)",
    "color-mix(in srgb, var(--activity-color-accent) 44%, var(--activity-color-on-surface))",
    "color-mix(in srgb, var(--activity-color-secondary) 44%, var(--activity-color-on-surface))"
  ];
  return colors[index % colors.length];
}

export function ActivityRatingDistribution(props: {
  items: ActivityRatingAggregateItem[];
}) {
  return (
    <ul className="activity-rating-distribution" aria-label="평점 분포">
      {props.items.map((item) => (
        <li key={item.value}>
          <span>{item.value}점</span>
          <i><span style={{ width: `${item.ratio * 100}%` }} /></i>
          <b>{item.count}</b>
        </li>
      ))}
    </ul>
  );
}

export function canonicalActivityUrl(audienceUrl: string, activityId: string) {
  const base =
    typeof window === "undefined"
      ? new URL(audienceUrl, "https://orbit.invalid")
      : new URL(audienceUrl, window.location.origin);
  base.pathname = `${base.pathname.replace(/\/$/, "")}/a/${encodeURIComponent(activityId)}`;
  return typeof window === "undefined" && base.origin === "https://orbit.invalid"
    ? `${base.pathname}${base.search}${base.hash}`
    : base.toString();
}

function activityTemplateBadge(template: ActivityDefinition["template"]) {
  if (template === "poll") return "LIVE POLL";
  if (template === "pre-question") return "LIVE Q&A";
  return "LIVE SURVEY";
}

function activityStatusHeading(status: AudienceProjection["status"]): {
  accent: string;
  full: string;
  rest: string;
} {
  if (status === "open") {
    return { accent: "지금 참여", full: "지금 참여해 주세요", rest: "해 주세요" };
  }
  if (status === "closed") {
    return { accent: "응답이 마감", full: "응답이 마감되었습니다", rest: "되었습니다" };
  }
  if (status === "results") {
    return { accent: "결과를 준비", full: "결과를 준비하고 있습니다", rest: "하고 있습니다" };
  }
  return {
    accent: "발표자가 참여를 준비",
    full: "발표자가 참여를 준비하고 있습니다",
    rest: "하고 있습니다"
  };
}

function activityStatusMessage(status: AudienceProjection["status"]) {
  if (status === "open") return "스마트폰으로 QR 코드를 스캔해\n응답을 보내주세요.";
  if (status === "closed") return "잠시 후 결과를 공개합니다.";
  return "참여 화면이 열리면 이곳에 QR 코드가 표시됩니다.";
}
