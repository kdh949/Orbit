import type {
  ActivityDefinition,
  ActivityPublicResult,
  ActivityRatingAggregateItem,
  ActivityRuntimeStatus,
  ActivitySlide,
  Deck
} from "@orbit/shared";
import { IconChartBar, IconQrcode } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { createQrDataUrl } from "../../editor/audience-link/audienceLinkUtils";
import { OrbitBrand } from "../../../components/ui";
import { activityApi } from "../api/activityApi";
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

  useEffect(() => {
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
  }, [props.activity.activityId, props.deckId, props.projectId]);

  return (
    <ActivityAudienceSlideRenderer
      activity={props.activity}
      audienceUrl={projection.audienceUrl}
      publicResult={projection.publicResult}
      scale={props.scale}
      slideStyle={props.slideStyle}
      status={projection.status}
      theme={props.theme}
    />
  );
}

export function ActivityAudienceSlideRenderer(props: {
  activity: ActivityDefinition;
  audienceUrl: string | null;
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
        <header>
          <OrbitBrand className="activity-slide-brand" />
          <h1>{activity.title}</h1>
          {activity.description ? <p>{activity.description}</p> : null}
        </header>

        {publicResult ? (
          <ActivityPublicResults activity={activity} result={publicResult} />
        ) : (
          <section className="activity-audience-participation" aria-live="polite">
            <div className="activity-audience-qr-frame">
              {qrDataUrl ? (
                <img alt="참여 페이지 QR 코드" src={qrDataUrl} />
              ) : (
                <IconQrcode aria-hidden="true" size={160} stroke={1.4} />
              )}
            </div>
            <div>
              <strong>{activityStatusHeading(props.status)}</strong>
              <p>{activityStatusMessage(props.status)}</p>
              {props.audienceUrl ? (
                <span className="activity-audience-url">{props.audienceUrl}</span>
              ) : null}
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

export function ActivityPublicResults(props: {
  activity: ActivityDefinition;
  result: ActivityPublicResult;
}) {
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
                <ul className="activity-public-choice-chart">
                  {question.options.map((option) => {
                    const choice = aggregate.choices.find((candidate) => candidate.optionId === option.optionId);
                    const ratio = choice?.ratio ?? 0;
                    return (
                      <li key={option.optionId}>
                        <span><b>{option.label}</b><em>{Math.round(ratio * 100)}%</em></span>
                        <i><span style={{ width: `${ratio * 100}%` }} /></i>
                      </li>
                    );
                  })}
                </ul>
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

function activityStatusHeading(status: AudienceProjection["status"]) {
  if (status === "open") return "지금 참여해주세요";
  if (status === "closed") return "응답이 마감되었습니다";
  if (status === "results") return "결과를 준비하고 있습니다";
  return "발표자가 참여를 준비하고 있습니다";
}

function activityStatusMessage(status: AudienceProjection["status"]) {
  if (status === "open") return "QR 코드를 스캔해 응답을 보내주세요.";
  if (status === "closed") return "잠시 후 결과를 공개합니다.";
  return "참여 화면이 열리면 이곳에 QR 코드가 표시됩니다.";
}
